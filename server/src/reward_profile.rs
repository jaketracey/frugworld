//! NPC Reward Profile System
//!
//! Generates unique NPC reward profiles from deterministic seeds.
//! Each NPC gets personalized preferences for food, work, social interaction,
//! and reward weights that drive emergent behavior.

use serde::{Deserialize, Serialize};
use siphasher::sip::SipHasher24;
use std::hash::{Hash, Hasher};

// =============================================================================
// Seed Generation
// =============================================================================

/// Salt for reward profile generation
const REWARD_PROFILE_SALT: u64 = 0xBEAD_B00F_1CE_5A17;

/// Salt for natural talents generation
const TALENTS_SALT: u64 = 0x7A1E_0757_6E05_A171;

/// Salt for skill generation
const SKILLS_SALT: u64 = 0x5C11_1565_6E05_A172;

/// Generate unique NPC seed from spawn parameters
#[must_use]
pub fn generate_npc_seed(chunk_seed: u64, archetype_id: u32, spawn_index: u32) -> u64 {
    let mut hasher = SipHasher24::new_with_keys(chunk_seed, 0x0BC0_5EED_0000_0001);
    archetype_id.hash(&mut hasher);
    spawn_index.hash(&mut hasher);
    hasher.finish()
}

/// Simple deterministic RNG using LCG
fn next_rand(state: &mut u64) -> u64 {
    *state = state.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
    *state
}

/// Get random value in range [min, max]
fn rand_range(state: &mut u64, min: u64, max: u64) -> u64 {
    if max <= min {
        return min;
    }
    min + (next_rand(state) % (max - min + 1))
}

// =============================================================================
// Food Preferences
// =============================================================================

/// Food preference data - what the NPC likes/dislikes eating
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FoodPreferences {
    /// Favorite food subtype ID (gets +40% reward)
    pub favorite: u32,
    /// Disliked food subtype ID (gets -30% reward)
    pub disliked: u32,
    /// Additional preference modifiers by food subtype (-50 to +50)
    pub modifiers: Vec<(u32, i8)>,
}

// =============================================================================
// Work Affinities
// =============================================================================

/// Work type affinities - affects skill gain rate and work satisfaction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkAffinities {
    /// Crafting aptitude (0-100)
    pub crafting: u8,
    /// Gathering aptitude (0-100)
    pub gathering: u8,
    /// Trading aptitude (0-100)
    pub trading: u8,
    /// Combat aptitude (0-100)
    pub combat: u8,
    /// Social aptitude (0-100)
    pub social: u8,
    /// Scholarly aptitude (0-100)
    pub scholarly: u8,
}

impl Default for WorkAffinities {
    fn default() -> Self {
        Self {
            crafting: 50,
            gathering: 50,
            trading: 50,
            combat: 50,
            social: 50,
            scholarly: 50,
        }
    }
}

// =============================================================================
// Social Preferences
// =============================================================================

/// Social preferences - how the NPC approaches social interaction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialPreferences {
    /// Introversion score (0=very extroverted, 100=very introverted)
    pub introversion: u8,
    /// Preferred archetype IDs for social interaction
    pub preferred_archetypes: Vec<u32>,
    /// Avoided archetype IDs
    pub avoided_archetypes: Vec<u32>,
    /// Trust threshold for deep conversations (0-100)
    pub trust_threshold: u8,
}

impl Default for SocialPreferences {
    fn default() -> Self {
        Self {
            introversion: 50,
            preferred_archetypes: Vec::new(),
            avoided_archetypes: Vec::new(),
            trust_threshold: 50,
        }
    }
}

// =============================================================================
// Reward Weights
// =============================================================================

