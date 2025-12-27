/**
 * Heightmap Data Types
 * Defines the core data structures for precomputed terrain heightmaps
 */

/** Current heightmap schema version */
export const HEIGHTMAP_VERSION = 1;

/** Default chunk size in world units (meters) */
export const CHUNK_SIZE = 64;

/** Default heightmap resolution (samples per edge) */
export const HEIGHTMAP_RESOLUTION = 32;

/** Samples count (resolution + 1 for seamless boundaries) */
export const SAMPLES_PER_EDGE = HEIGHTMAP_RESOLUTION + 1; // 33

/** Total samples in heightmap */
export const TOTAL_SAMPLES = SAMPLES_PER_EDGE * SAMPLES_PER_EDGE; // 1089

/**
 * Core heightmap data for a single chunk
 */
export interface HeightmapData {
  /** Schema version for migrations */
  version: number;

  /** Chunk X coordinate */
  cx: number;

  /** Chunk Y coordinate */
  cy: number;

  /** Generation seed (for validation and regeneration) */
  seed: number;

  /** Number of samples per edge (excluding +1 for boundaries) */
  resolution: number;

  /** Height scale factor applied during generation */
  heightScale: number;

  /** Biome type for this chunk */
  biome: number;

  /**
   * Height values as Float32Array
   * Indexed as: heights[y * (resolution + 1) + x]
   * Size: (resolution + 1)^2 floats
   */
  heights: Float32Array;

  /**
   * Normal vectors as Float32Array
   * Indexed as: normals[(y * (resolution + 1) + x) * 3 + component]
   * Components: [nx, ny, nz] for each sample
   * Size: (resolution + 1)^2 * 3 floats
   */
  normals: Float32Array;

  /** Minimum height in this chunk (for bounding/culling) */
  minHeight: number;

  /** Maximum height in this chunk (for bounding/culling) */
  maxHeight: number;
}

/**
 * Compact representation for storage/transfer
 * Normals are optional and can be regenerated from heights
 */
export interface HeightmapCompact {
  version: number;
  cx: number;
  cy: number;
  seed: number;
  resolution: number;
  heightScale: number;
  biome: number;
  heights: Float32Array;
  minHeight: number;
  maxHeight: number;
}

/**
 * Metadata about a cached heightmap
 */
export interface HeightmapMetadata {
  cx: number;
  cy: number;
  seed: number;
  version: number;
  createdAt: number;
  accessedAt: number;
  sizeBytes: number;
}

/**
 * Configuration for heightmap generation
 */
export interface HeightmapGenerationConfig {
  /** Chunk size in world units */
  chunkSize: number;

  /** Samples per edge (not including +1 for boundaries) */
  resolution: number;

  /** Height scale multiplier */
  heightScale: number;

  /** Whether to generate normals */
  includeNormals: boolean;

  /** Global seed for consistent terrain */
  globalSeed: number;
}

/** Default generation configuration */
export const DEFAULT_GENERATION_CONFIG: HeightmapGenerationConfig = {
  chunkSize: CHUNK_SIZE,
  resolution: HEIGHTMAP_RESOLUTION,
  heightScale: 10.0,
  includeNormals: true,
  globalSeed: 42,
};

/**
 * Create an empty heightmap data structure
 */
export function createEmptyHeightmap(
  cx: number,
  cy: number,
  seed: number,
  resolution: number = HEIGHTMAP_RESOLUTION,
  heightScale: number = 10.0,
  biome: number = 0
): HeightmapData {
  const samplesPerEdge = resolution + 1;
  const totalSamples = samplesPerEdge * samplesPerEdge;

  return {
    version: HEIGHTMAP_VERSION,
    cx,
    cy,
    seed,
    resolution,
    heightScale,
    biome,
    heights: new Float32Array(totalSamples),
    normals: new Float32Array(totalSamples * 3),
    minHeight: 0,
    maxHeight: 0,
  };
}

/**
 * Calculate byte size of heightmap data
 */
export function calculateHeightmapSize(data: HeightmapData): number {
  // Base object overhead estimate
  let size = 64;

  // Heights array
  size += data.heights.byteLength;

  // Normals array
  size += data.normals.byteLength;

  return size;
}

