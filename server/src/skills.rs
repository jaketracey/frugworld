//! Skill Progression System
//!
//! Handles XP gain, skill leveling, and skill-based action bonuses.
//! Skills are tracked per-NPC in the npc_skills table.

use crate::{
    event_types::{EventType, serialize_payload},
    reward_profile::{NaturalTalents, Skill, SkillLevel, SkillSet},
    EventLog,
    // Table accessor traits
    npc_skills, event_log,
};
use serde::{Deserialize, Serialize};
use spacetimedb::{ReducerContext, Table};

// =============================================================================
// Constants
// =============================================================================

/// Base XP multiplier for actions
const BASE_XP_GAIN: u32 = 10;

/// Difficulty multipliers
const DIFFICULTY_TRIVIAL: f32 = 0.5;
const DIFFICULTY_EASY: f32 = 0.75;
const DIFFICULTY_NORMAL: f32 = 1.0;
const DIFFICULTY_HARD: f32 = 1.5;
const DIFFICULTY_EXTREME: f32 = 2.0;

/// Success multipliers
const SUCCESS_FAIL: f32 = 0.25;
const SUCCESS_PARTIAL: f32 = 0.5;
const SUCCESS_NORMAL: f32 = 1.0;
const SUCCESS_GREAT: f32 = 1.25;
const SUCCESS_CRITICAL: f32 = 1.5;

/// Decay rate: XP lost per tick of inactivity (after grace period)
const SKILL_DECAY_RATE: u32 = 1;

/// Grace period before decay starts (ticks) - about 10 minutes game time
const SKILL_DECAY_GRACE_TICKS: u64 = 12000;

// =============================================================================
// Skill Action Types
// =============================================================================

/// Types of skill-related actions that grant XP
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkillAction {
    // Combat
    MeleeAttack,
    RangedAttack,
    Block,
    Parry,
    TacticalManeuver,

    // Crafting
    SmithItem,
    CookMeal,
    BuildStructure,
    TailorClothing,
    BrewPotion,

    // Social
    Persuade,
    Intimidate,
    Negotiate,
    LeadGroup,

    // Survival
    Forage,
    TrackTarget,
    Navigate,
    SetupCamp,
    HealWound,

    // Knowledge
    StudyLore,
    IdentifyHerb,
    RecognizeCreature,
    MapArea,

    // Trade
    AppraiseItem,
    BargainPrice,
    BalanceBooks,
    MakeContact,
}

impl SkillAction {
    /// Get the skill name this action trains
    #[must_use]
    pub const fn skill_name(&self) -> &'static str {
        match self {
            Self::MeleeAttack => "combat_melee",
            Self::RangedAttack => "combat_ranged",
            Self::Block | Self::Parry => "combat_defense",
            Self::TacticalManeuver => "combat_tactics",

            Self::SmithItem => "crafting_blacksmithing",
            Self::CookMeal => "crafting_cooking",
            Self::BuildStructure => "crafting_building",
            Self::TailorClothing => "crafting_tailoring",
            Self::BrewPotion => "crafting_alchemy",

            Self::Persuade => "social_persuasion",
            Self::Intimidate => "social_intimidation",
            Self::Negotiate => "social_diplomacy",
            Self::LeadGroup => "social_leadership",

            Self::Forage => "survival_foraging",
            Self::TrackTarget => "survival_tracking",
            Self::Navigate => "survival_navigation",
            Self::SetupCamp => "survival_camping",
            Self::HealWound => "survival_first_aid",

            Self::StudyLore => "knowledge_lore",
            Self::IdentifyHerb => "knowledge_herbalism",
            Self::RecognizeCreature => "knowledge_bestiary",
            Self::MapArea => "knowledge_geography",

            Self::AppraiseItem => "trade_appraisal",
            Self::BargainPrice => "trade_bargaining",
            Self::BalanceBooks => "trade_accounting",
            Self::MakeContact => "trade_networking",
        }
    }

    /// Base XP for this action (before modifiers)
    #[must_use]
    pub const fn base_xp(&self) -> u32 {
        match self {
            // Combat actions - moderate XP per action
            Self::MeleeAttack | Self::RangedAttack => 8,
            Self::Block | Self::Parry => 6,
            Self::TacticalManeuver => 12,

            // Crafting - higher XP per item
            Self::SmithItem => 25,
            Self::CookMeal => 15,
            Self::BuildStructure => 40,
            Self::TailorClothing => 20,
            Self::BrewPotion => 30,

            // Social - moderate XP
            Self::Persuade | Self::Intimidate => 10,
            Self::Negotiate => 15,
            Self::LeadGroup => 20,

            // Survival - variable
            Self::Forage => 5,
            Self::TrackTarget => 10,
            Self::Navigate => 8,
            Self::SetupCamp => 12,
            Self::HealWound => 15,

            // Knowledge - slow but steady
            Self::StudyLore => 8,
            Self::IdentifyHerb => 6,
            Self::RecognizeCreature => 10,
            Self::MapArea => 12,

            // Trade - per transaction
            Self::AppraiseItem => 5,
            Self::BargainPrice => 10,
            Self::BalanceBooks => 8,
            Self::MakeContact => 15,
        }
    }
}

