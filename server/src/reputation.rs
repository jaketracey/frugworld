//! NPC Reputation System
//!
//! Tracks NPC reputation across multiple domains (trade, combat, social, knowledge)
//! and regions. Reputation affects NPC behavior and how others treat them.

use crate::{
    event_types::{EventType, serialize_payload},
    EventLog, NpcReputation,
    // Table accessor traits
    npc_reputation, event_log,
};
use serde::{Deserialize, Serialize};
use spacetimedb::{ReducerContext, Table};

// =============================================================================
// Constants
// =============================================================================

/// Maximum reputation value
const MAX_REP: i16 = 1000;

/// Minimum reputation value
const MIN_REP: i16 = -1000;

/// Maximum criminal reputation
const MAX_CRIMINAL_REP: u16 = 1000;

/// Reputation decay rate per day (toward neutral)
const DAILY_DECAY_RATE: i16 = 1;

/// Minimum deed impact to record as notable
const NOTABLE_DEED_THRESHOLD: i16 = 50;

/// Maximum notable deeds to track
const MAX_NOTABLE_DEEDS: usize = 20;

/// Radius for local reputation (in chunks)
const LOCAL_REP_RADIUS: i32 = 5;

// =============================================================================
// Reputation Domains
// =============================================================================

/// Reputation domain categories
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReputationDomain {
    /// Trade: merchant reliability, fair dealing, business acumen
    Trade,
    /// Combat: martial prowess, honor in battle, protection of others
    Combat,
    /// Social: likability, trustworthiness, community standing
    Social,
    /// Knowledge: wisdom, teaching, expertise recognition
    Knowledge,
    /// Criminal: notoriety for crimes (always positive, represents infamy)
    Criminal,
}

impl ReputationDomain {
    /// Get display name for domain
    #[must_use]
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Trade => "Trade",
            Self::Combat => "Combat",
            Self::Social => "Social",
            Self::Knowledge => "Knowledge",
            Self::Criminal => "Criminal",
        }
    }

    /// Get actions that affect this domain
    #[must_use]
    pub fn relevant_actions(&self) -> &'static [&'static str] {
        match self {
            Self::Trade => &["trade", "craft", "sell", "buy", "bargain", "cheat"],
            Self::Combat => &["fight", "defend", "attack", "protect", "duel", "flee"],
            Self::Social => &["help", "chat", "befriend", "gossip", "betray", "lie"],
            Self::Knowledge => &["teach", "learn", "advise", "study", "share_knowledge"],
            Self::Criminal => &["steal", "murder", "vandalize", "trespass", "assault"],
        }
    }
}

// =============================================================================
// Notable Deeds
// =============================================================================

/// Type of notable deed
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DeedType {
    // Positive deeds
    HeroicDefense,
    GenerousTrade,
    WiseAdvice,
    SkillfulCraft,
    LifeSaved,
    SharingKnowledge,
    CommunityService,
    FairJustice,

    // Negative deeds
    Betrayal,
    Theft,
    CheatedTrade,
    Cowardice,
    Assault,
    Murder,
    Vandalism,
    SpreadingLies,
}

impl DeedType {
    /// Whether this is a positive deed
    #[must_use]
    pub fn is_positive(&self) -> bool {
        matches!(
            self,
            Self::HeroicDefense
                | Self::GenerousTrade
                | Self::WiseAdvice
                | Self::SkillfulCraft
                | Self::LifeSaved
                | Self::SharingKnowledge
                | Self::CommunityService
                | Self::FairJustice
        )
    }

    /// Get the primary domain this deed affects
    #[must_use]
    pub fn primary_domain(&self) -> ReputationDomain {
        match self {
            Self::HeroicDefense | Self::Cowardice => ReputationDomain::Combat,
            Self::GenerousTrade | Self::CheatedTrade => ReputationDomain::Trade,
            Self::WiseAdvice | Self::SharingKnowledge => ReputationDomain::Knowledge,
            Self::SkillfulCraft => ReputationDomain::Trade,
            Self::LifeSaved | Self::Murder => ReputationDomain::Social,
            Self::CommunityService | Self::Betrayal => ReputationDomain::Social,
            Self::FairJustice | Self::SpreadingLies => ReputationDomain::Social,
            Self::Theft | Self::Assault | Self::Vandalism => ReputationDomain::Criminal,
        }
    }

