//! Admin and Debug Reducers
//!
//! Implements Section 17 of the plan: Observability and debugging.
//!
//! Features:
//! - Server state inspection
//! - NPC state dump
//! - Interest set inspection
//! - Entity update emission schedule
//! - Event log queries
//! - Metrics hooks

use crate::{
    current_tick, now_ms, Entity, EntityKind,
    lod::LodTier,
    interest::{InterestSet, ChunkSet},
    TICK_RATE_HZ,
    server_state, player, entity, chunk, event_log, npc_state, npc_blueprint, player_interest, relationship, transform,
};
use serde::{Deserialize, Serialize};
use spacetimedb::{reducer, ReducerContext, Table};

// =============================================================================
// Server State Inspection
// =============================================================================

/// Server metrics snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerMetrics {
    pub current_tick: u64,
    pub uptime_seconds: u64,
    pub player_count: u32,
    pub npc_count: u32,
    pub entity_count: u32,
    pub chunk_count: u32,
    pub event_count: u64,
    pub tick_rate_hz: u64,
}

/// Get current server metrics (logs output).
#[reducer]
pub fn get_server_metrics(ctx: &ReducerContext) {
    let ts_ms = now_ms(ctx);

    let state = ctx.db.server_state().id().find(0);
    let start_ts = state.as_ref().map(|s| s.start_ts_ms).unwrap_or(ts_ms);
    let current_tick_val = state.as_ref().map(|s| s.current_tick).unwrap_or(0);

    let uptime_seconds = (ts_ms - start_ts) / 1000;

    let player_count = ctx.db.player().iter().count() as u32;
    let entity_count = ctx.db.entity().iter().count() as u32;
    let npc_count = ctx.db.entity()
        .iter()
        .filter(|e| e.kind == EntityKind::Npc.as_u16())
        .count() as u32;
    let chunk_count = ctx.db.chunk().iter().count() as u32;

    // Event count approximation (would need index scan in real implementation)
    let event_count = ctx.db.event_log().iter().count() as u64;

    let metrics = ServerMetrics {
        current_tick: current_tick_val,
        uptime_seconds,
        player_count,
        npc_count,
        entity_count,
        chunk_count,
        event_count,
        tick_rate_hz: TICK_RATE_HZ,
    };

    let json = serde_json::to_string(&metrics).unwrap_or_else(|_| "{}".to_string());
    log::info!("Server metrics: {}", json);
}

/// Get detailed server state (logs output).
#[reducer]
pub fn get_server_state(ctx: &ReducerContext) {
    #[derive(Serialize)]
    struct DetailedState {
        server_state: Option<ServerStateView>,
        players: Vec<PlayerView>,
        chunk_summary: ChunkSummary,
    }

    #[derive(Serialize)]
    struct ServerStateView {
        current_tick: u64,
        start_ts_ms: u64,
        world_seed: u64,
    }

    #[derive(Serialize)]
    struct PlayerView {
        entity_id: u64,
        name: String,
        position: (i32, i32, i32),
        chunk: (i32, i32),
        interest_size: usize,
    }

    #[derive(Serialize)]
    struct ChunkSummary {
        total_chunks: usize,
        biome_counts: std::collections::HashMap<String, usize>,
    }

    let server_state = ctx.db.server_state().id().find(0).map(|s| ServerStateView {
        current_tick: s.current_tick,
        start_ts_ms: s.start_ts_ms,
        world_seed: s.world_seed,
    });

    let players: Vec<PlayerView> = ctx.db.player().iter().map(|p| {
        let transform = ctx.db.transform().entity_id().find(p.entity_id);
        let entity = ctx.db.entity().entity_id().find(p.entity_id);
        let interest = ctx.db.player_interest().player_id().find(p.entity_id);

        let interest_size = interest
            .and_then(|i| serde_json::from_slice::<InterestSet>(&i.entity_ids).ok())
            .map(|s| s.entities.len())
            .unwrap_or(0);

        PlayerView {
            entity_id: p.entity_id,
            name: p.name.clone(),
            position: transform.map(|t| (t.x, t.y, t.z)).unwrap_or((0, 0, 0)),
            chunk: entity.map(|e| (e.chunk_x, e.chunk_y)).unwrap_or((0, 0)),
            interest_size,
        }
    }).collect();

    let mut biome_counts = std::collections::HashMap::new();
    for chunk in ctx.db.chunk().iter() {
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
        *biome_counts.entry(biome_name.to_string()).or_insert(0) += 1;
    }

    let chunk_summary = ChunkSummary {
        total_chunks: ctx.db.chunk().iter().count(),
        biome_counts,
    };

    let state = DetailedState {
        server_state,
        players,
        chunk_summary,
    };

    let json = serde_json::to_string(&state).unwrap_or_else(|_| "{}".to_string());
    log::info!("Server state: {}", json);
}

