//! Chunk Generation System
//!
//! Implements deterministic procedural chunk generation using
//! seeded hashing. Each chunk is generated from:
//! `chunk_seed = hash(world_seed, cx, cy)`

use crate::{
    current_tick, event_types::*, next_id, now_ms, Chunk, Entity, EntityKind, EventLog,
    NpcBlueprint, NpcState, NpcRewardProfile, NpcSkills, Transform, Interactable,
    CHUNK_SIZE_METERS, POSITION_SCALE, WORLD_SEED,
    reward_profile::{generate_npc_seed, generate_reward_profile, generate_natural_talents, generate_starting_skills},
    interactables::generate_interactables,
    blueprint::{generate_procedural_blueprint, CURRENT_BLUEPRINT_VERSION},
    // Table accessor traits
    server_state, chunk, entity, transform, npc_state, npc_blueprint, npc_reward_profile, npc_skills, event_log, interactable, player,
};
use serde::{Deserialize, Serialize};
use siphasher::sip::SipHasher24;
use spacetimedb::{reducer, ReducerContext, Table};
use std::hash::{Hash, Hasher};

// =============================================================================
// Biome Types
// =============================================================================

#[repr(u16)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Biome {
    Plains = 0,
    Forest = 1,
    Desert = 2,
    Mountain = 3,
    Swamp = 4,
    Tundra = 5,
    Village = 6,
    City = 7,
    Ruins = 8,
    Coast = 9,
}

impl Biome {
    #[must_use]
    pub const fn as_u16(self) -> u16 {
        self as u16
    }

    /// Determine biome from chunk seed using deterministic rules
    #[must_use]
    pub fn from_seed(seed: u64) -> Self {
        // Use different bits of the seed for biome selection
        let biome_value = ((seed >> 16) % 100) as u8;

        match biome_value {
            0..=29 => Self::Plains,
            30..=49 => Self::Forest,
            50..=59 => Self::Desert,
            60..=69 => Self::Mountain,
            70..=74 => Self::Swamp,
            75..=79 => Self::Tundra,
            80..=89 => Self::Village,
            90..=94 => Self::City,
            95..=97 => Self::Ruins,
            98..=99 => Self::Coast,
            _ => Self::Plains,
        }
    }

    /// Get NPC spawn density for this biome (NPCs per chunk)
    #[must_use]
    pub const fn npc_density(self) -> u32 {
        match self {
            Self::Plains => 2,
            Self::Forest => 1,
            Self::Desert => 1,
            Self::Mountain => 1,
            Self::Swamp => 1,
            Self::Tundra => 0,
            Self::Village => 8,
            Self::City => 15,
            Self::Ruins => 3,
            Self::Coast => 2,
        }
    }
}

