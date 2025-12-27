//! Event Types for Frugworld
//!
//! Defines all event type discriminators and payload structures
//! for the event-sourced architecture.

use serde::{Deserialize, Serialize};

/// Event type discriminators for the event_log table.
#[repr(u16)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventType {
    // Chunk events (0-99)
    ChunkGenerated = 0,
    ChunkModified = 1,

    // Entity lifecycle events (100-199)
    EntitySpawned = 100,
    EntityDespawned = 101,
    EntityKilled = 102,
    EntityRevived = 103,

    // Transform events (200-299)
    TransformSet = 200,
    TransformTeleport = 201,

    // Action events (300-399)
    ActionRequested = 300,
    ActionResolved = 301,
    ActionCancelled = 302,

    // Dialogue events (400-499)
    DialogueStarted = 400,
    DialogueLine = 401,
    DialogueEnded = 402,

    // NPC state events (500-599)
    GoalUpdated = 500,
    MemoryUpdated = 501,
    NeedsUpdated = 502,
    BlueprintCreated = 503,

    // Relationship events (600-699)
    RelationshipUpdated = 600,
    RelationshipCreated = 601,

    // Combat/interaction events (700-799)
    DamageDealt = 700,
    DamageReceived = 701,
    Healed = 702,

    // Inventory events (800-899)
    ItemAdded = 800,
    ItemRemoved = 801,
    ItemUsed = 802,
    ItemDropped = 803,
    ItemPickedUp = 804,

    // Player events (900-999)
    PlayerConnected = 900,
    PlayerDisconnected = 901,
    PlayerSpawned = 902,

    // LOD events (1000-1099)
    LodChanged = 1000,
    NpcHydrated = 1001,
    NpcDehydrated = 1002,

    // World message events (1100-1199)
    WorldMessageSent = 1100,
    WorldMessageYelled = 1101,
    NpcHeardYell = 1102,

    // Player gesture/action events (1200-1299)
    PlayerGesture = 1200,
    NpcPerceivedGesture = 1201,

    // Skill progression events (1300-1399)
    SkillXpGained = 1300,
    SkillLevelUp = 1301,

    // Social events (1400-1499)
    SocialEncounter = 1400,
    GossipSpread = 1401,
    RelationshipMilestone = 1402,
    GatheringAttended = 1403,

    // Memory & Life events (1500-1599)
    MemoryFormed = 1500,
    MemoryConsolidated = 1501,
    LifeEventOccurred = 1502,
    TraumaExperienced = 1503,
    TraumaHealed = 1504,
    FearFaced = 1505,

    // Personality evolution events (1600-1699)
    TraitEvolved = 1600,
    VirtueGained = 1601,
    ViceGained = 1602,
    GoalChanged = 1603,
    GoalAchieved = 1604,
    ScheduleChanged = 1605,
}

impl EventType {
    #[must_use]
    pub const fn as_u16(self) -> u16 {
        self as u16
    }

    #[must_use]
    pub fn from_u16(value: u16) -> Option<Self> {
        match value {
            0 => Some(Self::ChunkGenerated),
            1 => Some(Self::ChunkModified),
            100 => Some(Self::EntitySpawned),
            101 => Some(Self::EntityDespawned),
            102 => Some(Self::EntityKilled),
            103 => Some(Self::EntityRevived),
            200 => Some(Self::TransformSet),
            201 => Some(Self::TransformTeleport),
            300 => Some(Self::ActionRequested),
            301 => Some(Self::ActionResolved),
            302 => Some(Self::ActionCancelled),
            400 => Some(Self::DialogueStarted),
            401 => Some(Self::DialogueLine),
            402 => Some(Self::DialogueEnded),
            500 => Some(Self::GoalUpdated),
            501 => Some(Self::MemoryUpdated),
            502 => Some(Self::NeedsUpdated),
            503 => Some(Self::BlueprintCreated),
            600 => Some(Self::RelationshipUpdated),
            601 => Some(Self::RelationshipCreated),
            700 => Some(Self::DamageDealt),
            701 => Some(Self::DamageReceived),
            702 => Some(Self::Healed),
            800 => Some(Self::ItemAdded),
            801 => Some(Self::ItemRemoved),
            802 => Some(Self::ItemUsed),
            803 => Some(Self::ItemDropped),
            804 => Some(Self::ItemPickedUp),
            900 => Some(Self::PlayerConnected),
            901 => Some(Self::PlayerDisconnected),
            902 => Some(Self::PlayerSpawned),
            1000 => Some(Self::LodChanged),
            1001 => Some(Self::NpcHydrated),
            1002 => Some(Self::NpcDehydrated),
            1100 => Some(Self::WorldMessageSent),
            1101 => Some(Self::WorldMessageYelled),
            1102 => Some(Self::NpcHeardYell),
            1200 => Some(Self::PlayerGesture),
            1201 => Some(Self::NpcPerceivedGesture),
            1300 => Some(Self::SkillXpGained),
            1301 => Some(Self::SkillLevelUp),
            1400 => Some(Self::SocialEncounter),
            1401 => Some(Self::GossipSpread),
            1402 => Some(Self::RelationshipMilestone),
            1403 => Some(Self::GatheringAttended),
            1500 => Some(Self::MemoryFormed),
            1501 => Some(Self::MemoryConsolidated),
            1502 => Some(Self::LifeEventOccurred),
            1503 => Some(Self::TraumaExperienced),
            1504 => Some(Self::TraumaHealed),
            1505 => Some(Self::FearFaced),
            1600 => Some(Self::TraitEvolved),
            1601 => Some(Self::VirtueGained),
            1602 => Some(Self::ViceGained),
            1603 => Some(Self::GoalChanged),
            1604 => Some(Self::GoalAchieved),
            1605 => Some(Self::ScheduleChanged),
            _ => None,
        }
    }
}

