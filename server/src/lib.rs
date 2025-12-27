//! Frugworld SpacetimeDB Server Module
//!
//! A zone-of-influence AI simulator game backend with:
//! - Event-sourced architecture with derived state tables
//! - Multi-resolution NPC simulation (LOD0-LOD3)
//! - Chunked procedural world generation
//! - Interest management for efficient replication
//! - Dialogue system with LLM integration support
//! - Utility-based AI decision making
//! - Blueprint generation for NPC identity

#![warn(clippy::all, clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]
#![allow(clippy::cast_possible_truncation)]
#![allow(clippy::cast_sign_loss)]
#![allow(clippy::too_many_arguments)]

mod admin;
mod ai_system;
mod blueprint;
mod chunk_gen;
mod dialogue;
mod entity_system;
mod event_types;
mod frug_system;
mod interactables;
mod interest;
mod life_events;
mod lod;
mod memory;
mod messaging;
mod personality;
mod relationships;
mod reward_profile;
mod schedule;
mod skills;
mod reputation;
mod social;
mod tick;

pub use admin::*;
pub use ai_system::*;
pub use blueprint::*;
pub use chunk_gen::*;
pub use dialogue::*;
pub use entity_system::*;
pub use event_types::*;
pub use frug_system::*;
pub use interactables::*;
pub use interest::*;
pub use life_events::*;
pub use lod::*;
pub use memory::*;
pub use messaging::*;
pub use personality::*;
pub use relationships::*;
pub use reward_profile::*;
pub use schedule::*;
pub use skills::*;
pub use reputation::*;
pub use social::*;
pub use tick::*;

use spacetimedb::{table, Identity, ReducerContext, Timestamp, Table};

// =============================================================================
// Configuration Constants
// =============================================================================

/// Server tick rate in Hz (ticks per second)
pub const TICK_RATE_HZ: u64 = 20;

/// Chunk size in meters
pub const CHUNK_SIZE_METERS: i32 = 64;

/// World seed for deterministic generation
pub const WORLD_SEED: u64 = 0xF0D6_0123_4567_89AB;

/// Position quantization: millimeters per unit
pub const POSITION_SCALE: i32 = 1000;

// LOD distance thresholds in meters (quantized to millimeters internally)
pub const LOD0_DISTANCE_M: i32 = 15;
pub const LOD1_DISTANCE_M: i32 = 60;
pub const LOD2_DISTANCE_M: i32 = 250;

// =============================================================================
// Section 9.1: Event Log (Append-Only)
// =============================================================================

/// Event log table for event-sourced architecture.
/// All gameplay changes are logged as events with structured payloads.
#[table(name = event_log, public)]
pub struct EventLog {
    /// Unique event identifier (auto-generated)
    #[primary_key]
    #[auto_inc]
    pub event_id: u64,

    /// Timestamp in milliseconds since epoch
    pub ts_ms: u64,

    /// Server tick when event occurred
    pub tick: u64,

    /// Zone identifier (for multi-zone support)
    pub zone_id: u64,

    /// Chunk X coordinate where event occurred
    pub chunk_x: i32,

    /// Chunk Y coordinate where event occurred
    pub chunk_y: i32,

    /// Entity that caused the event (if applicable)
    pub actor_id: Option<u64>,

    /// Target entity of the event (if applicable)
    pub target_id: Option<u64>,

    /// Event type discriminator (see EventType enum)
    #[index(btree)]
    pub event_type: u16,

    /// Serialized event payload (bincode/JSON)
    pub payload: Vec<u8>,
}

// =============================================================================
// Section 9.2: Derived State Tables
// =============================================================================

/// Entity table - core entity registry.
/// Represents all game entities (players, NPCs, props, items).
#[derive(Clone)]
#[table(name = entity, public)]
pub struct Entity {
    /// Unique entity identifier
    #[primary_key]
    pub entity_id: u64,

    /// Entity kind discriminator
    pub kind: u16,

    /// Archetype identifier for prefab/template
    pub archetype_id: u32,

    /// Zone this entity belongs to
    #[index(btree)]
    pub zone_id: u64,