// =============================================================================
// NPC Inspection
// =============================================================================

/// Detailed NPC state dump.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpcDump {
    pub entity_id: u64,
    pub archetype_id: u32,
    pub alive: bool,
    pub position: (i32, i32, i32),
    pub chunk: (i32, i32),
    pub lod: u8,
    pub needs: Option<serde_json::Value>,
    pub blueprint: Option<serde_json::Value>,
    pub memory_summary: Vec<String>,
    pub goals: NpcGoals,
    pub watching_players: Vec<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NpcGoals {
    pub long_goal: Option<serde_json::Value>,
    pub mid_goal: Option<serde_json::Value>,
    pub short_intent: Option<serde_json::Value>,
}

/// Dump complete NPC state (logs output).
#[reducer]
pub fn dump_npc_state(ctx: &ReducerContext, npc_id: u64) {
    let entity = match ctx.db.entity().entity_id().find(npc_id) {
        Some(e) => e,
        None => {
            log::warn!("NPC {} not found", npc_id);
            return;
        }
    };

    if entity.kind != EntityKind::Npc.as_u16() {
        log::warn!("Entity {} is not an NPC", npc_id);
        return;
    }

    let transform = ctx.db.transform().entity_id().find(npc_id);
    let npc_state_val = ctx.db.npc_state().npc_id().find(npc_id);
    let blueprint = ctx.db.npc_blueprint().npc_id().find(npc_id);

    let needs = npc_state_val.as_ref()
        .and_then(|s| serde_json::from_slice(&s.needs).ok());

    let memory: Vec<String> = npc_state_val.as_ref()
        .and_then(|s| serde_json::from_slice(&s.memory_summary).ok())
        .unwrap_or_default();

    let bp_json = blueprint
        .and_then(|b| serde_json::from_slice(&b.blueprint_json).ok());

    let goals = NpcGoals {
        long_goal: npc_state_val.as_ref()
            .and_then(|s| serde_json::from_slice(&s.long_goal).ok()),
        mid_goal: npc_state_val.as_ref()
            .and_then(|s| serde_json::from_slice(&s.mid_goal).ok()),
        short_intent: npc_state_val.as_ref()
            .and_then(|s| serde_json::from_slice(&s.short_intent).ok()),
    };

    // Find players watching this NPC
    let watching_players: Vec<u64> = ctx.db.player_interest().iter()
        .filter(|pi| {
            serde_json::from_slice::<InterestSet>(&pi.entity_ids)
                .map(|s| s.entities.contains(&npc_id))
                .unwrap_or(false)
        })
        .map(|pi| pi.player_id)
        .collect();

    let dump = NpcDump {
        entity_id: npc_id,
        archetype_id: entity.archetype_id,
        alive: entity.alive,
        position: transform.map(|t| (t.x, t.y, t.z)).unwrap_or((0, 0, 0)),
        chunk: (entity.chunk_x, entity.chunk_y),
        lod: npc_state_val.map(|s| s.lod_state).unwrap_or(3),
        needs,
        blueprint: bp_json,
        memory_summary: memory,
        goals,
        watching_players,
    };

    let json = serde_json::to_string(&dump).unwrap_or_else(|_| "{}".to_string());
    log::info!("NPC state dump: {}", json);
}

