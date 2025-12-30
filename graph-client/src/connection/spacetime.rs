//! SpacetimeDB client connection via JavaScript bridge
//!
//! For WASM builds, we use a JavaScript bridge to communicate with the
//! TypeScript SpacetimeDB client (window.frugworldBridge).
//!
//! The bridge provides:
//! - Connection state management
//! - Bulk data fetchers for initial load
//! - Real-time table change callbacks
//! - Reducer calls for player interactions

use crate::graph::GraphStore;
use serde::Deserialize;
use std::cell::RefCell;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

// ============================================================================
// JavaScript Bridge Bindings (WASM only)
// ============================================================================

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
extern "C" {
    // === CONNECTION ===
    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = isConnected)]
    fn js_is_connected() -> bool;

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = getConnectionState)]
    fn js_get_connection_state() -> String;

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = getIdentity)]
    fn js_get_identity() -> JsValue;

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = getLocalEntityId)]
    fn js_get_local_entity_id() -> JsValue;

    // === BULK DATA FETCHERS ===
    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = getEntities)]
    fn js_get_entities() -> JsValue;

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = getTransforms)]
    fn js_get_transforms() -> JsValue;

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = getNpcBlueprints)]
    fn js_get_npc_blueprints() -> JsValue;

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = getNpcStates)]
    fn js_get_npc_states() -> JsValue;

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = getNpcNpcRelationships)]
    fn js_get_relationships() -> JsValue;

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = getPlayers)]
    fn js_get_players() -> JsValue;

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = getWorldMessages)]
    fn js_get_world_messages() -> JsValue;

    // === TABLE CHANGE CALLBACKS ===
    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = onEntityChange)]
    fn js_on_entity_change(callback: &Closure<dyn FnMut(String, JsValue)>);

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = onTransformChange)]
    fn js_on_transform_change(callback: &Closure<dyn FnMut(String, JsValue)>);

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = onNpcStateChange)]
    fn js_on_npc_state_change(callback: &Closure<dyn FnMut(String, JsValue)>);

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = onNpcBlueprintChange)]
    fn js_on_npc_blueprint_change(callback: &Closure<dyn FnMut(String, JsValue)>);

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = onRelationshipChange)]
    fn js_on_relationship_change(callback: &Closure<dyn FnMut(String, JsValue)>);

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = onPlayerChange)]
    fn js_on_player_change(callback: &Closure<dyn FnMut(String, JsValue)>);

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = onWorldMessageChange)]
    fn js_on_world_message_change(callback: &Closure<dyn FnMut(String, JsValue)>);

    // === REDUCERS ===
    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = playerConnect)]
    fn js_player_connect(name: &str);

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = submitInput)]
    fn js_submit_input(input: JsValue);

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = startDialogue, catch)]
    fn js_start_dialogue(npc_id: u64) -> Result<(), JsValue>;

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = dialogueSay, catch)]
    fn js_dialogue_say(text: &str) -> Result<(), JsValue>;

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = endDialogue, catch)]
    fn js_end_dialogue() -> Result<(), JsValue>;

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = sendMessage)]
    fn js_send_message(text: &str);

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = yellMessage)]
    fn js_yell_message(text: &str);

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = performGesture)]
    fn js_perform_gesture(gesture_type: &str, target_npc_ids: JsValue);

    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = subscribeChunks)]
    fn js_subscribe_chunks(entity_id: u32, chunk_cxs: JsValue, chunk_cys: JsValue);

    // === DIALOGUE CALLBACKS (existing) ===
    #[wasm_bindgen(js_namespace = ["window", "frugworldBridge"], js_name = onDialogueLine)]
    fn js_on_dialogue_line(callback: &Closure<dyn FnMut(JsValue)>);
}

