//! Main application state and event loop

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;
use wasm_bindgen_futures::spawn_local;
use winit::{
    application::ApplicationHandler,
    event::{ElementState, KeyEvent, MouseButton, WindowEvent},
    event_loop::{ActiveEventLoop, EventLoop},
    keyboard::{KeyCode, PhysicalKey},
    window::{Window, WindowId},
};

use crate::audio::AudioManager;
use crate::connection::GraphConnection;
use crate::graph::GraphStore;
use crate::input::{Camera2D, GraphInteraction};
use crate::player::FrugPlayer;
use crate::render::GraphRenderer;
use crate::ui::GraphUI;

/// Initialization state for async renderer creation
enum InitState {
    NotStarted,
    Pending,
    Ready,
    Failed(String),
}

/// Main application state
pub struct GraphApp {
    // Core state
    store: GraphStore,
    connection: GraphConnection,

    // Rendering
    renderer: Option<GraphRenderer>,
    window: Option<Arc<Window>>,
    init_state: Rc<RefCell<InitState>>,
    pending_renderer: Rc<RefCell<Option<GraphRenderer>>>,

    // Input
    camera: Camera2D,
    interaction: GraphInteraction,

    // Player
    frug: FrugPlayer,
    previous_chunk: (i32, i32),

    // Audio
    audio: AudioManager,
    audio_initialized: bool,

    // UI
    ui: GraphUI,

    // Performance
    last_frame_time: f64,
    fps: f32,
    frame_count: u32,
    fps_update_time: f64,

    // Config
    #[allow(dead_code)]
    canvas_id: String,
    #[allow(dead_code)]
    spacetime_url: String,
}

impl GraphApp {
    /// Create a new graph application
    pub async fn new(canvas_id: &str, spacetime_url: &str) -> Result<Self, String> {
        let store = GraphStore::new();
        let connection = GraphConnection::new(spacetime_url)?;
        let camera = Camera2D::new();
        let interaction = GraphInteraction::new();
        let frug = FrugPlayer::new();
        let audio = AudioManager::new();
        let ui = GraphUI::new();

        Ok(Self {
            store,
            connection,
            renderer: None,
            window: None,
            init_state: Rc::new(RefCell::new(InitState::NotStarted)),
            pending_renderer: Rc::new(RefCell::new(None)),
            camera,
            interaction,
            frug,
            previous_chunk: (0, 0),
            audio,
            audio_initialized: false,
            ui,
            last_frame_time: 0.0,
            fps: 0.0,
            frame_count: 0,
            fps_update_time: 0.0,
            canvas_id: canvas_id.to_string(),
            spacetime_url: spacetime_url.to_string(),
        })
    }

    /// Run the application event loop
    pub async fn run(mut self) -> Result<(), String> {
        let event_loop = EventLoop::new()
            .map_err(|e| format!("Failed to create event loop: {}", e))?;

        event_loop.run_app(&mut self)
            .map_err(|e| format!("Event loop error: {}", e))?;

        Ok(())
    }

