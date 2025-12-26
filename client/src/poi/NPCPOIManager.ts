/**
 * NPCPOIManager - Manages NPC POI assignments and pathfinding targets
 *
 * Integrates with the goal-directed behavior system (longGoal, midGoal, shortIntent)
 * to provide pathfinding targets based on NPC backstories and current goals.
 */

import type { NpcBlueprint, NpcData } from '@/network/SpacetimeDBAdapter.ts';
import {
  POIType,
  POICategory,
  type POI,
  type POIPosition,
  type NPCPOIAssignments,
} from './POITypes.ts';
import { POIRegistry, poiRegistry } from './POIRegistry.ts';
import { BackstoryParser, backstoryParser, type BackstoryPOIResult } from './BackstoryParser.ts';

// ============================================================================
// Types
// ============================================================================

/**
 * Goal types that can influence POI selection
 */
export enum GoalType {
  Work = 'work',
  Socialize = 'socialize',
  Rest = 'rest',
  Eat = 'eat',
  Shop = 'shop',
  Worship = 'worship',
  Explore = 'explore',
  GoHome = 'go_home',
  Patrol = 'patrol',
  Custom = 'custom',
}

/**
 * Goal keywords to detect goal type from text
 */
const GOAL_KEYWORDS: Record<GoalType, string[]> = {
  [GoalType.Work]: ['work', 'job', 'craft', 'forge', 'make', 'create', 'build', 'trade', 'sell', 'duty'],
  [GoalType.Socialize]: ['talk', 'chat', 'meet', 'friend', 'social', 'gather', 'visit', 'gossip'],
  [GoalType.Rest]: ['rest', 'sleep', 'relax', 'nap', 'tired', 'break', 'sit'],
  [GoalType.Eat]: ['eat', 'food', 'hungry', 'meal', 'drink', 'tavern', 'dine'],
  [GoalType.Shop]: ['shop', 'buy', 'purchase', 'market', 'supplies', 'goods'],
  [GoalType.Worship]: ['pray', 'worship', 'temple', 'shrine', 'god', 'ritual', 'ceremony'],
  [GoalType.Explore]: ['explore', 'wander', 'discover', 'adventure', 'journey', 'travel'],
  [GoalType.GoHome]: ['home', 'return', 'back', 'house', 'dwelling'],
  [GoalType.Patrol]: ['patrol', 'guard', 'watch', 'secure', 'protect', 'rounds'],
  [GoalType.Custom]: [], // Fallback
};

/**
 * POI types associated with each goal type
 */
const GOAL_TO_POI_TYPES: Record<GoalType, POIType[]> = {
  [GoalType.Work]: [POIType.Forge, POIType.Workshop, POIType.Shop, POIType.Farm, POIType.Mill, POIType.Mine, POIType.Office, POIType.Warehouse],
  [GoalType.Socialize]: [POIType.Tavern, POIType.Plaza, POIType.Market, POIType.Park, POIType.Garden, POIType.Fountain, POIType.Bench],
  [GoalType.Rest]: [POIType.Home, POIType.Inn, POIType.Bench, POIType.Park],
  [GoalType.Eat]: [POIType.Tavern, POIType.Inn, POIType.Restaurant, POIType.Market],
  [GoalType.Shop]: [POIType.Shop, POIType.Market],
  [GoalType.Worship]: [POIType.Temple, POIType.Shrine, POIType.Cemetery],
  [GoalType.Explore]: [POIType.ViewPoint, POIType.Forest, POIType.Lake, POIType.River, POIType.Cave, POIType.Park],
  [GoalType.GoHome]: [POIType.Home, POIType.Farmhouse],
  [GoalType.Patrol]: [POIType.GuardPost, POIType.Gate, POIType.Plaza, POIType.Market],
  [GoalType.Custom]: [], // Determined by context
};

/**
 * Pathfinding target for an NPC
 */
export interface PathfindingTarget {
  /** Target POI */
  poi: POI;

  /** Why this target was selected */
  reason: string;

  /** Goal type that led to this selection */
  goalType: GoalType;

  /** Priority (higher = more important) */
  priority: number;

  /** Distance from NPC's current position */
  distance: number;

  /** Estimated travel time in seconds */
  estimatedTime: number;
}

/**
 * NPC POI context for goal evaluation
 */
export interface NPCPOIContext {
  npcId: number;
  position: POIPosition;
  backstoryResult: BackstoryPOIResult;
  assignments: NPCPOIAssignments;
  currentPOI: POI | null;
  longGoal: string | null;
  midGoal: string | null;
  shortIntent: string | null;
}

