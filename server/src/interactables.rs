//! Interactable Objects System
//!
//! Procedurally generates world objects that NPCs can interact with:
//! - Resource nodes (food, water, materials, valuables)
//! - Workstations (forge, kitchen, loom, alchemy)
//! - Buildings (homes, shops, taverns, temples)
//! - Environmental features (shelters, paths, landmarks)

use serde::{Deserialize, Serialize};

// =============================================================================
// Interactable Types
// =============================================================================

/// Interactable type discriminator
#[repr(u16)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InteractableType {
    // Resource Nodes (0-99)
    FoodSource = 0,        // Berry bushes, fruit trees, fishing spots
    WaterSource = 1,       // Wells, streams, fountains
    MaterialNode = 2,      // Trees, ore deposits, clay pits
    ValuableNode = 3,      // Gems, rare materials, treasure spots
    HuntingGround = 4,     // Animal spawns, trapping areas
    ForagingSpot = 5,      // Herbs, mushrooms, roots

    // Workstations (100-199)
    CraftingBench = 100,   // General crafting
    Forge = 101,           // Metalworking
    Loom = 102,            // Textile work
    Kitchen = 103,         // Food preparation
    AlchemyTable = 104,    // Potions, chemicals
    Scriptorium = 105,     // Writing, enchanting

    // Buildings (200-299)
    Home = 200,            // Residence
    Shop = 201,            // Trading post
    Tavern = 202,          // Social hub, food/drink
    Temple = 203,          // Spiritual, healing
    Barracks = 204,        // Guard post, training
    Workshop = 205,        // Crafting building
    Farm = 206,            // Agricultural building
    Warehouse = 207,       // Storage

    // Environmental (300-399)
    Shelter = 300,         // Protection from weather
    Path = 301,            // Roads, trails
    Landmark = 302,        // Navigation points
    Danger = 303,          // Hazards, threats
    RestSpot = 304,        // Benches, resting areas
    MeetingPoint = 305,    // Social gathering spots
}

impl InteractableType {
    #[must_use]
    pub const fn as_u16(self) -> u16 {
        self as u16
    }

    #[must_use]
    pub fn from_u16(value: u16) -> Option<Self> {
        match value {
            0 => Some(Self::FoodSource),
            1 => Some(Self::WaterSource),
            2 => Some(Self::MaterialNode),
            3 => Some(Self::ValuableNode),
            4 => Some(Self::HuntingGround),
            5 => Some(Self::ForagingSpot),
            100 => Some(Self::CraftingBench),
            101 => Some(Self::Forge),
            102 => Some(Self::Loom),
            103 => Some(Self::Kitchen),
            104 => Some(Self::AlchemyTable),
            105 => Some(Self::Scriptorium),
            200 => Some(Self::Home),
            201 => Some(Self::Shop),
            202 => Some(Self::Tavern),
            203 => Some(Self::Temple),
            204 => Some(Self::Barracks),
            205 => Some(Self::Workshop),
            206 => Some(Self::Farm),
            207 => Some(Self::Warehouse),
            300 => Some(Self::Shelter),
            301 => Some(Self::Path),
            302 => Some(Self::Landmark),
            303 => Some(Self::Danger),
            304 => Some(Self::RestSpot),
            305 => Some(Self::MeetingPoint),
            _ => None,
        }
    }

    /// Check if this is a resource node type
    #[must_use]
    pub const fn is_resource(self) -> bool {
        matches!(self.as_u16(), 0..=99)
    }

    /// Check if this is a workstation type
    #[must_use]
    pub const fn is_workstation(self) -> bool {
        matches!(self.as_u16(), 100..=199)
    }

    /// Check if this is a building type
    #[must_use]
    pub const fn is_building(self) -> bool {
        matches!(self.as_u16(), 200..=299)
    }

    /// Check if this is an environmental type
    #[must_use]
    pub const fn is_environmental(self) -> bool {
        matches!(self.as_u16(), 300..=399)
    }