    /// Get reputation change from this deed
    #[must_use]
    pub fn reputation_impact(&self) -> i16 {
        match self {
            // Major positive
            Self::LifeSaved => 100,
            Self::HeroicDefense => 80,

            // Medium positive
            Self::GenerousTrade => 50,
            Self::WiseAdvice => 40,
            Self::SharingKnowledge => 35,
            Self::CommunityService => 45,
            Self::FairJustice => 60,
            Self::SkillfulCraft => 30,

            // Major negative
            Self::Murder => -200,
            Self::Betrayal => -150,

            // Medium negative
            Self::CheatedTrade => -60,
            Self::Theft => -50,
            Self::Assault => -70,
            Self::SpreadingLies => -40,
            Self::Cowardice => -30,
            Self::Vandalism => -25,
        }
    }
}

/// A notable deed that affected reputation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotableDeed {
    /// When the deed occurred
    pub tick: u64,
    /// Type of deed
    pub deed_type: DeedType,
    /// Chunk where deed occurred
    pub chunk_x: i32,
    pub chunk_y: i32,
    /// Other entity involved (if any)
    pub other_entity: Option<u64>,
    /// Reputation impact
    pub impact: i16,
    /// Number of witnesses
    pub witnesses: u8,
}

/// Collection of notable deeds
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NotableDeeds {
    pub deeds: Vec<NotableDeed>,
}

// =============================================================================
// Regional Reputation
// =============================================================================

/// Regional reputation modifier
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegionalRep {
    /// Center chunk X
    pub chunk_x: i32,
    /// Center chunk Y
    pub chunk_y: i32,
    /// Reputation modifier in this region (-100 to 100)
    pub modifier: i8,
    /// Last update tick
    pub last_update_tick: u64,
}

/// Collection of regional modifiers
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RegionalReputation {
    pub regions: Vec<RegionalRep>,
}

// =============================================================================
// Reputation Level Classification
// =============================================================================

/// Reputation level for display and behavior modification
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReputationLevel {
    Reviled,      // -1000 to -750
    Hated,        // -749 to -500
    Disliked,     // -499 to -250
    Distrusted,   // -249 to -100
    Unknown,      // -99 to 99
    Recognized,   // 100 to 249
    Respected,    // 250 to 499
    Honored,      // 500 to 749
    Renowned,     // 750 to 1000
}

impl ReputationLevel {
    /// Get level from reputation value
    #[must_use]
    pub fn from_value(rep: i16) -> Self {
        match rep {
            -1000..=-750 => Self::Reviled,
            -749..=-500 => Self::Hated,
            -499..=-250 => Self::Disliked,
            -249..=-100 => Self::Distrusted,
            -99..=99 => Self::Unknown,
            100..=249 => Self::Recognized,
            250..=499 => Self::Respected,
            500..=749 => Self::Honored,
            750..=1000 => Self::Renowned,
            _ => Self::Unknown,
        }
    }

    /// Get interaction modifier (multiplier for social interactions)
    #[must_use]
    pub fn interaction_modifier(&self) -> f32 {
        match self {
            Self::Reviled => 0.1,
            Self::Hated => 0.3,
            Self::Disliked => 0.6,
            Self::Distrusted => 0.8,
            Self::Unknown => 1.0,
            Self::Recognized => 1.1,
            Self::Respected => 1.3,
            Self::Honored => 1.5,
            Self::Renowned => 1.8,
        }
    }

    /// Get trade discount/premium (positive = discount, negative = premium)
    #[must_use]
    pub fn trade_modifier(&self) -> i8 {
        match self {
            Self::Reviled => 50,      // 50% premium
            Self::Hated => 30,
            Self::Disliked => 15,
            Self::Distrusted => 5,
            Self::Unknown => 0,
            Self::Recognized => -5,   // 5% discount
            Self::Respected => -10,
            Self::Honored => -15,
            Self::Renowned => -25,
        }
    }
}

