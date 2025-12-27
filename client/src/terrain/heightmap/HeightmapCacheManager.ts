/**
 * Heightmap Cache Manager
 * Unified facade for multi-tier heightmap caching
 *
 * Provides:
 * - Fast memory cache (LRU) for active chunks
 * - Persistent IndexedDB storage for visited chunks
 * - Web Worker for non-blocking generation
 * - Automatic prefetching and cache warming
 */

import {
  HeightmapData,
  HEIGHTMAP_VERSION,
  CHUNK_SIZE,
  calculateHeightmapSize,
} from './HeightmapData';
import { generateNormalsFromHeights } from './HeightmapSerializer';
import { HeightmapMemoryCache, type MemoryCacheConfig } from './HeightmapCache';
import { HeightmapStorage, type StorageConfig } from './HeightmapStorage';
import { TerrainWorkerManager } from '../worker/TerrainWorkerManager';

/**
 * Load state for a chunk
 */
export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Configuration for cache manager
 */
export interface CacheManagerConfig {
  /** Memory cache configuration */
  memory: Partial<MemoryCacheConfig>;
  /** Storage configuration */
  storage: Partial<StorageConfig>;
  /** Heightmap resolution */
  resolution: number;
  /** Height scale */
  heightScale: number;
  /** Global terrain seed */
  globalSeed: number;
  /** Whether to generate normals */
  includeNormals: boolean;
  /** Radius for prefetching */
  prefetchRadius: number;
  /** Enable debug logging */
  debug: boolean;
}

const DEFAULT_CONFIG: CacheManagerConfig = {
  memory: {
    maxMemoryBytes: 32 * 1024 * 1024, // 32 MB
    hotZoneRadius: 3,
  },
  storage: {
    maxStorageBytes: 50 * 1024 * 1024, // 50 MB
    storeNormals: false,
  },
  resolution: 32,
  heightScale: 10.0,
  globalSeed: 42,
  includeNormals: true,
  prefetchRadius: 2,
  debug: false,
};

/**
 * Pending load request
 */
interface PendingLoad {
  promise: Promise<HeightmapData>;
  priority: number;
}

/**
 * Unified Cache Manager
 */
export class HeightmapCacheManager {
  private config: CacheManagerConfig;
  private memoryCache: HeightmapMemoryCache;
  private storage: HeightmapStorage;
  private workerManager: TerrainWorkerManager;

  private loadStates: Map<string, LoadState> = new Map();
  private pendingLoads: Map<string, PendingLoad> = new Map();
  private isInitialized = false;

  constructor(config: Partial<CacheManagerConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      memory: { ...DEFAULT_CONFIG.memory, ...config.memory },
      storage: { ...DEFAULT_CONFIG.storage, ...config.storage },
    };

