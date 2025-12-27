/**
 * SelectionManager - Handles drag-to-select for multiple entities
 * Tracks mouse drag state, calculates selection bounds, finds entities within
 */

import * as THREE from 'three';
import type { Entity } from '@/ecs/Entity.ts';
import { EntityKind } from '@/types/protocol.ts';

export interface SelectionManagerConfig {
  /** Pixels to differentiate click vs drag */
  dragThreshold: number;
}

export interface SelectionBox {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface SelectionState {
  isSelecting: boolean;
  startScreenPos: { x: number; y: number } | null;
  currentScreenPos: { x: number; y: number } | null;
  selectedEntityIds: Set<number>;
}

const DEFAULT_CONFIG: SelectionManagerConfig = {
  dragThreshold: 5,
};

export class SelectionManager {
  private config: SelectionManagerConfig;
  private state: SelectionState;

  constructor(config: Partial<SelectionManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = {
      isSelecting: false,
      startScreenPos: null,
      currentScreenPos: null,
      selectedEntityIds: new Set(),
    };
  }

  /**
   * Handle mouse down - start potential selection
   */
  onMouseDown(event: MouseEvent): void {
    this.state.isSelecting = true;
    this.state.startScreenPos = { x: event.clientX, y: event.clientY };
    this.state.currentScreenPos = { x: event.clientX, y: event.clientY };
    this.state.selectedEntityIds.clear();
  }

  /**
   * Handle mouse move - update selection box
   */
  onMouseMove(event: MouseEvent): void {
    if (!this.state.isSelecting) return;
    this.state.currentScreenPos = { x: event.clientX, y: event.clientY };
  }

  /**
   * Handle mouse up - finalize selection
   * Returns true if this was a drag (not a click)
   */
  onMouseUp(event: MouseEvent): boolean {
    if (!this.state.isSelecting || !this.state.startScreenPos) {
      this.reset();
      return false;
    }

    this.state.currentScreenPos = { x: event.clientX, y: event.clientY };

    const wasDrag = this.isDrag();

    this.state.isSelecting = false;

    return wasDrag;
  }

  /**
   * Check if current gesture is a drag (vs click)
   */
  isDrag(): boolean {
    if (!this.state.startScreenPos || !this.state.currentScreenPos) {
      return false;
    }

    const dx = this.state.currentScreenPos.x - this.state.startScreenPos.x;
    const dy = this.state.currentScreenPos.y - this.state.startScreenPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    return distance > this.config.dragThreshold;
  }

  /**
   * Check if currently selecting
   */
  isSelecting(): boolean {
    return this.state.isSelecting;
  }

  /**
   * Get current selection box bounds
   */
  getSelectionBox(): SelectionBox {
    const start = this.state.startScreenPos ?? { x: 0, y: 0 };
    const end = this.state.currentScreenPos ?? { x: 0, y: 0 };

    return {
      startX: start.x,
      startY: start.y,
      endX: end.x,
      endY: end.y,
    };
  }

  /**
   * Find all NPC entities within the selection box
   */
  findEntitiesInBounds(
    entities: IterableIterator<Entity>,
    camera: THREE.Camera,
    canvas: HTMLCanvasElement
  ): Entity[] {
    if (!this.state.startScreenPos || !this.state.currentScreenPos) {
      return [];
    }

    const rect = canvas.getBoundingClientRect();

    // Calculate normalized selection bounds
    const minX = Math.min(this.state.startScreenPos.x, this.state.currentScreenPos.x);
    const maxX = Math.max(this.state.startScreenPos.x, this.state.currentScreenPos.x);
    const minY = Math.min(this.state.startScreenPos.y, this.state.currentScreenPos.y);
    const maxY = Math.max(this.state.startScreenPos.y, this.state.currentScreenPos.y);

    const selected: Entity[] = [];
    const worldPos = new THREE.Vector3();

    for (const entity of entities) {
      // Only select NPCs
      if (entity.kind !== EntityKind.Npc) continue;
      if (!entity.alive || entity.markedForRemoval) continue;

      // Get entity world position
      const transform = entity.transform.getInterpolated();

      // Note: game uses x/y for horizontal plane, z for height
      // Three.js uses x/z for horizontal plane, y for height
      worldPos.set(transform.x, transform.z, transform.y);

      // Project to screen coordinates
      worldPos.project(camera);

      // Convert from NDC (-1 to +1) to screen pixels
      const screenX = (worldPos.x * 0.5 + 0.5) * rect.width + rect.left;
      const screenY = (-worldPos.y * 0.5 + 0.5) * rect.height + rect.top;

      // Check if within selection box
      if (screenX >= minX && screenX <= maxX && screenY >= minY && screenY <= maxY) {
        selected.push(entity);
        this.state.selectedEntityIds.add(entity.id);
      }
    }

    return selected;
  }

  /**
   * Get currently selected entity IDs
   */
  getSelectedEntityIds(): Set<number> {
    return new Set(this.state.selectedEntityIds);
  }

  /**
   * Clear selection
   */
  clearSelection(): void {
    this.state.selectedEntityIds.clear();
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.state.isSelecting = false;
    this.state.startScreenPos = null;
    this.state.currentScreenPos = null;
    this.state.selectedEntityIds.clear();
  }
}
