//! SpacetimeDB client connection and table subscriptions
//!
//! For WASM builds, we use a JavaScript bridge to communicate with the
//! TypeScript SpacetimeDB client (window.frugworldBridge).

use crate::graph::GraphStore;
use std::cell::RefCell;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

// ============================================================================
// JavaScript Bridge (WASM only)
// ============================================================================

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = isConnected)]
    fn js_is_connected() -> bool;

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = startDialogue, catch)]
    fn js_start_dialogue(npc_id: u64) -> Result<(), JsValue>;

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = dialogueSay, catch)]
    fn js_dialogue_say(text: &str) -> Result<(), JsValue>;

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = endDialogue, catch)]
    fn js_end_dialogue() -> Result<(), JsValue>;

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = onDialogueLine)]
    fn js_on_dialogue_line(callback: &Closure<dyn FnMut(JsValue)>);
}

// Thread-local queue for incoming dialogue lines from JS
// Format: (is_player, text)
thread_local! {
    static DIALOGUE_QUEUE: RefCell<Vec<(bool, String)>> = RefCell::new(Vec::new());
}

#[cfg(target_arch = "wasm32")]
thread_local! {
    static DIALOGUE_CALLBACK: RefCell<Option<wasm_bindgen::closure::Closure<dyn FnMut(JsValue)>>> = RefCell::new(None);
}

/// Check if bridge is connected to SpacetimeDB
#[cfg(target_arch = "wasm32")]
pub fn bridge_is_connected() -> bool {
    let connected = js_is_connected();
    log::debug!("[Bridge] isConnected check: {}", connected);
    connected
}

#[cfg(not(target_arch = "wasm32"))]
pub fn bridge_is_connected() -> bool {
    false
}

/// Start dialogue with an NPC via the JS bridge
#[cfg(target_arch = "wasm32")]
pub fn start_dialogue(npc_id: u64) -> Result<(), String> {
    log::info!("[Bridge] start_dialogue called with npc_id={}", npc_id);
    match js_start_dialogue(npc_id) {
        Ok(_) => {
            log::info!("[Bridge] start_dialogue succeeded");
            Ok(())
        }
        Err(e) => {
            let err_msg = format!("{:?}", e);
            log::error!("[Bridge] start_dialogue failed: {}", err_msg);
            Err(err_msg)
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn start_dialogue(_npc_id: u64) -> Result<(), String> {
    Err("Not available outside WASM".to_string())
}

/// Send dialogue message via the JS bridge
#[cfg(target_arch = "wasm32")]
pub fn dialogue_say(text: &str) -> Result<(), String> {
    log::info!("[Bridge] dialogue_say called with text=\"{}\"", text);
    match js_dialogue_say(text) {
        Ok(_) => {
            log::info!("[Bridge] dialogue_say succeeded");
            Ok(())
        }
        Err(e) => {
            let err_msg = format!("{:?}", e);
            log::error!("[Bridge] dialogue_say failed: {}", err_msg);
            Err(err_msg)
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn dialogue_say(_text: &str) -> Result<(), String> {
    Err("Not available outside WASM".to_string())
}

/// End dialogue via the JS bridge
#[cfg(target_arch = "wasm32")]
pub fn end_dialogue() -> Result<(), String> {
    js_end_dialogue().map_err(|e| format!("{:?}", e))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn end_dialogue() -> Result<(), String> {
    Err("Not available outside WASM".to_string())
}

/// Set up the dialogue callback to receive responses from the JS bridge
#[cfg(target_arch = "wasm32")]
pub fn setup_dialogue_callback() {
    let callback = Closure::wrap(Box::new(move |value: JsValue| {
        // Parse the dialogue line from JS
        if let Ok(speaker) = js_sys::Reflect::get(&value, &"speaker".into()) {
            let is_player = speaker.as_string().map(|s| s == "player").unwrap_or(false);
            if let Ok(text) = js_sys::Reflect::get(&value, &"text".into()) {
                if let Some(text) = text.as_string() {
                    log::info!("Received dialogue line: speaker={}, text={}",
                        if is_player { "player" } else { "npc" }, &text);
                    DIALOGUE_QUEUE.with(|q| {
                        q.borrow_mut().push((is_player, text));
                    });
                }
            }
        }
    }) as Box<dyn FnMut(JsValue)>);

    js_on_dialogue_line(&callback);

    // Store the callback to prevent it from being dropped
    DIALOGUE_CALLBACK.with(|c| {
        *c.borrow_mut() = Some(callback);
    });

    log::info!("Dialogue callback set up");
}

#[cfg(not(target_arch = "wasm32"))]
pub fn setup_dialogue_callback() {
    // No-op on native
}

/// Poll for dialogue responses from the JS bridge
pub fn poll_dialogue_responses() -> Vec<(bool, String)> {
    DIALOGUE_QUEUE.with(|q| q.borrow_mut().drain(..).collect())
}

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
