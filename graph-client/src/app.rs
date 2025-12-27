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

use crate::connection::GraphConnection;
use crate::graph::GraphStore;
use crate::input::{Camera2D, GraphInteraction};
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

    // UI
    ui: GraphUI,

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
            ui,
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
        // Update camera
        self.camera.update(dt);

        // Process SpacetimeDB updates
        self.connection.poll_updates(&mut self.store);

        // Update layout if needed
        self.store.update_layout(dt, self.camera.zoom);

        // Update spatial index if nodes moved
        if self.store.layout_dirty {
            self.store.rebuild_spatial_index();
        }
    }

    /// Render a frame
    fn render(&mut self) {
        if let Some(renderer) = &mut self.renderer {
            // Get visible nodes based on camera view
            let view_bounds = self.camera.get_view_bounds();
            let visible_nodes = self.store.get_visible_nodes(&view_bounds);

            // Render the graph
            renderer.render(
                &self.store,
                &visible_nodes,
                &self.camera,
                &self.interaction,
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
                self.camera.set_viewport_size(size.width as f32, size.height as f32);
            }

            WindowEvent::RedrawRequested => {
                // Check if async renderer is ready
                if self.renderer.is_none() {
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

                self.update(1.0 / 60.0); // Fixed timestep for now
                self.render();

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
                self.handle_mouse_move(position.x as f32, position.y as f32);
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
                // Camera movement
                KeyCode::KeyW => self.camera.set_move_up(true),
                KeyCode::KeyS => self.camera.set_move_down(true),
                KeyCode::KeyA => self.camera.set_move_left(true),
                KeyCode::KeyD => self.camera.set_move_right(true),

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

                _ => {}
            }
        } else {
            match key {
                KeyCode::KeyW => self.camera.set_move_up(false),
                KeyCode::KeyS => self.camera.set_move_down(false),
                KeyCode::KeyA => self.camera.set_move_left(false),
                KeyCode::KeyD => self.camera.set_move_right(false),
                _ => {}
            }
        }
    }

    fn handle_mouse_button(&mut self, button: MouseButton, pressed: bool) {
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
