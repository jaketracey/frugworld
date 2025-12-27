//! Life Events System
//!
//! Detects and processes major life events that permanently shape NPCs.
//! Life events affect personality traits, create traumas or phobias,
//! and form lasting memories.

use crate::{
    event_types::{EventType, serialize_payload},
    memory::{
        Fear, FearType, LifeEvent, LifeEventType,
        NpcMemoryState, TraumaEffect, TraumaTrigger,
    },
    EventLog,
    // Table accessor traits
    event_log,
};
use serde::{Deserialize, Serialize};
use spacetimedb::{ReducerContext, Table};

// =============================================================================
// Constants
// =============================================================================

/// Threshold for near-death experience (health percentage)
const NEAR_DEATH_THRESHOLD: u8 = 10;

/// Minimum affinity loss for betrayal
const BETRAYAL_THRESHOLD: i16 = -500;

/// Minimum affinity gain for friendship milestone
const FRIENDSHIP_MILESTONE: i16 = 1000;

/// Minimum skill level for mastery event
const MASTERY_LEVEL: u8 = 4; // Expert level

/// Minimum trade value for significant trade event
const SIGNIFICANT_TRADE_VALUE: u32 = 1000;

// =============================================================================
// Life Event Detection
// =============================================================================

/// Context for detecting life events
pub struct LifeEventContext {
    pub npc_id: u64,
    pub current_tick: u64,
    pub current_health_pct: u8,
    pub previous_health_pct: u8,
}

/// Possible life event that was detected
pub struct DetectedLifeEvent {
    pub event_type: LifeEventType,
    pub emotional_impact: i8,
    pub related_entity: Option<u64>,
    pub trait_effects: Vec<(String, i8)>,
}

/// Detect if a near-death experience occurred
pub fn detect_near_death(
    current_health_pct: u8,
    previous_health_pct: u8,
) -> Option<DetectedLifeEvent> {
    if current_health_pct <= NEAR_DEATH_THRESHOLD && previous_health_pct > NEAR_DEATH_THRESHOLD {
        Some(DetectedLifeEvent {
            event_type: LifeEventType::NearDeath,
            emotional_impact: -80,
            related_entity: None,
            trait_effects: vec![
                ("courage".to_string(), -10),
                ("fatalism".to_string(), 5),
                ("appreciation".to_string(), 10),
            ],
        })
    } else {
        None
    }
}

/// Detect if a betrayal occurred (trust drop)
pub fn detect_betrayal(
    entity_id: u64,
    old_trust: i16,
    new_trust: i16,
) -> Option<DetectedLifeEvent> {
    let trust_drop = old_trust - new_trust;
    if trust_drop >= BETRAYAL_THRESHOLD.unsigned_abs() as i16 {
        Some(DetectedLifeEvent {
            event_type: LifeEventType::Betrayal,
            emotional_impact: -70,
            related_entity: Some(entity_id),
            trait_effects: vec![
                ("trust".to_string(), -20),
                ("cynicism".to_string(), 15),
            ],
        })
    } else {
        None
    }
}

/// Detect if rescue occurred (health restored by another)
pub fn detect_rescue(
    current_health_pct: u8,
    previous_health_pct: u8,
    healer_id: u64,
) -> Option<DetectedLifeEvent> {
    // If health was critical and significantly restored
    if previous_health_pct <= NEAR_DEATH_THRESHOLD && current_health_pct > 50 {
        Some(DetectedLifeEvent {
            event_type: LifeEventType::Rescue,
            emotional_impact: 80,
            related_entity: Some(healer_id),
            trait_effects: vec![
                ("gratitude".to_string(), 20),
                ("loyalty".to_string(), 10),
            ],
        })
    } else {
        None
    }
}

/// Detect friendship milestone
pub fn detect_friendship_milestone(
    entity_id: u64,
    old_affinity: i16,
    new_affinity: i16,
) -> Option<DetectedLifeEvent> {
    if new_affinity >= FRIENDSHIP_MILESTONE && old_affinity < FRIENDSHIP_MILESTONE {
        Some(DetectedLifeEvent {
            event_type: LifeEventType::Friendship,
            emotional_impact: 60,
            related_entity: Some(entity_id),
            trait_effects: vec![
                ("sociability".to_string(), 5),
                ("happiness".to_string(), 10),
            ],
        })
    } else {
        None
    }
}

/// Detect skill mastery
pub fn detect_mastery(
    skill_name: &str,
    old_level: u8,
    new_level: u8,
) -> Option<DetectedLifeEvent> {
    if new_level >= MASTERY_LEVEL && old_level < MASTERY_LEVEL {
        Some(DetectedLifeEvent {
            event_type: LifeEventType::Mastery,
            emotional_impact: 70,
            related_entity: None,
            trait_effects: vec![
                ("confidence".to_string(), 15),
                ("pride".to_string(), 10),
            ],
        })
    } else {
        None
    }
}

