//! Server Tick Pipeline
//!
//! Implements the authoritative server tick loop at 10-20Hz.
//! Each tick processes:
//! 1. Input queue (player commands)
//! 2. Player updates (movement, interactions)
//! 3. NPC updates by LOD tier
//! 4. Interaction resolution
//! 5. Event emission
//! 6. Interest set computation
//! 7. State synchronization

use crate::{
    ai_system::{Intent, Needs, TimeOfDay, UtilityContext, calculate_utilities, select_intent},
    current_tick,
    entity_system::update_transform,
    interest::{update_all_player_interests},
    lod::{get_npcs_to_update, HydratedState, LodTier, NpcAction},
    now_ms, action_flags, Entity, EntityKind, InputQueue, NpcState, Player, ServerState,
    POSITION_SCALE, TICK_RATE_HZ, WORLD_SEED,
    // Table accessor traits
    server_state, player, entity, transform, npc_state, input_queue, id_counter,
};
use spacetimedb::{reducer, ReducerContext, Table};
use std::time::Duration;

// =============================================================================
// Configuration
// =============================================================================

/// Tick interval in milliseconds (50ms for 20Hz)
const TICK_INTERVAL_MS: u64 = 1000 / TICK_RATE_HZ;

/// Maximum movement speed in mm per tick
const MAX_MOVE_SPEED_MM: i32 = 200; // ~4m/s at 20Hz

/// Interest update frequency (every N ticks)
const INTEREST_UPDATE_INTERVAL: u64 = 5;

/// Life tick interval for LOD3 NPCs (ticks)
const LIFE_TICK_INTERVAL: u64 = 600; // Every 30 seconds at 20Hz

// =============================================================================
// Server Initialization
// =============================================================================

/// Initialize the server state and start the tick loop.
#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    let ts_ms = now_ms(ctx);

    // Initialize server state
    let _ = ctx.db.server_state().try_insert(ServerState {
        id: 0,
        current_tick: 0,
        start_ts_ms: ts_ms,
        world_seed: WORLD_SEED,
    });

    // Initialize ID counters
    let _ = ctx.db.id_counter().try_insert(crate::IdCounter {
        name: "entity".to_string(),
        value: 0,
    });

    log::info!("Frugworld server initialized at tick 0");

    // Schedule the first tick
    schedule_tick(ctx);
}

/// Schedule the next tick execution.
fn schedule_tick(ctx: &ReducerContext) {
    let next_tick_time = ctx.timestamp + Duration::from_millis(TICK_INTERVAL_MS);
    let _ = ctx.db.server_tick_scheduled().try_insert(ServerTickScheduled {
        scheduled_id: 0,
        scheduled_at: spacetimedb::ScheduleAt::Time(next_tick_time),
    });
}

/// Table for scheduled tick execution.
#[spacetimedb::table(name = server_tick_scheduled, scheduled(server_tick))]
pub struct ServerTickScheduled {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: spacetimedb::ScheduleAt,
}

/// Main server tick reducer - called by the scheduler.
#[reducer]
pub fn server_tick(ctx: &ReducerContext, _arg: ServerTickScheduled) {
    // Get current server state
    let Some(state) = ctx.db.server_state().id().find(0) else {
        log::error!("Server state not found!");
        return;
    };

    let tick = state.current_tick + 1;
    let ts_ms = now_ms(ctx);

    // Update tick counter
    ctx.db.server_state().id().update(ServerState {
        current_tick: tick,
        ..state
    });

    // Execute tick pipeline
    tick_pipeline(ctx, tick, ts_ms);

    // Schedule next tick
    schedule_tick(ctx);
}

// =============================================================================
// Tick Pipeline
// =============================================================================

/// Execute the full tick pipeline.
fn tick_pipeline(ctx: &ReducerContext, tick: u64, ts_ms: u64) {
    // 1. Process input queue
    process_input_queue(ctx, tick);

    // 2. Update players
    update_players(ctx, tick);

    // 3. Update NPCs by LOD
    update_npcs(ctx, tick, ts_ms);

    // 4. Resolve interactions (placeholder)
    resolve_interactions(ctx, tick);

    // 5. Update interest sets (every N ticks)
    if tick % INTEREST_UPDATE_INTERVAL == 0 {
        update_all_player_interests(ctx);
    }

    // 6. Life tick for LOD3 NPCs
    if tick % LIFE_TICK_INTERVAL == 0 {
        process_life_ticks(ctx, tick, ts_ms);
    }

    // Log tick completion (debug only)
    if tick % 100 == 0 {
        let player_count = ctx.db.player().iter().count();
        let npc_count = ctx.db.entity().iter().filter(|e| e.kind == EntityKind::Npc.as_u16()).count();
        log::debug!("Tick {}: {} players, {} NPCs", tick, player_count, npc_count);
    }
}

