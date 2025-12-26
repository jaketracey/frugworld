/**
 * POI Registry - Manages Points of Interest in the world
 * Provides registration, querying, and NPC POI assignment
 */

import {
  POIType,
  POICategory,
  POI_TYPE_TO_CATEGORY,
  type POI,
  type POIPosition,
  type POIQueryOptions,
  type POIQueryResult,
  type POIWithDistance,
  type CreatePOIData,
  type SerializedPOI,
  type NPCPOIAssignments,
} from './POITypes.ts';

// ============================================================================
// Legacy Type Compatibility
// ============================================================================

/**
 * Legacy NPC POI assignment type (for backwards compatibility)
 */
export interface NPCPOIAssignment {
  npcId: number;
  homeId: string | null;
  workplaceId: string | null;
  socialSpots: string[];
  frequentedPOIs: string[];
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_INTERACTION_RADIUS = 5;

/**
 * POI types that provide shelter
 */
const SHELTER_POI_TYPES = new Set([
  POIType.Home,
  POIType.Apartment,
  POIType.Farmhouse,
  POIType.Inn,
  POIType.Tavern,
  POIType.Temple,
]);

// ============================================================================
// POI Registry
// ============================================================================

export class POIRegistry {
  private pois: Map<string, POI> = new Map();
  private poiByChunk: Map<string, Set<string>> = new Map();
  private poiByType: Map<POIType, Set<string>> = new Map();
  private poiByCategory: Map<POICategory, Set<string>> = new Map();
  private npcAssignments: Map<number, NPCPOIAssignments> = new Map();
  private idCounter: number = 0;

  constructor() {
    // Initialize type indexes
    for (const type of Object.values(POIType)) {
      this.poiByType.set(type, new Set());
    }
    for (const category of Object.values(POICategory)) {
      this.poiByCategory.set(category, new Set());
    }
  }

  // ============================================================================
  // Registration
  // ============================================================================

  /**
   * Register a POI
   */
  register(poi: POI): void {
    this.pois.set(poi.id, poi);

    // Index by chunk
    const chunkKey = `${poi.chunkX},${poi.chunkY}`;
    if (!this.poiByChunk.has(chunkKey)) {
      this.poiByChunk.set(chunkKey, new Set());
    }
    this.poiByChunk.get(chunkKey)!.add(poi.id);

    // Index by type
    if (!this.poiByType.has(poi.type)) {
      this.poiByType.set(poi.type, new Set());
    }
    this.poiByType.get(poi.type)!.add(poi.id);

    // Index by category
    if (!this.poiByCategory.has(poi.category)) {
      this.poiByCategory.set(poi.category, new Set());
    }
    this.poiByCategory.get(poi.category)!.add(poi.id);
  }

  /**
   * Unregister a POI
   */
  unregister(poiId: string): void {
    const poi = this.pois.get(poiId);
    if (!poi) return;

    this.pois.delete(poiId);

    const chunkKey = `${poi.chunkX},${poi.chunkY}`;
    this.poiByChunk.get(chunkKey)?.delete(poiId);
    this.poiByType.get(poi.type)?.delete(poiId);
    this.poiByCategory.get(poi.category)?.delete(poiId);
  }

  /**
   * Create and register a POI
   */
  createPOI(data: CreatePOIData): POI {
    this.idCounter++;
    const id = `poi_${data.type}_${data.chunkX}_${data.chunkY}_${this.idCounter}`;

    const poi: POI = {
      id,
      name: data.name,
      type: data.type,
      category: POI_TYPE_TO_CATEGORY[data.type],
      position: data.position,
      chunkX: data.chunkX,
      chunkY: data.chunkY,
      description: data.description,
      interactionRadius: data.interactionRadius ?? DEFAULT_INTERACTION_RADIUS,
      isAccessible: true,
      schedule: data.schedule,
      capacity: data.capacity ?? 0,
      occupants: [],
      ownerId: data.ownerId,
      tags: data.tags ?? [],
      metadata: data.metadata,
    };

    this.register(poi);
    return poi;
  }

  // ============================================================================
  // Queries
  // ============================================================================

  /**
   * Get a POI by ID
   */
  get(poiId: string): POI | undefined {
    return this.pois.get(poiId);
  }