/// Reward category weights - personal importance of each reward type
/// Values are 0-200 scale where 100 = normal importance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewardWeights {
    /// Importance of food/eating (0-200)
    pub food: u8,
    /// Importance of rest/sleep (0-200)
    pub rest: u8,
    /// Importance of safety/security (0-200)
    pub safety: u8,
    /// Importance of social interaction (0-200)
    pub social: u8,
    /// Importance of wealth/prosperity (0-200)
    pub wealth: u8,
    /// Importance of skill mastery (0-200)
    pub mastery: u8,
    /// Importance of exploration/discovery (0-200)
    pub discovery: u8,
    /// Importance of legacy/reputation (0-200)
    pub legacy: u8,
}

impl Default for RewardWeights {
    fn default() -> Self {
        Self {
            food: 100,
            rest: 100,
            safety: 100,
            social: 100,
            wealth: 100,
            mastery: 100,
            discovery: 100,
            legacy: 100,
        }
    }
}

// =============================================================================
// Personal Goals
// =============================================================================

/// Personal goal types beyond basic survival
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PersonalGoalType {
    AccumulateWealth = 0,
    MasterCraft = 1,
    BuildFamily = 2,
    GainRenown = 3,
    ExploreWorld = 4,
    ProtectCommunity = 5,
    SeekKnowledge = 6,
    CreateLegacy = 7,
    FindLove = 8,
    AvengeWrong = 9,
}

impl PersonalGoalType {
    fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::AccumulateWealth,
            1 => Self::MasterCraft,
            2 => Self::BuildFamily,
            3 => Self::GainRenown,
            4 => Self::ExploreWorld,
            5 => Self::ProtectCommunity,
            6 => Self::SeekKnowledge,
            7 => Self::CreateLegacy,
            8 => Self::FindLove,
            9 => Self::AvengeWrong,
            _ => Self::AccumulateWealth,
        }
    }
}

/// Personal goals configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonalGoals {
    /// Primary life goal type
    pub primary_goal: PersonalGoalType,
    /// Secondary aspirations
    pub secondary_goals: Vec<PersonalGoalType>,
    /// Specific target value (e.g., wealth amount, skill level)
    pub goal_target: u32,
}

impl Default for PersonalGoals {
    fn default() -> Self {
        Self {
            primary_goal: PersonalGoalType::AccumulateWealth,
            secondary_goals: Vec::new(),
            goal_target: 100,
        }
    }
}

// =============================================================================
// Natural Talents
// =============================================================================

/// Natural talents derived from NPC seed - affects learning and growth
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NaturalTalents {
    /// Starting XP bonuses by skill name
    pub starting_bonuses: Vec<(String, u32)>,
    /// Learning speed modifiers by skill name (50=0.5x, 100=1x, 200=2x)
    pub learning_modifiers: Vec<(String, u8)>,
    /// Primary talent area (skill category name)
    pub primary_talent: String,
    /// Secondary talent area
    pub secondary_talent: Option<String>,
    /// Weak areas (skill categories that learn slower)
    pub weak_areas: Vec<String>,
    /// Personality stability (1-100, how resistant to trait changes)
    pub personality_stability: u8,
    /// Life satisfaction threshold (0-100)
    pub satisfaction_threshold: u8,
    /// Base luck modifier (-10 to +10)
    pub luck_modifier: i8,
}

impl Default for NaturalTalents {
    fn default() -> Self {
        Self {
            starting_bonuses: Vec::new(),
            learning_modifiers: Vec::new(),
            primary_talent: "survival".to_string(),
            secondary_talent: None,
            weak_areas: Vec::new(),
            personality_stability: 70,
            satisfaction_threshold: 50,
            luck_modifier: 0,
        }
    }
}

// =============================================================================
// Complete Reward Profile
// =============================================================================

/// Complete NPC reward profile generated from seed
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RewardProfile {
    /// Seed used for generation (for reproducibility)
    pub profile_seed: u64,
    /// Food preferences
    pub food_prefs: FoodPreferences,
    /// Work type affinities
    pub work_affinities: WorkAffinities,
    /// Social preferences
    pub social_prefs: SocialPreferences,
    /// Reward category weights
    pub reward_weights: RewardWeights,
    /// Personal life goals
    pub personal_goals: PersonalGoals,
}