    /// Get default resource capacity for resource nodes
    #[must_use]
    pub const fn default_capacity(self) -> u16 {
        match self {
            Self::FoodSource => 50,
            Self::WaterSource => 100,
            Self::MaterialNode => 30,
            Self::ValuableNode => 10,
            Self::HuntingGround => 20,
            Self::ForagingSpot => 40,
            _ => 0,
        }
    }

    /// Get default regeneration rate per tick (0 = no regen)
    #[must_use]
    pub const fn default_regen_rate(self) -> u8 {
        match self {
            Self::FoodSource => 1,      // Slow regen
            Self::WaterSource => 5,     // Fast regen
            Self::MaterialNode => 0,    // No regen (needs to be replanted/mined out)
            Self::ValuableNode => 0,    // No regen
            Self::HuntingGround => 2,   // Animals return
            Self::ForagingSpot => 1,    // Plants regrow
            _ => 0,
        }
    }
}

// =============================================================================
// Resource Subtypes
// =============================================================================

/// Food source subtypes
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FoodSubtype {
    BerryBush = 0,
    FruitTree = 1,
    VegetableGarden = 2,
    FishingSpot = 3,
    MushroomPatch = 4,
    GrainField = 5,
    NutTree = 6,
    HoneyHive = 7,
}

/// Material subtypes
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MaterialSubtype {
    WoodTree = 0,
    StoneDeposit = 1,
    ClayPit = 2,
    IronOre = 3,
    CopperOre = 4,
    FiberPlant = 5,
    LeatherSource = 6,
}

/// Quality levels for interactables
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Quality {
    Poor = 0,
    Common = 1,
    Good = 2,
    Excellent = 3,
    Exceptional = 4,
}

impl Quality {
    /// Quality multiplier for rewards (0.5x to 2.0x)
    #[must_use]
    pub fn reward_multiplier(self) -> f32 {
        match self {
            Self::Poor => 0.5,
            Self::Common => 1.0,
            Self::Good => 1.25,
            Self::Excellent => 1.5,
            Self::Exceptional => 2.0,
        }
    }
}

// =============================================================================
// Interactable State Flags
// =============================================================================

/// Interactable state flags (bitfield)
pub mod interactable_flags {
    /// Currently being used by an NPC
    pub const OCCUPIED: u32 = 1 << 0;
    /// Locked and requires key/permission
    pub const LOCKED: u32 = 1 << 1;
    /// Damaged and needs repair
    pub const DAMAGED: u32 = 1 << 2;
    /// Hidden and requires discovery
    pub const HIDDEN: u32 = 1 << 3;
    /// Depleted (no resources left)
    pub const DEPLETED: u32 = 1 << 4;
    /// Dangerous to interact with
    pub const DANGEROUS: u32 = 1 << 5;
    /// Only available at certain times
    pub const TIME_RESTRICTED: u32 = 1 << 6;
    /// Has an owner who may object
    pub const OWNED: u32 = 1 << 7;
}

// =============================================================================
// Interactable Generation
// =============================================================================

/// Generated interactable data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedInteractable {
    /// Local X offset within chunk (in millimeters)
    pub local_x: i32,
    /// Local Y offset within chunk (in millimeters)
    pub local_y: i32,
    /// Interactable type
    pub itype: u16,
    /// Subtype for variations
    pub subtype: u32,
    /// Initial resource amount
    pub resource_amount: u16,
    /// Maximum resource capacity
    pub resource_max: u16,
    /// Regeneration rate per tick
    pub regen_rate: u8,
    /// Quality level
    pub quality: u8,
    /// State flags
    pub flags: u32,
}

/// Simple LCG for deterministic random numbers
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

/// Get interactable counts by biome
fn get_interactable_counts(biome: u16) -> (u32, u32, u32, u32) {
    // Returns (resources, workstations, buildings, environmental)
    match biome {
        0 => (6, 1, 1, 3),   // Plains
        1 => (8, 0, 0, 4),   // Forest
        2 => (3, 0, 0, 2),   // Desert
        3 => (4, 0, 0, 3),   // Mountain
        4 => (5, 0, 0, 3),   // Swamp
        5 => (2, 0, 0, 2),   // Tundra
        6 => (4, 4, 8, 5),   // Village
        7 => (2, 8, 15, 8),  // City
        8 => (3, 2, 4, 4),   // Ruins
        9 => (6, 1, 2, 4),   // Coast
        _ => (4, 1, 1, 3),   // Default
    }
}

