//! SpacetimeDB client connection and table subscriptions
//!
//! Note: For WASM builds, we use test data instead of the full SpacetimeDB SDK
//! (which requires OpenSSL). In production, this will be replaced with
//! JavaScript interop to the existing TypeScript SpacetimeDB client.

use crate::graph::GraphStore;

/// Connection state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Error,
}

/// SpacetimeDB connection wrapper (WASM-compatible stub)
pub struct GraphConnection {
    url: String,
    state: ConnectionState,
}

impl GraphConnection {
    /// Create a new connection (not yet connected)
    pub fn new(url: &str) -> Result<Self, String> {
        Ok(Self {
            url: url.to_string(),
            state: ConnectionState::Disconnected,
        })
    }

    /// Get connection URL
    #[allow(dead_code)]
    pub fn url(&self) -> &str {
        &self.url
    }

    /// Get current connection state
    #[allow(dead_code)]
    pub fn state(&self) -> ConnectionState {
        self.state
    }

    /// Connect to SpacetimeDB and set up subscriptions
    pub fn connect(&mut self, store: &mut GraphStore) -> Result<(), String> {
        self.state = ConnectionState::Connecting;

        // TODO: Implement actual SpacetimeDB connection
        // This is a placeholder for the full implementation
        //
        // The SpacetimeDB SDK for Rust/WASM works differently than the TypeScript SDK.
        // We need to:
        // 1. Create a connection with spacetimedb_sdk::DbConnection
        // 2. Subscribe to tables: entity, npc_blueprint, npc_state, npc_npc_relationship, etc.
        // 3. Register callbacks for insert/update/delete
        //
        // For now, we'll add some test data to demonstrate the visualization

        log::info!("Connecting to SpacetimeDB at {}", self.url);

        // Add test data for development
        self.add_test_data(store);

        self.state = ConnectionState::Connected;
        log::info!("Connected to SpacetimeDB (test mode)");

        Ok(())
    }

    /// Poll for updates from SpacetimeDB
    pub fn poll_updates(&mut self, _store: &mut GraphStore) {
        if self.state != ConnectionState::Connected {
            return;
        }

        // TODO: Process any pending updates from SpacetimeDB callbacks
        // In the full implementation, this would drain queued updates from the SDK
    }

    /// Disconnect from SpacetimeDB
    #[allow(dead_code)]
    pub fn disconnect(&mut self) {
        self.state = ConnectionState::Disconnected;
        log::info!("Disconnected from SpacetimeDB");
    }

    /// Call a reducer on the server
    #[allow(dead_code)]
    pub fn call_reducer(&self, _name: &str, _args: Vec<serde_json::Value>) -> Result<(), String> {
        if self.state != ConnectionState::Connected {
            return Err("Not connected".to_string());
        }

        // TODO: Implement reducer calls
        // spacetimedb_sdk::call_reducer(name, args)

        Ok(())
    }

    /// Add test data for development
    fn add_test_data(&self, store: &mut GraphStore) {
        use rand::Rng;
        let mut rng = rand::thread_rng();

        // Create 100 test NPCs across multiple chunks
        let npc_count = 100;
        for i in 0..npc_count {
            let entity_id = 1000 + i as u64;
            let chunk_x = (i % 5) as i32 - 2;
            let chunk_y = (i / 5 % 5) as i32 - 2;

            store.add_node(entity_id, chunk_x, chunk_y);

            // Set random personality
            store.update_node_personality(
                entity_id,
                rng.gen_range(20..80),  // extraversion
                rng.gen_range(20..80),  // agreeableness
                rng.gen_range(0..4),    // life stage
            );

            // Set name based on archetype
            let archetypes = ["Villager", "Farmer", "Merchant", "Guard", "Healer"];
            let archetype_id = i % archetypes.len();
            store.update_node_blueprint(
                entity_id,
                format!("{} #{}", archetypes[archetype_id], i),
                archetype_id as u32,
            );

            // Set LOD state
            store.update_node_lod(entity_id, rng.gen_range(0..4));

            // Set activity data (sample behaviors for testing)
            let short_intents = [
                "Walking to the market",
                "Chatting with a friend",
                "Gathering resources",
                "Resting at home",
                "Working in the field",
                "Trading goods",
                "Patrolling the area",
                "Healing the wounded",
                "Idle",
            ];

            let mid_goals = [
                "Complete daily tasks",
                "Earn some gold",
                "Build stronger friendships",
                "Improve combat skills",
                "Learn a new recipe",
                "Help a neighbor",
                "Find rare herbs",
            ];

            let long_goals = [
                "Become a respected community member",
                "Save enough for a new home",
                "Master their craft",
                "Find true love",
                "Protect their family",
                "Explore the world",
            ];

            let needs = [
                "Hungry - needs food soon",
                "Well-rested and content",
                "Lonely - seeking company",
                "Tired - needs rest",
                "Satisfied with life",
                "Anxious about something",
            ];

            let memories = [
                "Had a pleasant chat with the baker. Traded vegetables for bread. Saw a stranger pass through town.",
                "Worked hard in the fields today. Shared a meal with family. Heard rumors of trouble.",
                "Made a new friend at the tavern. Lost a few coins gambling. Helped fix a broken cart.",
                "Witnessed an argument in the square. Found a lost item. Practiced skills alone.",
                "Celebrated a neighbor's birthday. Received a gift. Feeling grateful.",
            ];

            store.update_node_activity(
                entity_id,
                short_intents[rng.gen_range(0..short_intents.len())].to_string(),
                mid_goals[rng.gen_range(0..mid_goals.len())].to_string(),
                long_goals[rng.gen_range(0..long_goals.len())].to_string(),
                needs[rng.gen_range(0..needs.len())].to_string(),
                memories[rng.gen_range(0..memories.len())].to_string(),
            );
        }

        // Create relationships between nearby NPCs
        let mut relationship_id = 0u64;
        for i in 0..npc_count {
            let source_id = 1000 + i as u64;

            // Each NPC gets 3-8 relationships
            let rel_count = rng.gen_range(3..8);
            for _ in 0..rel_count {
                let target_idx = rng.gen_range(0..npc_count);
                if target_idx == i {
                    continue;
                }

                let target_id = 1000 + target_idx as u64;

                // Random relationship type
                let rel_type: u16 = match rng.gen_range(0..10) {
                    0..=4 => 0, // Stranger (50%)
                    5..=6 => 1, // Acquaintance (20%)
                    7..=8 => 2, // Friend (20%)
                    9 => if rng.gen_bool(0.5) { 4 } else { 3 }, // Rival or CloseFriend (10%)
                    _ => 0,
                };

                store.upsert_edge(
                    relationship_id,
                    source_id,
                    target_id,
                    rel_type,
                    rng.gen_range(-5000..5000),  // affinity_a_to_b
                    rng.gen_range(-5000..5000),  // affinity_b_to_a
                    rng.gen_range(0..50),        // interaction_count
                    0,                           // flags
                );

                relationship_id += 1;
            }
        }

        log::info!(
            "Added test data: {} nodes, {} edges",
            store.node_count,
            store.edge_count
        );
    }
}
