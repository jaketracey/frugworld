//! Frug State System
//!
//! Manages player character (Frug) stats persistence and decay.
//! - Server-authoritative stat storage
//! - Periodic decay of physical/emotional stats
//! - Event-based stat modifications
//! - Client sync via reducers

use crate::{
    current_tick, now_ms, FrugState, FrugActivity,
    EventLog,
    TICK_RATE_HZ,
    // Table accessor traits
    frug_state, player, entity, event_log,
};
use spacetimedb::{reducer, ReducerContext, Table};

// =============================================================================
// Configuration
// =============================================================================

/// Frug stat decay interval in ticks (every 2 seconds at 20Hz)
pub const FRUG_DECAY_INTERVAL_TICKS: u64 = TICK_RATE_HZ * 2;

/// Decay rates per decay tick (scaled to 2-second intervals)
mod decay_rates {
    // Physical stats decay (per 2 seconds)
    pub const HUNGER: u8 = 1;        // ~50 per 100 seconds
    pub const THIRST: u8 = 1;        // ~50 per 100 seconds
    pub const ENERGY: u8 = 1;        // Slower when idle
    pub const CLEANLINESS: u8 = 1;   // Very slow

    // Emotional stats
    pub const HAPPINESS_BASE: u8 = 1;   // Decays slowly unless boosted
    pub const STRESS_RECOVERY: u8 = 1;  // Stress naturally decreases
    pub const EXCITEMENT_DECAY: u8 = 2; // Excitement fades faster
    pub const LONELINESS_GAIN: u8 = 1;  // Increases when alone
}

/// Impact amounts for various events
mod impact_amounts {
    // Food impacts
    pub const FOOD_SMALL: u8 = 15;
    pub const FOOD_MEDIUM: u8 = 30;
    pub const FOOD_LARGE: u8 = 50;

    // Water impacts
    pub const WATER_SIP: u8 = 10;
    pub const WATER_DRINK: u8 = 25;
    pub const WATER_FULL: u8 = 50;

    // Rest impacts
    pub const REST_SHORT: u8 = 20;
    pub const REST_MEDIUM: u8 = 40;
    pub const REST_FULL: u8 = 80;

    // Social impacts
    pub const SOCIAL_BRIEF: u8 = 10;
    pub const SOCIAL_CONVERSATION: u8 = 25;
    pub const SOCIAL_DEEP: u8 = 40;

    // Discovery impacts
    pub const DISCOVERY_MINOR: u8 = 5;
    pub const DISCOVERY_INTERESTING: u8 = 15;
    pub const DISCOVERY_MAJOR: u8 = 30;
}

// =============================================================================
// Frug State Initialization
// =============================================================================

/// Initialize Frug state for a new player.
/// Called when player entity is created.
pub fn initialize_frug_state(ctx: &ReducerContext, player_id: u64) {
    let ts_ms = now_ms(ctx);
    let tick = current_tick(ctx);

    let state = FrugState {
        player_id,
        last_decay_tick: tick,
        last_updated_ts_ms: ts_ms,
        created_ts_ms: ts_ms,
        ..Default::default()
    };

    let _ = ctx.db.frug_state().try_insert(state);
    log::info!("Initialized Frug state for player {}", player_id);
}

// =============================================================================
// Stat Decay System
// =============================================================================

/// Process stat decay for all connected players.
/// Called from tick pipeline at FRUG_DECAY_INTERVAL_TICKS.
pub fn process_frug_decay(ctx: &ReducerContext, tick: u64, ts_ms: u64) {
    // Get all frug states that need decay
    for state in ctx.db.frug_state().iter() {
        // Check if enough time has passed since last decay
        if tick.saturating_sub(state.last_decay_tick) >= FRUG_DECAY_INTERVAL_TICKS {
            decay_frug_stats(ctx, state, tick, ts_ms);
        }
    }
}

