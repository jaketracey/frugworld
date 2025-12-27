//! Graph edge representing a relationship between NPCs

use super::node::RelationshipType;

/// Relationship flags (matching server)
pub mod flags {
    pub const MET: u32 = 1 << 0;
    pub const TRADED: u32 = 1 << 1;
    pub const FRIEND: u32 = 1 << 2;
    pub const HOSTILE: u32 = 1 << 3;
    pub const OWES_FAVOR: u32 = 1 << 4;
    pub const OFFENDED: u32 = 1 << 5;
    pub const SHARED_SECRET: u32 = 1 << 6;
    pub const ACTIVE_GRUDGE: u32 = 1 << 7;
}

/// An edge in the graph representing a relationship
#[derive(Debug, Clone)]
pub struct GraphEdge {
    // Identity
    pub relationship_id: u64,
    pub source_id: u64,
    pub target_id: u64,

    // Relationship data
    pub relationship_type: RelationshipType,
    pub affinity_a_to_b: i16,  // How much A likes B
    pub affinity_b_to_a: i16,  // How much B likes A
    pub trust_a_to_b: i16,
    pub trust_b_to_a: i16,
    pub interaction_count: u32,
    pub flags: u32,

    // Visual state
    pub visible: bool,
    pub highlighted: bool,
}

impl GraphEdge {
    pub fn new(relationship_id: u64, source_id: u64, target_id: u64) -> Self {
        Self {
            relationship_id,
            source_id,
            target_id,
            relationship_type: RelationshipType::Stranger,
            affinity_a_to_b: 0,
            affinity_b_to_a: 0,
            trust_a_to_b: 0,
            trust_b_to_a: 0,
            interaction_count: 0,
            flags: 0,
            visible: false,
            highlighted: false,
        }
    }

    /// Check if this is a friendly relationship
    pub fn is_friendly(&self) -> bool {
        matches!(
            self.relationship_type,
            RelationshipType::Friend | RelationshipType::CloseFriend | RelationshipType::MentorStudent
        )
    }

    /// Check if this is a hostile relationship
    pub fn is_hostile(&self) -> bool {
        matches!(
            self.relationship_type,
            RelationshipType::Rival | RelationshipType::Enemy
        )
    }

    /// Get edge color based on relationship type
    pub fn get_color(&self) -> [f32; 4] {
        let alpha = if self.highlighted { 1.0 } else { 0.6 };

        match self.relationship_type {
            RelationshipType::Stranger => [0.5, 0.5, 0.5, alpha * 0.3],
            RelationshipType::Acquaintance => [0.6, 0.6, 0.7, alpha * 0.5],
            RelationshipType::Friend => [0.3, 0.8, 0.3, alpha],
            RelationshipType::CloseFriend => [0.2, 1.0, 0.2, alpha],
            RelationshipType::Rival => [0.9, 0.6, 0.2, alpha],
            RelationshipType::Enemy => [0.9, 0.2, 0.2, alpha],
            RelationshipType::MentorStudent => [0.3, 0.6, 0.9, alpha],
        }
    }

    /// Get edge thickness based on interaction count
    pub fn get_thickness(&self) -> f32 {
        let base = 1.0;
        let from_interactions = (self.interaction_count as f32).sqrt() * 0.5;
        (base + from_interactions).min(5.0)
    }

    /// Check if the relationship is asymmetric (one-sided)
    pub fn is_asymmetric(&self) -> bool {
        (self.affinity_a_to_b - self.affinity_b_to_a).abs() > 1000
    }

    /// Get the stronger direction (source → target if A likes B more)
    pub fn get_dominant_direction(&self) -> Option<bool> {
        if !self.is_asymmetric() {
            return None;
        }
        Some(self.affinity_a_to_b > self.affinity_b_to_a)
    }

    /// Check if there's an active grudge
    pub fn has_grudge(&self) -> bool {
        self.flags & flags::ACTIVE_GRUDGE != 0
    }

    /// Check if they share a secret
    pub fn has_shared_secret(&self) -> bool {
        self.flags & flags::SHARED_SECRET != 0
    }

    /// Get a unique key for this edge (order-independent)
    pub fn get_key(a: u64, b: u64) -> (u64, u64) {
        if a < b { (a, b) } else { (b, a) }
    }
}
