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
mod interest;
mod lod;
mod relationships;
mod tick;

pub use admin::*;
pub use ai_system::*;
pub use blueprint::*;
pub use chunk_gen::*;
pub use dialogue::*;
pub use entity_system::*;
pub use event_types::*;
pub use interest::*;
pub use lod::*;
pub use relationships::*;
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
