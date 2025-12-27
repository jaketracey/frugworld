/**
 * Heightmap Generator
 * Generates procedural terrain heightmaps using multi-layer noise
 * Produces rolling hills and gentle valleys
 */

import {
  HeightmapData,
  HeightmapGenerationConfig,
  DEFAULT_GENERATION_CONFIG,
  HEIGHTMAP_VERSION,
  CHUNK_SIZE,
} from './HeightmapData';
import { generateNormalsFromHeights } from './HeightmapSerializer';
import {
  seedSimplex,
  fbmSeeded,
  valleyNoiseSeeded,
  warpCoordinatesSeeded,
} from '../noise';

/**
 * Terrain generation configuration for rolling hills style
 */
export interface TerrainStyle {
  /** Large rolling hills frequency */
  hillFrequency: number;
  /** Large rolling hills amplitude weight */
  hillWeight: number;

  /** Medium undulation frequency */
  mediumFrequency: number;
  /** Medium undulation amplitude weight */
  mediumWeight: number;

  /** Fine detail frequency */
  detailFrequency: number;
  /** Fine detail amplitude weight */
  detailWeight: number;

  /** Valley carving frequency */
  valleyFrequency: number;
  /** Valley depth weight (negative = deeper valleys) */
  valleyWeight: number;

  /** Gentle wave frequency */
  waveFrequency: number;
  /** Wave amplitude */
  waveWeight: number;

  /** Domain warping amplitude */
  warpAmplitude: number;
  /** Domain warping frequency */
  warpFrequency: number;
}

/** Default rolling hills terrain style */
export const ROLLING_HILLS_STYLE: TerrainStyle = {
  hillFrequency: 0.015,
  hillWeight: 0.55,

  mediumFrequency: 0.04,
  mediumWeight: 0.25,

  detailFrequency: 0.12,
  detailWeight: 0.1,

  valleyFrequency: 0.02,
  valleyWeight: 0.15,

  waveFrequency: 0.008,
  waveWeight: 0.05,

  warpAmplitude: 15.0,
  warpFrequency: 0.008,
};

/** More dramatic terrain with steeper hills */
export const DRAMATIC_HILLS_STYLE: TerrainStyle = {
  hillFrequency: 0.012,
  hillWeight: 0.6,

  mediumFrequency: 0.035,
  mediumWeight: 0.3,

  detailFrequency: 0.1,
  detailWeight: 0.15,

  valleyFrequency: 0.018,
  valleyWeight: 0.25,

  waveFrequency: 0.006,
  waveWeight: 0.08,

  warpAmplitude: 20.0,
  warpFrequency: 0.006,
};

/** Gentle plains with subtle variation */
export const GENTLE_PLAINS_STYLE: TerrainStyle = {
  hillFrequency: 0.01,
  hillWeight: 0.4,

  mediumFrequency: 0.03,
  mediumWeight: 0.2,

  detailFrequency: 0.08,
  detailWeight: 0.05,

  valleyFrequency: 0.015,
  valleyWeight: 0.08,

  waveFrequency: 0.005,
  waveWeight: 0.03,

  warpAmplitude: 10.0,
  warpFrequency: 0.005,
};

/**
 * Generate a single height value at world coordinates
 */
export function generateHeightAt(
  worldX: number,
  worldY: number,
  globalSeed: number,
  heightScale: number,
  style: TerrainStyle = ROLLING_HILLS_STYLE
): number {
  // Apply domain warping for organic shapes
  const warped = warpCoordinatesSeeded(worldX, worldY, globalSeed, {
    amplitude: style.warpAmplitude,
    frequency: style.warpFrequency,
  });
  const wx = warped.x;
  const wy = warped.y;

  // Layer 1: Large rolling hills (dominant shape)
  const hills = fbmSeeded(
    wx * style.hillFrequency,
    wy * style.hillFrequency,
    globalSeed,
    { octaves: 4, lacunarity: 2.0, persistence: 0.5 }
  );

  // Layer 2: Medium undulation (variety)
  const medium = fbmSeeded(
    wx * style.mediumFrequency,
    wy * style.mediumFrequency,
    globalSeed + 100,
    { octaves: 3, lacunarity: 2.0, persistence: 0.5 }
  );

  // Layer 3: Fine detail (texture)
  const detail = fbmSeeded(
    wx * style.detailFrequency,
    wy * style.detailFrequency,
    globalSeed + 200,
    { octaves: 2, lacunarity: 2.0, persistence: 0.5 }
  );

  // Layer 4: Gentle valleys (negative ridged noise)
  const valleys = valleyNoiseSeeded(
    worldX * style.valleyFrequency,
    worldY * style.valleyFrequency,
    globalSeed + 300,
    { octaves: 3, lacunarity: 2.2, gain: 1.8, offset: 1.0 }
  );

  // Layer 5: Gentle wave pattern
  const wave =
    Math.sin(worldX * style.waveFrequency * Math.PI * 2) *
    Math.cos(worldY * style.waveFrequency * Math.PI * 2);

  // Combine layers
  const combined =
    hills * style.hillWeight +
    medium * style.mediumWeight +
    detail * style.detailWeight -
    valleys * style.valleyWeight +
    wave * style.waveWeight;

  // Normalize to [0, 1] range then apply height scale
  const normalized = (combined + 1) * 0.5;

  // Apply height scale with minimum ground level
  return Math.max(0, normalized * heightScale);
}

