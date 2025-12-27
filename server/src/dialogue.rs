//! Dialogue System
//!
//! Implements the event-driven dialogue pipeline as specified in Section 7.
//! Dialogue is only allowed when NPC is in LOD0 and in a "talkable" state.
//!
//! The system:
//! - Receives DialogueRequest from clients
//! - Validates NPC is in LOD0 and available for dialogue
//! - Emits DialogueStarted, DialogueLine, DialogueEnded events
//! - Updates memory summaries and relationship deltas
//!
//! NOTE: Actual LLM calls are NOT performed in this module. This module
//! provides the infrastructure for dialogue. LLM integration should be
//! done via an external service that calls these reducers.

use crate::{
    current_tick, event_types::*, now_ms, EntityKind, EventLog, NpcState, Relationship,
    lod::{LodTier, HydratedState, NpcAction},
    relationship_flags,
    POSITION_SCALE,
    // Table accessor trait imports for SpacetimeDB 1.11
    entity, npc_state, npc_blueprint, transform, player, relationship, event_log, chunk,
};
use serde::{Deserialize, Serialize};
use spacetimedb::{reducer, table, ReducerContext, Table};

// =============================================================================
// Configuration
// =============================================================================

/// Maximum dialogue range in meters (effectively unlimited)
pub const DIALOGUE_RANGE_M: i32 = 10000;

/// Maximum dialogue lines per conversation before forced summarization
pub const MAX_DIALOGUE_LINES: u32 = 50;

/// Cooldown between dialogues with same NPC (milliseconds)
pub const DIALOGUE_COOLDOWN_MS: u64 = 1000; // 1 second cooldown between dialogues

/// Maximum responses per minute per NPC (rate limiting)
pub const MAX_RESPONSES_PER_MINUTE: u32 = 20;

// =============================================================================
// Dialogue State Table
// =============================================================================

/// Active dialogue session tracking.
/// Tracks ongoing conversations between players and NPCs.
#[table(name = active_dialogue, public)]
pub struct ActiveDialogue {
    /// Player entity ID
    #[primary_key]
    pub player_id: u64,

    /// NPC entity ID (one dialogue per player at a time)
    pub npc_id: u64,

    /// Dialogue session ID
    pub session_id: u64,

    /// Start timestamp
    pub started_ts_ms: u64,

    /// Last activity timestamp
    pub last_activity_ts_ms: u64,

    /// Number of lines exchanged
    pub line_count: u32,

    /// Serialized conversation context (for LLM)
    pub context: Vec<u8>,
}

/// NPC dialogue rate limiting.
#[table(name = dialogue_rate_limit, private)]
pub struct DialogueRateLimit {
    /// NPC entity ID
    #[primary_key]
    pub npc_id: u64,

    /// Responses in current minute window
    pub responses_this_minute: u32,

    /// Window start timestamp
    pub window_start_ts_ms: u64,

    /// Last dialogue end timestamp (for cooldown)
    pub last_dialogue_end_ts_ms: u64,
}

// =============================================================================
// Dialogue Context Structure
// =============================================================================