  /**
   * Check if POI exists
   */
  has(poiId: string): boolean {
    return this.pois.has(poiId);
  }

  /**
   * Get POIs by type
   */
  getByType(type: POIType): POI[] {
    const ids = this.poiByType.get(type);
    if (!ids) return [];
    return Array.from(ids).map((id) => this.pois.get(id)!).filter(Boolean);
  }

  /**
   * Get POIs by category
   */
  getByCategory(category: POICategory): POI[] {
    const ids = this.poiByCategory.get(category);
    if (!ids) return [];
    return Array.from(ids).map((id) => this.pois.get(id)!).filter(Boolean);
  }

  /**
   * Get POIs in a chunk
   */
  getInChunk(chunkX: number, chunkY: number): POI[] {
    const chunkKey = `${chunkX},${chunkY}`;
    const ids = this.poiByChunk.get(chunkKey);
    if (!ids) return [];
    return Array.from(ids).map((id) => this.pois.get(id)!).filter(Boolean);
  }

  /**
   * Query POIs with flexible filtering
   */
  query(options: POIQueryOptions = {}): POIQueryResult {
    const startTime = performance.now();
    const results: POIWithDistance[] = [];

    // Determine candidates
    let candidates: POI[];
    if (options.types && options.types.length > 0) {
      candidates = [];
      for (const type of options.types) {
        candidates.push(...this.getByType(type));
      }
    } else if (options.categories && options.categories.length > 0) {
      candidates = [];
      for (const category of options.categories) {
        candidates.push(...this.getByCategory(category));
      }
    } else if (options.chunkX !== undefined && options.chunkY !== undefined) {
      candidates = this.getInChunk(options.chunkX, options.chunkY);
    } else {
      candidates = Array.from(this.pois.values());
    }

    // Apply filters
    for (const poi of candidates) {
      // Accessible filter
      if (options.accessibleOnly && !poi.isAccessible) continue;

      // Tags filter
      if (options.tags && options.tags.length > 0) {
        const hasTag = options.tags.some(tag => poi.tags.includes(tag));
        if (!hasTag) continue;
      }

      // Capacity filter
      if (options.hasCapacity) {
        const currentOccupants = poi.occupants?.length ?? 0;
        const maxCapacity = poi.capacity ?? Infinity;
        if (currentOccupants >= maxCapacity) continue;
      }

      // Distance calculation and filter
      let distance = 0;
      if (options.fromPosition) {
        distance = this.calculateDistance(options.fromPosition, poi.position);
        if (options.maxDistance !== undefined && distance > options.maxDistance) {
          continue;
        }
      }

      results.push({ poi, distance });
    }

    // Sort by distance
    if (options.sortByDistance && options.fromPosition) {
      results.sort((a, b) => a.distance - b.distance);
    }

    // Apply limit
    const finalResults = options.limit
      ? results.slice(0, options.limit)
      : results;

    return {
      pois: finalResults,
      totalCount: results.length,
      queryTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Find the nearest POI of a given type
   */
  findNearest(position: POIPosition, type?: POIType, maxDistance?: number): POI | null {
    const result = this.query({
      types: type ? [type] : undefined,
      fromPosition: position,
      maxDistance,
      sortByDistance: true,
      limit: 1,
    });

    return result.pois[0]?.poi ?? null;
  }

  /**
   * Find the nearest shelter POI
   */
  findNearestShelter(position: POIPosition): POI | null {
    let nearest: POI | null = null;
    let nearestDist = Infinity;

    for (const poi of this.pois.values()) {
      if (!SHELTER_POI_TYPES.has(poi.type)) continue;

      const dist = this.calculateDistance(position, poi.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = poi;
      }
    }

    return nearest;
  }

  /**
   * Find POIs within a radius
   */
  findWithinRadius(position: POIPosition, radius: number): POI[] {
    const result = this.query({
      fromPosition: position,
      maxDistance: radius,
      sortByDistance: true,
    });

    return result.pois.map(p => p.poi);
  }

  /**
   * Check if a position is at a POI
   */
  isAtPOI(position: POIPosition, poiId: string): boolean {
    const poi = this.pois.get(poiId);
    if (!poi) return false;

    const dist = this.calculateDistance(position, poi.position);
    return dist <= poi.interactionRadius;
  }

  // ============================================================================
  // Occupancy
  // ============================================================================

  /**
   * Enter a POI
   */
  enterPOI(npcId: number, poiId: string): boolean {
    const poi = this.pois.get(poiId);
    if (!poi) return false;

    if (!poi.occupants) {
      poi.occupants = [];
    }

    if (poi.capacity && poi.capacity > 0 && poi.occupants.length >= poi.capacity) {
      return false;
    }

    if (!poi.occupants.includes(npcId)) {
      poi.occupants.push(npcId);
    }
    return true;
  }

  /**
   * Leave a POI
   */
  leavePOI(npcId: number, poiId: string): void {
    const poi = this.pois.get(poiId);
    if (poi && poi.occupants) {
      const index = poi.occupants.indexOf(npcId);
      if (index >= 0) {
        poi.occupants.splice(index, 1);
      }
    }
  }

  /**
   * Check if a POI has available capacity
   */
  hasCapacity(poiId: string): boolean {
    const poi = this.pois.get(poiId);
    if (!poi) return false;
    if (!poi.capacity || poi.capacity === 0) return true;
    return (poi.occupants?.length ?? 0) < poi.capacity;
  }

  // ============================================================================
  // NPC Assignments
  // ============================================================================

  /**
   * Get or create NPC POI assignments
   */
  getOrCreateAssignments(npcId: number): NPCPOIAssignments {
    let assignments = this.npcAssignments.get(npcId);
    if (!assignments) {
      assignments = {
        npcId,
        home: null,
        workplace: null,
        socialSpots: [],
        frequentedPOIs: [],
        occupationPOIs: [],
      };
      this.npcAssignments.set(npcId, assignments);
    }
    return assignments;
  }

  /**
   * Get NPC assignments
   */
  getAssignments(npcId: number): NPCPOIAssignments | undefined {
    return this.npcAssignments.get(npcId);
  }

  /**
   * Get NPC assignment (legacy interface)
   */
  getNPCAssignment(npcId: number): NPCPOIAssignment | undefined {
    const assignments = this.npcAssignments.get(npcId);
    if (!assignments) return undefined;

    // Convert to legacy format
    return {
      npcId: assignments.npcId,
      homeId: assignments.home,
      workplaceId: assignments.workplace,
      socialSpots: assignments.socialSpots,
      frequentedPOIs: assignments.frequentedPOIs,
    };
  }

  /**
   * Assign a home to an NPC
   */
  assignHome(npcId: number, poiId: string): boolean {
    const poi = this.pois.get(poiId);
    if (!poi) return false;

    const assignments = this.getOrCreateAssignments(npcId);
    assignments.home = poiId;
    poi.ownerId = npcId;

    return true;
  }

  /**
   * Assign a workplace to an NPC
   */
  assignWorkplace(npcId: number, poiId: string): boolean {
    const poi = this.pois.get(poiId);
    if (!poi) return false;

    const assignments = this.getOrCreateAssignments(npcId);
    assignments.workplace = poiId;

    return true;
  }

  /**
   * Add a social spot to an NPC
   */
  addSocialSpot(npcId: number, poiId: string): boolean {
    const poi = this.pois.get(poiId);
    if (!poi) return false;

    const assignments = this.getOrCreateAssignments(npcId);
    if (!assignments.socialSpots.includes(poiId)) {
      assignments.socialSpots.push(poiId);
    }

    return true;
  }

  /**
   * Clear NPC assignments
   */
  clearAssignments(npcId: number): void {
    this.npcAssignments.delete(npcId);
  }

  /**
   * Assign POIs to an NPC based on backstory and occupation (legacy interface)
   */
  assignNPCPOIs(
    npcId: number,
    backstory: string,
    occupation: string,
    position: POIPosition
  ): NPCPOIAssignment {
    const assignments = this.getOrCreateAssignments(npcId);

    // Find or assign home
    const nearbyHomes = this.findWithinRadius(position, 100)
      .filter(poi => poi.type === POIType.Home && !poi.ownerId);
    if (nearbyHomes.length > 0 && nearbyHomes[0]) {
      this.assignHome(npcId, nearbyHomes[0].id);
    }

    // Find social spots
    const socialPOIs = this.getByCategory(POICategory.Social)
      .map(poi => ({
        poi,
        dist: this.calculateDistance(position, poi.position),
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3);

    for (const { poi } of socialPOIs) {
      this.addSocialSpot(npcId, poi.id);
    }

    return this.getNPCAssignment(npcId)!;
  }

  // ============================================================================
  // Chunk Loading
  // ============================================================================

  /**
   * Load POIs from a chunk's poiBlob
   */
  loadFromChunk(chunkX: number, chunkY: number, poiBlob: Uint8Array): POI[] {
    if (!poiBlob || poiBlob.length === 0) {
      return [];
    }

    try {
      const decoder = new TextDecoder();
      const json = decoder.decode(poiBlob);
      const serialized = JSON.parse(json) as SerializedPOI[];

      if (!Array.isArray(serialized)) {
        console.warn(`Invalid POI blob for chunk (${chunkX}, ${chunkY})`);
        return [];
      }

      const loaded: POI[] = [];
      for (const s of serialized) {
        const poi = this.deserializePOI(s, chunkX, chunkY);
        if (poi) {
          this.register(poi);
          loaded.push(poi);
        }
      }

      console.log(`Loaded ${loaded.length} POIs from chunk (${chunkX}, ${chunkY})`);
      return loaded;
    } catch (error) {
      console.warn(`Failed to parse POI blob for chunk (${chunkX}, ${chunkY}):`, error);
      return [];
    }
  }

  /**
   * Unload POIs from a chunk
   */
  unloadChunk(chunkX: number, chunkY: number): number {
    const chunkKey = `${chunkX},${chunkY}`;
    const poiIds = this.poiByChunk.get(chunkKey);

    if (!poiIds) return 0;

    const count = poiIds.size;
    for (const id of Array.from(poiIds)) {
      this.unregister(id);
    }

    this.poiByChunk.delete(chunkKey);
    console.log(`Unloaded ${count} POIs from chunk (${chunkX}, ${chunkY})`);
    return count;
  }

  /**
   * Deserialize a POI from chunk blob format
   */
  private deserializePOI(s: SerializedPOI, chunkX: number, chunkY: number): POI | null {
    try {
      const type = s.t as POIType;
      if (!Object.values(POIType).includes(type)) {
        console.warn(`Unknown POI type: ${s.t}`);
        return null;
      }

      const poi: POI = {
        id: s.id,
        name: s.n,
        type,
        category: POI_TYPE_TO_CATEGORY[type],
        position: { x: s.x, y: s.y, z: s.z },
        chunkX,
        chunkY,
        interactionRadius: s.r ?? DEFAULT_INTERACTION_RADIUS,
        isAccessible: true,
        capacity: s.cap,
        ownerId: s.own,
        tags: s.tags ?? [],
        metadata: s.meta,
      };

      if (s.s) {
        poi.schedule = {
          openHour: s.s.o,
          closeHour: s.s.c,
          daysOpen: s.s.d,
        };
      }

      return poi;
    } catch (error) {
      console.warn('Failed to deserialize POI:', error);
      return null;
    }
  }

  // ============================================================================
  // Utility
  // ============================================================================

  /**
   * Calculate distance between two positions
   */
  private calculateDistance(a: POIPosition, b: POIPosition): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Get all POIs
   */
  getAll(): POI[] {
    return Array.from(this.pois.values());
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalPOIs: number;
    byType: Record<string, number>;
    byCategory: Record<string, number>;
    loadedChunks: number;
    assignedNPCs: number;
  } {
    const byType: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    for (const [type, ids] of this.poiByType) {
      byType[type] = ids.size;
    }
    for (const [category, ids] of this.poiByCategory) {
      byCategory[category] = ids.size;
    }

    return {
      totalPOIs: this.pois.size,
      byType,
      byCategory,
      loadedChunks: this.poiByChunk.size,
      assignedNPCs: this.npcAssignments.size,
    };
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.pois.clear();
    this.poiByChunk.clear();
    for (const set of this.poiByType.values()) {
      set.clear();
    }
    for (const set of this.poiByCategory.values()) {
      set.clear();
    }
    this.npcAssignments.clear();
    this.idCounter = 0;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const poiRegistry = new POIRegistry();
