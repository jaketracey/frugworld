/**
 * Entity class representing a game object with components
 */

import type { EntityId, EntityKind } from '@/types/protocol.ts';
import { TransformComponent } from './TransformComponent.ts';
import { LODComponent } from './LODComponent.ts';

export interface EntityComponents {
  transform: TransformComponent;
  lod: LODComponent;
}

export class Entity {
  public readonly id: EntityId;
  public readonly kind: EntityKind;
  public archetypeId: number;
  public zoneId: number;
  public chunkX: number;
  public chunkY: number;
  public alive: boolean;

  // Components
  public readonly transform: TransformComponent;
  public readonly lod: LODComponent;

  // Render state
  public renderObject: unknown = null; // Three.js Object3D reference
  public visible: boolean = true;
  public markedForRemoval: boolean = false;

  constructor(
    id: EntityId,
    kind: EntityKind,
    archetypeId: number = 0,
    zoneId: number = 0,
    chunkX: number = 0,
    chunkY: number = 0
  ) {
    this.id = id;
    this.kind = kind;
    this.archetypeId = archetypeId;
    this.zoneId = zoneId;
    this.chunkX = chunkX;
    this.chunkY = chunkY;
    this.alive = true;

    // Initialize components
    this.transform = new TransformComponent();
    this.lod = new LODComponent();
  }

  /**
   * Update entity components
   */
  update(deltaMs: number, renderTime: number): void {
    // Update interpolation
    this.transform.update(renderTime);

    // Update LOD transitions
    this.lod.update(deltaMs);

    // Update visibility based on LOD
    this.visible = this.lod.getVisualAlpha() > 0.01;
  }

  /**
   * Mark entity for removal (deferred cleanup)
   */
  markForRemoval(): void {
    this.markedForRemoval = true;
    this.alive = false;
  }

  /**
   * Get distance to a point
   */
  distanceTo(x: number, y: number, z: number): number {
    const t = this.transform.getInterpolated();
    const dx = t.x - x;
    const dy = t.y - y;
    const dz = t.z - z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Get 2D distance (ignoring height)
   */
  distanceTo2D(x: number, y: number): number {
    const t = this.transform.getInterpolated();
    const dx = t.x - x;
    const dy = t.y - y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}