/// Get summary of all NPCs in a chunk (logs output).
#[reducer]
pub fn get_chunk_npcs(ctx: &ReducerContext, cx: i32, cy: i32) {
    #[derive(Serialize)]
    struct NpcSummary {
        entity_id: u64,
        archetype_id: u32,
        position: (i32, i32),
        lod: u8,
        alive: bool,
    }

    let npcs: Vec<NpcSummary> = ctx.db.entity()
        .chunk_x()
        .filter(cx)
        .filter(|e| e.chunk_y == cy && e.kind == EntityKind::Npc.as_u16())
        .map(|e| {
            let transform = ctx.db.transform().entity_id().find(e.entity_id);
            let npc_state_val = ctx.db.npc_state().npc_id().find(e.entity_id);

            NpcSummary {
                entity_id: e.entity_id,
                archetype_id: e.archetype_id,
                position: transform.map(|t| (t.x, t.y)).unwrap_or((0, 0)),
                lod: npc_state_val.map(|s| s.lod_state).unwrap_or(3),
                alive: e.alive,
            }
        })
        .collect();

    let json = serde_json::to_string(&npcs).unwrap_or_else(|_| "[]".to_string());
    log::info!("Chunk ({}, {}) NPCs: {}", cx, cy, json);
}

// =============================================================================
// Interest Set Inspection
// =============================================================================

/// Detailed interest set view.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterestSetView {
    pub player_id: u64,
    pub current_chunk: (i32, i32),
    pub entity_count: usize,
    pub entities_by_lod: std::collections::HashMap<String, Vec<u64>>,
    pub subscribed_chunks: Vec<(i32, i32)>,
    pub last_update_tick: u64,
}

/// Get detailed interest set for a player (logs output).
#[reducer]
pub fn get_interest_set_details(ctx: &ReducerContext, player_id: u64) {
    let interest = match ctx.db.player_interest().player_id().find(player_id) {
        Some(i) => i,
        None => {
            log::warn!("No interest set for player {}", player_id);
            return;
        }
    };

    let interest_set: InterestSet = serde_json::from_slice(&interest.entity_ids)
        .unwrap_or_default();

    let chunks: ChunkSet = serde_json::from_slice(&interest.chunk_ids)
        .unwrap_or_default();

    // Group entities by LOD
    let mut entities_by_lod: std::collections::HashMap<String, Vec<u64>> = std::collections::HashMap::new();

    for (idx, &entity_id) in interest_set.entities.iter().enumerate() {
        let lod = interest_set.lods.get(idx).copied().unwrap_or(3);
        let lod_name = match lod {
            0 => "lod0",
            1 => "lod1",
            2 => "lod2",
            _ => "lod3",
        };
        entities_by_lod.entry(lod_name.to_string()).or_default().push(entity_id);
    }

    let view = InterestSetView {
        player_id,
        current_chunk: (interest.current_chunk_x, interest.current_chunk_y),
        entity_count: interest_set.entities.len(),
        entities_by_lod,
        subscribed_chunks: chunks.chunks,
        last_update_tick: interest.last_update_tick,
    };

    let json = serde_json::to_string(&view).unwrap_or_else(|_| "{}".to_string());
    log::info!("Interest set for player {}: {}", player_id, json);
}

// =============================================================================
// Event Log Queries
// =============================================================================

/// Query events by type and time range (logs output).
#[reducer]
pub fn query_events(
    ctx: &ReducerContext,
    event_type: Option<u16>,
    since_tick: Option<u64>,
    limit: u32,
) {
    #[derive(Serialize)]
    struct EventView {
        event_id: u64,
        tick: u64,
        ts_ms: u64,
        event_type: u16,
        actor_id: Option<u64>,
        target_id: Option<u64>,
        chunk: (i32, i32),
    }

    let since = since_tick.unwrap_or(0);
    let max_results = limit.min(1000) as usize;

    let events: Vec<EventView> = ctx.db.event_log()
        .iter()
        .filter(|e| e.tick >= since)
        .filter(|e| event_type.map(|t| e.event_type == t).unwrap_or(true))
        .take(max_results)
        .map(|e| EventView {
            event_id: e.event_id,
            tick: e.tick,
            ts_ms: e.ts_ms,
            event_type: e.event_type,
            actor_id: e.actor_id,
            target_id: e.target_id,
            chunk: (e.chunk_x, e.chunk_y),
        })
        .collect();

    let json = serde_json::to_string(&events).unwrap_or_else(|_| "[]".to_string());
    log::info!("Events query result: {}", json);
}

