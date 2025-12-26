//! Interest Management System
//!
//! Computes per-player relevance sets based on position and distance bands.
//! Manages what entities each player receives updates for and at what LOD.

use crate::{
    current_tick,
    lod::{compute_lod_from_distance, distance_squared, distance_squared_to_meters, update_npc_lod, LodTier},
    EntityKind, PlayerInterest,
    CHUNK_SIZE_METERS, LOD2_DISTANCE_M, POSITION_SCALE,
    // Table accessor traits
    chunk, entity, transform, player, player_interest,
};
use serde::{Deserialize, Serialize};
use spacetimedb::{reducer, ReducerContext, Table};
use std::collections::{HashMap, HashSet};

// =============================================================================
// Interest Configuration
// =============================================================================

/// Maximum interest radius in chunks
pub const MAX_INTEREST_RADIUS_CHUNKS: i32 = 5;

/// Interest radius in meters (approximately LOD2 distance + buffer)
pub const INTEREST_RADIUS_M: i32 = LOD2_DISTANCE_M + 50;

/// Squared interest radius in mm^2 for fast comparison
pub const INTEREST_RADIUS_SQ: i64 =
    (INTEREST_RADIUS_M as i64 * POSITION_SCALE as i64) * (INTEREST_RADIUS_M as i64 * POSITION_SCALE as i64);

// =============================================================================
// Interest Set Data Structures
// =============================================================================

/// Serialized interest set for storage
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct InterestSet {
    /// Entity IDs in the interest set
    pub entities: Vec<u64>,
    /// LOD tier for each entity (parallel array)
    pub lods: Vec<u8>,
}

/// Serialized chunk set for storage
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChunkSet {
    /// Chunk coordinates (cx, cy pairs)
    pub chunks: Vec<(i32, i32)>,
}

/// Interest diff for replication
#[derive(Debug, Clone, Default)]
pub struct InterestDiff {
    /// Entities that entered the interest set
    pub spawned: Vec<u64>,
    /// Entities that left the interest set
    pub despawned: Vec<u64>,
    /// Entities whose LOD changed
    pub lod_changed: Vec<(u64, LodTier)>,
    /// Chunks that became relevant
    pub chunks_added: Vec<(i32, i32)>,
    /// Chunks that became irrelevant
    pub chunks_removed: Vec<(i32, i32)>,
}

// =============================================================================
// Interest Computation
// =============================================================================

