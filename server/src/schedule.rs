//! NPC Schedule System
//!
//! Generates and manages daily schedules for NPCs based on their seed
//! and archetype. Schedules affect utility scoring for action selection.

use crate::{
    reward_profile::RewardProfile,
    NpcSchedule,
    // Table accessor traits
    npc_schedule,
};
use serde::{Deserialize, Serialize};
use siphasher::sip::SipHasher24;
use spacetimedb::{ReducerContext, Table};
use std::hash::{Hash, Hasher};

// =============================================================================
// Constants
// =============================================================================

/// Salt for schedule seed generation
const SCHEDULE_SALT: u64 = 0x5C4E_D01E_5A17_DA17;

/// Default wake hour
const DEFAULT_WAKE_HOUR: u8 = 6;

/// Default sleep hour
const DEFAULT_SLEEP_HOUR: u8 = 22;

// =============================================================================
// Schedule Types
// =============================================================================

/// A block of time in the daily schedule
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleBlock {
    /// Start hour (0-23)
    pub start_hour: u8,
    /// End hour (0-23)
    pub end_hour: u8,
    /// Activity type
    pub activity: ScheduleActivity,
    /// Location hint (POI type or home)
    pub location_hint: LocationHint,
    /// Priority (higher = more important to follow)
    pub priority: u8,
}

/// Types of scheduled activities
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScheduleActivity {
    /// Sleep time
    Sleep,
    /// Work at profession
    Work,
    /// Eating meals
    Meal,
    /// Social time
    Social,
    /// Rest/leisure
    Rest,
    /// Personal rituals (prayer, exercise, etc.)
    Ritual,
    /// Shopping/errands
    Errands,
    /// Patrol (guards)
    Patrol,
    /// Study/practice
    Practice,
    /// Free time (any activity)
    Free,
}

impl ScheduleActivity {
    /// Get associated intent for this activity
    #[must_use]
    pub fn preferred_intent(&self) -> &'static str {
        match self {
            Self::Sleep => "GoHome",
            Self::Work => "Work",
            Self::Meal => "SeekFood",
            Self::Social => "Socialize",
            Self::Rest => "Rest",
            Self::Ritual => "Idle",
            Self::Errands => "Trade",
            Self::Patrol => "Patrol",
            Self::Practice => "Work",
            Self::Free => "Wander",
        }
    }

    /// Get utility bonus for matching this scheduled activity
    #[must_use]
    pub fn utility_bonus(&self) -> f32 {
        match self {
            Self::Sleep => 0.4,
            Self::Work => 0.3,
            Self::Meal => 0.35,
            Self::Social => 0.2,
            Self::Rest => 0.25,
            Self::Ritual => 0.3,
            Self::Errands => 0.2,
            Self::Patrol => 0.35,
            Self::Practice => 0.25,
            Self::Free => 0.0,
        }
    }
}

/// Hints for where an activity should take place
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LocationHint {
    Home,
    Workplace,
    Tavern,
    Market,
    Temple,
    TrainingGround,
    Road,
    Anywhere,
}

/// A personal ritual with specific timing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ritual {
    /// Name/type of ritual
    pub ritual_type: RitualType,
    /// Preferred time (0-23)
    pub preferred_hour: u8,
    /// Duration in game-hours
    pub duration_hours: u8,
    /// How important this ritual is
    pub importance: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RitualType {
    MorningPrayer,
    EveningPrayer,
    Exercise,
    Meditation,
    Journaling,
    TavernVisit,
    MarketBrowse,
    GardenTending,
    ReadingStudy,
    MusicPractice,
}

/// Complete daily schedule for an NPC
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailySchedule {
    pub wake_hour: u8,
    pub sleep_hour: u8,
    pub blocks: Vec<ScheduleBlock>,
    pub rituals: Vec<Ritual>,
}

impl Default for DailySchedule {
    fn default() -> Self {
        Self {
            wake_hour: DEFAULT_WAKE_HOUR,
            sleep_hour: DEFAULT_SLEEP_HOUR,
            blocks: Vec::new(),
            rituals: Vec::new(),
        }
    }
}

// =============================================================================
// Schedule Generation
// =============================================================================

/// Generate a schedule seed from NPC seed
#[must_use]
pub fn generate_schedule_seed(npc_seed: u64) -> u64 {
    let mut hasher = SipHasher24::new();
    npc_seed.hash(&mut hasher);
    SCHEDULE_SALT.hash(&mut hasher);
    hasher.finish()
}