/// Decay a single Frug's stats.
fn decay_frug_stats(ctx: &ReducerContext, state: FrugState, tick: u64, ts_ms: u64) {
    let mut new_state = state.clone();

    // Calculate ticks since last decay for proportional decay
    let ticks_elapsed = tick.saturating_sub(state.last_decay_tick);
    let decay_multiplier = (ticks_elapsed / FRUG_DECAY_INTERVAL_TICKS) as u8;
    let decay_mult = decay_multiplier.max(1);

    // === Physical Stat Decay ===

    // Hunger decays over time
    new_state.hunger = new_state.hunger.saturating_sub(decay_rates::HUNGER * decay_mult);

    // Thirst decays faster
    new_state.thirst = new_state.thirst.saturating_sub(decay_rates::THIRST * decay_mult);

    // Energy decay depends on activity
    let energy_decay = match new_state.activity {
        a if a == FrugActivity::Running.as_u8() => decay_rates::ENERGY * 3,
        a if a == FrugActivity::Walking.as_u8() => decay_rates::ENERGY * 2,
        a if a == FrugActivity::Exploring.as_u8() => decay_rates::ENERGY * 2,
        a if a == FrugActivity::Playing.as_u8() => decay_rates::ENERGY * 2,
        a if a == FrugActivity::Resting.as_u8() => 0, // No decay while resting
        _ => decay_rates::ENERGY,
    };
    new_state.energy = new_state.energy.saturating_sub(energy_decay * decay_mult);

    // Cleanliness decays very slowly
    new_state.cleanliness = new_state.cleanliness.saturating_sub(decay_rates::CLEANLINESS * decay_mult);

    // Fatigue recovers when energy is high, otherwise stays same
    if new_state.energy > 50 {
        new_state.fatigue = new_state.fatigue.saturating_add(1).min(100);
    }

    // === Emotional Stat Decay ===

    // Happiness decays based on physical state
    let happiness_penalty = calculate_happiness_penalty(&new_state);
    new_state.happiness = new_state.happiness.saturating_sub(happiness_penalty);

    // Stress naturally recovers over time
    new_state.stress = new_state.stress.saturating_sub(decay_rates::STRESS_RECOVERY * decay_mult);

    // Excitement fades quickly
    new_state.excitement = new_state.excitement.saturating_sub(decay_rates::EXCITEMENT_DECAY * decay_mult);

    // Comfort decreases with low physical stats
    if new_state.hunger < 30 || new_state.thirst < 30 || new_state.energy < 30 {
        new_state.comfort = new_state.comfort.saturating_sub(2 * decay_mult);
    }

    // === Social Stat Decay ===

    // Loneliness increases over time since last social interaction
    let time_since_social = ts_ms.saturating_sub(new_state.last_social_ts_ms);
    if time_since_social > 60_000 { // More than 1 minute
        new_state.loneliness = new_state.loneliness.saturating_add(decay_rates::LONELINESS_GAIN * decay_mult).min(100);
    }

    // === Age Tracking ===
    new_state.age_ticks = new_state.age_ticks.saturating_add(ticks_elapsed);

    // === Update timestamps ===
    new_state.last_decay_tick = tick;
    new_state.last_updated_ts_ms = ts_ms;

    // Save updated state
    ctx.db.frug_state().player_id().update(new_state);
}

/// Calculate happiness penalty based on physical state.
fn calculate_happiness_penalty(state: &FrugState) -> u8 {
    let mut penalty = decay_rates::HAPPINESS_BASE;

    // Low hunger makes you unhappy
    if state.hunger < 30 {
        penalty += 2;
    }

    // Low thirst makes you unhappy
    if state.thirst < 30 {
        penalty += 2;
    }

    // Exhaustion makes you unhappy
    if state.energy < 20 {
        penalty += 2;
    }

    // High loneliness makes you unhappy
    if state.loneliness > 70 {
        penalty += 1;
    }

    // High stress makes you unhappy
    if state.stress > 60 {
        penalty += 1;
    }

    penalty
}

// =============================================================================
// Client-Facing Reducers
// =============================================================================