// =============================================================================
// Event Payloads
// =============================================================================

/// Payload for ChunkGenerated event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkGeneratedPayload {
    pub seed: u64,
    pub biome: u16,
    pub poi_count: u32,
}

/// Payload for EntitySpawned event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntitySpawnedPayload {
    pub kind: u16,
    pub archetype_id: u32,
    pub x: i32,
    pub y: i32,
    pub z: i32,
}

/// Payload for EntityDespawned event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityDespawnedPayload {
    pub reason: DespawnReason,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum DespawnReason {
    Killed,
    Removed,
    OutOfBounds,
    Expired,
    Disconnected,
}

/// Payload for DialogueLine event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DialogueLinePayload {
    pub speaker_id: u64,
    pub text: String,
    pub intent_tags: Vec<String>,
}

/// Payload for GoalUpdated event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalUpdatedPayload {
    pub goal_type: GoalType,
    pub new_goal: String,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum GoalType {
    LongTerm,
    MidTerm,
    ShortTerm,
}

/// Payload for RelationshipUpdated event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationshipUpdatedPayload {
    pub affinity_delta: i16,
    pub trust_delta: i16,
    pub flags_added: u32,
    pub flags_removed: u32,
    pub reason: String,
}

/// Payload for DamageDealt event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DamageDealtPayload {
    pub damage_type: DamageType,
    pub amount: u32,
    pub source_type: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum DamageType {
    Physical,
    Fire,
    Cold,
    Poison,
    Magic,
}

/// Payload for ItemAdded/Removed events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemEventPayload {
    pub item_id: u64,
    pub item_type: u32,
    pub quantity: u32,
    pub container_id: Option<u64>,
}

/// Payload for LodChanged event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LodChangedPayload {
    pub old_lod: u8,
    pub new_lod: u8,
    pub triggering_player_id: u64,
}

/// Payload for PlayerConnected event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerConnectedPayload {
    pub name: String,
    pub entity_id: u64,
}

/// Payload for TransformTeleport event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformTeleportPayload {
    pub from_x: i32,
    pub from_y: i32,
    pub from_z: i32,
    pub to_x: i32,
    pub to_y: i32,
    pub to_z: i32,
    pub reason: String,
}

/// Payload for WorldMessageSent/WorldMessageYelled events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldMessagePayload {
    pub message_id: u64,
    pub sender_name: String,
    pub message: String,
    pub is_yell: bool,
    pub pos_x: i32,
    pub pos_y: i32,
    pub pos_z: i32,
}

/// Payload for NpcHeardYell event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpcHeardYellPayload {
    pub yell_message_id: u64,
    pub yeller_id: u64,
    pub distance_mm: i32,
}

/// Gesture types that players can perform
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum GestureType {
    Wave,
    Greet,
    Bow,
    Beckon,
    Dismiss,
}

impl GestureType {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "wave" | "greet" => Some(Self::Wave),
            "bow" => Some(Self::Bow),
            "beckon" | "come" => Some(Self::Beckon),
            "dismiss" | "shoo" => Some(Self::Dismiss),
            _ => None,
        }
    }

    pub fn description(&self) -> &'static str {
        match self {
            Self::Wave => "waves at",
            Self::Greet => "greets",
            Self::Bow => "bows to",
            Self::Beckon => "beckons to",
            Self::Dismiss => "dismisses",
        }
    }
}

/// Payload for PlayerGesture event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerGesturePayload {
    pub gesture_type: GestureType,
    pub target_npc_ids: Vec<u64>,
    pub player_name: String,
}

/// Payload for NpcPerceivedGesture event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpcPerceivedGesturePayload {
    pub gesture_type: GestureType,
    pub player_id: u64,
    pub player_name: String,
    pub distance_mm: i32,
}

// =============================================================================
// Serialization Helpers
// =============================================================================

/// Serialize a payload to bytes for storage in event_log
pub fn serialize_payload<T: Serialize>(payload: &T) -> Vec<u8> {
    serde_json::to_vec(payload).unwrap_or_default()
}

/// Deserialize a payload from event_log bytes
pub fn deserialize_payload<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Option<T> {
    serde_json::from_slice(bytes).ok()
}