// =============================================================================
// Input Processing
// =============================================================================

/// Process all queued player inputs.
fn process_input_queue(ctx: &ReducerContext, tick: u64) {
    // Collect all inputs to process
    let inputs: Vec<InputQueue> = ctx.db.input_queue().iter().collect();

    for input in inputs {
        process_single_input(ctx, &input, tick);
        // Delete processed input
        ctx.db.input_queue().id().delete(input.id);
    }
}

/// Maximum allowed movement per tick for anti-cheat validation (mm)
/// This is generous to allow for physics acceleration: 20m/s * 50ms = 1000mm per tick
const MAX_MOVE_PER_TICK_MM: i32 = 1500;

/// Process a single player input.
fn process_single_input(ctx: &ReducerContext, input: &InputQueue, tick: u64) {
    // Get player
    let Some(player) = ctx.db.player().iter().find(|p| p.entity_id == input.player_id) else {
        log::warn!("Input for unknown player {}", input.player_id);
        return;
    };

    // Get player transform
    let Some(transform) = ctx.db.transform().entity_id().find(input.player_id) else {
        log::warn!("No transform for player {}", input.player_id);
        return;
    };

    // Validate input sequence (basic anti-cheat)
    if input.input_seq <= player.last_input_seq {
        log::warn!(
            "Out-of-order input from player {}: {} <= {}",
            input.player_id,
            input.input_seq,
            player.last_input_seq
        );
        return;
    }

    // Use client's predicted position (with anti-cheat validation)
    // Calculate movement delta from client prediction
    let move_x = input.predicted_x - transform.x;
    let move_y = input.predicted_y - transform.y;
    let move_z = input.predicted_z - transform.z;

    // Anti-cheat: validate movement isn't too fast
    // Allow generous movement to account for client physics and multiple inputs batched
    let dist_sq = (move_x as i64 * move_x as i64) + (move_y as i64 * move_y as i64);
    let max_dist_sq = (MAX_MOVE_PER_TICK_MM as i64) * (MAX_MOVE_PER_TICK_MM as i64);

    let (new_x, new_y, new_z) = if dist_sq > max_dist_sq {
        // Movement too fast - clamp to maximum allowed
        log::warn!(
            "Player {} moved too fast: {} mm, clamping to {}",
            input.player_id,
            (dist_sq as f64).sqrt() as i32,
            MAX_MOVE_PER_TICK_MM
        );
        let scale = (max_dist_sq as f64 / dist_sq as f64).sqrt();
        (
            transform.x + (move_x as f64 * scale) as i32,
            transform.y + (move_y as f64 * scale) as i32,
            input.predicted_z, // Z is less critical, allow it
        )
    } else {
        // Movement is valid, use client's predicted position
        (input.predicted_x, input.predicted_y, input.predicted_z)
    };

    // Calculate velocity from movement delta (for interpolation)
    let vx = (move_x / 10).clamp(-32768, 32767) as i16;
    let vy = (move_y / 10).clamp(-32768, 32767) as i16;
    let vz = (move_z / 10).clamp(-32768, 32767) as i16;

    // Update transform with client's predicted position
    update_transform(
        ctx,
        input.player_id,
        new_x,
        new_y,
        new_z,
        input.aim_yaw,
        vx,
        vy,
        vz,
    );

    // Update last input seq
    ctx.db.player().identity().update(Player {
        last_input_seq: input.input_seq,
        last_activity_ts_ms: now_ms(ctx),
        ..player
    });

    // Process actions
    if input.actions & action_flags::INTERACT != 0 {
        process_interact_action(ctx, input.player_id, tick);
    }
}