// =============================================================================
// Reputation Calculations
// =============================================================================

/// Calculate overall reputation (weighted average across domains)
#[must_use]
pub fn calculate_overall_reputation(
    trade_rep: i16,
    combat_rep: i16,
    social_rep: i16,
    knowledge_rep: i16,
    criminal_rep: u16,
) -> i16 {
    // Weighted average (social is weighted more heavily)
    let positive = (trade_rep as i32 + combat_rep as i32 * 2 + social_rep as i32 * 3 + knowledge_rep as i32) / 7;

    // Criminal reputation always detracts
    let criminal_penalty = (criminal_rep as i32) / 3;

    (positive - criminal_penalty).clamp(MIN_REP as i32, MAX_REP as i32) as i16
}

/// Get effective reputation at a specific location
#[must_use]
pub fn get_local_reputation(
    base_rep: i16,
    local_rep: u8,
    target_chunk_x: i32,
    target_chunk_y: i32,
    home_chunk_x: i32,
    home_chunk_y: i32,
    regional: &RegionalReputation,
) -> i16 {
    let distance_from_home = ((target_chunk_x - home_chunk_x).abs()
        + (target_chunk_y - home_chunk_y).abs()) as f32;

    // Local reputation bonus (higher near home)
    let local_bonus = if distance_from_home <= LOCAL_REP_RADIUS as f32 {
        let falloff = 1.0 - (distance_from_home / LOCAL_REP_RADIUS as f32);
        ((local_rep as f32 - 128.0) * falloff) as i16
    } else {
        0
    };

    // Regional modifier
    let regional_mod = regional
        .regions
        .iter()
        .find(|r| {
            (r.chunk_x - target_chunk_x).abs() <= LOCAL_REP_RADIUS
                && (r.chunk_y - target_chunk_y).abs() <= LOCAL_REP_RADIUS
        })
        .map(|r| r.modifier as i16)
        .unwrap_or(0);

    (base_rep + local_bonus + regional_mod).clamp(MIN_REP, MAX_REP)
}

// =============================================================================
// Reputation Modification
// =============================================================================

/// Apply a reputation change to a specific domain
pub fn apply_reputation_change(
    current: i16,
    change: i16,
    domain: ReputationDomain,
) -> i16 {
    if domain == ReputationDomain::Criminal {
        // Criminal rep only increases, never decreases naturally
        (current as i32 + change.max(0) as i32).clamp(0, MAX_CRIMINAL_REP as i32) as i16
    } else {
        (current as i32 + change as i32).clamp(MIN_REP as i32, MAX_REP as i32) as i16
    }
}

/// Decay reputation toward neutral over time
pub fn decay_reputation(rep: i16) -> i16 {
    if rep > 0 {
        (rep - DAILY_DECAY_RATE).max(0)
    } else if rep < 0 {
        (rep + DAILY_DECAY_RATE).min(0)
    } else {
        0
    }
}

/// Record a notable deed and update reputation
pub fn record_deed(
    notable_deeds: &mut NotableDeeds,
    deed: NotableDeed,
) {
    // Only record if impactful enough
    if deed.impact.abs() >= NOTABLE_DEED_THRESHOLD {
        notable_deeds.deeds.push(deed);

        // Trim to max deeds (keep most recent)
        if notable_deeds.deeds.len() > MAX_NOTABLE_DEEDS {
            notable_deeds.deeds.remove(0);
        }
    }
}

// =============================================================================
// Integration
// =============================================================================