/// Get events for a specific entity (logs output).
#[reducer]
pub fn get_entity_events(ctx: &ReducerContext, entity_id: u64, limit: u32) {
    #[derive(Serialize)]
    struct EventView {
        event_id: u64,
        tick: u64,
        event_type: u16,
        event_type_name: String,
        role: String, // "actor" or "target"
    }

    let max_results = limit.min(500) as usize;

    let events: Vec<EventView> = ctx.db.event_log()
        .iter()
        .filter(|e| e.actor_id == Some(entity_id) || e.target_id == Some(entity_id))
        .take(max_results)
        .map(|e| {
            let role = if e.actor_id == Some(entity_id) { "actor" } else { "target" };
            let event_name = crate::event_types::EventType::from_u16(e.event_type)
                .map(|t| format!("{:?}", t))
                .unwrap_or_else(|| format!("Unknown({})", e.event_type));

            EventView {
                event_id: e.event_id,
                tick: e.tick,
                event_type: e.event_type,
                event_type_name: event_name,
                role: role.to_string(),
            }
        })
        .collect();

    let json = serde_json::to_string(&events).unwrap_or_else(|_| "[]".to_string());
    log::info!("Entity {} events: {}", entity_id, json);
}

// =============================================================================
// LOD and Update Schedule Inspection
// =============================================================================

/// LOD distribution summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LodDistribution {
    pub lod0_count: usize,
    pub lod1_count: usize,
    pub lod2_count: usize,
    pub lod3_count: usize,
    pub hydrated_count: usize,
    pub dehydrated_count: usize,
}

/// Get LOD distribution across all NPCs (logs output).
#[reducer]
pub fn get_lod_distribution(ctx: &ReducerContext) {
    let mut dist = LodDistribution {
        lod0_count: 0,
        lod1_count: 0,
        lod2_count: 0,
        lod3_count: 0,
        hydrated_count: 0,
        dehydrated_count: 0,
    };

    for state in ctx.db.npc_state().iter() {
        match state.lod_state {
            0 => { dist.lod0_count += 1; dist.hydrated_count += 1; }
            1 => { dist.lod1_count += 1; dist.hydrated_count += 1; }
            2 => { dist.lod2_count += 1; dist.dehydrated_count += 1; }
            _ => { dist.lod3_count += 1; dist.dehydrated_count += 1; }
        }
    }

    let json = serde_json::to_string(&dist).unwrap_or_else(|_| "{}".to_string());
    log::info!("LOD distribution: {}", json);
}

/// Get NPCs due for update in the next N ticks (logs output).
#[reducer]
pub fn get_pending_npc_updates(ctx: &ReducerContext, ticks_ahead: u64) {
    #[derive(Serialize)]
    struct PendingUpdate {
        npc_id: u64,
        lod: u8,
        update_tick: u64,
    }

    let current_tick_val = current_tick(ctx);
    let max_tick = current_tick_val + ticks_ahead;

    let mut pending: Vec<PendingUpdate> = Vec::new();

    for state in ctx.db.npc_state().iter() {
        let lod = LodTier::from_u8(state.lod_state);
        let interval = lod.update_interval();

        // Find next update tick
        let next_update = ((current_tick_val / interval) + 1) * interval;

        if next_update <= max_tick {
            pending.push(PendingUpdate {
                npc_id: state.npc_id,
                lod: state.lod_state,
                update_tick: next_update,
            });
        }
    }

    // Sort by update tick
    pending.sort_by_key(|p| p.update_tick);

    let json = serde_json::to_string(&pending).unwrap_or_else(|_| "[]".to_string());
    log::info!("Pending NPC updates: {}", json);
}

// =============================================================================
// Chunk Inspection
// =============================================================================

