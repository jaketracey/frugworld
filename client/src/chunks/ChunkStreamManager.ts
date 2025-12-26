/**
 * ChunkStreamManager - Handles chunk loading, streaming, and prefetching
 * Implements Section 5.4 and Section 18 of the architecture spec
 *
 * Responsibilities:
 * - Track player position and determine needed chunks
 * - Send ChunkSubscribe requests to server
 * - Manage chunk lifecycle (load, unload)
 * - Prefetch outer ring for smooth streaming
 */

import type { ChunkCoord, ChunkSubscribe } from '@/types/protocol.ts';
import { ClientMessageType } from '@/types/protocol.ts';

export interface ChunkStreamConfig {
  /** Size of chunk in world units (default 64m per spec) */
  chunkSize: number;
  /** Radius of chunks to keep loaded around player */
  loadRadius: number;
  /** Additional radius for prefetching (outer ring) */
  prefetchRadius: number;
  /** How often to check for chunk updates (ms) */
  updateIntervalMs: number;
  /** Minimum player movement before recalculating chunks */
  minMoveThreshold: number;
}

export interface ChunkPosition {
  cx: ChunkCoord;
  cy: ChunkCoord;
}

const DEFAULT_CONFIG: ChunkStreamConfig = {
  chunkSize: 64,
  loadRadius: 3,      // 3 chunks = ~192m visibility
  prefetchRadius: 5,  // 5 chunks for prefetching
  updateIntervalMs: 500,
  minMoveThreshold: 16, // 16m before rechecking
};

export type ChunkSubscribeCallback = (message: ChunkSubscribe) => void;
export type ChunkLoadCallback = (cx: ChunkCoord, cy: ChunkCoord) => void;
export type ChunkUnloadCallback = (cx: ChunkCoord, cy: ChunkCoord) => void;

export class ChunkStreamManager {
  private config: ChunkStreamConfig;

  // Loaded chunk tracking
  private loadedChunks: Set<string> = new Set();
  private pendingChunks: Set<string> = new Set();
  private requestedChunks: Set<string> = new Set();

  // Player position tracking
  private lastPlayerX: number = 0;
  private lastPlayerY: number = 0;
  private lastCheckTime: number = 0;
  private playerId: number = 0;

  // Callbacks
  private onSubscribe: ChunkSubscribeCallback | null = null;
  private onChunkLoad: ChunkLoadCallback | null = null;
  private onChunkUnload: ChunkUnloadCallback | null = null;