    /// Current chunk X coordinate
    #[index(btree)]
    pub chunk_x: i32,

    /// Current chunk Y coordinate
    #[index(btree)]
    pub chunk_y: i32,

    /// Whether entity is alive/active
    pub alive: bool,
}

/// Entity kinds for the `kind` field
#[repr(u16)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityKind {
    Player = 0,
    Npc = 1,
    Prop = 2,
    Item = 3,
    Vehicle = 4,
    Projectile = 5,
}

impl EntityKind {
    #[must_use]
    pub const fn as_u16(self) -> u16 {
        self as u16
    }

    #[must_use]
    pub const fn from_u16(value: u16) -> Option<Self> {
        match value {
            0 => Some(Self::Player),
            1 => Some(Self::Npc),
            2 => Some(Self::Prop),
            3 => Some(Self::Item),
            4 => Some(Self::Vehicle),
            5 => Some(Self::Projectile),
            _ => None,
        }
    }
}

/// Transform table - spatial state for entities.
/// Positions are quantized to millimeters for network efficiency.
#[table(name = transform, public)]
pub struct Transform {
    /// Entity this transform belongs to
    #[primary_key]
    pub entity_id: u64,

    /// X position (quantized, millimeters)
    pub x: i32,

    /// Y position (quantized, millimeters)
    pub y: i32,

    /// Z position (quantized, millimeters)
    pub z: i32,

    /// Yaw rotation (quantized, degrees * 100)
    pub yaw: i16,

    /// X velocity component (quantized)
    pub vx: i16,

    /// Y velocity component (quantized)
    pub vy: i16,

    /// Z velocity component (quantized)
    pub vz: i16,

    /// Last tick this transform was updated
    pub last_tick: u64,
}

/// Chunk table - generated world chunks.
/// Each chunk is deterministically generated from world seed + coordinates.
#[table(name = chunk, public)]
pub struct Chunk {
    /// Auto-increment primary key
    #[auto_inc]
    #[primary_key]
    pub chunk_id: u64,

    /// Chunk X coordinate
    #[index(btree)]
    pub cx: i32,

    /// Chunk Y coordinate
    #[index(btree)]
    pub cy: i32,

    /// Zone this chunk belongs to
    pub zone_id: u64,

    /// Deterministic seed for this chunk
    pub seed: u64,

    /// Biome type identifier
    pub biome: u16,

    /// Serialized points of interest data
    pub poi_blob: Vec<u8>,
}

/// NPC Blueprint table - persistent NPC identity and personality.
/// Created once per NPC (LLM generation allowed at creation time).
#[table(name = npc_blueprint, public)]
pub struct NpcBlueprint {
    /// NPC entity ID
    #[primary_key]
    pub npc_id: u64,

    /// Serialized blueprint JSON (identity, personality, backstory, etc.)
    pub blueprint_json: Vec<u8>,

    /// Blueprint schema version for migrations
    pub version: u16,

    /// Creation timestamp in milliseconds
    pub created_ts_ms: u64,
}

/// NPC State table - runtime simulation state.
/// Updated frequently based on LOD and simulation needs.
#[table(name = npc_state, public)]
pub struct NpcState {
    /// NPC entity ID
    #[primary_key]
    pub npc_id: u64,

    /// Current LOD state (0-3)
    pub lod_state: u8,

    /// Long-term goal (days/weeks scale)
    pub long_goal: Vec<u8>,

    /// Mid-term goal (hours/day scale)
    pub mid_goal: Vec<u8>,

    /// Short-term intent (seconds/minutes scale)
    pub short_intent: Vec<u8>,

    /// Needs state (hunger, fatigue, safety, social, wealth)
    pub needs: Vec<u8>,

    /// Memory summary (recent events, key facts)
    pub memory_summary: Vec<u8>,

    /// Last replanning timestamp in milliseconds
    pub last_replan_ts_ms: u64,
}

/// NPC Reward Profile table - seed-based preferences and affinities.
/// Generated once per NPC from deterministic seed.
#[table(name = npc_reward_profile, public)]
pub struct NpcRewardProfile {
    /// NPC entity ID
    #[primary_key]
    pub npc_id: u64,