/// Save full Frug state from client.
/// Called periodically by client to sync state.
#[reducer]
pub fn save_frug_state(
    ctx: &ReducerContext,
    // Physical
    health: u8,
    energy: u8,
    hunger: u8,
    thirst: u8,
    fatigue: u8,
    cleanliness: u8,
    // Emotional
    happiness: u8,
    stress: u8,
    comfort: u8,
    excitement: u8,
    curiosity: u8,
    confidence: u8,
    // Social
    loneliness: u8,
    friendship_level: u8,
    reputation: u8,
    charisma: u8,
    // Activity
    activity: u8,
    current_biome: u16,
    // Tracking
    total_distance_mm: u64,
    total_npc_interactions: u32,
    total_items_collected: u32,
) {
    // Get player from identity
    let Some(player) = ctx.db.player().identity().find(ctx.sender) else {
        log::warn!("save_frug_state: Unknown identity");
        return;
    };

    let ts_ms = now_ms(ctx);
    let tick = current_tick(ctx);

    // Check if state exists
    if let Some(existing) = ctx.db.frug_state().player_id().find(player.entity_id) {
        // Update existing state
        ctx.db.frug_state().player_id().update(FrugState {
            player_id: player.entity_id,
            health: health.min(100),
            max_health: existing.max_health,
            energy: energy.min(100),
            max_energy: existing.max_energy,
            hunger: hunger.min(100),
            thirst: thirst.min(100),
            fatigue: fatigue.min(100),
            cleanliness: cleanliness.min(100),
            happiness: happiness.min(100),
            stress: stress.min(100),
            comfort: comfort.min(100),
            excitement: excitement.min(100),
            curiosity: curiosity.min(100),
            confidence: confidence.min(100),
            loneliness: loneliness.min(100),
            friendship_level: friendship_level.min(100),
            reputation: reputation.min(100),
            charisma: charisma.min(100),
            last_social_ts_ms: existing.last_social_ts_ms,
            activity,
            current_biome,
            age_ticks: existing.age_ticks,
            total_distance_mm,
            total_npc_interactions,
            total_items_collected,
            last_decay_tick: tick,
            last_updated_ts_ms: ts_ms,
            created_ts_ms: existing.created_ts_ms,
        });
    } else {
        // Create new state
        let _ = ctx.db.frug_state().try_insert(FrugState {
            player_id: player.entity_id,
            health: health.min(100),
            max_health: 100,
            energy: energy.min(100),
            max_energy: 100,
            hunger: hunger.min(100),
            thirst: thirst.min(100),
            fatigue: fatigue.min(100),
            cleanliness: cleanliness.min(100),
            happiness: happiness.min(100),
            stress: stress.min(100),
            comfort: comfort.min(100),
            excitement: excitement.min(100),
            curiosity: curiosity.min(100),
            confidence: confidence.min(100),
            loneliness: loneliness.min(100),
            friendship_level: friendship_level.min(100),
            reputation: reputation.min(100),
            charisma: charisma.min(100),
            last_social_ts_ms: ts_ms,
            activity,
            current_biome,
            age_ticks: 0,
            total_distance_mm,
            total_npc_interactions,
            total_items_collected,
            last_decay_tick: tick,
            last_updated_ts_ms: ts_ms,
            created_ts_ms: ts_ms,
        });
    }
}

/// Apply a stat impact event (eating, drinking, resting, etc.)
#[reducer]
pub fn apply_frug_impact(
    ctx: &ReducerContext,
    impact_type: u16,
    amount: u8,
    target_stat: u8,
) {
    // Get player from identity
    let Some(player) = ctx.db.player().identity().find(ctx.sender) else {
        log::warn!("apply_frug_impact: Unknown identity");
        return;
    };

    let Some(mut state) = ctx.db.frug_state().player_id().find(player.entity_id) else {
        log::warn!("apply_frug_impact: No Frug state for player {}", player.entity_id);
        return;
    };

    let ts_ms = now_ms(ctx);
    let tick = current_tick(ctx);

    // Apply impact based on type
    match impact_type {
        // AteFood = 200
        200 => {
            state.hunger = state.hunger.saturating_add(amount).min(100);
            state.happiness = state.happiness.saturating_add(amount / 4).min(100);
            state.comfort = state.comfort.saturating_add(amount / 6).min(100);
        }
        // DrankWater = 201
        201 => {
            state.thirst = state.thirst.saturating_add(amount).min(100);
        }
        // Rested = 202
        202 => {
            state.fatigue = state.fatigue.saturating_add(amount).min(100);
            state.energy = state.energy.saturating_add(amount / 2).min(100);
            state.stress = state.stress.saturating_sub(amount / 3);
        }
        // TookDamage = 203
        203 => {
            state.health = state.health.saturating_sub(amount);
            state.stress = state.stress.saturating_add(amount / 2).min(100);
            state.happiness = state.happiness.saturating_sub(amount / 3);
        }
        // Healed = 204
        204 => {
            state.health = state.health.saturating_add(amount).min(state.max_health);
            state.comfort = state.comfort.saturating_add(amount / 4).min(100);
        }
        // SocialInteraction = 205
        205 => {
            state.loneliness = state.loneliness.saturating_sub(amount);
            state.happiness = state.happiness.saturating_add(amount / 3).min(100);
            state.friendship_level = state.friendship_level.saturating_add(1).min(100);
            state.last_social_ts_ms = ts_ms;
            state.total_npc_interactions = state.total_npc_interactions.saturating_add(1);
        }
        // Discovery = 206
        206 => {
            state.curiosity = state.curiosity.saturating_add(amount / 2).min(100);
            state.excitement = state.excitement.saturating_add(amount).min(100);
            state.happiness = state.happiness.saturating_add(amount / 4).min(100);
        }
        // WeatherImpact = 207
        207 => {
            // Amount is signed comfort delta encoded as u8 (128 = 0)
            if amount >= 128 {
                state.comfort = state.comfort.saturating_add(amount - 128).min(100);
            } else {
                state.comfort = state.comfort.saturating_sub(128 - amount);
            }
        }
        // Restored = 209 (generic restore)
        209 => {
            match target_stat {
                0 => state.health = state.health.saturating_add(amount).min(state.max_health),
                1 => state.energy = state.energy.saturating_add(amount).min(state.max_energy),
                2 => state.hunger = state.hunger.saturating_add(amount).min(100),
                3 => state.thirst = state.thirst.saturating_add(amount).min(100),
                4 => state.fatigue = state.fatigue.saturating_add(amount).min(100),
                5 => state.cleanliness = state.cleanliness.saturating_add(amount).min(100),
                6 => state.happiness = state.happiness.saturating_add(amount).min(100),
                _ => {}
            }
        }
        _ => {
            log::warn!("Unknown impact type: {}", impact_type);
            return;
        }
    }

    state.last_updated_ts_ms = ts_ms;
    state.last_decay_tick = tick;

    // Save updated state
    ctx.db.frug_state().player_id().update(state);

    // Log the event
    log_frug_event(ctx, player.entity_id, impact_type, amount, target_stat, tick, ts_ms);
}