/// Create initial reputation for an NPC
pub fn create_npc_reputation(
    ctx: &ReducerContext,
    npc_id: u64,
    home_chunk_x: i32,
    home_chunk_y: i32,
    archetype_id: u32,
    current_tick: u64,
) -> bool {
    // Starting reputation based on archetype
    let (trade_rep, combat_rep, social_rep, knowledge_rep) = match archetype_id {
        1 => (100, 0, 50, 0),    // Merchant - trade focus
        2 => (0, 100, 50, 0),    // Guard - combat focus
        3 => (75, 0, 25, 25),    // Blacksmith - trade + craft
        4 => (50, 0, 100, 0),    // Innkeeper - social focus
        5 => (0, 0, 50, 100),    // Scholar - knowledge focus
        6 => (50, 0, 75, 0),     // Farmer - trade + social
        7 => (25, 75, 0, 25),    // Hunter - combat + survival
        8 => (0, 0, 100, 75),    // Healer - social + knowledge
        _ => (0, 0, 50, 0),      // Default - slightly social
    };

    let deeds = NotableDeeds::default();
    let regional = RegionalReputation::default();

    let deeds_json = match serde_json::to_vec(&deeds) {
        Ok(j) => j,
        Err(_) => return false,
    };

    let regional_json = match serde_json::to_vec(&regional) {
        Ok(j) => j,
        Err(_) => return false,
    };

    let reputation = NpcReputation {
        npc_id,
        trade_rep,
        combat_rep,
        social_rep,
        knowledge_rep,
        criminal_rep: 0,
        home_chunk_x,
        home_chunk_y,
        local_rep: 128, // Neutral local reputation
        deeds_json,
        regional_json,
        last_update_tick: current_tick,
        version: 1,
    };

    ctx.db.npc_reputation().try_insert(reputation).is_ok()
}

/// Update reputation based on a deed
pub fn update_reputation_from_deed(
    ctx: &ReducerContext,
    npc_id: u64,
    deed_type: DeedType,
    chunk_x: i32,
    chunk_y: i32,
    other_entity: Option<u64>,
    witnesses: u8,
    current_tick: u64,
    ts_ms: u64,
) -> bool {
    let Some(mut rep) = ctx.db.npc_reputation().npc_id().find(npc_id) else {
        return false;
    };

    // Calculate impact (more witnesses = more impact)
    let witness_multiplier = 1.0 + (witnesses as f32 * 0.1).min(2.0);
    let base_impact = deed_type.reputation_impact();
    let impact = (base_impact as f32 * witness_multiplier) as i16;

    // Update domain reputation
    let domain = deed_type.primary_domain();
    match domain {
        ReputationDomain::Trade => {
            rep.trade_rep = apply_reputation_change(rep.trade_rep, impact, domain);
        }
        ReputationDomain::Combat => {
            rep.combat_rep = apply_reputation_change(rep.combat_rep, impact, domain);
        }
        ReputationDomain::Social => {
            rep.social_rep = apply_reputation_change(rep.social_rep, impact, domain);
        }
        ReputationDomain::Knowledge => {
            rep.knowledge_rep = apply_reputation_change(rep.knowledge_rep, impact, domain);
        }
        ReputationDomain::Criminal => {
            rep.criminal_rep = apply_reputation_change(rep.criminal_rep as i16, impact, domain) as u16;
        }
    }

    // Record notable deed
    let mut deeds: NotableDeeds = serde_json::from_slice(&rep.deeds_json).unwrap_or_default();
    let deed = NotableDeed {
        tick: current_tick,
        deed_type,
        chunk_x,
        chunk_y,
        other_entity,
        impact,
        witnesses,
    };
    record_deed(&mut deeds, deed);

    rep.deeds_json = serde_json::to_vec(&deeds).unwrap_or_default();
    rep.last_update_tick = current_tick;
    rep.version = rep.version.wrapping_add(1);

    // Update in database
    ctx.db.npc_reputation().npc_id().update(rep);

    // Log reputation change event
    log_reputation_change(ctx, npc_id, domain, impact, current_tick, ts_ms);

    true
}

