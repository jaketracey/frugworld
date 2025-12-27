//! World Messaging System
//!
//! Handles player chat messages and yells that affect nearby NPCs.

use spacetimedb::{reducer, ReducerContext, Table};

use crate::{
    event_types::{
        EventType, WorldMessagePayload, NpcHeardYellPayload,
        PlayerGesturePayload, NpcPerceivedGesturePayload, GestureType,
        serialize_payload
    },
    Entity, EntityKind, EventLog, NpcState, NpcPerception, Player, Transform, WorldMessage,
    CHUNK_SIZE_METERS, POSITION_SCALE,
    // Table accessor traits
    player, entity, transform, npc_state, npc_perception, world_message, event_log,
};

// =============================================================================
// Configuration
// =============================================================================

/// Normal message radius in chunks
const MESSAGE_RADIUS_CHUNKS: i32 = 1;

/// Yell message radius in chunks (larger!)
const YELL_RADIUS_CHUNKS: i32 = 3;

/// Message expiration time in milliseconds (30 seconds)
const MESSAGE_EXPIRY_MS: u64 = 30_000;

/// Yell effect radius in millimeters (50 meters)
const YELL_EFFECT_RADIUS_MM: i32 = 50 * POSITION_SCALE;

/// Maximum message length
const MAX_MESSAGE_LENGTH: usize = 256;

/// Gesture effect radius in millimeters (20 meters)
const GESTURE_EFFECT_RADIUS_MM: i32 = 20 * POSITION_SCALE;

/// Perception expiration time in milliseconds (5 seconds)
const PERCEPTION_EXPIRY_MS: u64 = 5_000;

// =============================================================================
// Helper Functions
// =============================================================================

/// Get the current timestamp in milliseconds
fn now_ms(ctx: &ReducerContext) -> u64 {
    ctx.timestamp.duration_since(spacetimedb::Timestamp::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Get player entity data from identity
fn get_player_data(ctx: &ReducerContext) -> Option<(Player, Entity, Transform)> {
    let player = ctx.db.player().identity().find(ctx.sender)?;
    let entity = ctx.db.entity().entity_id().find(player.entity_id)?;
    let transform = ctx.db.transform().entity_id().find(player.entity_id)?;
    Some((player, entity, transform))
}

/// Calculate chunk coordinates from position
fn pos_to_chunk(pos_mm: i32) -> i32 {
    let pos_m = pos_mm / POSITION_SCALE;
    pos_m.div_euclid(CHUNK_SIZE_METERS)
}

/// Calculate distance squared between two positions (in mm)
fn distance_squared_mm(x1: i32, y1: i32, z1: i32, x2: i32, y2: i32, z2: i32) -> i64 {
    let dx = (x1 - x2) as i64;
    let dy = (y1 - y2) as i64;
    let dz = (z1 - z2) as i64;
    dx * dx + dy * dy + dz * dz
}

// =============================================================================
// Reducers
// =============================================================================

/// Send a normal chat message visible to nearby players
#[reducer]
pub fn send_message(ctx: &ReducerContext, message: String) -> Result<(), String> {
    send_message_internal(ctx, message, false)
}

/// Yell a message that affects nearby NPCs
#[reducer]
pub fn yell_message(ctx: &ReducerContext, message: String) -> Result<(), String> {
    send_message_internal(ctx, message, true)
}

/// Internal implementation for sending messages
fn send_message_internal(ctx: &ReducerContext, message: String, is_yell: bool) -> Result<(), String> {
    // Validate message
    if message.is_empty() {
        return Err("Message cannot be empty".to_string());
    }
    if message.len() > MAX_MESSAGE_LENGTH {
        return Err(format!("Message too long (max {} characters)", MAX_MESSAGE_LENGTH));
    }

    // Get player data
    let (player, entity, transform) = get_player_data(ctx)
        .ok_or("Player not found")?;

    let ts_ms = now_ms(ctx);
    let chunk_x = pos_to_chunk(transform.x);
    let chunk_y = pos_to_chunk(transform.y);

    // Create world message
    let world_message = WorldMessage {
        message_id: 0, // Auto-incremented
        sender_id: player.entity_id,
        sender_name: player.name.clone(),
        message: message.clone(),
        is_yell,
        chunk_x,
        chunk_y,
        pos_x: transform.x,
        pos_y: transform.y,
        pos_z: transform.z,
        ts_ms,
        expires_ts_ms: ts_ms + MESSAGE_EXPIRY_MS,
    };

    // Insert message
    let inserted = ctx.db.world_message().try_insert(world_message)
        .map_err(|_| "Failed to insert message")?;

    // Create event payload
    let payload = WorldMessagePayload {
        message_id: inserted.message_id,
        sender_name: player.name.clone(),
        message: message.clone(),
        is_yell,
        pos_x: transform.x,
        pos_y: transform.y,
        pos_z: transform.z,
    };

    // Log event
    let event_type = if is_yell {
        EventType::WorldMessageYelled
    } else {
        EventType::WorldMessageSent
    };

    let _ = ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick: 0, // Will be set by tick system
        zone_id: entity.zone_id,
        chunk_x,
        chunk_y,
        actor_id: Some(player.entity_id),
        target_id: None,
        event_type: event_type.as_u16(),
        payload: serialize_payload(&payload),
    });

    // If this is a yell, affect nearby NPCs
    if is_yell {
        affect_nearby_npcs(ctx, &inserted, &transform)?;
    }

    Ok(())
}