// ============================================================================
// NPCPOIManager Class
// ============================================================================

export class NPCPOIManager {
  private registry: POIRegistry;
  private parser: BackstoryParser;

  /** Cache of parsed backstory results per NPC */
  private backstoryCache: Map<number, BackstoryPOIResult> = new Map();

  /** Cache of NPC contexts */
  private contextCache: Map<number, NPCPOIContext> = new Map();

  /** Movement speed for time estimates (meters per second) */
  private readonly movementSpeed = 3.5;

  constructor(
    registry: POIRegistry = poiRegistry,
    parser: BackstoryParser = backstoryParser
  ) {
    this.registry = registry;
    this.parser = parser;
  }

  // ============================================================================
  // NPC Registration and Setup
  // ============================================================================

  /**
   * Initialize an NPC with their backstory and assign initial POIs
   */
  initializeNPC(
    npcId: number,
    blueprint: NpcBlueprint | null,
    position: POIPosition
  ): NPCPOIContext {
    // Parse backstory
    const backstoryResult = this.parser.parse(npcId, blueprint);
    this.backstoryCache.set(npcId, backstoryResult);

    // Get or create assignments
    const assignments = this.registry.getOrCreateAssignments(npcId);

    // Assign home if not already assigned
    if (!assignments.home) {
      const home = this.findAndAssignHome(npcId, position, backstoryResult);
      if (home) {
        assignments.home = home.id;
      }
    }

    // Assign workplace based on occupation
    if (!assignments.workplace && backstoryResult.workplacePOIs.length > 0) {
      const workplace = this.findAndAssignWorkplace(npcId, position, backstoryResult);
      if (workplace) {
        assignments.workplace = workplace.id;
      }
    }

    // Assign social spots
    if (assignments.socialSpots.length === 0) {
      const socialSpots = this.findSocialSpots(position, backstoryResult, 3);
      assignments.socialSpots = socialSpots.map(s => s.id);
    }

    // Create context
    const context: NPCPOIContext = {
      npcId,
      position,
      backstoryResult,
      assignments,
      currentPOI: null,
      longGoal: null,
      midGoal: null,
      shortIntent: null,
    };

    this.contextCache.set(npcId, context);
    return context;
  }

  /**
   * Update NPC context with current state
   */
  updateNPCContext(
    npcId: number,
    position: POIPosition,
    npcData?: NpcData
  ): NPCPOIContext | null {
    let context = this.contextCache.get(npcId);
    if (!context) {
      console.warn(`NPC ${npcId} not initialized. Call initializeNPC first.`);
      return null;
    }

    // Update position
    context.position = position;

    // Update goals if provided
    if (npcData) {
      context.longGoal = npcData.longGoal;
      context.midGoal = npcData.midGoal;
      context.shortIntent = npcData.shortIntent;
    }

    // Check if NPC is currently at a POI
    context.currentPOI = this.findPOIAtPosition(position);

    return context;
  }

  /**
   * Get NPC context
   */
  getContext(npcId: number): NPCPOIContext | undefined {
    return this.contextCache.get(npcId);
  }

  /**
   * Get cached backstory result for an NPC
   */
  getBackstoryResult(npcId: number): BackstoryPOIResult | undefined {
    return this.backstoryCache.get(npcId);
  }

  // ============================================================================
  // POI Assignment
  // ============================================================================

  /**
   * Find and assign a home for an NPC
   */
  private findAndAssignHome(
    npcId: number,
    position: POIPosition,
    backstory: BackstoryPOIResult
  ): POI | null {
    // Determine home type based on occupation
    const homeTypes: POIType[] = backstory.workplacePOIs.includes(POIType.Farm)
      ? [POIType.Farmhouse, POIType.Home]
      : [POIType.Home];

    // Find unowned homes nearby
    const result = this.registry.query({
      types: homeTypes,
      fromPosition: position,
      sortByDistance: true,
      limit: 10,
    });

    // Find one without an owner
    for (const { poi } of result.pois) {
      if (poi.ownerId === undefined) {
        this.registry.assignHome(npcId, poi.id);
        return poi;
      }
    }

    return null;
  }

