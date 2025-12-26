/**
 * POI (Points of Interest) Module
 *
 * Provides a complete POI system for NPC navigation and goal-directed behavior:
 * - POI types and interfaces (homes, workplaces, social spots, etc.)
 * - POI registry for storing and querying POIs
 * - Backstory parser for extracting POI relevance from NPC data
 * - NPC POI manager for assignment and pathfinding target selection
 */

// Types and enums
export {
  POIType,
  POICategory,
  POI_TYPE_TO_CATEGORY,
  OCCUPATION_TO_POI_TYPES,
  TRAIT_TO_SOCIAL_POIS,
} from './POITypes.ts';

export type {
  POI,
  POIPosition,
  POISchedule,
  POIWithDistance,
  NPCPOIAssignments,
  POIQueryOptions,
  POIQueryResult,
  CreatePOIData,
  SerializedPOI,
} from './POITypes.ts';

// Registry
export { POIRegistry, poiRegistry } from './POIRegistry.ts';
export type { NPCPOIAssignment } from './POIRegistry.ts';

// Backstory parser
export { BackstoryParser, backstoryParser } from './BackstoryParser.ts';
export type { BackstoryPOIResult } from './BackstoryParser.ts';

// NPC POI manager
export {
  NPCPOIManager,
  npcPOIManager,
  GoalType,
} from './NPCPOIManager.ts';
export type {
  PathfindingTarget,
  NPCPOIContext,
} from './NPCPOIManager.ts';
