//! NPC Memory System
//!
//! Implements episodic and semantic memory for NPCs.
//! Memories influence behavior, personality evolution, and social interactions.

use crate::{
    event_types::{EventType, serialize_payload},
    EventLog,
    // Table accessor traits
    event_log,
};
use serde::{Deserialize, Serialize};
use spacetimedb::{ReducerContext, Table};

// =============================================================================
// Constants
// =============================================================================

/// Maximum episodic memories to keep
const MAX_EPISODIC_MEMORIES: usize = 50;

/// Maximum semantic memories to keep
const MAX_SEMANTIC_MEMORIES: usize = 100;

/// Maximum life events to keep
const MAX_LIFE_EVENTS: usize = 30;

/// Memory importance threshold for consolidation
const CONSOLIDATION_THRESHOLD: u8 = 30;

/// Ticks between memory decay passes
const MEMORY_DECAY_INTERVAL_TICKS: u64 = 1200; // 1 minute

/// Base decay rate per interval
const MEMORY_DECAY_RATE: u8 = 5;

// =============================================================================
// Memory Types
// =============================================================================

/// Categories of memories
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MemoryCategory {
    /// Interaction with another entity
    Social,
    /// Acquiring resources or items
    Acquisition,
    /// Combat or threat encounters
    Combat,
    /// Learning or skill improvement
    Learning,
    /// Discovery of new places
    Discovery,
    /// Trade or economic activity
    Economic,
    /// Witnessing an event
    Observation,
    /// Personal achievement
    Achievement,
    /// Personal loss or failure
    Loss,
}

/// Emotional valence of a memory
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EmotionalValence {
    VeryNegative = 0,
    Negative = 1,
    Neutral = 2,
    Positive = 3,
    VeryPositive = 4,
}

impl EmotionalValence {
    /// Convert to modifier for decision-making (-1.0 to 1.0)
    #[must_use]
    pub fn as_modifier(&self) -> f32 {
        match self {
            Self::VeryNegative => -1.0,
            Self::Negative => -0.5,
            Self::Neutral => 0.0,
            Self::Positive => 0.5,
            Self::VeryPositive => 1.0,
        }
    }

    #[must_use]
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::VeryNegative,
            1 => Self::Negative,
            2 => Self::Neutral,
            3 => Self::Positive,
            _ => Self::VeryPositive,
        }
    }
}

/// An episodic memory - a specific event the NPC experienced
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodicMemory {
    /// When this happened (tick)
    pub tick: u64,
    /// Category of the memory
    pub category: MemoryCategory,
    /// Emotional valence (how it felt)
    pub valence: EmotionalValence,
    /// Importance score (0-100, higher = more memorable)
    pub importance: u8,
    /// Subject entity (if any)
    pub subject_id: Option<u64>,
    /// Location where it happened
    pub location: (i32, i32),
    /// Brief description key (for generating text)
    pub description_key: String,
    /// How many times this memory has been recalled
    pub recall_count: u32,
}

/// A semantic memory - a general fact or pattern the NPC has learned
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticMemory {
    /// Category of knowledge
    pub category: MemoryCategory,
    /// What/who this is about (entity ID, 0 for general)
    pub subject_id: u64,
    /// Type of knowledge
    pub knowledge_type: KnowledgeType,
    /// Confidence in this knowledge (0-100)
    pub confidence: u8,
    /// Number of experiences supporting this
    pub experience_count: u32,
    /// Last update tick
    pub last_updated_tick: u64,
}

/// Types of semantic knowledge
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KnowledgeType {
    /// Entity personality/behavior pattern
    Personality,
    /// Entity reliability/trustworthiness
    Trustworthiness,
    /// Entity skill level
    Competence,
    /// Location safety/danger level
    LocationSafety,
    /// Resource availability at location
    ResourceAvailability,
    /// Social status/reputation
    Reputation,
    /// Best time/place for activities
    Routine,
    /// General world knowledge
    Lore,
}

/// Complete memory state for an NPC
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NpcMemoryState {
    /// Recent specific experiences
    pub episodic: Vec<EpisodicMemory>,
    /// Learned facts and patterns
    pub semantic: Vec<SemanticMemory>,
    /// Major life events (never forgotten)
    pub life_events: Vec<LifeEvent>,
    /// Current emotional state influences
    pub emotional_state: EmotionalState,
    /// Last consolidation tick
    pub last_consolidation_tick: u64,
}