/// Difficulty level of an action
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionDifficulty {
    Trivial,
    Easy,
    Normal,
    Hard,
    Extreme,
}

impl ActionDifficulty {
    #[must_use]
    pub const fn multiplier(&self) -> f32 {
        match self {
            Self::Trivial => DIFFICULTY_TRIVIAL,
            Self::Easy => DIFFICULTY_EASY,
            Self::Normal => DIFFICULTY_NORMAL,
            Self::Hard => DIFFICULTY_HARD,
            Self::Extreme => DIFFICULTY_EXTREME,
        }
    }
}

/// Success level of an action
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionSuccess {
    Fail,
    Partial,
    Normal,
    Great,
    Critical,
}

impl ActionSuccess {
    #[must_use]
    pub const fn multiplier(&self) -> f32 {
        match self {
            Self::Fail => SUCCESS_FAIL,
            Self::Partial => SUCCESS_PARTIAL,
            Self::Normal => SUCCESS_NORMAL,
            Self::Great => SUCCESS_GREAT,
            Self::Critical => SUCCESS_CRITICAL,
        }
    }
}

// =============================================================================
// XP Calculation
// =============================================================================

/// Calculate XP gain for a skill action
///
/// Formula: base_xp * difficulty * success * talent_modifier
#[must_use]
pub fn calculate_xp_gain(
    action: SkillAction,
    difficulty: ActionDifficulty,
    success: ActionSuccess,
    talent_modifier: f32,
) -> u32 {
    let base = action.base_xp() as f32;
    let difficulty_mult = difficulty.multiplier();
    let success_mult = success.multiplier();

    let xp = base * difficulty_mult * success_mult * talent_modifier;

    // Minimum 1 XP for any action
    xp.round().max(1.0) as u32
}

/// Get talent modifier for a specific skill from natural talents
/// Returns a multiplier (0.5 to 2.0) based on natural learning speed
#[must_use]
pub fn get_talent_modifier(talents: &NaturalTalents, skill_name: &str) -> f32 {
    // Check if this skill has a specific learning modifier
    for (name, modifier) in &talents.learning_modifiers {
        if name == skill_name {
            // Convert u8 (50-200) to f32 (0.5-2.0)
            return *modifier as f32 / 100.0;
        }
    }

    // Check if skill is in primary talent area (bonus learning)
    let skill_category = skill_name.split('_').next().unwrap_or("");
    if talents.primary_talent.contains(skill_category) {
        return 1.5; // 50% bonus for primary talent area
    }

    // Check if skill is in secondary talent area
    if let Some(ref secondary) = talents.secondary_talent {
        if secondary.contains(skill_category) {
            return 1.25; // 25% bonus for secondary talent
        }
    }

    // Check if skill is in a weak area
    for weak in &talents.weak_areas {
        if weak.contains(skill_category) {
            return 0.75; // 25% penalty for weak areas
        }
    }

    // Default: no modifier
    1.0
}

// =============================================================================
// Skill Updates
// =============================================================================

/// Result of applying XP to a skill
#[derive(Debug, Clone)]
pub struct SkillUpdateResult {
    pub skill_name: &'static str,
    pub old_level: SkillLevel,
    pub new_level: SkillLevel,
    pub xp_gained: u32,
    pub new_xp: u32,
    pub leveled_up: bool,
}