// =============================================================================
// Profile Generation
// =============================================================================

/// Generate complete reward profile from NPC seed
#[must_use]
pub fn generate_reward_profile(npc_seed: u64, archetype_id: u32) -> RewardProfile {
    let profile_seed = npc_seed.wrapping_add(REWARD_PROFILE_SALT);
    let mut rng = profile_seed;

    RewardProfile {
        profile_seed,
        food_prefs: generate_food_preferences(&mut rng, archetype_id),
        work_affinities: generate_work_affinities(&mut rng, archetype_id),
        social_prefs: generate_social_preferences(&mut rng, archetype_id),
        reward_weights: generate_reward_weights(&mut rng, archetype_id),
        personal_goals: generate_personal_goals(&mut rng, archetype_id),
    }
}

fn generate_food_preferences(rng: &mut u64, archetype_id: u32) -> FoodPreferences {
    // Food subtypes: 0-9 = fruits, 10-19 = meats, 20-29 = grains, 30-39 = vegetables
    let (base_min, base_max) = match archetype_id {
        7 => (20, 29),  // Farmer prefers grains
        6 => (10, 19),  // Hunter prefers meats
        _ => (0, 39),   // Others vary more
    };

    let favorite = rand_range(rng, base_min, base_max) as u32;

    // Pick disliked from different category
    let disliked = loop {
        let candidate = rand_range(rng, 0, 39) as u32;
        if (candidate / 10) != (favorite / 10) {
            break candidate;
        }
    };

    // Generate 3-5 moderate preferences
    let pref_count = rand_range(rng, 3, 5) as usize;
    let mut modifiers = Vec::with_capacity(pref_count);

    for _ in 0..pref_count {
        let food_type = rand_range(rng, 0, 39) as u32;
        let modifier = (rand_range(rng, 0, 40) as i8) - 20; // -20 to +20
        if food_type != favorite && food_type != disliked {
            modifiers.push((food_type, modifier));
        }
    }

    FoodPreferences {
        favorite,
        disliked,
        modifiers,
    }
}

fn generate_work_affinities(rng: &mut u64, archetype_id: u32) -> WorkAffinities {
    // Base affinities from archetype (crafting, gathering, trading, combat, social, scholarly)
    let (craft, gather, trade, combat, social, scholar) = match archetype_id {
        1 => (40, 30, 90, 20, 70, 40),   // Merchant
        2 => (30, 40, 30, 80, 40, 30),   // Guard
        3 => (50, 50, 50, 30, 60, 40),   // Villager
        4 => (90, 50, 60, 20, 40, 50),   // Craftsman
        5 => (40, 60, 50, 50, 40, 60),   // Wanderer
        6 => (40, 80, 40, 70, 30, 30),   // Hunter
        7 => (50, 90, 50, 30, 50, 30),   // Farmer
        8 => (50, 70, 40, 60, 40, 80),   // Explorer
        9 => (60, 70, 60, 50, 30, 40),   // Scavenger
        10 => (40, 50, 50, 40, 60, 50),  // Traveler
        _ => (50, 50, 50, 50, 50, 50),   // Default
    };

    // Add random variance (-15 to +15)
    let variance = |base: u64, r: &mut u64| -> u8 {
        let delta = rand_range(r, 0, 30) as i16 - 15;
        (base as i16 + delta).clamp(0, 100) as u8
    };

    WorkAffinities {
        crafting: variance(craft, rng),
        gathering: variance(gather, rng),
        trading: variance(trade, rng),
        combat: variance(combat, rng),
        social: variance(social, rng),
        scholarly: variance(scholar, rng),
    }
}