/// Detect major achievement
pub fn detect_achievement(achievement_type: &str, value: u32) -> Option<DetectedLifeEvent> {
    let (emotional_impact, trait_effects) = match achievement_type {
        "trade_profit" if value >= SIGNIFICANT_TRADE_VALUE => {
            (50, vec![
                ("ambition".to_string(), 5),
                ("confidence".to_string(), 5),
            ])
        }
        "discovery" => {
            (60, vec![
                ("curiosity".to_string(), 10),
                ("adventurousness".to_string(), 5),
            ])
        }
        _ => return None,
    };

    Some(DetectedLifeEvent {
        event_type: LifeEventType::Achievement,
        emotional_impact,
        related_entity: None,
        trait_effects,
    })
}

/// Detect major failure
pub fn detect_failure(failure_type: &str, severity: u8) -> Option<DetectedLifeEvent> {
    if severity < 50 {
        return None;
    }

    let (emotional_impact, trait_effects) = match failure_type {
        "trade_loss" => {
            (-50, vec![
                ("caution".to_string(), 10),
                ("confidence".to_string(), -10),
            ])
        }
        "combat_defeat" => {
            (-60, vec![
                ("humility".to_string(), 5),
                ("aggression".to_string(), -5),
            ])
        }
        _ => return None,
    };

    Some(DetectedLifeEvent {
        event_type: LifeEventType::Failure,
        emotional_impact,
        related_entity: None,
        trait_effects,
    })
}

/// Detect loss of important entity
pub fn detect_loss(entity_id: u64, relationship_strength: i16) -> Option<DetectedLifeEvent> {
    if relationship_strength < 500 {
        return None; // Not significant enough
    }

    Some(DetectedLifeEvent {
        event_type: LifeEventType::Loss,
        emotional_impact: -90,
        related_entity: Some(entity_id),
        trait_effects: vec![
            ("melancholy".to_string(), 20),
            ("empathy".to_string(), 10),
            ("attachment".to_string(), -15),
        ],
    })
}

// =============================================================================
// Life Event Processing
// =============================================================================

/// Process a detected life event and update NPC memory state
pub fn process_life_event(
    memory_state: &mut NpcMemoryState,
    detected: DetectedLifeEvent,
    current_tick: u64,
) -> LifeEvent {
    let life_event = LifeEvent {
        tick: current_tick,
        event_type: detected.event_type,
        emotional_impact: detected.emotional_impact,
        related_entity: detected.related_entity,
        trait_effects: detected.trait_effects.clone(),
        resolved: false,
    };

    // Add trauma if negative impact is severe
    if detected.emotional_impact <= -60 {
        let trauma = TraumaEffect {
            source_event_tick: current_tick,
            trigger: if detected.related_entity.is_some() {
                TraumaTrigger::Entity
            } else {
                TraumaTrigger::Activity
            },
            severity: (-detected.emotional_impact) as u8,
            healing_progress: 0,
        };
        memory_state.emotional_state.trauma_effects.push(trauma);
    }

    // Add fear for certain events
    if matches!(detected.event_type, LifeEventType::NearDeath | LifeEventType::Betrayal) {
        let fear = Fear {
            fear_type: match detected.event_type {
                LifeEventType::NearDeath => FearType::Combat,
                LifeEventType::Betrayal => FearType::Entity,
                _ => FearType::Activity,
            },
            target_id: detected.related_entity,
            intensity: ((-detected.emotional_impact).max(0) as u8).min(80),
            times_faced: 0,
        };
        memory_state.emotional_state.fears.push(fear);
    }

    // Update emotional momentum
    if detected.emotional_impact > 0 {
        memory_state.emotional_state.positive_momentum =
            memory_state.emotional_state.positive_momentum.saturating_add(detected.emotional_impact as u8);
    } else {
        memory_state.emotional_state.negative_momentum =
            memory_state.emotional_state.negative_momentum.saturating_add((-detected.emotional_impact) as u8);
    }

    // Add to life events (permanent)
    memory_state.life_events.push(life_event.clone());

    // Trim if too many life events (keep most impactful)
    if memory_state.life_events.len() > 30 {
        memory_state.life_events.sort_by(|a, b| {
            b.emotional_impact.abs().cmp(&a.emotional_impact.abs())
        });
        memory_state.life_events.truncate(30);
    }

    life_event
}

// =============================================================================
// Fear Facing and Trauma Healing
// =============================================================================