/// Apply XP gain to a specific skill in a skill set
pub fn apply_xp_to_skill(
    skills: &mut SkillSet,
    skill_name: &str,
    xp_amount: u32,
    current_ts_ms: u64,
) -> Option<SkillUpdateResult> {
    let skill = get_skill_mut(skills, skill_name)?;

    let old_level = SkillLevel::from_xp(skill.xp);
    skill.xp = skill.xp.saturating_add(xp_amount);
    skill.times_used = skill.times_used.saturating_add(1);
    skill.last_used_ts_ms = current_ts_ms;

    let new_level = SkillLevel::from_xp(skill.xp);
    skill.level = new_level.as_u8();

    Some(SkillUpdateResult {
        skill_name: leak_skill_name(skill_name),
        old_level,
        new_level,
        xp_gained: xp_amount,
        new_xp: skill.xp,
        leveled_up: new_level > old_level,
    })
}

/// Get mutable reference to a skill by name
fn get_skill_mut<'a>(skills: &'a mut SkillSet, name: &str) -> Option<&'a mut Skill> {
    match name {
        "combat_melee" => Some(&mut skills.combat_melee),
        "combat_ranged" => Some(&mut skills.combat_ranged),
        "combat_defense" => Some(&mut skills.combat_defense),
        "combat_tactics" => Some(&mut skills.combat_tactics),

        "crafting_blacksmithing" => Some(&mut skills.crafting_blacksmithing),
        "crafting_cooking" => Some(&mut skills.crafting_cooking),
        "crafting_building" => Some(&mut skills.crafting_building),
        "crafting_tailoring" => Some(&mut skills.crafting_tailoring),
        "crafting_alchemy" => Some(&mut skills.crafting_alchemy),

        "social_persuasion" => Some(&mut skills.social_persuasion),
        "social_intimidation" => Some(&mut skills.social_intimidation),
        "social_diplomacy" => Some(&mut skills.social_diplomacy),
        "social_leadership" => Some(&mut skills.social_leadership),

        "survival_foraging" => Some(&mut skills.survival_foraging),
        "survival_tracking" => Some(&mut skills.survival_tracking),
        "survival_navigation" => Some(&mut skills.survival_navigation),
        "survival_camping" => Some(&mut skills.survival_camping),
        "survival_first_aid" => Some(&mut skills.survival_first_aid),

        "knowledge_lore" => Some(&mut skills.knowledge_lore),
        "knowledge_herbalism" => Some(&mut skills.knowledge_herbalism),
        "knowledge_bestiary" => Some(&mut skills.knowledge_bestiary),
        "knowledge_geography" => Some(&mut skills.knowledge_geography),

        "trade_appraisal" => Some(&mut skills.trade_appraisal),
        "trade_bargaining" => Some(&mut skills.trade_bargaining),
        "trade_accounting" => Some(&mut skills.trade_accounting),
        "trade_networking" => Some(&mut skills.trade_networking),

        _ => None,
    }
}

/// Get immutable reference to a skill by name
pub fn get_skill<'a>(skills: &'a SkillSet, name: &str) -> Option<&'a Skill> {
    match name {
        "combat_melee" => Some(&skills.combat_melee),
        "combat_ranged" => Some(&skills.combat_ranged),
        "combat_defense" => Some(&skills.combat_defense),
        "combat_tactics" => Some(&skills.combat_tactics),

        "crafting_blacksmithing" => Some(&skills.crafting_blacksmithing),
        "crafting_cooking" => Some(&skills.crafting_cooking),
        "crafting_building" => Some(&skills.crafting_building),
        "crafting_tailoring" => Some(&skills.crafting_tailoring),
        "crafting_alchemy" => Some(&skills.crafting_alchemy),

        "social_persuasion" => Some(&skills.social_persuasion),
        "social_intimidation" => Some(&skills.social_intimidation),
        "social_diplomacy" => Some(&skills.social_diplomacy),
        "social_leadership" => Some(&skills.social_leadership),

        "survival_foraging" => Some(&skills.survival_foraging),
        "survival_tracking" => Some(&skills.survival_tracking),
        "survival_navigation" => Some(&skills.survival_navigation),
        "survival_camping" => Some(&skills.survival_camping),
        "survival_first_aid" => Some(&skills.survival_first_aid),

        "knowledge_lore" => Some(&skills.knowledge_lore),
        "knowledge_herbalism" => Some(&skills.knowledge_herbalism),
        "knowledge_bestiary" => Some(&skills.knowledge_bestiary),
        "knowledge_geography" => Some(&skills.knowledge_geography),

        "trade_appraisal" => Some(&skills.trade_appraisal),
        "trade_bargaining" => Some(&skills.trade_bargaining),
        "trade_accounting" => Some(&skills.trade_accounting),
        "trade_networking" => Some(&skills.trade_networking),

        _ => None,
    }
}

