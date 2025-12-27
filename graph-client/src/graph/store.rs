//! Graph data store with node/edge management

use std::collections::HashMap;
use glam::Vec2;

use super::{GraphNode, GraphEdge, LayoutEngine, Quadtree, AABB};
use super::node::RelationshipType;

/// Central graph data store
pub struct GraphStore {
    // Core data
    pub nodes: HashMap<u64, GraphNode>,
    pub edges: HashMap<u64, GraphEdge>,

    // Indexes
    pub edges_by_node: HashMap<u64, Vec<u64>>,
    edge_key_to_id: HashMap<(u64, u64), u64>,

    // Spatial index
    pub spatial_index: Quadtree,

    // Layout
    layout_engine: LayoutEngine,
    pub layout_dirty: bool,

    // Statistics
    pub node_count: usize,
    pub edge_count: usize,
}

impl GraphStore {
    pub fn new() -> Self {
        Self {
            nodes: HashMap::new(),
            edges: HashMap::new(),
            edges_by_node: HashMap::new(),
            edge_key_to_id: HashMap::new(),
            spatial_index: Quadtree::new(),
            layout_engine: LayoutEngine::new(),
            layout_dirty: true,
            node_count: 0,
            edge_count: 0,
        }
    }

    // ========== Node Management ==========

    /// Add a new node from entity data
    pub fn add_node(&mut self, entity_id: u64, chunk_x: i32, chunk_y: i32) {
        if self.nodes.contains_key(&entity_id) {
            return;
        }

        let mut node = GraphNode::new(entity_id);
        node.chunk_x = chunk_x;
        node.chunk_y = chunk_y;

        // Initialize position from chunk
        let hash = Self::hash_id(entity_id);
        let offset_x = ((hash & 0xFF) as f32 / 255.0 - 0.5) * 50.0;
        let offset_y = (((hash >> 8) & 0xFF) as f32 / 255.0 - 0.5) * 50.0;
        node.position = Vec2::new(
            chunk_x as f32 * 64.0 + offset_x,
            chunk_y as f32 * 64.0 + offset_y,
        );
        node.visual_position = node.position;

        self.nodes.insert(entity_id, node);
        self.node_count = self.nodes.len();
        self.layout_dirty = true;

        log::debug!("Added node {}", entity_id);
    }

    /// Update node from blueprint data
    pub fn update_node_blueprint(&mut self, entity_id: u64, name: String, archetype_id: u32) {
        if let Some(node) = self.nodes.get_mut(&entity_id) {
            node.name = name;
            node.archetype_id = archetype_id;
        }
    }

    /// Update node personality for visual encoding
    pub fn update_node_personality(
        &mut self,
        entity_id: u64,
        extraversion: u8,
        agreeableness: u8,
        life_stage: u8,
    ) {
        if let Some(node) = self.nodes.get_mut(&entity_id) {
            node.extraversion = extraversion;
            node.agreeableness = agreeableness;
            node.life_stage = life_stage.into();
        }
    }

    /// Update node LOD state
    pub fn update_node_lod(&mut self, entity_id: u64, lod_state: u8) {
        if let Some(node) = self.nodes.get_mut(&entity_id) {
            node.lod_state = lod_state;
        }
    }

    /// Update node reputation
    #[allow(dead_code)]
    pub fn update_node_reputation(&mut self, entity_id: u64, social_rep: i16) {
        if let Some(node) = self.nodes.get_mut(&entity_id) {
            node.social_rep = social_rep;
        }
    }

    /// Update node activity state (goals, needs, memories)
    pub fn update_node_activity(
        &mut self,
        entity_id: u64,
        short_intent: String,
        mid_goal: String,
        long_goal: String,
        needs_summary: String,
        memory_summary: String,
    ) {
        if let Some(node) = self.nodes.get_mut(&entity_id) {
            node.short_intent = short_intent;
            node.mid_goal = mid_goal;
            node.long_goal = long_goal;
            node.needs_summary = needs_summary;
            node.memory_summary = memory_summary;
        }
    }

    /// Remove a node
    #[allow(dead_code)]
    pub fn remove_node(&mut self, entity_id: u64) {
        if self.nodes.remove(&entity_id).is_some() {
            // Remove all edges connected to this node
            if let Some(edge_ids) = self.edges_by_node.remove(&entity_id) {
                for edge_id in edge_ids {
                    if let Some(edge) = self.edges.remove(&edge_id) {
                        let key = GraphEdge::get_key(edge.source_id, edge.target_id);
                        self.edge_key_to_id.remove(&key);

                        // Remove from the other node's edge list
                        let other_id = if edge.source_id == entity_id {
                            edge.target_id
                        } else {
                            edge.source_id
                        };
                        if let Some(other_edges) = self.edges_by_node.get_mut(&other_id) {
                            other_edges.retain(|&id| id != edge_id);
                        }
                    }
                }
            }

            self.node_count = self.nodes.len();
            self.edge_count = self.edges.len();
            self.layout_dirty = true;
        }
    }

    // ========== Edge Management ==========