  /**
   * Find and assign a workplace for an NPC
   */
  private findAndAssignWorkplace(
    npcId: number,
    position: POIPosition,
    backstory: BackstoryPOIResult
  ): POI | null {
    if (backstory.workplacePOIs.length === 0) {
      return null;
    }

    const result = this.registry.query({
      types: backstory.workplacePOIs,
      fromPosition: position,
      sortByDistance: true,
      limit: 5,
    });

    if (result.pois.length > 0) {
      const workplace = result.pois[0].poi;
      this.registry.assignWorkplace(npcId, workplace.id);
      return workplace;
    }

    return null;
  }

  /**
   * Find social spots for an NPC based on personality
   */
  private findSocialSpots(
    position: POIPosition,
    backstory: BackstoryPOIResult,
    count: number
  ): POI[] {
    const preferredTypes = backstory.socialPOIs.length > 0
      ? backstory.socialPOIs
      : [POIType.Plaza, POIType.Park, POIType.Tavern];

    const result = this.registry.query({
      types: preferredTypes,
      fromPosition: position,
      sortByDistance: true,
      limit: count * 2, // Get extras in case some are full
    });

    // Filter to ones with capacity
    const available = result.pois
      .filter(({ poi }) => this.registry.hasCapacity(poi.id))
      .slice(0, count);

    return available.map(({ poi }) => poi);
  }

  // ============================================================================
  // Goal-Based Pathfinding Target Selection
  // ============================================================================

  /**
   * Detect goal type from goal text
   */
  detectGoalType(goalText: string | null): GoalType {
    if (!goalText) return GoalType.Custom;

    const textLower = goalText.toLowerCase();

    for (const [goalType, keywords] of Object.entries(GOAL_KEYWORDS)) {
      for (const keyword of keywords) {
        if (textLower.includes(keyword)) {
          return goalType as GoalType;
        }
      }
    }

    return GoalType.Custom;
  }

  /**
   * Get pathfinding target for an NPC based on their current goal
   */
  getPathfindingTarget(npcId: number): PathfindingTarget | null {
    const context = this.contextCache.get(npcId);
    if (!context) {
      console.warn(`NPC ${npcId} context not found`);
      return null;
    }

    // Determine goal type from short intent first, then mid goal, then long goal
    let goalType = this.detectGoalType(context.shortIntent);
    if (goalType === GoalType.Custom && context.midGoal) {
      goalType = this.detectGoalType(context.midGoal);
    }
    if (goalType === GoalType.Custom && context.longGoal) {
      goalType = this.detectGoalType(context.longGoal);
    }

    // Get candidate POIs
    const candidates = this.getCandidatePOIs(context, goalType);
    if (candidates.length === 0) {
      return null;
    }

    // Score and select best target
    const scored = candidates.map(poi => this.scoreTarget(context, poi, goalType));
    scored.sort((a, b) => b.priority - a.priority);

    return scored[0] ?? null;
  }

  /**
   * Get candidate POIs for a goal type
   */
  private getCandidatePOIs(context: NPCPOIContext, goalType: GoalType): POI[] {
    const { assignments, backstoryResult, position } = context;

    // Special handling for specific goals
    switch (goalType) {
      case GoalType.GoHome:
        if (assignments.home) {
          const home = this.registry.get(assignments.home);
          return home ? [home] : [];
        }
        break;

      case GoalType.Work:
        if (assignments.workplace) {
          const workplace = this.registry.get(assignments.workplace);
          return workplace ? [workplace] : [];
        }
        // Fall through to find workplace by type
        break;

      case GoalType.Socialize:
        // Prefer assigned social spots, but also include nearby ones
        const socialPOIs: POI[] = [];
        for (const spotId of assignments.socialSpots) {
          const spot = this.registry.get(spotId);
          if (spot) socialPOIs.push(spot);
        }
        if (socialPOIs.length > 0) {
          return socialPOIs;
        }
        break;
    }

    // General POI search based on goal type
    const poiTypes = GOAL_TO_POI_TYPES[goalType];
    if (poiTypes.length === 0) {
      // For custom goals, use backstory-derived POIs
      return this.getBackstoryRelevantPOIs(context, 5);
    }

    const result = this.registry.query({
      types: poiTypes,
      fromPosition: position,
      sortByDistance: true,
      accessibleOnly: true,
      limit: 10,
    });

    return result.pois.map(p => p.poi);
  }