    /// Handle a single frame update
    fn update(&mut self, dt: f32) {
        // Calculate FPS
        #[cfg(target_arch = "wasm32")]
        {
            if let Some(perf) = web_sys::window().and_then(|w| w.performance()) {
                let now = perf.now();
                self.frame_count += 1;

                // Update FPS every 500ms
                if now - self.fps_update_time >= 500.0 {
                    let elapsed = (now - self.fps_update_time) / 1000.0;
                    self.fps = self.frame_count as f32 / elapsed as f32;
                    self.frame_count = 0;
                    self.fps_update_time = now;
                }
            }
        }

        // Update frug player
        self.frug.update(dt);

        // Camera follows frug
        self.camera.set_follow_target(Some(self.frug.visual_position));
        self.camera.update(dt);

        // Detect chunk transitions
        let current_chunk = self.frug.get_chunk();
        if current_chunk != self.previous_chunk {
            self.on_chunk_entered(current_chunk);
            self.previous_chunk = current_chunk;
        }

        // Process SpacetimeDB updates
        self.connection.poll_updates(&mut self.store);

        // Poll for dialogue responses from JS bridge
        for (is_player, text) in crate::connection::spacetime::poll_dialogue_responses() {
            // Only add NPC responses to history (player messages are added when sent)
            if !is_player {
                self.ui.dialogue_history.push((false, text));
                self.ui.awaiting_response = false;
            }
        }

        // Handle projection mode changes from UI
        if let Some(mode) = self.ui.take_projection_mode_change() {
            self.camera.set_projection_mode(mode);
            log::info!("Projection mode changed to: {:?}", mode);
        }

        // Handle audio settings changes from UI
        if let Some(settings) = self.ui.take_audio_changes() {
            self.audio.set_master_volume(settings.master_volume);
            self.audio.set_music_volume(settings.music_volume);
            self.audio.set_ambient_volume(settings.ambient_volume);
            self.audio.set_dialogue_volume(settings.dialogue_volume);

            // Handle mute toggles
            if settings.music_muted != self.audio.state.music_muted {
                self.audio.toggle_music_mute();
            }
            if settings.ambient_muted != self.audio.state.ambient_muted {
                self.audio.toggle_ambient_mute();
            }
            if settings.dialogue_enabled != self.audio.state.dialogue_enabled {
                self.audio.toggle_dialogue_enabled();
            }
        }

        // Handle audio enable request from UI
        if self.ui.take_audio_enable_request() {
            self.try_initialize_audio();
        }

        // Sync audio state to UI (including enabled status)
        self.ui.sync_audio_settings(&self.audio.state);
        self.ui.set_audio_enabled(self.audio_initialized);

        // Update layout if needed
        self.store.update_layout(dt, self.camera.zoom);

        // Update spatial index if nodes moved
        if self.store.layout_dirty {
            self.store.rebuild_spatial_index();
        }
    }

    /// Called when frug enters a new chunk
    /// Note: NPCs are now loaded from SpacetimeDB via the JS bridge, not generated here
    fn on_chunk_entered(&mut self, chunk: (i32, i32)) {
        log::info!("Entered chunk ({}, {})", chunk.0, chunk.1);
        // Real NPC data comes from SpacetimeDB via the bridge
        // The connection.poll_updates() method handles streaming updates
    }

    /// Render a frame
    fn render(&mut self, dt: f32) {
        if let Some(renderer) = &mut self.renderer {
            // Get all nodes - WASM has enough performance to render everything
            let all_nodes: Vec<u64> = self.store.nodes.keys().copied().collect();

            // Render the graph
            renderer.render(
                &self.store,
                &all_nodes,
                &self.camera,
                &self.interaction,
                &self.frug,
                self.fps,
                dt,
                &mut self.ui,
            );
        }
    }
}

impl ApplicationHandler for GraphApp {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        // Check if we have a pending renderer ready
        if let Some(renderer) = self.pending_renderer.borrow_mut().take() {
            self.renderer = Some(renderer);
            *self.init_state.borrow_mut() = InitState::Ready;

            // Connect to SpacetimeDB now that renderer is ready
            if let Err(e) = self.connection.connect(&mut self.store) {
                log::error!("Failed to connect to SpacetimeDB: {}", e);
            }

            log::info!("Renderer ready, connected to SpacetimeDB");
            return;
        }

        // Check current init state
        match *self.init_state.borrow() {
            InitState::Pending => {
                // Still waiting for async init
                return;
            }
            InitState::Ready => {
                // Already initialized
                return;
            }
            InitState::Failed(ref e) => {
                log::error!("Initialization failed: {}", e);
                return;
            }
            InitState::NotStarted => {
                // Continue to start initialization
            }
        }

        // Create window with platform-specific configuration
        #[allow(unused_mut)]
        let mut window_attrs = Window::default_attributes()
            .with_title("Frugworld - NPC Relationship Graph");

        // On web, attach to existing canvas and set size
        #[cfg(target_arch = "wasm32")]
        {
            use winit::platform::web::WindowAttributesExtWebSys;
            use wasm_bindgen::JsCast;

            let document = web_sys::window()
                .expect("No window")
                .document()
                .expect("No document");

            let canvas = document
                .get_element_by_id(&self.canvas_id)
                .expect("Canvas not found")
                .dyn_into::<web_sys::HtmlCanvasElement>()
                .expect("Not a canvas");

            // Set canvas size from its client dimensions
            let width = canvas.client_width().max(800) as u32;
            let height = canvas.client_height().max(600) as u32;
            canvas.set_width(width);
            canvas.set_height(height);

            log::info!("Canvas size: {}x{}", width, height);

            window_attrs = window_attrs.with_canvas(Some(canvas));
        }

