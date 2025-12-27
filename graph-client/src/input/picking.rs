//! Node picking and selection

use glam::Vec2;
use std::collections::HashSet;
use crate::graph::GraphStore;

/// Hit detection radius in world units
const HIT_RADIUS: f32 = 15.0;

/// Interaction state for graph elements
pub struct GraphInteraction {
    /// Currently hovered node
    pub hovered_node: Option<u64>,

    /// Currently selected nodes
    pub selected_nodes: HashSet<u64>,

    /// Current cursor position in screen space
    pub cursor_pos: Vec2,

    /// Previous cursor position for delta calculation
    prev_cursor_pos: Vec2,

    /// Whether middle mouse button is held for panning
    pub is_panning: bool,

    /// Whether shift key is held for multi-select
    pub shift_held: bool,

    /// Whether ctrl key is held
    #[allow(dead_code)]
    pub ctrl_held: bool,

    /// Index for cycling through neighbors
    neighbor_cycle_index: usize,
}

impl GraphInteraction {
    pub fn new() -> Self {
        Self {
            hovered_node: None,
            selected_nodes: HashSet::new(),
            cursor_pos: Vec2::ZERO,
            prev_cursor_pos: Vec2::ZERO,
            is_panning: false,
            shift_held: false,
            ctrl_held: false,
            neighbor_cycle_index: 0,
        }
    }

    /// Update cursor position and return delta
    pub fn update_cursor(&mut self, x: f32, y: f32) -> Vec2 {
        self.prev_cursor_pos = self.cursor_pos;
        self.cursor_pos = Vec2::new(x, y);
        self.cursor_pos - self.prev_cursor_pos
    }

    /// Update hover state based on world position
    pub fn update_hover(&mut self, store: &GraphStore, world_pos: Vec2) {
        self.hovered_node = store.get_node_at(world_pos, HIT_RADIUS);
    }

    /// Handle click at world position
    pub fn handle_click(&mut self, store: &GraphStore, world_pos: Vec2, multi_select: bool) {
        if let Some(node_id) = store.get_node_at(world_pos, HIT_RADIUS) {
            if multi_select {
                // Toggle selection
                if self.selected_nodes.contains(&node_id) {
                    self.selected_nodes.remove(&node_id);
                } else {
                    self.selected_nodes.insert(node_id);
                }
            } else {
                // Single selection
                self.selected_nodes.clear();
                self.selected_nodes.insert(node_id);
            }
            self.neighbor_cycle_index = 0;
        } else if !multi_select {
            // Click on empty space clears selection
            self.selected_nodes.clear();
        }
    }

    /// Clear all selection
    pub fn clear_selection(&mut self) {
        self.selected_nodes.clear();
        self.neighbor_cycle_index = 0;
    }

    /// Cycle through neighbors of the primary selected node
    pub fn cycle_neighbor(&mut self, store: &GraphStore) {
        if let Some(&primary) = self.selected_nodes.iter().next() {
            let neighbors = store.get_neighbors(primary);
            if !neighbors.is_empty() {
                self.neighbor_cycle_index = (self.neighbor_cycle_index + 1) % neighbors.len();
                let neighbor_id = neighbors[self.neighbor_cycle_index];

                self.selected_nodes.clear();
                self.selected_nodes.insert(neighbor_id);
            }
        }
    }

    /// Set panning state
    pub fn set_panning(&mut self, state: bool) {
        self.is_panning = state;
    }

    /// Set modifier key states
    #[allow(dead_code)]
    pub fn set_shift(&mut self, state: bool) {
        self.shift_held = state;
    }

    #[allow(dead_code)]
    pub fn set_ctrl(&mut self, state: bool) {
        self.ctrl_held = state;
    }

    /// Check if a node is selected
    pub fn is_selected(&self, node_id: u64) -> bool {
        self.selected_nodes.contains(&node_id)
    }

    /// Check if a node is hovered
    pub fn is_hovered(&self, node_id: u64) -> bool {
        self.hovered_node == Some(node_id)
    }

    /// Get the primary selected node (first in set)
    pub fn get_primary_selection(&self) -> Option<u64> {
        self.selected_nodes.iter().next().copied()
    }

    /// Get all selected nodes
    pub fn get_selected(&self) -> &HashSet<u64> {
        &self.selected_nodes
    }
}

impl Default for GraphInteraction {
    fn default() -> Self {
        Self::new()
    }
}