/**
 * Generate complete heightmap for a chunk
 */
export function generateHeightmap(
  cx: number,
  cy: number,
  chunkSeed: number,
  config: Partial<HeightmapGenerationConfig> = {},
  style: TerrainStyle = ROLLING_HILLS_STYLE
): HeightmapData {
  const fullConfig = { ...DEFAULT_GENERATION_CONFIG, ...config };
  const {
    chunkSize,
    resolution,
    heightScale,
    includeNormals,
    globalSeed,
  } = fullConfig;

  // Seed the noise generator
  seedSimplex(globalSeed);

  const samplesPerEdge = resolution + 1;
  const totalSamples = samplesPerEdge * samplesPerEdge;
  const heights = new Float32Array(totalSamples);

  const step = chunkSize / resolution;
  const worldOffsetX = cx * chunkSize;
  const worldOffsetY = cy * chunkSize;

  let minHeight = Infinity;
  let maxHeight = -Infinity;

  // Generate heights
  for (let y = 0; y <= resolution; y++) {
    for (let x = 0; x <= resolution; x++) {
      const worldX = worldOffsetX + x * step;
      const worldY = worldOffsetY + y * step;

      const height = generateHeightAt(worldX, worldY, globalSeed, heightScale, style);

      const idx = y * samplesPerEdge + x;
      heights[idx] = height;

      if (height < minHeight) minHeight = height;
      if (height > maxHeight) maxHeight = height;
    }
  }

  // Generate normals from heights
  const normals = includeNormals
    ? generateNormalsFromHeights(heights, resolution, heightScale, chunkSize)
    : new Float32Array(totalSamples * 3);

  return {
    version: HEIGHTMAP_VERSION,
    cx,
    cy,
    seed: chunkSeed,
    resolution,
    heightScale,
    biome: 0, // Will be set by caller based on server data
    heights,
    normals,
    minHeight,
    maxHeight,
  };
}

/**
 * Generate heightmap with biome-specific style
 */
export function generateHeightmapWithBiome(
  cx: number,
  cy: number,
  chunkSeed: number,
  biome: number,
  config: Partial<HeightmapGenerationConfig> = {}
): HeightmapData {
  // Select style based on biome
  let style: TerrainStyle;

  switch (biome) {
    case 0: // Grassland
      style = ROLLING_HILLS_STYLE;
      break;
    case 1: // Desert
      style = GENTLE_PLAINS_STYLE;
      break;
    case 2: // Forest
      style = DRAMATIC_HILLS_STYLE;
      break;
    case 3: // Tundra
      style = GENTLE_PLAINS_STYLE;
      break;
    case 4: // Swamp
      style = { ...GENTLE_PLAINS_STYLE, valleyWeight: 0.25 };
      break;
    case 5: // Mountains
      style = DRAMATIC_HILLS_STYLE;
      break;
    default:
      style = ROLLING_HILLS_STYLE;
  }

  const heightmap = generateHeightmap(cx, cy, chunkSeed, config, style);
  heightmap.biome = biome;

  return heightmap;
}

/**
 * Fast height-only generation (no normals)
 * For physics queries when full heightmap isn't needed
 */
export function generateHeightsOnly(
  cx: number,
  cy: number,
  globalSeed: number,
  heightScale: number,
  resolution: number = 32,
  chunkSize: number = CHUNK_SIZE,
  style: TerrainStyle = ROLLING_HILLS_STYLE
): Float32Array {
  seedSimplex(globalSeed);

  const samplesPerEdge = resolution + 1;
  const heights = new Float32Array(samplesPerEdge * samplesPerEdge);

  const step = chunkSize / resolution;
  const worldOffsetX = cx * chunkSize;
  const worldOffsetY = cy * chunkSize;

  for (let y = 0; y <= resolution; y++) {
    for (let x = 0; x <= resolution; x++) {
      const worldX = worldOffsetX + x * step;
      const worldY = worldOffsetY + y * step;
      heights[y * samplesPerEdge + x] = generateHeightAt(
        worldX,
        worldY,
        globalSeed,
        heightScale,
        style
      );
    }
  }

  return heights;
}

/**
 * Batch generate multiple chunks
 * More efficient than generating one at a time
 */
export function generateHeightmapBatch(
  chunks: Array<{ cx: number; cy: number; seed: number; biome: number }>,
  config: Partial<HeightmapGenerationConfig> = {}
): HeightmapData[] {
  const fullConfig = { ...DEFAULT_GENERATION_CONFIG, ...config };
  seedSimplex(fullConfig.globalSeed);

  return chunks.map((chunk) =>
    generateHeightmapWithBiome(chunk.cx, chunk.cy, chunk.seed, chunk.biome, config)
  );
}