    /// Seed used for profile generation (for reproducibility)
    pub profile_seed: u64,

    /// Serialized RewardProfile JSON (food prefs, work affinities, social prefs, reward weights, goals)
    pub profile_json: Vec<u8>,

    /// Profile schema version for migrations
    pub version: u16,

    /// Creation timestamp in milliseconds
    pub created_ts_ms: u64,
}

/// NPC Skills table - skill levels and progression tracking.
/// Updated as NPCs perform activities.
#[table(name = npc_skills, public)]
pub struct NpcSkills {
    /// NPC entity ID
    #[primary_key]
    pub npc_id: u64,

    /// Serialized SkillSet JSON (all skill categories with XP and levels)
    pub skills_json: Vec<u8>,

    /// Serialized NaturalTalents JSON (learning modifiers, primary talents)
    pub talents_json: Vec<u8>,

    /// Skills schema version for migrations
    pub version: u16,

    /// Last update timestamp in milliseconds
    pub updated_ts_ms: u64,
}

/// Interactable table - world objects that NPCs can interact with.
/// Resources, workstations, buildings, and environmental features.
#[table(name = interactable, public)]
pub struct Interactable {
    /// Unique interactable identifier
    #[primary_key]
    #[auto_inc]
    pub interactable_id: u64,

    /// Chunk X coordinate
    #[index(btree)]
    pub chunk_x: i32,

    /// Chunk Y coordinate
    #[index(btree)]
    pub chunk_y: i32,

    /// Zone identifier
    pub zone_id: u64,

    /// Local X position within chunk (in millimeters)
    pub local_x: i32,

    /// Local Y position within chunk (in millimeters)
    pub local_y: i32,

    /// Interactable type (see InteractableType enum)
    pub itype: u16,

    /// Subtype for variations (e.g., apple_tree vs oak_tree)
    pub subtype: u32,

    /// Current resource amount (for depletable resources)
    pub resource_amount: u16,

    /// Maximum resource capacity
    pub resource_max: u16,

    /// Regeneration rate per tick (0 = no regen)
    pub regen_rate: u8,

    /// Owner NPC ID (for workstations, homes)
    pub owner_id: Option<u64>,

    /// Quality level (0-4)
    pub quality: u8,

    /// State flags (occupied, locked, damaged, etc.)
    pub flags: u32,

    /// Last interaction tick (for cooldowns)
    pub last_interact_tick: u64,
}

/// Relationship table - player-NPC relationship state.
#[derive(Clone)]
#[table(name = relationship, public)]
pub struct Relationship {
    /// Auto-increment primary key
    #[auto_inc]
    #[primary_key]
    pub relationship_id: u64,

    /// Player entity ID
    #[index(btree)]
    pub player_id: u64,

    /// NPC entity ID
    #[index(btree)]
    pub npc_id: u64,

    /// Affinity score (-32768 to 32767)
    pub affinity: i16,

    /// Trust score (-32768 to 32767)
    pub trust: i16,

    /// Relationship flags (bitfield)
    pub flags: u32,

    /// Serialized conversation summary
    pub conversation_summary: Vec<u8>,
}

/// Relationship flags bitfield
pub mod relationship_flags {
    pub const OFFENDED: u32 = 1 << 0;
    pub const OWES_FAVOR: u32 = 1 << 1;
    pub const FRIEND: u32 = 1 << 2;
    pub const HOSTILE: u32 = 1 << 3;
    pub const MET: u32 = 1 << 4;
    pub const TRADED: u32 = 1 << 5;
}

/// NPC Perception table - stores pending perceptions for NPCs to react to.
/// Client subscribes to this to show thought bubbles.
#[table(name = npc_perception, public)]
pub struct NpcPerception {
    /// Auto-increment primary key
    #[auto_inc]
    #[primary_key]
    pub perception_id: u64,

    /// NPC entity ID that perceived the event
    #[index(btree)]
    pub npc_id: u64,

    /// The thought/reaction text to display
    pub thought: String,

    /// Entity that caused the perception (e.g., player who waved)
    pub source_entity_id: u64,

