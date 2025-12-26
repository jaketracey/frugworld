//! Relationship Management System
//!
//! Implements Section 14.3 of the plan: Relationship model between players and NPCs.
//!
//! Features:
//! - Relationship CRUD operations
//! - Affinity and trust tracking
//! - Relationship flags (friend, hostile, etc.)
//! - Conversation summary storage
//! - Event-based relationship updates

use crate::{
    current_tick, event_types::*, now_ms, EventLog, Relationship,
    relationship_flags,
    entity, relationship, event_log, npc_blueprint,
};
use serde::{Deserialize, Serialize};
use spacetimedb::{reducer, ReducerContext, Table};

// =============================================================================
// Relationship Thresholds
// =============================================================================

/// Affinity threshold for "friend" status
pub const FRIEND_THRESHOLD: i16 = 50;

/// Affinity threshold for "hostile" status
pub const HOSTILE_THRESHOLD: i16 = -50;

/// Trust threshold for trading
pub const TRADE_TRUST_THRESHOLD: i16 = 20;

/// Maximum affinity/trust value
pub const MAX_RELATIONSHIP_VALUE: i16 = 100;

/// Minimum affinity/trust value
pub const MIN_RELATIONSHIP_VALUE: i16 = -100;

// =============================================================================
// Relationship Data Structures
// =============================================================================

/// Detailed relationship view for clients.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationshipView {
    pub player_id: u64,
    pub npc_id: u64,
    pub npc_name: String,
    pub affinity: i16,
    pub trust: i16,
    pub flags: Vec<String>,
    pub status: RelationshipStatus,
    pub last_interaction_ts_ms: u64,
}

/// High-level relationship status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RelationshipStatus {
    Stranger,
    Acquaintance,
    Friend,
    CloseFriend,
    Hostile,
    Enemy,
    Neutral,
}

impl RelationshipStatus {
    /// Derive status from affinity, trust, and flags.
    pub fn from_relationship(affinity: i16, _trust: i16, flags: u32) -> Self {
        if flags & relationship_flags::HOSTILE != 0 || affinity <= -75 {
            return Self::Enemy;
        }

        if affinity <= HOSTILE_THRESHOLD {
            return Self::Hostile;
        }

        if flags & relationship_flags::FRIEND != 0 && affinity >= 75 {
            return Self::CloseFriend;
        }

        if flags & relationship_flags::FRIEND != 0 || affinity >= FRIEND_THRESHOLD {
            return Self::Friend;
        }

        if flags & relationship_flags::MET != 0 {
            return Self::Acquaintance;
        }

        Self::Stranger
    }
}

/// Conversation summary entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSummary {
    pub entries: Vec<ConversationEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationEntry {
    pub ts_ms: u64,
    pub summary: String,
    pub sentiment: i8, // -10 to 10
}

// =============================================================================
// Reducers
// =============================================================================

/// Get a player's relationship with an NPC.
#[reducer]
pub fn get_relationship(ctx: &ReducerContext, player_id: u64, npc_id: u64) {
    let rel = ctx.db.relationship().iter().find(|r| r.player_id == player_id && r.npc_id == npc_id);

    match rel {
        Some(r) => {
            let npc_name = get_npc_name(ctx, npc_id);
            let flags = decode_flags(r.flags);
            let status = RelationshipStatus::from_relationship(r.affinity, r.trust, r.flags);

            let view = RelationshipView {
                player_id,
                npc_id,
                npc_name,
                affinity: r.affinity,
                trust: r.trust,
                flags,
                status,
                last_interaction_ts_ms: 0, // TODO: Track this
            };

            log::info!("Relationship found: {}", serde_json::to_string(&view).unwrap_or_default());
        }
        None => {
            log::info!("No relationship found for player {} and NPC {}", player_id, npc_id);
        }
    }
}