// ============================================================================
// Data Structures (matching JavaScript bridge types)
// ============================================================================

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JsEntity {
    pub entity_id: u64,
    pub kind: u16,
    pub archetype_id: u32,
    pub zone_id: u64,
    pub chunk_x: i32,
    pub chunk_y: i32,
    pub alive: bool,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JsTransform {
    pub entity_id: u64,
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub yaw: i16,
    pub vx: i32,
    pub vy: i32,
    pub vz: i32,
    pub last_tick: u64,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JsNpcBlueprint {
    pub npc_id: u64,
    pub name: String,
    pub archetype_id: u32,
    pub extraversion: u8,
    pub agreeableness: u8,
    pub life_stage: u8,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JsNpcState {
    pub npc_id: u64,
    pub lod_state: u8,
    pub short_intent: Option<String>,
    pub mid_goal: Option<String>,
    pub long_goal: Option<String>,
    pub needs_summary: Option<String>,
    pub memory_summary: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JsRelationship {
    pub id: u64,
    pub npc_a_id: u64,
    pub npc_b_id: u64,
    pub affinity_a_to_b: i16,
    pub affinity_b_to_a: i16,
    pub trust_a_to_b: i16,
    pub trust_b_to_a: i16,
    pub interaction_count: u32,
    pub relationship_type: u16,
    pub flags: u32,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JsPlayer {
    pub identity: String,
    pub entity_id: u64,
    pub name: String,
    pub last_input_seq: u32,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JsWorldMessage {
    pub message_id: u64,
    pub sender_id: u64,
    pub sender_name: String,
    pub message: String,
    pub is_yell: bool,
    pub chunk_x: i32,
    pub chunk_y: i32,
    pub pos_x: i32,
    pub pos_y: i32,
    pub pos_z: i32,
    pub ts_ms: u64,
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JsInputData {
    pub input_seq: u32,
    pub client_time_ms: i64,
    pub move_x: i16,
    pub move_y: i16,
    pub actions: u32,
    pub aim_yaw: i16,
    pub predicted_x: i32,
    pub predicted_y: i32,
    pub predicted_z: i32,
}

// ============================================================================
// Change Event Queues (thread-local storage for WASM)
// ============================================================================

thread_local! {
    static ENTITY_QUEUE: RefCell<Vec<(String, JsEntity)>> = RefCell::new(Vec::new());
    static TRANSFORM_QUEUE: RefCell<Vec<(String, JsTransform)>> = RefCell::new(Vec::new());
    static BLUEPRINT_QUEUE: RefCell<Vec<(String, JsNpcBlueprint)>> = RefCell::new(Vec::new());
    static STATE_QUEUE: RefCell<Vec<(String, JsNpcState)>> = RefCell::new(Vec::new());
    static RELATIONSHIP_QUEUE: RefCell<Vec<(String, JsRelationship)>> = RefCell::new(Vec::new());
    static DIALOGUE_QUEUE: RefCell<Vec<(bool, String)>> = RefCell::new(Vec::new());
}

#[cfg(target_arch = "wasm32")]
thread_local! {
    static ENTITY_CALLBACK: RefCell<Option<Closure<dyn FnMut(String, JsValue)>>> = RefCell::new(None);
    static TRANSFORM_CALLBACK: RefCell<Option<Closure<dyn FnMut(String, JsValue)>>> = RefCell::new(None);
    static BLUEPRINT_CALLBACK: RefCell<Option<Closure<dyn FnMut(String, JsValue)>>> = RefCell::new(None);
    static STATE_CALLBACK: RefCell<Option<Closure<dyn FnMut(String, JsValue)>>> = RefCell::new(None);
    static RELATIONSHIP_CALLBACK: RefCell<Option<Closure<dyn FnMut(String, JsValue)>>> = RefCell::new(None);
    static DIALOGUE_CALLBACK: RefCell<Option<Closure<dyn FnMut(JsValue)>>> = RefCell::new(None);
}

// ============================================================================
// Bridge API Functions
// ============================================================================

/// Check if bridge is connected to SpacetimeDB
#[cfg(target_arch = "wasm32")]
pub fn bridge_is_connected() -> bool {
    js_is_connected()
}

#[cfg(not(target_arch = "wasm32"))]
pub fn bridge_is_connected() -> bool {
    false
}

/// Get connection state as string
#[cfg(target_arch = "wasm32")]
pub fn bridge_get_connection_state() -> String {
    js_get_connection_state()
}

#[cfg(not(target_arch = "wasm32"))]
pub fn bridge_get_connection_state() -> String {
    "disconnected".to_string()
}

/// Get local player entity ID
#[cfg(target_arch = "wasm32")]
pub fn bridge_get_local_entity_id() -> Option<u64> {
    let val = js_get_local_entity_id();
    if val.is_null() || val.is_undefined() {
        None
    } else {
        val.as_f64().map(|f| f as u64)
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn bridge_get_local_entity_id() -> Option<u64> {
    None
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

/// Send chat message
#[cfg(target_arch = "wasm32")]
pub fn send_message(text: &str) {
    log::info!("[Bridge] send_message called: {}", text);
    js_send_message(text);
}

#[cfg(not(target_arch = "wasm32"))]
pub fn send_message(_text: &str) {}

/// Yell message (louder, affects NPCs)
#[cfg(target_arch = "wasm32")]
pub fn yell_message(text: &str) {
    log::info!("[Bridge] yell_message called: {}", text);
    js_yell_message(text);
}

#[cfg(not(target_arch = "wasm32"))]
pub fn yell_message(_text: &str) {}

/// Perform gesture toward NPCs
#[cfg(target_arch = "wasm32")]
pub fn perform_gesture(gesture_type: &str, target_npc_ids: &[u64]) {
    log::info!(
        "[Bridge] perform_gesture called: {} toward {:?}",
        gesture_type,
        target_npc_ids
    );
    let ids_js = serde_wasm_bindgen::to_value(target_npc_ids).unwrap_or(JsValue::NULL);
    js_perform_gesture(gesture_type, ids_js);
}

#[cfg(not(target_arch = "wasm32"))]
pub fn perform_gesture(_gesture_type: &str, _target_npc_ids: &[u64]) {}

/// Submit player input
#[cfg(target_arch = "wasm32")]
pub fn submit_input(input: JsInputData) {
    if let Ok(input_js) = serde_wasm_bindgen::to_value(&input) {
        js_submit_input(input_js);
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn submit_input(_input: JsInputData) {}

/// Set up the dialogue callback to receive responses from the JS bridge
#[cfg(target_arch = "wasm32")]
pub fn setup_dialogue_callback() {
    let callback = Closure::wrap(Box::new(move |value: JsValue| {
        if let Ok(speaker) = js_sys::Reflect::get(&value, &"speaker".into()) {
            let is_player = speaker.as_string().map(|s| s == "player").unwrap_or(false);
            if let Ok(text) = js_sys::Reflect::get(&value, &"text".into()) {
                if let Some(text) = text.as_string() {
                    log::info!(
                        "Received dialogue line: speaker={}, text={}",
                        if is_player { "player" } else { "npc" },
                        &text
                    );
                    DIALOGUE_QUEUE.with(|q| {
                        q.borrow_mut().push((is_player, text));
                    });
                }
            }
        }
    }) as Box<dyn FnMut(JsValue)>);

    js_on_dialogue_line(&callback);

    DIALOGUE_CALLBACK.with(|c| {
        *c.borrow_mut() = Some(callback);
    });

    log::info!("Dialogue callback set up");
}

#[cfg(not(target_arch = "wasm32"))]
pub fn setup_dialogue_callback() {}

/// Poll for dialogue responses from the JS bridge
pub fn poll_dialogue_responses() -> Vec<(bool, String)> {
    DIALOGUE_QUEUE.with(|q| q.borrow_mut().drain(..).collect())
}

// ============================================================================
// Change Queue Polling
// ============================================================================

pub fn poll_entity_changes() -> Vec<(String, JsEntity)> {
    ENTITY_QUEUE.with(|q| q.borrow_mut().drain(..).collect())
}

pub fn poll_transform_changes() -> Vec<(String, JsTransform)> {
    TRANSFORM_QUEUE.with(|q| q.borrow_mut().drain(..).collect())
}

pub fn poll_blueprint_changes() -> Vec<(String, JsNpcBlueprint)> {
    BLUEPRINT_QUEUE.with(|q| q.borrow_mut().drain(..).collect())
}

pub fn poll_state_changes() -> Vec<(String, JsNpcState)> {
    STATE_QUEUE.with(|q| q.borrow_mut().drain(..).collect())
}

pub fn poll_relationship_changes() -> Vec<(String, JsRelationship)> {
    RELATIONSHIP_QUEUE.with(|q| q.borrow_mut().drain(..).collect())
}

// ============================================================================
// Connection State
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Error,
}

// ============================================================================
// GraphConnection - Main connection wrapper
// ============================================================================

pub struct GraphConnection {
    url: String,
    state: ConnectionState,
    callbacks_setup: bool,
}

impl GraphConnection {
    pub fn new(url: &str) -> Result<Self, String> {
        Ok(Self {
            url: url.to_string(),
            state: ConnectionState::Disconnected,
            callbacks_setup: false,
        })
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn state(&self) -> ConnectionState {
        self.state
    }

    /// Connect to SpacetimeDB via JavaScript bridge and load initial data
    pub fn connect(&mut self, store: &mut GraphStore) -> Result<(), String> {
        self.state = ConnectionState::Connecting;

        // Check if JS bridge is connected
        if !bridge_is_connected() {
            log::info!("Waiting for JS bridge connection...");
            return Ok(());
        }

        log::info!("JS bridge is connected, loading initial data...");

        // Load initial data from bridge
        self.load_entities(store)?;
        self.load_blueprints(store)?;
        self.load_states(store)?;
        self.load_relationships(store)?;

        // Setup streaming callbacks (only once)
        if !self.callbacks_setup {
            self.setup_callbacks();
            self.callbacks_setup = true;
        }

        self.state = ConnectionState::Connected;
        log::info!(
            "Connected via JS bridge: {} nodes, {} edges",
            store.node_count,
            store.edge_count
        );

        Ok(())
    }

    /// Load entities from bridge
    #[cfg(target_arch = "wasm32")]
    fn load_entities(&self, store: &mut GraphStore) -> Result<(), String> {
        let entities_js = js_get_entities();
        let entities: Vec<JsEntity> = serde_wasm_bindgen::from_value(entities_js)
            .map_err(|e| format!("Failed to parse entities: {:?}", e))?;

        log::info!("Loading {} entities", entities.len());

        for entity in entities {
            // Only add NPCs (kind=1) that are alive
            if entity.kind == 1 && entity.alive {
                store.add_node(entity.entity_id, entity.chunk_x, entity.chunk_y);
            }
        }

        Ok(())
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn load_entities(&self, _store: &mut GraphStore) -> Result<(), String> {
        Ok(())
    }

    /// Load NPC blueprints from bridge
    #[cfg(target_arch = "wasm32")]
    fn load_blueprints(&self, store: &mut GraphStore) -> Result<(), String> {
        let blueprints_js = js_get_npc_blueprints();
        let blueprints: Vec<JsNpcBlueprint> = serde_wasm_bindgen::from_value(blueprints_js)
            .map_err(|e| format!("Failed to parse blueprints: {:?}", e))?;

        log::info!("Loading {} NPC blueprints", blueprints.len());

        for bp in blueprints {
            store.update_node_blueprint(bp.npc_id, bp.name.clone(), bp.archetype_id);
            store.update_node_personality(
                bp.npc_id,
                bp.extraversion,
                bp.agreeableness,
                bp.life_stage,
            );
        }

        Ok(())
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn load_blueprints(&self, _store: &mut GraphStore) -> Result<(), String> {
        Ok(())
    }

    /// Load NPC states from bridge
    #[cfg(target_arch = "wasm32")]
    fn load_states(&self, store: &mut GraphStore) -> Result<(), String> {
        let states_js = js_get_npc_states();
        let states: Vec<JsNpcState> = serde_wasm_bindgen::from_value(states_js)
            .map_err(|e| format!("Failed to parse states: {:?}", e))?;

        log::info!("Loading {} NPC states", states.len());

        for state in states {
            store.update_node_lod(state.npc_id, state.lod_state);
            store.update_node_activity(
                state.npc_id,
                state.short_intent.clone().unwrap_or_default(),
                state.mid_goal.clone().unwrap_or_default(),
                state.long_goal.clone().unwrap_or_default(),
                state.needs_summary.clone().unwrap_or_default(),
                state.memory_summary.clone().unwrap_or_default(),
            );
        }

        Ok(())
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn load_states(&self, _store: &mut GraphStore) -> Result<(), String> {
        Ok(())
    }

    /// Load NPC-NPC relationships from bridge
    #[cfg(target_arch = "wasm32")]
    fn load_relationships(&self, store: &mut GraphStore) -> Result<(), String> {
        let rels_js = js_get_relationships();
        let relationships: Vec<JsRelationship> = serde_wasm_bindgen::from_value(rels_js)
            .map_err(|e| format!("Failed to parse relationships: {:?}", e))?;

        log::info!("Loading {} NPC relationships", relationships.len());

        for rel in relationships {
            store.upsert_edge(
                rel.id,
                rel.npc_a_id,
                rel.npc_b_id,
                rel.relationship_type,
                rel.affinity_a_to_b,
                rel.affinity_b_to_a,
                rel.interaction_count,
                rel.flags,
            );
        }

        Ok(())
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn load_relationships(&self, _store: &mut GraphStore) -> Result<(), String> {
        Ok(())
    }

    /// Setup streaming change callbacks
    #[cfg(target_arch = "wasm32")]
    fn setup_callbacks(&self) {
        log::info!("Setting up bridge change callbacks");

        // Entity changes
        let entity_callback =
            Closure::wrap(
                Box::new(move |action: String, data: JsValue| match serde_wasm_bindgen::from_value::<JsEntity>(data) {
                    Ok(entity) => {
                        ENTITY_QUEUE.with(|q| q.borrow_mut().push((action, entity)));
                    }
                    Err(e) => {
                        log::warn!("Failed to parse entity change: {:?}", e);
                    }
                }) as Box<dyn FnMut(String, JsValue)>,
            );
        js_on_entity_change(&entity_callback);
        ENTITY_CALLBACK.with(|c| *c.borrow_mut() = Some(entity_callback));

        // Transform changes
        let transform_callback =
            Closure::wrap(
                Box::new(move |action: String, data: JsValue| match serde_wasm_bindgen::from_value::<JsTransform>(data) {
                    Ok(transform) => {
                        TRANSFORM_QUEUE.with(|q| q.borrow_mut().push((action, transform)));
                    }
                    Err(e) => {
                        log::warn!("Failed to parse transform change: {:?}", e);
                    }
                }) as Box<dyn FnMut(String, JsValue)>,
            );
        js_on_transform_change(&transform_callback);
        TRANSFORM_CALLBACK.with(|c| *c.borrow_mut() = Some(transform_callback));

        // Blueprint changes
        let blueprint_callback =
            Closure::wrap(
                Box::new(move |action: String, data: JsValue| match serde_wasm_bindgen::from_value::<JsNpcBlueprint>(data) {
                    Ok(bp) => {
                        BLUEPRINT_QUEUE.with(|q| q.borrow_mut().push((action, bp)));
                    }
                    Err(e) => {
                        log::warn!("Failed to parse blueprint change: {:?}", e);
                    }
                }) as Box<dyn FnMut(String, JsValue)>,
            );
        js_on_npc_blueprint_change(&blueprint_callback);
        BLUEPRINT_CALLBACK.with(|c| *c.borrow_mut() = Some(blueprint_callback));

        // State changes
        let state_callback =
            Closure::wrap(
                Box::new(move |action: String, data: JsValue| match serde_wasm_bindgen::from_value::<JsNpcState>(data) {
                    Ok(state) => {
                        STATE_QUEUE.with(|q| q.borrow_mut().push((action, state)));
                    }
                    Err(e) => {
                        log::warn!("Failed to parse state change: {:?}", e);
                    }
                }) as Box<dyn FnMut(String, JsValue)>,
            );
        js_on_npc_state_change(&state_callback);
        STATE_CALLBACK.with(|c| *c.borrow_mut() = Some(state_callback));

        // Relationship changes
        let relationship_callback =
            Closure::wrap(
                Box::new(move |action: String, data: JsValue| match serde_wasm_bindgen::from_value::<JsRelationship>(data) {
                    Ok(rel) => {
                        RELATIONSHIP_QUEUE.with(|q| q.borrow_mut().push((action, rel)));
                    }
                    Err(e) => {
                        log::warn!("Failed to parse relationship change: {:?}", e);
                    }
                }) as Box<dyn FnMut(String, JsValue)>,
            );
        js_on_relationship_change(&relationship_callback);
        RELATIONSHIP_CALLBACK.with(|c| *c.borrow_mut() = Some(relationship_callback));

        log::info!("Bridge change callbacks set up");
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn setup_callbacks(&self) {}

    /// Poll for updates from SpacetimeDB via bridge
    pub fn poll_updates(&mut self, store: &mut GraphStore) {
        // Check connection state
        let js_state = bridge_get_connection_state();
        let new_state = match js_state.as_str() {
            "connected" => {
                // If we were disconnected and now connected, reload data
                if self.state != ConnectionState::Connected {
                    log::info!("Reconnected, reloading data...");
                    let _ = self.load_entities(store);
                    let _ = self.load_blueprints(store);
                    let _ = self.load_states(store);
                    let _ = self.load_relationships(store);
                }
                ConnectionState::Connected
            }
            "connecting" => ConnectionState::Connecting,
            _ => ConnectionState::Disconnected,
        };

        if new_state != self.state {
            log::info!("Connection state: {:?} -> {:?}", self.state, new_state);
            self.state = new_state;
        }

        if self.state != ConnectionState::Connected {
            return;
        }

        // Process entity changes
        for (action, entity) in poll_entity_changes() {
            match action.as_str() {
                "insert" | "update" => {
                    if entity.kind == 1 && entity.alive {
                        store.add_node(entity.entity_id, entity.chunk_x, entity.chunk_y);
                    } else if entity.kind == 1 && !entity.alive {
                        store.remove_node(entity.entity_id);
                    }
                }
                "delete" => {
                    store.remove_node(entity.entity_id);
                }
                _ => {}
            }
        }

        // Process blueprint changes
        for (action, bp) in poll_blueprint_changes() {
            if action == "insert" || action == "update" {
                store.update_node_blueprint(bp.npc_id, bp.name.clone(), bp.archetype_id);
                store.update_node_personality(
                    bp.npc_id,
                    bp.extraversion,
                    bp.agreeableness,
                    bp.life_stage,
                );
            }
        }

        // Process state changes
        for (action, state) in poll_state_changes() {
            if action == "insert" || action == "update" {
                store.update_node_lod(state.npc_id, state.lod_state);
                store.update_node_activity(
                    state.npc_id,
                    state.short_intent.clone().unwrap_or_default(),
                    state.mid_goal.clone().unwrap_or_default(),
                    state.long_goal.clone().unwrap_or_default(),
                    state.needs_summary.clone().unwrap_or_default(),
                    state.memory_summary.clone().unwrap_or_default(),
                );
            }
        }

        // Process relationship changes
        for (action, rel) in poll_relationship_changes() {
            match action.as_str() {
                "insert" | "update" => {
                    store.upsert_edge(
                        rel.id,
                        rel.npc_a_id,
                        rel.npc_b_id,
                        rel.relationship_type,
                        rel.affinity_a_to_b,
                        rel.affinity_b_to_a,
                        rel.interaction_count,
                        rel.flags,
                    );
                }
                "delete" => {
                    store.remove_edge(rel.id);
                }
                _ => {}
            }
        }
    }

    /// Disconnect from SpacetimeDB
    pub fn disconnect(&mut self) {
        self.state = ConnectionState::Disconnected;
        log::info!("Disconnected from SpacetimeDB");
    }
}