    /// Perception type for categorization
    pub perception_type: String,

    /// When the perception was created (ms since epoch)
    pub created_ts_ms: u64,

    /// When this perception expires (ms since epoch)
    pub expires_ts_ms: u64,
}

// =============================================================================
// NPC-NPC Relationships
// =============================================================================

/// NPC-NPC relationship table for tracking social bonds between NPCs.
#[derive(Clone)]
#[table(name = npc_npc_relationship, public)]
pub struct NpcNpcRelationship {
    /// Auto-increment primary key
    #[auto_inc]
    #[primary_key]
    pub id: u64,

    /// First NPC entity ID (always the smaller ID)
    #[index(btree)]
    pub npc_a_id: u64,

    /// Second NPC entity ID (always the larger ID)
    #[index(btree)]
    pub npc_b_id: u64,

    /// Affinity score from A's perspective (-32768 to 32767)
    pub affinity_a_to_b: i16,

    /// Affinity score from B's perspective
    pub affinity_b_to_a: i16,

    /// Trust score from A's perspective (-32768 to 32767)
    pub trust_a_to_b: i16,

    /// Trust score from B's perspective
    pub trust_b_to_a: i16,

    /// How many times they've interacted
    pub interaction_count: u32,

    /// Last interaction tick
    pub last_interaction_tick: u64,

    /// Relationship type flags (family, friends, rivals, etc.)
    pub relationship_type: u16,

    /// State flags (active grudge, active bond, etc.)
    pub flags: u32,

    /// Shared knowledge/gossip (serialized JSON)
    pub shared_knowledge: Vec<u8>,
}

/// NPC relationship type flags
pub mod npc_relationship_types {
    pub const STRANGERS: u16 = 0;
    pub const ACQUAINTANCES: u16 = 1;
    pub const FRIENDS: u16 = 2;
    pub const CLOSE_FRIENDS: u16 = 3;
    pub const RIVALS: u16 = 4;
    pub const ENEMIES: u16 = 5;
    pub const FAMILY: u16 = 6;
    pub const ROMANTIC: u16 = 7;
    pub const BUSINESS: u16 = 8;
    pub const MENTOR_STUDENT: u16 = 9;
}

/// NPC relationship flags
pub mod npc_relationship_flags {
    pub const ACTIVE_GRUDGE: u32 = 1 << 0;
    pub const OWES_FAVOR: u32 = 1 << 1;
    pub const SHARED_SECRET: u32 = 1 << 2;
    pub const COMPETED: u32 = 1 << 3;
    pub const COOPERATED: u32 = 1 << 4;
    pub const TRADED: u32 = 1 << 5;
    pub const FOUGHT: u32 = 1 << 6;
    pub const HEALED: u32 = 1 << 7;
}

// =============================================================================
// NPC Personality Evolution
// =============================================================================

/// NPC personality evolution table - tracks trait changes over time
#[table(name = npc_personality_evolution, public)]
pub struct NpcPersonalityEvolution {
    /// Primary key - NPC entity ID
    #[primary_key]
    pub npc_id: u64,

    /// Serialized personality traits (Big Five + game traits)
    pub traits_json: Vec<u8>,

    /// Serialized virtues and vices
    pub virtues_vices_json: Vec<u8>,

    /// Current life goals (serialized)
    pub goals_json: Vec<u8>,

    /// Personality stability score (0-100, resistance to change)
    pub stability: u8,

    /// Current life stage (0=youth, 1=adult, 2=mature, 3=elder)
    pub life_stage: u8,

    /// Age in ticks since spawn
    pub age_ticks: u64,

    /// Last evolution update tick
    pub last_update_tick: u64,

    /// Version for change tracking
    pub version: u16,
}

/// NPC daily schedule table - generated from seed
#[table(name = npc_schedule, public)]
pub struct NpcSchedule {
    /// Primary key - NPC entity ID
    #[primary_key]
    pub npc_id: u64,

    /// Wake hour (0-23)
    pub wake_hour: u8,

    /// Sleep hour (0-23)
    pub sleep_hour: u8,

