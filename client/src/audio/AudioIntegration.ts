/**
 * Audio Integration with SpacetimeDB
 *
 * Bridges the SpacetimeDB game state subscriptions to the procedural audio system.
 * This module listens to game events and translates them into audio parameters
 * for the MusicManager to process.
 */

import { musicManager, type GraphState, type PhysicsState, type RelationshipEvent, type NPCState as AudioNPCState } from './index.ts';
import type { NpcState, Entity, NpcBlueprintRow } from '../network/SpacetimeDBConnection.ts';
import { mapRangeClamped } from './utils/AudioMath.ts';

/**
 * Relationship type enum matching server definitions
 */
export enum RelationshipType {
  Stranger = 0,
  Acquaintance = 1,
  Friend = 2,
  CloseFriend = 3,
  Rival = 4,
  Enemy = 5,
  MentorStudent = 6,
}

/**
 * LOD states matching server definitions
 */
export enum LODState {
  LOD0_Interactive = 0,
  LOD1_Nearby = 1,
  LOD2_Far = 2,
  LOD3_Offline = 3,
}

/**
 * Life stage enum matching server personality system
 */
export enum LifeStage {
  Youth = 0,
  Adult = 1,
  Mature = 2,
  Elder = 3,
}

/**
 * Configuration for audio integration
 */
export interface AudioIntegrationConfig {
  /** Enable debug logging */
  debug?: boolean;
  /** Update rate in Hz (default: 8) */
  updateRateHz?: number;
  /** Enable spatial audio panning */
  spatialAudio?: boolean;
}

/**
 * Parsed NPC blueprint data
 */
interface ParsedBlueprint {
  name?: string;
  extraversion?: number;
  agreeableness?: number;
  lifeStage?: string;
}

/**
 * Tracked NPC data for audio
 */
interface TrackedNPC {
  entityId: bigint;
  lod: number;
  extraversion: number;
  agreeableness: number;
  lifeStage: string;
  lastUpdate: number;
}

/**
 * AudioIntegration class
 *
 * Manages the connection between SpacetimeDB game state and the audio system.
 * Call the event handlers from your SpacetimeDB subscription callbacks.
 */
export class AudioIntegration {
  private config: Required<AudioIntegrationConfig>;
  private isInitialized: boolean = false;
  private trackedNPCs: Map<string, TrackedNPC> = new Map();
  private blueprintCache: Map<string, ParsedBlueprint> = new Map();
  private entityKindMap: Map<string, number> = new Map();

  // Graph state aggregation
  private graphState: GraphState = {
    nodeCount: 0,
    averageVelocity: 0,
    dominantAgreeableness: 50,
    timeOfDay: 12,
  };

  // Physics state (placeholder - would come from force-directed graph)
  private physicsState: PhysicsState = {
    kineticEnergy: 0,
    springTension: 0.5,
    graphDiameter: 100,
    clusteringCoefficient: 0.5,
  };

  // Update throttling
  private lastGraphUpdate: number = 0;
  private updateIntervalMs: number;

  constructor(config: AudioIntegrationConfig = {}) {
    this.config = {
      debug: config.debug ?? false,
      updateRateHz: config.updateRateHz ?? 8,
      spatialAudio: config.spatialAudio ?? true,
    };
    this.updateIntervalMs = 1000 / this.config.updateRateHz;
  }

  /**
   * Initialize the audio integration
   * Must be called after user gesture for audio context
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;

    try {
      await musicManager.init();
      this.isInitialized = true;
      this.log('Audio integration initialized');
    } catch (error) {
      console.error('[AudioIntegration] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Start playing music
   */
  start(): void {
    if (!this.isInitialized) {
      console.warn('[AudioIntegration] Cannot start: not initialized');
      return;
    }
    musicManager.start();
    this.log('Audio started');
  }

  /**
   * Stop playing music
   */
  stop(): void {
    musicManager.stop();
    this.log('Audio stopped');
  }

  /**
   * Set the time of day for key modulation
   * @param hour - Hour of day (0-23)
   */
  setTimeOfDay(hour: number): void {
    this.graphState.timeOfDay = hour;
    this.throttledGraphUpdate();
  }

  // ========================================================================
  // SpacetimeDB Event Handlers
  // ========================================================================