  /**
   * Get POIs relevant to NPC's backstory
   */
  private getBackstoryRelevantPOIs(context: NPCPOIContext, limit: number): POI[] {
    const { backstoryResult, position } = context;

    const allTypes = [
      ...backstoryResult.workplacePOIs,
      ...backstoryResult.socialPOIs,
      ...backstoryResult.mentionedPOIs,
    ];

    // Dedupe
    const uniqueTypes = [...new Set(allTypes)];

    if (uniqueTypes.length === 0) {
      // Default to social spots
      uniqueTypes.push(POIType.Plaza, POIType.Park, POIType.Tavern);
    }

    const result = this.registry.query({
      types: uniqueTypes,
      fromPosition: position,
      sortByDistance: true,
      limit,
    });

    return result.pois.map(p => p.poi);
  }

  /**
   * Score a POI as a target for an NPC
   */
  private scoreTarget(
    context: NPCPOIContext,
    poi: POI,
    goalType: GoalType
  ): PathfindingTarget {
    const { position, assignments, backstoryResult } = context;

    // Calculate distance
    const dx = poi.position.x - position.x;
    const dy = poi.position.y - position.y;
    const dz = poi.position.z - position.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Base priority
    let priority = 50;
    let reason = `Going to ${poi.name}`;

    // Boost priority for assigned POIs
    if (poi.id === assignments.home) {
      priority += 30;
      reason = 'Going home';
    } else if (poi.id === assignments.workplace) {
      priority += 25;
      reason = 'Going to work';
    } else if (assignments.socialSpots.includes(poi.id)) {
      priority += 15;
      reason = 'Visiting favorite spot';
    }

    // Boost for matching goal type
    const goalPOITypes = GOAL_TO_POI_TYPES[goalType];
    if (goalPOITypes.includes(poi.type)) {
      priority += 20;
      reason = `${reason} (matches goal)`;
    }

    // Boost for backstory relevance
    if (backstoryResult.workplacePOIs.includes(poi.type)) {
      priority += 10;
    }
    if (backstoryResult.socialPOIs.includes(poi.type)) {
      priority += 10;
    }

    // Penalty for distance (farther = lower priority)
    priority -= Math.min(20, distance / 10);

    // Penalty for crowded POIs
    if (poi.occupants && poi.capacity) {
      const occupancyRatio = poi.occupants.length / poi.capacity;
      if (occupancyRatio > 0.8) {
        priority -= 15;
      } else if (occupancyRatio > 0.5) {
        priority -= 5;
      }
    }

    // Estimate travel time
    const estimatedTime = distance / this.movementSpeed;

    return {
      poi,
      reason,
      goalType,
      priority: Math.max(0, priority),
      distance,
      estimatedTime,
    };
  }

  /**
   * Find what POI (if any) an NPC is currently at
   */
  private findPOIAtPosition(position: POIPosition): POI | null {
    const nearbyPOIs = this.registry.findWithinRadius(position, 5);

    for (const poi of nearbyPOIs) {
      const dx = poi.position.x - position.x;
      const dy = poi.position.y - position.y;
      const dz = poi.position.z - position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist <= poi.interactionRadius) {
        return poi;
      }
    }

    return null;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get all POIs an NPC should know about (home, work, social spots)
   */
  getKnownPOIs(npcId: number): POI[] {
    const context = this.contextCache.get(npcId);
    if (!context) return [];

    const { assignments } = context;
    const pois: POI[] = [];

    if (assignments.home) {
      const home = this.registry.get(assignments.home);
      if (home) pois.push(home);
    }

    if (assignments.workplace) {
      const workplace = this.registry.get(assignments.workplace);
      if (workplace) pois.push(workplace);
    }

    for (const spotId of assignments.socialSpots) {
      const spot = this.registry.get(spotId);
      if (spot) pois.push(spot);
    }

    for (const poiId of assignments.frequentedPOIs) {
      const poi = this.registry.get(poiId);
      if (poi && !pois.includes(poi)) pois.push(poi);
    }

    return pois;
  }

  /**
   * Get NPC statistics
   */
  getStats(): {
    initializedNPCs: number;
    cachedContexts: number;
    cachedBackstories: number;
  } {
    return {
      initializedNPCs: this.contextCache.size,
      cachedContexts: this.contextCache.size,
      cachedBackstories: this.backstoryCache.size,
    };
  }

  /**
   * Clear NPC data
   */
  clearNPC(npcId: number): void {
    this.contextCache.delete(npcId);
    this.backstoryCache.delete(npcId);
    this.registry.clearAssignments(npcId);
  }

  /**
   * Clear all NPC data
   */
  clear(): void {
    this.contextCache.clear();
    this.backstoryCache.clear();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const npcPOIManager = new NPCPOIManager();
