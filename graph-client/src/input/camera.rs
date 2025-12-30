//! 2D/2.5D camera with pan/zoom controls and multiple projection modes

use glam::{Mat4, Vec2, Vec3};
use crate::graph::AABB;

/// Projection mode for 2.5D rendering
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ProjectionMode {
    /// Standard 2D orthographic projection (default, current behavior)
    #[default]
    Orthographic2D,
    /// Isometric view - 45 degree fixed angle with orthographic projection
    Isometric,
    /// True 3D perspective projection with depth
    Perspective,
}

impl ProjectionMode {
    /// Get display name for UI
    pub fn display_name(&self) -> &'static str {
        match self {
            ProjectionMode::Orthographic2D => "2D",
            ProjectionMode::Isometric => "Isometric",
            ProjectionMode::Perspective => "Perspective",
        }
    }

    /// Cycle to next projection mode
    pub fn next(&self) -> Self {
        match self {
            ProjectionMode::Orthographic2D => ProjectionMode::Isometric,
            ProjectionMode::Isometric => ProjectionMode::Perspective,
            ProjectionMode::Perspective => ProjectionMode::Orthographic2D,
        }
    }
}

/// 2D/2.5D camera for graph visualization
pub struct Camera2D {
    /// World position (center of view)
    pub position: Vec2,

    /// Current zoom level
    pub zoom: f32,

    /// Target zoom (for smooth interpolation)
    target_zoom: f32,

    /// Viewport size in pixels
    viewport_size: Vec2,

    /// Movement state (for direct camera control, not used when following)
    move_up: bool,
    move_down: bool,
    move_left: bool,
    move_right: bool,

    /// Follow target - if Some, camera follows this position
    follow_target: Option<Vec2>,

    /// Follow interpolation speed
    follow_lerp_speed: f32,

    /// Configuration
    pan_speed: f32,
    zoom_speed: f32,
    min_zoom: f32,
    max_zoom: f32,

    // 3D projection fields
    /// Current projection mode
    pub projection_mode: ProjectionMode,

    /// Camera pitch angle in radians (rotation around X axis, for 3D modes)
    pitch: f32,

    /// Camera yaw angle in radians (rotation around Y axis, for 3D modes)
    yaw: f32,

    /// Camera distance from target (for 3D modes)
    distance: f32,
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
            follow_target: None,
            follow_lerp_speed: 5.0,
            // 3D projection defaults
            projection_mode: ProjectionMode::default(),
            pitch: std::f32::consts::FRAC_PI_4, // 45 degrees for isometric
            yaw: std::f32::consts::FRAC_PI_4,   // 45 degrees for isometric
            distance: 500.0,
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

        // Follow target interpolation
        if let Some(target) = self.follow_target {
            let follow_lerp = 1.0 - (-self.follow_lerp_speed * dt).exp();
            self.position = self.position.lerp(target, follow_lerp);
        }
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
    #[allow(dead_code)]
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

    /// Get view-projection matrix for rendering (dispatches based on projection mode)
    pub fn get_view_projection(&self) -> Mat4 {
        match self.projection_mode {
            ProjectionMode::Orthographic2D => self.get_orthographic_view_projection(),
            ProjectionMode::Isometric => self.get_isometric_view_projection(),
            ProjectionMode::Perspective => self.get_perspective_view_projection(),
        }
    }

    /// Get 2D orthographic view-projection matrix (original behavior)
    fn get_orthographic_view_projection(&self) -> Mat4 {
        let half_width = self.viewport_size.x * 0.5 / self.zoom;
        let half_height = self.viewport_size.y * 0.5 / self.zoom;

        let left = self.position.x - half_width;
        let right = self.position.x + half_width;
        let bottom = self.position.y + half_height;
        let top = self.position.y - half_height;

        // Use larger depth range for 2D mode to ensure all nodes are visible
        Mat4::orthographic_rh(left, right, bottom, top, -1000.0, 1000.0)
    }

    /// Get isometric view-projection matrix
    /// Uses fixed 45 degree angles with orthographic projection for classic isometric look
    fn get_isometric_view_projection(&self) -> Mat4 {
        // Fixed isometric angles (45 degrees for both pitch and yaw)
        let pitch = std::f32::consts::FRAC_PI_6; // 30 degrees - classic isometric angle
        let yaw = std::f32::consts::FRAC_PI_4;   // 45 degrees

        // Camera position based on target position
        let target = Vec3::new(self.position.x, self.position.y, 0.0);

        // Calculate camera offset using spherical coordinates
        let cos_pitch = pitch.cos();
        let sin_pitch = pitch.sin();
        let cos_yaw = yaw.cos();
        let sin_yaw = yaw.sin();

        let offset = Vec3::new(
            cos_pitch * sin_yaw,
            sin_pitch,
            cos_pitch * cos_yaw,
        ) * self.distance;

        let eye = target + offset;
        let up = Vec3::Y;

        // View matrix - looking at the target
        let view = Mat4::look_at_rh(eye, target, up);

        // Orthographic projection for isometric (no perspective distortion)
        let half_width = self.viewport_size.x * 0.5 / self.zoom;
        let half_height = self.viewport_size.y * 0.5 / self.zoom;

        let proj = Mat4::orthographic_rh(
            -half_width,
            half_width,
            -half_height,
            half_height,
            0.1,
            self.distance * 3.0,
        );

        proj * view
    }

    /// Get perspective view-projection matrix
    /// True 3D perspective with depth perception
    fn get_perspective_view_projection(&self) -> Mat4 {
        // Use the stored pitch and yaw for perspective mode
        let pitch = self.pitch;
        let yaw = self.yaw;

        // Camera position based on target position
        let target = Vec3::new(self.position.x, self.position.y, 0.0);

        // Calculate camera offset using spherical coordinates
        // Adjust distance based on zoom
        let adjusted_distance = self.distance / self.zoom;

        let cos_pitch = pitch.cos();
        let sin_pitch = pitch.sin();
        let cos_yaw = yaw.cos();
        let sin_yaw = yaw.sin();

        let offset = Vec3::new(
            cos_pitch * sin_yaw,
            sin_pitch,
            cos_pitch * cos_yaw,
        ) * adjusted_distance;

        let eye = target + offset;
        let up = Vec3::Y;

        // View matrix - looking at the target
        let view = Mat4::look_at_rh(eye, target, up);

        // Perspective projection
        let aspect = self.viewport_size.x / self.viewport_size.y;
        let fov = std::f32::consts::FRAC_PI_4; // 45 degree FOV

        let proj = Mat4::perspective_rh(fov, aspect, 0.1, adjusted_distance * 3.0);

        proj * view
    }

    /// Set the projection mode
    pub fn set_projection_mode(&mut self, mode: ProjectionMode) {
        self.projection_mode = mode;
    }

    /// Cycle to the next projection mode
    pub fn cycle_projection_mode(&mut self) {
        self.projection_mode = self.projection_mode.next();
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

    /// Set follow target for camera to track
    pub fn set_follow_target(&mut self, target: Option<Vec2>) {
        self.follow_target = target;
    }
}

impl Default for Camera2D {
    fn default() -> Self {
        Self::new()
    }
}
