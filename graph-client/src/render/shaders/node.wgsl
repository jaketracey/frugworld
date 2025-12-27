// Node vertex shader

struct CameraUniform {
    view_proj: mat4x4<f32>,
};

@group(0) @binding(0)
var<uniform> camera: CameraUniform;

struct VertexInput {
    @location(0) vertex_pos: vec2<f32>,
    @location(1) instance_pos: vec2<f32>,
    @location(2) size: f32,
    @location(3) color: vec4<f32>,
    @location(4) outline_color: vec4<f32>,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) outline_color: vec4<f32>,
    @location(2) local_pos: vec2<f32>,
};

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;

    // Scale vertex by node size and translate to instance position
    let world_pos = in.instance_pos + in.vertex_pos * in.size;

    out.clip_position = camera.view_proj * vec4<f32>(world_pos, 0.0, 1.0);
    out.color = in.color;
    out.outline_color = in.outline_color;
    out.local_pos = in.vertex_pos;

    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let dist = length(in.local_pos);

    // Discard pixels outside the circle
    if dist > 1.0 {
        discard;
    }

    // Antialiased edge
    let edge_width = 0.15;
    let outline_start = 0.7;

    if dist > outline_start {
        // Outline region
        let outline_t = smoothstep(outline_start, outline_start + edge_width, dist);
        let aa = smoothstep(1.0, 1.0 - edge_width, dist);
        return vec4<f32>(in.outline_color.rgb, in.outline_color.a * aa);
    } else {
        // Fill region
        let fill_edge = smoothstep(outline_start, outline_start - edge_width * 0.5, dist);
        return vec4<f32>(in.color.rgb, in.color.a * fill_edge + in.color.a * (1.0 - fill_edge));
    }
}