/// Get detailed chunk information (logs output).
#[reducer]
pub fn get_chunk_details(ctx: &ReducerContext, cx: i32, cy: i32) {
    #[derive(Serialize)]
    struct ChunkDetails {
        cx: i32,
        cy: i32,
        zone_id: u64,
        seed: u64,
        biome: String,
        poi_count: usize,
        entity_count: usize,
        npc_count: usize,
        player_count: usize,
    }

    let chunk_val = match ctx.db.chunk().iter().find(|c| c.cx == cx && c.cy == cy) {
        Some(c) => c,
        None => {
            log::warn!("Chunk ({}, {}) not found", cx, cy);
            return;
        }
    };

    let biome_name = match chunk_val.biome {
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

    #[derive(Deserialize)]
    struct Poi;

    let poi_count: usize = serde_json::from_slice::<Vec<Poi>>(&chunk_val.poi_blob)
        .map(|p| p.len())
        .unwrap_or(0);

    let entities: Vec<Entity> = ctx.db.entity()
        .chunk_x()
        .filter(cx)
        .filter(|e| e.chunk_y == cy)
        .collect();

    let entity_count = entities.len();
    let npc_count = entities.iter().filter(|e| e.kind == EntityKind::Npc.as_u16()).count();
    let player_count = entities.iter().filter(|e| e.kind == EntityKind::Player.as_u16()).count();

    let details = ChunkDetails {
        cx,
        cy,
        zone_id: chunk_val.zone_id,
        seed: chunk_val.seed,
        biome: biome_name.to_string(),
        poi_count,
        entity_count,
        npc_count,
        player_count,
    };

    let json = serde_json::to_string(&details).unwrap_or_else(|_| "{}".to_string());
    log::info!("Chunk ({}, {}) details: {}", cx, cy, json);
}

// =============================================================================
// Debug Actions
// =============================================================================

/// Spawn a test NPC at specified location.
#[reducer]
pub fn debug_spawn_npc(ctx: &ReducerContext, x: i32, y: i32, archetype_id: u32) {
    crate::spawn_entity(
        ctx,
        EntityKind::Npc.as_u16(),
        archetype_id,
        0, // zone_id
        x,
        y,
        0,
    );
    log::info!("Spawned NPC at ({}, {}) with archetype {}", x, y, archetype_id);
}

/// Teleport an entity to a new location.
#[reducer]
pub fn debug_teleport(ctx: &ReducerContext, entity_id: u64, x: i32, y: i32, z: i32) {
    crate::teleport_entity(ctx, entity_id, x, y, z, "Debug teleport".to_string());
}

/// Kill an entity.
#[reducer]
pub fn debug_kill(ctx: &ReducerContext, entity_id: u64) {
    crate::kill_entity(ctx, entity_id, None);
}

/// Revive an entity.
#[reducer]
pub fn debug_revive(ctx: &ReducerContext, entity_id: u64) {
    crate::revive_entity(ctx, entity_id);
}

/// Force generate a chunk.
#[reducer]
pub fn debug_generate_chunk(ctx: &ReducerContext, cx: i32, cy: i32) {
    crate::generate_chunk(ctx, 0, cx, cy);
}

/// Clear all events (for testing only).
#[reducer]
pub fn debug_clear_events(ctx: &ReducerContext) {
    // Note: This is a debug function - in production you'd want proper cleanup
    log::warn!("Clearing all events (debug function called)");

    // SpacetimeDB doesn't support bulk deletes directly, so this would need
    // to be implemented differently in production
    let count = ctx.db.event_log().iter().count();
    log::info!("Would clear {} events (not implemented for performance)", count);
}

/// Get relationship details between player and NPC (logs output).
#[reducer]
pub fn debug_get_relationship(ctx: &ReducerContext, player_id: u64, npc_id: u64) {
    let rel = ctx.db.relationship().iter().find(|r| r.player_id == player_id && r.npc_id == npc_id);

    match rel {
        Some(r) => {
            #[derive(Serialize)]
            struct RelView {
                player_id: u64,
                npc_id: u64,
                affinity: i16,
                trust: i16,
                flags: u32,
            }

            let view = RelView {
                player_id: r.player_id,
                npc_id: r.npc_id,
                affinity: r.affinity,
                trust: r.trust,
                flags: r.flags,
            };

            let json = serde_json::to_string(&view).unwrap_or_else(|_| "{}".to_string());
            log::info!("Relationship: {}", json);
        }
        None => {
            log::warn!("No relationship between {} and {}", player_id, npc_id);
        }
    }
}