  /**
   * Handle entity updates
   * Track entity kinds to identify NPCs
   */
  onEntityUpdate(entity: Entity): void {
    const entityIdStr = entity.entityId.toString();
    this.entityKindMap.set(entityIdStr, entity.kind);

    // Kind 1 is typically NPC
    if (entity.kind === 1) {
      this.updateGraphNodeCount();
    }
  }

  /**
   * Handle entity deletion
   */
  onEntityDelete(entity: Entity): void {
    const entityIdStr = entity.entityId.toString();
    this.entityKindMap.delete(entityIdStr);
    this.trackedNPCs.delete(entityIdStr);
    this.blueprintCache.delete(entityIdStr);
    this.updateGraphNodeCount();
  }

  /**
   * Handle NPC state updates
   * This is called when NPC state changes (LOD, goals, etc.)
   */
  onNpcStateUpdate(npcState: NpcState): void {
    const npcIdStr = npcState.npcId.toString();
    const existingNPC = this.trackedNPCs.get(npcIdStr);
    const blueprint = this.blueprintCache.get(npcIdStr);

    // Parse personality from blueprint if available
    const extraversion = blueprint?.extraversion ?? 50;
    const agreeableness = blueprint?.agreeableness ?? 50;
    const lifeStage = blueprint?.lifeStage ?? 'adult';

    const currentLod = npcState.lodState;
    const previousLod = existingNPC?.lod;

    // Update tracked NPC
    const trackedNPC: TrackedNPC = {
      entityId: npcState.npcId,
      lod: currentLod,
      extraversion,
      agreeableness,
      lifeStage,
      lastUpdate: Date.now(),
    };
    this.trackedNPCs.set(npcIdStr, trackedNPC);

    // Convert to audio NPC state
    const audioNPC: AudioNPCState = {
      id: Number(npcState.npcId),
      lod: currentLod,
      extraversion,
      agreeableness,
      lifeStage,
    };

    // Forward to music manager
    musicManager.onNPCUpdate(audioNPC);

    // Detect LOD transitions for audio events
    if (previousLod !== undefined && previousLod !== currentLod) {
      // LOD changed - check for proximity events
      if (previousLod > LODState.LOD1_Nearby && currentLod <= LODState.LOD1_Nearby) {
        // NPC entered close proximity (LOD0 or LOD1)
        this.log(`NPC ${npcIdStr} entered proximity (LOD${currentLod})`);
      } else if (previousLod <= LODState.LOD1_Nearby && currentLod > LODState.LOD1_Nearby) {
        // NPC left close proximity
        this.log(`NPC ${npcIdStr} exited proximity (LOD${currentLod})`);
      }
    }

    // Update dominant agreeableness from all tracked NPCs
    this.updateDominantAgreeableness();
  }

  /**
   * Handle NPC blueprint updates
   * Parse personality data for audio mapping
   */
  onNpcBlueprintUpdate(blueprint: NpcBlueprintRow): void {
    const npcIdStr = blueprint.npcId.toString();

    try {
      // Decode blueprint JSON
      const decoder = new TextDecoder();
      const jsonStr = decoder.decode(blueprint.blueprintJson);
      const data = JSON.parse(jsonStr);

      const parsed: ParsedBlueprint = {
        name: data.identity?.name,
        extraversion: data.personality?.extraversion ?? 50,
        agreeableness: data.personality?.agreeableness ?? 50,
        lifeStage: data.personality?.life_stage ?? 'adult',
      };

      this.blueprintCache.set(npcIdStr, parsed);
      this.log(`Cached blueprint for NPC ${npcIdStr}: ${parsed.name}`);

      // Update tracked NPC if exists
      const tracked = this.trackedNPCs.get(npcIdStr);
      if (tracked) {
        tracked.extraversion = parsed.extraversion ?? 50;
        tracked.agreeableness = parsed.agreeableness ?? 50;
        tracked.lifeStage = parsed.lifeStage ?? 'adult';
      }
    } catch {
      // Failed to parse blueprint
      this.log(`Failed to parse blueprint for NPC ${npcIdStr}`);
    }
  }