    this.memoryCache = new HeightmapMemoryCache(this.config.memory);
    this.storage = new HeightmapStorage(this.config.storage);
    this.workerManager = new TerrainWorkerManager();
  }

  /**
   * Initialize the cache manager
   * Opens storage and clears outdated entries
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      await this.storage.open();
      await this.storage.clearOutdated();
      await this.storage.evictOldest();
      await this.workerManager.waitForReady();
      this.isInitialized = true;

      if (this.config.debug) {
        console.log('[HeightmapCacheManager] Initialized');
      }
    } catch (error) {
      console.error('[HeightmapCacheManager] Initialization failed:', error);
      // Continue without storage
      this.isInitialized = true;
    }
  }

  /**
   * Get heightmap for a chunk
   * Checks memory → storage → generates
   */
  async getHeightmap(
    cx: number,
    cy: number,
    seed: number,
    biome: number = 0
  ): Promise<HeightmapData> {
    const key = this.chunkKey(cx, cy);

    // Check if already loading
    const pending = this.pendingLoads.get(key);
    if (pending) {
      return pending.promise;
    }

    // Start loading
    const promise = this.loadHeightmap(cx, cy, seed, biome);
    this.pendingLoads.set(key, { promise, priority: 0 });

    try {
      const result = await promise;
      this.loadStates.set(key, 'ready');
      return result;
    } catch (error) {
      this.loadStates.set(key, 'error');
      throw error;
    } finally {
      this.pendingLoads.delete(key);
    }
  }

  /**
   * Internal load implementation
   */
  private async loadHeightmap(
    cx: number,
    cy: number,
    seed: number,
    biome: number
  ): Promise<HeightmapData> {
    const key = this.chunkKey(cx, cy);
    this.loadStates.set(key, 'loading');

    // 1. Check memory cache
    const memCached = this.memoryCache.get(cx, cy);
    if (memCached && memCached.seed === seed) {
      if (this.config.debug) {
        console.log(`[HeightmapCacheManager] Memory hit: ${key}`);
      }
      return memCached;
    }

    // 2. Check storage
    try {
      const stored = await this.storage.get(cx, cy);
      if (stored && stored.seed === seed) {
        // Regenerate normals if not stored
        if (stored.normals.length === 0 && this.config.includeNormals) {
          stored.normals = generateNormalsFromHeights(
            stored.heights,
            stored.resolution,
            stored.heightScale,
            CHUNK_SIZE
          );
        }

        // Promote to memory cache
        this.memoryCache.set(stored);

        if (this.config.debug) {
          console.log(`[HeightmapCacheManager] Storage hit: ${key}`);
        }
        return stored;
      }
    } catch (error) {
      if (this.config.debug) {
        console.warn(`[HeightmapCacheManager] Storage read failed: ${key}`, error);
      }
    }

    // 3. Generate via worker
    if (this.config.debug) {
      console.log(`[HeightmapCacheManager] Generating: ${key}`);
    }

    const response = await this.workerManager.generate(cx, cy, seed, {
      biome,
      resolution: this.config.resolution,
      heightScale: this.config.heightScale,
      globalSeed: this.config.globalSeed,
      includeNormals: this.config.includeNormals,
    });

    const data: HeightmapData = {
      version: HEIGHTMAP_VERSION,
      cx,
      cy,
      seed,
      resolution: this.config.resolution,
      heightScale: this.config.heightScale,
      biome,
      heights: response.heights,
      normals: response.normals ?? new Float32Array(0),
      minHeight: response.minHeight,
      maxHeight: response.maxHeight,
    };

    // Cache in memory
    this.memoryCache.set(data);

    // Store asynchronously (don't await)
    this.storage.put(data).catch((error) => {
      if (this.config.debug) {
        console.warn(`[HeightmapCacheManager] Storage write failed: ${key}`, error);
      }
    });

    return data;
  }

  /**
   * Get heightmap synchronously if cached in memory
   * Returns null if not in memory cache
   */
  getHeightmapSync(cx: number, cy: number): HeightmapData | null {
    return this.memoryCache.get(cx, cy) ?? null;
  }

  /**
   * Check if chunk is loaded in memory
   */
  isLoaded(cx: number, cy: number): boolean {
    return this.memoryCache.has(cx, cy);
  }

  /**
   * Get load state for a chunk
   */
  getLoadState(cx: number, cy: number): LoadState {
    return this.loadStates.get(this.chunkKey(cx, cy)) ?? 'idle';
  }

  /**
   * Preload chunks around player position
   */
  async preloadAround(
    playerCx: number,
    playerCy: number,
    seeds: Map<string, { seed: number; biome: number }>
  ): Promise<void> {
    // Update memory cache pinned chunks
    this.memoryCache.updatePlayerPosition(playerCx, playerCy);

    const radius = this.config.prefetchRadius;
    const loads: Promise<HeightmapData>[] = [];

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const cx = playerCx + dx;
        const cy = playerCy + dy;
        const key = this.chunkKey(cx, cy);

        // Skip if already loaded
        if (this.memoryCache.has(cx, cy)) continue;

        // Skip if already loading
        if (this.pendingLoads.has(key)) continue;

        // Get seed info
        const info = seeds.get(key);
        if (!info) continue;

        // Start loading with priority based on distance
        const priority = Math.abs(dx) + Math.abs(dy);
        const promise = this.getHeightmap(cx, cy, info.seed, info.biome);

        // Update pending with priority
        const pending = this.pendingLoads.get(key);
        if (pending) {
          pending.priority = priority;
        }

        loads.push(promise);
      }
    }

    // Wait for all loads (ignore errors)
    await Promise.allSettled(loads);
  }

  /**
   * Unload chunk from memory cache
   */
  unload(cx: number, cy: number): void {
    this.memoryCache.remove(cx, cy);
    this.loadStates.delete(this.chunkKey(cx, cy));
  }

  /**
   * Clear all caches
   */
  async clear(): Promise<void> {
    this.memoryCache.clear();
    this.loadStates.clear();
    this.pendingLoads.clear();
  }

  /**
   * Clear storage (persistent data)
   */
  async clearStorage(): Promise<void> {
    await this.storage.clear();
  }

  /**
   * Get comprehensive statistics
   */
  getStats(): {
    memory: ReturnType<HeightmapMemoryCache['getStats']>;
    worker: ReturnType<TerrainWorkerManager['getStats']>;
    pendingLoads: number;
    loadStates: { idle: number; loading: number; ready: number; error: number };
  } {
    const loadStateCounts = { idle: 0, loading: 0, ready: 0, error: 0 };
    for (const state of this.loadStates.values()) {
      loadStateCounts[state]++;
    }

    return {
      memory: this.memoryCache.getStats(),
      worker: this.workerManager.getStats(),
      pendingLoads: this.pendingLoads.size,
      loadStates: loadStateCounts,
    };
  }

  /**
   * Get storage statistics (async)
   */
  async getStorageStats(): Promise<ReturnType<HeightmapStorage['getStats']>> {
    return this.storage.getStats();
  }

  /**
   * Destroy and cleanup resources
   */
  destroy(): void {
    this.workerManager.destroy();
    this.storage.close();
    this.memoryCache.clear();
    this.loadStates.clear();
    this.pendingLoads.clear();
    this.isInitialized = false;
  }

  /**
   * Generate chunk key
   */
  private chunkKey(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }
}
