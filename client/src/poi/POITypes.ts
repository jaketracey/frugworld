/**
 * Points of Interest (POI) Type Definitions
 *
 * Defines location types that NPCs can navigate to and interact with.
 * POIs are generated from chunk data and NPC backstories, providing
 * pathfinding targets for goal-directed NPC behavior.
 */

// ============================================================================
// POI Category and Type Enums
// ============================================================================

/**
 * High-level categories of POIs
 */
export enum POICategory {
  Residential = 'residential',
  Commercial = 'commercial',
  Industrial = 'industrial',
  Social = 'social',
  Nature = 'nature',
  Religious = 'religious',
  Government = 'government',
  Utility = 'utility',
}

/**
 * Specific POI types within categories
 */
export enum POIType {
  // Residential
  Home = 'home',
  Apartment = 'apartment',
  Farmhouse = 'farmhouse',

  // Commercial
  Shop = 'shop',
  Market = 'market',
  Inn = 'inn',
  Tavern = 'tavern',
  Restaurant = 'restaurant',
  Bank = 'bank',

  // Industrial / Workplaces
  Forge = 'forge',
  Workshop = 'workshop',
  Mill = 'mill',
  Farm = 'farm',
  Mine = 'mine',
  Warehouse = 'warehouse',
  Office = 'office',

  // Social
  Plaza = 'plaza',
  Park = 'park',
  Garden = 'garden',
  Fountain = 'fountain',
  Bench = 'bench',
  MeetingSpot = 'meeting_spot',

  // Religious
  Temple = 'temple',
  Shrine = 'shrine',
  Cemetery = 'cemetery',

  // Government
  TownHall = 'town_hall',
  GuardPost = 'guard_post',
  Prison = 'prison',

  // Nature
  Lake = 'lake',
  River = 'river',
  Forest = 'forest',
  Cave = 'cave',
  ViewPoint = 'view_point',

  // Utility
  Well = 'well',
  Bridge = 'bridge',
  Gate = 'gate',
  Dock = 'dock',
  Stable = 'stable',

  // Generic
  Generic = 'generic',
}

/**
 * Maps POI types to their categories
 */
export const POI_TYPE_TO_CATEGORY: Record<POIType, POICategory> = {
  // Residential
  [POIType.Home]: POICategory.Residential,
  [POIType.Apartment]: POICategory.Residential,
  [POIType.Farmhouse]: POICategory.Residential,

  // Commercial
  [POIType.Shop]: POICategory.Commercial,
  [POIType.Market]: POICategory.Commercial,
  [POIType.Inn]: POICategory.Commercial,
  [POIType.Tavern]: POICategory.Commercial,
  [POIType.Restaurant]: POICategory.Commercial,
  [POIType.Bank]: POICategory.Commercial,

  // Industrial
  [POIType.Forge]: POICategory.Industrial,
  [POIType.Workshop]: POICategory.Industrial,
  [POIType.Mill]: POICategory.Industrial,
  [POIType.Farm]: POICategory.Industrial,
  [POIType.Mine]: POICategory.Industrial,
  [POIType.Warehouse]: POICategory.Industrial,
  [POIType.Office]: POICategory.Industrial,

  // Social
  [POIType.Plaza]: POICategory.Social,
  [POIType.Park]: POICategory.Social,
  [POIType.Garden]: POICategory.Social,
  [POIType.Fountain]: POICategory.Social,
  [POIType.Bench]: POICategory.Social,
  [POIType.MeetingSpot]: POICategory.Social,

  // Religious
  [POIType.Temple]: POICategory.Religious,
  [POIType.Shrine]: POICategory.Religious,
  [POIType.Cemetery]: POICategory.Religious,

  // Government
  [POIType.TownHall]: POICategory.Government,
  [POIType.GuardPost]: POICategory.Government,
  [POIType.Prison]: POICategory.Government,

  // Nature
  [POIType.Lake]: POICategory.Nature,
  [POIType.River]: POICategory.Nature,
  [POIType.Forest]: POICategory.Nature,
  [POIType.Cave]: POICategory.Nature,
  [POIType.ViewPoint]: POICategory.Nature,

  // Utility
  [POIType.Well]: POICategory.Utility,
  [POIType.Bridge]: POICategory.Utility,
  [POIType.Gate]: POICategory.Utility,
  [POIType.Dock]: POICategory.Utility,
  [POIType.Stable]: POICategory.Utility,

  // Generic
  [POIType.Generic]: POICategory.Utility,
};