// Helper to convert &str to &'static str for return values
fn leak_skill_name(name: &str) -> &'static str {
    match name {
        "combat_melee" => "combat_melee",
        "combat_ranged" => "combat_ranged",
        "combat_defense" => "combat_defense",
        "combat_tactics" => "combat_tactics",
        "crafting_blacksmithing" => "crafting_blacksmithing",
        "crafting_cooking" => "crafting_cooking",
        "crafting_building" => "crafting_building",
        "crafting_tailoring" => "crafting_tailoring",
        "crafting_alchemy" => "crafting_alchemy",
        "social_persuasion" => "social_persuasion",
        "social_intimidation" => "social_intimidation",
        "social_diplomacy" => "social_diplomacy",
        "social_leadership" => "social_leadership",
        "survival_foraging" => "survival_foraging",
        "survival_tracking" => "survival_tracking",
        "survival_navigation" => "survival_navigation",
        "survival_camping" => "survival_camping",
        "survival_first_aid" => "survival_first_aid",
        "knowledge_lore" => "knowledge_lore",
        "knowledge_herbalism" => "knowledge_herbalism",
        "knowledge_bestiary" => "knowledge_bestiary",
        "knowledge_geography" => "knowledge_geography",
        "trade_appraisal" => "trade_appraisal",
        "trade_bargaining" => "trade_bargaining",
        "trade_accounting" => "trade_accounting",
        "trade_networking" => "trade_networking",
        _ => "unknown",
    }
}

// =============================================================================
// Skill-Based Bonuses
// =============================================================================

/// Get action success bonus based on skill level (0.0 to 0.5)
#[must_use]
pub fn get_skill_success_bonus(skill_level: SkillLevel) -> f32 {
    match skill_level {
        SkillLevel::Novice => 0.0,
        SkillLevel::Apprentice => 0.1,
        SkillLevel::Journeyman => 0.2,
        SkillLevel::Expert => 0.35,
        SkillLevel::Master => 0.5,
    }
}

/// Get action speed bonus based on skill level (1.0 to 1.5)
#[must_use]
pub fn get_skill_speed_bonus(skill_level: SkillLevel) -> f32 {
    match skill_level {
        SkillLevel::Novice => 1.0,
        SkillLevel::Apprentice => 1.1,
        SkillLevel::Journeyman => 1.2,
        SkillLevel::Expert => 1.35,
        SkillLevel::Master => 1.5,
    }
}

/// Get utility bonus for work/trade based on relevant skill level
#[must_use]
pub fn get_skill_utility_bonus(skill_level: SkillLevel) -> f32 {
    match skill_level {
        SkillLevel::Novice => 0.0,
        SkillLevel::Apprentice => 0.05,
        SkillLevel::Journeyman => 0.1,
        SkillLevel::Expert => 0.15,
        SkillLevel::Master => 0.25,
    }
}

// =============================================================================
// Skill Decay
// =============================================================================