/// Compute the relevance set for a player based on their position.
#[reducer]
pub fn compute_interest_set(ctx: &ReducerContext, player_entity_id: u64) {
    let tick = current_tick(ctx);

    // Get player transform
    let Some(player_transform) = ctx.db.transform().entity_id().find(player_entity_id) else {
        log::warn!("No transform for player entity {}", player_entity_id);
        return;
    };

    // Get player entity
    let Some(player_entity) = ctx.db.entity().entity_id().find(player_entity_id) else {
        log::warn!("No entity for player {}", player_entity_id);
        return;
    };

    let player_x = player_transform.x;
    let player_y = player_transform.y;
    let zone_id = player_entity.zone_id;

    // Get previous interest state
    let prev_interest = ctx.db.player_interest().player_id().find(player_entity_id);
    let prev_entities: HashSet<u64> = prev_interest
        .as_ref()
        .and_then(|i| serde_json::from_slice::<InterestSet>(&i.entity_ids).ok())
        .map(|s| s.entities.into_iter().collect())
        .unwrap_or_default();

    // Compute chunks in interest radius
    let player_chunk_x = player_x / (CHUNK_SIZE_METERS * POSITION_SCALE);
    let player_chunk_y = player_y / (CHUNK_SIZE_METERS * POSITION_SCALE);

    let mut relevant_chunks = Vec::new();
    for dx in -MAX_INTEREST_RADIUS_CHUNKS..=MAX_INTEREST_RADIUS_CHUNKS {
        for dy in -MAX_INTEREST_RADIUS_CHUNKS..=MAX_INTEREST_RADIUS_CHUNKS {
            let cx = player_chunk_x + dx;
            let cy = player_chunk_y + dy;

            // Check if chunk center is within interest radius
            let chunk_center_x = cx * CHUNK_SIZE_METERS * POSITION_SCALE + (CHUNK_SIZE_METERS * POSITION_SCALE / 2);
            let chunk_center_y = cy * CHUNK_SIZE_METERS * POSITION_SCALE + (CHUNK_SIZE_METERS * POSITION_SCALE / 2);

            let dist_sq = distance_squared(player_x, player_y, chunk_center_x, chunk_center_y);
            if dist_sq <= INTEREST_RADIUS_SQ {
                relevant_chunks.push((cx, cy));
            }
        }
    }

    // Find all alive entities in relevant chunks and compute their LOD
    let mut new_interest = InterestSet::default();
    let mut lod_updates: HashMap<u64, LodTier> = HashMap::new();

    for entity in ctx.db.entity().zone_id().filter(zone_id).filter(|e| e.alive) {
        // Skip the player itself
        if entity.entity_id == player_entity_id {
            continue;
        }

        // Check if entity is in a relevant chunk
        if !relevant_chunks.contains(&(entity.chunk_x, entity.chunk_y)) {
            continue;
        }

        // Get entity transform for precise distance calculation
        let Some(entity_transform) = ctx.db.transform().entity_id().find(entity.entity_id) else {
            continue;
        };

        let dist_sq = distance_squared(player_x, player_y, entity_transform.x, entity_transform.y);

        // Only include if within interest radius
        if dist_sq > INTEREST_RADIUS_SQ {
            continue;
        }

        let distance_m = distance_squared_to_meters(dist_sq);
        let lod = compute_lod_from_distance(distance_m);

        new_interest.entities.push(entity.entity_id);
        new_interest.lods.push(lod.as_u8());

        // Track LOD for NPC updates
        if entity.kind == EntityKind::Npc.as_u16() {
            lod_updates.insert(entity.entity_id, lod);
        }
    }

    // Compute diff from previous interest set
    let new_entities: HashSet<u64> = new_interest.entities.iter().copied().collect();

    let spawned: Vec<u64> = new_entities.difference(&prev_entities).copied().collect();
    let despawned: Vec<u64> = prev_entities.difference(&new_entities).copied().collect();

    // Update NPC LOD states
    for (npc_id, new_lod) in lod_updates {
        update_npc_lod(ctx, npc_id, new_lod, player_entity_id);
    }

    // Handle despawned NPCs - set to LOD3 if no other players are near
    for entity_id in &despawned {
        if let Some(entity) = ctx.db.entity().entity_id().find(*entity_id) {
            if entity.kind == EntityKind::Npc.as_u16() {
                // Check if any other player has this NPC in their interest set
                // For simplicity, we just set to LOD3 (in a real system, we'd check all players)
                update_npc_lod(ctx, *entity_id, LodTier::Lod3, player_entity_id);
            }
        }
    }

    // Serialize and store new interest state
    let entity_ids_blob = serde_json::to_vec(&new_interest).unwrap_or_default();
    let lod_by_entity_blob = Vec::new(); // Already encoded in entity_ids
    let chunk_ids_blob = serde_json::to_vec(&ChunkSet { chunks: relevant_chunks }).unwrap_or_default();

    let new_interest_state = PlayerInterest {
        player_id: player_entity_id,
        current_chunk_x: player_chunk_x,
        current_chunk_y: player_chunk_y,
        entity_ids: entity_ids_blob,
        lod_by_entity: lod_by_entity_blob,
        chunk_ids: chunk_ids_blob,
        last_update_tick: tick,
    };

    // Update or insert interest state
    if prev_interest.is_some() {
        ctx.db.player_interest().player_id().update(new_interest_state);
    } else {
        let _ = ctx.db.player_interest().try_insert(new_interest_state);
    }

    log::debug!(
        "Player {} interest: {} entities, {} spawned, {} despawned",
        player_entity_id,
        new_interest.entities.len(),
        spawned.len(),
        despawned.len()
    );
}

/// Get the current interest set for a player.
pub fn get_player_interest(ctx: &ReducerContext, player_entity_id: u64) -> Option<InterestSet> {
    ctx.db
        .player_interest()
        .player_id()
        .find(player_entity_id)
        .and_then(|i| serde_json::from_slice(&i.entity_ids).ok())
}

/// Get entities that should receive updates for a specific LOD this tick.
pub fn get_entities_for_update(
    ctx: &ReducerContext,
    player_entity_id: u64,
    current_tick: u64,
) -> Vec<(u64, LodTier)> {
    let Some(interest) = get_player_interest(ctx, player_entity_id) else {
        return Vec::new();
    };

    interest
        .entities
        .iter()
        .zip(interest.lods.iter())
        .filter_map(|(&entity_id, &lod_u8)| {
            let lod = LodTier::from_u8(lod_u8);
            let interval = lod.update_interval();

            if current_tick % interval == 0 {
                Some((entity_id, lod))
            } else {
                None
            }
        })
        .collect()
}