fn generate_social_preferences(rng: &mut u64, archetype_id: u32) -> SocialPreferences {
    // Base introversion by archetype
    let base_introversion = match archetype_id {
        1 => 30,  // Merchant - more social
        2 => 50,  // Guard - moderate
        3 => 40,  // Villager - social
        4 => 60,  // Craftsman - focused on work
        5 => 70,  // Wanderer - solitary
        6 => 65,  // Hunter - solitary
        7 => 45,  // Farmer - community-oriented
        8 => 55,  // Explorer - independent
        9 => 60,  // Scavenger - wary
        _ => 50,
    };

    let introversion = {
        let delta = rand_range(rng, 0, 30) as i16 - 15;
        (base_introversion + delta).clamp(0, 100) as u8
    };

    // Preferred archetypes (1-2)
    let mut preferred = Vec::new();
    let pref_count = rand_range(rng, 1, 2) as usize;
    for _ in 0..pref_count {
        let arch = rand_range(rng, 1, 10) as u32;
        if !preferred.contains(&arch) && arch != archetype_id {
            preferred.push(arch);
        }
    }

    // Avoided archetypes (0-1)
    let mut avoided = Vec::new();
    if rand_range(rng, 0, 2) > 0 {
        let arch = rand_range(rng, 1, 10) as u32;
        if !preferred.contains(&arch) && arch != archetype_id {
            avoided.push(arch);
        }
    }

    let trust_threshold = rand_range(rng, 30, 70) as u8;

    SocialPreferences {
        introversion,
        preferred_archetypes: preferred,
        avoided_archetypes: avoided,
        trust_threshold,
    }
}

fn generate_reward_weights(rng: &mut u64, archetype_id: u32) -> RewardWeights {
    // Base weights by archetype (food, rest, safety, social, wealth, mastery, discovery, legacy)
    let (food, rest, safety, social, wealth, mastery, discovery, legacy) = match archetype_id {
        1 => (90, 80, 90, 110, 150, 80, 70, 100),   // Merchant: wealth-focused
        2 => (100, 90, 130, 90, 80, 110, 60, 120),  // Guard: safety + legacy
        3 => (100, 100, 100, 120, 90, 80, 70, 100), // Villager: balanced, social
        4 => (90, 100, 100, 80, 100, 150, 70, 130), // Craftsman: mastery + legacy
        5 => (80, 70, 80, 70, 60, 90, 150, 80),     // Wanderer: discovery
        6 => (100, 80, 90, 60, 80, 120, 100, 90),   // Hunter: mastery
        7 => (100, 110, 100, 100, 90, 80, 60, 100), // Farmer: rest, balanced
        8 => (80, 70, 70, 80, 70, 90, 160, 100),    // Explorer: discovery
        9 => (90, 80, 100, 70, 120, 80, 90, 70),    // Scavenger: wealth
        _ => (100, 100, 100, 100, 100, 100, 100, 100),
    };

    // Add variance (-20 to +20)
    let variance = |base: u64, r: &mut u64| -> u8 {
        let delta = rand_range(r, 0, 40) as i16 - 20;
        (base as i16 + delta).clamp(20, 200) as u8
    };

    RewardWeights {
        food: variance(food, rng),
        rest: variance(rest, rng),
        safety: variance(safety, rng),
        social: variance(social, rng),
        wealth: variance(wealth, rng),
        mastery: variance(mastery, rng),
        discovery: variance(discovery, rng),
        legacy: variance(legacy, rng),
    }
}