  constructor(config: Partial<ChunkStreamConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set callback for sending chunk subscription requests to server
   */
  setSubscribeCallback(callback: ChunkSubscribeCallback): void {
    this.onSubscribe = callback;
  }

  /**
   * Set callback when chunk data is received and should be loaded
   */
  setChunkLoadCallback(callback: ChunkLoadCallback): void {
    this.onChunkLoad = callback;
  }

  /**
   * Set callback when chunk should be unloaded
   */
  setChunkUnloadCallback(callback: ChunkUnloadCallback): void {
    this.onChunkUnload = callback;
  }

  /**
   * Set player ID for subscription messages
   */
  setPlayerId(id: number): void {
    this.playerId = id;
  }

  /**
   * Update player position and trigger chunk loading/unloading as needed
   */
  updatePlayerPosition(x: number, y: number): void {
    const now = performance.now();

    // Check if we should update
    const dx = x - this.lastPlayerX;
    const dy = y - this.lastPlayerY;
    const distMoved = Math.sqrt(dx * dx + dy * dy);

    const shouldUpdate =
      distMoved >= this.config.minMoveThreshold ||
      now - this.lastCheckTime >= this.config.updateIntervalMs;

    if (!shouldUpdate) {
      return;
    }

    this.lastPlayerX = x;
    this.lastPlayerY = y;
    this.lastCheckTime = now;

    // Calculate needed chunks
    const neededChunks = this.calculateNeededChunks(x, y, this.config.loadRadius);
    const prefetchChunks = this.calculateNeededChunks(x, y, this.config.prefetchRadius);

    // Determine chunks to load
    const chunksToRequest: ChunkPosition[] = [];

    for (const chunk of neededChunks) {
      const key = this.chunkKey(chunk.cx, chunk.cy);
      if (!this.loadedChunks.has(key) && !this.pendingChunks.has(key)) {
        chunksToRequest.push(chunk);
        this.pendingChunks.add(key);
      }
    }

    // Add prefetch chunks (lower priority)
    for (const chunk of prefetchChunks) {
      const key = this.chunkKey(chunk.cx, chunk.cy);
      if (!this.loadedChunks.has(key) && !this.pendingChunks.has(key)) {
        chunksToRequest.push(chunk);
        this.pendingChunks.add(key);
      }
    }

    // Request chunks from server
    if (chunksToRequest.length > 0 && this.onSubscribe) {
      const message: ChunkSubscribe = {
        type: ClientMessageType.ChunkSubscribe,
        playerId: this.playerId,
        chunks: chunksToRequest,
      };
      this.onSubscribe(message);

      // Track requested chunks
      for (const chunk of chunksToRequest) {
        this.requestedChunks.add(this.chunkKey(chunk.cx, chunk.cy));
      }
    }

    // Unload chunks outside prefetch radius
    this.unloadDistantChunks(x, y);
  }

  /**
   * Called when chunk data is received from server
   */
  onChunkReceived(cx: ChunkCoord, cy: ChunkCoord): void {
    const key = this.chunkKey(cx, cy);
    this.pendingChunks.delete(key);
    this.requestedChunks.delete(key);
    this.loadedChunks.add(key);

    this.onChunkLoad?.(cx, cy);
  }

  /**
   * Check if a chunk is loaded
   */
  isChunkLoaded(cx: ChunkCoord, cy: ChunkCoord): boolean {
    return this.loadedChunks.has(this.chunkKey(cx, cy));
  }

  /**
   * Check if a chunk is pending (requested but not received)
   */
  isChunkPending(cx: ChunkCoord, cy: ChunkCoord): boolean {
    return this.pendingChunks.has(this.chunkKey(cx, cy));
  }

  /**
   * Get player's current chunk coordinates
   */
  getPlayerChunk(): ChunkPosition {
    return this.worldToChunk(this.lastPlayerX, this.lastPlayerY);
  }

  /**
   * Convert world position to chunk coordinates
   */
  worldToChunk(x: number, y: number): ChunkPosition {
    return {
      cx: Math.floor(x / this.config.chunkSize),
      cy: Math.floor(y / this.config.chunkSize),
    };
  }

  /**
   * Convert chunk coordinates to world center position
   */
  chunkToWorld(cx: ChunkCoord, cy: ChunkCoord): { x: number; y: number } {
    return {
      x: cx * this.config.chunkSize + this.config.chunkSize / 2,
      y: cy * this.config.chunkSize + this.config.chunkSize / 2,
    };
  }

  /**
   * Get loaded chunk count
   */
  getLoadedCount(): number {
    return this.loadedChunks.size;
  }

  /**
   * Get pending chunk count
   */
  getPendingCount(): number {
    return this.pendingChunks.size;
  }

  /**
   * Get statistics
   */
  getStats(): {
    loaded: number;
    pending: number;
    playerChunk: ChunkPosition;
  } {
    return {
      loaded: this.loadedChunks.size,
      pending: this.pendingChunks.size,
      playerChunk: this.getPlayerChunk(),
    };
  }

  /**
   * Force reload all chunks (on reconnect)
   */
  reset(): void {
    this.loadedChunks.clear();
    this.pendingChunks.clear();
    this.requestedChunks.clear();
    this.lastCheckTime = 0;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private calculateNeededChunks(
    centerX: number,
    centerY: number,
    radius: number
  ): ChunkPosition[] {
    const centerChunk = this.worldToChunk(centerX, centerY);
    const chunks: ChunkPosition[] = [];

    // Generate spiral pattern from center outward for optimal loading order
    for (let r = 0; r <= radius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          // Only add chunks at current ring radius
          if (Math.max(Math.abs(dx), Math.abs(dy)) === r) {
            chunks.push({
              cx: centerChunk.cx + dx,
              cy: centerChunk.cy + dy,
            });
          }
        }
      }
    }

    // Also ensure center chunk is first
    const centerKey = this.chunkKey(centerChunk.cx, centerChunk.cy);
    const centerIdx = chunks.findIndex(
      c => this.chunkKey(c.cx, c.cy) === centerKey
    );
    if (centerIdx > 0) {
      const [center] = chunks.splice(centerIdx, 1);
      chunks.unshift(center);
    }

    return chunks;
  }

  private unloadDistantChunks(playerX: number, playerY: number): void {
    const unloadRadius = this.config.prefetchRadius + 1;
    const playerChunk = this.worldToChunk(playerX, playerY);

    const chunksToUnload: string[] = [];

    for (const key of this.loadedChunks) {
      const [cx, cy] = key.split(',').map(Number);
      const dx = Math.abs(cx - playerChunk.cx);
      const dy = Math.abs(cy - playerChunk.cy);

      if (dx > unloadRadius || dy > unloadRadius) {
        chunksToUnload.push(key);
        this.onChunkUnload?.(cx, cy);
      }
    }

    for (const key of chunksToUnload) {
      this.loadedChunks.delete(key);
    }
  }

  private chunkKey(cx: ChunkCoord, cy: ChunkCoord): string {
    return `${cx},${cy}`;
  }
}