/// Context passed to LLM for dialogue generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DialogueContext {
    /// NPC identity info (from blueprint)
    pub npc_name: String,
    pub npc_role: String,
    pub npc_personality_traits: Vec<String>,

    /// Relationship state
    pub affinity: i16,
    pub trust: i16,
    pub relationship_flags: Vec<String>,

    /// Recent memory summary
    pub memory_summary: Vec<String>,

    /// Conversation summary with this player
    pub conversation_summary: String,

    /// Local world facts
    pub local_facts: Vec<String>,

    /// Current NPC state
    pub current_action: String,
    pub current_needs: NeedsSnapshot,

    /// Conversation history (last N lines)
    pub recent_lines: Vec<DialogueLineRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NeedsSnapshot {
    pub hunger: u8,
    pub fatigue: u8,
    pub safety: u8,
    pub social: u8,
    pub wealth: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DialogueLineRecord {
    pub speaker: String, // "player" or "npc"
    pub text: String,
    pub ts_ms: u64,
}

/// Response from dialogue generation (from LLM or rule-based).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DialogueResponse {
    /// The text to show to the player
    pub text: String,

    /// Intent tags for game logic
    pub intent_tags: Vec<String>,

    /// Memory updates to apply
    pub memory_delta: Vec<String>,

    /// Relationship changes
    pub relationship_delta: Option<RelationshipDelta>,

    /// Optional in-world actions (server validates)
    pub actions: Vec<DialogueAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationshipDelta {
    pub affinity_delta: i16,
    pub trust_delta: i16,
    pub flags_add: Vec<String>,
    pub flags_remove: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DialogueAction {
    pub action_type: String,
    pub params: serde_json::Value,
}

// =============================================================================
// Dialogue Request/Response Payloads
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DialogueStartedPayload {
    pub session_id: u64,
    pub npc_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DialogueEndedPayload {
    pub session_id: u64,
    pub reason: DialogueEndReason,
    pub line_count: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum DialogueEndReason {
    PlayerEnded,
    NpcEnded,
    OutOfRange,
    Timeout,
    ForcedSummary,
    NpcBusy,
}

// =============================================================================
// Reducers
// =============================================================================

/// Start a dialogue with an NPC.
/// Called by the client when player initiates conversation.
/// Logs the session_id on success.
#[reducer]
pub fn start_dialogue(ctx: &ReducerContext, npc_id: u64) -> Result<(), String> {
    log::info!("[Dialogue] start_dialogue called: npc_id={}", npc_id);

    let ts_ms = now_ms(ctx);
    let tick = current_tick(ctx);

    // Get player from identity
    let player = ctx.db.player().identity().find(ctx.sender)
        .ok_or_else(|| {
            log::warn!("[Dialogue] Player not found for identity: {:?}", ctx.sender);
            "Player not found".to_string()
        })?;

    let player_id = player.entity_id;
    log::info!("[Dialogue] Player found: entity_id={}", player_id);

    // If player is already in dialogue, end the old one first
    if let Some(existing_dialogue) = ctx.db.active_dialogue().player_id().find(player_id) {
        log::info!("[Dialogue] Player {} already in dialogue with NPC {}, switching to NPC {}",
                   player_id, existing_dialogue.npc_id, npc_id);

        // If trying to talk to the same NPC, just continue the existing dialogue
        if existing_dialogue.npc_id == npc_id {
            log::info!("[Dialogue] Continuing existing dialogue with same NPC");
            return Ok(());
        }

        // End the existing dialogue silently
        ctx.db.active_dialogue().player_id().delete(player_id);

        // Update last dialogue end timestamp for the old NPC
        if let Some(rate_limit) = ctx.db.dialogue_rate_limit().npc_id().find(existing_dialogue.npc_id) {
            ctx.db.dialogue_rate_limit().npc_id().update(DialogueRateLimit {
                last_dialogue_end_ts_ms: ts_ms,
                ..rate_limit
            });
        }
    }

    // Verify NPC exists and is alive
    let npc_entity = ctx.db.entity().entity_id().find(npc_id)
        .ok_or_else(|| {
            log::warn!("[Dialogue] NPC not found: npc_id={}", npc_id);
            "NPC not found".to_string()
        })?;

    if !npc_entity.alive {
        log::warn!("[Dialogue] NPC {} is not alive", npc_id);
        return Err("NPC is not alive".to_string());
    }

    if npc_entity.kind != EntityKind::Npc.as_u16() {
        log::warn!("[Dialogue] Entity {} is not an NPC (kind={})", npc_id, npc_entity.kind);
        return Err("Target is not an NPC".to_string());
    }

    // Check distance between player and NPC (primary check - LOD may be stale)
    let player_transform = ctx.db.transform().entity_id().find(player_id)
        .ok_or_else(|| {
            log::warn!("[Dialogue] Player transform not found: player_id={}", player_id);
            "Player transform not found".to_string()
        })?;
    let npc_transform = ctx.db.transform().entity_id().find(npc_id)
        .ok_or_else(|| {
            log::warn!("[Dialogue] NPC transform not found: npc_id={}", npc_id);
            "NPC transform not found".to_string()
        })?;

    let dx = (npc_transform.x - player_transform.x) as i64;
    let dy = (npc_transform.y - player_transform.y) as i64;
    let dist_sq = dx * dx + dy * dy;
    let max_dist_sq = (DIALOGUE_RANGE_M as i64 * POSITION_SCALE as i64).pow(2);

    if dist_sq > max_dist_sq {
        log::warn!("[Dialogue] NPC {} too far: dist_sq={}, max={}", npc_id, dist_sq, max_dist_sq);
        return Err(format!("NPC distance {} exceeds max {}", dist_sq, max_dist_sq));
    }

    // Check rate limiting
    if let Some(rate_limit) = ctx.db.dialogue_rate_limit().npc_id().find(npc_id) {
        // Check cooldown
        if ts_ms < rate_limit.last_dialogue_end_ts_ms + DIALOGUE_COOLDOWN_MS {
            log::warn!("[Dialogue] NPC {} on cooldown", npc_id);
            return Err("NPC is busy, try again later".to_string());
        }

        // Check rate limit (reset window if needed)
        let window_elapsed = ts_ms - rate_limit.window_start_ts_ms;
        if window_elapsed < 60000 && rate_limit.responses_this_minute >= MAX_RESPONSES_PER_MINUTE {
            log::warn!("[Dialogue] NPC {} rate limited", npc_id);
            return Err("NPC is overwhelmed, try again later".to_string());
        }
    }

    // Generate session ID
    let session_id = crate::next_id(ctx, "dialogue_session");

    // Build initial context
    let context = build_dialogue_context(ctx, player_id, npc_id)?;
    let context_bytes = serde_json::to_vec(&context).unwrap_or_default();

    // Create active dialogue
    ctx.db.active_dialogue().try_insert(ActiveDialogue {
        player_id,
        npc_id,
        session_id,
        started_ts_ms: ts_ms,
        last_activity_ts_ms: ts_ms,
        line_count: 0,
        context: context_bytes,
    }).map_err(|e| format!("Failed to create dialogue: {}", e))?;

    // Set NPC to Talking state and face the player
    if let Some(npc_state) = ctx.db.npc_state().npc_id().find(npc_id) {
        let mut hydrated: HydratedState = if npc_state.short_intent.is_empty() {
            HydratedState::default()
        } else {
            serde_json::from_slice(&npc_state.short_intent).unwrap_or_default()
        };

        hydrated.current_action = NpcAction::Talking;
        hydrated.interaction_target = Some(player_id);
        hydrated.action_progress = 0;

        ctx.db.npc_state().npc_id().update(NpcState {
            short_intent: serde_json::to_vec(&hydrated).unwrap_or_default(),
            ..npc_state
        });
    }

    // Ensure relationship exists
    ensure_relationship(ctx, player_id, npc_id);

    // Get NPC name for event
    let npc_name = get_npc_name(ctx, npc_id);

    // Emit DialogueStarted event
    let payload = DialogueStartedPayload {
        session_id,
        npc_name: npc_name.clone(),
    };

    let _ = ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick,
        zone_id: npc_entity.zone_id,
        chunk_x: npc_entity.chunk_x,
        chunk_y: npc_entity.chunk_y,
        actor_id: Some(player_id),
        target_id: Some(npc_id),
        event_type: EventType::DialogueStarted.as_u16(),
        payload: serialize_payload(&payload),
    });

    log::info!(
        "Dialogue started: player {} with NPC {} (session {})",
        player_id,
        npc_id,
        session_id
    );

    Ok(())
}

/// Submit a player utterance in an active dialogue.
#[reducer]
pub fn dialogue_say(ctx: &ReducerContext, utterance: String) -> Result<(), String> {
    log::info!("[Dialogue] dialogue_say called: utterance=\"{}\"", utterance);

    let ts_ms = now_ms(ctx);
    let tick = current_tick(ctx);

    let player = ctx.db.player().identity().find(ctx.sender)
        .ok_or_else(|| {
            log::warn!("[Dialogue] dialogue_say: Player not found");
            "Player not found".to_string()
        })?;

    let player_id = player.entity_id;

    // Get active dialogue
    let dialogue = ctx.db.active_dialogue().player_id().find(player_id)
        .ok_or_else(|| {
            log::warn!("[Dialogue] dialogue_say: No active dialogue for player {}", player_id);
            "No active dialogue".to_string()
        })?;

    let npc_id = dialogue.npc_id;

    // Check if NPC is still in range and LOD0
    if !validate_dialogue_state(ctx, player_id, npc_id) {
        end_dialogue_internal(ctx, player_id, DialogueEndReason::OutOfRange)?;
        return Err("NPC is no longer available for dialogue".to_string());
    }

    // Get NPC entity for event
    let npc_entity = ctx.db.entity().entity_id().find(npc_id)
        .ok_or("NPC not found")?;

    // Emit player dialogue line event
    let payload = DialogueLinePayload {
        speaker_id: player_id,
        text: utterance.clone(),
        intent_tags: Vec::new(),
    };

    let _ = ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick,
        zone_id: npc_entity.zone_id,
        chunk_x: npc_entity.chunk_x,
        chunk_y: npc_entity.chunk_y,
        actor_id: Some(player_id),
        target_id: Some(npc_id),
        event_type: EventType::DialogueLine.as_u16(),
        payload: serialize_payload(&payload),
    });

    // Update dialogue state
    let new_line_count = dialogue.line_count + 1;

    // Parse existing context and add new line
    let mut context: DialogueContext = serde_json::from_slice(&dialogue.context)
        .unwrap_or_else(|_| build_dialogue_context(ctx, player_id, npc_id).unwrap_or_default());

    context.recent_lines.push(DialogueLineRecord {
        speaker: "player".to_string(),
        text: utterance,
        ts_ms,
    });

    // Keep only last 10 lines in context
    if context.recent_lines.len() > 10 {
        context.recent_lines.remove(0);
    }

    // Check if we need forced summarization
    if new_line_count >= MAX_DIALOGUE_LINES {
        end_dialogue_internal(ctx, player_id, DialogueEndReason::ForcedSummary)?;
        return Err("Conversation too long, summarizing...".to_string());
    }

    // Update active dialogue
    ctx.db.active_dialogue().player_id().update(ActiveDialogue {
        player_id,
        npc_id,
        session_id: dialogue.session_id,
        started_ts_ms: dialogue.started_ts_ms,
        last_activity_ts_ms: ts_ms,
        line_count: new_line_count,
        context: serde_json::to_vec(&context).unwrap_or_default(),
    });

    log::debug!("Player {} said to NPC {}: line {}", player_id, npc_id, new_line_count);

    Ok(())
}

