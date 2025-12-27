//! Frug player avatar - the player's representation in the graph world

use glam::Vec2;

/// Movement state tracking WASD input
#[derive(Debug, Clone, Default)]
pub struct MoveState {
    pub up: bool,
    pub down: bool,
    pub left: bool,
    pub right: bool,
}

impl MoveState {
    /// Get movement direction as normalized vector
    pub fn direction(&self) -> Vec2 {
        let mut dir = Vec2::ZERO;
        if self.up { dir.y -= 1.0; }
        if self.down { dir.y += 1.0; }
        if self.left { dir.x -= 1.0; }
        if self.right { dir.x += 1.0; }
        if dir.length_squared() > 0.0 {
            dir.normalize()
        } else {
            dir
        }
    }
}

/// Frug player avatar
#[derive(Debug, Clone)]
pub struct FrugPlayer {
    /// Current world position
    pub position: Vec2,

    /// Interpolated position for smooth rendering
    pub visual_position: Vec2,

    /// Current velocity
    pub velocity: Vec2,

    /// Current chunk coordinates
    pub current_chunk: (i32, i32),

    /// Visual size (larger than NPCs)
    pub size: f32,

    /// Movement input state
    pub move_state: MoveState,

    /// Movement parameters
    acceleration: f32,
    max_speed: f32,
    damping: f32,
}

impl Default for FrugPlayer {
    fn default() -> Self {
        Self::new()
    }
}

impl FrugPlayer {
    /// Create a new Frug player at origin
    pub fn new() -> Self {
        Self {
            position: Vec2::ZERO,
            visual_position: Vec2::ZERO,
            velocity: Vec2::ZERO,
            current_chunk: (0, 0),
            size: 25.0, // Larger than NPCs (8-20)
            move_state: MoveState::default(),
            acceleration: 800.0,  // units/s²
            max_speed: 300.0,     // units/s
            damping: 0.9,         // velocity retention per frame
        }
    }

    /// Create a Frug at a specific position
    pub fn at_position(position: Vec2) -> Self {
        let chunk = Self::calculate_chunk(position);
        Self {
            position,
            visual_position: position,
            current_chunk: chunk,
            ..Self::new()
        }
    }

    /// Update physics and position
    pub fn update(&mut self, dt: f32) {
        // Apply acceleration based on input
        let dir = self.move_state.direction();
        self.velocity += dir * self.acceleration * dt;

        // Clamp to max speed
        let speed = self.velocity.length();
        if speed > self.max_speed {
            self.velocity = self.velocity.normalize() * self.max_speed;
        }

        // Apply damping when not moving
        if dir.length_squared() == 0.0 {
            self.velocity *= self.damping;

            // Stop completely if very slow
            if self.velocity.length() < 1.0 {
                self.velocity = Vec2::ZERO;
            }
        }

        // Update position
        self.position += self.velocity * dt;

        // Smooth visual interpolation
        let lerp_speed = 12.0 * dt;
        self.visual_position = self.visual_position.lerp(self.position, lerp_speed);

        // Update current chunk
        self.current_chunk = Self::calculate_chunk(self.position);
    }

    /// Get chunk coordinates for a world position
    fn calculate_chunk(position: Vec2) -> (i32, i32) {
        (
            (position.x / 64.0).floor() as i32,
            (position.y / 64.0).floor() as i32,
        )
    }

    /// Get current chunk coordinates
    pub fn get_chunk(&self) -> (i32, i32) {
        self.current_chunk
    }

    /// Set move up state
    pub fn set_move_up(&mut self, pressed: bool) {
        self.move_state.up = pressed;
    }

    /// Set move down state
    pub fn set_move_down(&mut self, pressed: bool) {
        self.move_state.down = pressed;
    }

    /// Set move left state
    pub fn set_move_left(&mut self, pressed: bool) {
        self.move_state.left = pressed;
    }

    /// Set move right state
    pub fn set_move_right(&mut self, pressed: bool) {
        self.move_state.right = pressed;
    }

    /// Get the golden color for Frug
    pub fn get_color(&self) -> [f32; 4] {
        [1.0, 0.85, 0.2, 1.0] // Golden yellow
    }

    /// Get the outline color (white)
    pub fn get_outline_color(&self) -> [f32; 4] {
        [1.0, 1.0, 1.0, 1.0] // White
    }
}