        let window = Arc::new(
            event_loop
                .create_window(window_attrs)
                .expect("Failed to create window")
        );

        self.window = Some(window.clone());

        // Mark as pending and spawn async renderer creation
        *self.init_state.borrow_mut() = InitState::Pending;

        let pending_renderer = self.pending_renderer.clone();
        let init_state = self.init_state.clone();
        let window_for_redraw = window.clone();

        spawn_local(async move {
            log::info!("Creating renderer...");
            match GraphRenderer::new(window).await {
                Ok(renderer) => {
                    *pending_renderer.borrow_mut() = Some(renderer);
                    log::info!("Renderer created successfully");
                    // Request a redraw to pick up the pending renderer
                    window_for_redraw.request_redraw();
                }
                Err(e) => {
                    log::error!("Failed to create renderer: {}", e);
                    *init_state.borrow_mut() = InitState::Failed(e);
                }
            }
        });

        log::info!("Window created, renderer initialization started");
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        event: WindowEvent,
    ) {
        // Let egui handle events first
        if let Some(renderer) = &mut self.renderer {
            if renderer.handle_event(&event) {
                return; // Event consumed by egui
            }
        }

        match event {
            WindowEvent::CloseRequested => {
                log::info!("Close requested, exiting");
                event_loop.exit();
            }

            WindowEvent::Resized(size) => {
                if let Some(renderer) = &mut self.renderer {
                    renderer.resize(size.width, size.height);
                }
                // Convert to logical pixels for camera (cursor is in logical pixels)
                let scale = self.window.as_ref().map(|w| w.scale_factor()).unwrap_or(1.0) as f32;
                self.camera.set_viewport_size(size.width as f32 / scale, size.height as f32 / scale);
            }

            WindowEvent::RedrawRequested => {
                // Check if async renderer is ready
                if self.renderer.is_none() {
                    #[allow(unused_mut)]
                    if let Some(mut renderer) = self.pending_renderer.borrow_mut().take() {
                        // On WASM, manually configure surface with canvas size
                        // since winit's ResizeObserver doesn't fire for initial size
                        #[cfg(target_arch = "wasm32")]
                        {
                            use wasm_bindgen::JsCast;
                            if let Some(window) = web_sys::window() {
                                if let Some(document) = window.document() {
                                    if let Some(canvas) = document.get_element_by_id(&self.canvas_id) {
                                        if let Ok(canvas) = canvas.dyn_into::<web_sys::HtmlCanvasElement>() {
                                            let width = canvas.client_width().max(1) as u32;
                                            let height = canvas.client_height().max(1) as u32;
                                            log::info!("Manual resize from canvas: {}x{}", width, height);
                                            renderer.resize(width, height);
                                            self.camera.set_viewport_size(width as f32, height as f32);
                                        }
                                    }
                                }
                            }
                        }

                        self.renderer = Some(renderer);
                        *self.init_state.borrow_mut() = InitState::Ready;

                        // Connect to SpacetimeDB now that renderer is ready
                        if let Err(e) = self.connection.connect(&mut self.store) {
                            log::error!("Failed to connect to SpacetimeDB: {}", e);
                        }

                        log::info!("Renderer ready, connected to SpacetimeDB");
                    }
                }

                let dt = 1.0 / 60.0; // Fixed timestep for now
                self.update(dt);
                self.render(dt);

                if let Some(window) = &self.window {
                    window.request_redraw();
                }
            }

            WindowEvent::KeyboardInput {
                event: KeyEvent {
                    physical_key: PhysicalKey::Code(key),
                    state,
                    ..
                },
                ..
            } => {
                self.handle_key(key, state == ElementState::Pressed);
            }

            WindowEvent::MouseInput { button, state, .. } => {
                self.handle_mouse_button(button, state == ElementState::Pressed);
            }

            WindowEvent::CursorMoved { position, .. } => {
                // On web, cursor positions are in physical pixels but we work in logical pixels
                // Need to divide by scale factor
                let scale = self.window.as_ref().map(|w| w.scale_factor()).unwrap_or(1.0) as f32;
                self.handle_mouse_move(position.x as f32 / scale, position.y as f32 / scale);
            }

            WindowEvent::MouseWheel { delta, .. } => {
                let scroll = match delta {
                    winit::event::MouseScrollDelta::LineDelta(_, y) => y,
                    winit::event::MouseScrollDelta::PixelDelta(pos) => pos.y as f32 / 100.0,
                };
                self.camera.handle_scroll(scroll);
            }

            _ => {}
        }
    }
}

