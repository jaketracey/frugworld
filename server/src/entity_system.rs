//! Entity System
//!
//! Handles entity lifecycle (spawn, despawn, kill, revive) and
//! provides core entity manipulation functionality.

use crate::{
    current_tick,
    event_types::*,
    next_id, now_ms, Entity, EntityKind, EventLog, NpcBlueprint, NpcState, Transform, Player, PlayerInterest,
    CHUNK_SIZE_METERS, POSITION_SCALE,
    // Table accessor traits
    entity, transform, npc_state, npc_blueprint, event_log, player_interest, player, relationship,
};
use spacetimedb::{reducer, ReducerContext, Table};

// =============================================================================
// Entity Spawning
// =============================================================================

/// Spawn a new entity at the given world position.
/// Logs the entity ID of the spawned entity.
#[reducer]
pub fn spawn_entity(
    ctx: &ReducerContext,
    kind: u16,
    archetype_id: u32,
    zone_id: u64,
    world_x: i32,
    world_y: i32,
    world_z: i32,
) {
    let entity_id = next_id(ctx, "entity");
    let tick = current_tick(ctx);
    let ts_ms = now_ms(ctx);

    // Calculate chunk coordinates
    let chunk_x = world_x / (CHUNK_SIZE_METERS * POSITION_SCALE);
    let chunk_y = world_y / (CHUNK_SIZE_METERS * POSITION_SCALE);

    // Insert entity record
    ctx.db.entity().try_insert(Entity {
        entity_id,
        kind,
        archetype_id,
        zone_id,
        chunk_x,
        chunk_y,
        alive: true,
    }).ok();

    // Insert transform
    ctx.db.transform().try_insert(Transform {
        entity_id,
        x: world_x,
        y: world_y,
        z: world_z,
        yaw: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        last_tick: tick,
    }).ok();

    // Emit EntitySpawned event
    let payload = EntitySpawnedPayload {
        kind,
        archetype_id,
        x: world_x,
        y: world_y,
        z: world_z,
    };

    ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick,
        zone_id,
        chunk_x,
        chunk_y,
        actor_id: None,
        target_id: Some(entity_id),
        event_type: EventType::EntitySpawned.as_u16(),
        payload: serialize_payload(&payload),
    }).ok();

    log::info!("Spawned entity {} (kind={}, archetype={})", entity_id, kind, archetype_id);
}

/// Internal helper to spawn an entity and return the ID.
fn spawn_entity_internal(
    ctx: &ReducerContext,
    kind: u16,
    archetype_id: u32,
    zone_id: u64,
    world_x: i32,
    world_y: i32,
    world_z: i32,
) -> u64 {
    let entity_id = next_id(ctx, "entity");
    let tick = current_tick(ctx);
    let ts_ms = now_ms(ctx);

    // Calculate chunk coordinates
    let chunk_x = world_x / (CHUNK_SIZE_METERS * POSITION_SCALE);
    let chunk_y = world_y / (CHUNK_SIZE_METERS * POSITION_SCALE);

    // Insert entity record
    ctx.db.entity().try_insert(Entity {
        entity_id,
        kind,
        archetype_id,
        zone_id,
        chunk_x,
        chunk_y,
        alive: true,
    }).ok();

    // Insert transform
    ctx.db.transform().try_insert(Transform {
        entity_id,
        x: world_x,
        y: world_y,
        z: world_z,
        yaw: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        last_tick: tick,
    }).ok();

    // Emit EntitySpawned event
    let payload = EntitySpawnedPayload {
        kind,
        archetype_id,
        x: world_x,
        y: world_y,
        z: world_z,
    };

    ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick,
        zone_id,
        chunk_x,
        chunk_y,
        actor_id: None,
        target_id: Some(entity_id),
        event_type: EventType::EntitySpawned.as_u16(),
        payload: serialize_payload(&payload),
    }).ok();

    log::info!("Spawned entity {} (kind={}, archetype={})", entity_id, kind, archetype_id);

    entity_id
}