/// Get all relationships for a player.
#[reducer]
pub fn get_player_relationships(ctx: &ReducerContext, player_id: u64) {
    let relationships: Vec<RelationshipView> = ctx.db.relationship()
        .iter()
        .filter(|r| r.player_id == player_id)
        .map(|rel| {
            let npc_name = get_npc_name(ctx, rel.npc_id);
            let flags = decode_flags(rel.flags);
            let status = RelationshipStatus::from_relationship(rel.affinity, rel.trust, rel.flags);

            RelationshipView {
                player_id,
                npc_id: rel.npc_id,
                npc_name,
                affinity: rel.affinity,
                trust: rel.trust,
                flags,
                status,
                last_interaction_ts_ms: 0,
            }
        })
        .collect();

    log::info!("Player relationships: {}", serde_json::to_string(&relationships).unwrap_or_else(|_| "[]".to_string()));
}

/// Update relationship values directly.
#[reducer]
pub fn update_relationship(
    ctx: &ReducerContext,
    player_id: u64,
    npc_id: u64,
    affinity_delta: i16,
    trust_delta: i16,
    reason: String,
) {
    let tick = current_tick(ctx);
    let ts_ms = now_ms(ctx);

    // Find existing relationship
    let rel = ctx.db.relationship()
        .iter()
        .find(|r| r.player_id == player_id && r.npc_id == npc_id);

    let (old_affinity, old_trust, old_flags, conv_summary, existing_id) = match &rel {
        Some(r) => (r.affinity, r.trust, r.flags, r.conversation_summary.clone(), Some(r.relationship_id)),
        None => {
            // Create new relationship
            let new_flags = relationship_flags::MET;
            if let Err(e) = ctx.db.relationship().try_insert(Relationship {
                relationship_id: 0,
                player_id,
                npc_id,
                affinity: 0,
                trust: 0,
                flags: new_flags,
                conversation_summary: Vec::new(),
            }) {
                log::error!("Failed to create relationship: {:?}", e);
                return;
            }
            (0, 0, new_flags, Vec::new(), None)
        }
    };

    // Calculate new values with clamping
    let new_affinity = (old_affinity as i32 + affinity_delta as i32)
        .clamp(MIN_RELATIONSHIP_VALUE as i32, MAX_RELATIONSHIP_VALUE as i32) as i16;
    let new_trust = (old_trust as i32 + trust_delta as i32)
        .clamp(MIN_RELATIONSHIP_VALUE as i32, MAX_RELATIONSHIP_VALUE as i32) as i16;

    // Update flags based on new values
    let mut new_flags = old_flags;

    // Auto-set friend flag if affinity is high enough
    if new_affinity >= FRIEND_THRESHOLD && (old_flags & relationship_flags::FRIEND == 0) {
        new_flags |= relationship_flags::FRIEND;
    } else if new_affinity < FRIEND_THRESHOLD {
        new_flags &= !relationship_flags::FRIEND;
    }

    // Auto-set hostile flag if affinity is low enough
    if new_affinity <= HOSTILE_THRESHOLD {
        new_flags |= relationship_flags::HOSTILE;
    } else if new_affinity > HOSTILE_THRESHOLD {
        new_flags &= !relationship_flags::HOSTILE;
    }

    // Update relationship
    if let Some(old_rel) = rel {
        ctx.db.relationship().delete(old_rel);
    }

    // Get the id to use (existing or 0 for auto_inc)
    let rel_id = existing_id.unwrap_or(0);

    if let Err(e) = ctx.db.relationship().try_insert(Relationship {
        relationship_id: rel_id,
        player_id,
        npc_id,
        affinity: new_affinity,
        trust: new_trust,
        flags: new_flags,
        conversation_summary: conv_summary,
    }) {
        log::error!("Failed to update relationship: {:?}", e);
        return;
    }

    // Emit event
    if let Some(entity) = ctx.db.entity().iter().find(|e| e.entity_id == npc_id) {
        let payload = RelationshipUpdatedPayload {
            affinity_delta,
            trust_delta,
            flags_added: new_flags & !old_flags,
            flags_removed: old_flags & !new_flags,
            reason,
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

    log::info!(
        "Relationship updated: player {} -> NPC {} (affinity: {} -> {}, trust: {} -> {})",
        player_id,
        npc_id,
        old_affinity,
        new_affinity,
        old_trust,
        new_trust
    );
}

/// Set a relationship flag.
#[reducer]
pub fn set_relationship_flag(
    ctx: &ReducerContext,
    player_id: u64,
    npc_id: u64,
    flag_name: String,
    value: bool,
) {
    let flag = string_to_flag(&flag_name);
    if flag == 0 {
        log::error!("Unknown flag: {}", flag_name);
        return;
    }

    let rel = ctx.db.relationship()
        .iter()
        .find(|r| r.player_id == player_id && r.npc_id == npc_id);

    let rel = match rel {
        Some(r) => r,
        None => {
            log::error!("Relationship not found for player {} and NPC {}", player_id, npc_id);
            return;
        }
    };

    let new_flags = if value {
        rel.flags | flag
    } else {
        rel.flags & !flag
    };

    if new_flags == rel.flags {
        return; // No change
    }

    let rel_id = rel.relationship_id;

    // Update relationship
    ctx.db.relationship().delete(rel.clone());
    if let Err(e) = ctx.db.relationship().try_insert(Relationship {
        relationship_id: rel_id,
        flags: new_flags,
        ..rel
    }) {
        log::error!("Failed to update relationship flag: {:?}", e);
        return;
    }

    let tick = current_tick(ctx);
    let ts_ms = now_ms(ctx);

    // Emit event
    if let Some(entity) = ctx.db.entity().iter().find(|e| e.entity_id == npc_id) {
        let payload = RelationshipUpdatedPayload {
            affinity_delta: 0,
            trust_delta: 0,
            flags_added: if value { flag } else { 0 },
            flags_removed: if !value { flag } else { 0 },
            reason: format!("Flag {} set to {}", flag_name, value),
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

    log::info!(
        "Relationship flag '{}' {} for player {} -> NPC {}",
        flag_name,
        if value { "set" } else { "cleared" },
        player_id,
        npc_id
    );
}

/// Update conversation summary for a relationship.
#[reducer]
pub fn update_conversation_summary(
    ctx: &ReducerContext,
    player_id: u64,
    npc_id: u64,
    summary: String,
    sentiment: i8,
) {
    let ts_ms = now_ms(ctx);

    let rel = ctx.db.relationship()
        .iter()
        .find(|r| r.player_id == player_id && r.npc_id == npc_id);

    let rel = match rel {
        Some(r) => r,
        None => {
            log::error!("Relationship not found for player {} and NPC {}", player_id, npc_id);
            return;
        }
    };

    // Parse existing summary
    let mut conv_summary: ConversationSummary = serde_json::from_slice(&rel.conversation_summary)
        .unwrap_or(ConversationSummary { entries: Vec::new() });

    // Add new entry
    conv_summary.entries.push(ConversationEntry {
        ts_ms,
        summary,
        sentiment: sentiment.clamp(-10, 10),
    });

    // Keep only last 10 entries
    while conv_summary.entries.len() > 10 {
        conv_summary.entries.remove(0);
    }

    // Serialize
    let conv_bytes = serde_json::to_vec(&conv_summary).unwrap_or_default();

    let rel_id = rel.relationship_id;

    // Update relationship
    ctx.db.relationship().delete(rel.clone());
    if let Err(e) = ctx.db.relationship().try_insert(Relationship {
        relationship_id: rel_id,
        conversation_summary: conv_bytes,
        ..rel
    }) {
        log::error!("Failed to update conversation summary: {:?}", e);
        return;
    }

    log::debug!(
        "Updated conversation summary for player {} -> NPC {}",
        player_id,
        npc_id
    );
}

/// Check if player can trade with NPC based on trust level.
#[reducer]
pub fn can_trade_with_npc(ctx: &ReducerContext, player_id: u64, npc_id: u64) {
    let can_trade = ctx.db.relationship()
        .iter()
        .find(|r| r.player_id == player_id && r.npc_id == npc_id)
        .map(|r| {
            // Must have met and have minimum trust, not hostile
            (r.flags & relationship_flags::MET != 0)
                && r.trust >= TRADE_TRUST_THRESHOLD
                && (r.flags & relationship_flags::HOSTILE == 0)
        })
        .unwrap_or(false);

    log::info!("Can trade with NPC {}: {}", npc_id, can_trade);
}

/// Apply relationship effects from a game event.
#[reducer]
pub fn apply_relationship_event(
    ctx: &ReducerContext,
    player_id: u64,
    npc_id: u64,
    event_type: String,
) {
    let (affinity_delta, trust_delta, flag_changes) = match event_type.as_str() {
        "greeting" => (2, 1, None),
        "gift_given" => (10, 5, Some(("owes_favor", true))),
        "gift_received" => (5, 3, Some(("owes_favor", false))),
        "helped" => (15, 10, None),
        "insulted" => (-15, -10, Some(("offended", true))),
        "attacked" => (-50, -30, Some(("hostile", true))),
        "apologized" => (5, 3, Some(("offended", false))),
        "trade_completed" => (3, 5, Some(("traded", true))),
        "trade_failed" => (-2, -5, None),
        "quest_completed" => (20, 15, None),
        "quest_failed" => (-10, -15, None),
        "lied_to" => (-5, -20, None),
        "secret_shared" => (5, 10, None),
        _ => {
            log::error!("Unknown event type: {}", event_type);
            return;
        }
    };

    // Update base values
    update_relationship(ctx, player_id, npc_id, affinity_delta, trust_delta, event_type.clone());

    // Apply flag changes if any
    if let Some((flag_name, value)) = flag_changes {
        set_relationship_flag(ctx, player_id, npc_id, flag_name.to_string(), value);
    }

    log::info!(
        "Applied relationship event '{}' for player {} -> NPC {}",
        event_type,
        player_id,
        npc_id
    );
}

/// Get NPCs that the player has a relationship with.
#[reducer]
pub fn get_known_npcs(ctx: &ReducerContext, player_id: u64) {
    #[derive(Serialize)]
    struct KnownNpc {
        npc_id: u64,
        name: String,
        status: RelationshipStatus,
        affinity: i16,
    }

    let npcs: Vec<KnownNpc> = ctx.db.relationship()
        .iter()
        .filter(|r| r.player_id == player_id && r.flags & relationship_flags::MET != 0)
        .map(|r| {
            let name = get_npc_name(ctx, r.npc_id);
            let status = RelationshipStatus::from_relationship(r.affinity, r.trust, r.flags);

            KnownNpc {
                npc_id: r.npc_id,
                name,
                status,
                affinity: r.affinity,
            }
        })
        .collect();

    log::info!("Known NPCs: {}", serde_json::to_string(&npcs).unwrap_or_else(|_| "[]".to_string()));
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Get NPC name from blueprint.
fn get_npc_name(ctx: &ReducerContext, npc_id: u64) -> String {
    ctx.db.npc_blueprint().iter().find(|b| b.npc_id == npc_id)
        .and_then(|b| {
            #[derive(Deserialize)]
            struct Bp { name: Option<String> }
            serde_json::from_slice::<Bp>(&b.blueprint_json).ok()
        })
        .and_then(|b| b.name)
        .unwrap_or_else(|| format!("NPC-{}", npc_id))
}

/// Decode flags bitfield to string list.
fn decode_flags(flags: u32) -> Vec<String> {
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