/// Process facing a fear (successful exposure)
pub fn face_fear(memory_state: &mut NpcMemoryState, fear_type: FearType, target_id: Option<u64>) {
    for fear in &mut memory_state.emotional_state.fears {
        let matches = fear.fear_type == fear_type
            && (target_id.is_none() || fear.target_id == target_id);

        if matches {
            fear.times_faced = fear.times_faced.saturating_add(1);

            // Reduce intensity with repeated exposure
            let reduction = (fear.times_faced as u8).min(10);
            fear.intensity = fear.intensity.saturating_sub(reduction);
        }
    }

    // Remove fully overcome fears
    memory_state.emotional_state.fears.retain(|f| f.intensity > 5);
}

/// Process trauma healing (positive experience)
pub fn heal_trauma(memory_state: &mut NpcMemoryState, related_entity: Option<u64>) {
    for trauma in &mut memory_state.emotional_state.trauma_effects {
        let applies = match trauma.trigger {
            TraumaTrigger::Entity => related_entity.is_some(),
            _ => true,
        };

        if applies {
            // Positive experiences heal trauma
            trauma.healing_progress = trauma.healing_progress.saturating_add(10).min(100);
        }
    }
}

// =============================================================================
// Life Stage Transitions
// =============================================================================

/// Life stages for goal evolution
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LifeStage {
    Youth,
    Adult,
    Mature,
    Elder,
}

impl LifeStage {
    /// Get life stage from NPC age (in ticks)
    pub fn from_age_ticks(age_ticks: u64) -> Self {
        // 1 game day = 28800 ticks = 24 minutes real time
        // ~100 game days = youth (40 hours real time)
        // ~300 game days = adult (120 hours)
        // ~600 game days = mature (240 hours)
        // 600+ game days = elder
        let game_days = age_ticks / 28800;

        if game_days < 100 {
            Self::Youth
        } else if game_days < 300 {
            Self::Adult
        } else if game_days < 600 {
            Self::Mature
        } else {
            Self::Elder
        }
    }

    /// Get typical goals for this life stage
    #[must_use]
    pub fn typical_goals(&self) -> Vec<&'static str> {
        match self {
            Self::Youth => vec![
                "learn_skills",
                "make_friends",
                "explore",
                "find_mentor",
            ],
            Self::Adult => vec![
                "accumulate_wealth",
                "master_craft",
                "build_reputation",
                "find_home",
            ],
            Self::Mature => vec![
                "mentor_others",
                "leave_legacy",
                "protect_community",
                "enjoy_life",
            ],
            Self::Elder => vec![
                "share_wisdom",
                "find_peace",
                "preserve_memories",
                "support_youth",
            ],
        }
    }
}

// =============================================================================
// Event Logging
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifeEventLogPayload {
    pub npc_id: u64,
    pub event_type: u8,
    pub emotional_impact: i8,
    pub related_entity: Option<u64>,
}

/// Log a life event
pub fn log_life_event(
    ctx: &ReducerContext,
    npc_id: u64,
    event: &LifeEvent,
    tick: u64,
    ts_ms: u64,
) {
    let payload = LifeEventLogPayload {
        npc_id,
        event_type: event.event_type as u8,
        emotional_impact: event.emotional_impact,
        related_entity: event.related_entity,
    };

    let _ = ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick,
        zone_id: 0,
        chunk_x: 0,
        chunk_y: 0,
        actor_id: Some(npc_id),
        target_id: event.related_entity,
        event_type: EventType::LifeEventOccurred as u16,
        payload: serialize_payload(&payload),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_near_death_detection() {
        let event = detect_near_death(5, 50);
        assert!(event.is_some());

        let event = event.unwrap();
        assert_eq!(event.event_type, LifeEventType::NearDeath);
        assert!(event.emotional_impact < 0);

        // No near death if health was already low
        assert!(detect_near_death(5, 8).is_none());
    }

    #[test]
    fn test_life_stage() {
        assert_eq!(LifeStage::from_age_ticks(0), LifeStage::Youth);
        assert_eq!(LifeStage::from_age_ticks(28800 * 150), LifeStage::Adult);
        assert_eq!(LifeStage::from_age_ticks(28800 * 450), LifeStage::Mature);
        assert_eq!(LifeStage::from_age_ticks(28800 * 700), LifeStage::Elder);
    }

    #[test]
    fn test_fear_facing() {
        let mut state = NpcMemoryState::default();
        state.emotional_state.fears.push(Fear {
            fear_type: FearType::Combat,
            target_id: None,
            intensity: 50,
            times_faced: 0,
        });

        face_fear(&mut state, FearType::Combat, None);

        assert_eq!(state.emotional_state.fears[0].times_faced, 1);
        assert!(state.emotional_state.fears[0].intensity < 50);
    }
}