    /// Serialized schedule blocks (work, social, rest times)
    pub schedule_json: Vec<u8>,

    /// Personal rituals (serialized)
    pub rituals_json: Vec<u8>,

    /// Schedule seed for deterministic variation
    pub schedule_seed: u64,
}

// =============================================================================
// NPC Reputation
// =============================================================================

/// NPC reputation table - tracks reputation by domain and region.
/// Reputation determines how NPCs and factions treat the NPC.
#[table(name = npc_reputation, public)]
pub struct NpcReputation {
    /// Primary key - NPC entity ID
    #[primary_key]
    pub npc_id: u64,

    /// Trade reputation (-1000 to 1000): merchant reliability, fair dealing
    pub trade_rep: i16,

    /// Combat reputation (-1000 to 1000): martial prowess, honor in battle
    pub combat_rep: i16,

    /// Social reputation (-1000 to 1000): likability, trustworthiness
    pub social_rep: i16,

    /// Knowledge reputation (-1000 to 1000): wisdom, expertise recognition
    pub knowledge_rep: i16,

    /// Criminal reputation (0-1000): notoriety for crimes
    pub criminal_rep: u16,

    /// Home chunk X (for local reputation)
    pub home_chunk_x: i32,

    /// Home chunk Y (for local reputation)
    pub home_chunk_y: i32,

    /// Local reputation in home region (0-255)
    pub local_rep: u8,

    /// Serialized notable deeds (achievements and misdeeds)
    pub deeds_json: Vec<u8>,

    /// Serialized regional reputation modifiers
    pub regional_json: Vec<u8>,

    /// Last update tick
    pub last_update_tick: u64,

    /// Version for change tracking
    pub version: u16,
}

// =============================================================================
// Section 9.2 (Optional): Chunk Delta Index
// =============================================================================

/// Chunk delta index for tracking persistent world changes.
/// Used for compacting deltas and efficient chunk loading.
#[table(name = chunk_delta_index, public)]
pub struct ChunkDeltaIndex {
    /// Auto-increment primary key
    #[auto_inc]
    #[primary_key]
    pub delta_index_id: u64,

    /// Chunk X coordinate
    #[index(btree)]
    pub cx: i32,

    /// Chunk Y coordinate
    #[index(btree)]
    pub cy: i32,

    /// Zone identifier
    pub zone_id: u64,

    /// Last tick when deltas were compacted
    pub last_compaction_tick: u64,

    /// Compacted delta blob
    pub delta_blob: Vec<u8>,
}

// =============================================================================
// Player Interest State (Server-Side)
// =============================================================================

/// Player interest state for replication management.
/// Tracks which entities are relevant to each player.
#[table(name = player_interest, private)]
pub struct PlayerInterest {
    /// Player entity ID
    #[primary_key]
    pub player_id: u64,

    /// Current chunk X coordinate
    pub current_chunk_x: i32,

    /// Current chunk Y coordinate
    pub current_chunk_y: i32,

    /// Serialized set of relevant entity IDs
    pub entity_ids: Vec<u8>,

    /// Serialized LOD assignments per entity
    pub lod_by_entity: Vec<u8>,

    /// Serialized set of subscribed chunk coordinates
    pub chunk_ids: Vec<u8>,

    /// Last tick this interest set was computed
    pub last_update_tick: u64,
}

// =============================================================================
// Server Tick State
// =============================================================================

/// Global server state for tick management.
#[table(name = server_state, private)]
pub struct ServerState {
    /// Singleton ID (always 0)
    #[primary_key]
    pub id: u32,

    /// Current server tick
    pub current_tick: u64,

    /// Server start timestamp in milliseconds
    pub start_ts_ms: u64,

    /// World seed for generation
    pub world_seed: u64,
}

// =============================================================================
// Input Queue (Per-Player)
// =============================================================================

/// Queued player input for processing on next tick.
#[table(name = input_queue, private)]
pub struct InputQueue {
    /// Auto-incrementing ID for ordering
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    /// Player entity ID
    #[index(btree)]
    pub player_id: u64,

    /// Input sequence number from client
    pub input_seq: u32,