fn generate_personal_goals(rng: &mut u64, archetype_id: u32) -> PersonalGoals {
    // Primary goal weights by archetype
    let primary_options: &[(PersonalGoalType, u8)] = match archetype_id {
        1 => &[(PersonalGoalType::AccumulateWealth, 40), (PersonalGoalType::GainRenown, 30), (PersonalGoalType::CreateLegacy, 20)],
        2 => &[(PersonalGoalType::ProtectCommunity, 40), (PersonalGoalType::GainRenown, 30), (PersonalGoalType::MasterCraft, 20)],
        3 => &[(PersonalGoalType::BuildFamily, 35), (PersonalGoalType::FindLove, 30), (PersonalGoalType::AccumulateWealth, 20)],
        4 => &[(PersonalGoalType::MasterCraft, 50), (PersonalGoalType::CreateLegacy, 30), (PersonalGoalType::GainRenown, 15)],
        5 => &[(PersonalGoalType::ExploreWorld, 40), (PersonalGoalType::SeekKnowledge, 35), (PersonalGoalType::FindLove, 15)],
        6 => &[(PersonalGoalType::MasterCraft, 35), (PersonalGoalType::ExploreWorld, 30), (PersonalGoalType::ProtectCommunity, 20)],
        7 => &[(PersonalGoalType::BuildFamily, 40), (PersonalGoalType::AccumulateWealth, 30), (PersonalGoalType::CreateLegacy, 20)],
        8 => &[(PersonalGoalType::ExploreWorld, 50), (PersonalGoalType::SeekKnowledge, 30), (PersonalGoalType::GainRenown, 15)],
        9 => &[(PersonalGoalType::AccumulateWealth, 40), (PersonalGoalType::SeekKnowledge, 25), (PersonalGoalType::ExploreWorld, 20)],
        _ => &[(PersonalGoalType::AccumulateWealth, 30), (PersonalGoalType::ExploreWorld, 30), (PersonalGoalType::FindLove, 25)],
    };

    // Weighted random selection for primary goal
    let total_weight: u8 = primary_options.iter().map(|(_, w)| w).sum();
    let roll = rand_range(rng, 0, total_weight as u64) as u8;
    let mut cumulative = 0u8;
    let primary_goal = primary_options.iter()
        .find(|(_, weight)| {
            cumulative += *weight;
            roll < cumulative
        })
        .map(|(goal, _)| *goal)
        .unwrap_or(PersonalGoalType::AccumulateWealth);

    // Pick 1-2 secondary goals different from primary
    let mut secondary = Vec::new();
    let secondary_count = rand_range(rng, 1, 2) as usize;
    let all_goals = [
        PersonalGoalType::AccumulateWealth,
        PersonalGoalType::MasterCraft,
        PersonalGoalType::BuildFamily,
        PersonalGoalType::GainRenown,
        PersonalGoalType::ExploreWorld,
        PersonalGoalType::ProtectCommunity,
        PersonalGoalType::SeekKnowledge,
        PersonalGoalType::CreateLegacy,
        PersonalGoalType::FindLove,
    ];

    for _ in 0..secondary_count {
        let idx = rand_range(rng, 0, all_goals.len() as u64 - 1) as usize;
        let goal = all_goals[idx];
        if goal != primary_goal && !secondary.contains(&goal) {
            secondary.push(goal);
        }
    }

    // Goal target value
    let goal_target = rand_range(rng, 50, 200) as u32;

    PersonalGoals {
        primary_goal,
        secondary_goals: secondary,
        goal_target,
    }
}