/// Submit an NPC response (called by external LLM service or rule-based system).
#[reducer]
pub fn dialogue_npc_respond(
    ctx: &ReducerContext,
    player_id: u64,
    response: String, // JSON-encoded DialogueResponse
) -> Result<(), String> {
    log::info!("[Dialogue] dialogue_npc_respond called: player_id={}", player_id);

    let ts_ms = now_ms(ctx);
    let tick = current_tick(ctx);

    // Parse response
    let response: DialogueResponse = serde_json::from_str(&response)
        .map_err(|e| {
            log::error!("[Dialogue] Failed to parse response JSON: {}", e);
            format!("Invalid response format: {}", e)
        })?;

    // Get active dialogue
    let dialogue = ctx.db.active_dialogue().player_id().find(player_id)
        .ok_or_else(|| {
            log::warn!("[Dialogue] No active dialogue for player {} when trying to respond", player_id);
            "No active dialogue for player".to_string()
        })?;

    log::info!("[Dialogue] Found active dialogue for player {}: npc={}, lines={}",
               player_id, dialogue.npc_id, dialogue.line_count);

    let npc_id = dialogue.npc_id;

    // Get NPC entity for event
    let npc_entity = ctx.db.entity().entity_id().find(npc_id)
        .ok_or("NPC not found")?;

    // Emit NPC dialogue line event
    let payload = DialogueLinePayload {
        speaker_id: npc_id,
        text: response.text.clone(),
        intent_tags: response.intent_tags.clone(),
    };

    let _ = ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick,
        zone_id: npc_entity.zone_id,
        chunk_x: npc_entity.chunk_x,
        chunk_y: npc_entity.chunk_y,
        actor_id: Some(npc_id),
        target_id: Some(player_id),
        event_type: EventType::DialogueLine.as_u16(),
        payload: serialize_payload(&payload),
    });

    // Apply relationship delta if present
    if let Some(rel_delta) = response.relationship_delta {
        apply_relationship_delta(ctx, player_id, npc_id, &rel_delta)?;
    }

    // Apply memory updates
    if !response.memory_delta.is_empty() {
        apply_memory_delta(ctx, npc_id, &response.memory_delta)?;
    }

    // Process actions (validate and queue)
    for action in &response.actions {
        validate_and_queue_action(ctx, player_id, npc_id, action)?;
    }

    // Update rate limiting
    update_rate_limit(ctx, npc_id, ts_ms);

    // Update dialogue context with NPC response
    let mut context: DialogueContext = serde_json::from_slice(&dialogue.context)
        .unwrap_or_default();

    context.recent_lines.push(DialogueLineRecord {
        speaker: "npc".to_string(),
        text: response.text,
        ts_ms,
    });

    if context.recent_lines.len() > 10 {
        context.recent_lines.remove(0);
    }

    ctx.db.active_dialogue().player_id().update(ActiveDialogue {
        player_id,
        npc_id,
        session_id: dialogue.session_id,
        started_ts_ms: dialogue.started_ts_ms,
        last_activity_ts_ms: ts_ms,
        line_count: dialogue.line_count + 1,
        context: serde_json::to_vec(&context).unwrap_or_default(),
    });

    log::info!("[Dialogue] NPC {} responded to player {} successfully (new line_count={})",
               npc_id, player_id, dialogue.line_count + 1);

    Ok(())
}

