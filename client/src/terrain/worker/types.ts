/**
 * Web Worker Message Types
 * Defines communication protocol between main thread and terrain worker
 */

/**
 * Request to generate a single chunk heightmap
 */
export interface GenerateRequest {
  type: 'generate';
  /** Unique request ID for response matching */
  id: number;
  /** Chunk X coordinate */
  cx: number;
  /** Chunk Y coordinate */
  cy: number;
  /** Chunk seed (from server) */
  seed: number;
  /** Biome type */
  biome: number;
  /** Heightmap resolution (samples per edge, not including +1) */
  resolution: number;
  /** Height scale multiplier */
  heightScale: number;
  /** Global seed for consistent terrain */
  globalSeed: number;
  /** Whether to generate normals */
  includeNormals: boolean;
}

/**
 * Response with generated heightmap data
 */
export interface GenerateResponse {
  type: 'generate_complete';
  /** Request ID this response is for */
  id: number;
  /** Chunk X coordinate */
  cx: number;
  /** Chunk Y coordinate */
  cy: number;
  /** Height values (Float32Array transferred) */
  heights: Float32Array;
  /** Normal values if requested (Float32Array transferred) */
  normals?: Float32Array;
  /** Minimum height in chunk */
  minHeight: number;
  /** Maximum height in chunk */
  maxHeight: number;
  /** Generation time in milliseconds */
  generationTimeMs: number;
}

/**
 * Request to generate multiple chunks in batch
 */
export interface BatchGenerateRequest {
  type: 'batch_generate';
  /** Unique request ID */
  id: number;
  /** Chunks to generate */
  chunks: Array<{
    cx: number;
    cy: number;
    seed: number;
    biome: number;
  }>;
  /** Shared configuration */
  resolution: number;
  heightScale: number;
  globalSeed: number;
  includeNormals: boolean;
}

/**
 * Response with batch of generated heightmaps
 */
export interface BatchGenerateResponse {
  type: 'batch_complete';
  /** Request ID */
  id: number;
  /** Generated results */
  results: Array<{
    cx: number;
    cy: number;
    heights: Float32Array;
    normals?: Float32Array;
    minHeight: number;
    maxHeight: number;
  }>;
  /** Total generation time */
  totalTimeMs: number;
}

/**
 * Request to cancel a pending generation
 */
export interface CancelRequest {
  type: 'cancel';
  /** ID of request to cancel */
  id: number;
}

/**
 * Error response
 */
export interface ErrorResponse {
  type: 'error';
  /** Request ID that caused error */
  id: number;
  /** Error message */
  error: string;
}

/**
 * Request for worker status
 */
export interface StatusRequest {
  type: 'status';
}

/**
 * Worker status response
 */
export interface StatusResponse {
  type: 'status_response';
  /** Number of pending requests */
  pendingCount: number;
  /** Whether worker is busy */
  busy: boolean;
}

/**
 * Union of all message types from main thread to worker
 */
export type WorkerRequest =
  | GenerateRequest
  | BatchGenerateRequest
  | CancelRequest
  | StatusRequest;

/**
 * Union of all message types from worker to main thread
 */
export type WorkerResponse =
  | GenerateResponse
  | BatchGenerateResponse
  | ErrorResponse
  | StatusResponse;