/// Generate interactables for a chunk based on seed and biome
#[must_use]
pub fn generate_interactables(chunk_seed: u64, biome: u16) -> Vec<GeneratedInteractable> {
    let mut interactables = Vec::new();

    // Use different offset from NPCs to avoid overlap
    let mut rng = chunk_seed.wrapping_add(0x1A7E_8AC7_AB1E_5EED);

    let (resource_count, workstation_count, building_count, env_count) = get_interactable_counts(biome);
    let chunk_extent = 64 * 1000; // 64 meters in mm

    // Generate resource nodes
    for _ in 0..resource_count {
        let local_x = rand_range(&mut rng, 0, chunk_extent as u64) as i32;
        let local_y = rand_range(&mut rng, 0, chunk_extent as u64) as i32;

        let itype = generate_resource_type(&mut rng, biome);
        let subtype = generate_resource_subtype(&mut rng, itype);
        let base_capacity = InteractableType::from_u16(itype)
            .map(|t| t.default_capacity())
            .unwrap_or(50);
        let regen_rate = InteractableType::from_u16(itype)
            .map(|t| t.default_regen_rate())
            .unwrap_or(0);
        let quality = generate_quality(&mut rng);

        // Capacity varies by quality
        let capacity_mult = 0.5 + (quality as f32 / 4.0);
        let resource_max = (base_capacity as f32 * capacity_mult) as u16;
        let resource_amount = rand_range(&mut rng, (resource_max / 2) as u64, resource_max as u64) as u16;

        interactables.push(GeneratedInteractable {
            local_x,
            local_y,
            itype,
            subtype,
            resource_amount,
            resource_max,
            regen_rate,
            quality,
            flags: 0,
        });
    }

    // Generate workstations
    for _ in 0..workstation_count {
        let local_x = rand_range(&mut rng, 0, chunk_extent as u64) as i32;
        let local_y = rand_range(&mut rng, 0, chunk_extent as u64) as i32;

        let itype = generate_workstation_type(&mut rng, biome);
        let quality = generate_quality(&mut rng);

        interactables.push(GeneratedInteractable {
            local_x,
            local_y,
            itype,
            subtype: 0,
            resource_amount: 0,
            resource_max: 0,
            regen_rate: 0,
            quality,
            flags: 0,
        });
    }

    // Generate buildings
    for _ in 0..building_count {
        let local_x = rand_range(&mut rng, 0, chunk_extent as u64) as i32;
        let local_y = rand_range(&mut rng, 0, chunk_extent as u64) as i32;

        let itype = generate_building_type(&mut rng, biome);
        let quality = generate_quality(&mut rng);

        // Buildings can be owned
        let flags = if rand_range(&mut rng, 0, 100) < 70 {
            interactable_flags::OWNED
        } else {
            0
        };

        interactables.push(GeneratedInteractable {
            local_x,
            local_y,
            itype,
            subtype: 0,
            resource_amount: 0,
            resource_max: 0,
            regen_rate: 0,
            quality,
            flags,
        });
    }

    // Generate environmental features
    for _ in 0..env_count {
        let local_x = rand_range(&mut rng, 0, chunk_extent as u64) as i32;
        let local_y = rand_range(&mut rng, 0, chunk_extent as u64) as i32;

        let itype = generate_environmental_type(&mut rng, biome);

        // Some environmental features are hidden
        let flags = if itype == InteractableType::Danger.as_u16() {
            interactable_flags::DANGEROUS
        } else if rand_range(&mut rng, 0, 100) < 10 {
            interactable_flags::HIDDEN
        } else {
            0
        };

        interactables.push(GeneratedInteractable {
            local_x,
            local_y,
            itype,
            subtype: 0,
            resource_amount: 0,
            resource_max: 0,
            regen_rate: 0,
            quality: Quality::Common as u8,
            flags,
        });
    }

    interactables
}

