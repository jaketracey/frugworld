//! Main rendering pipeline with wgpu

use std::sync::Arc;
use wgpu::util::DeviceExt;
use winit::event::WindowEvent;
use winit::window::Window;

use crate::graph::GraphStore;
use crate::input::{Camera2D, GraphInteraction};
use crate::player::FrugPlayer;
use crate::ui::GraphUI;

use super::nodes::NodeRenderer;
use super::edges::EdgeRenderer;
use super::ui_effects::{UIEffectsRenderer, GlowEffect};

/// Uniform buffer for camera data
#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
struct CameraUniform {
    view_proj: [[f32; 4]; 4],
}

/// Depth texture format used for 2.5D rendering
pub const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;

/// Create a depth texture and view for the given size
fn create_depth_texture(device: &wgpu::Device, width: u32, height: u32) -> (wgpu::Texture, wgpu::TextureView) {
    let depth_texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Depth Texture"),
        size: wgpu::Extent3d {
            width: width.max(1),
            height: height.max(1),
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: DEPTH_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    let depth_view = depth_texture.create_view(&wgpu::TextureViewDescriptor::default());
    (depth_texture, depth_view)
}

/// Main graph renderer
pub struct GraphRenderer {
    // Core wgpu state
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    size: (u32, u32),

    /// Whether surface is configured with valid dimensions (needed for WASM)
    is_configured: bool,

    // Camera uniform
    camera_uniform: CameraUniform,
    camera_buffer: wgpu::Buffer,
    camera_bind_group: wgpu::BindGroup,

    // Depth buffer for 2.5D rendering
    depth_texture: wgpu::Texture,
    depth_view: wgpu::TextureView,

    // Renderers
    node_renderer: NodeRenderer,
    edge_renderer: EdgeRenderer,
    ui_effects: UIEffectsRenderer,

    /// Animation time accumulator
    animation_time: f32,

    // egui integration
    egui_state: egui_winit::State,
    egui_renderer: egui_wgpu::Renderer,
    egui_ctx: egui::Context,

    // Window reference
    window: Arc<Window>,

    // Debug: track first frame for one-time logging
    #[cfg(debug_assertions)]
    first_egui_render: bool,
}

impl GraphRenderer {
    pub async fn new(window: Arc<Window>) -> Result<Self, String> {
        let size = window.inner_size();
        let size = (size.width.max(1), size.height.max(1));
        log::info!("Creating renderer with window size: {}x{}", size.0, size.1);

        // Create wgpu instance - use all backends, wgpu 27 fixed Chrome 135+ WebGPU compatibility
        log::info!("Creating wgpu instance...");
        let backends = wgpu::Backends::all();

        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends,
            ..Default::default()
        });

        // Create surface
        log::info!("Creating surface...");
        let surface = instance
            .create_surface(window.clone())
            .map_err(|e| format!("Failed to create surface: {}", e))?;
        log::info!("Surface created");

        // Request adapter
        log::info!("Requesting adapter...");
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .map_err(|e| format!("Failed to find adapter: {:?}", e))?;
        log::info!("Adapter acquired: {:?}", adapter.get_info());

        // Create device and queue
        log::info!("Creating device...");

        // Use the adapter's limits to avoid requesting unsupported limits
        let adapter_limits = adapter.limits();
        log::info!("Adapter limits: {:?}", adapter_limits);

        let (device, queue): (wgpu::Device, wgpu::Queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default())
            .await
            .map_err(|e| format!("Failed to create device: {}", e))?;
        log::info!("Device and queue created");

        // Configure surface
        let surface_caps = surface.get_capabilities(&adapter);
        let surface_format = surface_caps
            .formats
            .iter()
            .find(|f| f.is_srgb())
            .copied()
            .unwrap_or(surface_caps.formats[0]);

        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format: surface_format,
            width: size.0.max(1),
            height: size.1.max(1),
            present_mode: wgpu::PresentMode::AutoVsync,
            alpha_mode: surface_caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };

        // Only configure surface if we have valid dimensions (> 1x1)
        // On WASM, window.inner_size() returns 1x1 until first resize event
        let is_configured = size.0 > 1 && size.1 > 1;
        if is_configured {
            surface.configure(&device, &config);
            log::info!("Surface configured with {}x{}", size.0, size.1);
        } else {
            log::info!("Deferring surface configuration until resize (current: {}x{})", size.0, size.1);
        }

        // Create camera uniform buffer
        let camera_uniform = CameraUniform {
            view_proj: glam::Mat4::IDENTITY.to_cols_array_2d(),
        };

        let camera_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Camera Buffer"),
            contents: bytemuck::cast_slice(&[camera_uniform]),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let camera_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Camera Bind Group Layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
            });

        let camera_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Camera Bind Group"),
            layout: &camera_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: camera_buffer.as_entire_binding(),
            }],
        });

        // Create depth texture for 2.5D rendering
        let (depth_texture, depth_view) = create_depth_texture(&device, size.0, size.1);

        // Create sub-renderers with depth stencil support
        let node_renderer = NodeRenderer::new(&device, &camera_bind_group_layout, surface_format, Some(DEPTH_FORMAT));
        let edge_renderer = EdgeRenderer::new(&device, &camera_bind_group_layout, surface_format, Some(DEPTH_FORMAT));
        let ui_effects = UIEffectsRenderer::new(&device, surface_format);

        // Initialize egui
        let egui_ctx = egui::Context::default();

        // Set up default fonts (important for WASM)
        let fonts = egui::FontDefinitions::default();
        egui_ctx.set_fonts(fonts);

        // Set a modern, rich color palette style
        let mut style = egui::Style::default();

        // Rich color palette with deep backgrounds and jewel-tone accents
        let bg_deep = egui::Color32::from_rgb(26, 29, 35);           // #1a1d23 - Deep background
        let bg_panel = egui::Color32::from_rgb(37, 42, 51);          // #252a33 - Panel background
        let bg_hover = egui::Color32::from_rgb(47, 54, 64);          // #2f3640 - Hover state
        let bg_active = egui::Color32::from_rgb(57, 64, 74);         // Active state
        let accent_gold = egui::Color32::from_rgb(255, 193, 7);      // #ffc107 - Primary accent
        let accent_emerald = egui::Color32::from_rgb(46, 204, 113);  // #2ecc71 - Success/positive
        let accent_ruby = egui::Color32::from_rgb(231, 76, 60);      // #e74c3c - Alert/negative
        let accent_sapphire = egui::Color32::from_rgb(52, 152, 219); // #3498db - Info/links
        let text_primary = egui::Color32::from_rgb(236, 240, 241);   // #ecf0f1 - Primary text
        let text_secondary = egui::Color32::from_rgb(149, 165, 166); // #95a5a6 - Secondary text

        // Panel backgrounds
        style.visuals.window_fill = bg_panel;
        style.visuals.panel_fill = bg_panel;
        style.visuals.extreme_bg_color = bg_deep;

        // Widget styling - non-interactive elements
        style.visuals.widgets.noninteractive.bg_fill = bg_panel;
        style.visuals.widgets.noninteractive.fg_stroke = egui::Stroke::new(1.0, text_secondary);

        // Widget styling - inactive (clickable but not interacted with)
        style.visuals.widgets.inactive.bg_fill = bg_panel;
        style.visuals.widgets.inactive.fg_stroke = egui::Stroke::new(1.0, text_primary);
        style.visuals.widgets.inactive.weak_bg_fill = bg_panel;

        // Widget styling - hovered
        style.visuals.widgets.hovered.bg_fill = bg_hover;
        style.visuals.widgets.hovered.fg_stroke = egui::Stroke::new(1.5, accent_gold);
        style.visuals.widgets.hovered.weak_bg_fill = bg_hover;

        // Widget styling - active (being clicked/dragged)
        style.visuals.widgets.active.bg_fill = bg_active;
        style.visuals.widgets.active.fg_stroke = egui::Stroke::new(2.0, accent_gold);
        style.visuals.widgets.active.weak_bg_fill = bg_active;

        // Widget styling - open (expanded menus, etc.)
        style.visuals.widgets.open.bg_fill = bg_active;
        style.visuals.widgets.open.fg_stroke = egui::Stroke::new(1.0, accent_gold);

        // Selection highlighting
        style.visuals.selection.bg_fill = egui::Color32::from_rgba_unmultiplied(255, 193, 7, 60);
        style.visuals.selection.stroke = egui::Stroke::new(1.0, accent_gold);

        // Hyperlinks use sapphire blue
        style.visuals.hyperlink_color = accent_sapphire;

        // Warn color (for warnings, errors)
        style.visuals.warn_fg_color = accent_ruby;

        // Rounded corners for modern feel
        let radius = egui::CornerRadius::same(6);
        style.visuals.widgets.noninteractive.corner_radius = radius;
        style.visuals.widgets.inactive.corner_radius = radius;
        style.visuals.widgets.hovered.corner_radius = radius;
        style.visuals.widgets.active.corner_radius = radius;

        // Spacing adjustments for comfortable UI
        style.spacing.item_spacing = egui::vec2(8.0, 6.0);
        style.spacing.button_padding = egui::vec2(10.0, 5.0);
        style.spacing.window_margin = egui::Margin::same(12);

        // Store accent colors for use elsewhere (logged for debugging)
        log::debug!(
            "UI accent colors: gold={:?}, emerald={:?}, ruby={:?}, sapphire={:?}",
            accent_gold, accent_emerald, accent_ruby, accent_sapphire
        );

        egui_ctx.set_style(style);

        log::info!("egui context initialized");

        let viewport_id = egui_ctx.viewport_id();

        // Use the window's native scale factor, falling back to 1.0 for WASM if unavailable
        let native_pixels_per_point = window.scale_factor() as f32;
        log::info!("native_pixels_per_point: {}", native_pixels_per_point);

        let egui_state = egui_winit::State::new(
            egui_ctx.clone(),
            viewport_id,
            &window,
            Some(native_pixels_per_point),
            None,
            None, // max_texture_side - will be set after device limits are known
        );

        let egui_renderer = egui_wgpu::Renderer::new(
            &device,
            surface_format,
            egui_wgpu::RendererOptions::default(),
        );

        log::info!("Renderer initialized: {}x{}", size.0, size.1);

        Ok(Self {
            surface,
            device,
            queue,
            config,
            size,
            is_configured,
            camera_uniform,
            camera_buffer,
            camera_bind_group,
            depth_texture,
            depth_view,
            node_renderer,
            edge_renderer,
            ui_effects,
            animation_time: 0.0,
            egui_state,
            egui_renderer,
            egui_ctx,
            window,
            #[cfg(debug_assertions)]
            first_egui_render: true,
        })
    }

    /// Handle window resize - also handles initial configuration on WASM
    pub fn resize(&mut self, width: u32, height: u32) {
        if width > 1 && height > 1 {
            self.size = (width, height);
            self.config.width = width;
            self.config.height = height;
            self.surface.configure(&self.device, &self.config);

            // Recreate depth texture with new size
            let (depth_texture, depth_view) = create_depth_texture(&self.device, width, height);
            self.depth_texture = depth_texture;
            self.depth_view = depth_view;

            if !self.is_configured {
                log::info!("Surface configured on resize: {}x{}", width, height);
            } else {
                log::debug!("Resized to {}x{}", width, height);
            }
            self.is_configured = true;
        }
    }

    /// Check if surface is configured and ready for rendering
    #[allow(dead_code)]
    pub fn is_configured(&self) -> bool {
        self.is_configured
    }

    /// Handle window event, returns true if event was consumed by egui
    pub fn handle_event(&mut self, event: &WindowEvent) -> bool {
        let response = self.egui_state.on_window_event(&self.window, event);
        response.consumed
    }

    /// Render a frame
    pub fn render(
        &mut self,
        store: &GraphStore,
        visible_nodes: &[u64],
        camera: &Camera2D,
        interaction: &GraphInteraction,
        frug: &FrugPlayer,
        fps: f32,
        dt: f32,
        ui: &mut GraphUI,
    ) {
        // Don't render until surface is configured (WASM needs first resize event)
        if !self.is_configured {
            return;
        }

        // Update animation time
        self.animation_time += dt;

        // Update UI effects time uniform
        self.ui_effects.update(
            dt,
            &self.queue,
            self.size.0 as f32,
            self.size.1 as f32,
        );

        // Clear previous frame's glow effects
        self.ui_effects.clear_glows();

        // Add selection glow effects for selected nodes
        for &node_id in interaction.get_selected() {
            if let Some(node) = store.nodes.get(&node_id) {
                // Convert world position to screen position
                let screen_pos = camera.world_to_screen(node.visual_position);
                // Scale the glow size based on camera zoom
                let glow_size = node.visual_size * camera.zoom * 3.0;

                self.ui_effects.add_glow(GlowEffect::selection(
                    screen_pos.x,
                    screen_pos.y,
                    glow_size,
                ));
            }
        }

        // Add hover glow effect if hovering a non-selected node
        if let Some(hovered_id) = interaction.hovered_node {
            if !interaction.is_selected(hovered_id) {
                if let Some(node) = store.nodes.get(&hovered_id) {
                    let screen_pos = camera.world_to_screen(node.visual_position);
                    let glow_size = node.visual_size * camera.zoom * 2.5;

                    self.ui_effects.add_glow(GlowEffect::hover(
                        screen_pos.x,
                        screen_pos.y,
                        glow_size,
                    ));
                }
            }
        }

        // Update camera uniform
        self.camera_uniform.view_proj = camera.get_view_projection().to_cols_array_2d();
        self.queue.write_buffer(
            &self.camera_buffer,
            0,
            bytemuck::cast_slice(&[self.camera_uniform]),
        );

        // Get frame
        let frame = match self.surface.get_current_texture() {
            Ok(frame) => frame,
            Err(wgpu::SurfaceError::Lost) => {
                self.resize(self.size.0, self.size.1);
                return;
            }
            Err(wgpu::SurfaceError::OutOfMemory) => {
                log::error!("Out of memory");
                return;
            }
            Err(e) => {
                log::warn!("Surface error: {:?}", e);
                return;
            }
        };

        let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());

        // Create command encoder
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Render Encoder"),
        });

        // Run egui frame
        let egui_input = self.egui_state.take_egui_input(&self.window);

        // Log screen_rect - warn if None as this will prevent UI from rendering
        if let Some(screen_rect) = egui_input.screen_rect {
            log::trace!("egui screen_rect: {:?}", screen_rect);
        } else {
            log::warn!("egui screen_rect is None - UI will not render correctly");
        }

        self.egui_ctx.begin_pass(egui_input);
        ui.render_with_frug(
            &self.egui_ctx,
            store,
            interaction,
            Some((frug.position, frug.get_chunk())),
            fps,
        );
        let egui_output = self.egui_ctx.end_pass();

        // Handle egui platform output
        self.egui_state.handle_platform_output(&self.window, egui_output.platform_output);

        // Graph render pass with depth buffer for 2.5D rendering
        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Main Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.08,
                            g: 0.07,
                            b: 0.06,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                    depth_slice: None,
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0), // Clear to far plane
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            // Render edges first (behind nodes)
            self.edge_renderer.render(
                &mut render_pass,
                &self.queue,
                &self.camera_bind_group,
                store,
                interaction,
            );

            // Render nodes (including frug)
            self.node_renderer.render(
                &mut render_pass,
                &self.queue,
                &self.camera_bind_group,
                store,
                visible_nodes,
                interaction,
                frug,
            );
        }

        // UI effects render pass (glows, etc.) - renders on top of graph but below egui
        {
            let mut effects_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("UI Effects Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load, // Preserve graph rendering
                        store: wgpu::StoreOp::Store,
                    },
                    depth_slice: None,
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            self.ui_effects.render(&mut effects_pass, &self.queue);
        }

        // Submit graph and effects rendering
        self.queue.submit(std::iter::once(encoder.finish()));

        // egui rendering (in separate encoder to avoid lifetime issues)
        // Use a sensible default for pixels_per_point if not set
        let pixels_per_point = if egui_output.pixels_per_point > 0.0 {
            egui_output.pixels_per_point
        } else {
            1.0
        };

        // Track shapes count for debugging
        let shapes_count = egui_output.shapes.len();

        let clipped_primitives = self.egui_ctx.tessellate(
            egui_output.shapes,
            pixels_per_point,
        );

        // Warn if shapes were generated but all got clipped - indicates rendering problem
        if clipped_primitives.is_empty() && shapes_count > 0 {
            log::warn!(
                "egui: {} shapes generated but 0 clipped_primitives (pixels_per_point: {}) - UI may be clipped",
                shapes_count,
                pixels_per_point
            );
        }

        // Log first successful egui render with primitives
        #[cfg(debug_assertions)]
        if self.first_egui_render && !clipped_primitives.is_empty() {
            log::info!(
                "egui first render: {} shapes -> {} primitives, screen: {}x{}, ppp: {}",
                shapes_count,
                clipped_primitives.len(),
                self.size.0,
                self.size.1,
                pixels_per_point
            );
            self.first_egui_render = false;
        }

        let screen_descriptor = egui_wgpu::ScreenDescriptor {
            size_in_pixels: [self.size.0, self.size.1],
            pixels_per_point,
        };

        // Update egui textures
        for (id, image_delta) in &egui_output.textures_delta.set {
            self.egui_renderer.update_texture(&self.device, &self.queue, *id, image_delta);
        }

        // Create separate encoder for egui
        let mut egui_encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("egui Encoder"),
        });

        // Update egui buffers - this returns any command buffers from paint callbacks
        let user_cmd_bufs = self.egui_renderer.update_buffers(
            &self.device,
            &self.queue,
            &mut egui_encoder,
            &clipped_primitives,
            &screen_descriptor,
        );

        // Render egui
        {
            let egui_pass = egui_encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("egui Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load, // Preserve graph rendering
                        store: wgpu::StoreOp::Store,
                    },
                    depth_slice: None,
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            // egui-wgpu 0.33 requires RenderPass<'static>, so we must forget the lifetime
            // This makes encoder operations a runtime error instead of compile-time
            let mut egui_pass = egui_pass.forget_lifetime();
            self.egui_renderer.render(&mut egui_pass, &clipped_primitives, &screen_descriptor);
        }

        // Submit egui rendering along with any user command buffers from callbacks
        let mut cmd_bufs: Vec<wgpu::CommandBuffer> = user_cmd_bufs;
        cmd_bufs.push(egui_encoder.finish());
        self.queue.submit(cmd_bufs);

        // Free egui textures marked for deletion
        for id in &egui_output.textures_delta.free {
            self.egui_renderer.free_texture(id);
        }

        frame.present();
    }
}