/// Apply skill decay for unused skills (called periodically)
pub fn decay_unused_skills(
    skills: &mut SkillSet,
    current_tick: u64,
    ticks_per_decay: u64,
) {
    let grace_ticks = SKILL_DECAY_GRACE_TICKS;

    // Decay each skill category
    decay_skill(&mut skills.combat_melee, current_tick, grace_ticks, ticks_per_decay);
    decay_skill(&mut skills.combat_ranged, current_tick, grace_ticks, ticks_per_decay);
    decay_skill(&mut skills.combat_defense, current_tick, grace_ticks, ticks_per_decay);
    decay_skill(&mut skills.combat_tactics, current_tick, grace_ticks, ticks_per_decay);

    decay_skill(&mut skills.crafting_blacksmithing, current_tick, grace_ticks, ticks_per_decay);
    decay_skill(&mut skills.crafting_cooking, current_tick, grace_ticks, ticks_per_decay);
    decay_skill(&mut skills.crafting_building, current_tick, grace_ticks, ticks_per_decay);
    decay_skill(&mut skills.crafting_tailoring, current_tick, grace_ticks, ticks_per_decay);
    decay_skill(&mut skills.crafting_alchemy, current_tick, grace_ticks, ticks_per_decay);

    decay_skill(&mut skills.social_persuasion, current_tick, grace_ticks, ticks_per_decay);
    decay_skill(&mut skills.social_intimidation, current_tick, grace_ticks, ticks_per_decay);
    decay_skill(&mut skills.social_diplomacy, current_tick, grace_ticks, ticks_per_decay);
    decay_skill(&mut skills.social_leadership, current_tick, grace_ticks, ticks_per_decay);

    decay_skill(&mut skills.survival_foraging, current_tick, grace_ticks, ticks_per_decay);
    decay_skill(&mut skills.survival_tracking, current_tick, grace_ticks, ticks_per_decay);
    decay_skill(&mut skills.survival_navigation, current_tick, grace_ticks, ticks_per_decay);
    decay_skill(&mut skills.survival_camping, current_tick, grace_ticks, ticks_per_decay);
    decay_skill(&mut skills.survival_first_aid, current_tick, grace_ticks, ticks_per_decay);

    decay_skill(&mut skills.knowledge_lore, current_tick, grace_ticks, ticks_per_decay);
    decay_skill(&mut skills.knowledge_herbalism, current_tick, grace_ticks, ticks_per_decay);
    decay_skill(&mut skills.knowledge_bestiary, current_tick, grace_ticks, ticks_per_decay);
    decay_skill(&mut skills.knowledge_geography, current_tick, grace_ticks, ticks_per_decay);

    decay_skill(&mut skills.trade_appraisal, current_tick, grace_ticks, ticks_per_decay);
    decay_skill(&mut skills.trade_bargaining, current_tick, grace_ticks, ticks_per_decay);
    decay_skill(&mut skills.trade_accounting, current_tick, grace_ticks, ticks_per_decay);
    decay_skill(&mut skills.trade_networking, current_tick, grace_ticks, ticks_per_decay);
}

fn decay_skill(skill: &mut Skill, current_tick: u64, grace_ticks: u64, ticks_per_decay: u64) {
    // Convert last_used_ts_ms to tick estimate (rough - 50ms per tick)
    let last_used_tick_estimate = skill.last_used_ts_ms / 50;
    let ticks_since_use = current_tick.saturating_sub(last_used_tick_estimate);

    if ticks_since_use > grace_ticks {
        // Calculate decay cycles since grace period ended
        let decay_ticks = ticks_since_use - grace_ticks;
        let decay_cycles = decay_ticks / ticks_per_decay;

        if decay_cycles > 0 {
            let decay_amount = (decay_cycles as u32 * SKILL_DECAY_RATE).min(skill.xp);
            skill.xp = skill.xp.saturating_sub(decay_amount);

            // Update level if it changed
            let new_level = SkillLevel::from_xp(skill.xp);
            skill.level = new_level.as_u8();
        }
    }
}

// =============================================================================
// Event Logging
// =============================================================================

/// Payload for skill XP gained events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillXpGainedPayload {
    pub npc_id: u64,
    pub skill_name: String,
    pub xp_gained: u32,
    pub new_xp: u32,
    pub action_type: String,
}

/// Payload for skill level up events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillLevelUpPayload {
    pub npc_id: u64,
    pub skill_name: String,
    pub old_level: u8,
    pub new_level: u8,
}

