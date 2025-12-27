/**
 * Terrain Worker Manager
 * Manages communication with the terrain generation web worker
 */

import type {
  WorkerRequest,
  WorkerResponse,
  GenerateRequest,
  GenerateResponse,
  BatchGenerateRequest,
  BatchGenerateResponse,
} from './types';

/**
 * Pending request tracking
 */
interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timestamp: number;
  timeout?: ReturnType<typeof setTimeout>;
}

/**
 * Configuration for worker manager
 */
export interface WorkerManagerConfig {
  /** Request timeout in milliseconds */
  timeoutMs: number;
  /** Maximum pending requests before queuing */
  maxPending: number;
}

const DEFAULT_CONFIG: WorkerManagerConfig = {
  timeoutMs: 10000, // 10 seconds
  maxPending: 100,
};

/**
 * Manages terrain generation worker
 */
export class TerrainWorkerManager {
  private worker: Worker | null = null;
  private pendingRequests: Map<number, PendingRequest<GenerateResponse | BatchGenerateResponse>> = new Map();
  private nextRequestId = 1;
  private isReady = false;
  private readyPromise: Promise<void>;
  private readyResolve: (() => void) | null = null;
  private config: WorkerManagerConfig;
  private isTerminating = false;

  constructor(config: Partial<WorkerManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
    this.initWorker();
  }

  /**
   * Initialize the web worker
   */
  private initWorker(): void {
    try {
      this.worker = new Worker(
        new URL('./terrain.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = (event: MessageEvent<WorkerResponse | { type: 'ready' }>) => {
        this.handleMessage(event.data);
      };

      this.worker.onerror = (event: ErrorEvent) => {
        console.error('[TerrainWorkerManager] Worker error:', event);
        this.rejectAllPending(new Error(`Worker error: ${event.message}`));
      };
    } catch (error) {
      console.error('[TerrainWorkerManager] Failed to create worker:', error);
      // Worker creation failed, will fall back to main thread
    }
  }

  /**
   * Handle messages from worker
   */
  private handleMessage(message: WorkerResponse | { type: 'ready' }): void {
    if (message.type === 'ready') {
      this.isReady = true;
      if (this.readyResolve) {
        this.readyResolve();
        this.readyResolve = null;
      }
      return;
    }

    if (message.type === 'generate_complete' || message.type === 'batch_complete') {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        if (pending.timeout) clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);
        pending.resolve(message as GenerateResponse | BatchGenerateResponse);
      }
      return;
    }

    if (message.type === 'error') {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        if (pending.timeout) clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);
        pending.reject(new Error(message.error));
      }
      return;
    }
  }

  /**
   * Wait for worker to be ready
   */
  async waitForReady(): Promise<void> {
    if (this.isReady) return;
    return this.readyPromise;
  }

  /**
   * Check if worker is available
   */
  isAvailable(): boolean {
    return this.worker !== null && this.isReady && !this.isTerminating;
  }

  /**
   * Generate heightmap for a single chunk
   */
  async generate(
    cx: number,
    cy: number,
    seed: number,
    options: {
      biome?: number;
      resolution?: number;
      heightScale?: number;
      globalSeed?: number;
      includeNormals?: boolean;
    } = {}
  ): Promise<GenerateResponse> {
    if (!this.worker || this.isTerminating) {
      throw new Error('Worker not available');
    }

    await this.waitForReady();

    const id = this.nextRequestId++;
    const request: GenerateRequest = {
      type: 'generate',
      id,
      cx,
      cy,
      seed,
      biome: options.biome ?? 0,
      resolution: options.resolution ?? 32,
      heightScale: options.heightScale ?? 10,
      globalSeed: options.globalSeed ?? 42,
      includeNormals: options.includeNormals ?? true,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${id} timed out`));
      }, this.config.timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: GenerateResponse | BatchGenerateResponse) => void,
        reject,
        timestamp: performance.now(),
        timeout,
      });

      this.worker!.postMessage(request);
    });
  }

  /**
   * Generate heightmaps for multiple chunks in batch
   */
  async generateBatch(
    chunks: Array<{ cx: number; cy: number; seed: number; biome: number }>,
    options: {
      resolution?: number;
      heightScale?: number;
      globalSeed?: number;
      includeNormals?: boolean;
    } = {}
  ): Promise<BatchGenerateResponse> {
    if (!this.worker || this.isTerminating) {
      throw new Error('Worker not available');
    }

    await this.waitForReady();

    const id = this.nextRequestId++;
    const request: BatchGenerateRequest = {
      type: 'batch_generate',
      id,
      chunks,
      resolution: options.resolution ?? 32,
      heightScale: options.heightScale ?? 10,
      globalSeed: options.globalSeed ?? 42,
      includeNormals: options.includeNormals ?? true,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Batch request ${id} timed out`));
      }, this.config.timeoutMs * chunks.length);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: GenerateResponse | BatchGenerateResponse) => void,
        reject,
        timestamp: performance.now(),
        timeout,
      });

      this.worker!.postMessage(request);
    });
  }

  /**
   * Get number of pending requests
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Cancel a pending request
   */
  cancel(id: number): boolean {
    const pending = this.pendingRequests.get(id);
    if (pending) {
      if (pending.timeout) clearTimeout(pending.timeout);
      this.pendingRequests.delete(id);
      pending.reject(new Error('Cancelled'));
      return true;
    }
    return false;
  }

  /**
   * Cancel all pending requests
   */
  cancelAll(): void {
    this.rejectAllPending(new Error('All requests cancelled'));
  }

  /**
   * Reject all pending requests with an error
   */
  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  /**
   * Terminate the worker
   */
  destroy(): void {
    this.isTerminating = true;
    this.rejectAllPending(new Error('Worker terminated'));
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.isReady = false;
  }

  /**
   * Get statistics about worker usage
   */
  getStats(): {
    isReady: boolean;
    pendingRequests: number;
    isTerminating: boolean;
  } {
    return {
      isReady: this.isReady,
      pendingRequests: this.pendingRequests.size,
      isTerminating: this.isTerminating,
    };
  }
}
