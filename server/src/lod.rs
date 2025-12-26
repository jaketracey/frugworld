//! LOD (Level of Detail) System
//!
//! Manages multi-resolution NPC simulation based on distance to players.
//! LOD tiers:
//! - LOD0 (0-15m): Full interactive simulation, dialogue enabled
//! - LOD1 (15-60m): Nearby, simplified steering and utility only
//! - LOD2 (60-250m): Far, coarse waypoints and schedule
//! - LOD3 (>250m): Abstract life simulation, minutes-scale updates

use crate::{
    current_tick, event_types::*, now_ms, EventLog, NpcState,
    LOD0_DISTANCE_M, LOD1_DISTANCE_M, LOD2_DISTANCE_M, POSITION_SCALE,
    // Table accessor traits
    entity, npc_state, event_log,
};
use serde::{Deserialize, Serialize};
use spacetimedb::{reducer, ReducerContext, Table};

// =============================================================================
// LOD Tier Definition
// =============================================================================

/// LOD tier enum for type safety
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum LodTier {
    /// Full interactive simulation (0-15m)
    Lod0 = 0,
    /// Nearby simplified (15-60m)
    Lod1 = 1,
    /// Far coarse (60-250m)
    Lod2 = 2,
    /// Abstract/offline (>250m)
    Lod3 = 3,
}

impl LodTier {
    #[must_use]
    pub const fn as_u8(self) -> u8 {
        self as u8
    }

    #[must_use]
    pub const fn from_u8(value: u8) -> Self {
        match value {
            0 => Self::Lod0,
            1 => Self::Lod1,
            2 => Self::Lod2,
            _ => Self::Lod3,
        }
    }

    /// Get update frequency in ticks for this LOD tier.
    /// At 20Hz tick rate:
    /// - LOD0: every tick (20Hz)
    /// - LOD1: every 2 ticks (10Hz)
    /// - LOD2: every 20 ticks (1Hz)
    /// - LOD3: every 1200 ticks (once per minute)
    #[must_use]
    pub const fn update_interval(self) -> u64 {
        match self {
            Self::Lod0 => 1,
            Self::Lod1 => 2,
            Self::Lod2 => 20,
            Self::Lod3 => 1200,
        }
    }

    /// Check if this LOD tier allows dialogue (all tiers allowed).
    #[must_use]
    pub const fn allows_dialogue(self) -> bool {
        true
    }

    /// Check if this LOD tier allows interaction.
    #[must_use]
    pub const fn allows_interaction(self) -> bool {
        matches!(self, Self::Lod0 | Self::Lod1)
    }

    /// Check if this LOD tier uses full pathfinding.
    #[must_use]
    pub const fn uses_full_pathfinding(self) -> bool {
        matches!(self, Self::Lod0)
    }

    /// Check if this LOD tier is hydrated (has full runtime state).
    #[must_use]
    pub const fn is_hydrated(self) -> bool {
        matches!(self, Self::Lod0 | Self::Lod1)
    }
}

/// Compute LOD tier from distance in meters.
#[must_use]
pub fn compute_lod_from_distance(distance_m: i32) -> LodTier {
    if distance_m <= LOD0_DISTANCE_M {
        LodTier::Lod0
    } else if distance_m <= LOD1_DISTANCE_M {
        LodTier::Lod1
    } else if distance_m <= LOD2_DISTANCE_M {
        LodTier::Lod2
    } else {
        LodTier::Lod3
    }
}

/// Compute squared distance between two positions (to avoid sqrt).
/// Positions are in quantized millimeters.
#[must_use]
pub fn distance_squared(x1: i32, y1: i32, x2: i32, y2: i32) -> i64 {
    let dx = (x2 - x1) as i64;
    let dy = (y2 - y1) as i64;
    dx * dx + dy * dy
}

/// Convert distance squared (in mm^2) to meters.
#[must_use]
pub fn distance_squared_to_meters(dist_sq: i64) -> i32 {
    // sqrt(dist_sq) / POSITION_SCALE to get meters
    // We use integer sqrt approximation
    let dist_mm = isqrt(dist_sq as u64) as i32;
    dist_mm / POSITION_SCALE
}

/// Integer square root (Newton's method).
fn isqrt(n: u64) -> u64 {
    if n == 0 {
        return 0;
    }

    let mut x = n;
    let mut y = (x + 1) / 2;

    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }

    x
}

// =============================================================================
// LOD State Management
// =============================================================================

/// Hydrated NPC state for LOD0/LOD1.
/// Contains full runtime simulation data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HydratedState {
    /// Current pathfinding waypoints
    pub waypoints: Vec<(i32, i32)>,
    /// Current target position
    pub target_x: i32,
    pub target_y: i32,
    /// Current action state
    pub current_action: NpcAction,
    /// Action progress (0-100)
    pub action_progress: u8,
    /// Steering velocity
    pub steering_vx: i16,
    pub steering_vy: i16,
    /// Interaction target (if any)
    pub interaction_target: Option<u64>,
    /// Time since last interaction
    pub interaction_cooldown_ms: u64,
}