/// Log skill XP gain event
pub fn log_skill_xp_event(
    ctx: &ReducerContext,
    npc_id: u64,
    result: &SkillUpdateResult,
    action: SkillAction,
    tick: u64,
    ts_ms: u64,
) {
    let payload = SkillXpGainedPayload {
        npc_id,
        skill_name: result.skill_name.to_string(),
        xp_gained: result.xp_gained,
        new_xp: result.new_xp,
        action_type: format!("{:?}", action),
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
        event_type: EventType::SkillXpGained as u16,
        payload: serialize_payload(&payload),
    });

    // Log level-up as separate event
    if result.leveled_up {
        let level_payload = SkillLevelUpPayload {
            npc_id,
            skill_name: result.skill_name.to_string(),
            old_level: result.old_level.as_u8(),
            new_level: result.new_level.as_u8(),
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
            event_type: EventType::SkillLevelUp as u16,
            payload: serialize_payload(&level_payload),
        });
    }
}

// =============================================================================
// Integration Functions
// =============================================================================

/// Process a skill action for an NPC (main entry point)
/// Returns true if the skill was successfully updated
pub fn process_skill_action(
    ctx: &ReducerContext,
    npc_id: u64,
    action: SkillAction,
    difficulty: ActionDifficulty,
    success: ActionSuccess,
    current_tick: u64,
    current_ts_ms: u64,
) -> bool {
    // Get NPC skills from database
    let Some(mut npc_skills_row) = ctx.db.npc_skills().npc_id().find(npc_id) else {
        return false;
    };

    // Deserialize skills and talents
    let Ok(mut skills): Result<SkillSet, _> = serde_json::from_slice(&npc_skills_row.skills_json) else {
        return false;
    };

    let Ok(talents): Result<NaturalTalents, _> = serde_json::from_slice(&npc_skills_row.talents_json) else {
        return false;
    };

    // Calculate XP with talent modifier
    let skill_name = action.skill_name();
    let talent_mod = get_talent_modifier(&talents, skill_name);
    let xp_gain = calculate_xp_gain(action, difficulty, success, talent_mod);

    // Apply XP to skill
    if let Some(result) = apply_xp_to_skill(&mut skills, skill_name, xp_gain, current_ts_ms) {
        // Log the event
        log_skill_xp_event(ctx, npc_id, &result, action, current_tick, current_ts_ms);

        // Serialize and update database
        if let Ok(skills_json) = serde_json::to_vec(&skills) {
            npc_skills_row.skills_json = skills_json;
            npc_skills_row.updated_ts_ms = current_ts_ms;
            npc_skills_row.version = npc_skills_row.version.saturating_add(1);
            ctx.db.npc_skills().npc_id().update(npc_skills_row);
            return true;
        }
    }

    false
}

/// Get the primary skill level for an NPC's archetype
pub fn get_archetype_primary_skill_level(
    skills: &SkillSet,
    archetype_id: u32,
) -> SkillLevel {
    let skill = match archetype_id {
        1 => &skills.trade_bargaining, // Merchant
        2 => &skills.combat_melee,     // Guard
        3 => &skills.crafting_blacksmithing, // Blacksmith
        4 => &skills.crafting_cooking, // Innkeeper
        5 => &skills.knowledge_lore,   // Scholar
        6 => &skills.survival_foraging, // Farmer
        7 => &skills.combat_ranged,    // Hunter
        8 => &skills.crafting_alchemy, // Healer
        _ => return SkillLevel::Novice,
    };

    SkillLevel::from_xp(skill.xp)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_xp_calculation() {
        let xp = calculate_xp_gain(
            SkillAction::SmithItem,
            ActionDifficulty::Normal,
            ActionSuccess::Normal,
            1.0,
        );
        assert_eq!(xp, 25); // base_xp for SmithItem is 25

        let xp = calculate_xp_gain(
            SkillAction::SmithItem,
            ActionDifficulty::Hard,
            ActionSuccess::Great,
            1.5,
        );
        // 25 * 1.5 (hard) * 1.25 (great) * 1.5 (talent) = 70.3125 -> 70
        assert_eq!(xp, 70);
    }

    #[test]
    fn test_skill_level_from_xp() {
        assert_eq!(SkillLevel::from_xp(0), SkillLevel::Novice);
        assert_eq!(SkillLevel::from_xp(99), SkillLevel::Novice);
        assert_eq!(SkillLevel::from_xp(100), SkillLevel::Apprentice);
        assert_eq!(SkillLevel::from_xp(500), SkillLevel::Journeyman);
        assert_eq!(SkillLevel::from_xp(1500), SkillLevel::Expert);
        assert_eq!(SkillLevel::from_xp(4000), SkillLevel::Master);
    }
}