/// Apply yell effects to nearby NPCs
fn affect_nearby_npcs(
    ctx: &ReducerContext,
    message: &WorldMessage,
    yeller_transform: &Transform,
) -> Result<(), String> {
    let ts_ms = now_ms(ctx);
    let yell_radius_sq = (YELL_EFFECT_RADIUS_MM as i64) * (YELL_EFFECT_RADIUS_MM as i64);

    // Find NPCs within yell radius
    for entity in ctx.db.entity().iter() {
        // Only affect NPCs that are alive
        if entity.kind != EntityKind::Npc as u16 || !entity.alive {
            continue;
        }

        // Get NPC transform
        let Some(npc_transform) = ctx.db.transform().entity_id().find(entity.entity_id) else {
            continue;
        };

        // Calculate distance
        let dist_sq = distance_squared_mm(
            yeller_transform.x, yeller_transform.y, yeller_transform.z,
            npc_transform.x, npc_transform.y, npc_transform.z,
        );

        // Check if within yell radius
        if dist_sq > yell_radius_sq {
            continue;
        }

        let distance_mm = (dist_sq as f64).sqrt() as i32;

        // Get and update NPC state
        if let Some(mut npc_state) = ctx.db.npc_state().npc_id().find(entity.entity_id) {
            // Parse current needs
            if let Ok(mut needs) = serde_json::from_slice::<crate::Needs>(&npc_state.needs) {
                // Apply HeardYell effect: decrease safety, increase social
                needs.safety = needs.safety.saturating_sub(15);
                needs.social = needs.social.saturating_add(5).min(100);

                // Update needs in state
                npc_state.needs = serde_json::to_vec(&needs).unwrap_or_default();
                ctx.db.npc_state().npc_id().update(npc_state);
            }

            // Log NPC heard yell event
            let payload = NpcHeardYellPayload {
                yell_message_id: message.message_id,
                yeller_id: message.sender_id,
                distance_mm,
            };

            let chunk_x = pos_to_chunk(npc_transform.x);
            let chunk_y = pos_to_chunk(npc_transform.y);

            let _ = ctx.db.event_log().try_insert(EventLog {
                event_id: 0,
                ts_ms,
                tick: 0,
                zone_id: entity.zone_id,
                chunk_x,
                chunk_y,
                actor_id: Some(message.sender_id),
                target_id: Some(entity.entity_id),
                event_type: EventType::NpcHeardYell.as_u16(),
                payload: serialize_payload(&payload),
            });
        }
    }

    Ok(())
}

/// Cleanup expired messages (called from server tick)
pub fn cleanup_expired_messages(ctx: &ReducerContext) {
    let ts_ms = now_ms(ctx);

    // Find and delete expired messages
    let expired: Vec<_> = ctx.db.world_message()
        .iter()
        .filter(|msg| msg.expires_ts_ms <= ts_ms)
        .map(|msg| msg.message_id)
        .collect();

    for message_id in expired {
        ctx.db.world_message().message_id().delete(message_id);
    }
}

/// Cleanup expired NPC perceptions (called from server tick)
pub fn cleanup_expired_perceptions(ctx: &ReducerContext) {
    let ts_ms = now_ms(ctx);

    // Find and delete expired perceptions
    let expired: Vec<_> = ctx.db.npc_perception()
        .iter()
        .filter(|p| p.expires_ts_ms <= ts_ms)
        .map(|p| p.perception_id)
        .collect();

    for perception_id in expired {
        ctx.db.npc_perception().perception_id().delete(perception_id);
    }
}

// =============================================================================
// Gesture System
// =============================================================================

/// Reaction thoughts for different gesture types
fn get_gesture_reactions(gesture: GestureType, player_name: &str) -> Vec<&'static str> {
    match gesture {
        GestureType::Wave | GestureType::Greet => vec![
            "Oh, someone's waving at me!",
            "How friendly!",
            "Hello there!",
            "*waves back*",
            "A visitor!",
            "Someone noticed me!",
        ],
        GestureType::Bow => vec![
            "Such formality!",
            "How polite!",
            "*bows in return*",
            "A respectful one...",
        ],
        GestureType::Beckon => vec![
            "They want my attention...",
            "Should I go over there?",
            "What do they want?",
            "Hmm, they're calling me...",
        ],
        GestureType::Dismiss => vec![
            "How rude!",
            "I see how it is...",
            "*feels slighted*",
            "Well, excuse me!",
        ],
    }
}