impl Default for HydratedState {
    fn default() -> Self {
        Self {
            waypoints: Vec::new(),
            target_x: 0,
            target_y: 0,
            current_action: NpcAction::Idle,
            action_progress: 0,
            steering_vx: 0,
            steering_vy: 0,
            interaction_target: None,
            interaction_cooldown_ms: 0,
        }
    }
}

/// Dehydrated NPC state for LOD2/LOD3.
/// Contains only high-level intent and summary data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DehydratedState {
    /// Coarse location (chunk coordinates)
    pub last_chunk_x: i32,
    pub last_chunk_y: i32,
    /// Current schedule phase
    pub schedule_phase: SchedulePhase,
    /// Time until next schedule change (ms)
    pub schedule_remaining_ms: u64,
    /// Intent summary
    pub intent_summary: String,
}

impl Default for DehydratedState {
    fn default() -> Self {
        Self {
            last_chunk_x: 0,
            last_chunk_y: 0,
            schedule_phase: SchedulePhase::Idle,
            schedule_remaining_ms: 60000,
            intent_summary: String::new(),
        }
    }
}

/// NPC actions for hydrated state
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NpcAction {
    Idle,
    Walking,
    Running,
    Working,
    Talking,
    Trading,
    Resting,
    Eating,
    Fighting,
    Fleeing,
}

/// Schedule phases for dehydrated state
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SchedulePhase {
    Idle,
    Morning,
    Working,
    Lunch,
    Afternoon,
    Evening,
    Night,
    Traveling,
}

// =============================================================================
// LOD Transitions
// =============================================================================

/// Hydrate an NPC when transitioning from LOD2/LOD3 to LOD0/LOD1.
#[reducer]
pub fn hydrate_npc(ctx: &ReducerContext, npc_id: u64, triggering_player_id: u64) {
    let Some(npc_state) = ctx.db.npc_state().npc_id().find(npc_id) else {
        log::warn!("Cannot hydrate NPC {}: state not found", npc_id);
        return;
    };

    let current_lod = LodTier::from_u8(npc_state.lod_state);

    // Only hydrate if currently dehydrated
    if current_lod.is_hydrated() {
        log::debug!("NPC {} already hydrated at {:?}", npc_id, current_lod);
        return;
    }

    let tick = current_tick(ctx);
    let ts_ms = now_ms(ctx);

    // Parse dehydrated state if available
    let dehydrated: DehydratedState = if npc_state.short_intent.is_empty() {
        DehydratedState::default()
    } else {
        serde_json::from_slice(&npc_state.short_intent).unwrap_or_default()
    };

    // Create hydrated state from dehydrated
    let hydrated = HydratedState {
        waypoints: Vec::new(),
        target_x: dehydrated.last_chunk_x * 64 * POSITION_SCALE,
        target_y: dehydrated.last_chunk_y * 64 * POSITION_SCALE,
        current_action: match dehydrated.schedule_phase {
            SchedulePhase::Working => NpcAction::Working,
            SchedulePhase::Traveling => NpcAction::Walking,
            SchedulePhase::Night => NpcAction::Resting,
            SchedulePhase::Lunch | SchedulePhase::Evening => NpcAction::Eating,
            _ => NpcAction::Idle,
        },
        action_progress: 0,
        steering_vx: 0,
        steering_vy: 0,
        interaction_target: None,
        interaction_cooldown_ms: 0,
    };

    // Update NPC state with hydrated data
    ctx.db.npc_state().npc_id().update(NpcState {
        npc_id,
        lod_state: LodTier::Lod1.as_u8(), // Start at LOD1, will refine next tick
        short_intent: serde_json::to_vec(&hydrated).unwrap_or_default(),
        ..npc_state
    });

    // Get entity for event
    let entity = ctx.db.entity().entity_id().find(npc_id);

    // Emit hydration event
    let payload = LodChangedPayload {
        old_lod: current_lod.as_u8(),
        new_lod: LodTier::Lod1.as_u8(),
        triggering_player_id,
    };

    let _ = ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick,
        zone_id: entity.as_ref().map_or(0, |e| e.zone_id),
        chunk_x: entity.as_ref().map_or(0, |e| e.chunk_x),
        chunk_y: entity.as_ref().map_or(0, |e| e.chunk_y),
        actor_id: Some(triggering_player_id),
        target_id: Some(npc_id),
        event_type: EventType::NpcHydrated.as_u16(),
        payload: serialize_payload(&payload),
    });

    log::info!("Hydrated NPC {} from {:?} to LOD1", npc_id, current_lod);
}

