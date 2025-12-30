//! Edge rendering for relationship visualization

use crate::graph::GraphStore;
use crate::input::GraphInteraction;

/// Maximum number of edges to render at once
const MAX_EDGES: usize = 1000;

/// Line segment vertex
#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
struct EdgeVertex {
    position: [f32; 3],  // x, y, z for 2.5D rendering
    color: [f32; 4],
}

/// Edge renderer using line segments
pub struct EdgeRenderer {
    pipeline: wgpu::RenderPipeline,
    vertex_buffer: wgpu::Buffer,
    vertex_count: u32,
}

impl EdgeRenderer {
    pub fn new(
        device: &wgpu::Device,
        camera_bind_group_layout: &wgpu::BindGroupLayout,
        format: wgpu::TextureFormat,
        depth_format: Option<wgpu::TextureFormat>,
    ) -> Self {
        // Create vertex buffer
        let vertex_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Edge Vertex Buffer"),
            size: (std::mem::size_of::<EdgeVertex>() * MAX_EDGES * 2) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Create shader
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Edge Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/edge.wgsl").into()),
        });

        // Create pipeline layout
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Edge Pipeline Layout"),
            bind_group_layouts: &[camera_bind_group_layout],
            push_constant_ranges: &[],
        });

        // Create pipeline
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Edge Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<EdgeVertex>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &[
                        wgpu::VertexAttribute {
                            offset: 0,
                            shader_location: 0,
                            format: wgpu::VertexFormat::Float32x3, // position (x, y, z)
                        },
                        wgpu::VertexAttribute {
                            offset: 12, // 3 floats * 4 bytes
                            shader_location: 1,
                            format: wgpu::VertexFormat::Float32x4, // color
                        },
                    ],
                }],
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
                topology: wgpu::PrimitiveTopology::LineList,
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
            vertex_count: 0,
        }
    }

    /// Render edges for selected/hovered nodes
    pub fn render<'a>(
        &'a mut self,
        render_pass: &mut wgpu::RenderPass<'a>,
        queue: &wgpu::Queue,
        camera_bind_group: &'a wgpu::BindGroup,
        store: &GraphStore,
        interaction: &GraphInteraction,
    ) {
        let mut vertices = Vec::new();

        // Collect nodes to show edges for
        let mut nodes_to_show: Vec<u64> = interaction.get_selected().iter().copied().collect();
        if let Some(hovered) = interaction.hovered_node {
            if !nodes_to_show.contains(&hovered) {
                nodes_to_show.push(hovered);
            }
        }

        // Build edge vertices
        for node_id in nodes_to_show {
            let edges = store.get_node_edges(node_id);

            for edge in edges.iter().take(MAX_EDGES / 2) {
                let source_node = store.nodes.get(&edge.source_id);
                let target_node = store.nodes.get(&edge.target_id);

                if let (Some(src_node), Some(tgt_node)) = (source_node, target_node) {
                    let color = edge.get_color();

                    // Get z-positions for source and target nodes
                    let src_z = src_node.get_z_position();
                    let tgt_z = tgt_node.get_z_position();

                    vertices.push(EdgeVertex {
                        position: [src_node.visual_position.x, src_node.visual_position.y, src_z],
                        color,
                    });
                    vertices.push(EdgeVertex {
                        position: [tgt_node.visual_position.x, tgt_node.visual_position.y, tgt_z],
                        color,
                    });
                }
            }
        }

        if vertices.is_empty() {
            self.vertex_count = 0;
            return;
        }

        // Limit to max
        let vertices = &vertices[..vertices.len().min(MAX_EDGES * 2)];
        self.vertex_count = vertices.len() as u32;

        // Update buffer
        queue.write_buffer(&self.vertex_buffer, 0, bytemuck::cast_slice(vertices));

        // Render
        render_pass.set_pipeline(&self.pipeline);
        render_pass.set_bind_group(0, camera_bind_group, &[]);
        render_pass.set_vertex_buffer(0, self.vertex_buffer.slice(..));
        render_pass.draw(0..self.vertex_count, 0..1);
    }
}