/// Process player interact action.
fn process_interact_action(ctx: &ReducerContext, player_id: u64, _tick: u64) {
    // Get player position
    let Some(player_transform) = ctx.db.transform().entity_id().find(player_id) else {
        return;
    };

    // Find nearby interactable entities (within LOD0 range)
    let interact_range_sq: i64 = (15 * POSITION_SCALE as i64) * (15 * POSITION_SCALE as i64);

    for entity in ctx.db.entity().iter().filter(|e| e.alive && e.entity_id != player_id) {
        let Some(entity_transform) = ctx.db.transform().entity_id().find(entity.entity_id) else {
            continue;
        };

        let dx = (entity_transform.x - player_transform.x) as i64;
        let dy = (entity_transform.y - player_transform.y) as i64;
        let dist_sq = dx * dx + dy * dy;

        if dist_sq <= interact_range_sq {
            // Found interactable entity
            log::debug!("Player {} interacting with entity {}", player_id, entity.entity_id);
            // TODO: Emit interaction event and handle based on entity type
            break;
        }
    }
}

// =============================================================================
// Player Updates
// =============================================================================

/// Update all player states.
fn update_players(ctx: &ReducerContext, _tick: u64) {
    for player in ctx.db.player().iter() {
        // Get entity and transform
        let Some(entity) = ctx.db.entity().entity_id().find(player.entity_id) else {
            continue;
        };

        if !entity.alive {
            continue;
        }

        // Update player-specific state (e.g., cooldowns, buffs)
        // Placeholder for now
    }
}

// =============================================================================
// NPC Updates
// =============================================================================

/// Update NPCs based on their LOD tier.
fn update_npcs(ctx: &ReducerContext, tick: u64, _ts_ms: u64) {
    let npcs_to_update = get_npcs_to_update(ctx, tick);

    for (npc_id, lod) in npcs_to_update {
        match lod {
            LodTier::Lod0 => update_npc_lod0(ctx, npc_id, tick),
            LodTier::Lod1 => update_npc_lod1(ctx, npc_id, tick),
            LodTier::Lod2 => update_npc_lod2(ctx, npc_id, tick),
            LodTier::Lod3 => {} // Handled by life tick
        }
    }
}