  /**
   * Handle relationship changes
   * @param event - Relationship event from the relationship table
   */
  onRelationshipChange(
    type: 'created' | 'updated' | 'deleted',
    npcId: bigint,
    relationshipType?: number,
    affinity?: number,
    trust?: number,
    previousType?: number
  ): void {
    let eventType: RelationshipEvent['type'];

    if (type === 'created') {
      eventType = 'created';
    } else if (type === 'deleted') {
      eventType = 'removed';
    } else if (previousType !== undefined && relationshipType !== undefined) {
      // Check if relationship was upgraded or degraded
      if (relationshipType > previousType) {
        eventType = 'upgraded';
      } else if (relationshipType < previousType) {
        eventType = 'degraded';
      } else {
        // Just a data update, not a type change
        return;
      }
    } else {
      return;
    }

    const relationshipTypeName = this.getRelationshipTypeName(relationshipType ?? 0);

    const event: RelationshipEvent = {
      type: eventType,
      relationshipType: relationshipTypeName,
      npcId: Number(npcId),
      affinity,
      trust,
    };

    musicManager.onRelationshipChange(event);
    this.log(`Relationship ${eventType}: NPC ${npcId} (${relationshipTypeName})`);
  }

  /**
   * Update physics state from force-directed graph simulation
   * Call this from your graph visualization component
   */
  updatePhysics(physics: Partial<PhysicsState>): void {
    Object.assign(this.physicsState, physics);
    musicManager.onPhysicsUpdate(this.physicsState);
  }

  /**
   * Update graph velocity from simulation
   * @param avgVelocity - Average node velocity (0-100)
   */
  setAverageVelocity(avgVelocity: number): void {
    this.graphState.averageVelocity = avgVelocity;
    this.throttledGraphUpdate();
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  private updateGraphNodeCount(): void {
    // Count NPCs from entity kind map
    let npcCount = 0;
    for (const kind of this.entityKindMap.values()) {
      if (kind === 1) npcCount++;
    }
    this.graphState.nodeCount = npcCount;
    this.throttledGraphUpdate();
  }

  private updateDominantAgreeableness(): void {
    if (this.trackedNPCs.size === 0) return;

    let totalAgreeableness = 0;
    let count = 0;

    for (const npc of this.trackedNPCs.values()) {
      // Weight by LOD (closer NPCs have more influence)
      const weight = npc.lod <= LODState.LOD1_Nearby ? 2 : 1;
      totalAgreeableness += npc.agreeableness * weight;
      count += weight;
    }

    this.graphState.dominantAgreeableness = count > 0 ? totalAgreeableness / count : 50;
    this.throttledGraphUpdate();
  }

  private throttledGraphUpdate(): void {
    const now = Date.now();
    if (now - this.lastGraphUpdate < this.updateIntervalMs) return;

    this.lastGraphUpdate = now;
    musicManager.onGraphStateUpdate(this.graphState);
  }

  private getRelationshipTypeName(type: number): string {
    switch (type) {
      case RelationshipType.Stranger:
        return 'stranger';
      case RelationshipType.Acquaintance:
        return 'acquaintance';
      case RelationshipType.Friend:
        return 'friend';
      case RelationshipType.CloseFriend:
        return 'closeFriend';
      case RelationshipType.Rival:
        return 'rival';
      case RelationshipType.Enemy:
        return 'enemy';
      case RelationshipType.MentorStudent:
        return 'mentorStudent';
      default:
        return 'stranger';
    }
  }

  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[AudioIntegration] ${message}`);
    }
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    musicManager.dispose();
    this.trackedNPCs.clear();
    this.blueprintCache.clear();
    this.entityKindMap.clear();
    this.isInitialized = false;
  }
}

/**
 * Singleton instance for convenient access
 */
export const audioIntegration = new AudioIntegration();

/**
 * Helper function to wire up SpacetimeDB events to audio
 *
 * Call this when setting up your SpacetimeDB connection:
 *
 * ```typescript
 * import { setupAudioIntegration } from './audio/AudioIntegration';
 *
 * const connection = new SpacetimeDBConnection({}, {
 *   ...setupAudioIntegration(),
 *   // your other event handlers
 * });
 * ```
 */
export function setupAudioIntegration() {
  return {
    onEntityUpdate: (entity: Entity) => audioIntegration.onEntityUpdate(entity),
    onEntityDelete: (entity: Entity) => audioIntegration.onEntityDelete(entity),
    onNpcStateUpdate: (npcState: NpcState) => audioIntegration.onNpcStateUpdate(npcState),
    onNpcBlueprintUpdate: (blueprint: NpcBlueprintRow) =>
      audioIntegration.onNpcBlueprintUpdate(blueprint),
  };
}