/// Spawn an NPC with full state initialization.
#[reducer]
pub fn spawn_npc(
    ctx: &ReducerContext,
    archetype_id: u32,
    zone_id: u64,
    world_x: i32,
    world_y: i32,
) {
    let entity_id = spawn_entity_internal(
        ctx,
        EntityKind::Npc.as_u16(),
        archetype_id,
        zone_id,
        world_x,
        world_y,
        0,
    );

    let ts_ms = now_ms(ctx);

    // Initialize NPC state
    ctx.db.npc_state().try_insert(NpcState {
        npc_id: entity_id,
        lod_state: 3, // Start dehydrated
        long_goal: Vec::new(),
        mid_goal: Vec::new(),
        short_intent: Vec::new(),
        needs: create_default_needs(),
        memory_summary: Vec::new(),
        last_replan_ts_ms: ts_ms,
    }).ok();

    // Insert placeholder blueprint
    ctx.db.npc_blueprint().try_insert(NpcBlueprint {
        npc_id: entity_id,
        blueprint_json: Vec::new(),
        version: 0,
        created_ts_ms: ts_ms,
    }).ok();

    log::info!("Spawned NPC {} with archetype {}", entity_id, archetype_id);
}

// =============================================================================
// Entity Despawning
// =============================================================================

/// Despawn an entity, removing it from the world.
#[reducer]
pub fn despawn_entity(ctx: &ReducerContext, entity_id: u64, reason: u8) {
    // Find the entity
    let Some(entity) = ctx.db.entity().entity_id().find(entity_id) else {
        log::warn!("Attempted to despawn non-existent entity {}", entity_id);
        return;
    };

    let tick = current_tick(ctx);
    let ts_ms = now_ms(ctx);

    let despawn_reason = match reason {
        0 => DespawnReason::Killed,
        1 => DespawnReason::Removed,
        2 => DespawnReason::OutOfBounds,
        3 => DespawnReason::Expired,
        4 => DespawnReason::Disconnected,
        _ => DespawnReason::Removed,
    };

    // Emit EntityDespawned event
    let payload = EntityDespawnedPayload {
        reason: despawn_reason,
    };

    ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick,
        zone_id: entity.zone_id,
        chunk_x: entity.chunk_x,
        chunk_y: entity.chunk_y,
        actor_id: None,
        target_id: Some(entity_id),
        event_type: EventType::EntityDespawned.as_u16(),
        payload: serialize_payload(&payload),
    }).ok();

    // Delete transform
    if ctx.db.transform().entity_id().find(entity_id).is_some() {
        ctx.db.transform().entity_id().delete(entity_id);
    }

    // If NPC, clean up NPC-specific data
    if entity.kind == EntityKind::Npc.as_u16() {
        // Delete NPC state
        if ctx.db.npc_state().npc_id().find(entity_id).is_some() {
            ctx.db.npc_state().npc_id().delete(entity_id);
        }

        // Note: We keep the blueprint for potential respawn/history
        // Delete relationships
        for rel in ctx.db.relationship().iter().filter(|r| r.npc_id == entity_id) {
            ctx.db.relationship().delete(rel);
        }
    }

    // Delete entity
    ctx.db.entity().entity_id().delete(entity_id);

    log::info!("Despawned entity {} (reason: {:?})", entity_id, despawn_reason);
}

/// Kill an entity (marks as not alive, emits event, but doesn't remove).
#[reducer]
pub fn kill_entity(ctx: &ReducerContext, entity_id: u64, killer_id: Option<u64>) {
    let Some(entity) = ctx.db.entity().entity_id().find(entity_id) else {
        log::warn!("Attempted to kill non-existent entity {}", entity_id);
        return;
    };

    if !entity.alive {
        log::warn!("Entity {} is already dead", entity_id);
        return;
    }

    let tick = current_tick(ctx);
    let ts_ms = now_ms(ctx);

    // Update entity to dead
    ctx.db.entity().entity_id().update(Entity {
        alive: false,
        ..entity.clone()
    });

    // Emit EntityKilled event
    ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick,
        zone_id: entity.zone_id,
        chunk_x: entity.chunk_x,
        chunk_y: entity.chunk_y,
        actor_id: killer_id,
        target_id: Some(entity_id),
        event_type: EventType::EntityKilled.as_u16(),
        payload: Vec::new(),
    }).ok();

    log::info!("Entity {} killed by {:?}", entity_id, killer_id);
}

