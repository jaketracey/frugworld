//! Graph node representing an NPC

use glam::Vec2;
use serde::{Deserialize, Serialize};

/// Relationship type for visual encoding
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum RelationshipType {
    Stranger = 0,
    Acquaintance = 1,
    Friend = 2,
    CloseFriend = 3,
    Rival = 4,
    Enemy = 5,
    MentorStudent = 6,
}

impl Default for RelationshipType {
    fn default() -> Self {
        Self::Stranger
    }
}

impl From<u16> for RelationshipType {
    fn from(value: u16) -> Self {
        match value {
            0 => Self::Stranger,
            1 => Self::Acquaintance,
            2 => Self::Friend,
            3 => Self::CloseFriend,
            4 => Self::Rival,
            5 => Self::Enemy,
            6 => Self::MentorStudent,
            _ => Self::Stranger,
        }
    }
}

/// Life stage for visual shape encoding
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LifeStage {
    #[default]
    Youth = 0,
    Adult = 1,
    Mature = 2,
    Elder = 3,
}

impl From<u8> for LifeStage {
    fn from(value: u8) -> Self {
        match value {
            0 => Self::Youth,
            1 => Self::Adult,
            2 => Self::Mature,
            3 => Self::Elder,
            _ => Self::Youth,
        }
    }
}

/// A node in the graph representing an NPC
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct GraphNode {
    // Identity
    pub entity_id: u64,
    pub name: String,
    pub archetype_id: u32,

    // World position (from server)
    pub chunk_x: i32,
    pub chunk_y: i32,
    pub world_x: f32,
    pub world_y: f32,

    // State
    pub lod_state: u8,
    pub alive: bool,

    // Personality traits (for visual encoding)
    pub extraversion: u8,      // 0-100, affects node size
    pub agreeableness: u8,     // 0-100, affects color warmth
    pub life_stage: LifeStage, // affects shape

    // Reputation
    pub social_rep: i16,       // affects glow intensity

    // Activity state (from NpcState)
    pub short_intent: String,   // Current action/behavior
    pub mid_goal: String,       // Current mid-term goal
    pub long_goal: String,      // Current long-term goal
    pub needs_summary: String,  // Summary of current needs
    pub memory_summary: String, // Summary of recent memories

    // Layout state (computed)
    pub position: Vec2,
    pub velocity: Vec2,
    pub pinned: bool,

    // Interaction state
    pub selected: bool,
    pub hovered: bool,

    // Visual state (interpolated)
    pub visual_position: Vec2,
    pub visual_size: f32,
    pub visual_alpha: f32,
}

impl GraphNode {
    pub fn new(entity_id: u64) -> Self {
        Self {
            entity_id,
            name: String::new(),
            archetype_id: 0,
            chunk_x: 0,
            chunk_y: 0,
            world_x: 0.0,
            world_y: 0.0,
            lod_state: 0,
            alive: true,
            extraversion: 50,
            agreeableness: 50,
            life_stage: LifeStage::default(),
            social_rep: 0,
            short_intent: String::new(),
            mid_goal: String::new(),
            long_goal: String::new(),
            needs_summary: String::new(),
            memory_summary: String::new(),
            position: Vec2::ZERO,
            velocity: Vec2::ZERO,
            pinned: false,
            selected: false,
            hovered: false,
            visual_position: Vec2::ZERO,
            visual_size: 10.0,
            visual_alpha: 1.0,
        }
    }

    /// Get base size based on extraversion (8-20 pixels)
    pub fn get_base_size(&self) -> f32 {
        8.0 + (self.extraversion as f32 / 100.0) * 12.0
    }

    /// Get color based on agreeableness (blue → orange gradient)
    pub fn get_color(&self) -> [f32; 4] {
        let t = self.agreeableness as f32 / 100.0;
        // Blue (cool) to Orange (warm)
        let r = 0.2 + t * 0.8;
        let g = 0.4 + t * 0.3;
        let b = 0.8 - t * 0.5;
        [r, g, b, self.visual_alpha]
    }

    /// Get opacity - always full since WASM has better performance than Three.js
    pub fn get_lod_alpha(&self) -> f32 {
        1.0 // No LOD fading needed - WASM can handle all entities at full quality
    }

    /// Get shape vertex count based on life stage
    #[allow(dead_code)]
    pub fn get_shape_sides(&self) -> u32 {
        match self.life_stage {
            LifeStage::Youth => 32,  // Circle
            LifeStage::Adult => 4,   // Square
            LifeStage::Mature => 6,  // Hexagon
            LifeStage::Elder => 5,   // Pentagon
        }
    }

    /// Update visual interpolation
    pub fn update_visuals(&mut self, dt: f32) {
        let lerp_speed = 8.0 * dt;

        // Smooth position interpolation
        self.visual_position = self.visual_position.lerp(self.position, lerp_speed);

        // Smooth size interpolation
        let target_size = self.get_base_size();
        self.visual_size += (target_size - self.visual_size) * lerp_speed;

        // Smooth alpha interpolation
        let target_alpha = self.get_lod_alpha();
        self.visual_alpha += (target_alpha - self.visual_alpha) * lerp_speed;
    }
}