impl GraphApp {
    fn handle_key(&mut self, key: KeyCode, pressed: bool) {
        if pressed {
            match key {
                // Frug movement (WASD)
                KeyCode::KeyW => self.frug.set_move_up(true),
                KeyCode::KeyS => self.frug.set_move_down(true),
                KeyCode::KeyA => self.frug.set_move_left(true),
                KeyCode::KeyD => self.frug.set_move_right(true),

                // Commands
                KeyCode::Space => self.store.toggle_layout_simulation(),
                KeyCode::KeyF => self.camera.fit_to_bounds(self.store.get_bounds()),
                KeyCode::KeyR => self.store.reset_layout(),
                KeyCode::Escape => self.interaction.clear_selection(),
                KeyCode::Tab => self.interaction.cycle_neighbor(&self.store),

                // Relationship filters
                KeyCode::Digit1 => self.ui.toggle_filter_friends(),
                KeyCode::Digit2 => self.ui.toggle_filter_rivals(),
                KeyCode::Digit3 => self.ui.toggle_filter_strangers(),

                // View mode (projection) cycling
                KeyCode::KeyV => {
                    self.ui.projection_mode = self.ui.projection_mode.next();
                    self.ui.projection_mode_changed = true;
                }

                _ => {}
            }
        } else {
            match key {
                KeyCode::KeyW => self.frug.set_move_up(false),
                KeyCode::KeyS => self.frug.set_move_down(false),
                KeyCode::KeyA => self.frug.set_move_left(false),
                KeyCode::KeyD => self.frug.set_move_right(false),
                _ => {}
            }
        }
    }

    fn handle_mouse_button(&mut self, button: MouseButton, pressed: bool) {
        // Initialize audio on first user interaction (browser autoplay policy)
        if pressed && !self.audio_initialized {
            self.try_initialize_audio();
        }

        match button {
            MouseButton::Left if pressed => {
                let world_pos = self.camera.screen_to_world(self.interaction.cursor_pos);
                self.interaction.handle_click(&self.store, world_pos, self.interaction.shift_held);
            }
            MouseButton::Middle => {
                self.interaction.set_panning(pressed);
            }
            MouseButton::Right if pressed => {
                // Context menu or orbit (future)
            }
            _ => {}
        }
    }

    /// Try to initialize audio system (called on first user interaction)
    fn try_initialize_audio(&mut self) {
        if self.audio_initialized {
            return;
        }

        self.audio_initialized = true;
        log::info!("[Audio] Initializing audio on user interaction...");

        // Use spawn_local for async audio initialization
        spawn_local(async {
            // Initialize the audio bridge (creates AudioContext, etc.)
            #[cfg(target_arch = "wasm32")]
            {
                use crate::audio::{js_audio_initialize, js_audio_load_music, js_audio_play_music};

                // Initialize the audio system
                match js_audio_initialize().await {
                    Ok(result) => {
                        let success = result.as_bool().unwrap_or(false);
                        if success {
                            log::info!("[Audio] Audio system initialized successfully");

                            // Load the theme music
                            match js_audio_load_music("/music/theme.mid", "theme").await {
                                Ok(_) => {
                                    log::info!("[Audio] Theme music loaded");
                                    // Play the theme music with a fade-in
                                    js_audio_play_music("theme", 1000);
                                    log::info!("[Audio] Theme music playing");
                                }
                                Err(e) => {
                                    log::warn!("[Audio] Failed to load theme music: {:?}", e);
                                }
                            }
                        } else {
                            log::warn!("[Audio] Audio initialization returned false");
                        }
                    }
                    Err(e) => {
                        log::error!("[Audio] Failed to initialize audio: {:?}", e);
                    }
                }
            }
        });
    }

    fn handle_mouse_move(&mut self, x: f32, y: f32) {
        let delta = self.interaction.update_cursor(x, y);

        if self.interaction.is_panning {
            self.camera.handle_drag(delta);
        } else {
            // Update hover state
            let world_pos = self.camera.screen_to_world(glam::Vec2::new(x, y));
            self.interaction.update_hover(&self.store, world_pos);
        }
    }
}