/// Generate a daily schedule from seed and archetype
pub fn generate_daily_schedule(
    schedule_seed: u64,
    archetype_id: u32,
    profile: Option<&RewardProfile>,
) -> DailySchedule {
    let mut schedule = DailySchedule::default();

    // LCG for deterministic randomness
    let mut rng_state = schedule_seed;
    let mut next_rand = || {
        rng_state = rng_state.wrapping_mul(6364136223846793005).wrapping_add(1);
        rng_state
    };

    // Vary wake/sleep times based on seed and introversion
    let introversion = profile.map(|p| p.social_prefs.introversion).unwrap_or(50);

    // Introverts wake earlier, sleep earlier
    let wake_variance = (next_rand() % 4) as i8 - 2; // -2 to +1
    let sleep_variance = (next_rand() % 4) as i8 - 2;

    schedule.wake_hour = (DEFAULT_WAKE_HOUR as i8 + wake_variance + (introversion as i8 - 50) / 25)
        .clamp(4, 10) as u8;
    schedule.sleep_hour = (DEFAULT_SLEEP_HOUR as i8 + sleep_variance - (introversion as i8 - 50) / 25)
        .clamp(20, 24) as u8;

    // Generate schedule blocks based on archetype
    schedule.blocks = generate_archetype_schedule(archetype_id, &mut next_rand, schedule.wake_hour, schedule.sleep_hour);

    // Generate rituals based on seed and personality
    schedule.rituals = generate_rituals(&mut next_rand, profile);

    schedule
}

/// Generate schedule blocks for an archetype
fn generate_archetype_schedule<F: FnMut() -> u64>(
    archetype_id: u32,
    rng: &mut F,
    wake_hour: u8,
    sleep_hour: u8,
) -> Vec<ScheduleBlock> {
    let mut blocks = Vec::new();

    // Morning meal
    blocks.push(ScheduleBlock {
        start_hour: wake_hour,
        end_hour: wake_hour + 1,
        activity: ScheduleActivity::Meal,
        location_hint: LocationHint::Home,
        priority: 80,
    });

    // Archetype-specific work schedule
    let (work_start, work_end, work_loc) = match archetype_id {
        1 => (8, 18, LocationHint::Market), // Merchant
        2 => (6, 14, LocationHint::Road),   // Guard (day shift)
        3 => (7, 17, LocationHint::Workplace), // Blacksmith
        4 => (10, 22, LocationHint::Tavern), // Innkeeper
        5 => (8, 16, LocationHint::Temple), // Scholar
        6 => (5, 14, LocationHint::Anywhere), // Farmer
        7 => (6, 12, LocationHint::Anywhere), // Hunter
        8 => (8, 18, LocationHint::Workplace), // Healer
        _ => (9, 17, LocationHint::Workplace), // Default
    };

    blocks.push(ScheduleBlock {
        start_hour: work_start,
        end_hour: work_end,
        activity: ScheduleActivity::Work,
        location_hint: work_loc,
        priority: 70,
    });

    // Midday meal (if work allows)
    if work_end - work_start > 4 {
        let lunch_hour = work_start + (work_end - work_start) / 2;
        blocks.push(ScheduleBlock {
            start_hour: lunch_hour,
            end_hour: lunch_hour + 1,
            activity: ScheduleActivity::Meal,
            location_hint: LocationHint::Anywhere,
            priority: 60,
        });
    }

    // Evening social time (varies by randomness)
    let social_hour = 18 + (rng() % 3) as u8;
    if social_hour < sleep_hour.saturating_sub(2) {
        blocks.push(ScheduleBlock {
            start_hour: social_hour,
            end_hour: social_hour + 2,
            activity: ScheduleActivity::Social,
            location_hint: LocationHint::Tavern,
            priority: 40,
        });
    }

    // Evening meal
    blocks.push(ScheduleBlock {
        start_hour: sleep_hour.saturating_sub(2),
        end_hour: sleep_hour.saturating_sub(1),
        activity: ScheduleActivity::Meal,
        location_hint: LocationHint::Home,
        priority: 75,
    });

    // Sleep
    blocks.push(ScheduleBlock {
        start_hour: sleep_hour,
        end_hour: wake_hour, // Wraps to next day
        activity: ScheduleActivity::Sleep,
        location_hint: LocationHint::Home,
        priority: 90,
    });

    blocks
}

/// Generate personal rituals
fn generate_rituals<F: FnMut() -> u64>(
    rng: &mut F,
    profile: Option<&RewardProfile>,
) -> Vec<Ritual> {
    let mut rituals = Vec::new();

    // Number of rituals based on personality
    let ritual_count = 1 + (rng() % 3) as usize;

    let possible_rituals = [
        RitualType::MorningPrayer,
        RitualType::EveningPrayer,
        RitualType::Exercise,
        RitualType::Meditation,
        RitualType::TavernVisit,
        RitualType::ReadingStudy,
    ];

    for i in 0..ritual_count {
        let ritual_type = possible_rituals[(rng() as usize + i) % possible_rituals.len()];

        let (preferred_hour, duration) = match ritual_type {
            RitualType::MorningPrayer => (6, 1),
            RitualType::EveningPrayer => (20, 1),
            RitualType::Exercise => (7, 1),
            RitualType::Meditation => (6, 1),
            RitualType::TavernVisit => (19, 2),
            RitualType::ReadingStudy => (21, 1),
            _ => (12, 1),
        };

        rituals.push(Ritual {
            ritual_type,
            preferred_hour,
            duration_hours: duration,
            importance: 30 + (rng() % 40) as u8,
        });
    }

    rituals
}