/// End the current dialogue.
#[reducer]
pub fn end_dialogue(ctx: &ReducerContext) -> Result<(), String> {
    let player = ctx.db.player().identity().find(ctx.sender)
        .ok_or("Player not found")?;

    end_dialogue_internal(ctx, player.entity_id, DialogueEndReason::PlayerEnded)
}

/// Internal function to end dialogue with a specific reason.
fn end_dialogue_internal(
    ctx: &ReducerContext,
    player_id: u64,
    reason: DialogueEndReason,
) -> Result<(), String> {
    let ts_ms = now_ms(ctx);
    let tick = current_tick(ctx);

    let dialogue = ctx.db.active_dialogue().player_id().find(player_id)
        .ok_or("No active dialogue")?;

    let npc_id = dialogue.npc_id;
    let session_id = dialogue.session_id;
    let line_count = dialogue.line_count;

    // Get NPC entity for event
    let npc_entity = ctx.db.entity().entity_id().find(npc_id);

    // Emit DialogueEnded event
    let payload = DialogueEndedPayload {
        session_id,
        reason,
        line_count,
    };

    let _ = ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick,
        zone_id: npc_entity.as_ref().map_or(0, |e| e.zone_id),
        chunk_x: npc_entity.as_ref().map_or(0, |e| e.chunk_x),
        chunk_y: npc_entity.as_ref().map_or(0, |e| e.chunk_y),
        actor_id: Some(player_id),
        target_id: Some(npc_id),
        event_type: EventType::DialogueEnded.as_u16(),
        payload: serialize_payload(&payload),
    });

    // Clear NPC's interaction target and return to Idle
    if let Some(npc_state) = ctx.db.npc_state().npc_id().find(npc_id) {
        let mut hydrated: HydratedState = if npc_state.short_intent.is_empty() {
            HydratedState::default()
        } else {
            serde_json::from_slice(&npc_state.short_intent).unwrap_or_default()
        };

        hydrated.current_action = NpcAction::Idle;
        hydrated.interaction_target = None;
        hydrated.action_progress = 0;

        ctx.db.npc_state().npc_id().update(NpcState {
            short_intent: serde_json::to_vec(&hydrated).unwrap_or_default(),
            ..npc_state
        });
    }

    // Update rate limit with dialogue end time
    if let Some(rate_limit) = ctx.db.dialogue_rate_limit().npc_id().find(npc_id) {
        ctx.db.dialogue_rate_limit().npc_id().update(DialogueRateLimit {
            last_dialogue_end_ts_ms: ts_ms,
            ..rate_limit
        });
    } else {
        let _ = ctx.db.dialogue_rate_limit().try_insert(DialogueRateLimit {
            npc_id,
            responses_this_minute: 0,
            window_start_ts_ms: ts_ms,
            last_dialogue_end_ts_ms: ts_ms,
        });
    }

    // Delete active dialogue
    ctx.db.active_dialogue().player_id().delete(player_id);

    log::info!(
        "Dialogue ended: session {} with {} lines (reason: {:?})",
        session_id,
        line_count,
        reason
    );

    Ok(())
}

