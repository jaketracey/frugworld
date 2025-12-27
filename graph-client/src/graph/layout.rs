//! Force-directed graph layout with Barnes-Hut optimization

use glam::Vec2;
use std::collections::HashMap;

use super::{GraphNode, GraphEdge, Quadtree};

/// Layout configuration parameters
#[derive(Debug, Clone)]
pub struct LayoutConfig {
    /// Repulsion strength between nodes
    pub repulsion_strength: f32,
    /// Attraction strength for edges
    pub attraction_strength: f32,
    /// Gravity toward chunk center
    pub chunk_gravity: f32,
    /// Social cluster force (friends attract)
    pub social_cluster_force: f32,
    /// Velocity damping
    pub damping: f32,
    /// Maximum velocity
    pub max_velocity: f32,
    /// Threshold for layout stabilization
    pub stabilization_threshold: f32,
    /// Barnes-Hut theta parameter (accuracy vs speed)
    pub theta: f32,
}

impl Default for LayoutConfig {
    fn default() -> Self {
        Self {
            repulsion_strength: 500.0,
            attraction_strength: 0.01,
            chunk_gravity: 0.0005,
            social_cluster_force: 0.02,
            damping: 0.92,
            max_velocity: 50.0,
            stabilization_threshold: 0.1,
            theta: 0.7,
        }
    }
}

/// Layout engine for force-directed graph layout
pub struct LayoutEngine {
    pub config: LayoutConfig,
    pub running: bool,
    pub total_energy: f32,
    chunk_size: f32,
}

impl LayoutEngine {
    pub fn new() -> Self {
        Self {
            config: LayoutConfig::default(),
            running: true,
            total_energy: f32::MAX,
            chunk_size: 64.0, // Match server chunk size
        }
    }

    /// Initialize layout based on chunk positions
    pub fn initial_layout(&self, nodes: &mut HashMap<u64, GraphNode>) {
        for node in nodes.values_mut() {
            // Use chunk position as base, with deterministic offset
            let hash = Self::hash_position(node.entity_id);
            let offset_x = ((hash & 0xFF) as f32 / 255.0 - 0.5) * self.chunk_size * 0.8;
            let offset_y = (((hash >> 8) & 0xFF) as f32 / 255.0 - 0.5) * self.chunk_size * 0.8;

            node.position = Vec2::new(
                node.chunk_x as f32 * self.chunk_size + offset_x,
                node.chunk_y as f32 * self.chunk_size + offset_y,
            );
            node.velocity = Vec2::ZERO;
            node.visual_position = node.position;
        }
    }

    /// Update layout simulation
    pub fn update(
        &mut self,
        nodes: &mut HashMap<u64, GraphNode>,
        edges: &HashMap<u64, GraphEdge>,
        edges_by_node: &HashMap<u64, Vec<u64>>,
        quadtree: &Quadtree,
        dt: f32,
    ) {
        if !self.running {
            return;
        }

        self.total_energy = 0.0;

        // Collect node positions for force calculation
        let positions: HashMap<u64, Vec2> = nodes
            .iter()
            .map(|(&id, n)| (id, n.position))
            .collect();

        // Calculate and apply forces for each node
        for node in nodes.values_mut() {
            if node.pinned {
                continue;
            }

            let mut force = Vec2::ZERO;

            // 1. Repulsion from all nodes (Barnes-Hut)
            let repulsion = quadtree.calculate_repulsion(node.position, self.config.theta);
            force += repulsion * self.config.repulsion_strength;

            // 2. Attraction from connected nodes
            if let Some(edge_ids) = edges_by_node.get(&node.entity_id) {
                for edge_id in edge_ids {
                    if let Some(edge) = edges.get(edge_id) {
                        let other_id = if edge.source_id == node.entity_id {
                            edge.target_id
                        } else {
                            edge.source_id
                        };

                        if let Some(&other_pos) = positions.get(&other_id) {
                            let diff = other_pos - node.position;
                            let dist = diff.length();

                            if dist > 1.0 {
                                // Spring force
                                let mut attraction = diff * self.config.attraction_strength;

                                // Stronger attraction for friends
                                if edge.is_friendly() {
                                    attraction *= 1.0 + self.config.social_cluster_force;
                                }

                                force += attraction;
                            }
                        }
                    }
                }
            }

            // 3. Gravity toward chunk center
            let chunk_center = Vec2::new(
                (node.chunk_x as f32 + 0.5) * self.chunk_size,
                (node.chunk_y as f32 + 0.5) * self.chunk_size,
            );
            let to_center = chunk_center - node.position;
            force += to_center * self.config.chunk_gravity;

            // Apply force to velocity
            node.velocity += force * dt;

            // Damping
            node.velocity *= self.config.damping;

            // Clamp velocity
            let speed = node.velocity.length();
            if speed > self.config.max_velocity {
                node.velocity = node.velocity.normalize() * self.config.max_velocity;
            }

            // Update position
            node.position += node.velocity * dt;

            // Track energy
            self.total_energy += speed * speed;
        }

        // Check for stabilization
        if self.total_energy < self.config.stabilization_threshold * nodes.len() as f32 {
            // Reduce simulation frequency when stable
            self.running = false;
        }
    }

    /// Reset layout to initial chunk-based positions
    pub fn reset(&mut self, nodes: &mut HashMap<u64, GraphNode>) {
        self.initial_layout(nodes);
        self.running = true;
        self.total_energy = f32::MAX;
    }

    /// Toggle layout simulation
    pub fn toggle(&mut self) {
        self.running = !self.running;
        if self.running {
            self.total_energy = f32::MAX;
        }
    }

    /// Simple hash for deterministic positioning
    fn hash_position(id: u64) -> u64 {
        let mut x = id;
        x = x.wrapping_mul(0x517cc1b727220a95);
        x ^= x >> 32;
        x
    }
}

impl Default for LayoutEngine {
    fn default() -> Self {
        Self::new()
    }
}
