//! UI effects rendering system
//!
//! Provides custom wgpu rendering for visual effects like glows, gradients,
//! and animated elements that render alongside egui.

mod glow;

pub use glow::*;

use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

/// Maximum number of glow effects that can be rendered at once
const MAX_GLOWS: usize = 256;

/// Time uniform data passed to shaders
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct TimeUniform {
    /// Current animation time in seconds
    pub time: f32,
    /// Screen width in pixels
    pub screen_width: f32,
    /// Screen height in pixels
    pub screen_height: f32,
    /// Padding for alignment
    pub _padding: f32,
}

impl Default for TimeUniform {
    fn default() -> Self {
        Self {
            time: 0.0,
            screen_width: 1920.0,
            screen_height: 1080.0,
            _padding: 0.0,
        }
    }
}

/// Unit quad vertex for glow rendering
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
struct QuadVertex {
    position: [f32; 2],
}

/// UI effects renderer handling glows and other screen-space effects
pub struct UIEffectsRenderer {
    /// Glow effect render pipeline
    glow_pipeline: wgpu::RenderPipeline,
    /// Instance buffer for glow effects
    glow_instance_buffer: wgpu::Buffer,
    /// Time uniform data
    time_uniform: TimeUniform,
    /// Time uniform GPU buffer
    time_buffer: wgpu::Buffer,
    /// Time uniform bind group
    time_bind_group: wgpu::BindGroup,
    /// Quad vertex buffer (shared geometry for all glows)
    quad_vertex_buffer: wgpu::Buffer,
    /// Active glow effects to render this frame
    active_glows: Vec<GlowEffect>,
}

impl UIEffectsRenderer {
    /// Create a new UI effects renderer
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        // Create unit quad vertices (two triangles forming a square)
        // Vertices are in [0,1] range, will be scaled by instance size
        let quad_vertices: [QuadVertex; 6] = [
            // First triangle (top-left, bottom-left, bottom-right)
            QuadVertex { position: [0.0, 0.0] },
            QuadVertex { position: [0.0, 1.0] },
            QuadVertex { position: [1.0, 1.0] },
            // Second triangle (top-left, bottom-right, top-right)
            QuadVertex { position: [0.0, 0.0] },
            QuadVertex { position: [1.0, 1.0] },
            QuadVertex { position: [1.0, 0.0] },
        ];

        let quad_vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Glow Quad Vertex Buffer"),
            contents: bytemuck::cast_slice(&quad_vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });

        // Create glow instance buffer
        let glow_instance_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Glow Instance Buffer"),
            size: (std::mem::size_of::<GlowInstance>() * MAX_GLOWS) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Create time uniform buffer
        let time_uniform = TimeUniform::default();
        let time_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Time Uniform Buffer"),
            contents: bytemuck::cast_slice(&[time_uniform]),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        // Create time bind group layout
        let time_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Time Bind Group Layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
            });

        // Create time bind group
        let time_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Time Bind Group"),
            layout: &time_bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: time_buffer.as_entire_binding(),
            }],
        });

        // Create glow shader
        let glow_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Glow Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/glow.wgsl").into()),
        });

        // Create glow pipeline layout
        let glow_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Glow Pipeline Layout"),
                bind_group_layouts: &[&time_bind_group_layout],
                push_constant_ranges: &[],
            });

        // Create glow render pipeline
        let glow_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Glow Pipeline"),
            layout: Some(&glow_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &glow_shader,
                entry_point: Some("vs_main"),
                buffers: &[
                    // Vertex buffer (unit quad)
                    wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<QuadVertex>() as u64,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &[wgpu::VertexAttribute {
                            offset: 0,
                            shader_location: 0,
                            format: wgpu::VertexFormat::Float32x2, // vertex_pos
                        }],
                    },
                    // Instance buffer (glow instances)
                    wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<GlowInstance>() as u64,
                        step_mode: wgpu::VertexStepMode::Instance,
                        attributes: &[
                            wgpu::VertexAttribute {
                                offset: 0,
                                shader_location: 1,
                                format: wgpu::VertexFormat::Float32x2, // position
                            },
                            wgpu::VertexAttribute {
                                offset: 8,
                                shader_location: 2,
                                format: wgpu::VertexFormat::Float32x2, // size
                            },
                            wgpu::VertexAttribute {
                                offset: 16,
                                shader_location: 3,
                                format: wgpu::VertexFormat::Float32x4, // color
                            },
                            wgpu::VertexAttribute {
                                offset: 32,
                                shader_location: 4,
                                format: wgpu::VertexFormat::Float32x4, // params (intensity, falloff, pulse_speed, padding)
                            },
                        ],
                    },
                ],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &glow_shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    // Use premultiplied alpha blending for correct glow compositing
                    blend: Some(wgpu::BlendState {
                        color: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::One,
                            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                            operation: wgpu::BlendOperation::Add,
                        },
                        alpha: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::One,
                            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                            operation: wgpu::BlendOperation::Add,
                        },
                    }),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None, // No culling for screen-space quads
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        Self {
            glow_pipeline,
            glow_instance_buffer,
            time_uniform,
            time_buffer,
            time_bind_group,
            quad_vertex_buffer,
            active_glows: Vec::with_capacity(MAX_GLOWS),
        }
    }

    /// Update time uniform and prepare for rendering
    pub fn update(&mut self, dt: f32, queue: &wgpu::Queue, screen_width: f32, screen_height: f32) {
        self.time_uniform.time += dt;
        self.time_uniform.screen_width = screen_width;
        self.time_uniform.screen_height = screen_height;

        queue.write_buffer(
            &self.time_buffer,
            0,
            bytemuck::cast_slice(&[self.time_uniform]),
        );
    }

    /// Add a glow effect to be rendered this frame
    pub fn add_glow(&mut self, glow: GlowEffect) {
        if self.active_glows.len() < MAX_GLOWS {
            self.active_glows.push(glow);
        }
    }

    /// Clear all active glow effects
    pub fn clear_glows(&mut self) {
        self.active_glows.clear();
    }

    /// Render all active glow effects
    pub fn render<'a>(
        &'a self,
        render_pass: &mut wgpu::RenderPass<'a>,
        queue: &wgpu::Queue,
    ) {
        if self.active_glows.is_empty() {
            return;
        }

        // Convert glow effects to GPU instances
        let instances: Vec<GlowInstance> = self
            .active_glows
            .iter()
            .map(GlowInstance::from_effect)
            .collect();

        // Update instance buffer
        queue.write_buffer(
            &self.glow_instance_buffer,
            0,
            bytemuck::cast_slice(&instances),
        );

        // Render glows
        render_pass.set_pipeline(&self.glow_pipeline);
        render_pass.set_bind_group(0, &self.time_bind_group, &[]);
        render_pass.set_vertex_buffer(0, self.quad_vertex_buffer.slice(..));
        render_pass.set_vertex_buffer(1, self.glow_instance_buffer.slice(..));
        render_pass.draw(0..6, 0..instances.len() as u32);
    }

    /// Get the number of active glow effects
    pub fn glow_count(&self) -> usize {
        self.active_glows.len()
    }

    /// Get current animation time
    pub fn time(&self) -> f32 {
        self.time_uniform.time
    }
}
