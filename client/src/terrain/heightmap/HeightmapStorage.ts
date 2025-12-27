/**
 * Heightmap IndexedDB Storage
 * Persistent storage for heightmaps that survives page reloads
 */

import { HeightmapData, HEIGHTMAP_VERSION } from './HeightmapData';
import { serializeHeightmap, deserializeHeightmap } from './HeightmapSerializer';

/** Database name */
const DB_NAME = 'frugworld-terrain';

/** Database version */
const DB_VERSION = 1;

/** Object store name */
const STORE_NAME = 'heightmaps';

/**
 * Stored heightmap entry
 */
interface StoredEntry {
  /** Primary key: "cx,cy" */
  key: string;
  /** Chunk X coordinate */
  cx: number;
  /** Chunk Y coordinate */
  cy: number;
  /** Generation seed */
  seed: number;
  /** Schema version */
  version: number;
  /** Creation timestamp */
  createdAt: number;
  /** Last access timestamp */
  accessedAt: number;
  /** Serialized binary data */
  data: ArrayBuffer;
}

/**
 * Configuration for storage
 */
export interface StorageConfig {
  /** Maximum storage budget in bytes */
  maxStorageBytes: number;
  /** Include normals in stored data */
  storeNormals: boolean;
}

const DEFAULT_CONFIG: StorageConfig = {
  maxStorageBytes: 50 * 1024 * 1024, // 50 MB
  storeNormals: false, // Save space, regenerate on load
};

/**
 * IndexedDB Storage for Heightmaps
 */
export class HeightmapStorage {
  private config: StorageConfig;
  private db: IDBDatabase | null = null;
  private openPromise: Promise<void> | null = null;
  private isOpen = false;

  constructor(config: Partial<StorageConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Open database connection
   */
  async open(): Promise<void> {
    if (this.isOpen) return;
    if (this.openPromise) return this.openPromise;

    this.openPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[HeightmapStorage] Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.isOpen = true;

        // Handle connection errors
        this.db.onerror = (event) => {
          console.error('[HeightmapStorage] Database error:', event);
        };

        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create heightmaps store
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });

          // Indexes for queries
          store.createIndex('coords', ['cx', 'cy'], { unique: true });
          store.createIndex('accessedAt', 'accessedAt', { unique: false });
          store.createIndex('seed', 'seed', { unique: false });
          store.createIndex('version', 'version', { unique: false });
        }
      };
    });

    return this.openPromise;
  }

  /**
   * Get heightmap from storage
   */
  async get(cx: number, cy: number): Promise<HeightmapData | null> {
    await this.open();
    if (!this.db) return null;

    const key = `${cx},${cy}`;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        const entry = request.result as StoredEntry | undefined;
        if (!entry) {
          resolve(null);
          return;
        }

        // Update access time
        entry.accessedAt = Date.now();
        store.put(entry);

        // Deserialize
        const data = deserializeHeightmap(entry.data);
        resolve(data);
      };
    });
  }

  /**
   * Store heightmap in storage
   */
  async put(data: HeightmapData): Promise<void> {
    await this.open();
    if (!this.db) return;

    const key = `${data.cx},${data.cy}`;
    const now = Date.now();
    const serialized = serializeHeightmap(data, this.config.storeNormals);

    const entry: StoredEntry = {
      key,
      cx: data.cx,
      cy: data.cy,
      seed: data.seed,
      version: data.version,
      createdAt: now,
      accessedAt: now,
      data: serialized,
    };

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(entry);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Check if heightmap exists with matching seed
   */
  async has(cx: number, cy: number, seed?: number): Promise<boolean> {
    await this.open();
    if (!this.db) return false;

    const key = `${cx},${cy}`;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        const entry = request.result as StoredEntry | undefined;
        if (!entry) {
          resolve(false);
          return;
        }

        // Validate seed if provided
        if (seed !== undefined && entry.seed !== seed) {
          resolve(false);
          return;
        }

        resolve(true);
      };
    });
  }

  /**
   * Delete heightmap from storage
   */
  async delete(cx: number, cy: number): Promise<void> {
    await this.open();
    if (!this.db) return;

    const key = `${cx},${cy}`;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Evict oldest entries to stay under storage budget
   * Returns number of entries evicted
   */
  async evictOldest(): Promise<number> {
    await this.open();
    if (!this.db) return 0;

    // First, calculate total size
    const stats = await this.getStats();
    if (stats.totalSizeBytes <= this.config.maxStorageBytes) {
      return 0;
    }

    const sizeToFree = stats.totalSizeBytes - this.config.maxStorageBytes;
    let freedSize = 0;
    const keysToDelete: string[] = [];

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('accessedAt');

      // Iterate from oldest to newest
      const cursor = index.openCursor();

      cursor.onsuccess = () => {
        const result = cursor.result;
        if (result && freedSize < sizeToFree) {
          const entry = result.value as StoredEntry;
          keysToDelete.push(entry.key);
          freedSize += entry.data.byteLength;
          result.continue();
        } else {
          // Delete collected entries
          for (const key of keysToDelete) {
            store.delete(key);
          }

          tx.oncomplete = () => resolve(keysToDelete.length);
          tx.onerror = () => reject(tx.error);
        }
      };

      cursor.onerror = () => reject(cursor.error);
    });
  }

  /**
   * Clear all heightmaps with outdated version
   */
  async clearOutdated(): Promise<number> {
    await this.open();
    if (!this.db) return 0;

    const keysToDelete: string[] = [];

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const cursor = store.openCursor();

      cursor.onsuccess = () => {
        const result = cursor.result;
        if (result) {
          const entry = result.value as StoredEntry;
          if (entry.version !== HEIGHTMAP_VERSION) {
            keysToDelete.push(entry.key);
          }
          result.continue();
        } else {
          // Delete outdated entries
          for (const key of keysToDelete) {
            store.delete(key);
          }

          tx.oncomplete = () => resolve(keysToDelete.length);
          tx.onerror = () => reject(tx.error);
        }
      };

      cursor.onerror = () => reject(cursor.error);
    });
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    entryCount: number;
    totalSizeBytes: number;
    budgetBytes: number;
    usagePercent: number;
    oldestAccessMs: number;
    newestAccessMs: number;
  }> {
    await this.open();
    if (!this.db) {
      return {
        entryCount: 0,
        totalSizeBytes: 0,
        budgetBytes: this.config.maxStorageBytes,
        usagePercent: 0,
        oldestAccessMs: Date.now(),
        newestAccessMs: Date.now(),
      };
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);

      let count = 0;
      let totalSize = 0;
      let oldest = Date.now();
      let newest = 0;

      const cursor = store.openCursor();

      cursor.onsuccess = () => {
        const result = cursor.result;
        if (result) {
          const entry = result.value as StoredEntry;
          count++;
          totalSize += entry.data.byteLength;
          if (entry.accessedAt < oldest) oldest = entry.accessedAt;
          if (entry.accessedAt > newest) newest = entry.accessedAt;
          result.continue();
        } else {
          resolve({
            entryCount: count,
            totalSizeBytes: totalSize,
            budgetBytes: this.config.maxStorageBytes,
            usagePercent: (totalSize / this.config.maxStorageBytes) * 100,
            oldestAccessMs: oldest,
            newestAccessMs: newest,
          });
        }
      };

      cursor.onerror = () => reject(cursor.error);
    });
  }

  /**
   * Clear all stored heightmaps
   */
  async clear(): Promise<void> {
    await this.open();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.isOpen = false;
    this.openPromise = null;
  }
}
