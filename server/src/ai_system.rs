//! AI System - Utility-Based NPC Decision Making
//!
//! Implements Section 14 of the plan: Non-LLM runtime AI for NPCs.
//!
//! Features:
//! - Utility scoring system for action selection
//! - Needs model with decay over time
//! - Intent/action mapping
//! - Goal system (long-term, mid-term, short-term)
//!
//! This system runs deterministically without any LLM calls.

use crate::{
    current_tick, Entity, EntityKind, NpcState,
    lod::{HydratedState, LodTier, NpcAction},
    // Table accessor traits
    entity, npc_state,
};
use serde::{Deserialize, Serialize};
use spacetimedb::{reducer, ReducerContext, Table};

// =============================================================================
// Needs Model (Section 14.2)
// =============================================================================

/// NPC needs state for utility calculations.
/// All values are 0-100 where higher means more urgent need.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Needs {
    /// Hunger level (0=full, 100=starving)
    pub hunger: u8,
    /// Fatigue level (0=rested, 100=exhausted)
    pub fatigue: u8,
    /// Safety level (0=dangerous, 100=safe) - INVERTED: lower = more urgent
    pub safety: u8,
    /// Social need (0=lonely, 100=satisfied)
    pub social: u8,
    /// Wealth/comfort (0=poor, 100=wealthy)
    pub wealth: u8,
}

impl Needs {
    /// Create default needs for a new NPC.
    pub fn new() -> Self {
        Self {
            hunger: 20,
            fatigue: 10,
            safety: 80,
            social: 50,
            wealth: 50,
        }
    }

    /// Decay needs over time (called each relevant tick).
    pub fn decay(&mut self, delta_ticks: u64, lod: LodTier) {
        // Decay rate varies by LOD (faster for distant NPCs to simulate time passing)
        let multiplier = match lod {
            LodTier::Lod0 => 1,
            LodTier::Lod1 => 1,
            LodTier::Lod2 => 2,
            LodTier::Lod3 => 5,
        };

        let decay = (delta_ticks * multiplier) as u8;

        // Hunger and fatigue increase over time
        self.hunger = self.hunger.saturating_add(decay / 10).min(100);
        self.fatigue = self.fatigue.saturating_add(decay / 20).min(100);

        // Social need decreases if alone
        self.social = self.social.saturating_sub(decay / 30);

        // Safety slowly trends toward baseline (50)
        if self.safety > 50 {
            self.safety = self.safety.saturating_sub(decay / 40);
        } else if self.safety < 50 {
            self.safety = self.safety.saturating_add(decay / 40).min(50);
        }
    }

    /// Apply an effect to needs (eating, resting, etc.)
    pub fn apply_effect(&mut self, effect: NeedsEffect) {
        match effect {
            NeedsEffect::Eat => {
                self.hunger = self.hunger.saturating_sub(40);
            }
            NeedsEffect::Rest => {
                self.fatigue = self.fatigue.saturating_sub(30);
            }
            NeedsEffect::Sleep => {
                self.fatigue = 0;
                self.hunger = self.hunger.saturating_add(10).min(100);
            }
            NeedsEffect::Socialize => {
                self.social = self.social.saturating_add(20).min(100);
            }
            NeedsEffect::ThreatDetected => {
                self.safety = self.safety.saturating_sub(40);
            }
            NeedsEffect::ThreatCleared => {
                self.safety = self.safety.saturating_add(20).min(100);
            }
            NeedsEffect::EarnMoney => {
                self.wealth = self.wealth.saturating_add(10).min(100);
            }
            NeedsEffect::SpendMoney => {
                self.wealth = self.wealth.saturating_sub(10);
            }
        }
    }