/**
 * Get height at a specific sample coordinate
 * @param data Heightmap data
 * @param x Sample X (0 to resolution)
 * @param y Sample Y (0 to resolution)
 */
export function getHeightSample(
  data: HeightmapData,
  x: number,
  y: number
): number {
  const samplesPerEdge = data.resolution + 1;
  const idx = y * samplesPerEdge + x;
  return data.heights[idx];
}

/**
 * Get normal at a specific sample coordinate
 * @param data Heightmap data
 * @param x Sample X (0 to resolution)
 * @param y Sample Y (0 to resolution)
 */
export function getNormalSample(
  data: HeightmapData,
  x: number,
  y: number
): { nx: number; ny: number; nz: number } {
  const samplesPerEdge = data.resolution + 1;
  const idx = (y * samplesPerEdge + x) * 3;
  return {
    nx: data.normals[idx],
    ny: data.normals[idx + 1],
    nz: data.normals[idx + 2],
  };
}

/**
 * Get interpolated height at world position within chunk
 * @param data Heightmap data
 * @param localX Local X position (0 to chunkSize)
 * @param localY Local Y position (0 to chunkSize)
 * @param chunkSize Size of chunk in world units
 */
export function getInterpolatedHeight(
  data: HeightmapData,
  localX: number,
  localY: number,
  chunkSize: number = CHUNK_SIZE
): number {
  const samplesPerEdge = data.resolution + 1;
  const step = chunkSize / data.resolution;

  // Convert to sample space
  const sx = localX / step;
  const sy = localY / step;

  // Get integer sample coordinates
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(x0 + 1, data.resolution);
  const y1 = Math.min(y0 + 1, data.resolution);

  // Get fractional part for interpolation
  const fx = sx - x0;
  const fy = sy - y0;

  // Sample heights at corners
  const h00 = data.heights[y0 * samplesPerEdge + x0];
  const h10 = data.heights[y0 * samplesPerEdge + x1];
  const h01 = data.heights[y1 * samplesPerEdge + x0];
  const h11 = data.heights[y1 * samplesPerEdge + x1];

  // Bilinear interpolation
  const h0 = h00 * (1 - fx) + h10 * fx;
  const h1 = h01 * (1 - fx) + h11 * fx;
  return h0 * (1 - fy) + h1 * fy;
}

/**
 * Get interpolated normal at world position within chunk
 */
export function getInterpolatedNormal(
  data: HeightmapData,
  localX: number,
  localY: number,
  chunkSize: number = CHUNK_SIZE
): { nx: number; ny: number; nz: number } {
  const samplesPerEdge = data.resolution + 1;
  const step = chunkSize / data.resolution;

  const sx = localX / step;
  const sy = localY / step;

  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(x0 + 1, data.resolution);
  const y1 = Math.min(y0 + 1, data.resolution);

  const fx = sx - x0;
  const fy = sy - y0;

  // Sample normals at corners
  const idx00 = (y0 * samplesPerEdge + x0) * 3;
  const idx10 = (y0 * samplesPerEdge + x1) * 3;
  const idx01 = (y1 * samplesPerEdge + x0) * 3;
  const idx11 = (y1 * samplesPerEdge + x1) * 3;

  // Interpolate each component
  const nx = bilinear(
    data.normals[idx00], data.normals[idx10],
    data.normals[idx01], data.normals[idx11],
    fx, fy
  );
  const ny = bilinear(
    data.normals[idx00 + 1], data.normals[idx10 + 1],
    data.normals[idx01 + 1], data.normals[idx11 + 1],
    fx, fy
  );
  const nz = bilinear(
    data.normals[idx00 + 2], data.normals[idx10 + 2],
    data.normals[idx01 + 2], data.normals[idx11 + 2],
    fx, fy
  );

  // Renormalize
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return {
    nx: nx / len,
    ny: ny / len,
    nz: nz / len,
  };
}

/** Helper for bilinear interpolation */
function bilinear(
  v00: number, v10: number,
  v01: number, v11: number,
  fx: number, fy: number
): number {
  const v0 = v00 * (1 - fx) + v10 * fx;
  const v1 = v01 * (1 - fx) + v11 * fx;
  return v0 * (1 - fy) + v1 * fy;
}
