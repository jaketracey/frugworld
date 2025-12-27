//! Social System
//!
//! Handles NPC-NPC social encounters, gossip spreading, and relationship evolution.
//! NPCs within proximity can interact, share knowledge, and form bonds.

use crate::{
    event_types::{EventType, serialize_payload},
    reward_profile::RewardProfile,
    npc_relationship_types, npc_relationship_flags,
    EntityKind, EventLog, NpcNpcRelationship, Transform,
    POSITION_SCALE,
    // Table accessor traits
    entity, npc_npc_relationship, transform, event_log, npc_reward_profile,
};
use serde::{Deserialize, Serialize};
use spacetimedb::{ReducerContext, Table};

// =============================================================================
// Constants
// =============================================================================

/// Social encounter radius in meters
const ENCOUNTER_RADIUS_M: i32 = 5;

/// Social encounter radius in millimeters (position units)
const ENCOUNTER_RADIUS_MM: i32 = ENCOUNTER_RADIUS_M * POSITION_SCALE;

/// Minimum ticks between social encounters for same pair
const ENCOUNTER_COOLDOWN_TICKS: u64 = 1200; // 1 minute at 20Hz

/// Base affinity gain per positive interaction
const BASE_AFFINITY_GAIN: i16 = 5;

/// Base trust gain per positive interaction
const BASE_TRUST_GAIN: i16 = 2;

/// Affinity threshold for friendship
const FRIENDSHIP_THRESHOLD: i16 = 500;

/// Affinity threshold for close friendship
const CLOSE_FRIENDSHIP_THRESHOLD: i16 = 1500;

/// Affinity threshold for rivals
const RIVALRY_THRESHOLD: i16 = -300;

/// Affinity threshold for enemies
const ENEMY_THRESHOLD: i16 = -1000;

/// Gossip spread probability (0-100)
const GOSSIP_SPREAD_CHANCE: u8 = 30;

// =============================================================================
// Social Encounter Types
// =============================================================================

/// Types of social encounters between NPCs
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EncounterType {
    /// Brief greeting in passing
    Greeting,
    /// Short conversation (1-2 minutes)
    Conversation,
    /// Sharing news/gossip
    GossipShare,
    /// Trading goods or services
    Trade,
    /// Cooperative work
    Cooperation,
    /// Competitive interaction
    Competition,
    /// Helping/healing
    Assistance,
    /// Conflict/argument
    Conflict,
}

impl EncounterType {
    /// Get affinity modifier for this encounter type
    #[must_use]
    pub const fn affinity_modifier(&self) -> i16 {
        match self {
            Self::Greeting => 1,
            Self::Conversation => 3,
            Self::GossipShare => 2,
            Self::Trade => 4,
            Self::Cooperation => 8,
            Self::Competition => -2,
            Self::Assistance => 10,
            Self::Conflict => -15,
        }
    }

    /// Get trust modifier for this encounter type
    #[must_use]
    pub const fn trust_modifier(&self) -> i16 {
        match self {
            Self::Greeting => 0,
            Self::Conversation => 1,
            Self::GossipShare => -1, // Gossips aren't always trusted
            Self::Trade => 2,
            Self::Cooperation => 5,
            Self::Competition => 0,
            Self::Assistance => 8,
            Self::Conflict => -10,
        }
    }

    /// Get skill category this encounter might train
    #[must_use]
    pub const fn related_skill(&self) -> Option<&'static str> {
        match self {
            Self::Greeting | Self::Conversation => Some("social_diplomacy"),
            Self::GossipShare => Some("social_persuasion"),
            Self::Trade => Some("trade_networking"),
            Self::Cooperation => Some("social_leadership"),
            Self::Competition => Some("combat_tactics"),
            Self::Assistance => Some("survival_first_aid"),
            Self::Conflict => Some("social_intimidation"),
        }
    }
}

// =============================================================================
// Gossip/Knowledge System
// =============================================================================

