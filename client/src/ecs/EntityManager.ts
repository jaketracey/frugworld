/**
 * Entity manager for spawning, updating, and despawning entities
 */

import type {
  EntityId,
  EntityData,
  TransformData,
  LODChange,
} from '@/types/protocol.ts';
import { Entity } from './Entity.ts';

export type EntitySpawnCallback = (entity: Entity) => void;
export type EntityDespawnCallback = (entity: Entity) => void;

export class EntityManager {
  private entities: Map<EntityId, Entity> = new Map();
  private localPlayerId: EntityId | null = null;

  // Callbacks for render integration
  private onSpawn: EntitySpawnCallback | null = null;
  private onDespawn: EntityDespawnCallback | null = null;

  /**
   * Set callback for entity spawning (for renderer integration)
   */
  setSpawnCallback(callback: EntitySpawnCallback): void {
    this.onSpawn = callback;
  }

  /**
   * Set callback for entity despawning (for renderer integration)
   */
  setDespawnCallback(callback: EntityDespawnCallback): void {
    this.onDespawn = callback;
  }

  /**
   * Set the local player's entity ID
   */
  setLocalPlayerId(id: EntityId): void {
    this.localPlayerId = id;
  }

  /**
   * Get the local player entity
   */
  getLocalPlayer(): Entity | null {
    if (this.localPlayerId === null) {
      return null;
    }
    return this.entities.get(this.localPlayerId) ?? null;
  }

  /**
   * Get entity by ID
   */
  get(id: EntityId): Entity | undefined {
    return this.entities.get(id);
  }

  /**
   * Check if entity exists
   */
  has(id: EntityId): boolean {
    return this.entities.has(id);
  }

  /**
   * Spawn a new entity from server data
   */
  spawn(data: EntityData): Entity {
    // Check if entity already exists
    if (this.entities.has(data.entityId)) {
      const existing = this.entities.get(data.entityId)!;
      // Update existing entity data
      existing.archetypeId = data.archetypeId;
      existing.zoneId = data.zoneId;
      existing.chunkX = data.chunkX;
      existing.chunkY = data.chunkY;
      existing.alive = data.alive;
      existing.markedForRemoval = false;
      return existing;
    }

    // Create new entity
    const entity = new Entity(
      data.entityId,
      data.kind,
      data.archetypeId,
      data.zoneId,
      data.chunkX,
      data.chunkY
    );
    entity.alive = data.alive;

    this.entities.set(data.entityId, entity);

    // Notify renderer
    this.onSpawn?.(entity);

    return entity;
  }

  /**
   * Spawn multiple entities
   */
  spawnBatch(dataList: EntityData[]): Entity[] {
    return dataList.map((data) => this.spawn(data));
  }

  /**
   * Despawn an entity by ID
   */
  despawn(id: EntityId): boolean {
    const entity = this.entities.get(id);
    if (!entity) {
      return false;
    }

    entity.markForRemoval();

    // Notify renderer
    this.onDespawn?.(entity);

    this.entities.delete(id);
    return true;
  }

  /**
   * Despawn multiple entities
   */
  despawnBatch(ids: EntityId[]): void {
    for (const id of ids) {
      this.despawn(id);
    }
  }

  /**
   * Update entity transforms from server data
   */
  updateTransforms(transforms: TransformData[]): void {
    for (const data of transforms) {
      const entity = this.entities.get(data.entityId);
      if (entity) {
        entity.transform.addSnapshot(data.lastTick, data.transform);
      }
    }
  }

  /**
   * Update entity LOD from server data
   */
  updateLODs(changes: LODChange[]): void {
    for (const change of changes) {
      const entity = this.entities.get(change.entityId);
      if (entity) {
        entity.lod.setLOD(change.newLod);
      }
    }
  }

  /**
   * Update all entities (interpolation, transitions)
   */
  update(deltaMs: number, renderTime: number): void {
    for (const entity of this.entities.values()) {
      if (!entity.markedForRemoval) {
        entity.update(deltaMs, renderTime);
      }
    }
  }

  /**
   * Update LOD for all entities based on player position
   */
  updateLODsFromPlayerPosition(playerX: number, playerY: number): void {
    for (const entity of this.entities.values()) {
      if (entity.id === this.localPlayerId) {
        continue;
      }

      const distance = entity.distanceTo2D(playerX, playerY);
      const computedLOD = entity.lod.computeLODFromDistance(distance);

      // Apply client-side LOD computation
      // Server LOD updates will override this when received via updateLODs()
      entity.lod.setLOD(computedLOD);
    }
  }

  /**
   * Get all entities
   */
  getAll(): IterableIterator<Entity> {
    return this.entities.values();
  }

  /**
   * Get entities by kind
   */
  getByKind(kind: number): Entity[] {
    const result: Entity[] = [];
    for (const entity of this.entities.values()) {
      if (entity.kind === kind) {
        result.push(entity);
      }
    }
    return result;
  }

  /**
   * Get entities in a chunk
   */
  getInChunk(chunkX: number, chunkY: number): Entity[] {
    const result: Entity[] = [];
    for (const entity of this.entities.values()) {
      if (entity.chunkX === chunkX && entity.chunkY === chunkY) {
        result.push(entity);
      }
    }
    return result;
  }

  /**
   * Get count of entities
   */
  count(): number {
    return this.entities.size;
  }

  /**
   * Clear all entities
   */
  clear(): void {
    for (const entity of this.entities.values()) {
      this.onDespawn?.(entity);
    }
    this.entities.clear();
    this.localPlayerId = null;
  }

  /**
   * Get entity statistics
   */
  getStats(): {
    total: number;
    byLOD: Record<number, number>;
    alive: number;
    markedForRemoval: number;
  } {
    const stats = {
      total: this.entities.size,
      byLOD: { 0: 0, 1: 0, 2: 0, 3: 0 } as Record<number, number>,
      alive: 0,
      markedForRemoval: 0,
    };

    for (const entity of this.entities.values()) {
      stats.byLOD[entity.lod.getLOD()]++;
      if (entity.alive) stats.alive++;
      if (entity.markedForRemoval) stats.markedForRemoval++;
    }

    return stats;
  }
}