// =============================================================================
// Point of Interest (POI)
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PointOfInterest {
    /// Local X offset within chunk (0 to CHUNK_SIZE_METERS * POSITION_SCALE)
    pub local_x: i32,
    /// Local Y offset within chunk (0 to CHUNK_SIZE_METERS * POSITION_SCALE)
    pub local_y: i32,
    /// POI type
    pub poi_type: PoiType,
    /// POI-specific data
    pub data: Vec<u8>,
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PoiType {
    SpawnPoint = 0,
    Building = 1,
    Shop = 2,
    Landmark = 3,
    ResourceNode = 4,
    Camp = 5,
    Road = 6,
    Water = 7,
}

// =============================================================================
// Chunk Seed Generation
// =============================================================================

/// Compute deterministic chunk seed from world seed and coordinates.
/// Uses SipHash for fast, high-quality hashing.
#[must_use]
pub fn compute_chunk_seed(world_seed: u64, cx: i32, cy: i32) -> u64 {
    let mut hasher = SipHasher24::new_with_keys(world_seed, 0xF0D6_C4D5_6789_ABCD);
    cx.hash(&mut hasher);
    cy.hash(&mut hasher);
    hasher.finish()
}

/// Generate points of interest for a chunk based on its seed and biome.
#[must_use]
pub fn generate_pois(chunk_seed: u64, biome: Biome) -> Vec<PointOfInterest> {
    let mut pois = Vec::new();

    // Use chunk seed to determine POI count and positions
    let mut rng_state = chunk_seed;

    // Simple LCG for deterministic random numbers
    let next_random = |state: &mut u64| -> u64 {
        *state = state.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
        *state
    };

    // Determine number of POIs based on biome
    let poi_count = match biome {
        Biome::City => 5 + (next_random(&mut rng_state) % 5) as usize,
        Biome::Village => 3 + (next_random(&mut rng_state) % 3) as usize,
        Biome::Ruins => 2 + (next_random(&mut rng_state) % 3) as usize,
        _ => (next_random(&mut rng_state) % 3) as usize,
    };

    let chunk_extent = CHUNK_SIZE_METERS * POSITION_SCALE;

    for _ in 0..poi_count {
        let local_x = (next_random(&mut rng_state) % chunk_extent as u64) as i32;
        let local_y = (next_random(&mut rng_state) % chunk_extent as u64) as i32;

        let poi_type = match next_random(&mut rng_state) % 8 {
            0 => PoiType::SpawnPoint,
            1 => PoiType::Building,
            2 => PoiType::Shop,
            3 => PoiType::Landmark,
            4 => PoiType::ResourceNode,
            5 => PoiType::Camp,
            6 => PoiType::Road,
            7 => PoiType::Water,
            _ => PoiType::Landmark,
        };

        pois.push(PointOfInterest {
            local_x,
            local_y,
            poi_type,
            data: Vec::new(),
        });
    }

    pois
}

/// Generate NPC spawn points for a chunk.
#[must_use]
pub fn generate_npc_spawns(chunk_seed: u64, biome: Biome) -> Vec<(i32, i32, u32)> {
    let mut spawns = Vec::new();
    let npc_count = biome.npc_density();

    if npc_count == 0 {
        return spawns;
    }

    let mut rng_state = chunk_seed.wrapping_add(0x4BC5_BADE_1234_5678);
    let next_random = |state: &mut u64| -> u64 {
        *state = state.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
        *state
    };

    let chunk_extent = CHUNK_SIZE_METERS * POSITION_SCALE;

    for _ in 0..npc_count {
        let local_x = (next_random(&mut rng_state) % chunk_extent as u64) as i32;
        let local_y = (next_random(&mut rng_state) % chunk_extent as u64) as i32;

        // Determine archetype based on biome and random
        let archetype_id = match biome {
            Biome::Village | Biome::City => {
                match next_random(&mut rng_state) % 5 {
                    0 => 1, // Merchant
                    1 => 2, // Guard
                    2 => 3, // Villager
                    3 => 4, // Craftsman
                    _ => 5, // Wanderer
                }
            }
            Biome::Forest | Biome::Plains => {
                match next_random(&mut rng_state) % 3 {
                    0 => 6,  // Hunter
                    1 => 7,  // Farmer
                    _ => 10, // Traveler
                }
            }
            Biome::Ruins => {
                match next_random(&mut rng_state) % 2 {
                    0 => 8, // Explorer
                    _ => 9, // Scavenger
                }
            }
            _ => 10, // Traveler (default)
        };

        spawns.push((local_x, local_y, archetype_id));
    }

    spawns
}

// =============================================================================
// Reducers
// =============================================================================

/// Generate a chunk if it doesn't already exist.
/// Called when a player approaches an ungenerated chunk.
#[reducer]
pub fn generate_chunk(ctx: &ReducerContext, zone_id: u64, cx: i32, cy: i32) {
    // Check if chunk already exists
    if ctx.db.chunk().iter().any(|c| c.cx == cx && c.cy == cy) {
        log::info!("Chunk ({}, {}) already exists", cx, cy);
        return;
    }

    // Get world seed from server state, or use default
    let world_seed = ctx
        .db
        .server_state()
        .id()
        .find(0)
        .map_or(WORLD_SEED, |s| s.world_seed);

    // Compute deterministic chunk seed
    let chunk_seed = compute_chunk_seed(world_seed, cx, cy);

    // Determine biome
    let biome = Biome::from_seed(chunk_seed);

    // Generate points of interest
    let pois = generate_pois(chunk_seed, biome);
    let poi_blob = serde_json::to_vec(&pois).unwrap_or_default();

    // Insert chunk
    let _ = ctx.db.chunk().try_insert(Chunk {
        chunk_id: 0,
        cx,
        cy,
        zone_id,
        seed: chunk_seed,
        biome: biome.as_u16(),
        poi_blob: poi_blob.clone(),
    });

    // Emit ChunkGenerated event
    let tick = current_tick(ctx);
    let ts_ms = now_ms(ctx);

    let payload = ChunkGeneratedPayload {
        seed: chunk_seed,
        biome: biome.as_u16(),
        poi_count: pois.len() as u32,
    };

    let _ = ctx.db.event_log().try_insert(EventLog {
        event_id: 0, // Auto-incremented
        ts_ms,
        tick,
        zone_id,
        chunk_x: cx,
        chunk_y: cy,
        actor_id: None,
        target_id: None,
        event_type: EventType::ChunkGenerated.as_u16(),
        payload: serialize_payload(&payload),
    });

    log::info!(
        "Generated chunk ({}, {}) with biome {:?} and {} POIs",
        cx,
        cy,
        biome,
        pois.len()
    );

    // Spawn NPCs in the chunk
    spawn_chunk_npcs(ctx, zone_id, cx, cy, chunk_seed, biome);

    // Spawn interactables in the chunk
    spawn_chunk_interactables(ctx, zone_id, cx, cy, chunk_seed, biome);
}

/// Spawn NPCs for a newly generated chunk.
fn spawn_chunk_npcs(
    ctx: &ReducerContext,
    zone_id: u64,
    cx: i32,
    cy: i32,
    chunk_seed: u64,
    biome: Biome,
) {
    let spawns = generate_npc_spawns(chunk_seed, biome);
    let tick = current_tick(ctx);
    let ts_ms = now_ms(ctx);

    let chunk_origin_x = cx * CHUNK_SIZE_METERS * POSITION_SCALE;
    let chunk_origin_y = cy * CHUNK_SIZE_METERS * POSITION_SCALE;

    for (spawn_index, (local_x, local_y, archetype_id)) in spawns.iter().enumerate() {
        let entity_id = next_id(ctx, "entity");
        let world_x = chunk_origin_x + local_x;
        let world_y = chunk_origin_y + local_y;

        // Generate unique NPC seed from chunk seed, archetype, and spawn index
        let npc_seed = generate_npc_seed(chunk_seed, *archetype_id, spawn_index as u32);

        // Insert entity
        let _ = ctx.db.entity().try_insert(Entity {
            entity_id,
            kind: EntityKind::Npc.as_u16(),
            archetype_id: *archetype_id,
            zone_id,
            chunk_x: cx,
            chunk_y: cy,
            alive: true,
        });

        // Insert transform
        let _ = ctx.db.transform().try_insert(Transform {
            entity_id,
            x: world_x,
            y: world_y,
            z: 0,
            yaw: 0,
            vx: 0,
            vy: 0,
            vz: 0,
            last_tick: tick,
        });

        // Insert NPC state (starts dehydrated at LOD3)
        let _ = ctx.db.npc_state().try_insert(NpcState {
            npc_id: entity_id,
            lod_state: 3, // LOD3 - dehydrated
            long_goal: Vec::new(),
            mid_goal: Vec::new(),
            short_intent: Vec::new(),
            needs: create_default_needs(),
            memory_summary: Vec::new(),
            last_replan_ts_ms: ts_ms,
        });

        // Generate and insert procedural blueprint (deterministic from seed)
        let blueprint = generate_procedural_blueprint(*archetype_id, entity_id, chunk_seed, ts_ms);
        let blueprint_json = serde_json::to_vec(&blueprint).unwrap_or_default();
        let _ = ctx.db.npc_blueprint().try_insert(NpcBlueprint {
            npc_id: entity_id,
            blueprint_json,
            version: CURRENT_BLUEPRINT_VERSION,
            created_ts_ms: ts_ms,
        });

        // Generate and insert reward profile (deterministic from seed)
        let reward_profile = generate_reward_profile(npc_seed, *archetype_id);
        let _ = ctx.db.npc_reward_profile().try_insert(NpcRewardProfile {
            npc_id: entity_id,
            profile_seed: reward_profile.profile_seed,
            profile_json: serde_json::to_vec(&reward_profile).unwrap_or_default(),
            version: 1,
            created_ts_ms: ts_ms,
        });

        // Generate and insert skills (deterministic from seed)
        let talents = generate_natural_talents(npc_seed, *archetype_id);
        let skills = generate_starting_skills(npc_seed, *archetype_id, &talents);
        let _ = ctx.db.npc_skills().try_insert(NpcSkills {
            npc_id: entity_id,
            skills_json: serde_json::to_vec(&skills).unwrap_or_default(),
            talents_json: serde_json::to_vec(&talents).unwrap_or_default(),
            version: 1,
            updated_ts_ms: ts_ms,
        });

        // Create schedule (deterministic from seed)
        crate::schedule::create_npc_schedule(
            ctx,
            entity_id,
            npc_seed,
            *archetype_id,
            Some(&reward_profile),
        );

        // Create personality evolution tracking
        crate::personality::create_npc_personality(
            ctx,
            entity_id,
            npc_seed,
            *archetype_id,
            tick,
        );

        // Create reputation tracking
        crate::reputation::create_npc_reputation(
            ctx,
            entity_id,
            cx,
            cy,
            *archetype_id,
            tick,
        );

        // Emit EntitySpawned event
        let payload = EntitySpawnedPayload {
            kind: EntityKind::Npc.as_u16(),
            archetype_id: *archetype_id,
            x: world_x,
            y: world_y,
            z: 0,
        };

        let _ = ctx.db.event_log().try_insert(EventLog {
            event_id: 0,
            ts_ms,
            tick,
            zone_id,
            chunk_x: cx,
            chunk_y: cy,
            actor_id: None,
            target_id: Some(entity_id),
            event_type: EventType::EntitySpawned.as_u16(),
            payload: serialize_payload(&payload),
        });

        log::debug!(
            "Spawned NPC {} (archetype {}) at ({}, {}) with unique seed {}",
            entity_id, archetype_id, world_x, world_y, npc_seed
        );
    }
}

/// Spawn interactables for a newly generated chunk.
fn spawn_chunk_interactables(
    ctx: &ReducerContext,
    zone_id: u64,
    cx: i32,
    cy: i32,
    chunk_seed: u64,
    biome: Biome,
) {
    let generated = generate_interactables(chunk_seed, biome.as_u16());
    let tick = current_tick(ctx);

    let count = generated.len();

    for gen in generated {
        let _ = ctx.db.interactable().try_insert(Interactable {
            interactable_id: 0, // Auto-incremented
            chunk_x: cx,
            chunk_y: cy,
            zone_id,
            local_x: gen.local_x,
            local_y: gen.local_y,
            itype: gen.itype,
            subtype: gen.subtype,
            resource_amount: gen.resource_amount,
            resource_max: gen.resource_max,
            regen_rate: gen.regen_rate,
            owner_id: None,
            quality: gen.quality,
            flags: gen.flags,
            last_interact_tick: tick,
        });
    }
    if count > 0 {
        log::debug!(
            "Spawned {} interactables in chunk ({}, {})",
            count, cx, cy
        );
    }
}

/// Create default NPC needs state.
fn create_default_needs() -> Vec<u8> {
    #[derive(Serialize)]
    struct Needs {
        hunger: u8,    // 0-100, higher = more hungry
        fatigue: u8,   // 0-100, higher = more tired
        safety: u8,    // 0-100, higher = feels safer
        social: u8,    // 0-100, higher = less lonely
        wealth: u8,    // 0-100, relative wealth satisfaction
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

/// Ensure chunks around a position are generated.
/// Call this when a player moves or connects.
#[reducer]
pub fn ensure_chunks_around(ctx: &ReducerContext, zone_id: u64, world_x: i32, world_y: i32, radius: i32) {
    let center_cx = world_x / (CHUNK_SIZE_METERS * POSITION_SCALE);
    let center_cy = world_y / (CHUNK_SIZE_METERS * POSITION_SCALE);

    for dx in -radius..=radius {
        for dy in -radius..=radius {
            let cx = center_cx + dx;
            let cy = center_cy + dy;

            // Check if chunk exists
            let exists = ctx.db.chunk().iter().any(|c| c.cx == cx && c.cy == cy);

            if !exists {
                generate_chunk(ctx, zone_id, cx, cy);
            }
        }
    }
}

/// Get chunk data for a specific coordinate.
#[reducer]
pub fn get_chunk(ctx: &ReducerContext, zone_id: u64, cx: i32, cy: i32) {
    if let Some(chunk) = ctx.db.chunk().iter().find(|c| c.cx == cx && c.cy == cy) {
        log::info!(
            "Chunk ({}, {}): seed={}, biome={}",
            cx,
            cy,
            chunk.seed,
            chunk.biome
        );
    } else {
        log::info!("Chunk ({}, {}) not found, generating...", cx, cy);
        generate_chunk(ctx, zone_id, cx, cy);
    }
}

/// Generate a new world seed and teleport the player to unexplored terrain.
/// Existing chunks keep their original seeds; only new chunks use the new seed.
#[reducer]
pub fn new_world_seed(ctx: &ReducerContext) {
    use crate::ServerState;

    // Get caller's player entity
    let Some(player) = ctx.db.player().identity().find(ctx.sender) else {
        log::warn!("[NewWorld] Called by non-player identity");
        return;
    };

    // Generate new random seed from timestamp
    let ts = now_ms(ctx);
    let new_seed = ts.wrapping_mul(0x5DEECE66D).wrapping_add(0xB);

    // Update ServerState.world_seed
    if let Some(state) = ctx.db.server_state().id().find(0) {
        ctx.db.server_state().id().update(ServerState {
            world_seed: new_seed,
            ..state
        });
    }

    // Find unexplored location: pick a direction and go far
    // Use seed bits to pick random direction
    let angle = ((new_seed % 360) as f64).to_radians();
    let distance = 5000 * POSITION_SCALE; // 5000 meters away
    let new_x = (distance as f64 * angle.cos()) as i32;
    let new_y = (distance as f64 * angle.sin()) as i32;

    // Teleport player to new location
    if let Some(transform) = ctx.db.transform().entity_id().find(player.entity_id) {
        ctx.db.transform().entity_id().update(Transform {
            x: new_x,
            y: new_y,
            z: 0,
            vx: 0,
            vy: 0,
            vz: 0,
            ..transform
        });
    }

    log::info!(
        "[NewWorld] New seed: {:#X}, teleported player {} to ({}, {})",
        new_seed,
        player.entity_id,
        new_x,
        new_y
    );
}