/// Update an NPC at LOD0 (full simulation).
fn update_npc_lod0(ctx: &ReducerContext, npc_id: u64, tick: u64) {
    let Some(npc_state) = ctx.db.npc_state().npc_id().find(npc_id) else {
        return;
    };

    let Some(transform) = ctx.db.transform().entity_id().find(npc_id) else {
        return;
    };

    let Some(entity) = ctx.db.entity().entity_id().find(npc_id) else {
        return;
    };

    // Parse hydrated state
    let mut hydrated: HydratedState = if npc_state.short_intent.is_empty() {
        HydratedState::default()
    } else {
        serde_json::from_slice(&npc_state.short_intent).unwrap_or_default()
    };

    // Parse needs for AI decisions
    let needs: Needs = serde_json::from_slice(&npc_state.needs).unwrap_or_default();

    // Execute current action
    match hydrated.current_action {
        NpcAction::Idle => {
            // Use AI system to decide next action (every 40 ticks, staggered by NPC ID)
            if tick % 40 == (npc_id % 40) {
                // Build utility context for AI decision
                let nearby_players = ctx.db.entity()
                    .chunk_x()
                    .filter(entity.chunk_x)
                    .filter(|e| e.chunk_y == entity.chunk_y && e.kind == EntityKind::Player.as_u16() && e.alive)
                    .count() as u32;

                let utility_ctx = UtilityContext {
                    needs: needs.clone(),
                    current_intent: Intent::Idle,
                    ticks_in_intent: 0,
                    time_of_day: TimeOfDay::from_tick(tick),
                    nearby_players,
                    nearby_threats: 0,
                    near_poi: None,
                    archetype_id: entity.archetype_id,
                };

                // Calculate utilities and select best intent
                let utilities = calculate_utilities(&utility_ctx);
                let new_intent = select_intent(&utilities);

                // Convert intent to action and set target
                hydrated.current_action = new_intent.to_action();

                // Set movement target based on intent
                match new_intent {
                    Intent::Wander | Intent::GoHome | Intent::Patrol => {
                        // Wander to random nearby location
                        hydrated.target_x = transform.x + ((npc_id as i32 % 200) - 100) * POSITION_SCALE;
                        hydrated.target_y = transform.y + (((npc_id / 2) as i32 % 200) - 100) * POSITION_SCALE;
                    }
                    Intent::SeekFood => {
                        // Move toward food source (simplified: random direction)
                        hydrated.target_x = transform.x + ((npc_id as i32 % 300) - 150) * POSITION_SCALE;
                        hydrated.target_y = transform.y + (((npc_id / 3) as i32 % 300) - 150) * POSITION_SCALE;
                    }
                    Intent::AvoidThreat => {
                        // Flee in opposite direction from threat (simplified: random escape)
                        hydrated.target_x = transform.x + ((npc_id as i32 % 400) - 200) * POSITION_SCALE;
                        hydrated.target_y = transform.y + (((npc_id / 4) as i32 % 400) - 200) * POSITION_SCALE;
                    }
                    _ => {
                        // Other intents are stationary or have specific targets
                    }
                }

                // Initialize steering velocity toward target if moving
                if matches!(hydrated.current_action, NpcAction::Walking | NpcAction::Running | NpcAction::Fleeing) {
                    let dx = hydrated.target_x - transform.x;
                    let dy = hydrated.target_y - transform.y;
                    let dist_sq = (dx as i64 * dx as i64 + dy as i64 * dy as i64) as f64;
                    let dist = dist_sq.sqrt() as i32;

                    if dist > 100 {
                        let speed = match hydrated.current_action {
                            NpcAction::Walking => 100,
                            NpcAction::Running => 150,
                            NpcAction::Fleeing => 200,
                            _ => 100,
                        };
                        hydrated.steering_vx = (dx * speed / dist.max(1)) as i16;
                        hydrated.steering_vy = (dy * speed / dist.max(1)) as i16;
                    }
                }
            }
        }
        NpcAction::Walking => {
            // Move toward target
            let dx = hydrated.target_x - transform.x;
            let dy = hydrated.target_y - transform.y;
            let dist_sq = (dx as i64 * dx as i64 + dy as i64 * dy as i64) as f64;
            let dist = dist_sq.sqrt() as i32;

            if dist < 100 {
                // Reached target
                hydrated.current_action = NpcAction::Idle;
                hydrated.steering_vx = 0;
                hydrated.steering_vy = 0;

                // Clear velocity in transform
                update_transform(ctx, npc_id, transform.x, transform.y, transform.z, transform.yaw, 0, 0, 0);
            } else {
                // Move toward target with smooth steering
                let speed = 100; // mm per tick (~2m/s at 20Hz)
                let vx = (dx * speed / dist.max(1)) as i16;
                let vy = (dy * speed / dist.max(1)) as i16;
                hydrated.steering_vx = vx;
                hydrated.steering_vy = vy;

                let new_x = transform.x + vx as i32;
                let new_y = transform.y + vy as i32;

                // Calculate yaw from movement direction (atan2(y, x) in radians, convert to degrees * 100)
                let yaw = ((dy as f32).atan2(dx as f32).to_degrees() * 100.0) as i16;

                update_transform(ctx, npc_id, new_x, new_y, transform.z, yaw, vx, vy, 0);
            }
        }
        NpcAction::Running => {
            // Running is faster walking (1.5x speed)
            let dx = hydrated.target_x - transform.x;
            let dy = hydrated.target_y - transform.y;
            let dist_sq = (dx as i64 * dx as i64 + dy as i64 * dy as i64) as f64;
            let dist = dist_sq.sqrt() as i32;

            if dist < 200 {
                // Reached target, transition to idle
                hydrated.current_action = NpcAction::Idle;
                hydrated.steering_vx = 0;
                hydrated.steering_vy = 0;
                update_transform(ctx, npc_id, transform.x, transform.y, transform.z, transform.yaw, 0, 0, 0);
            } else {
                let speed = 150; // mm per tick (~3m/s at 20Hz)
                let vx = (dx * speed / dist.max(1)) as i16;
                let vy = (dy * speed / dist.max(1)) as i16;
                hydrated.steering_vx = vx;
                hydrated.steering_vy = vy;

                let new_x = transform.x + vx as i32;
                let new_y = transform.y + vy as i32;
                let yaw = ((dy as f32).atan2(dx as f32).to_degrees() * 100.0) as i16;

                update_transform(ctx, npc_id, new_x, new_y, transform.z, yaw, vx, vy, 0);
            }
        }
        NpcAction::Fleeing => {
            // Fleeing is fastest (2x speed) and continues until target reached
            let dx = hydrated.target_x - transform.x;
            let dy = hydrated.target_y - transform.y;
            let dist_sq = (dx as i64 * dx as i64 + dy as i64 * dy as i64) as f64;
            let dist = dist_sq.sqrt() as i32;

            if dist < 500 {
                // Far enough, stop fleeing
                hydrated.current_action = NpcAction::Idle;
                hydrated.steering_vx = 0;
                hydrated.steering_vy = 0;
                update_transform(ctx, npc_id, transform.x, transform.y, transform.z, transform.yaw, 0, 0, 0);
            } else {
                let speed = 200; // mm per tick (~4m/s at 20Hz)
                let vx = (dx * speed / dist.max(1)) as i16;
                let vy = (dy * speed / dist.max(1)) as i16;
                hydrated.steering_vx = vx;
                hydrated.steering_vy = vy;

                let new_x = transform.x + vx as i32;
                let new_y = transform.y + vy as i32;
                let yaw = ((dy as f32).atan2(dx as f32).to_degrees() * 100.0) as i16;

                update_transform(ctx, npc_id, new_x, new_y, transform.z, yaw, vx, vy, 0);
            }
        }
        NpcAction::Working | NpcAction::Resting | NpcAction::Eating | NpcAction::Talking | NpcAction::Trading => {
            // Progress action (stationary actions)
            hydrated.action_progress = hydrated.action_progress.saturating_add(2);
            if hydrated.action_progress >= 100 {
                hydrated.action_progress = 0;
                hydrated.current_action = NpcAction::Idle;
            }
        }
        NpcAction::Fighting => {
            // Fighting has small movements, progress toward resolution
            hydrated.action_progress = hydrated.action_progress.saturating_add(1);
            if hydrated.action_progress >= 100 {
                hydrated.action_progress = 0;
                hydrated.current_action = NpcAction::Idle;
            }
        }
    }

    // Update NPC state
    ctx.db.npc_state().npc_id().update(NpcState {
        short_intent: serde_json::to_vec(&hydrated).unwrap_or_default(),
        ..npc_state
    });
}