/// Update regional reputation
pub fn update_regional_reputation(
    ctx: &ReducerContext,
    npc_id: u64,
    chunk_x: i32,
    chunk_y: i32,
    modifier_change: i8,
    current_tick: u64,
) -> bool {
    let Some(mut rep) = ctx.db.npc_reputation().npc_id().find(npc_id) else {
        return false;
    };

    let mut regional: RegionalReputation = serde_json::from_slice(&rep.regional_json).unwrap_or_default();

    // Find or create regional entry
    if let Some(region) = regional.regions.iter_mut().find(|r| {
        (r.chunk_x - chunk_x).abs() <= LOCAL_REP_RADIUS
            && (r.chunk_y - chunk_y).abs() <= LOCAL_REP_RADIUS
    }) {
        region.modifier = (region.modifier as i16 + modifier_change as i16).clamp(-100, 100) as i8;
        region.last_update_tick = current_tick;
    } else if regional.regions.len() < 10 {
        regional.regions.push(RegionalRep {
            chunk_x,
            chunk_y,
            modifier: modifier_change.clamp(-100, 100),
            last_update_tick: current_tick,
        });
    }

    rep.regional_json = serde_json::to_vec(&regional).unwrap_or_default();
    rep.last_update_tick = current_tick;

    ctx.db.npc_reputation().npc_id().update(rep);
    true
}

/// Get reputation level for interaction purposes
pub fn get_reputation_level(ctx: &ReducerContext, npc_id: u64, domain: ReputationDomain) -> ReputationLevel {
    let Some(rep) = ctx.db.npc_reputation().npc_id().find(npc_id) else {
        return ReputationLevel::Unknown;
    };

    let value = match domain {
        ReputationDomain::Trade => rep.trade_rep,
        ReputationDomain::Combat => rep.combat_rep,
        ReputationDomain::Social => rep.social_rep,
        ReputationDomain::Knowledge => rep.knowledge_rep,
        ReputationDomain::Criminal => -(rep.criminal_rep as i16), // Criminal rep is negative
    };

    ReputationLevel::from_value(value)
}

// =============================================================================
// Event Logging
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReputationChangedPayload {
    pub npc_id: u64,
    pub domain: u8,
    pub change: i16,
    pub new_value: i16,
}

/// Log reputation change event
pub fn log_reputation_change(
    ctx: &ReducerContext,
    npc_id: u64,
    domain: ReputationDomain,
    change: i16,
    tick: u64,
    ts_ms: u64,
) {
    let payload = ReputationChangedPayload {
        npc_id,
        domain: domain as u8,
        change,
        new_value: 0, // Would need to look this up
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
        event_type: EventType::RelationshipUpdated as u16, // Use existing event type
        payload: serialize_payload(&payload),
    });
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_reputation_levels() {
        assert_eq!(ReputationLevel::from_value(-900), ReputationLevel::Reviled);
        assert_eq!(ReputationLevel::from_value(-600), ReputationLevel::Hated);
        assert_eq!(ReputationLevel::from_value(0), ReputationLevel::Unknown);
        assert_eq!(ReputationLevel::from_value(300), ReputationLevel::Respected);
        assert_eq!(ReputationLevel::from_value(800), ReputationLevel::Renowned);
    }

    #[test]
    fn test_overall_reputation() {
        let overall = calculate_overall_reputation(100, 200, 300, 100, 0);
        assert!(overall > 0);

        // Criminal rep should reduce overall
        let with_crime = calculate_overall_reputation(100, 200, 300, 100, 300);
        assert!(with_crime < overall);
    }

    #[test]
    fn test_deed_impact() {
        assert!(DeedType::LifeSaved.is_positive());
        assert!(!DeedType::Murder.is_positive());

        assert!(DeedType::LifeSaved.reputation_impact() > 0);
        assert!(DeedType::Murder.reputation_impact() < 0);
    }

    #[test]
    fn test_apply_reputation_change() {
        let rep = apply_reputation_change(0, 100, ReputationDomain::Trade);
        assert_eq!(rep, 100);

        // Test clamping
        let rep = apply_reputation_change(900, 200, ReputationDomain::Trade);
        assert_eq!(rep, MAX_REP);

        // Criminal only increases
        let rep = apply_reputation_change(100, -50, ReputationDomain::Criminal);
        assert_eq!(rep, 100); // No decrease for criminal
    }

    #[test]
    fn test_decay() {
        let positive = decay_reputation(100);
        assert!(positive < 100);

        let negative = decay_reputation(-100);
        assert!(negative > -100);

        let neutral = decay_reputation(0);
        assert_eq!(neutral, 0);
    }
}
