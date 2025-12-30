// Glow effect shader for UI effects
// Renders soft, animated glow effects in screen space

struct TimeUniform {
    time: f32,
    screen_width: f32,
    screen_height: f32,
    _padding: f32,
};

@group(0) @binding(0) var<uniform> time_data: TimeUniform;

struct VertexInput {
    // Per-vertex data (unit quad)
    @location(0) vertex_pos: vec2<f32>,
    // Per-instance data
    @location(1) instance_pos: vec2<f32>,
    @location(2) instance_size: vec2<f32>,
    @location(3) instance_color: vec4<f32>,
    @location(4) instance_params: vec4<f32>, // intensity, falloff, pulse_speed, _padding
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) local_uv: vec2<f32>,
    @location(1) color: vec4<f32>,
    @location(2) intensity: f32,
    @location(3) falloff: f32,
    @location(4) pulse_speed: f32,
};

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;

    // vertex_pos is in [0,1] range (unit quad)
    // Scale by instance size and offset by instance position
    let screen_pos = in.instance_pos + (in.vertex_pos - vec2(0.5, 0.5)) * in.instance_size;

    // Convert screen space to normalized device coordinates (NDC)
    // Screen space: (0,0) is top-left, positive Y is down
    // NDC: (-1,-1) is bottom-left, (1,1) is top-right
    let ndc_x = (screen_pos.x / time_data.screen_width) * 2.0 - 1.0;
    let ndc_y = 1.0 - (screen_pos.y / time_data.screen_height) * 2.0;

    out.clip_position = vec4<f32>(ndc_x, ndc_y, 0.0, 1.0);
    out.local_uv = in.vertex_pos; // Pass through [0,1] UV for fragment shader
    out.color = in.instance_color;
    out.intensity = in.instance_params.x;
    out.falloff = in.instance_params.y;
    out.pulse_speed = in.instance_params.z;

    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Calculate distance from center of the quad (center is at 0.5, 0.5)
    let center = vec2(0.5, 0.5);
    let dist = length(in.local_uv - center) * 2.0; // Normalize to [0, 1] at edges

    // Exponential falloff for soft glow effect
    let glow = exp(-dist * in.falloff) * in.intensity;

    // Pulsing effect (sinusoidal animation)
    var pulse = 1.0;
    if (in.pulse_speed > 0.0) {
        // Oscillate between 0.7 and 1.0 for subtle pulse
        pulse = 0.7 + 0.3 * (sin(time_data.time * in.pulse_speed) * 0.5 + 0.5);
    }

    // Compute final alpha with glow and pulse
    let final_alpha = in.color.a * glow * pulse;

    // Discard fully transparent pixels for performance
    if (final_alpha < 0.001) {
        discard;
    }

    // Output with premultiplied alpha for correct blending
    return vec4<f32>(in.color.rgb * final_alpha, final_alpha);
}