/// Perform a gesture toward one or more NPCs
#[reducer]
pub fn perform_gesture(
    ctx: &ReducerContext,
    gesture_type: String,
    target_npc_ids: Vec<u64>,
) -> Result<(), String> {
    // Parse gesture type
    let gesture = GestureType::from_str(&gesture_type)
        .ok_or_else(|| format!("Unknown gesture type: {}", gesture_type))?;

    // Get player data
    let (player, entity, player_transform) = get_player_data(ctx)
        .ok_or("Player not found")?;

    let ts_ms = now_ms(ctx);
    let chunk_x = pos_to_chunk(player_transform.x);
    let chunk_y = pos_to_chunk(player_transform.y);

    // Log the player gesture event
    let gesture_payload = PlayerGesturePayload {
        gesture_type: gesture,
        target_npc_ids: target_npc_ids.clone(),
        player_name: player.name.clone(),
    };

    let _ = ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick: 0,
        zone_id: entity.zone_id,
        chunk_x,
        chunk_y,
        actor_id: Some(player.entity_id),
        target_id: None,
        event_type: EventType::PlayerGesture.as_u16(),
        payload: serialize_payload(&gesture_payload),
    });

    let gesture_radius_sq = (GESTURE_EFFECT_RADIUS_MM as i64) * (GESTURE_EFFECT_RADIUS_MM as i64);
    let reactions = get_gesture_reactions(gesture, &player.name);
    let mut affected_count = 0;

    // Process each target NPC
    for npc_id in &target_npc_ids {
        // Verify NPC exists and is alive
        let Some(npc_entity) = ctx.db.entity().entity_id().find(*npc_id) else {
            continue;
        };
        if npc_entity.kind != EntityKind::Npc as u16 || !npc_entity.alive {
            continue;
        }

        // Get NPC transform to check distance
        let Some(npc_transform) = ctx.db.transform().entity_id().find(*npc_id) else {
            continue;
        };

        // Calculate distance
        let dist_sq = distance_squared_mm(
            player_transform.x, player_transform.y, player_transform.z,
            npc_transform.x, npc_transform.y, npc_transform.z,
        );

        // Check if within gesture radius
        if dist_sq > gesture_radius_sq {
            continue;
        }

        let distance_mm = (dist_sq as f64).sqrt() as i32;

        // Pick a random reaction using entity ID as seed for variety
        let reaction_idx = (*npc_id as usize + ts_ms as usize) % reactions.len();
        let reaction = reactions[reaction_idx];

        // Create perception record for this NPC
        let _ = ctx.db.npc_perception().try_insert(NpcPerception {
            perception_id: 0, // Auto-increment
            npc_id: *npc_id,
            thought: reaction.to_string(),
            source_entity_id: player.entity_id,
            perception_type: format!("gesture:{}", gesture_type),
            created_ts_ms: ts_ms,
            expires_ts_ms: ts_ms + PERCEPTION_EXPIRY_MS,
        });

        // Log NPC perceived gesture event
        let perceived_payload = NpcPerceivedGesturePayload {
            gesture_type: gesture,
            player_id: player.entity_id,
            player_name: player.name.clone(),
            distance_mm,
        };

        let npc_chunk_x = pos_to_chunk(npc_transform.x);
        let npc_chunk_y = pos_to_chunk(npc_transform.y);

        let _ = ctx.db.event_log().try_insert(EventLog {
            event_id: 0,
            ts_ms,
            tick: 0,
            zone_id: npc_entity.zone_id,
            chunk_x: npc_chunk_x,
            chunk_y: npc_chunk_y,
            actor_id: Some(player.entity_id),
            target_id: Some(*npc_id),
            event_type: EventType::NpcPerceivedGesture.as_u16(),
            payload: serialize_payload(&perceived_payload),
        });

        // Update NPC needs - gestures increase social need satisfaction
        if let Some(npc_state) = ctx.db.npc_state().npc_id().find(*npc_id) {
            if let Ok(mut needs) = serde_json::from_slice::<crate::Needs>(&npc_state.needs) {
                // Positive gestures increase social, dismissive ones decrease it
                match gesture {
                    GestureType::Wave | GestureType::Greet | GestureType::Bow => {
                        needs.social = needs.social.saturating_add(10).min(100);
                    }
                    GestureType::Beckon => {
                        needs.social = needs.social.saturating_add(5).min(100);
                    }
                    GestureType::Dismiss => {
                        needs.social = needs.social.saturating_sub(10);
                    }
                }

                let updated_state = NpcState {
                    needs: serde_json::to_vec(&needs).unwrap_or_default(),
                    ..npc_state
                };
                ctx.db.npc_state().npc_id().update(updated_state);
            }
        }

        affected_count += 1;
    }

    log::info!(
        "Player {} performed {} gesture toward {} NPCs ({} affected)",
        player.name, gesture_type, target_npc_ids.len(), affected_count
    );

    Ok(())
}