/// Revive a dead entity.
#[reducer]
pub fn revive_entity(ctx: &ReducerContext, entity_id: u64) {
    let Some(entity) = ctx.db.entity().entity_id().find(entity_id) else {
        log::warn!("Attempted to revive non-existent entity {}", entity_id);
        return;
    };

    if entity.alive {
        log::warn!("Entity {} is already alive", entity_id);
        return;
    }

    let tick = current_tick(ctx);
    let ts_ms = now_ms(ctx);

    // Update entity to alive
    ctx.db.entity().entity_id().update(Entity {
        alive: true,
        ..entity.clone()
    });

    // Emit EntityRevived event
    ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick,
        zone_id: entity.zone_id,
        chunk_x: entity.chunk_x,
        chunk_y: entity.chunk_y,
        actor_id: None,
        target_id: Some(entity_id),
        event_type: EventType::EntityRevived.as_u16(),
        payload: Vec::new(),
    }).ok();

    log::info!("Entity {} revived", entity_id);
}

// =============================================================================
// Transform Updates
// =============================================================================

/// Update an entity's transform.
/// This is called internally during tick processing.
pub fn update_transform(
    ctx: &ReducerContext,
    entity_id: u64,
    x: i32,
    y: i32,
    z: i32,
    yaw: i16,
    vx: i16,
    vy: i16,
    vz: i16,
) {
    let tick = current_tick(ctx);

    // Get existing transform
    let Some(_transform) = ctx.db.transform().entity_id().find(entity_id) else {
        log::warn!("No transform for entity {}", entity_id);
        return;
    };

    // Update transform
    ctx.db.transform().entity_id().update(Transform {
        entity_id,
        x,
        y,
        z,
        yaw,
        vx,
        vy,
        vz,
        last_tick: tick,
    });

    // Update entity chunk if changed
    let new_chunk_x = x / (CHUNK_SIZE_METERS * POSITION_SCALE);
    let new_chunk_y = y / (CHUNK_SIZE_METERS * POSITION_SCALE);

    if let Some(entity) = ctx.db.entity().entity_id().find(entity_id) {
        if entity.chunk_x != new_chunk_x || entity.chunk_y != new_chunk_y {
            ctx.db.entity().entity_id().update(Entity {
                chunk_x: new_chunk_x,
                chunk_y: new_chunk_y,
                ..entity
            });
        }
    }
}

/// Teleport an entity to a new position.
#[reducer]
pub fn teleport_entity(
    ctx: &ReducerContext,
    entity_id: u64,
    new_x: i32,
    new_y: i32,
    new_z: i32,
    reason: String,
) {
    let Some(transform) = ctx.db.transform().entity_id().find(entity_id) else {
        log::warn!("No transform for entity {} to teleport", entity_id);
        return;
    };

    let tick = current_tick(ctx);
    let ts_ms = now_ms(ctx);

    // Get entity for zone info
    let Some(entity) = ctx.db.entity().entity_id().find(entity_id) else {
        log::warn!("No entity {} to teleport", entity_id);
        return;
    };

    let payload = TransformTeleportPayload {
        from_x: transform.x,
        from_y: transform.y,
        from_z: transform.z,
        to_x: new_x,
        to_y: new_y,
        to_z: new_z,
        reason,
    };

    // Calculate new chunk
    let new_chunk_x = new_x / (CHUNK_SIZE_METERS * POSITION_SCALE);
    let new_chunk_y = new_y / (CHUNK_SIZE_METERS * POSITION_SCALE);

    // Update transform
    ctx.db.transform().entity_id().update(Transform {
        entity_id,
        x: new_x,
        y: new_y,
        z: new_z,
        yaw: transform.yaw,
        vx: 0,
        vy: 0,
        vz: 0,
        last_tick: tick,
    });

    // Update entity chunk
    ctx.db.entity().entity_id().update(Entity {
        chunk_x: new_chunk_x,
        chunk_y: new_chunk_y,
        ..entity
    });

    // Emit teleport event
    ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick,
        zone_id: entity.zone_id,
        chunk_x: new_chunk_x,
        chunk_y: new_chunk_y,
        actor_id: None,
        target_id: Some(entity_id),
        event_type: EventType::TransformTeleport.as_u16(),
        payload: serialize_payload(&payload),
    }).ok();

    log::info!("Teleported entity {} to ({}, {}, {})", entity_id, new_x, new_y, new_z);
}

