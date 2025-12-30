//! GPU-instanced node rendering

use wgpu::util::DeviceExt;
use crate::graph::GraphStore;
use crate::input::GraphInteraction;
use crate::player::FrugPlayer;

/// Maximum number of nodes to render
const MAX_NODES: usize = 10000;

/// Circle vertex count
const CIRCLE_VERTICES: u32 = 32;

/// Instance data for a single node
#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
struct NodeInstance {
    position: [f32; 3],  // x, y, z for 2.5D rendering
    size: f32,
    color: [f32; 4],
    outline_color: [f32; 4],
}

/// Node renderer using GPU instancing
pub struct NodeRenderer {
    pipeline: wgpu::RenderPipeline,
    vertex_buffer: wgpu::Buffer,
    instance_buffer: wgpu::Buffer,
    #[allow(dead_code)]
    instance_count: u32,
}

impl NodeRenderer {
    pub fn new(
        device: &wgpu::Device,
        camera_bind_group_layout: &wgpu::BindGroupLayout,
        format: wgpu::TextureFormat,
        depth_format: Option<wgpu::TextureFormat>,
    ) -> Self {
        // Create circle vertices
        let vertices = Self::create_circle_vertices();
        let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Node Vertex Buffer"),
            contents: bytemuck::cast_slice(&vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });

        // Create instance buffer
        let instance_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Node Instance Buffer"),
            size: (std::mem::size_of::<NodeInstance>() * MAX_NODES) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Create shader
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Node Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/node.wgsl").into()),
        });

        // Create pipeline layout
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Node Pipeline Layout"),
            bind_group_layouts: &[camera_bind_group_layout],
            push_constant_ranges: &[],
        });

        // Create pipeline
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Node Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[
                    // Vertex buffer
                    wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<[f32; 2]>() as u64,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &[wgpu::VertexAttribute {
                            offset: 0,
                            shader_location: 0,
                            format: wgpu::VertexFormat::Float32x2,
                        }],
                    },
                    // Instance buffer
                    wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<NodeInstance>() as u64,
                        step_mode: wgpu::VertexStepMode::Instance,
                        attributes: &[
                            wgpu::VertexAttribute {
                                offset: 0,
                                shader_location: 1,
                                format: wgpu::VertexFormat::Float32x3, // position (x, y, z)
                            },
                            wgpu::VertexAttribute {
                                offset: 12, // 3 floats * 4 bytes
                                shader_location: 2,
                                format: wgpu::VertexFormat::Float32, // size
                            },
                            wgpu::VertexAttribute {
                                offset: 16, // position (12) + size (4)
                                shader_location: 3,
                                format: wgpu::VertexFormat::Float32x4, // color
                            },
                            wgpu::VertexAttribute {
                                offset: 32, // position (12) + size (4) + color (16)
                                shader_location: 4,
                                format: wgpu::VertexFormat::Float32x4, // outline_color
                            },
                        ],
                    },
                ],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
            },
            depth_stencil: depth_format.map(|format| wgpu::DepthStencilState {
                format,
                depth_write_enabled: true,
                depth_compare: wgpu::CompareFunction::Less,
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        Self {
            pipeline,
            vertex_buffer,
            instance_buffer,
            instance_count: 0,
        }
    }

    /// Create circle vertices for node rendering (TriangleList format)
    fn create_circle_vertices() -> Vec<[f32; 2]> {
        let mut vertices = Vec::new();
        let center = [0.0f32, 0.0f32];

        for i in 0..CIRCLE_VERTICES {
            let angle1 = (i as f32 / CIRCLE_VERTICES as f32) * std::f32::consts::TAU;
            let angle2 = ((i + 1) as f32 / CIRCLE_VERTICES as f32) * std::f32::consts::TAU;

            vertices.push(center);
            vertices.push([angle1.cos(), angle1.sin()]);
            vertices.push([angle2.cos(), angle2.sin()]);
        }

        vertices
    }

    /// Update instance buffer and render nodes
    pub fn render<'a>(
        &'a self,
        render_pass: &mut wgpu::RenderPass<'a>,
        queue: &wgpu::Queue,
        camera_bind_group: &'a wgpu::BindGroup,
        store: &GraphStore,
        visible_nodes: &[u64],
        interaction: &GraphInteraction,
        frug: &FrugPlayer,
    ) {
        // Build instance data (reserve +1 for frug)
        let mut instances = Vec::with_capacity((visible_nodes.len() + 1).min(MAX_NODES));

        for &node_id in visible_nodes.iter().take(MAX_NODES - 1) {
            if let Some(node) = store.nodes.get(&node_id) {
                let is_selected = interaction.is_selected(node_id);
                let is_hovered = interaction.is_hovered(node_id);

                let mut color = node.get_color();

                // Highlight selected/hovered nodes
                if is_selected {
                    color[0] = (color[0] * 1.3).min(1.0);
                    color[1] = (color[1] * 1.3).min(1.0);
                    color[2] = (color[2] * 1.3).min(1.0);
                }

                let outline_color = if is_selected {
                    [1.0, 1.0, 0.2, 1.0] // Yellow for selected
                } else if is_hovered {
                    [0.8, 0.8, 1.0, 1.0] // Light blue for hovered
                } else {
                    [0.0, 0.0, 0.0, 0.3] // Dark outline
                };

                let size = node.visual_size * if is_selected { 1.2 } else { 1.0 };

                // Get z-position for 2.5D rendering
                let z = node.get_z_position();

                instances.push(NodeInstance {
                    position: [node.visual_position.x, node.visual_position.y, z],
                    size,
                    color,
                    outline_color,
                });
            }
        }

        // Add frug as the last instance (renders on top with high z)
        // Frug is always at z=100 to be prominently visible
        instances.push(NodeInstance {
            position: [frug.visual_position.x, frug.visual_position.y, 100.0],
            size: frug.size,
            color: frug.get_color(),
            outline_color: frug.get_outline_color(),
        });

        if instances.is_empty() {
            return;
        }

        // Update buffer
        queue.write_buffer(&self.instance_buffer, 0, bytemuck::cast_slice(&instances));

        // Render
        render_pass.set_pipeline(&self.pipeline);
        render_pass.set_bind_group(0, camera_bind_group, &[]);
        render_pass.set_vertex_buffer(0, self.vertex_buffer.slice(..));
        render_pass.set_vertex_buffer(1, self.instance_buffer.slice(..));
        render_pass.draw(0..(CIRCLE_VERTICES * 3), 0..instances.len() as u32);
    }
}