/// Dehydrate an NPC when transitioning from LOD0/LOD1 to LOD2/LOD3.
#[reducer]
pub fn dehydrate_npc(ctx: &ReducerContext, npc_id: u64, triggering_player_id: u64) {
    let Some(npc_state) = ctx.db.npc_state().npc_id().find(npc_id) else {
        log::warn!("Cannot dehydrate NPC {}: state not found", npc_id);
        return;
    };

    let current_lod = LodTier::from_u8(npc_state.lod_state);

    // Only dehydrate if currently hydrated
    if !current_lod.is_hydrated() {
        log::debug!("NPC {} already dehydrated at {:?}", npc_id, current_lod);
        return;
    }

    let tick = current_tick(ctx);
    let ts_ms = now_ms(ctx);

    // Get entity for chunk info
    let entity = ctx.db.entity().entity_id().find(npc_id);

    // Parse hydrated state if available
    let hydrated: HydratedState = if npc_state.short_intent.is_empty() {
        HydratedState::default()
    } else {
        serde_json::from_slice(&npc_state.short_intent).unwrap_or_default()
    };

    // Create dehydrated state from hydrated
    let dehydrated = DehydratedState {
        last_chunk_x: entity.as_ref().map_or(0, |e| e.chunk_x),
        last_chunk_y: entity.as_ref().map_or(0, |e| e.chunk_y),
        schedule_phase: match hydrated.current_action {
            NpcAction::Working => SchedulePhase::Working,
            NpcAction::Walking | NpcAction::Running => SchedulePhase::Traveling,
            NpcAction::Resting => SchedulePhase::Night,
            NpcAction::Eating => SchedulePhase::Lunch,
            _ => SchedulePhase::Idle,
        },
        schedule_remaining_ms: 60000, // Reset to 1 minute
        intent_summary: format!("{:?}", hydrated.current_action),
    };

    // Update NPC state with dehydrated data
    ctx.db.npc_state().npc_id().update(NpcState {
        npc_id,
        lod_state: LodTier::Lod2.as_u8(),
        short_intent: serde_json::to_vec(&dehydrated).unwrap_or_default(),
        ..npc_state
    });

    // Emit dehydration event
    let payload = LodChangedPayload {
        old_lod: current_lod.as_u8(),
        new_lod: LodTier::Lod2.as_u8(),
        triggering_player_id,
    };

    let _ = ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick,
        zone_id: entity.as_ref().map_or(0, |e| e.zone_id),
        chunk_x: entity.as_ref().map_or(0, |e| e.chunk_x),
        chunk_y: entity.as_ref().map_or(0, |e| e.chunk_y),
        actor_id: Some(triggering_player_id),
        target_id: Some(npc_id),
        event_type: EventType::NpcDehydrated.as_u16(),
        payload: serialize_payload(&payload),
    });

    log::info!("Dehydrated NPC {} from {:?} to LOD2", npc_id, current_lod);
}

/// Update NPC LOD based on new distance calculation.
pub fn update_npc_lod(
    ctx: &ReducerContext,
    npc_id: u64,
    new_lod: LodTier,
    triggering_player_id: u64,
) {
    let Some(npc_state) = ctx.db.npc_state().npc_id().find(npc_id) else {
        return;
    };

    let current_lod = LodTier::from_u8(npc_state.lod_state);

    if current_lod == new_lod {
        return;
    }

    let tick = current_tick(ctx);
    let ts_ms = now_ms(ctx);

    // Handle hydration/dehydration transitions
    let was_hydrated = current_lod.is_hydrated();
    let will_be_hydrated = new_lod.is_hydrated();

    if !was_hydrated && will_be_hydrated {
        hydrate_npc(ctx, npc_id, triggering_player_id);
    } else if was_hydrated && !will_be_hydrated {
        dehydrate_npc(ctx, npc_id, triggering_player_id);
    } else {
        // Simple LOD change within same hydration state
        ctx.db.npc_state().npc_id().update(NpcState {
            npc_id,
            lod_state: new_lod.as_u8(),
            ..npc_state
        });

        // Get entity for event
        let entity = ctx.db.entity().entity_id().find(npc_id);

        // Emit LOD change event
        let payload = LodChangedPayload {
            old_lod: current_lod.as_u8(),
            new_lod: new_lod.as_u8(),
            triggering_player_id,
        };

        let _ = ctx.db.event_log().try_insert(EventLog {
            event_id: 0,
            ts_ms,
            tick,
            zone_id: entity.as_ref().map_or(0, |e| e.zone_id),
            chunk_x: entity.as_ref().map_or(0, |e| e.chunk_x),
            chunk_y: entity.as_ref().map_or(0, |e| e.chunk_y),
            actor_id: Some(triggering_player_id),
            target_id: Some(npc_id),
            event_type: EventType::LodChanged.as_u16(),
            payload: serialize_payload(&payload),
        });

        log::debug!(
            "NPC {} LOD changed from {:?} to {:?}",
            npc_id,
            current_lod,
            new_lod
        );
    }
}

// =============================================================================
// LOD-Based Update Logic
// =============================================================================

/// Check if an NPC should be updated this tick based on its LOD.
#[must_use]
pub fn should_update_npc(lod: LodTier, current_tick: u64) -> bool {
    let interval = lod.update_interval();
    current_tick % interval == 0
}

/// Get the list of NPCs that should be updated this tick.
pub fn get_npcs_to_update(ctx: &ReducerContext, current_tick: u64) -> Vec<(u64, LodTier)> {
    ctx.db
        .npc_state()
        .iter()
        .filter_map(|state| {
            let lod = LodTier::from_u8(state.lod_state);
            if should_update_npc(lod, current_tick) {
                Some((state.npc_id, lod))
            } else {
                None
            }
        })
        .collect()
}