/// Generate natural talents from NPC seed
#[must_use]
pub fn generate_natural_talents(npc_seed: u64, archetype_id: u32) -> NaturalTalents {
    let talents_seed = npc_seed.wrapping_add(TALENTS_SALT);
    let mut rng = talents_seed;

    // Determine primary talent from archetype
    let primary_talent = match archetype_id {
        1 => "trade",      // Merchant
        2 => "combat",     // Guard
        3 => "social",     // Villager
        4 => "crafting",   // Craftsman
        5 => "knowledge",  // Wanderer
        6 => "survival",   // Hunter
        7 => "crafting",   // Farmer
        8 => "knowledge",  // Explorer
        9 => "survival",   // Scavenger
        _ => "survival",   // Default
    }.to_string();

    // Secondary talent from seed
    let categories = ["combat", "crafting", "social", "survival", "knowledge", "trade"];
    let secondary_idx = rand_range(&mut rng, 0, 5) as usize;
    let secondary_talent = if categories[secondary_idx] != primary_talent {
        Some(categories[secondary_idx].to_string())
    } else {
        None
    };

    // All skill names
    let all_skills = [
        "combat.melee", "combat.ranged", "combat.defense", "combat.tactics",
        "crafting.blacksmithing", "crafting.cooking", "crafting.building", "crafting.tailoring", "crafting.alchemy",
        "social.persuasion", "social.intimidation", "social.diplomacy", "social.leadership",
        "survival.foraging", "survival.tracking", "survival.navigation", "survival.camping", "survival.first_aid",
        "knowledge.lore", "knowledge.herbalism", "knowledge.bestiary", "knowledge.geography",
        "trade.appraisal", "trade.bargaining", "trade.accounting", "trade.networking",
    ];

    // Generate starting bonuses (significant ones only)
    let mut starting_bonuses = Vec::new();
    for skill in &all_skills {
        let bonus = rand_range(&mut rng, 0, 50) as u32;
        if bonus > 10 {
            // Primary talent skills get extra boost
            let final_bonus = if skill.starts_with(&primary_talent) {
                bonus + 20
            } else {
                bonus
            };
            starting_bonuses.push((skill.to_string(), final_bonus));
        }
    }

    // Generate learning modifiers (50-200 scale)
    let mut learning_modifiers = Vec::new();
    for skill in &all_skills {
        let base_mod = rand_range(&mut rng, 50, 150) as u8;
        // Primary talent skills learn faster
        let final_mod = if skill.starts_with(&primary_talent) {
            (base_mod as u16 + 30).min(200) as u8
        } else {
            base_mod
        };
        learning_modifiers.push((skill.to_string(), final_mod));
    }

    // Weak areas (1-2 categories)
    let weak_count = rand_range(&mut rng, 1, 2) as usize;
    let mut weak_areas = Vec::new();
    for i in 0..weak_count {
        let idx = (rand_range(&mut rng, 0, 5) + i as u64) as usize % categories.len();
        if categories[idx] != primary_talent && !weak_areas.contains(&categories[idx].to_string()) {
            weak_areas.push(categories[idx].to_string());
        }
    }

    // Personality stability (40-100)
    let personality_stability = rand_range(&mut rng, 40, 100) as u8;

    // Satisfaction threshold (30-80)
    let satisfaction_threshold = rand_range(&mut rng, 30, 80) as u8;

    // Luck modifier (-10 to +10)
    let luck_modifier = (rand_range(&mut rng, 0, 20) as i8) - 10;

    NaturalTalents {
        starting_bonuses,
        learning_modifiers,
        primary_talent,
        secondary_talent,
        weak_areas,
        personality_stability,
        satisfaction_threshold,
        luck_modifier,
    }
}

// =============================================================================
// Skill System
// =============================================================================

/// Skill level tiers
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum SkillLevel {
    Novice = 0,      // 0-99 XP
    Apprentice = 1,  // 100-499 XP
    Journeyman = 2,  // 500-1499 XP
    Expert = 3,      // 1500-3999 XP
    Master = 4,      // 4000+ XP
}

impl SkillLevel {
    #[must_use]
    pub const fn xp_threshold(self) -> u32 {
        match self {
            Self::Novice => 0,
            Self::Apprentice => 100,
            Self::Journeyman => 500,
            Self::Expert => 1500,
            Self::Master => 4000,
        }
    }

    #[must_use]
    pub fn from_xp(xp: u32) -> Self {
        if xp >= 4000 { Self::Master }
        else if xp >= 1500 { Self::Expert }
        else if xp >= 500 { Self::Journeyman }
        else if xp >= 100 { Self::Apprentice }
        else { Self::Novice }
    }

    #[must_use]
    pub const fn as_u8(self) -> u8 {
        self as u8
    }
}

