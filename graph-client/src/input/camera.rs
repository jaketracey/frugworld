//! 2D camera with pan/zoom controls

use glam::Vec2;
use crate::graph::AABB;

/// 2D camera for graph visualization
pub struct Camera2D {
    /// World position (center of view)
    pub position: Vec2,

    /// Current zoom level
    pub zoom: f32,

    /// Target zoom (for smooth interpolation)
    target_zoom: f32,

    /// Viewport size in pixels
    viewport_size: Vec2,

    /// Movement state
    move_up: bool,
    move_down: bool,
    move_left: bool,
    move_right: bool,

    /// Configuration
    pan_speed: f32,
    zoom_speed: f32,
    min_zoom: f32,
    max_zoom: f32,
}

impl Camera2D {
    pub fn new() -> Self {
        Self {
            position: Vec2::ZERO,
            zoom: 1.0,
            target_zoom: 1.0,
            viewport_size: Vec2::new(1920.0, 1080.0),
            move_up: false,
            move_down: false,
            move_left: false,
            move_right: false,
            pan_speed: 500.0,
            zoom_speed: 0.1,
            min_zoom: 0.1,
            max_zoom: 10.0,
        }
    }

    /// Update camera state
    pub fn update(&mut self, dt: f32) {
        // Pan from keyboard
        let mut pan = Vec2::ZERO;
        if self.move_up {
            pan.y -= 1.0;
        }
        if self.move_down {
            pan.y += 1.0;
        }
        if self.move_left {
            pan.x -= 1.0;
        }
        if self.move_right {
            pan.x += 1.0;
        }

        if pan != Vec2::ZERO {
            pan = pan.normalize();
            self.position += pan * self.pan_speed * dt / self.zoom;
        }

        // Smooth zoom interpolation
        let zoom_lerp = 1.0 - (-10.0 * dt).exp();
        self.zoom += (self.target_zoom - self.zoom) * zoom_lerp;
    }

    /// Set viewport size
    pub fn set_viewport_size(&mut self, width: f32, height: f32) {
        self.viewport_size = Vec2::new(width, height);
    }

    /// Handle scroll wheel for zoom
    pub fn handle_scroll(&mut self, delta: f32) {
        self.target_zoom = (self.target_zoom * (1.0 + delta * self.zoom_speed))
            .clamp(self.min_zoom, self.max_zoom);
    }

    /// Handle drag for panning
    pub fn handle_drag(&mut self, delta: Vec2) {
        self.position -= delta / self.zoom;
    }

    /// Convert screen coordinates to world coordinates
    pub fn screen_to_world(&self, screen_pos: Vec2) -> Vec2 {
        let center = self.viewport_size * 0.5;
        let offset = (screen_pos - center) / self.zoom;
        self.position + offset
    }

    /// Convert world coordinates to screen coordinates
    pub fn world_to_screen(&self, world_pos: Vec2) -> Vec2 {
        let center = self.viewport_size * 0.5;
        let offset = (world_pos - self.position) * self.zoom;
        center + offset
    }

    /// Get the visible world-space bounding box
    pub fn get_view_bounds(&self) -> AABB {
        let half_size = self.viewport_size * 0.5 / self.zoom;
        AABB::new(
            self.position - half_size,
            self.position + half_size,
        )
    }

    /// Fit the camera to show all content within bounds
    pub fn fit_to_bounds(&mut self, bounds: AABB) {
        self.position = bounds.center();

        let bounds_size = bounds.size();
        let viewport_aspect = self.viewport_size.x / self.viewport_size.y;
        let bounds_aspect = bounds_size.x / bounds_size.y;

        // Calculate zoom to fit bounds with some padding
        let padding = 1.2;
        if bounds_aspect > viewport_aspect {
            // Bounds wider than viewport
            self.target_zoom = self.viewport_size.x / (bounds_size.x * padding);
        } else {
            // Bounds taller than viewport
            self.target_zoom = self.viewport_size.y / (bounds_size.y * padding);
        }

        self.target_zoom = self.target_zoom.clamp(self.min_zoom, self.max_zoom);
    }

    /// Get view-projection matrix for rendering
    pub fn get_view_projection(&self) -> glam::Mat4 {
        let half_width = self.viewport_size.x * 0.5 / self.zoom;
        let half_height = self.viewport_size.y * 0.5 / self.zoom;

        let left = self.position.x - half_width;
        let right = self.position.x + half_width;
        let bottom = self.position.y + half_height;
        let top = self.position.y - half_height;

        glam::Mat4::orthographic_rh(left, right, bottom, top, -1.0, 1.0)
    }

    // Movement state setters
    pub fn set_move_up(&mut self, state: bool) {
        self.move_up = state;
    }

    pub fn set_move_down(&mut self, state: bool) {
        self.move_down = state;
    }

    pub fn set_move_left(&mut self, state: bool) {
        self.move_left = state;
    }

    pub fn set_move_right(&mut self, state: bool) {
        self.move_right = state;
    }
}

impl Default for Camera2D {
    fn default() -> Self {
        Self::new()
    }
}