    /// Add or update an edge from relationship data
    pub fn upsert_edge(
        &mut self,
        relationship_id: u64,
        source_id: u64,
        target_id: u64,
        relationship_type: u16,
        affinity_a_to_b: i16,
        affinity_b_to_a: i16,
        interaction_count: u32,
        flags: u32,
    ) {
        let key = GraphEdge::get_key(source_id, target_id);

        if let Some(&existing_id) = self.edge_key_to_id.get(&key) {
            // Update existing edge
            if let Some(edge) = self.edges.get_mut(&existing_id) {
                edge.relationship_type = RelationshipType::from(relationship_type);
                edge.affinity_a_to_b = affinity_a_to_b;
                edge.affinity_b_to_a = affinity_b_to_a;
                edge.interaction_count = interaction_count;
                edge.flags = flags;
            }
        } else {
            // Create new edge
            let mut edge = GraphEdge::new(relationship_id, source_id, target_id);
            edge.relationship_type = RelationshipType::from(relationship_type);
            edge.affinity_a_to_b = affinity_a_to_b;
            edge.affinity_b_to_a = affinity_b_to_a;
            edge.interaction_count = interaction_count;
            edge.flags = flags;

            self.edges.insert(relationship_id, edge);
            self.edge_key_to_id.insert(key, relationship_id);

            // Update edge indexes
            self.edges_by_node
                .entry(source_id)
                .or_default()
                .push(relationship_id);
            self.edges_by_node
                .entry(target_id)
                .or_default()
                .push(relationship_id);

            self.edge_count = self.edges.len();
            self.layout_dirty = true;

            log::debug!("Added edge {} ({} <-> {})", relationship_id, source_id, target_id);
        }
    }

    /// Remove an edge
    #[allow(dead_code)]
    pub fn remove_edge(&mut self, relationship_id: u64) {
        if let Some(edge) = self.edges.remove(&relationship_id) {
            let key = GraphEdge::get_key(edge.source_id, edge.target_id);
            self.edge_key_to_id.remove(&key);

            if let Some(source_edges) = self.edges_by_node.get_mut(&edge.source_id) {
                source_edges.retain(|&id| id != relationship_id);
            }
            if let Some(target_edges) = self.edges_by_node.get_mut(&edge.target_id) {
                target_edges.retain(|&id| id != relationship_id);
            }

            self.edge_count = self.edges.len();
        }
    }

    /// Get edges for a specific node
    pub fn get_node_edges(&self, node_id: u64) -> Vec<&GraphEdge> {
        self.edges_by_node
            .get(&node_id)
            .map(|edge_ids| {
                edge_ids
                    .iter()
                    .filter_map(|id| self.edges.get(id))
                    .collect()
            })
            .unwrap_or_default()
    }

    // ========== Layout ==========

    /// Update layout simulation
    pub fn update_layout(&mut self, dt: f32, _zoom: f32) {
        if !self.layout_dirty && !self.layout_engine.running {
            // Just update visuals
            for node in self.nodes.values_mut() {
                node.update_visuals(dt);
            }
            return;
        }

        self.layout_engine.update(
            &mut self.nodes,
            &self.edges,
            &self.edges_by_node,
            &self.spatial_index,
            dt,
        );

        // Update visuals
        for node in self.nodes.values_mut() {
            node.update_visuals(dt);
        }

        // Mark for spatial index rebuild
        self.layout_dirty = true;
    }

    /// Rebuild spatial index from current positions
    pub fn rebuild_spatial_index(&mut self) {
        self.spatial_index.rebuild(&self.nodes);
        self.layout_dirty = false;
    }

    /// Reset layout to chunk-based positions
    pub fn reset_layout(&mut self) {
        self.layout_engine.reset(&mut self.nodes);
        self.layout_dirty = true;
    }

    /// Toggle layout simulation
    pub fn toggle_layout_simulation(&mut self) {
        self.layout_engine.toggle();
    }

    // ========== Queries ==========

    /// Get visible nodes within view bounds
    pub fn get_visible_nodes(&self, view_bounds: &AABB) -> Vec<u64> {
        self.spatial_index.query_visible(view_bounds)
    }

    /// Get node at screen position
    pub fn get_node_at(&self, world_pos: Vec2, radius: f32) -> Option<u64> {
        self.spatial_index.query_point(world_pos, radius)
    }

    /// Get bounding box of all nodes
    pub fn get_bounds(&self) -> AABB {
        let mut bounds = AABB::default();
        for node in self.nodes.values() {
            bounds.expand(node.position);
        }
        bounds.expand_by(50.0)
    }

    /// Get neighbors of a node
    pub fn get_neighbors(&self, node_id: u64) -> Vec<u64> {
        self.edges_by_node
            .get(&node_id)
            .map(|edge_ids| {
                edge_ids
                    .iter()
                    .filter_map(|id| self.edges.get(id))
                    .map(|edge| {
                        if edge.source_id == node_id {
                            edge.target_id
                        } else {
                            edge.source_id
                        }
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    // ========== Helpers ==========

    fn hash_id(id: u64) -> u64 {
        let mut x = id;
        x = x.wrapping_mul(0x517cc1b727220a95);
        x ^= x >> 32;
        x
    }
}

impl Default for GraphStore {
    fn default() -> Self {
        Self::new()
    }
}
