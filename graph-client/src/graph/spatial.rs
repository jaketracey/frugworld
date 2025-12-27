//! Spatial indexing with quadtree for efficient queries

use glam::Vec2;
use std::collections::HashMap;

/// Axis-aligned bounding box
#[derive(Debug, Clone, Copy)]
pub struct AABB {
    pub min: Vec2,
    pub max: Vec2,
}

impl AABB {
    pub fn new(min: Vec2, max: Vec2) -> Self {
        Self { min, max }
    }

    pub fn from_center_size(center: Vec2, size: Vec2) -> Self {
        let half = size * 0.5;
        Self {
            min: center - half,
            max: center + half,
        }
    }

    pub fn center(&self) -> Vec2 {
        (self.min + self.max) * 0.5
    }

    pub fn size(&self) -> Vec2 {
        self.max - self.min
    }

    pub fn contains(&self, point: Vec2) -> bool {
        point.x >= self.min.x
            && point.x <= self.max.x
            && point.y >= self.min.y
            && point.y <= self.max.y
    }

    pub fn intersects(&self, other: &AABB) -> bool {
        self.min.x <= other.max.x
            && self.max.x >= other.min.x
            && self.min.y <= other.max.y
            && self.max.y >= other.min.y
    }

    pub fn expand(&mut self, point: Vec2) {
        self.min = self.min.min(point);
        self.max = self.max.max(point);
    }

    pub fn expand_by(&self, margin: f32) -> AABB {
        AABB {
            min: self.min - Vec2::splat(margin),
            max: self.max + Vec2::splat(margin),
        }
    }
}

impl Default for AABB {
    fn default() -> Self {
        Self {
            min: Vec2::splat(f32::MAX),
            max: Vec2::splat(f32::MIN),
        }
    }
}

/// Node reference for quadtree storage
#[derive(Debug, Clone, Copy)]
pub struct NodeRef {
    pub id: u64,
    pub position: Vec2,
}

/// Quadtree node
struct QuadNode {
    bounds: AABB,
    children: Option<Box<[QuadNode; 4]>>,
    items: Vec<NodeRef>,
    mass_center: Vec2,
    total_mass: f32,
}

impl QuadNode {
    fn new(bounds: AABB) -> Self {
        Self {
            bounds,
            children: None,
            items: Vec::new(),
            mass_center: bounds.center(),
            total_mass: 0.0,
        }
    }

    fn is_leaf(&self) -> bool {
        self.children.is_none()
    }

    fn subdivide(&mut self) {
        let center = self.bounds.center();
        let min = self.bounds.min;
        let max = self.bounds.max;

        self.children = Some(Box::new([
            QuadNode::new(AABB::new(min, center)),
            QuadNode::new(AABB::new(Vec2::new(center.x, min.y), Vec2::new(max.x, center.y))),
            QuadNode::new(AABB::new(Vec2::new(min.x, center.y), Vec2::new(center.x, max.y))),
            QuadNode::new(AABB::new(center, max)),
        ]));
    }

    fn get_quadrant(&self, point: Vec2) -> usize {
        let center = self.bounds.center();
        let x = if point.x >= center.x { 1 } else { 0 };
        let y = if point.y >= center.y { 2 } else { 0 };
        x + y
    }

    fn insert(&mut self, item: NodeRef, max_depth: u32, depth: u32) {
        // Update mass center for Barnes-Hut
        let old_mass = self.total_mass;
        self.total_mass += 1.0;
        self.mass_center = (self.mass_center * old_mass + item.position) / self.total_mass;

        if self.is_leaf() {
            if self.items.len() < 4 || depth >= max_depth {
                self.items.push(item);
                return;
            }

            // Need to subdivide
            self.subdivide();

            // Move existing items to children
            let items = std::mem::take(&mut self.items);
            for old_item in items {
                let quad = self.get_quadrant(old_item.position);
                if let Some(children) = &mut self.children {
                    children[quad].insert(old_item, max_depth, depth + 1);
                }
            }
        }

        // Insert into appropriate child
        let quad = self.get_quadrant(item.position);
        if let Some(children) = &mut self.children {
            children[quad].insert(item, max_depth, depth + 1);
        }
    }