// ============================================================================
// POI Data Structures
// ============================================================================

/**
 * World position for a POI
 */
export interface POIPosition {
  x: number;  // World X coordinate
  y: number;  // World Y coordinate (forward in game coords)
  z: number;  // World Z coordinate (up in game coords, height)
}

/**
 * Time-based availability for POIs
 */
export interface POISchedule {
  /** Opening hour (0-23) */
  openHour: number;
  /** Closing hour (0-23) */
  closeHour: number;
  /** Days of week available (0=Sunday, 6=Saturday) */
  daysOpen: number[];
}

/**
 * Core POI data structure
 */
export interface POI {
  /** Unique identifier for this POI */
  id: string;

  /** Human-readable name */
  name: string;

  /** Type of POI */
  type: POIType;

  /** Category (derived from type) */
  category: POICategory;

  /** World position */
  position: POIPosition;

  /** Chunk coordinates where this POI is located */
  chunkX: number;
  chunkY: number;

  /** Optional description for flavor text */
  description?: string;

  /** Interaction radius in world units */
  interactionRadius: number;

  /** Whether NPCs can enter/use this POI */
  isAccessible: boolean;

  /** Operating schedule (if applicable) */
  schedule?: POISchedule;

  /** Maximum capacity (for social spaces) */
  capacity?: number;

  /** Current occupant NPC IDs */
  occupants?: number[];

  /** Owner NPC ID (for homes/businesses) */
  ownerId?: number;

  /** Tags for filtering/searching */
  tags: string[];

  /** Custom data for specific POI types */
  metadata?: Record<string, unknown>;
}

/**
 * POI reference with distance for query results
 */
export interface POIWithDistance {
  poi: POI;
  distance: number;
}

/**
 * NPC's personal POI assignments
 */
export interface NPCPOIAssignments {
  /** The NPC's entity ID */
  npcId: number;

  /** Home location */
  home: string | null;

  /** Primary workplace */
  workplace: string | null;

  /** Favorite social spots */
  socialSpots: string[];

  /** Frequently visited locations */
  frequentedPOIs: string[];

  /** POIs related to NPC's occupation */
  occupationPOIs: string[];
}

// ============================================================================
// POI Query Types
// ============================================================================

/**
 * Options for querying POIs
 */
export interface POIQueryOptions {
  /** Filter by POI type(s) */
  types?: POIType[];

  /** Filter by category(s) */
  categories?: POICategory[];

  /** Filter by tags (any match) */
  tags?: string[];

  /** Maximum distance from reference point */
  maxDistance?: number;

  /** Reference position for distance calculations */
  fromPosition?: POIPosition;

  /** Filter by chunk coordinates */
  chunkX?: number;
  chunkY?: number;

  /** Only return accessible POIs */
  accessibleOnly?: boolean;

  /** Filter by capacity (has space available) */
  hasCapacity?: boolean;

  /** Maximum results to return */
  limit?: number;

  /** Sort by distance (requires fromPosition) */
  sortByDistance?: boolean;
}

/**
 * Result of a POI query
 */
export interface POIQueryResult {
  pois: POIWithDistance[];
  totalCount: number;
  queryTimeMs: number;
}

// ============================================================================
// POI Creation Types
// ============================================================================

/**
 * Data required to create a new POI
 */