    /// Get the most urgent need.
    pub fn most_urgent(&self) -> UrgentNeed {
        // Invert safety for comparison (lower safety = more urgent)
        let safety_urgency = 100 - self.safety;
        let social_urgency = 100 - self.social;

        let mut max_urgency = self.hunger;
        let mut result = UrgentNeed::Hunger;

        if self.fatigue > max_urgency {
            max_urgency = self.fatigue;
            result = UrgentNeed::Fatigue;
        }

        if safety_urgency > max_urgency {
            max_urgency = safety_urgency;
            result = UrgentNeed::Safety;
        }

        if social_urgency > max_urgency {
            max_urgency = social_urgency;
            result = UrgentNeed::Social;
        }

        // Wealth is less urgent than survival needs
        if 100 - self.wealth > max_urgency + 20 {
            result = UrgentNeed::Wealth;
        }

        result
    }
}

#[derive(Debug, Clone, Copy)]
pub enum NeedsEffect {
    Eat,
    Rest,
    Sleep,
    Socialize,
    ThreatDetected,
    ThreatCleared,
    EarnMoney,
    SpendMoney,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UrgentNeed {
    Hunger,
    Fatigue,
    Safety,
    Social,
    Wealth,
}

// =============================================================================
// Intent System (Section 14.1)
// =============================================================================

/// Short-term intents that drive NPC behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Intent {
    /// No specific intent, will idle or wander
    Idle,
    /// Moving to a random nearby location
    Wander,
    /// Performing job/work duties
    Work,
    /// Looking for food
    SeekFood,
    /// Finding a place to rest
    Rest,
    /// Avoiding a threat
    AvoidThreat,
    /// Moving toward player to interact
    ApproachPlayer,
    /// Seeking social interaction with NPCs
    Socialize,
    /// Guarding an area
    Guard,
    /// Patrolling a route
    Patrol,
    /// Returning home
    GoHome,
    /// Trading/shopping
    Trade,
}

impl Intent {
    /// Convert intent to NpcAction for execution.
    pub fn to_action(&self) -> NpcAction {
        match self {
            Intent::Idle => NpcAction::Idle,
            Intent::Wander => NpcAction::Walking,
            Intent::Work => NpcAction::Working,
            Intent::SeekFood => NpcAction::Walking,
            Intent::Rest => NpcAction::Resting,
            Intent::AvoidThreat => NpcAction::Fleeing,
            Intent::ApproachPlayer => NpcAction::Walking,
            Intent::Socialize => NpcAction::Talking,
            Intent::Guard => NpcAction::Idle,
            Intent::Patrol => NpcAction::Walking,
            Intent::GoHome => NpcAction::Walking,
            Intent::Trade => NpcAction::Trading,
        }
    }

    /// Get base duration for this intent in ticks.
    pub fn base_duration(&self) -> u64 {
        match self {
            Intent::Idle => 40,      // 2 seconds
            Intent::Wander => 100,   // 5 seconds
            Intent::Work => 600,     // 30 seconds
            Intent::SeekFood => 200, // 10 seconds
            Intent::Rest => 400,     // 20 seconds
            Intent::AvoidThreat => 60, // 3 seconds
            Intent::ApproachPlayer => 60,
            Intent::Socialize => 200,
            Intent::Guard => 400,
            Intent::Patrol => 300,
            Intent::GoHome => 200,
            Intent::Trade => 200,
        }
    }
}

// =============================================================================
// Utility Scoring System
// =============================================================================