fn generate_resource_type(rng: &mut u64, biome: u16) -> u16 {
    // Weight resource types by biome
    let types: &[InteractableType] = match biome {
        1 => &[ // Forest
            InteractableType::FoodSource,
            InteractableType::MaterialNode,
            InteractableType::ForagingSpot,
            InteractableType::HuntingGround,
        ],
        2 => &[ // Desert
            InteractableType::ValuableNode,
            InteractableType::WaterSource,
        ],
        3 => &[ // Mountain
            InteractableType::MaterialNode,
            InteractableType::ValuableNode,
        ],
        4 => &[ // Swamp
            InteractableType::ForagingSpot,
            InteractableType::WaterSource,
            InteractableType::HuntingGround,
        ],
        9 => &[ // Coast
            InteractableType::FoodSource, // Fishing
            InteractableType::WaterSource,
        ],
        _ => &[ // Plains, Village, City, etc.
            InteractableType::FoodSource,
            InteractableType::WaterSource,
            InteractableType::MaterialNode,
            InteractableType::ForagingSpot,
        ],
    };

    let idx = rand_range(rng, 0, types.len() as u64 - 1) as usize;
    types[idx].as_u16()
}

fn generate_resource_subtype(rng: &mut u64, itype: u16) -> u32 {
    match itype {
        0 => rand_range(rng, 0, 7) as u32, // FoodSource subtypes
        2 => rand_range(rng, 0, 6) as u32, // MaterialNode subtypes
        _ => 0,
    }
}

fn generate_workstation_type(rng: &mut u64, biome: u16) -> u16 {
    let types: &[InteractableType] = match biome {
        6 => &[ // Village
            InteractableType::CraftingBench,
            InteractableType::Forge,
            InteractableType::Kitchen,
            InteractableType::Loom,
        ],
        7 => &[ // City
            InteractableType::CraftingBench,
            InteractableType::Forge,
            InteractableType::Kitchen,
            InteractableType::Loom,
            InteractableType::AlchemyTable,
            InteractableType::Scriptorium,
        ],
        8 => &[ // Ruins
            InteractableType::CraftingBench,
            InteractableType::AlchemyTable,
        ],
        _ => &[
            InteractableType::CraftingBench,
        ],
    };

    let idx = rand_range(rng, 0, types.len() as u64 - 1) as usize;
    types[idx].as_u16()
}

fn generate_building_type(rng: &mut u64, biome: u16) -> u16 {
    let types: &[InteractableType] = match biome {
        6 => &[ // Village
            InteractableType::Home,
            InteractableType::Home,
            InteractableType::Home,
            InteractableType::Shop,
            InteractableType::Tavern,
            InteractableType::Temple,
            InteractableType::Farm,
            InteractableType::Workshop,
        ],
        7 => &[ // City
            InteractableType::Home,
            InteractableType::Home,
            InteractableType::Shop,
            InteractableType::Shop,
            InteractableType::Tavern,
            InteractableType::Temple,
            InteractableType::Barracks,
            InteractableType::Workshop,
            InteractableType::Warehouse,
        ],
        8 => &[ // Ruins
            InteractableType::Home,
            InteractableType::Workshop,
            InteractableType::Temple,
        ],
        _ => &[
            InteractableType::Home,
            InteractableType::Shelter,
        ],
    };

    let idx = rand_range(rng, 0, types.len() as u64 - 1) as usize;
    types[idx].as_u16()
}