// =============================================================================
// Player Management
// =============================================================================

/// Find a spawn position near existing players.
/// If no players exist, spawns at origin. Otherwise, spawns in an adjacent chunk
/// to a random existing player so they have a chance to meet.
fn find_spawn_position_near_players(ctx: &ReducerContext) -> (i32, i32, i32) {
    // Collect all existing player positions
    let player_positions: Vec<(i32, i32)> = ctx.db.player().iter()
        .filter_map(|p| {
            ctx.db.transform().entity_id().find(p.entity_id)
                .map(|t| (t.x, t.y))
        })
        .collect();

    if player_positions.is_empty() {
        // First player - spawn at origin
        log::info!("First player joining - spawning at origin");
        return (0, 0, 0);
    }

    // Pick a random existing player to spawn near
    let seed = ctx.timestamp.duration_since(spacetimedb::Timestamp::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let idx = (seed as usize) % player_positions.len();
    let (target_x, target_y) = player_positions[idx];

    // Calculate chunk of target player
    let target_chunk_x = target_x / (CHUNK_SIZE_METERS * POSITION_SCALE);
    let target_chunk_y = target_y / (CHUNK_SIZE_METERS * POSITION_SCALE);

    // Pick an adjacent chunk (offset by -1, 0, or +1 in each axis)
    // Use different parts of the seed for x and y offsets
    let offset_x = ((seed / 3) % 3) as i32 - 1; // -1, 0, or 1
    let offset_y = ((seed / 7) % 3) as i32 - 1; // -1, 0, or 1

    // Avoid spawning in the exact same chunk - ensure at least one offset is non-zero
    let (final_offset_x, final_offset_y) = if offset_x == 0 && offset_y == 0 {
        (1, 0) // Default to spawning one chunk to the right
    } else {
        (offset_x, offset_y)
    };

    let spawn_chunk_x = target_chunk_x + final_offset_x;
    let spawn_chunk_y = target_chunk_y + final_offset_y;

    // Convert chunk coords back to world coords (center of the chunk)
    let spawn_x = spawn_chunk_x * CHUNK_SIZE_METERS * POSITION_SCALE
                + (CHUNK_SIZE_METERS * POSITION_SCALE / 2);
    let spawn_y = spawn_chunk_y * CHUNK_SIZE_METERS * POSITION_SCALE
                + (CHUNK_SIZE_METERS * POSITION_SCALE / 2);

    log::info!(
        "Spawning new player near existing player at chunk ({}, {}) -> spawn chunk ({}, {})",
        target_chunk_x, target_chunk_y, spawn_chunk_x, spawn_chunk_y
    );

    (spawn_x, spawn_y, 0)
}

/// Connect a player and spawn their entity.
#[reducer]
pub fn player_connect(ctx: &ReducerContext, name: String) {
    let identity = ctx.sender;
    let ts_ms = now_ms(ctx);
    let tick = current_tick(ctx);

    // Check if player already exists
    if ctx.db.player().identity().find(identity).is_some() {
        log::warn!("Player {} already connected", name);
        return;
    }

    // Find spawn position near existing players
    let (spawn_x, spawn_y, spawn_z) = find_spawn_position_near_players(ctx);

    // Calculate chunk coordinates
    let chunk_x = spawn_x / (CHUNK_SIZE_METERS * POSITION_SCALE);
    let chunk_y = spawn_y / (CHUNK_SIZE_METERS * POSITION_SCALE);

    // Spawn player entity
    let entity_id = next_id(ctx, "entity");
    let zone_id = 0; // Default zone

    // Insert entity
    ctx.db.entity().try_insert(Entity {
        entity_id,
        kind: EntityKind::Player.as_u16(),
        archetype_id: 0,
        zone_id,
        chunk_x,
        chunk_y,
        alive: true,
    }).ok();

    // Insert transform
    ctx.db.transform().try_insert(Transform {
        entity_id,
        x: spawn_x,
        y: spawn_y,
        z: spawn_z,
        yaw: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        last_tick: tick,
    }).ok();

    // Insert player record
    ctx.db.player().try_insert(Player {
        identity,
        entity_id,
        name: name.clone(),
        last_input_seq: 0,
        connected_ts_ms: ts_ms,
        last_activity_ts_ms: ts_ms,
    }).ok();

    // Initialize player interest state
    ctx.db.player_interest().try_insert(PlayerInterest {
        player_id: entity_id,
        current_chunk_x: chunk_x,
        current_chunk_y: chunk_y,
        entity_ids: Vec::new(),
        lod_by_entity: Vec::new(),
        chunk_ids: Vec::new(),
        last_update_tick: tick,
    }).ok();

    // Emit PlayerConnected event
    let payload = PlayerConnectedPayload {
        name: name.clone(),
        entity_id,
    };

    ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick,
        zone_id,
        chunk_x,
        chunk_y,
        actor_id: Some(entity_id),
        target_id: None,
        event_type: EventType::PlayerConnected.as_u16(),
        payload: serialize_payload(&payload),
    }).ok();

    log::info!("Player '{}' connected with entity {} at position ({}, {}) chunk ({}, {})",
        name, entity_id, spawn_x, spawn_y, chunk_x, chunk_y);

    // Ensure starting chunks are generated around spawn point
    crate::ensure_chunks_around(ctx, zone_id, spawn_x, spawn_y, 3);
}