/// Individual skill with XP tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub level: u8,        // SkillLevel as u8
    pub xp: u32,
    pub times_used: u32,
    pub last_used_ts_ms: u64,
}

impl Default for Skill {
    fn default() -> Self {
        Self {
            level: 0,
            xp: 0,
            times_used: 0,
            last_used_ts_ms: 0,
        }
    }
}

/// Complete skill set for an NPC
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SkillSet {
    // Combat skills
    pub combat_melee: Skill,
    pub combat_ranged: Skill,
    pub combat_defense: Skill,
    pub combat_tactics: Skill,

    // Crafting skills
    pub crafting_blacksmithing: Skill,
    pub crafting_cooking: Skill,
    pub crafting_building: Skill,
    pub crafting_tailoring: Skill,
    pub crafting_alchemy: Skill,

    // Social skills
    pub social_persuasion: Skill,
    pub social_intimidation: Skill,
    pub social_diplomacy: Skill,
    pub social_leadership: Skill,

    // Survival skills
    pub survival_foraging: Skill,
    pub survival_tracking: Skill,
    pub survival_navigation: Skill,
    pub survival_camping: Skill,
    pub survival_first_aid: Skill,

    // Knowledge skills
    pub knowledge_lore: Skill,
    pub knowledge_herbalism: Skill,
    pub knowledge_bestiary: Skill,
    pub knowledge_geography: Skill,

    // Trade skills
    pub trade_appraisal: Skill,
    pub trade_bargaining: Skill,
    pub trade_accounting: Skill,
    pub trade_networking: Skill,
}

/// Get archetype-based starting skill bonuses
fn get_archetype_skill_bonuses(archetype_id: u32) -> Vec<(&'static str, u32)> {
    match archetype_id {
        1 => vec![ // Merchant
            ("trade_bargaining", 80),
            ("trade_appraisal", 60),
            ("social_persuasion", 40),
            ("trade_networking", 50),
        ],
        2 => vec![ // Guard
            ("combat_melee", 70),
            ("combat_defense", 60),
            ("combat_tactics", 40),
            ("social_intimidation", 30),
        ],
        3 => vec![ // Villager
            ("social_diplomacy", 40),
            ("crafting_cooking", 30),
            ("knowledge_lore", 20),
        ],
        4 => vec![ // Craftsman
            ("crafting_blacksmithing", 80),
            ("crafting_building", 50),
            ("trade_appraisal", 40),
        ],
        5 => vec![ // Wanderer
            ("knowledge_lore", 60),
            ("survival_navigation", 50),
            ("knowledge_geography", 40),
        ],
        6 => vec![ // Hunter
            ("survival_tracking", 80),
            ("combat_ranged", 60),
            ("survival_foraging", 40),
            ("knowledge_bestiary", 30),
        ],
        7 => vec![ // Farmer
            ("crafting_cooking", 50),
            ("survival_foraging", 40),
            ("crafting_building", 30),
        ],
        8 => vec![ // Explorer
            ("survival_navigation", 70),
            ("knowledge_geography", 60),
            ("survival_camping", 50),
        ],
        9 => vec![ // Scavenger
            ("survival_foraging", 60),
            ("trade_appraisal", 50),
            ("survival_camping", 40),
        ],
        10 => vec![ // Traveler
            ("survival_navigation", 40),
            ("social_diplomacy", 30),
            ("knowledge_geography", 30),
        ],
        _ => vec![],
    }
}