/// A piece of gossip or shared knowledge
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GossipItem {
    /// Subject of the gossip (NPC ID, location, event)
    pub subject_type: GossipSubject,
    /// Subject identifier
    pub subject_id: u64,
    /// The gossip content category
    pub category: GossipCategory,
    /// Reliability score (0-100, decreases as gossip spreads)
    pub reliability: u8,
    /// Number of times this gossip has spread
    pub spread_count: u32,
    /// Original source NPC ID
    pub original_source: u64,
    /// Tick when gossip was created
    pub created_tick: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GossipSubject {
    /// About another NPC
    Npc,
    /// About a player
    Player,
    /// About a location/POI
    Location,
    /// About a world event
    Event,
    /// About a resource or item
    Resource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GossipCategory {
    /// Character trait observation
    Personality,
    /// Skill or ability
    Ability,
    /// Relationship status
    Relationship,
    /// Wealth or possessions
    Wealth,
    /// Deeds or actions taken
    Deed,
    /// Location of something
    Location,
    /// Danger or threat
    Danger,
    /// Opportunity or resource
    Opportunity,
}

/// Shared knowledge between two NPCs
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SharedKnowledge {
    /// Gossip items both NPCs know
    pub gossip: Vec<GossipItem>,
    /// Common interests/topics
    pub common_interests: Vec<String>,
    /// Shared experiences (event IDs)
    pub shared_experiences: Vec<u64>,
}

// =============================================================================
// Social Encounter Processing
// =============================================================================

/// Result of a social encounter
#[derive(Debug, Clone)]
pub struct EncounterResult {
    pub encounter_type: EncounterType,
    pub affinity_change_a: i16,
    pub affinity_change_b: i16,
    pub trust_change_a: i16,
    pub trust_change_b: i16,
    pub gossip_shared: bool,
    pub relationship_milestone: Option<u16>,
}

/// Check if two NPCs are close enough for a social encounter
#[must_use]
pub fn npcs_in_range(t1: &Transform, t2: &Transform) -> bool {
    let dx = (t1.x - t2.x).abs();
    let dy = (t1.y - t2.y).abs();
    let dz = (t1.z - t2.z).abs();

    // Quick check before expensive sqrt
    if dx > ENCOUNTER_RADIUS_MM || dy > ENCOUNTER_RADIUS_MM {
        return false;
    }

    // 2D distance (ignoring z for social interactions)
    let dist_sq = (dx as i64) * (dx as i64) + (dy as i64) * (dy as i64);
    let radius_sq = (ENCOUNTER_RADIUS_MM as i64) * (ENCOUNTER_RADIUS_MM as i64);

    dist_sq <= radius_sq
}

/// Normalize NPC pair IDs so smaller ID is always first
#[must_use]
pub fn normalize_npc_pair(npc_a: u64, npc_b: u64) -> (u64, u64) {
    if npc_a <= npc_b {
        (npc_a, npc_b)
    } else {
        (npc_b, npc_a)
    }
}

/// Determine encounter type based on NPC personalities and relationship
pub fn determine_encounter_type(
    relationship: Option<&NpcNpcRelationship>,
    profile_a: Option<&RewardProfile>,
    profile_b: Option<&RewardProfile>,
    seed: u64,
) -> EncounterType {
    // Use seed for deterministic randomness
    let roll = (seed % 100) as u8;

    // Check existing relationship
    if let Some(rel) = relationship {
        // If they have a grudge, more likely to conflict
        if rel.flags & npc_relationship_flags::ACTIVE_GRUDGE != 0 {
            if roll < 40 {
                return EncounterType::Conflict;
            }
        }

        // If they're friends, more positive encounters
        if rel.relationship_type >= npc_relationship_types::FRIENDS {
            return match roll {
                0..=30 => EncounterType::Conversation,
                31..=50 => EncounterType::GossipShare,
                51..=70 => EncounterType::Cooperation,
                71..=85 => EncounterType::Assistance,
                _ => EncounterType::Greeting,
            };
        }

        // If they're rivals, competitive encounters
        if rel.relationship_type == npc_relationship_types::RIVALS {
            return match roll {
                0..=40 => EncounterType::Competition,
                41..=60 => EncounterType::Conflict,
                _ => EncounterType::Greeting,
            };
        }
    }

    // Default encounter type distribution for acquaintances/strangers
    match roll {
        0..=40 => EncounterType::Greeting,
        41..=60 => EncounterType::Conversation,
        61..=75 => EncounterType::GossipShare,
        76..=85 => EncounterType::Trade,
        86..=95 => EncounterType::Cooperation,
        _ => EncounterType::Competition,
    }
}

/// Process a social encounter between two NPCs
pub fn process_encounter(
    encounter_type: EncounterType,
    relationship: &mut NpcNpcRelationship,
    current_tick: u64,
    personality_compatibility: f32, // 0.5 to 1.5 based on personality match
) -> EncounterResult {
    let affinity_mod = encounter_type.affinity_modifier();
    let trust_mod = encounter_type.trust_modifier();

    // Apply personality compatibility
    let compat_mult = personality_compatibility;

    // Calculate changes (can be asymmetric based on personalities)
    let affinity_change = (affinity_mod as f32 * compat_mult * BASE_AFFINITY_GAIN as f32) as i16;
    let trust_change = (trust_mod as f32 * compat_mult * BASE_TRUST_GAIN as f32) as i16;

    // Apply changes to relationship
    relationship.affinity_a_to_b = relationship.affinity_a_to_b.saturating_add(affinity_change);
    relationship.affinity_b_to_a = relationship.affinity_b_to_a.saturating_add(affinity_change);
    relationship.trust_a_to_b = relationship.trust_a_to_b.saturating_add(trust_change);
    relationship.trust_b_to_a = relationship.trust_b_to_a.saturating_add(trust_change);
    relationship.interaction_count = relationship.interaction_count.saturating_add(1);
    relationship.last_interaction_tick = current_tick;

    // Check for relationship milestones
    let mut milestone = None;
    let avg_affinity = (relationship.affinity_a_to_b + relationship.affinity_b_to_a) / 2;

    let old_type = relationship.relationship_type;

    // Upgrade relationship type based on affinity
    if avg_affinity >= CLOSE_FRIENDSHIP_THRESHOLD as i16 && old_type < npc_relationship_types::CLOSE_FRIENDS {
        relationship.relationship_type = npc_relationship_types::CLOSE_FRIENDS;
        milestone = Some(npc_relationship_types::CLOSE_FRIENDS);
    } else if avg_affinity >= FRIENDSHIP_THRESHOLD as i16 && old_type < npc_relationship_types::FRIENDS {
        relationship.relationship_type = npc_relationship_types::FRIENDS;
        milestone = Some(npc_relationship_types::FRIENDS);
    } else if avg_affinity <= ENEMY_THRESHOLD as i16 && old_type != npc_relationship_types::ENEMIES {
        relationship.relationship_type = npc_relationship_types::ENEMIES;
        relationship.flags |= npc_relationship_flags::ACTIVE_GRUDGE;
        milestone = Some(npc_relationship_types::ENEMIES);
    } else if avg_affinity <= RIVALRY_THRESHOLD as i16 && old_type < npc_relationship_types::RIVALS {
        relationship.relationship_type = npc_relationship_types::RIVALS;
        milestone = Some(npc_relationship_types::RIVALS);
    } else if relationship.interaction_count >= 5 && old_type == npc_relationship_types::STRANGERS {
        relationship.relationship_type = npc_relationship_types::ACQUAINTANCES;
        milestone = Some(npc_relationship_types::ACQUAINTANCES);
    }

    // Update flags based on encounter
    match encounter_type {
        EncounterType::Trade => {
            relationship.flags |= npc_relationship_flags::TRADED;
        }
        EncounterType::Cooperation => {
            relationship.flags |= npc_relationship_flags::COOPERATED;
        }
        EncounterType::Competition => {
            relationship.flags |= npc_relationship_flags::COMPETED;
        }
        EncounterType::Assistance => {
            relationship.flags |= npc_relationship_flags::HEALED;
            // Helping clears grudges
            relationship.flags &= !npc_relationship_flags::ACTIVE_GRUDGE;
        }
        EncounterType::Conflict => {
            relationship.flags |= npc_relationship_flags::FOUGHT;
            relationship.flags |= npc_relationship_flags::ACTIVE_GRUDGE;
        }
        _ => {}
    }

    // Determine if gossip was shared
    let gossip_shared = encounter_type == EncounterType::GossipShare
        || encounter_type == EncounterType::Conversation;

    EncounterResult {
        encounter_type,
        affinity_change_a: affinity_change,
        affinity_change_b: affinity_change,
        trust_change_a: trust_change,
        trust_change_b: trust_change,
        gossip_shared,
        relationship_milestone: milestone,
    }
}

/// Get or create a relationship between two NPCs
pub fn get_or_create_relationship(
    ctx: &ReducerContext,
    npc_a: u64,
    npc_b: u64,
) -> NpcNpcRelationship {
    let (id_a, id_b) = normalize_npc_pair(npc_a, npc_b);

    // Try to find existing relationship
    for rel in ctx.db.npc_npc_relationship().iter() {
        if rel.npc_a_id == id_a && rel.npc_b_id == id_b {
            return rel;
        }
    }

    // Create new relationship
    let new_rel = NpcNpcRelationship {
        id: 0,
        npc_a_id: id_a,
        npc_b_id: id_b,
        affinity_a_to_b: 0,
        affinity_b_to_a: 0,
        trust_a_to_b: 0,
        trust_b_to_a: 0,
        interaction_count: 0,
        last_interaction_tick: 0,
        relationship_type: npc_relationship_types::STRANGERS,
        flags: 0,
        shared_knowledge: Vec::new(),
    };

    // Insert and return
    match ctx.db.npc_npc_relationship().try_insert(new_rel.clone()) {
        Ok(inserted) => inserted,
        Err(_) => new_rel,
    }
}

/// Calculate personality compatibility between two NPCs (0.5 to 1.5)
pub fn calculate_personality_compatibility(
    profile_a: Option<&RewardProfile>,
    profile_b: Option<&RewardProfile>,
) -> f32 {
    let Some(a) = profile_a else { return 1.0 };
    let Some(b) = profile_b else { return 1.0 };

    // Compare social preferences
    let introvert_a = a.social_prefs.introversion;
    let introvert_b = b.social_prefs.introversion;

    // Similar introversion levels = more compatible
    let intro_diff = (introvert_a as i16 - introvert_b as i16).unsigned_abs() as f32;
    let intro_compat = 1.0 - (intro_diff / 200.0); // 0.5 to 1.0

    // Compare work affinities for shared interests
    let shared_interests = {
        let mut count = 0u8;
        if a.work_affinities.crafting > 50 && b.work_affinities.crafting > 50 {
            count += 1;
        }
        if a.work_affinities.trading > 50 && b.work_affinities.trading > 50 {
            count += 1;
        }
        if a.work_affinities.gathering > 50 && b.work_affinities.gathering > 50 {
            count += 1;
        }
        if a.work_affinities.combat > 50 && b.work_affinities.combat > 50 {
            count += 1;
        }
        count as f32 / 4.0 // 0.0 to 1.0
    };

    // Combine factors
    let base = 0.5 + (intro_compat * 0.5) + (shared_interests * 0.5);
    base.clamp(0.5, 1.5)
}

// =============================================================================
// Event Payloads
// =============================================================================

/// Payload for social encounter events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialEncounterPayload {
    pub npc_a_id: u64,
    pub npc_b_id: u64,
    pub encounter_type: u8,
    pub affinity_change: i16,
    pub trust_change: i16,
}

/// Payload for gossip spread events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GossipSpreadPayload {
    pub source_npc_id: u64,
    pub target_npc_id: u64,
    pub subject_type: u8,
    pub subject_id: u64,
    pub category: u8,
}