/// A major life event that permanently shapes the NPC
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifeEvent {
    /// When this happened
    pub tick: u64,
    /// Type of life event
    pub event_type: LifeEventType,
    /// Emotional impact (-100 to 100)
    pub emotional_impact: i8,
    /// Related entity (if any)
    pub related_entity: Option<u64>,
    /// How this affected personality traits
    pub trait_effects: Vec<(String, i8)>,
    /// Has this trauma been healed/processed?
    pub resolved: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LifeEventType {
    /// Made a new close friend
    Friendship,
    /// Lost someone important
    Loss,
    /// Major achievement
    Achievement,
    /// Serious failure
    Failure,
    /// Near-death experience
    NearDeath,
    /// Betrayal by trusted entity
    Betrayal,
    /// Life was saved by someone
    Rescue,
    /// First mastery of a skill
    Mastery,
    /// Major trade success/failure
    TradeEvent,
    /// Discovery of something rare
    Discovery,
}

/// Current emotional influences from memories
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EmotionalState {
    /// Recent positive experiences (decays)
    pub positive_momentum: u8,
    /// Recent negative experiences (decays)
    pub negative_momentum: u8,
    /// Active trauma effects
    pub trauma_effects: Vec<TraumaEffect>,
    /// Fears (things to avoid)
    pub fears: Vec<Fear>,
}

/// An active trauma affecting behavior
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraumaEffect {
    /// Source event
    pub source_event_tick: u64,
    /// What triggers this trauma
    pub trigger: TraumaTrigger,
    /// Severity (0-100)
    pub severity: u8,
    /// How much it's healed (0-100)
    pub healing_progress: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TraumaTrigger {
    /// Specific entity
    Entity,
    /// Location type
    Location,
    /// Activity type
    Activity,
    /// Time of day
    TimeOfDay,
}

/// A fear that influences behavior
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fear {
    /// What is feared (entity type, location, activity)
    pub fear_type: FearType,
    /// Target ID (if applicable)
    pub target_id: Option<u64>,
    /// Fear intensity (0-100)
    pub intensity: u8,
    /// Times faced successfully
    pub times_faced: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FearType {
    Entity,
    Location,
    Activity,
    Darkness,
    Crowds,
    Heights,
    Combat,
}

// =============================================================================
// Memory Formation
// =============================================================================

/// Create a new episodic memory from an event
pub fn form_episodic_memory(
    category: MemoryCategory,
    valence: EmotionalValence,
    importance: u8,
    subject_id: Option<u64>,
    location: (i32, i32),
    description_key: String,
    tick: u64,
) -> EpisodicMemory {
    EpisodicMemory {
        tick,
        category,
        valence,
        importance,
        subject_id,
        location,
        description_key,
        recall_count: 0,
    }
}

/// Add a memory to an NPC's memory state
pub fn add_episodic_memory(memory_state: &mut NpcMemoryState, memory: EpisodicMemory) {
    // Update emotional momentum
    match memory.valence {
        EmotionalValence::VeryPositive | EmotionalValence::Positive => {
            memory_state.emotional_state.positive_momentum =
                memory_state.emotional_state.positive_momentum.saturating_add(memory.importance / 4);
        }
        EmotionalValence::VeryNegative | EmotionalValence::Negative => {
            memory_state.emotional_state.negative_momentum =
                memory_state.emotional_state.negative_momentum.saturating_add(memory.importance / 4);
        }
        _ => {}
    }

    // Add the memory
    memory_state.episodic.push(memory);

    // Trim if over limit (remove least important)
    if memory_state.episodic.len() > MAX_EPISODIC_MEMORIES {
        memory_state.episodic.sort_by(|a, b| b.importance.cmp(&a.importance));
        memory_state.episodic.truncate(MAX_EPISODIC_MEMORIES);
    }
}

// =============================================================================
// Memory Consolidation
// =============================================================================

/// Consolidate episodic memories into semantic memories
/// Called periodically (e.g., during "sleep" or every N ticks)
pub fn consolidate_memories(memory_state: &mut NpcMemoryState, current_tick: u64) {
    // Group episodic memories by subject and category
    let mut patterns: std::collections::HashMap<(u64, MemoryCategory), Vec<&EpisodicMemory>> =
        std::collections::HashMap::new();

    for mem in &memory_state.episodic {
        let key = (mem.subject_id.unwrap_or(0), mem.category);
        patterns.entry(key).or_default().push(mem);
    }

    // Create or update semantic memories from patterns
    for ((subject_id, category), memories) in patterns {
        if memories.len() < 2 {
            continue; // Need multiple experiences to form pattern
        }

        // Calculate average valence and importance
        let total_valence: i32 = memories.iter().map(|m| m.valence as i32).sum();
        let avg_valence = total_valence / memories.len() as i32;
        let importance: u32 = memories.iter().map(|m| m.importance as u32).sum::<u32>() / memories.len() as u32;

        // Determine knowledge type from category
        let knowledge_type = match category {
            MemoryCategory::Social => KnowledgeType::Personality,
            MemoryCategory::Combat => KnowledgeType::Trustworthiness,
            MemoryCategory::Economic => KnowledgeType::Reputation,
            MemoryCategory::Discovery => KnowledgeType::LocationSafety,
            _ => KnowledgeType::Routine,
        };

        // Find or create semantic memory
        let existing = memory_state.semantic.iter_mut()
            .find(|m| m.subject_id == subject_id && m.category == category);

        if let Some(sem) = existing {
            sem.experience_count = sem.experience_count.saturating_add(memories.len() as u32);
            sem.confidence = (sem.confidence as u32 + importance as u32 / 2).min(100) as u8;
            sem.last_updated_tick = current_tick;
        } else {
            memory_state.semantic.push(SemanticMemory {
                category,
                subject_id,
                knowledge_type,
                confidence: importance as u8,
                experience_count: memories.len() as u32,
                last_updated_tick: current_tick,
            });
        }
    }

    // Trim semantic memories if over limit
    if memory_state.semantic.len() > MAX_SEMANTIC_MEMORIES {
        memory_state.semantic.sort_by(|a, b| b.confidence.cmp(&a.confidence));
        memory_state.semantic.truncate(MAX_SEMANTIC_MEMORIES);
    }

    // Decay episodic memories below consolidation threshold
    memory_state.episodic.retain(|m| {
        m.importance >= CONSOLIDATION_THRESHOLD ||
        current_tick.saturating_sub(m.tick) < 3600 // Keep recent memories
    });

    memory_state.last_consolidation_tick = current_tick;
}

// =============================================================================
// Memory Decay
// =============================================================================

/// Apply decay to memories over time
pub fn decay_memories(memory_state: &mut NpcMemoryState, current_tick: u64) {
    // Decay episodic memory importance
    for mem in &mut memory_state.episodic {
        // More important and more recalled memories decay slower
        let decay_resist = (mem.importance / 20) + (mem.recall_count.min(10) as u8);
        let effective_decay = MEMORY_DECAY_RATE.saturating_sub(decay_resist);
        mem.importance = mem.importance.saturating_sub(effective_decay);
    }

    // Remove completely faded episodic memories
    memory_state.episodic.retain(|m| m.importance > 0);

    // Decay semantic confidence slowly
    for mem in &mut memory_state.semantic {
        if current_tick.saturating_sub(mem.last_updated_tick) > 28800 {
            // Only decay if not recently reinforced
            mem.confidence = mem.confidence.saturating_sub(1);
        }
    }

    // Remove very low confidence semantic memories
    memory_state.semantic.retain(|m| m.confidence > 10);

    // Decay emotional momentum
    memory_state.emotional_state.positive_momentum =
        memory_state.emotional_state.positive_momentum.saturating_sub(1);
    memory_state.emotional_state.negative_momentum =
        memory_state.emotional_state.negative_momentum.saturating_sub(1);

    // Progress trauma healing slightly
    for trauma in &mut memory_state.emotional_state.trauma_effects {
        trauma.healing_progress = trauma.healing_progress.saturating_add(1).min(100);
    }

    // Remove healed traumas
    memory_state.emotional_state.trauma_effects
        .retain(|t| t.healing_progress < 100 || t.severity > 50);
}

// =============================================================================
// Memory Recall
// =============================================================================

/// Recall memories about a specific entity (updates recall counts as side effect)
/// Returns indices of matching memories
pub fn recall_about_entity(memory_state: &mut NpcMemoryState, entity_id: u64) -> Vec<usize> {
    let mut indices = Vec::new();

    // Find matching memories and update them
    for (i, mem) in memory_state.episodic.iter_mut().enumerate() {
        if mem.subject_id == Some(entity_id) {
            indices.push(i);
            mem.recall_count = mem.recall_count.saturating_add(1);
            // Recalling increases importance slightly
            mem.importance = mem.importance.saturating_add(2).min(100);
        }
    }

    indices
}

/// Get memory at specific index (after recall_about_entity)
#[must_use]
pub fn get_memory_at(memory_state: &NpcMemoryState, index: usize) -> Option<&EpisodicMemory> {
    memory_state.episodic.get(index)
}

/// Get overall sentiment about an entity
#[must_use]
pub fn get_entity_sentiment(memory_state: &NpcMemoryState, entity_id: u64) -> f32 {
    let mut total_sentiment = 0.0f32;
    let mut weight_sum = 0.0f32;

    // Check episodic memories
    for mem in &memory_state.episodic {
        if mem.subject_id == Some(entity_id) {
            let weight = mem.importance as f32 / 100.0;
            total_sentiment += mem.valence.as_modifier() * weight;
            weight_sum += weight;
        }
    }

    // Check semantic memories
    for mem in &memory_state.semantic {
        if mem.subject_id == entity_id {
            let weight = mem.confidence as f32 / 100.0 * 0.5; // Semantic memories weigh less
            weight_sum += weight;
            // Semantic doesn't have valence, so we use knowledge type
            if mem.knowledge_type == KnowledgeType::Trustworthiness {
                total_sentiment += (mem.confidence as f32 / 100.0 - 0.5) * 2.0 * weight;
            }
        }
    }

    if weight_sum > 0.0 {
        total_sentiment / weight_sum
    } else {
        0.0 // Neutral if no memories
    }
}

// =============================================================================
// Utility Modifiers from Memory
// =============================================================================

/// Get utility modifier for an action based on memories
#[must_use]
pub fn get_memory_utility_modifier(
    memory_state: &NpcMemoryState,
    action_category: MemoryCategory,
    target_id: Option<u64>,
) -> f32 {
    let mut modifier = 1.0f32;

    // Check emotional momentum
    let emotional_bias = (memory_state.emotional_state.positive_momentum as f32
        - memory_state.emotional_state.negative_momentum as f32) / 100.0;
    modifier += emotional_bias * 0.1;

    // Check for related fears
    for fear in &memory_state.emotional_state.fears {
        let fear_applies = match fear.fear_type {
            FearType::Activity => matches!(action_category, MemoryCategory::Combat),
            FearType::Entity => target_id.is_some() && fear.target_id == target_id,
            _ => false,
        };

        if fear_applies {
            modifier -= fear.intensity as f32 / 200.0; // Up to -0.5 penalty
        }
    }

    // Check for positive memories with target
    if let Some(target) = target_id {
        let sentiment = get_entity_sentiment(memory_state, target);
        modifier += sentiment * 0.2; // Up to ±0.2 based on sentiment
    }

    // Check for active traumas
    for trauma in &memory_state.emotional_state.trauma_effects {
        let applies = match trauma.trigger {
            TraumaTrigger::Activity => matches!(action_category, MemoryCategory::Combat),
            TraumaTrigger::Entity => target_id.is_some(),
            _ => false,
        };

        if applies {
            let trauma_effect = (trauma.severity as f32 * (100 - trauma.healing_progress) as f32) / 10000.0;
            modifier -= trauma_effect; // Up to -0.5 or so
        }
    }

    modifier.clamp(0.3, 2.0)
}

// =============================================================================
// Event Payloads
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryFormedPayload {
    pub npc_id: u64,
    pub category: u8,
    pub valence: u8,
    pub importance: u8,
    pub subject_id: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifeEventPayload {
    pub npc_id: u64,
    pub event_type: u8,
    pub emotional_impact: i8,
    pub related_entity: Option<u64>,
}

// =============================================================================
// Integration
// =============================================================================

/// Log a memory formation event
pub fn log_memory_event(
    ctx: &ReducerContext,
    npc_id: u64,
    memory: &EpisodicMemory,
    tick: u64,
    ts_ms: u64,
) {
    let payload = MemoryFormedPayload {
        npc_id,
        category: memory.category as u8,
        valence: memory.valence as u8,
        importance: memory.importance,
        subject_id: memory.subject_id,
    };

    let _ = ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick,
        zone_id: 0,
        chunk_x: 0,
        chunk_y: 0,
        actor_id: Some(npc_id),
        target_id: memory.subject_id,
        event_type: EventType::MemoryFormed as u16,
        payload: serialize_payload(&payload),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_emotional_valence() {
        assert!(EmotionalValence::VeryPositive.as_modifier() > 0.0);
        assert!(EmotionalValence::VeryNegative.as_modifier() < 0.0);
        assert_eq!(EmotionalValence::Neutral.as_modifier(), 0.0);
    }

    #[test]
    fn test_memory_formation() {
        let mem = form_episodic_memory(
            MemoryCategory::Social,
            EmotionalValence::Positive,
            50,
            Some(123),
            (1000, 2000),
            "met_friend".to_string(),
            100,
        );

        assert_eq!(mem.importance, 50);
        assert_eq!(mem.subject_id, Some(123));
    }

    #[test]
    fn test_memory_decay() {
        let mut state = NpcMemoryState::default();
        state.episodic.push(form_episodic_memory(
            MemoryCategory::Social,
            EmotionalValence::Positive,
            20, // Low importance
            None,
            (0, 0),
            "test".to_string(),
            0,
        ));

        decay_memories(&mut state, 1000);

        // Memory should have decayed
        assert!(state.episodic[0].importance < 20);
    }
}
