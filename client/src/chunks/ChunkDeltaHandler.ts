/**
 * ChunkDeltaHandler - Applies persistent changes to chunks
 * Implements Section 5.3 of the architecture spec
 *
 * Delta types include:
 * - NPC built structures
 * - Door states
 * - Shop inventory changes
 * - Destroyed objects (trees, etc.)
 */

import type { ChunkData } from '@/types/protocol.ts';

export interface ChunkDelta {
  type: DeltaType;
  localX: number;
  localY: number;
  localZ: number;
  data: unknown;
  timestamp: number;
}

export enum DeltaType {
  ObjectPlaced = 'object_placed',
  ObjectRemoved = 'object_removed',
  StateChanged = 'state_changed',
  TerrainModified = 'terrain_modified',
  InventoryChanged = 'inventory_changed',
}

export interface DeltaApplyResult {
  success: boolean;
  affectedObjects: string[];
  errors: string[];
}

export class ChunkDeltaHandler {
  // Cache of applied deltas per chunk
  private appliedDeltas: Map<string, ChunkDelta[]> = new Map();

  /**
   * Parse delta blob from chunk data
   */
  parseDeltas(deltaBlob: Uint8Array | undefined): ChunkDelta[] {
    if (!deltaBlob || deltaBlob.length === 0) {
      return [];
    }

    try {
      // Decode blob as JSON (could be changed to binary format later)
      const decoder = new TextDecoder();
      const json = decoder.decode(deltaBlob);
      const parsed = JSON.parse(json) as ChunkDelta[];

      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn('Failed to parse chunk deltas:', error);
      return [];
    }
  }

  /**
   * Apply deltas to a chunk
   */
  applyDeltas(
    chunkKey: string,
    deltas: ChunkDelta[],
    chunkData: ChunkData
  ): DeltaApplyResult {
    const result: DeltaApplyResult = {
      success: true,
      affectedObjects: [],
      errors: [],
    };

    // Store deltas for this chunk
    this.appliedDeltas.set(chunkKey, deltas);

    for (const delta of deltas) {
      try {
        const applied = this.applyDelta(chunkKey, delta);
        if (applied) {
          result.affectedObjects.push(`${delta.type}@${delta.localX},${delta.localY}`);
        }
      } catch (error) {
        result.success = false;
        result.errors.push(`Failed to apply delta ${delta.type}: ${error}`);
      }
    }

    return result;
  }

  /**
   * Apply a single delta
   */
  private applyDelta(chunkKey: string, delta: ChunkDelta): boolean {
    switch (delta.type) {
      case DeltaType.ObjectPlaced:
        return this.handleObjectPlaced(chunkKey, delta);
      case DeltaType.ObjectRemoved:
        return this.handleObjectRemoved(chunkKey, delta);
      case DeltaType.StateChanged:
        return this.handleStateChanged(chunkKey, delta);
      case DeltaType.TerrainModified:
        return this.handleTerrainModified(chunkKey, delta);
      case DeltaType.InventoryChanged:
        // Inventory changes don't affect visuals directly
        return true;
      default:
        console.warn(`Unknown delta type: ${delta.type}`);
        return false;
    }
  }

  /**
   * Handle object placement delta
   */
  private handleObjectPlaced(chunkKey: string, delta: ChunkDelta): boolean {
    // This would integrate with the chunk renderer to add objects
    // For now, we just track the delta
    console.log(`Object placed in ${chunkKey} at (${delta.localX}, ${delta.localY})`);
    return true;
  }

  /**
   * Handle object removal delta
   */
  private handleObjectRemoved(chunkKey: string, delta: ChunkDelta): boolean {
    // This would integrate with the chunk renderer to remove objects
    console.log(`Object removed in ${chunkKey} at (${delta.localX}, ${delta.localY})`);
    return true;
  }

  /**
   * Handle state change delta (e.g., door open/closed)
   */
  private handleStateChanged(chunkKey: string, delta: ChunkDelta): boolean {
    const data = delta.data as { objectId?: string; newState?: unknown };
    console.log(`State changed in ${chunkKey}: ${data.objectId}`);
    return true;
  }

  /**
   * Handle terrain modification delta
   */
  private handleTerrainModified(chunkKey: string, delta: ChunkDelta): boolean {
    // This would modify terrain heightmap or materials
    console.log(`Terrain modified in ${chunkKey} at (${delta.localX}, ${delta.localY})`);
    return true;
  }

  /**
   * Get deltas applied to a chunk
   */
  getAppliedDeltas(chunkKey: string): ChunkDelta[] {
    return this.appliedDeltas.get(chunkKey) ?? [];
  }

  /**
   * Check if a chunk has deltas applied
   */
  hasDeltas(chunkKey: string): boolean {
    return this.appliedDeltas.has(chunkKey);
  }

  /**
   * Clear deltas for a chunk (when unloading)
   */
  clearChunk(chunkKey: string): void {
    this.appliedDeltas.delete(chunkKey);
  }

  /**
   * Clear all cached deltas
   */
  clear(): void {
    this.appliedDeltas.clear();
  }

  /**
   * Get statistics
   */
  getStats(): {
    chunksWithDeltas: number;
    totalDeltas: number;
  } {
    let totalDeltas = 0;
    for (const deltas of this.appliedDeltas.values()) {
      totalDeltas += deltas.length;
    }

    return {
      chunksWithDeltas: this.appliedDeltas.size,
      totalDeltas,
    };
  }
}