fn generate_environmental_type(rng: &mut u64, biome: u16) -> u16 {
    let types: &[InteractableType] = match biome {
        1 | 4 => &[ // Forest, Swamp
            InteractableType::Path,
            InteractableType::Shelter,
            InteractableType::Landmark,
            InteractableType::Danger,
        ],
        3 => &[ // Mountain
            InteractableType::Path,
            InteractableType::Shelter,
            InteractableType::Danger,
            InteractableType::Landmark,
        ],
        6 | 7 => &[ // Village, City
            InteractableType::Path,
            InteractableType::RestSpot,
            InteractableType::Landmark,
            InteractableType::MeetingPoint,
        ],
        _ => &[
            InteractableType::Path,
            InteractableType::Landmark,
            InteractableType::RestSpot,
        ],
    };

    let idx = rand_range(rng, 0, types.len() as u64 - 1) as usize;
    types[idx].as_u16()
}

fn generate_quality(rng: &mut u64) -> u8 {
    // Quality distribution: 20% poor, 50% common, 20% good, 8% excellent, 2% exceptional
    let roll = rand_range(rng, 0, 99);
    match roll {
        0..=19 => Quality::Poor as u8,
        20..=69 => Quality::Common as u8,
        70..=89 => Quality::Good as u8,
        90..=97 => Quality::Excellent as u8,
        _ => Quality::Exceptional as u8,
    }
}

// =============================================================================
// Resource Interaction
// =============================================================================

/// Result of gathering from a resource
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatherResult {
    /// Amount gathered
    pub amount: u16,
    /// Resource subtype gathered
    pub subtype: u32,
    /// Quality of gathered resource
    pub quality: u8,
    /// Whether the source is now depleted
    pub depleted: bool,
    /// Skill XP reward
    pub skill_xp: u32,
}

/// Calculate gathering result based on resource, skill, and luck
#[must_use]
pub fn calculate_gather(
    resource_amount: u16,
    resource_max: u16,
    subtype: u32,
    quality: u8,
    gatherer_skill: u8,
    luck_modifier: i8,
) -> GatherResult {
    // Base gather amount (5-15% of max)
    let base_pct = 5 + (gatherer_skill as u16 / 10);
    let mut amount = (resource_max as u32 * base_pct as u32 / 100) as u16;

    // Apply luck modifier
    let luck_mult = 1.0 + (luck_modifier as f32 / 50.0);
    amount = (amount as f32 * luck_mult) as u16;

    // Cap at available
    amount = amount.min(resource_amount);

    // Ensure at least 1 if any available
    if amount == 0 && resource_amount > 0 {
        amount = 1;
    }

    let depleted = resource_amount <= amount;

    // XP based on amount and quality
    let base_xp = amount as u32 * 2;
    let quality_mult = Quality::from_u8(quality).reward_multiplier();
    let skill_xp = (base_xp as f32 * quality_mult) as u32;

    GatherResult {
        amount,
        subtype,
        quality,
        depleted,
        skill_xp,
    }
}

impl Quality {
    fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::Poor,
            1 => Self::Common,
            2 => Self::Good,
            3 => Self::Excellent,
            4 => Self::Exceptional,
            _ => Self::Common,
        }
    }
}

/// Calculate resource regeneration for a tick
#[must_use]
pub fn calculate_regen(current: u16, max: u16, regen_rate: u8, ticks_elapsed: u64) -> u16 {
    if regen_rate == 0 || current >= max {
        return current;
    }

    // Regenerate based on rate and time elapsed
    let regen_amount = (regen_rate as u64 * ticks_elapsed / 20).min(u16::MAX as u64) as u16;
    (current + regen_amount).min(max)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_interactables_deterministic() {
        let seed = 12345u64;
        let biome = 6; // Village

        let result1 = generate_interactables(seed, biome);
        let result2 = generate_interactables(seed, biome);

        assert_eq!(result1.len(), result2.len());
        for (a, b) in result1.iter().zip(result2.iter()) {
            assert_eq!(a.local_x, b.local_x);
            assert_eq!(a.local_y, b.local_y);
            assert_eq!(a.itype, b.itype);
        }
    }

    #[test]
    fn test_gather_calculation() {
        let result = calculate_gather(100, 100, 0, 1, 50, 0);
        assert!(result.amount > 0);
        assert!(result.amount <= 100);
        assert!(!result.depleted);
    }
}
