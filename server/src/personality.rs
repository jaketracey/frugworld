//! NPC Personality Evolution System
//!
//! Manages personality traits, virtues/vices, and their evolution
//! based on life events and experiences.

use crate::{
    event_types::{EventType, serialize_payload},
    life_events::LifeStage,
    memory::LifeEvent,
    EventLog, NpcPersonalityEvolution,
    // Table accessor traits
    npc_personality_evolution, event_log,
};
use serde::{Deserialize, Serialize};
use siphasher::sip::SipHasher24;
use spacetimedb::{ReducerContext, Table};
use std::hash::{Hash, Hasher};

// =============================================================================
// Constants
// =============================================================================

/// Salt for personality generation
const PERSONALITY_SALT: u64 = 0xBE25_0A01_1715_A177;

/// Maximum trait change per event
const MAX_TRAIT_CHANGE: i8 = 10;

/// Minimum trait change for event logging
const MIN_SIGNIFICANT_CHANGE: i8 = 3;

// =============================================================================
// Personality Traits
// =============================================================================

/// Big Five personality traits (0-100 scale)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BigFiveTraits {
    /// Openness to experience
    pub openness: u8,
    /// Conscientiousness
    pub conscientiousness: u8,
    /// Extraversion
    pub extraversion: u8,
    /// Agreeableness
    pub agreeableness: u8,
    /// Neuroticism (emotional stability when inverted)
    pub neuroticism: u8,
}

impl Default for BigFiveTraits {
    fn default() -> Self {
        Self {
            openness: 50,
            conscientiousness: 50,
            extraversion: 50,
            agreeableness: 50,
            neuroticism: 50,
        }
    }
}

/// Game-specific personality traits
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GameTraits {
    /// Bravery vs cowardice (-100 to 100)
    pub courage: i8,
    /// Generosity vs greed
    pub generosity: i8,
    /// Honesty vs deception
    pub honesty: i8,
    /// Loyalty vs self-interest
    pub loyalty: i8,
    /// Ambition level
    pub ambition: i8,
    /// Curiosity about the world
    pub curiosity: i8,
    /// Patience vs impulsiveness
    pub patience: i8,
    /// Humor/levity
    pub humor: i8,
}

/// Combined personality traits
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PersonalityTraits {
    pub big_five: BigFiveTraits,
    pub game_traits: GameTraits,
}

// =============================================================================
// Virtues and Vices
// =============================================================================

/// Virtues that can be developed
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Virtue {
    Compassion,
    Integrity,
    Perseverance,
    Humility,
    Temperance,
    Prudence,
    Justice,
    Fortitude,
}

/// Vices that can develop
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Vice {
    Greed,
    Wrath,
    Pride,
    Envy,
    Sloth,
    Gluttony,
    Cowardice,
    Cruelty,
}

/// A virtue or vice with its development level
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtueVice {
    pub is_virtue: bool,
    pub virtue_type: Option<Virtue>,
    pub vice_type: Option<Vice>,
    /// Development level (0-100)
    pub level: u8,
    /// How many actions reinforced this
    pub reinforcement_count: u32,
}

/// Collection of virtues and vices
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VirtuesVices {
    pub items: Vec<VirtueVice>,
}

// =============================================================================
// Goals
// =============================================================================

