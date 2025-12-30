//! Glow effect types and instances

use bytemuck::{Pod, Zeroable};

/// GPU-side instance data for a single glow effect
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct GlowInstance {
    /// Screen-space center position
    pub position: [f32; 2],
    /// Width, height in screen pixels
    pub size: [f32; 2],
    /// RGBA color
    pub color: [f32; 4],
    /// Glow strength (intensity)
    pub intensity: f32,
    /// How quickly glow fades from center (falloff)
    pub falloff: f32,
    /// Pulse animation speed (0 = static, >0 = pulsing)
    pub pulse_speed: f32,
    /// Padding for alignment
    pub _padding: f32,
}

impl GlowInstance {
    /// Create a new glow instance from effect parameters
    pub fn from_effect(effect: &GlowEffect) -> Self {
        Self {
            position: effect.position,
            size: effect.size,
            color: effect.color,
            intensity: effect.intensity,
            falloff: effect.falloff,
            pulse_speed: effect.pulse_speed,
            _padding: 0.0,
        }
    }
}

/// High-level glow effect configuration
#[derive(Clone, Debug)]
pub struct GlowEffect {
    /// Screen-space center position [x, y]
    pub position: [f32; 2],
    /// Width, height in screen pixels
    pub size: [f32; 2],
    /// RGBA color (0.0 to 1.0)
    pub color: [f32; 4],
    /// Glow strength (typically 0.5 to 3.0)
    pub intensity: f32,
    /// How quickly glow fades (higher = sharper falloff)
    pub falloff: f32,
    /// Pulse animation speed (0 = static, 2.0 = moderate pulse)
    pub pulse_speed: f32,
}

impl GlowEffect {
    /// Create a new glow effect with default parameters
    pub fn new(position: [f32; 2], size: [f32; 2], color: [f32; 4]) -> Self {
        Self {
            position,
            size,
            color,
            intensity: 1.0,
            falloff: 3.0,
            pulse_speed: 0.0,
        }
    }

    /// Create a selection glow effect (gold, pulsing)
    pub fn selection(screen_x: f32, screen_y: f32, size: f32) -> Self {
        Self {
            position: [screen_x, screen_y],
            size: [size, size],
            color: [1.0, 0.76, 0.03, 0.5], // Gold
            intensity: 1.5,
            falloff: 3.0,
            pulse_speed: 2.0,
        }
    }

    /// Create a hover glow effect (soft blue, static)
    pub fn hover(screen_x: f32, screen_y: f32, size: f32) -> Self {
        Self {
            position: [screen_x, screen_y],
            size: [size, size],
            color: [0.3, 0.6, 1.0, 0.3], // Soft blue
            intensity: 1.0,
            falloff: 4.0,
            pulse_speed: 0.0,
        }
    }

    /// Create a highlight glow effect (emerald green)
    pub fn highlight(screen_x: f32, screen_y: f32, size: f32) -> Self {
        Self {
            position: [screen_x, screen_y],
            size: [size, size],
            color: [0.18, 0.8, 0.44, 0.4], // Emerald
            intensity: 1.2,
            falloff: 3.5,
            pulse_speed: 1.5,
        }
    }

    /// Create an alert glow effect (ruby red, fast pulse)
    pub fn alert(screen_x: f32, screen_y: f32, size: f32) -> Self {
        Self {
            position: [screen_x, screen_y],
            size: [size, size],
            color: [0.9, 0.3, 0.24, 0.5], // Ruby
            intensity: 1.8,
            falloff: 2.5,
            pulse_speed: 4.0,
        }
    }

    /// Set intensity and return self (builder pattern)
    pub fn with_intensity(mut self, intensity: f32) -> Self {
        self.intensity = intensity;
        self
    }

    /// Set falloff and return self (builder pattern)
    pub fn with_falloff(mut self, falloff: f32) -> Self {
        self.falloff = falloff;
        self
    }

    /// Set pulse speed and return self (builder pattern)
    pub fn with_pulse(mut self, pulse_speed: f32) -> Self {
        self.pulse_speed = pulse_speed;
        self
    }
}

impl Default for GlowEffect {
    fn default() -> Self {
        Self {
            position: [0.0, 0.0],
            size: [100.0, 100.0],
            color: [1.0, 1.0, 1.0, 0.5],
            intensity: 1.0,
            falloff: 3.0,
            pulse_speed: 0.0,
        }
    }
}