/// Get the current dialogue context for a player (for LLM service).
/// Logs the JSON context on success.
#[reducer]
pub fn get_dialogue_context(ctx: &ReducerContext, player_id: u64) -> Result<(), String> {
    let dialogue = ctx.db.active_dialogue().player_id().find(player_id)
        .ok_or("No active dialogue")?;

    // Refresh context with latest data
    let context = build_dialogue_context(ctx, player_id, dialogue.npc_id)?;

    let context_json = serde_json::to_string(&context)
        .map_err(|e| format!("Failed to serialize context: {}", e))?;

    log::info!("Dialogue context for player {}: {}", player_id, context_json);
    Ok(())
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Build the dialogue context for LLM consumption.
fn build_dialogue_context(
    ctx: &ReducerContext,
    player_id: u64,
    npc_id: u64,
) -> Result<DialogueContext, String> {
    // Get NPC blueprint
    let blueprint = ctx.db.npc_blueprint().npc_id().find(npc_id);

    #[derive(Deserialize, Default)]
    struct BlueprintData {
        name: Option<String>,
        role: Option<String>,
        personality_traits: Option<Vec<String>>,
    }

    let bp_data: BlueprintData = blueprint
        .as_ref()
        .and_then(|b| serde_json::from_slice(&b.blueprint_json).ok())
        .unwrap_or_default();

    // Get relationship
    let relationship = ctx.db.relationship()
        .iter()
        .find(|r| r.player_id == player_id && r.npc_id == npc_id);

    let (affinity, trust, flags, conv_summary) = relationship
        .map(|r| {
            let flags = decode_relationship_flags(r.flags);
            let summary: String = serde_json::from_slice(&r.conversation_summary)
                .unwrap_or_default();
            (r.affinity, r.trust, flags, summary)
        })
        .unwrap_or((0, 0, Vec::new(), String::new()));

    // Get NPC state for needs and memory
    let npc_state = ctx.db.npc_state().npc_id().find(npc_id);

    let needs: NeedsSnapshot = npc_state
        .as_ref()
        .and_then(|s| serde_json::from_slice(&s.needs).ok())
        .unwrap_or(NeedsSnapshot {
            hunger: 20,
            fatigue: 10,
            safety: 80,
            social: 50,
            wealth: 50,
        });

    let memory: Vec<String> = npc_state
        .as_ref()
        .and_then(|s| serde_json::from_slice(&s.memory_summary).ok())
        .unwrap_or_default();

    // Get current action from short_intent
    #[derive(Deserialize)]
    struct HydratedState {
        current_action: Option<String>,
    }

    let action: String = npc_state
        .as_ref()
        .and_then(|s| serde_json::from_slice::<HydratedState>(&s.short_intent).ok())
        .and_then(|h| h.current_action)
        .unwrap_or_else(|| "Idle".to_string());

    // Get local facts (from chunk POIs)
    let local_facts = get_local_facts(ctx, npc_id);

    Ok(DialogueContext {
        npc_name: bp_data.name.unwrap_or_else(|| format!("NPC-{}", npc_id)),
        npc_role: bp_data.role.unwrap_or_else(|| "Unknown".to_string()),
        npc_personality_traits: bp_data.personality_traits.unwrap_or_default(),
        affinity,
        trust,
        relationship_flags: flags,
        memory_summary: memory,
        conversation_summary: conv_summary,
        local_facts,
        current_action: action,
        current_needs: needs,
        recent_lines: Vec::new(),
    })
}

/// Validate that dialogue can continue (NPC in range and LOD0).
fn validate_dialogue_state(ctx: &ReducerContext, player_id: u64, npc_id: u64) -> bool {
    // Check NPC is still LOD0
    if let Some(npc_state) = ctx.db.npc_state().npc_id().find(npc_id) {
        let lod = LodTier::from_u8(npc_state.lod_state);
        if !lod.allows_dialogue() {
            return false;
        }
    } else {
        return false;
    }

    // Check distance
    let player_transform = match ctx.db.transform().entity_id().find(player_id) {
        Some(t) => t,
        None => return false,
    };
    let npc_transform = match ctx.db.transform().entity_id().find(npc_id) {
        Some(t) => t,
        None => return false,
    };

    let dx = (npc_transform.x - player_transform.x) as i64;
    let dy = (npc_transform.y - player_transform.y) as i64;
    let dist_sq = dx * dx + dy * dy;
    let max_dist_sq = (DIALOGUE_RANGE_M as i64 * POSITION_SCALE as i64).pow(2);

    dist_sq <= max_dist_sq
}

/// Get NPC name from blueprint.
fn get_npc_name(ctx: &ReducerContext, npc_id: u64) -> String {
    ctx.db.npc_blueprint().npc_id().find(npc_id)
        .and_then(|b| {
            #[derive(Deserialize)]
            struct Bp { name: Option<String> }
            serde_json::from_slice::<Bp>(&b.blueprint_json).ok()
        })
        .and_then(|b| b.name)
        .unwrap_or_else(|| format!("NPC-{}", npc_id))
}

/// Ensure a relationship record exists between player and NPC.
fn ensure_relationship(ctx: &ReducerContext, player_id: u64, npc_id: u64) {
    let exists = ctx.db.relationship()
        .iter()
        .any(|r| r.player_id == player_id && r.npc_id == npc_id);

    if !exists {
        let _ = ctx.db.relationship().try_insert(Relationship {
            relationship_id: 0, // auto-inc
            player_id,
            npc_id,
            affinity: 0,
            trust: 0,
            flags: relationship_flags::MET,
            conversation_summary: Vec::new(),
        });

        // Emit RelationshipCreated event
        let tick = current_tick(ctx);
        let ts_ms = now_ms(ctx);

        if let Some(entity) = ctx.db.entity().entity_id().find(npc_id) {
            let _ = ctx.db.event_log().try_insert(EventLog {
                event_id: 0,
                ts_ms,
                tick,
                zone_id: entity.zone_id,
                chunk_x: entity.chunk_x,
                chunk_y: entity.chunk_y,
                actor_id: Some(player_id),
                target_id: Some(npc_id),
                event_type: EventType::RelationshipCreated.as_u16(),
                payload: Vec::new(),
            });
        }
    }
}

/// Apply relationship delta from dialogue response.
fn apply_relationship_delta(
    ctx: &ReducerContext,
    player_id: u64,
    npc_id: u64,
    delta: &RelationshipDelta,
) -> Result<(), String> {
    let rel = ctx.db.relationship()
        .iter()
        .find(|r| r.player_id == player_id && r.npc_id == npc_id)
        .ok_or("Relationship not found")?;

    let new_affinity = rel.affinity.saturating_add(delta.affinity_delta);
    let new_trust = rel.trust.saturating_add(delta.trust_delta);

    let mut new_flags = rel.flags;

    for flag in &delta.flags_add {
        new_flags |= string_to_flag(flag);
    }
    for flag in &delta.flags_remove {
        new_flags &= !string_to_flag(flag);
    }

    // Capture values before consuming rel
    let relationship_id = rel.relationship_id;
    let conversation_summary = rel.conversation_summary;

    // Update using the primary key
    ctx.db.relationship().relationship_id().update(Relationship {
        relationship_id,
        player_id,
        npc_id,
        affinity: new_affinity,
        trust: new_trust,
        flags: new_flags,
        conversation_summary,
    });

    // Emit RelationshipUpdated event
    let tick = current_tick(ctx);
    let ts_ms = now_ms(ctx);

    if let Some(entity) = ctx.db.entity().entity_id().find(npc_id) {
        let payload = RelationshipUpdatedPayload {
            affinity_delta: delta.affinity_delta,
            trust_delta: delta.trust_delta,
            flags_added: string_to_flag(&delta.flags_add.join(",")),
            flags_removed: string_to_flag(&delta.flags_remove.join(",")),
            reason: "dialogue".to_string(),
        };

        let _ = ctx.db.event_log().try_insert(EventLog {
            event_id: 0,
            ts_ms,
            tick,
            zone_id: entity.zone_id,
            chunk_x: entity.chunk_x,
            chunk_y: entity.chunk_y,
            actor_id: Some(player_id),
            target_id: Some(npc_id),
            event_type: EventType::RelationshipUpdated.as_u16(),
            payload: serialize_payload(&payload),
        });
    }

    Ok(())
}

/// Apply memory delta from dialogue response.
fn apply_memory_delta(
    ctx: &ReducerContext,
    npc_id: u64,
    delta: &[String],
) -> Result<(), String> {
    let npc_state = ctx.db.npc_state().npc_id().find(npc_id)
        .ok_or("NPC state not found")?;

    let mut memory: Vec<String> = serde_json::from_slice(&npc_state.memory_summary)
        .unwrap_or_default();

    // Add new memories
    for item in delta {
        memory.push(item.clone());
    }

    // Keep only last 15 memory items
    while memory.len() > 15 {
        memory.remove(0);
    }

    ctx.db.npc_state().npc_id().update(NpcState {
        memory_summary: serde_json::to_vec(&memory).unwrap_or_default(),
        ..npc_state
    });

    // Emit MemoryUpdated event
    let tick = current_tick(ctx);
    let ts_ms = now_ms(ctx);

    if let Some(entity) = ctx.db.entity().entity_id().find(npc_id) {
        let _ = ctx.db.event_log().try_insert(EventLog {
            event_id: 0,
            ts_ms,
            tick,
            zone_id: entity.zone_id,
            chunk_x: entity.chunk_x,
            chunk_y: entity.chunk_y,
            actor_id: None,
            target_id: Some(npc_id),
            event_type: EventType::MemoryUpdated.as_u16(),
            payload: serde_json::to_vec(delta).unwrap_or_default(),
        });
    }

    Ok(())
}

/// Validate and queue an action from dialogue.
fn validate_and_queue_action(
    _ctx: &ReducerContext,
    player_id: u64,
    npc_id: u64,
    action: &DialogueAction,
) -> Result<(), String> {
    // Server-side validation of dialogue actions
    match action.action_type.as_str() {
        "give_item" | "offer_trade" | "follow" | "stop_following" | "give_quest" => {
            log::info!("Dialogue action queued: {} from NPC {} to player {}",
                action.action_type, npc_id, player_id);
            // TODO: Queue action for processing
            Ok(())
        }
        _ => {
            log::warn!("Unknown dialogue action: {}", action.action_type);
            Err(format!("Unknown action type: {}", action.action_type))
        }
    }
}

/// Update rate limiting for NPC.
fn update_rate_limit(ctx: &ReducerContext, npc_id: u64, ts_ms: u64) {
    if let Some(rate_limit) = ctx.db.dialogue_rate_limit().npc_id().find(npc_id) {
        let window_elapsed = ts_ms - rate_limit.window_start_ts_ms;

        if window_elapsed >= 60000 {
            // Reset window
            ctx.db.dialogue_rate_limit().npc_id().update(DialogueRateLimit {
                npc_id,
                responses_this_minute: 1,
                window_start_ts_ms: ts_ms,
                last_dialogue_end_ts_ms: rate_limit.last_dialogue_end_ts_ms,
            });
        } else {
            // Increment counter
            ctx.db.dialogue_rate_limit().npc_id().update(DialogueRateLimit {
                responses_this_minute: rate_limit.responses_this_minute + 1,
                ..rate_limit
            });
        }
    } else {
        let _ = ctx.db.dialogue_rate_limit().try_insert(DialogueRateLimit {
            npc_id,
            responses_this_minute: 1,
            window_start_ts_ms: ts_ms,
            last_dialogue_end_ts_ms: 0,
        });
    }
}

/// Decode relationship flags to string list.
fn decode_relationship_flags(flags: u32) -> Vec<String> {
    let mut result = Vec::new();

    if flags & relationship_flags::OFFENDED != 0 {
        result.push("offended".to_string());
    }
    if flags & relationship_flags::OWES_FAVOR != 0 {
        result.push("owes_favor".to_string());
    }
    if flags & relationship_flags::FRIEND != 0 {
        result.push("friend".to_string());
    }
    if flags & relationship_flags::HOSTILE != 0 {
        result.push("hostile".to_string());
    }
    if flags & relationship_flags::MET != 0 {
        result.push("met".to_string());
    }
    if flags & relationship_flags::TRADED != 0 {
        result.push("traded".to_string());
    }

    result
}

/// Convert flag string to bitfield value.
fn string_to_flag(flag: &str) -> u32 {
    match flag.to_lowercase().as_str() {
        "offended" => relationship_flags::OFFENDED,
        "owes_favor" => relationship_flags::OWES_FAVOR,
        "friend" => relationship_flags::FRIEND,
        "hostile" => relationship_flags::HOSTILE,
        "met" => relationship_flags::MET,
        "traded" => relationship_flags::TRADED,
        _ => 0,
    }
}

/// Get local facts about the NPC's environment.
fn get_local_facts(ctx: &ReducerContext, npc_id: u64) -> Vec<String> {
    let mut facts = Vec::new();

    // Get NPC's chunk
    if let Some(entity) = ctx.db.entity().entity_id().find(npc_id) {
        // Get chunk data
        if let Some(chunk) = ctx.db.chunk().cx().filter(entity.chunk_x).find(|c| c.cy == entity.chunk_y) {
            // Parse biome
            let biome_name = match chunk.biome {
                0 => "plains",
                1 => "forest",
                2 => "desert",
                3 => "mountain",
                4 => "swamp",
                5 => "tundra",
                6 => "village",
                7 => "city",
                8 => "ruins",
                9 => "coast",
                _ => "unknown",
            };
            facts.push(format!("Location: {}", biome_name));

            // Parse POIs
            #[derive(Deserialize)]
            struct Poi {
                poi_type: u8,
            }

            if let Ok(pois) = serde_json::from_slice::<Vec<Poi>>(&chunk.poi_blob) {
                let poi_count = pois.len();
                if poi_count > 0 {
                    facts.push(format!("Nearby points of interest: {}", poi_count));
                }
            }
        }

        // Count nearby NPCs
        let nearby_npcs = ctx.db.entity()
            .chunk_x()
            .filter(entity.chunk_x)
            .filter(|e| e.chunk_y == entity.chunk_y && e.kind == EntityKind::Npc.as_u16() && e.entity_id != npc_id)
            .count();

        if nearby_npcs > 0 {
            facts.push(format!("Other NPCs nearby: {}", nearby_npcs));
        }

        // Check for players nearby
        let nearby_players = ctx.db.entity()
            .chunk_x()
            .filter(entity.chunk_x)
            .filter(|e| e.chunk_y == entity.chunk_y && e.kind == EntityKind::Player.as_u16())
            .count();

        if nearby_players > 1 {
            facts.push(format!("Other visitors: {}", nearby_players - 1));
        }
    }

    facts
}

impl Default for DialogueContext {
    fn default() -> Self {
        Self {
            npc_name: String::new(),
            npc_role: String::new(),
            npc_personality_traits: Vec::new(),
            affinity: 0,
            trust: 0,
            relationship_flags: Vec::new(),
            memory_summary: Vec::new(),
            conversation_summary: String::new(),
            local_facts: Vec::new(),
            current_action: String::new(),
            current_needs: NeedsSnapshot {
                hunger: 50,
                fatigue: 50,
                safety: 50,
                social: 50,
                wealth: 50,
            },
            recent_lines: Vec::new(),
        }
    }
}