/// Personal life goals
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonalGoal {
    pub goal_type: GoalType,
    pub target_value: u32,
    pub current_progress: u32,
    pub priority: u8,
    pub created_tick: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GoalType {
    AccumulateWealth,
    MasterSkill,
    MakeFriends,
    BuildReputation,
    ExploreWorld,
    FindLove,
    ProtectOthers,
    SeekKnowledge,
    LeaveGacy,
    FindPeace,
}

impl GoalType {
    /// Get goals typical for a life stage
    pub fn for_life_stage(stage: LifeStage) -> Vec<Self> {
        match stage {
            LifeStage::Youth => vec![Self::MakeFriends, Self::ExploreWorld, Self::MasterSkill],
            LifeStage::Adult => vec![Self::AccumulateWealth, Self::BuildReputation, Self::MasterSkill],
            LifeStage::Mature => vec![Self::LeaveGacy, Self::ProtectOthers, Self::SeekKnowledge],
            LifeStage::Elder => vec![Self::FindPeace, Self::LeaveGacy, Self::ProtectOthers],
        }
    }
}

/// Collection of personal goals
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PersonalGoals {
    pub goals: Vec<PersonalGoal>,
}

// =============================================================================
// Personality Generation
// =============================================================================

/// Generate personality seed from NPC seed
#[must_use]
pub fn generate_personality_seed(npc_seed: u64) -> u64 {
    let mut hasher = SipHasher24::new();
    npc_seed.hash(&mut hasher);
    PERSONALITY_SALT.hash(&mut hasher);
    hasher.finish()
}

/// Generate initial personality traits from seed
pub fn generate_personality_traits(personality_seed: u64, archetype_id: u32) -> PersonalityTraits {
    // LCG for deterministic randomness
    let mut rng_state = personality_seed;
    let mut next_rand = || -> u8 {
        rng_state = rng_state.wrapping_mul(6364136223846793005).wrapping_add(1);
        ((rng_state >> 32) % 100) as u8
    };

    // Generate base Big Five with some variance
    let mut big_five = BigFiveTraits {
        openness: 30 + next_rand() % 40,
        conscientiousness: 30 + next_rand() % 40,
        extraversion: 30 + next_rand() % 40,
        agreeableness: 30 + next_rand() % 40,
        neuroticism: 20 + next_rand() % 40,
    };

    // Archetype modifiers
    match archetype_id {
        1 => { // Merchant
            big_five.extraversion = big_five.extraversion.saturating_add(15);
            big_five.agreeableness = big_five.agreeableness.saturating_add(10);
        }
        2 => { // Guard
            big_five.conscientiousness = big_five.conscientiousness.saturating_add(15);
            big_five.neuroticism = big_five.neuroticism.saturating_sub(10);
        }
        3 => { // Blacksmith
            big_five.conscientiousness = big_five.conscientiousness.saturating_add(20);
            big_five.extraversion = big_five.extraversion.saturating_sub(10);
        }
        4 => { // Innkeeper
            big_five.extraversion = big_five.extraversion.saturating_add(20);
            big_five.agreeableness = big_five.agreeableness.saturating_add(15);
        }
        5 => { // Scholar
            big_five.openness = big_five.openness.saturating_add(25);
            big_five.extraversion = big_five.extraversion.saturating_sub(15);
        }
        _ => {}
    }

    // Clamp values
    big_five.openness = big_five.openness.min(100);
    big_five.conscientiousness = big_five.conscientiousness.min(100);
    big_five.extraversion = big_five.extraversion.min(100);
    big_five.agreeableness = big_five.agreeableness.min(100);
    big_five.neuroticism = big_five.neuroticism.min(100);

    // Generate game traits
    let game_traits = GameTraits {
        courage: (next_rand() as i8 - 50).clamp(-50, 50),
        generosity: (next_rand() as i8 - 50).clamp(-50, 50),
        honesty: (next_rand() as i8 - 50).clamp(-50, 50),
        loyalty: (next_rand() as i8 - 50).clamp(-50, 50),
        ambition: (next_rand() as i8 - 50).clamp(-50, 50),
        curiosity: (next_rand() as i8 - 50).clamp(-50, 50),
        patience: (next_rand() as i8 - 50).clamp(-50, 50),
        humor: (next_rand() as i8 - 50).clamp(-50, 50),
    };

    PersonalityTraits { big_five, game_traits }
}

/// Calculate personality stability from traits
#[must_use]
pub fn calculate_stability(traits: &PersonalityTraits) -> u8 {
    // Higher conscientiousness and lower neuroticism = more stable
    let base = (traits.big_five.conscientiousness as u16 + (100 - traits.big_five.neuroticism) as u16) / 2;
    base.min(100) as u8
}

// =============================================================================
// Trait Evolution
// =============================================================================

/// Apply trait changes from a life event
pub fn apply_life_event_to_traits(
    traits: &mut PersonalityTraits,
    stability: u8,
    event: &LifeEvent,
) -> Vec<(String, i8)> {
    let mut changes = Vec::new();

    // Scale changes by inverse of stability (more stable = less change)
    let stability_factor = (100 - stability) as f32 / 100.0;

    for (trait_name, base_change) in &event.trait_effects {
        let change = (*base_change as f32 * stability_factor) as i8;
        let clamped_change = change.clamp(-MAX_TRAIT_CHANGE, MAX_TRAIT_CHANGE);

        if clamped_change.abs() < MIN_SIGNIFICANT_CHANGE {
            continue;
        }

        // Apply to appropriate trait
        match trait_name.as_str() {
            "courage" => {
                traits.game_traits.courage = (traits.game_traits.courage + clamped_change).clamp(-100, 100);
            }
            "generosity" => {
                traits.game_traits.generosity = (traits.game_traits.generosity + clamped_change).clamp(-100, 100);
            }
            "honesty" => {
                traits.game_traits.honesty = (traits.game_traits.honesty + clamped_change).clamp(-100, 100);
            }
            "loyalty" => {
                traits.game_traits.loyalty = (traits.game_traits.loyalty + clamped_change).clamp(-100, 100);
            }
            "ambition" => {
                traits.game_traits.ambition = (traits.game_traits.ambition + clamped_change).clamp(-100, 100);
            }
            "curiosity" => {
                traits.game_traits.curiosity = (traits.game_traits.curiosity + clamped_change).clamp(-100, 100);
            }
            "patience" => {
                traits.game_traits.patience = (traits.game_traits.patience + clamped_change).clamp(-100, 100);
            }
            "openness" if clamped_change > 0 => {
                traits.big_five.openness = (traits.big_five.openness as i16 + clamped_change as i16).clamp(0, 100) as u8;
            }
            "confidence" => {
                // Affects both neuroticism (inversely) and ambition
                traits.big_five.neuroticism = (traits.big_five.neuroticism as i16 - clamped_change as i16).clamp(0, 100) as u8;
                traits.game_traits.ambition = (traits.game_traits.ambition + clamped_change / 2).clamp(-100, 100);
            }
            _ => continue,
        }

        changes.push((trait_name.clone(), clamped_change));
    }

    changes
}

// =============================================================================
// Goal Evolution
// =============================================================================

/// Update goals based on life stage and achievements
pub fn evolve_goals(
    goals: &mut PersonalGoals,
    life_stage: LifeStage,
    current_tick: u64,
) {
    // Remove completed goals
    goals.goals.retain(|g| g.current_progress < g.target_value);

    // Check if we need new goals based on life stage
    let stage_goals = GoalType::for_life_stage(life_stage);

    for goal_type in stage_goals {
        // Check if we already have this goal type
        let has_goal = goals.goals.iter().any(|g| g.goal_type == goal_type);

        if !has_goal && goals.goals.len() < 3 {
            goals.goals.push(PersonalGoal {
                goal_type,
                target_value: 100, // Default target
                current_progress: 0,
                priority: 50,
                created_tick: current_tick,
            });
        }
    }
}

// =============================================================================
// Event Payloads
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraitEvolvedPayload {
    pub npc_id: u64,
    pub trait_name: String,
    pub change: i8,
    pub new_value: i8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalChangedPayload {
    pub npc_id: u64,
    pub old_goal: Option<u8>,
    pub new_goal: u8,
}

// =============================================================================
// Integration
// =============================================================================

/// Create personality evolution entry for an NPC
pub fn create_npc_personality(
    ctx: &ReducerContext,
    npc_id: u64,
    npc_seed: u64,
    archetype_id: u32,
    current_tick: u64,
) -> bool {
    let personality_seed = generate_personality_seed(npc_seed);
    let traits = generate_personality_traits(personality_seed, archetype_id);
    let stability = calculate_stability(&traits);

    let traits_json = match serde_json::to_vec(&traits) {
        Ok(j) => j,
        Err(_) => return false,
    };

    let virtues_vices = VirtuesVices::default();
    let vv_json = match serde_json::to_vec(&virtues_vices) {
        Ok(j) => j,
        Err(_) => return false,
    };

    let mut goals = PersonalGoals::default();
    evolve_goals(&mut goals, LifeStage::Youth, current_tick);
    let goals_json = match serde_json::to_vec(&goals) {
        Ok(j) => j,
        Err(_) => return false,
    };

    let evolution = NpcPersonalityEvolution {
        npc_id,
        traits_json,
        virtues_vices_json: vv_json,
        goals_json,
        stability,
        life_stage: LifeStage::Youth as u8,
        age_ticks: 0,
        last_update_tick: current_tick,
        version: 1,
    };

    ctx.db.npc_personality_evolution().try_insert(evolution).is_ok()
}

/// Log trait evolution event
pub fn log_trait_evolution(
    ctx: &ReducerContext,
    npc_id: u64,
    trait_name: &str,
    change: i8,
    new_value: i8,
    tick: u64,
    ts_ms: u64,
) {
    let payload = TraitEvolvedPayload {
        npc_id,
        trait_name: trait_name.to_string(),
        change,
        new_value,
    };

    let _ = ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick,
        zone_id: 0,
        chunk_x: 0,
        chunk_y: 0,
        actor_id: Some(npc_id),
        target_id: None,
        event_type: EventType::TraitEvolved as u16,
        payload: serialize_payload(&payload),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_personality_generation() {
        let traits = generate_personality_traits(12345, 1);

        assert!(traits.big_five.openness >= 30 && traits.big_five.openness <= 100);
        assert!(traits.game_traits.courage >= -100 && traits.game_traits.courage <= 100);
    }

    #[test]
    fn test_stability_calculation() {
        let mut traits = PersonalityTraits::default();
        traits.big_five.conscientiousness = 80;
        traits.big_five.neuroticism = 20;

        let stability = calculate_stability(&traits);
        assert!(stability > 50); // High conscientiousness, low neuroticism = stable
    }

    #[test]
    fn test_goal_evolution() {
        let mut goals = PersonalGoals::default();
        evolve_goals(&mut goals, LifeStage::Youth, 100);

        assert!(!goals.goals.is_empty());
        assert!(goals.goals.iter().any(|g| g.goal_type == GoalType::MakeFriends));
    }
}