/// Update an NPC at LOD1 (simplified simulation).
fn update_npc_lod1(ctx: &ReducerContext, npc_id: u64, tick: u64) {
    let Some(npc_state) = ctx.db.npc_state().npc_id().find(npc_id) else {
        return;
    };

    let Some(transform) = ctx.db.transform().entity_id().find(npc_id) else {
        return;
    };

    // Parse hydrated state
    let mut hydrated: HydratedState = if npc_state.short_intent.is_empty() {
        HydratedState::default()
    } else {
        serde_json::from_slice(&npc_state.short_intent).unwrap_or_default()
    };

    match hydrated.current_action {
        NpcAction::Idle => {
            // LOD1 NPCs also occasionally start wandering (less frequently than LOD0)
            // Use a larger interval (80 ticks = 4 seconds at 20Hz)
            if tick % 80 == (npc_id % 80) {
                hydrated.current_action = NpcAction::Walking;
                // Smaller wander range for LOD1 (50-150 meters)
                hydrated.target_x = transform.x + ((npc_id as i32 % 150) - 75) * POSITION_SCALE;
                hydrated.target_y = transform.y + (((npc_id / 3) as i32 % 150) - 75) * POSITION_SCALE;

                // Calculate initial velocity toward target
                let dx = hydrated.target_x - transform.x;
                let dy = hydrated.target_y - transform.y;
                let dist_sq = (dx as i64 * dx as i64 + dy as i64 * dy as i64) as f64;
                let dist = dist_sq.sqrt() as i32;

                if dist > 100 {
                    let speed = 80; // Slightly slower for LOD1 (mm per tick)
                    hydrated.steering_vx = (dx * speed / dist.max(1)) as i16;
                    hydrated.steering_vy = (dy * speed / dist.max(1)) as i16;
                }
            }
        }
        NpcAction::Walking => {
            // Continue movement toward target
            let new_x = transform.x + hydrated.steering_vx as i32;
            let new_y = transform.y + hydrated.steering_vy as i32;

            // Check if reached target (approximate)
            let dx = hydrated.target_x - new_x;
            let dy = hydrated.target_y - new_y;
            if dx.abs() < 500 && dy.abs() < 500 {
                hydrated.current_action = NpcAction::Idle;
                hydrated.steering_vx = 0;
                hydrated.steering_vy = 0;
            } else {
                // Recalculate yaw from movement direction
                let yaw = ((dy as f32).atan2(dx as f32).to_degrees() * 100.0) as i16;

                update_transform(
                    ctx,
                    npc_id,
                    new_x,
                    new_y,
                    transform.z,
                    yaw,
                    hydrated.steering_vx,
                    hydrated.steering_vy,
                    0,
                );
            }
        }
        NpcAction::Running => {
            // Running movement (faster speed)
            let speed_mult = 3;
            let new_x = transform.x + (hydrated.steering_vx as i32 * speed_mult / 2);
            let new_y = transform.y + (hydrated.steering_vy as i32 * speed_mult / 2);

            let dx = hydrated.target_x - new_x;
            let dy = hydrated.target_y - new_y;
            if dx.abs() < 500 && dy.abs() < 500 {
                hydrated.current_action = NpcAction::Idle;
                hydrated.steering_vx = 0;
                hydrated.steering_vy = 0;
            } else {
                let yaw = ((dy as f32).atan2(dx as f32).to_degrees() * 100.0) as i16;
                let vx_display = (hydrated.steering_vx as i32 * speed_mult / 2) as i16;
                let vy_display = (hydrated.steering_vy as i32 * speed_mult / 2) as i16;

                update_transform(ctx, npc_id, new_x, new_y, transform.z, yaw, vx_display, vy_display, 0);
            }
        }
        NpcAction::Fleeing => {
            // Fleeing is similar to running but continues until safe
            let speed_mult = 4;
            let new_x = transform.x + (hydrated.steering_vx as i32 * speed_mult / 2);
            let new_y = transform.y + (hydrated.steering_vy as i32 * speed_mult / 2);

            let dx = hydrated.target_x - new_x;
            let dy = hydrated.target_y - new_y;
            if dx.abs() < 1000 && dy.abs() < 1000 {
                hydrated.current_action = NpcAction::Idle;
                hydrated.steering_vx = 0;
                hydrated.steering_vy = 0;
            } else {
                let yaw = ((dy as f32).atan2(dx as f32).to_degrees() * 100.0) as i16;
                let vx_display = (hydrated.steering_vx as i32 * speed_mult / 2) as i16;
                let vy_display = (hydrated.steering_vy as i32 * speed_mult / 2) as i16;

                update_transform(ctx, npc_id, new_x, new_y, transform.z, yaw, vx_display, vy_display, 0);
            }
        }
        _ => {
            // Other actions don't involve movement at LOD1
        }
    }

    // Update state
    ctx.db.npc_state().npc_id().update(NpcState {
        short_intent: serde_json::to_vec(&hydrated).unwrap_or_default(),
        ..npc_state
    });
}