/// Payload for relationship milestone events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationshipMilestonePayload {
    pub npc_a_id: u64,
    pub npc_b_id: u64,
    pub old_type: u16,
    pub new_type: u16,
}

// =============================================================================
// Social Tick Processing
// =============================================================================

/// Find all NPC pairs in proximity for social encounters (called periodically)
pub fn find_nearby_npc_pairs(ctx: &ReducerContext) -> Vec<(u64, u64)> {
    let mut pairs = Vec::new();

    // Collect all NPCs with their positions
    struct NpcPos {
        id: u64,
        x: i32,
        y: i32,
        z: i32,
    }

    let mut npcs: Vec<NpcPos> = Vec::new();

    // Collect all NPCs with transforms
    for entity in ctx.db.entity().iter() {
        if entity.kind != EntityKind::Npc as u16 {
            continue;
        }

        if let Some(t) = ctx.db.transform().entity_id().find(entity.entity_id) {
            npcs.push(NpcPos {
                id: entity.entity_id,
                x: t.x,
                y: t.y,
                z: t.z,
            });
        }
    }

    // Check all pairs (O(n²) but NPCs are spatially limited)
    for i in 0..npcs.len() {
        for j in (i + 1)..npcs.len() {
            let a = &npcs[i];
            let b = &npcs[j];

            // Quick distance check
            let dx = (a.x - b.x).abs();
            let dy = (a.y - b.y).abs();

            if dx <= ENCOUNTER_RADIUS_MM && dy <= ENCOUNTER_RADIUS_MM {
                let dist_sq = (dx as i64) * (dx as i64) + (dy as i64) * (dy as i64);
                let radius_sq = (ENCOUNTER_RADIUS_MM as i64) * (ENCOUNTER_RADIUS_MM as i64);

                if dist_sq <= radius_sq {
                    pairs.push((a.id, b.id));
                }
            }
        }
    }

    pairs
}