    /// Client timestamp in milliseconds
    pub client_time_ms: u64,

    /// Movement X axis (-1.0 to 1.0, quantized)
    pub move_x: i16,

    /// Movement Y axis (-1.0 to 1.0, quantized)
    pub move_y: i16,

    /// Action bitfield
    pub actions: u32,

    /// Aim yaw (quantized)
    pub aim_yaw: i16,

    /// Client predicted X position (millimeters)
    pub predicted_x: i32,

    /// Client predicted Y position (millimeters)
    pub predicted_y: i32,

    /// Client predicted Z position (millimeters)
    pub predicted_z: i32,
}

/// Action flags for input
pub mod action_flags {
    pub const JUMP: u32 = 1 << 0;
    pub const INTERACT: u32 = 1 << 1;
    pub const ATTACK: u32 = 1 << 2;
    pub const USE_ITEM: u32 = 1 << 3;
    pub const CROUCH: u32 = 1 << 4;
    pub const SPRINT: u32 = 1 << 5;
}

// =============================================================================
// Player State (For Tracking Connected Players)
// =============================================================================

/// Connected player state.
#[table(name = player, public)]
pub struct Player {
    /// SpacetimeDB identity
    #[primary_key]
    pub identity: Identity,

    /// Associated entity ID
    #[unique]
    pub entity_id: u64,

    /// Player display name
    pub name: String,

    /// Last acknowledged input sequence
    pub last_input_seq: u32,

    /// Connection timestamp
    pub connected_ts_ms: u64,

    /// Last activity timestamp
    pub last_activity_ts_ms: u64,
}

// =============================================================================
// World Messages (Player Chat/Yell System)
// =============================================================================

/// World message table - player chat messages visible to nearby players.
/// Messages expire after a short duration and are cleaned up by the server.
#[table(name = world_message, public)]
pub struct WorldMessage {
    /// Unique message identifier
    #[primary_key]
    #[auto_inc]
    pub message_id: u64,

    /// Player entity ID who sent the message
    #[index(btree)]
    pub sender_id: u64,

    /// Sender's display name (cached for efficiency)
    pub sender_name: String,

    /// The message content
    pub message: String,

    /// Whether this is a yell (affects NPCs, larger radius)
    pub is_yell: bool,

    /// Chunk X coordinate where message was sent
    #[index(btree)]
    pub chunk_x: i32,

    /// Chunk Y coordinate where message was sent
    #[index(btree)]
    pub chunk_y: i32,

    /// Position X in millimeters (for floating message display)
    pub pos_x: i32,

    /// Position Y in millimeters
    pub pos_y: i32,

    /// Position Z in millimeters
    pub pos_z: i32,

    /// Timestamp when message was sent
    pub ts_ms: u64,

    /// Timestamp when message expires (auto-cleanup)
    pub expires_ts_ms: u64,
}

// =============================================================================
// Frug State (Player Character Stats)
// =============================================================================

/// Frug state table - persistent player character stats.
/// Updated periodically by client and decayed by server tick.
#[derive(Clone)]
#[table(name = frug_state, public)]
pub struct FrugState {
    /// Player entity ID (one Frug per player)
    #[primary_key]
    pub player_id: u64,

    // Physical stats (0-100 scale, stored as u8 for efficiency)
    pub health: u8,
    pub max_health: u8,
    pub energy: u8,
    pub max_energy: u8,
    pub hunger: u8,       // 0 = starving, 100 = full
    pub thirst: u8,       // 0 = dehydrated, 100 = hydrated
    pub fatigue: u8,      // 0 = exhausted, 100 = well-rested
    pub cleanliness: u8,  // 0 = dirty, 100 = clean

    // Emotional stats (0-100 scale)
    pub happiness: u8,
    pub stress: u8,       // 0 = calm, 100 = stressed
    pub comfort: u8,
    pub excitement: u8,
    pub curiosity: u8,
    pub confidence: u8,

    // Social stats (0-100 scale)
    pub loneliness: u8,       // 0 = fulfilled, 100 = lonely
    pub friendship_level: u8,
    pub reputation: u8,
    pub charisma: u8,
    pub last_social_ts_ms: u64,