/// Update an NPC at LOD2 (coarse simulation).
fn update_npc_lod2(ctx: &ReducerContext, npc_id: u64, _tick: u64) {
    // LOD2 updates are minimal - just decay needs slightly
    let Some(npc_state) = ctx.db.npc_state().npc_id().find(npc_id) else {
        return;
    };

    // Parse and update needs
    #[derive(serde::Serialize, serde::Deserialize, Default)]
    struct Needs {
        hunger: u8,
        fatigue: u8,
        safety: u8,
        social: u8,
        wealth: u8,
    }

    let mut needs: Needs = serde_json::from_slice(&npc_state.needs).unwrap_or_default();

    // Slow decay
    needs.hunger = needs.hunger.saturating_add(1).min(100);
    needs.fatigue = needs.fatigue.saturating_add(1).min(100);

    ctx.db.npc_state().npc_id().update(NpcState {
        needs: serde_json::to_vec(&needs).unwrap_or_default(),
        ..npc_state
    });
}

// =============================================================================
// Life Tick (LOD3)
// =============================================================================

/// Process life ticks for all LOD3 NPCs.
fn process_life_ticks(ctx: &ReducerContext, tick: u64, ts_ms: u64) {
    for npc_state in ctx.db.npc_state().iter().filter(|s| s.lod_state == 3) {
        process_npc_life_tick(ctx, npc_state.npc_id, tick, ts_ms);
    }
}