/// Disconnect a player.
#[reducer]
pub fn player_disconnect(ctx: &ReducerContext) {
    let identity = ctx.sender;
    let tick = current_tick(ctx);
    let ts_ms = now_ms(ctx);

    let Some(player) = ctx.db.player().identity().find(identity) else {
        log::warn!("Player not found for disconnect");
        return;
    };

    let entity_id = player.entity_id;

    // Get entity info for event
    let entity = ctx.db.entity().entity_id().find(entity_id);

    // Emit PlayerDisconnected event
    ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick,
        zone_id: entity.as_ref().map_or(0, |e| e.zone_id),
        chunk_x: entity.as_ref().map_or(0, |e| e.chunk_x),
        chunk_y: entity.as_ref().map_or(0, |e| e.chunk_y),
        actor_id: Some(entity_id),
        target_id: None,
        event_type: EventType::PlayerDisconnected.as_u16(),
        payload: Vec::new(),
    }).ok();

    // Remove player interest state
    if ctx.db.player_interest().player_id().find(entity_id).is_some() {
        ctx.db.player_interest().player_id().delete(entity_id);
    }

    // Remove player record
    ctx.db.player().identity().delete(identity);

    // Despawn player entity
    despawn_entity(ctx, entity_id, 4); // Disconnected reason

    log::info!("Player '{}' disconnected", player.name);
}

// =============================================================================
// Helper Functions
// =============================================================================

fn create_default_needs() -> Vec<u8> {
    #[derive(serde::Serialize)]
    struct Needs {
        hunger: u8,
        fatigue: u8,
        safety: u8,
        social: u8,
        wealth: u8,
    }

    let needs = Needs {
        hunger: 20,
        fatigue: 10,
        safety: 80,
        social: 50,
        wealth: 50,
    };

    serde_json::to_vec(&needs).unwrap_or_default()
}

/// Get all entities in a specific chunk.
pub fn get_entities_in_chunk(ctx: &ReducerContext, chunk_x: i32, chunk_y: i32) -> Vec<Entity> {
    ctx.db
        .entity()
        .chunk_x()
        .filter(chunk_x)
        .filter(|e| e.chunk_y == chunk_y && e.alive)
        .collect()
}

/// Get all alive entities in a zone.
pub fn get_alive_entities_in_zone(ctx: &ReducerContext, zone_id: u64) -> Vec<Entity> {
    ctx.db
        .entity()
        .zone_id()
        .filter(zone_id)
        .filter(|e| e.alive)
        .collect()
}