    // Activity tracking
    pub activity: u8,         // ActivityState enum as u8
    pub current_biome: u16,   // Biome enum as u16

    // Lifetime stats
    pub age_ticks: u64,       // In-game age in ticks
    pub total_distance_mm: u64,
    pub total_npc_interactions: u32,
    pub total_items_collected: u32,

    // Timestamps
    pub last_decay_tick: u64,
    pub last_updated_ts_ms: u64,
    pub created_ts_ms: u64,
}

/// Default values for new Frug
impl Default for FrugState {
    fn default() -> Self {
        Self {
            player_id: 0,
            health: 100,
            max_health: 100,
            energy: 100,
            max_energy: 100,
            hunger: 75,
            thirst: 80,
            fatigue: 90,
            cleanliness: 85,
            happiness: 70,
            stress: 15,
            comfort: 75,
            excitement: 40,
            curiosity: 60,
            confidence: 65,
            loneliness: 30,
            friendship_level: 20,
            reputation: 50,
            charisma: 50,
            last_social_ts_ms: 0,
            activity: 0,
            current_biome: 0,
            age_ticks: 0,
            total_distance_mm: 0,
            total_npc_interactions: 0,
            total_items_collected: 0,
            last_decay_tick: 0,
            last_updated_ts_ms: 0,
            created_ts_ms: 0,
        }
    }
}

/// Activity states for Frug
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrugActivity {
    Idle = 0,
    Walking = 1,
    Running = 2,
    Talking = 3,
    Resting = 4,
    Eating = 5,
    Exploring = 6,
    Playing = 7,
}

impl FrugActivity {
    #[must_use]
    pub const fn as_u8(self) -> u8 {
        self as u8
    }
}

/// Stat impact event types for the event log
#[repr(u16)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrugStatEvent {
    /// Ate food: payload = food_id (u32), nutrition (u8)
    AteFood = 200,
    /// Drank water: payload = amount (u8)
    DrankWater = 201,
    /// Rested: payload = duration_ticks (u32), recovery (u8)
    Rested = 202,
    /// Took damage: payload = amount (u8), source_type (u8)
    TookDamage = 203,
    /// Healed: payload = amount (u8), source_type (u8)
    Healed = 204,
    /// Social interaction: payload = npc_id (u64), interaction_type (u8)
    SocialInteraction = 205,
    /// Discovered something: payload = discovery_type (u8), biome (u16)
    Discovery = 206,
    /// Weather impact: payload = weather_type (u8), comfort_delta (i8)
    WeatherImpact = 207,
    /// Stat decay tick: payload = empty (server-side decay)
    StatDecay = 208,
    /// Player restored stats: payload = restore_type (u8), amount (u8)
    Restored = 209,
    /// Mood changed: payload = old_mood (u8), new_mood (u8)
    MoodChanged = 210,
}

// =============================================================================
// ID Generation (Simple Counter)
// =============================================================================

/// ID generator for entities.
#[table(name = id_counter, private)]
pub struct IdCounter {
    /// Counter name
    #[primary_key]
    pub name: String,

    /// Current value
    pub value: u64,
}

/// Generate a new unique ID for the given counter name.
fn next_id(ctx: &ReducerContext, name: &str) -> u64 {
    let name_string = name.to_string();
    let current = ctx.db.id_counter().name().find(&name_string);

    match current {
        Some(counter) => {
            let new_value = counter.value + 1;
            ctx.db.id_counter().name().update(IdCounter {
                name: name_string,
                value: new_value,
            });
            new_value
        }
        None => {
            ctx.db.id_counter().try_insert(IdCounter {
                name: name_string,
                value: 1,
            }).ok();
            1
        }
    }
}

/// Get current timestamp in milliseconds.
fn now_ms(ctx: &ReducerContext) -> u64 {
    ctx.timestamp
        .duration_since(Timestamp::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Get current server tick (0 if not initialized).
fn current_tick(ctx: &ReducerContext) -> u64 {
    ctx.db
        .server_state()
        .id()
        .find(0)
        .map_or(0, |s| s.current_tick)
}