// =============================================================================
// Chunk Subscription Management
// =============================================================================

/// Subscribe a player to chunks around their position.
/// Takes separate vectors for cx and cy coordinates (must be same length).
#[reducer]
pub fn subscribe_chunks(
    ctx: &ReducerContext,
    player_entity_id: u64,
    chunk_coords_cx: Vec<i32>,
    chunk_coords_cy: Vec<i32>,
) {
    // Verify player exists
    let Some(_player_transform) = ctx.db.transform().entity_id().find(player_entity_id) else {
        log::warn!("No transform for player entity {}", player_entity_id);
        return;
    };

    let Some(player_entity) = ctx.db.entity().entity_id().find(player_entity_id) else {
        log::warn!("No entity for player {}", player_entity_id);
        return;
    };

    if chunk_coords_cx.len() != chunk_coords_cy.len() {
        log::warn!("Mismatched chunk coordinate vector lengths: cx={}, cy={}",
            chunk_coords_cx.len(), chunk_coords_cy.len());
        return;
    }

    let zone_id = player_entity.zone_id;

    // Ensure all requested chunks are generated
    for (cx, cy) in chunk_coords_cx.iter().zip(chunk_coords_cy.iter()) {
        let exists = ctx.db.chunk().iter().find(|c| c.cx == *cx && c.cy == *cy).is_some();
        if !exists {
            crate::generate_chunk(ctx, zone_id, *cx, *cy);
        }
    }

    log::debug!(
        "Player {} subscribed to {} chunks",
        player_entity_id,
        chunk_coords_cx.len()
    );
}

/// Get chunks that a player should be subscribed to based on position.
pub fn get_subscription_chunks(player_x: i32, player_y: i32, radius_chunks: i32) -> Vec<(i32, i32)> {
    let player_chunk_x = player_x / (CHUNK_SIZE_METERS * POSITION_SCALE);
    let player_chunk_y = player_y / (CHUNK_SIZE_METERS * POSITION_SCALE);

    let mut chunks = Vec::new();

    for dx in -radius_chunks..=radius_chunks {
        for dy in -radius_chunks..=radius_chunks {
            chunks.push((player_chunk_x + dx, player_chunk_y + dy));
        }
    }

    chunks
}

// =============================================================================
// Interest Query Helpers
// =============================================================================

/// Check if an entity is in a player's interest set.
pub fn is_entity_in_interest(ctx: &ReducerContext, player_entity_id: u64, entity_id: u64) -> bool {
    get_player_interest(ctx, player_entity_id)
        .map(|i| i.entities.contains(&entity_id))
        .unwrap_or(false)
}

/// Get the LOD tier of an entity for a specific player.
pub fn get_entity_lod_for_player(
    ctx: &ReducerContext,
    player_entity_id: u64,
    entity_id: u64,
) -> Option<LodTier> {
    let interest = get_player_interest(ctx, player_entity_id)?;

    interest
        .entities
        .iter()
        .zip(interest.lods.iter())
        .find(|(&eid, _)| eid == entity_id)
        .map(|(_, &lod)| LodTier::from_u8(lod))
}

/// Get all players that have an entity in their interest set.
pub fn get_players_interested_in(ctx: &ReducerContext, entity_id: u64) -> Vec<u64> {
    ctx.db
        .player_interest()
        .iter()
        .filter(|pi| {
            serde_json::from_slice::<InterestSet>(&pi.entity_ids)
                .map(|i| i.entities.contains(&entity_id))
                .unwrap_or(false)
        })
        .map(|pi| pi.player_id)
        .collect()
}

/// Get the minimum LOD for an entity across all interested players.
/// Returns the highest priority (lowest number) LOD.
pub fn get_min_lod_for_entity(ctx: &ReducerContext, entity_id: u64) -> LodTier {
    let mut min_lod = LodTier::Lod3;

    for pi in ctx.db.player_interest().iter() {
        if let Ok(interest) = serde_json::from_slice::<InterestSet>(&pi.entity_ids) {
            for (idx, &eid) in interest.entities.iter().enumerate() {
                if eid == entity_id {
                    let lod = LodTier::from_u8(interest.lods[idx]);
                    if lod < min_lod {
                        min_lod = lod;
                    }
                }
            }
        }
    }

    min_lod
}

// =============================================================================
// Update All Player Interests
// =============================================================================

/// Update interest sets for all connected players.
/// Called each tick (or every N ticks for optimization).
pub fn update_all_player_interests(ctx: &ReducerContext) {
    for player in ctx.db.player().iter() {
        compute_interest_set(ctx, player.entity_id);
    }
}