/// Process a single NPC's life tick.
fn process_npc_life_tick(ctx: &ReducerContext, npc_id: u64, _tick: u64, _ts_ms: u64) {
    let Some(npc_state) = ctx.db.npc_state().npc_id().find(npc_id) else {
        return;
    };

    // Parse dehydrated state
    #[derive(serde::Serialize, serde::Deserialize, Default)]
    struct DehydratedState {
        last_chunk_x: i32,
        last_chunk_y: i32,
        schedule_phase: u8,
        schedule_remaining_ms: u64,
        intent_summary: String,
    }

    let mut dehydrated: DehydratedState =
        serde_json::from_slice(&npc_state.short_intent).unwrap_or_default();

    // Progress schedule
    if dehydrated.schedule_remaining_ms > 30000 {
        dehydrated.schedule_remaining_ms -= 30000;
    } else {
        // Transition to next schedule phase
        dehydrated.schedule_phase = (dehydrated.schedule_phase + 1) % 8;
        dehydrated.schedule_remaining_ms = 60000 + (npc_id % 30000);
    }

    // Potentially move to adjacent chunk
    if dehydrated.schedule_phase == 6 {
        // Traveling phase
        let dx = ((npc_id % 3) as i32) - 1;
        let dy = (((npc_id / 3) % 3) as i32) - 1;
        dehydrated.last_chunk_x += dx;
        dehydrated.last_chunk_y += dy;

        // Update entity chunk
        if let Some(entity) = ctx.db.entity().entity_id().find(npc_id) {
            ctx.db.entity().entity_id().update(Entity {
                chunk_x: dehydrated.last_chunk_x,
                chunk_y: dehydrated.last_chunk_y,
                ..entity
            });
        }
    }

    // Update needs (faster decay for life tick)
    #[derive(serde::Serialize, serde::Deserialize, Default)]
    struct Needs {
        hunger: u8,
        fatigue: u8,
        safety: u8,
        social: u8,
        wealth: u8,
    }

    let mut needs: Needs = serde_json::from_slice(&npc_state.needs).unwrap_or_default();
    needs.hunger = needs.hunger.saturating_add(5).min(100);
    needs.fatigue = needs.fatigue.saturating_add(3).min(100);
    needs.social = needs.social.saturating_sub(2);

    // Update state
    ctx.db.npc_state().npc_id().update(NpcState {
        short_intent: serde_json::to_vec(&dehydrated).unwrap_or_default(),
        needs: serde_json::to_vec(&needs).unwrap_or_default(),
        ..npc_state
    });
}

// =============================================================================
// Interaction Resolution
// =============================================================================

/// Resolve pending interactions (placeholder).
fn resolve_interactions(_ctx: &ReducerContext, _tick: u64) {
    // TODO: Process collision detection, trigger volumes, transactions
}

// =============================================================================
// Input Reducer (Client-facing)
// =============================================================================

/// Reducer for clients to submit input commands.
/// Now includes client's predicted position for server-side validation.
#[reducer]
pub fn submit_input(
    ctx: &ReducerContext,
    input_seq: u32,
    client_time_ms: u64,
    move_x: i16,
    move_y: i16,
    actions: u32,
    aim_yaw: i16,
    predicted_x: i32,
    predicted_y: i32,
    predicted_z: i32,
) {
    // Get player from identity
    let Some(player) = ctx.db.player().identity().find(ctx.sender) else {
        log::warn!("Input from unknown identity");
        return;
    };

    // Validate input
    if move_x < -32767 || move_x > 32767 || move_y < -32767 || move_y > 32767 {
        log::warn!("Invalid input values from player {}", player.entity_id);
        return;
    }

    // Queue input for processing on next tick
    let _ = ctx.db.input_queue().try_insert(InputQueue {
        id: 0, // Auto-incremented
        player_id: player.entity_id,
        input_seq,
        client_time_ms,
        move_x,
        move_y,
        actions,
        aim_yaw,
        predicted_x,
        predicted_y,
        predicted_z,
    });
}

// =============================================================================
// Debug/Admin Reducers
// =============================================================================

/// Get current server tick (for debugging).
#[reducer]
pub fn get_server_tick(ctx: &ReducerContext) {
    let tick = current_tick(ctx);
    log::info!("Current server tick: {}", tick);
}

/// Force interest update for all players.
#[reducer]
pub fn force_interest_update(ctx: &ReducerContext) {
    update_all_player_interests(ctx);
    log::info!("Forced interest update for all players");
}