/// Process social encounters for nearby NPCs
pub fn process_social_tick(
    ctx: &ReducerContext,
    current_tick: u64,
    ts_ms: u64,
) {
    let pairs = find_nearby_npc_pairs(ctx);

    for (npc_a, npc_b) in pairs {
        // Get or create relationship
        let mut relationship = get_or_create_relationship(ctx, npc_a, npc_b);

        // Check cooldown
        if current_tick.saturating_sub(relationship.last_interaction_tick) < ENCOUNTER_COOLDOWN_TICKS {
            continue;
        }

        // Get profiles for personality compatibility
        let profile_a = ctx.db.npc_reward_profile().npc_id().find(npc_a)
            .and_then(|p| serde_json::from_slice::<RewardProfile>(&p.profile_json).ok());
        let profile_b = ctx.db.npc_reward_profile().npc_id().find(npc_b)
            .and_then(|p| serde_json::from_slice::<RewardProfile>(&p.profile_json).ok());

        // Determine encounter type
        let seed = current_tick.wrapping_mul(npc_a).wrapping_add(npc_b);
        let encounter_type = determine_encounter_type(
            Some(&relationship),
            profile_a.as_ref(),
            profile_b.as_ref(),
            seed,
        );

        // Calculate compatibility
        let compat = calculate_personality_compatibility(profile_a.as_ref(), profile_b.as_ref());

        // Process the encounter
        let result = process_encounter(encounter_type, &mut relationship, current_tick, compat);

        // Update relationship in database
        ctx.db.npc_npc_relationship().id().update(relationship.clone());

        // Log the encounter event
        let payload = SocialEncounterPayload {
            npc_a_id: npc_a,
            npc_b_id: npc_b,
            encounter_type: encounter_type as u8,
            affinity_change: result.affinity_change_a,
            trust_change: result.trust_change_a,
        };

        let _ = ctx.db.event_log().try_insert(EventLog {
            event_id: 0,
            ts_ms,
            tick: current_tick,
            zone_id: 0,
            chunk_x: 0,
            chunk_y: 0,
            actor_id: Some(npc_a),
            target_id: Some(npc_b),
            event_type: EventType::SocialEncounter as u16,
            payload: serialize_payload(&payload),
        });

        // Log milestone if any
        if let Some(new_type) = result.relationship_milestone {
            let milestone_payload = RelationshipMilestonePayload {
                npc_a_id: npc_a,
                npc_b_id: npc_b,
                old_type: npc_relationship_types::STRANGERS,
                new_type,
            };

            let _ = ctx.db.event_log().try_insert(EventLog {
                event_id: 0,
                ts_ms,
                tick: current_tick,
                zone_id: 0,
                chunk_x: 0,
                chunk_y: 0,
                actor_id: Some(npc_a),
                target_id: Some(npc_b),
                event_type: EventType::RelationshipMilestone as u16,
                payload: serialize_payload(&milestone_payload),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_npc_pair() {
        assert_eq!(normalize_npc_pair(5, 10), (5, 10));
        assert_eq!(normalize_npc_pair(10, 5), (5, 10));
        assert_eq!(normalize_npc_pair(5, 5), (5, 5));
    }

    #[test]
    fn test_npcs_in_range() {
        let t1 = Transform {
            entity_id: 1,
            x: 0,
            y: 0,
            z: 0,
            rotation: 0,
            chunk_x: 0,
            chunk_y: 0,
        };

        let t2 = Transform {
            entity_id: 2,
            x: 3000, // 3 meters
            y: 0,
            z: 0,
            rotation: 0,
            chunk_x: 0,
            chunk_y: 0,
        };

        let t3 = Transform {
            entity_id: 3,
            x: 10000, // 10 meters
            y: 0,
            z: 0,
            rotation: 0,
            chunk_x: 0,
            chunk_y: 0,
        };

        assert!(npcs_in_range(&t1, &t2)); // 3m < 5m radius
        assert!(!npcs_in_range(&t1, &t3)); // 10m > 5m radius
    }

    #[test]
    fn test_encounter_type_modifiers() {
        assert!(EncounterType::Assistance.affinity_modifier() > 0);
        assert!(EncounterType::Conflict.affinity_modifier() < 0);
        assert!(EncounterType::Assistance.trust_modifier() > 0);
        assert!(EncounterType::Conflict.trust_modifier() < 0);
    }
}