/// Update Frug activity state.
#[reducer]
pub fn set_frug_activity(ctx: &ReducerContext, activity: u8) {
    let Some(player) = ctx.db.player().identity().find(ctx.sender) else {
        return;
    };

    let Some(mut state) = ctx.db.frug_state().player_id().find(player.entity_id) else {
        return;
    };

    state.activity = activity;
    state.last_updated_ts_ms = now_ms(ctx);

    ctx.db.frug_state().player_id().update(state);
}

/// Record distance traveled (for tracking).
#[reducer]
pub fn record_frug_distance(ctx: &ReducerContext, distance_mm: u32) {
    let Some(player) = ctx.db.player().identity().find(ctx.sender) else {
        return;
    };

    let Some(mut state) = ctx.db.frug_state().player_id().find(player.entity_id) else {
        return;
    };

    state.total_distance_mm = state.total_distance_mm.saturating_add(distance_mm as u64);
    state.last_updated_ts_ms = now_ms(ctx);

    ctx.db.frug_state().player_id().update(state);
}

/// Record item collection.
#[reducer]
pub fn record_item_collected(ctx: &ReducerContext) {
    let Some(player) = ctx.db.player().identity().find(ctx.sender) else {
        return;
    };

    let Some(mut state) = ctx.db.frug_state().player_id().find(player.entity_id) else {
        return;
    };

    state.total_items_collected = state.total_items_collected.saturating_add(1);
    state.last_updated_ts_ms = now_ms(ctx);

    // Discovery excitement
    state.curiosity = state.curiosity.saturating_add(2).min(100);
    state.excitement = state.excitement.saturating_add(5).min(100);

    ctx.db.frug_state().player_id().update(state);
}

// =============================================================================
// Event Logging
// =============================================================================

/// Log a Frug stat event to the event log.
fn log_frug_event(
    ctx: &ReducerContext,
    player_id: u64,
    event_type: u16,
    amount: u8,
    target: u8,
    tick: u64,
    ts_ms: u64,
) {
    // Get player entity for chunk info
    let (chunk_x, chunk_y, zone_id) = ctx.db.entity()
        .entity_id()
        .find(player_id)
        .map(|e| (e.chunk_x, e.chunk_y, e.zone_id))
        .unwrap_or((0, 0, 0));

    // Create payload
    let payload = vec![amount, target];

    let _ = ctx.db.event_log().try_insert(EventLog {
        event_id: 0, // Auto-increment
        ts_ms,
        tick,
        zone_id,
        chunk_x,
        chunk_y,
        actor_id: Some(player_id),
        target_id: None,
        event_type,
        payload,
    });
}

// =============================================================================
// Query Reducers
// =============================================================================

/// Get Frug state for calling player.
/// Returns via subscription to frug_state table.
#[reducer]
pub fn get_my_frug_state(ctx: &ReducerContext) {
    let Some(player) = ctx.db.player().identity().find(ctx.sender) else {
        log::warn!("get_my_frug_state: Unknown identity");
        return;
    };

    // State is automatically replicated via table subscription
    // This reducer just ensures the player knows to look for their state
    if ctx.db.frug_state().player_id().find(player.entity_id).is_none() {
        // Create default state if none exists
        initialize_frug_state(ctx, player.entity_id);
    }
}