// =============================================================================
// Schedule Utility Modifiers
// =============================================================================

/// Get the scheduled activity for a given hour
#[must_use]
pub fn get_scheduled_activity(schedule: &DailySchedule, hour: u8) -> Option<&ScheduleBlock> {
    schedule.blocks.iter().find(|block| {
        if block.start_hour <= block.end_hour {
            // Normal block within same day
            hour >= block.start_hour && hour < block.end_hour
        } else {
            // Block wraps midnight (e.g., sleep from 22 to 6)
            hour >= block.start_hour || hour < block.end_hour
        }
    })
}

/// Get utility modifier for an intent based on current schedule
#[must_use]
pub fn get_schedule_utility_modifier(
    schedule: &DailySchedule,
    hour: u8,
    intent: &str,
) -> f32 {
    let Some(block) = get_scheduled_activity(schedule, hour) else {
        return 1.0; // No scheduled activity, neutral
    };

    let scheduled_intent = block.activity.preferred_intent();

    if intent == scheduled_intent {
        // Matches schedule - bonus
        1.0 + block.activity.utility_bonus()
    } else if block.activity == ScheduleActivity::Free {
        // Free time - slight bonus for any activity
        1.05
    } else {
        // Doesn't match schedule - penalty proportional to priority
        1.0 - (block.priority as f32 / 200.0)
    }
}

/// Check if current hour is near a scheduled ritual
#[must_use]
pub fn is_ritual_time(schedule: &DailySchedule, hour: u8) -> Option<&Ritual> {
    schedule.rituals.iter().find(|r| {
        let end_hour = r.preferred_hour + r.duration_hours;
        hour >= r.preferred_hour && hour < end_hour
    })
}

// =============================================================================
// Integration
// =============================================================================

/// Create and store a schedule for an NPC
pub fn create_npc_schedule(
    ctx: &ReducerContext,
    npc_id: u64,
    npc_seed: u64,
    archetype_id: u32,
    profile: Option<&RewardProfile>,
) -> bool {
    let schedule_seed = generate_schedule_seed(npc_seed);
    let daily_schedule = generate_daily_schedule(schedule_seed, archetype_id, profile);

    let schedule_json = match serde_json::to_vec(&daily_schedule.blocks) {
        Ok(j) => j,
        Err(_) => return false,
    };

    let rituals_json = match serde_json::to_vec(&daily_schedule.rituals) {
        Ok(j) => j,
        Err(_) => return false,
    };

    let npc_sched = NpcSchedule {
        npc_id,
        wake_hour: daily_schedule.wake_hour,
        sleep_hour: daily_schedule.sleep_hour,
        schedule_json,
        rituals_json,
        schedule_seed,
    };

    ctx.db.npc_schedule().try_insert(npc_sched).is_ok()
}

/// Load a schedule from database
pub fn load_npc_schedule(ctx: &ReducerContext, npc_id: u64) -> Option<DailySchedule> {
    let sched = ctx.db.npc_schedule().npc_id().find(npc_id)?;

    let blocks: Vec<ScheduleBlock> = serde_json::from_slice(&sched.schedule_json).ok()?;
    let rituals: Vec<Ritual> = serde_json::from_slice(&sched.rituals_json).ok()?;

    Some(DailySchedule {
        wake_hour: sched.wake_hour,
        sleep_hour: sched.sleep_hour,
        blocks,
        rituals,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_schedule_generation() {
        let schedule = generate_daily_schedule(12345, 1, None);

        assert!(schedule.wake_hour >= 4 && schedule.wake_hour <= 10);
        assert!(schedule.sleep_hour >= 20 && schedule.sleep_hour <= 24);
        assert!(!schedule.blocks.is_empty());
    }

    #[test]
    fn test_get_scheduled_activity() {
        let mut schedule = DailySchedule::default();
        schedule.blocks.push(ScheduleBlock {
            start_hour: 8,
            end_hour: 12,
            activity: ScheduleActivity::Work,
            location_hint: LocationHint::Workplace,
            priority: 70,
        });

        let activity = get_scheduled_activity(&schedule, 10);
        assert!(activity.is_some());
        assert_eq!(activity.unwrap().activity, ScheduleActivity::Work);

        assert!(get_scheduled_activity(&schedule, 14).is_none());
    }

    #[test]
    fn test_schedule_utility_modifier() {
        let mut schedule = DailySchedule::default();
        schedule.blocks.push(ScheduleBlock {
            start_hour: 8,
            end_hour: 12,
            activity: ScheduleActivity::Work,
            location_hint: LocationHint::Workplace,
            priority: 70,
        });

        // Should get bonus for matching Work intent
        let modifier = get_schedule_utility_modifier(&schedule, 10, "Work");
        assert!(modifier > 1.0);

        // Should get penalty for non-matching intent
        let modifier = get_schedule_utility_modifier(&schedule, 10, "Socialize");
        assert!(modifier < 1.0);
    }
}
