/**
 * Heightmap Memory Cache
 * LRU cache for fast in-memory heightmap access
 */

import { HeightmapData, calculateHeightmapSize } from './HeightmapData';

/**
 * LRU cache entry with doubly-linked list pointers
 */
interface CacheEntry {
  key: string;
  data: HeightmapData;
  size: number;
  prev: CacheEntry | null;
  next: CacheEntry | null;
  accessTime: number;
}

/**
 * Configuration for memory cache
 */
export interface MemoryCacheConfig {
  /** Maximum memory budget in bytes */
  maxMemoryBytes: number;
  /** Radius of chunks to keep pinned near player */
  hotZoneRadius: number;
}

const DEFAULT_CONFIG: MemoryCacheConfig = {
  maxMemoryBytes: 32 * 1024 * 1024, // 32 MB
  hotZoneRadius: 3,
};

/**
 * LRU Memory Cache for Heightmaps
 * Provides O(1) access and automatic eviction of least-recently-used entries
 */
export class HeightmapMemoryCache {
  private config: MemoryCacheConfig;
  private cache: Map<string, CacheEntry> = new Map();
  private head: CacheEntry | null = null; // Most recent
  private tail: CacheEntry | null = null; // Least recent
  private currentSize = 0;
  private pinnedChunks: Set<string> = new Set();

  constructor(config: Partial<MemoryCacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get chunk key from coordinates
   */
  private chunkKey(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  /**
   * Get heightmap from cache
   * Returns undefined if not cached
   */
  get(cx: number, cy: number): HeightmapData | undefined {
    const key = this.chunkKey(cx, cy);
    const entry = this.cache.get(key);

    if (!entry) return undefined;

    // Move to front (most recently used)
    this.moveToFront(entry);
    entry.accessTime = performance.now();

    return entry.data;
  }

  /**
   * Store heightmap in cache
   * Automatically evicts LRU entries if over budget
   */
  set(data: HeightmapData): void {
    const key = this.chunkKey(data.cx, data.cy);
    const size = calculateHeightmapSize(data);

    // Check if already exists
    const existing = this.cache.get(key);
    if (existing) {
      // Update existing entry
      this.currentSize -= existing.size;
      existing.data = data;
      existing.size = size;
      existing.accessTime = performance.now();
      this.currentSize += size;
      this.moveToFront(existing);
      return;
    }

    // Evict until we have space
    while (this.currentSize + size > this.config.maxMemoryBytes && this.tail) {
      this.evictLRU();
    }

    // Create new entry
    const entry: CacheEntry = {
      key,
      data,
      size,
      prev: null,
      next: this.head,
      accessTime: performance.now(),
    };

    // Link to front
    if (this.head) {
      this.head.prev = entry;
    }
    this.head = entry;
    if (!this.tail) {
      this.tail = entry;
    }

    this.cache.set(key, entry);
    this.currentSize += size;
  }

  /**
   * Check if chunk is in cache
   */
  has(cx: number, cy: number): boolean {
    return this.cache.has(this.chunkKey(cx, cy));
  }

  /**
   * Remove chunk from cache
   */
  remove(cx: number, cy: number): boolean {
    const key = this.chunkKey(cx, cy);
    const entry = this.cache.get(key);

    if (!entry) return false;

    this.removeEntry(entry);
    return true;
  }

  /**
   * Update player position to pin nearby chunks
   * Pinned chunks won't be evicted
   */
  updatePlayerPosition(playerCx: number, playerCy: number): void {
    this.pinnedChunks.clear();
    const radius = this.config.hotZoneRadius;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        this.pinnedChunks.add(this.chunkKey(playerCx + dx, playerCy + dy));
      }
    }
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
    this.currentSize = 0;
    this.pinnedChunks.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    entryCount: number;
    memoryUsedBytes: number;
    memoryBudgetBytes: number;
    memoryUsedPercent: number;
    pinnedCount: number;
  } {
    return {
      entryCount: this.cache.size,
      memoryUsedBytes: this.currentSize,
      memoryBudgetBytes: this.config.maxMemoryBytes,
      memoryUsedPercent: (this.currentSize / this.config.maxMemoryBytes) * 100,
      pinnedCount: this.pinnedChunks.size,
    };
  }

  /**
   * Get all cached chunk coordinates
   */
  getCachedChunks(): Array<{ cx: number; cy: number }> {
    return Array.from(this.cache.keys()).map((key) => {
      const [cx, cy] = key.split(',').map(Number);
      return { cx, cy };
    });
  }

  /**
   * Move entry to front of LRU list
   */
  private moveToFront(entry: CacheEntry): void {
    if (entry === this.head) return;

    // Remove from current position
    if (entry.prev) entry.prev.next = entry.next;
    if (entry.next) entry.next.prev = entry.prev;
    if (entry === this.tail) this.tail = entry.prev;

    // Move to front
    entry.prev = null;
    entry.next = this.head;
    if (this.head) this.head.prev = entry;
    this.head = entry;
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): CacheEntry | null {
    if (!this.tail) return null;

    // Find evictable entry (skip pinned)
    let entry: CacheEntry | null = this.tail;
    while (entry && this.pinnedChunks.has(entry.key)) {
      entry = entry.prev;
    }

    if (!entry) {
      // All entries are pinned, can't evict
      console.warn('[HeightmapCache] Cannot evict: all entries are pinned');
      return null;
    }

    this.removeEntry(entry);
    return entry;
  }

  /**
   * Remove entry from cache and list
   */
  private removeEntry(entry: CacheEntry): void {
    // Update list pointers
    if (entry.prev) entry.prev.next = entry.next;
    if (entry.next) entry.next.prev = entry.prev;
    if (entry === this.head) this.head = entry.next;
    if (entry === this.tail) this.tail = entry.prev;

    // Remove from map
    this.cache.delete(entry.key);
    this.currentSize -= entry.size;
  }
}