/// Generate starting skill set from seed and archetype
#[must_use]
pub fn generate_starting_skills(npc_seed: u64, archetype_id: u32, talents: &NaturalTalents) -> SkillSet {
    let skills_seed = npc_seed.wrapping_add(SKILLS_SALT);
    let mut rng = skills_seed;

    let mut skills = SkillSet::default();

    // Get archetype bonuses
    let archetype_bonuses = get_archetype_skill_bonuses(archetype_id);

    // Helper to create skill with bonuses
    let create_skill = |skill_name: &str, rng: &mut u64| -> Skill {
        // Base XP from seed variance (0-30)
        let base_xp = rand_range(rng, 0, 30) as u32;

        // Add archetype bonus
        let archetype_bonus = archetype_bonuses.iter()
            .find(|(name, _)| *name == skill_name)
            .map(|(_, bonus)| *bonus)
            .unwrap_or(0);

        // Add talent bonus
        let skill_name_dotted = skill_name.replace('_', ".");
        let talent_bonus = talents.starting_bonuses.iter()
            .find(|(name, _)| name == &skill_name_dotted)
            .map(|(_, bonus)| *bonus)
            .unwrap_or(0);

        let total_xp = base_xp + archetype_bonus + talent_bonus;
        let level = SkillLevel::from_xp(total_xp);

        Skill {
            level: level.as_u8(),
            xp: total_xp,
            times_used: 0,
            last_used_ts_ms: 0,
        }
    };

    // Generate all skills
    skills.combat_melee = create_skill("combat_melee", &mut rng);
    skills.combat_ranged = create_skill("combat_ranged", &mut rng);
    skills.combat_defense = create_skill("combat_defense", &mut rng);
    skills.combat_tactics = create_skill("combat_tactics", &mut rng);

    skills.crafting_blacksmithing = create_skill("crafting_blacksmithing", &mut rng);
    skills.crafting_cooking = create_skill("crafting_cooking", &mut rng);
    skills.crafting_building = create_skill("crafting_building", &mut rng);
    skills.crafting_tailoring = create_skill("crafting_tailoring", &mut rng);
    skills.crafting_alchemy = create_skill("crafting_alchemy", &mut rng);

    skills.social_persuasion = create_skill("social_persuasion", &mut rng);
    skills.social_intimidation = create_skill("social_intimidation", &mut rng);
    skills.social_diplomacy = create_skill("social_diplomacy", &mut rng);
    skills.social_leadership = create_skill("social_leadership", &mut rng);

    skills.survival_foraging = create_skill("survival_foraging", &mut rng);
    skills.survival_tracking = create_skill("survival_tracking", &mut rng);
    skills.survival_navigation = create_skill("survival_navigation", &mut rng);
    skills.survival_camping = create_skill("survival_camping", &mut rng);
    skills.survival_first_aid = create_skill("survival_first_aid", &mut rng);

    skills.knowledge_lore = create_skill("knowledge_lore", &mut rng);
    skills.knowledge_herbalism = create_skill("knowledge_herbalism", &mut rng);
    skills.knowledge_bestiary = create_skill("knowledge_bestiary", &mut rng);
    skills.knowledge_geography = create_skill("knowledge_geography", &mut rng);

    skills.trade_appraisal = create_skill("trade_appraisal", &mut rng);
    skills.trade_bargaining = create_skill("trade_bargaining", &mut rng);
    skills.trade_accounting = create_skill("trade_accounting", &mut rng);
    skills.trade_networking = create_skill("trade_networking", &mut rng);

    skills
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_profile_determinism() {
        let seed1 = generate_npc_seed(12345, 1, 0);
        let seed2 = generate_npc_seed(12345, 1, 0);
        assert_eq!(seed1, seed2);

        let profile1 = generate_reward_profile(seed1, 1);
        let profile2 = generate_reward_profile(seed2, 1);
        assert_eq!(profile1.food_prefs.favorite, profile2.food_prefs.favorite);
    }

    #[test]
    fn test_different_archetypes() {
        let seed = generate_npc_seed(12345, 1, 0);
        let merchant = generate_reward_profile(seed, 1);
        let guard = generate_reward_profile(seed, 2);

        // Merchant should value wealth more
        assert!(merchant.reward_weights.wealth > guard.reward_weights.wealth - 20);
    }
}