export interface CreatePOIData {
  name: string;
  type: POIType;
  position: POIPosition;
  chunkX: number;
  chunkY: number;
  description?: string;
  interactionRadius?: number;
  schedule?: POISchedule;
  capacity?: number;
  ownerId?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * POI data as stored in chunk blob (serialized format)
 */
export interface SerializedPOI {
  id: string;
  n: string;       // name
  t: string;       // type
  x: number;
  y: number;
  z: number;
  r?: number;      // interaction radius
  s?: {            // schedule
    o: number;     // open hour
    c: number;     // close hour
    d: number[];   // days
  };
  cap?: number;    // capacity
  own?: number;    // owner ID
  tags?: string[];
  meta?: Record<string, unknown>;
}

// ============================================================================
// Occupation to POI Mapping
// ============================================================================

/**
 * Maps occupation keywords to relevant POI types
 */
export const OCCUPATION_TO_POI_TYPES: Record<string, POIType[]> = {
  // Crafters
  blacksmith: [POIType.Forge, POIType.Workshop],
  smith: [POIType.Forge, POIType.Workshop],
  forgemaster: [POIType.Forge],
  metalworker: [POIType.Forge, POIType.Workshop],

  // Merchants
  merchant: [POIType.Shop, POIType.Market, POIType.Warehouse],
  trader: [POIType.Market, POIType.Shop],
  shopkeeper: [POIType.Shop],
  vendor: [POIType.Market, POIType.Shop],
  baker: [POIType.Shop, POIType.Mill],
  butcher: [POIType.Shop, POIType.Market],
  tailor: [POIType.Shop, POIType.Workshop],

  // Hospitality
  innkeeper: [POIType.Inn, POIType.Tavern],
  bartender: [POIType.Tavern],
  cook: [POIType.Restaurant, POIType.Inn, POIType.Tavern],
  chef: [POIType.Restaurant],

  // Agriculture
  farmer: [POIType.Farm, POIType.Farmhouse, POIType.Mill],
  miller: [POIType.Mill],
  shepherd: [POIType.Farm, POIType.Stable],

  // Mining/Resources
  miner: [POIType.Mine, POIType.Forge],
  woodcutter: [POIType.Forest, POIType.Workshop],
  lumberjack: [POIType.Forest, POIType.Mill],

  // Spiritual
  priest: [POIType.Temple, POIType.Shrine],
  monk: [POIType.Temple],
  acolyte: [POIType.Temple, POIType.Shrine],

  // Government/Military
  guard: [POIType.GuardPost, POIType.Gate],
  soldier: [POIType.GuardPost],
  mayor: [POIType.TownHall],
  clerk: [POIType.TownHall, POIType.Office],

  // Transport
  stableman: [POIType.Stable],
  sailor: [POIType.Dock],
  fisherman: [POIType.Dock, POIType.Lake, POIType.River],

  // Finance
  banker: [POIType.Bank],
  moneylender: [POIType.Bank],

  // Default
  laborer: [POIType.Warehouse, POIType.Workshop],
  worker: [POIType.Workshop],
};

/**
 * Maps personality traits to preferred social POI types
 */
export const TRAIT_TO_SOCIAL_POIS: Record<string, POIType[]> = {
  // Sociable traits
  social: [POIType.Tavern, POIType.Plaza, POIType.Market],
  friendly: [POIType.Plaza, POIType.Park, POIType.Tavern],
  outgoing: [POIType.Tavern, POIType.Market, POIType.Plaza],

  // Quiet traits
  introvert: [POIType.Garden, POIType.ViewPoint, POIType.Bench],
  shy: [POIType.Garden, POIType.Forest, POIType.Bench],
  quiet: [POIType.Park, POIType.Garden, POIType.Shrine],

  // Religious traits
  devout: [POIType.Temple, POIType.Shrine],
  spiritual: [POIType.Temple, POIType.Shrine, POIType.ViewPoint],
  pious: [POIType.Temple, POIType.Cemetery],

  // Nature-loving traits
  naturelover: [POIType.Forest, POIType.Lake, POIType.ViewPoint],
  outdoorsy: [POIType.Park, POIType.Forest, POIType.River],

  // Default
  default: [POIType.Plaza, POIType.Park, POIType.Bench],
};