/// Context for utility calculations.
#[derive(Debug, Clone)]
pub struct UtilityContext {
    pub needs: Needs,
    pub current_intent: Intent,
    pub ticks_in_intent: u64,
    pub time_of_day: TimeOfDay,
    pub nearby_players: u32,
    pub nearby_threats: u32,
    pub near_poi: Option<PoiProximity>,
    pub archetype_id: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeOfDay {
    Morning,   // 6-12
    Afternoon, // 12-18
    Evening,   // 18-22
    Night,     // 22-6
}

impl TimeOfDay {
    /// Derive time of day from tick number (24 hour cycle over 28800 ticks at 20Hz).
    pub fn from_tick(tick: u64) -> Self {
        // 28800 ticks = 24 minutes real time = 24 hours game time
        // 1200 ticks = 1 hour
        let hour = ((tick / 1200) % 24) as u8;

        match hour {
            6..=11 => Self::Morning,
            12..=17 => Self::Afternoon,
            18..=21 => Self::Evening,
            _ => Self::Night,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub enum PoiProximity {
    Home,
    Workplace,
    Shop,
    Tavern,
    GuardPost,
    Road,
}

/// Calculate utility scores for all possible intents.
pub fn calculate_utilities(ctx: &UtilityContext) -> Vec<(Intent, f32)> {
    let mut scores = Vec::new();

    // Base scores from needs
    let hunger_urgency = ctx.needs.hunger as f32 / 100.0;
    let fatigue_urgency = ctx.needs.fatigue as f32 / 100.0;
    let danger_urgency = (100 - ctx.needs.safety) as f32 / 100.0;
    let loneliness = (100 - ctx.needs.social) as f32 / 100.0;

    // Idle - baseline option
    scores.push((Intent::Idle, 0.1));

    // Wander - when no urgent needs
    let wander_score = 0.3 * (1.0 - hunger_urgency) * (1.0 - fatigue_urgency) * (1.0 - danger_urgency);
    scores.push((Intent::Wander, wander_score));

    // Work - during appropriate hours, when not too tired or hungry
    let work_bonus = match ctx.time_of_day {
        TimeOfDay::Morning | TimeOfDay::Afternoon => 0.3,
        _ => 0.0,
    };
    let archetype_work_bonus = match ctx.archetype_id {
        1..=5 => 0.2, // Town NPCs
        _ => 0.0,
    };
    let work_score = (0.4 + work_bonus + archetype_work_bonus)
        * (1.0 - fatigue_urgency * 0.5)
        * (1.0 - hunger_urgency * 0.5);
    scores.push((Intent::Work, work_score));

    // SeekFood - when hungry
    let food_score = hunger_urgency * 0.8 + if hunger_urgency > 0.7 { 0.3 } else { 0.0 };
    scores.push((Intent::SeekFood, food_score));

    // Rest - when tired but not hungry or in danger
    let rest_score = fatigue_urgency * 0.7 * (1.0 - danger_urgency);
    scores.push((Intent::Rest, rest_score));

    // AvoidThreat - highest priority when in danger
    let threat_score = if ctx.nearby_threats > 0 {
        danger_urgency * 1.5 + 0.5
    } else {
        danger_urgency * 0.5
    };
    scores.push((Intent::AvoidThreat, threat_score));

    // ApproachPlayer - when social and player nearby
    if ctx.nearby_players > 0 {
        let approach_score = loneliness * 0.4 + 0.2;
        scores.push((Intent::ApproachPlayer, approach_score));
    }

    // Socialize - when lonely
    let socialize_score = loneliness * 0.5;
    scores.push((Intent::Socialize, socialize_score));

    // Guard - for guard archetype
    if ctx.archetype_id == 2 {
        let guard_bonus = match ctx.time_of_day {
            TimeOfDay::Night => 0.4,
            _ => 0.2,
        };
        scores.push((Intent::Guard, 0.5 + guard_bonus));
    }

    // Patrol - for guard archetype
    if ctx.archetype_id == 2 {
        scores.push((Intent::Patrol, 0.4));
    }

    // GoHome - at night, when tired
    if ctx.time_of_day == TimeOfDay::Night || ctx.time_of_day == TimeOfDay::Evening {
        let home_score = 0.3 + fatigue_urgency * 0.4;
        scores.push((Intent::GoHome, home_score));
    }

    // Trade - for merchant archetype during business hours
    if ctx.archetype_id == 1 {
        let trade_bonus = match ctx.time_of_day {
            TimeOfDay::Morning | TimeOfDay::Afternoon => 0.4,
            _ => 0.0,
        };
        scores.push((Intent::Trade, 0.3 + trade_bonus));
    }

    // Apply persistence bonus to current intent (avoid flip-flopping)
    let persistence_threshold = ctx.current_intent.base_duration() / 2;
    if ctx.ticks_in_intent < persistence_threshold {
        for (intent, score) in &mut scores {
            if *intent == ctx.current_intent {
                *score += 0.2;
            }
        }
    }

    scores
}

/// Select the best intent based on utility scores.
pub fn select_intent(utilities: &[(Intent, f32)]) -> Intent {
    utilities
        .iter()
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(intent, _)| *intent)
        .unwrap_or(Intent::Idle)
}

// =============================================================================
// Goal System (Section 6.2)
// =============================================================================

/// Long-term goal (days/weeks scale).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LongTermGoal {
    pub goal_type: LongGoalType,
    pub description: String,
    pub progress: u8, // 0-100
    pub started_tick: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LongGoalType {
    Survive,
    Prosper,
    Protect,
    Explore,
    Revenge,
    FindLove,
    RiseToPower,
    RetireQuietly,
}

/// Mid-term goal (hours/day scale).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MidTermGoal {
    pub goal_type: MidGoalType,
    pub target_id: Option<u64>,
    pub target_location: Option<(i32, i32)>,
    pub deadline_tick: Option<u64>,
    pub progress: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MidGoalType {
    CompleteWorkShift,
    GatherResources,
    DeliverItem,
    MeetPerson,
    TravelToLocation,
    RestAndRecover,
    AttendEvent,
    None,
}

/// Generate a default long-term goal based on archetype.
pub fn generate_long_term_goal(archetype_id: u32, tick: u64) -> LongTermGoal {
    let goal_type = match archetype_id {
        1 => LongGoalType::Prosper,      // Merchant
        2 => LongGoalType::Protect,      // Guard
        3 => LongGoalType::Survive,      // Villager
        4 => LongGoalType::Prosper,      // Craftsman
        5 => LongGoalType::Explore,      // Wanderer
        6 => LongGoalType::Survive,      // Hunter
        7 => LongGoalType::RetireQuietly, // Farmer
        8 => LongGoalType::Explore,      // Explorer
        9 => LongGoalType::Survive,      // Scavenger
        _ => LongGoalType::Survive,
    };

    let description = match goal_type {
        LongGoalType::Survive => "Stay alive and healthy".to_string(),
        LongGoalType::Prosper => "Accumulate wealth and status".to_string(),
        LongGoalType::Protect => "Keep the area safe".to_string(),
        LongGoalType::Explore => "Discover new places and secrets".to_string(),
        LongGoalType::Revenge => "Seek justice for past wrongs".to_string(),
        LongGoalType::FindLove => "Find a companion".to_string(),
        LongGoalType::RiseToPower => "Gain influence and power".to_string(),
        LongGoalType::RetireQuietly => "Live a peaceful life".to_string(),
    };

    LongTermGoal {
        goal_type,
        description,
        progress: 0,
        started_tick: tick,
    }
}

/// Generate a mid-term goal based on current state.
pub fn generate_mid_term_goal(
    archetype_id: u32,
    time_of_day: TimeOfDay,
    needs: &Needs,
    tick: u64,
) -> MidTermGoal {
    // Priority: survival needs first
    if needs.hunger > 70 {
        return MidTermGoal {
            goal_type: MidGoalType::GatherResources,
            target_id: None,
            target_location: None,
            deadline_tick: Some(tick + 2000),
            progress: 0,
        };
    }

    if needs.fatigue > 80 {
        return MidTermGoal {
            goal_type: MidGoalType::RestAndRecover,
            target_id: None,
            target_location: None,
            deadline_tick: Some(tick + 800),
            progress: 0,
        };
    }

    // Time-based goals
    let goal_type = match (archetype_id, time_of_day) {
        (1, TimeOfDay::Morning | TimeOfDay::Afternoon) => MidGoalType::CompleteWorkShift, // Merchant
        (2, _) => MidGoalType::CompleteWorkShift, // Guard always on duty
        (3..=4, TimeOfDay::Morning | TimeOfDay::Afternoon) => MidGoalType::CompleteWorkShift,
        (6, TimeOfDay::Morning) => MidGoalType::GatherResources, // Hunter
        (7, TimeOfDay::Morning | TimeOfDay::Afternoon) => MidGoalType::CompleteWorkShift, // Farmer
        (_, TimeOfDay::Night) => MidGoalType::RestAndRecover,
        _ => MidGoalType::None,
    };

    let deadline = match goal_type {
        MidGoalType::CompleteWorkShift => Some(tick + 6000), // 5 minutes
        MidGoalType::RestAndRecover => Some(tick + 3000),
        MidGoalType::GatherResources => Some(tick + 4000),
        _ => None,
    };

    MidTermGoal {
        goal_type,
        target_id: None,
        target_location: None,
        deadline_tick: deadline,
        progress: 0,
    }
}

// =============================================================================
// NPC Update Functions
// =============================================================================

/// Update NPC AI state (called from tick loop).
pub fn update_npc_ai(
    ctx: &ReducerContext,
    npc_id: u64,
    lod: LodTier,
    tick: u64,
) {
    let Some(npc_state) = ctx.db.npc_state().npc_id().find(npc_id) else {
        return;
    };

    let Some(entity) = ctx.db.entity().entity_id().find(npc_id) else {
        return;
    };

    // Parse current state
    let mut needs: Needs = serde_json::from_slice(&npc_state.needs).unwrap_or_default();

    // Decay needs based on LOD
    let decay_ticks = match lod {
        LodTier::Lod0 | LodTier::Lod1 => 1,
        LodTier::Lod2 => 20,
        LodTier::Lod3 => 600,
    };
    needs.decay(decay_ticks, lod);

    // Only do full AI update for LOD0/LOD1
    if lod.is_hydrated() {
        // Parse hydrated state
        let mut hydrated: HydratedState = serde_json::from_slice(&npc_state.short_intent)
            .unwrap_or_default();

        // Build utility context
        let utility_ctx = build_utility_context(
            ctx,
            npc_id,
            &entity,
            &needs,
            &hydrated,
            tick,
        );

        // Calculate utilities and select intent
        let utilities = calculate_utilities(&utility_ctx);
        let new_intent = select_intent(&utilities);

        // Update action if intent changed significantly
        let current_intent = action_to_intent(&hydrated.current_action);
        if new_intent != current_intent {
            hydrated.current_action = new_intent.to_action();
            hydrated.action_progress = 0;
        }

        // Update hydrated state
        ctx.db.npc_state().npc_id().update(NpcState {
            needs: serde_json::to_vec(&needs).unwrap_or_default(),
            short_intent: serde_json::to_vec(&hydrated).unwrap_or_default(),
            ..npc_state
        });
    } else {
        // Just update needs for dehydrated NPCs
        ctx.db.npc_state().npc_id().update(NpcState {
            needs: serde_json::to_vec(&needs).unwrap_or_default(),
            ..npc_state
        });
    }
}

/// Build utility context from game state.
fn build_utility_context(
    ctx: &ReducerContext,
    _npc_id: u64,
    entity: &Entity,
    needs: &Needs,
    hydrated: &HydratedState,
    tick: u64,
) -> UtilityContext {
    // Count nearby players
    let nearby_players = ctx.db.entity()
        .chunk_x()
        .filter(entity.chunk_x)
        .filter(|e| {
            e.chunk_y == entity.chunk_y
                && e.kind == EntityKind::Player.as_u16()
                && e.alive
        })
        .count() as u32;

    // Count nearby threats (placeholder - would check for hostile entities)
    let nearby_threats = 0u32;

    // Get current intent
    let current_intent = action_to_intent(&hydrated.current_action);

    // Calculate ticks in current intent (approximate)
    let ticks_in_intent = hydrated.action_progress as u64 * 2;

    UtilityContext {
        needs: needs.clone(),
        current_intent,
        ticks_in_intent,
        time_of_day: TimeOfDay::from_tick(tick),
        nearby_players,
        nearby_threats,
        near_poi: None, // TODO: Detect POI proximity
        archetype_id: entity.archetype_id,
    }
}

/// Convert NpcAction back to Intent for comparison.
fn action_to_intent(action: &NpcAction) -> Intent {
    match action {
        NpcAction::Idle => Intent::Idle,
        NpcAction::Walking => Intent::Wander,
        NpcAction::Running => Intent::AvoidThreat,
        NpcAction::Working => Intent::Work,
        NpcAction::Talking => Intent::Socialize,
        NpcAction::Trading => Intent::Trade,
        NpcAction::Resting => Intent::Rest,
        NpcAction::Eating => Intent::SeekFood,
        NpcAction::Fighting => Intent::AvoidThreat,
        NpcAction::Fleeing => Intent::AvoidThreat,
    }
}

// =============================================================================
// Reducers
// =============================================================================

/// Manually trigger an NPC AI update (for debugging).
#[reducer]
pub fn debug_update_npc_ai(ctx: &ReducerContext, npc_id: u64) {
    let npc_state = ctx.db.npc_state().npc_id().find(npc_id);

    if let Some(state) = npc_state {
        let lod = LodTier::from_u8(state.lod_state);
        let tick = current_tick(ctx);
        update_npc_ai(ctx, npc_id, lod, tick);
        log::info!("Manually updated NPC {} AI", npc_id);
    } else {
        log::warn!("NPC {} not found", npc_id);
    }
}

/// Apply a needs effect to an NPC (for debugging/testing).
#[reducer]
pub fn debug_apply_needs_effect(ctx: &ReducerContext, npc_id: u64, effect: u8) {
    let Some(npc_state) = ctx.db.npc_state().npc_id().find(npc_id) else {
        log::warn!("NPC {} not found", npc_id);
        return;
    };

    let mut needs: Needs = serde_json::from_slice(&npc_state.needs).unwrap_or_default();

    let effect = match effect {
        0 => NeedsEffect::Eat,
        1 => NeedsEffect::Rest,
        2 => NeedsEffect::Sleep,
        3 => NeedsEffect::Socialize,
        4 => NeedsEffect::ThreatDetected,
        5 => NeedsEffect::ThreatCleared,
        6 => NeedsEffect::EarnMoney,
        7 => NeedsEffect::SpendMoney,
        _ => {
            log::warn!("Unknown effect {}", effect);
            return;
        }
    };

    needs.apply_effect(effect);

    ctx.db.npc_state().npc_id().update(NpcState {
        needs: serde_json::to_vec(&needs).unwrap_or_default(),
        ..npc_state
    });

    log::info!("Applied effect {:?} to NPC {}", effect, npc_id);
}

/// Get utility scores for an NPC (for debugging).
#[reducer]
pub fn debug_get_utilities(ctx: &ReducerContext, npc_id: u64) {
    let Some(npc_state) = ctx.db.npc_state().npc_id().find(npc_id) else {
        log::warn!("NPC {} not found", npc_id);
        return;
    };

    let Some(entity) = ctx.db.entity().entity_id().find(npc_id) else {
        log::warn!("Entity {} not found", npc_id);
        return;
    };

    let needs: Needs = serde_json::from_slice(&npc_state.needs).unwrap_or_default();
    let hydrated: HydratedState = serde_json::from_slice(&npc_state.short_intent)
        .unwrap_or_default();

    let tick = current_tick(ctx);
    let utility_ctx = build_utility_context(ctx, npc_id, &entity, &needs, &hydrated, tick);

    let utilities = calculate_utilities(&utility_ctx);

    log::info!("NPC {} utility scores:", npc_id);
    for (intent, score) in utilities {
        log::info!("  {:?}: {:.2}", intent, score);
    }
}