    fn query_range(&self, range: &AABB, results: &mut Vec<u64>) {
        if !self.bounds.intersects(range) {
            return;
        }

        for item in &self.items {
            if range.contains(item.position) {
                results.push(item.id);
            }
        }

        if let Some(children) = &self.children {
            for child in children.iter() {
                child.query_range(range, results);
            }
        }
    }

    fn query_point(&self, point: Vec2, radius: f32) -> Option<(u64, f32)> {
        let range = AABB::from_center_size(point, Vec2::splat(radius * 2.0));
        if !self.bounds.intersects(&range) {
            return None;
        }

        let mut best: Option<(u64, f32)> = None;

        for item in &self.items {
            let dist = item.position.distance(point);
            if dist <= radius {
                if best.is_none() || dist < best.unwrap().1 {
                    best = Some((item.id, dist));
                }
            }
        }

        if let Some(children) = &self.children {
            for child in children.iter() {
                if let Some((id, dist)) = child.query_point(point, radius) {
                    if best.is_none() || dist < best.unwrap().1 {
                        best = Some((id, dist));
                    }
                }
            }
        }

        best
    }

    /// Barnes-Hut force approximation
    fn calculate_repulsion(&self, pos: Vec2, theta: f32) -> Vec2 {
        if self.total_mass == 0.0 {
            return Vec2::ZERO;
        }

        let diff = self.mass_center - pos;
        let dist = diff.length();

        if dist < 0.001 {
            return Vec2::ZERO;
        }

        let size = self.bounds.size().max_element();

        // If node is far enough, use approximation
        if self.is_leaf() || size / dist < theta {
            // Coulomb's law approximation
            let force_mag = self.total_mass / (dist * dist);
            return -diff.normalize() * force_mag;
        }

        // Otherwise recurse into children
        let mut force = Vec2::ZERO;
        if let Some(children) = &self.children {
            for child in children.iter() {
                force += child.calculate_repulsion(pos, theta);
            }
        }

        // Also add force from items at this node
        for item in &self.items {
            let d = item.position - pos;
            let dist = d.length();
            if dist > 0.001 {
                let force_mag = 1.0 / (dist * dist);
                force -= d.normalize() * force_mag;
            }
        }

        force
    }
}

/// Quadtree spatial index
pub struct Quadtree {
    root: Option<QuadNode>,
    bounds: AABB,
    max_depth: u32,
}

impl Quadtree {
    pub fn new() -> Self {
        Self {
            root: None,
            bounds: AABB::default(),
            max_depth: 10,
        }
    }

    pub fn clear(&mut self) {
        self.root = None;
        self.bounds = AABB::default();
    }

    pub fn rebuild(&mut self, nodes: &HashMap<u64, super::GraphNode>) {
        self.clear();

        if nodes.is_empty() {
            return;
        }

        // Calculate bounds
        for node in nodes.values() {
            self.bounds.expand(node.position);
        }

        // Add margin
        self.bounds = self.bounds.expand_by(100.0);

        // Create root and insert all nodes
        self.root = Some(QuadNode::new(self.bounds));

        for node in nodes.values() {
            let item = NodeRef {
                id: node.entity_id,
                position: node.position,
            };
            if let Some(root) = &mut self.root {
                root.insert(item, self.max_depth, 0);
            }
        }
    }

    /// Query nodes within a bounding box
    pub fn query_visible(&self, view_bounds: &AABB) -> Vec<u64> {
        let mut results = Vec::new();
        if let Some(root) = &self.root {
            root.query_range(view_bounds, &mut results);
        }
        results
    }

    /// Query the closest node to a point within radius
    pub fn query_point(&self, pos: Vec2, radius: f32) -> Option<u64> {
        if let Some(root) = &self.root {
            root.query_point(pos, radius).map(|(id, _)| id)
        } else {
            None
        }
    }

    /// Calculate repulsion force using Barnes-Hut approximation
    /// theta: accuracy parameter (0.5-0.9, lower = more accurate)
    pub fn calculate_repulsion(&self, pos: Vec2, theta: f32) -> Vec2 {
        if let Some(root) = &self.root {
            root.calculate_repulsion(pos, theta)
        } else {
            Vec2::ZERO
        }
    }

    #[allow(dead_code)]
    pub fn bounds(&self) -> AABB {
        self.bounds
    }
}

impl Default for Quadtree {
    fn default() -> Self {
        Self::new()
    }
}
