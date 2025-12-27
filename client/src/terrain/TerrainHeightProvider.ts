/**
 * TerrainHeightProvider - Interface and implementation for querying terrain height
 * Used by physics systems to determine ground collision height at any world position
 *
 * Supports both procedural generation and precomputed cached heightmaps
 */

import {
  HeightmapCacheManager,
  HeightmapData,
  getInterpolatedHeight,
  getInterpolatedNormal,
  CHUNK_SIZE,
} from './heightmap';

export interface TerrainSample {
  height: number;
  normalX: number; // Surface normal X component
  normalY: number; // Surface normal Y component
  normalZ: number; // Surface normal Z component (up)
  slopeX: number;  // Slope in X direction (rise/run)
  slopeY: number;  // Slope in Y direction (rise/run)
}

export interface TerrainHeightProvider {
  /**
   * Get the terrain height at a given world position (x, y)
   * Returns the Z-coordinate of the ground surface
   */
  getHeightAt(x: number, y: number): number;

  /**
   * Get full terrain sample including height and slope information
   * Used for physics to make ball roll on slopes
   */
  getSampleAt(x: number, y: number): TerrainSample;
}

/**
 * Simple flat terrain provider (fallback when no terrain data is available)
 */
export class FlatTerrainProvider implements TerrainHeightProvider {
  private height: number;

  constructor(height: number = 0) {
    this.height = height;
  }

  getHeightAt(_x: number, _y: number): number {
    return this.height;
  }

  getSampleAt(_x: number, _y: number): TerrainSample {
    return {
      height: this.height,
      normalX: 0,
      normalY: 0,
      normalZ: 1, // Pointing straight up
      slopeX: 0,
      slopeY: 0,
    };
  }
}

// ============================================================================
// Smooth noise functions for rolling hills
// ============================================================================

/**
 * Smoothstep interpolation
 */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Quintic interpolation for even smoother curves
 */
function quintic(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * 2D gradient noise (simplified Perlin-like)
 * Returns smooth values between -1 and 1
 */
function gradientNoise2D(x: number, y: number, seed: number = 0): number {
  // Integer cell coordinates
  const xi = Math.floor(x);
  const yi = Math.floor(y);

  // Fractional part with quintic interpolation
  const xf = quintic(x - xi);
  const yf = quintic(y - yi);

  // Hash function for pseudo-random gradients
  const hash = (px: number, py: number): number => {
    const n = px * 127.1 + py * 311.7 + seed * 13.37;
    return Math.sin(n * 43758.5453123) * 2 - 1;
  };

  // Get gradients at four corners
  const g00 = hash(xi, yi);
  const g10 = hash(xi + 1, yi);
  const g01 = hash(xi, yi + 1);
  const g11 = hash(xi + 1, yi + 1);

  // Interpolate
  const nx0 = g00 * (1 - xf) + g10 * xf;
  const nx1 = g01 * (1 - xf) + g11 * xf;

  return nx0 * (1 - yf) + nx1 * yf;
}

/**
 * Fractal Brownian Motion (fBm) for multi-octave noise
 * Creates natural-looking rolling hills with multiple scales
 */
function fbm(x: number, y: number, octaves: number, lacunarity: number, persistence: number, seed: number = 0): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += amplitude * gradientNoise2D(x * frequency, y * frequency, seed + i * 100);
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return value / maxValue;
}

/**
 * Ridge noise - creates sharper peaks and ridges
 */
function ridgeNoise(x: number, y: number, seed: number = 0): number {
  const n = gradientNoise2D(x, y, seed);
  return 1 - Math.abs(n);
}

/**
 * Procedural terrain height provider with smooth rolling hills
 * Optimized for high-speed ball gameplay in a Tron-style world
 *
 * Uses continuous world-space noise for seamless terrain across chunks
 */
export class ProceduralTerrainProvider implements TerrainHeightProvider {
  private chunkSize: number;
  private heightScale: number;
  private chunkSeeds: Map<string, number> = new Map();

  // Terrain generation parameters for fun ball physics
  private readonly hillFrequency = 0.02;    // Base frequency of large hills
  private readonly hillAmplitude = 1.0;      // Large rolling hills
  private readonly bumpFrequency = 0.08;     // Medium bumps
  private readonly bumpAmplitude = 0.3;      // Smaller amplitude
  private readonly detailFrequency = 0.2;    // Fine detail
  private readonly detailAmplitude = 0.1;    // Subtle variation

  constructor(chunkSize: number = 64, heightScale: number = 10) {
    this.chunkSize = chunkSize;
    this.heightScale = heightScale;
  }

  /**
   * Register a chunk's seed for accurate height calculation
   */
  setChunkSeed(cx: number, cy: number, seed: number): void {
    const key = `${cx},${cy}`;
    this.chunkSeeds.set(key, seed);
  }

  /**
   * Remove a chunk's seed when unloaded
   */
  removeChunkSeed(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    this.chunkSeeds.delete(key);
  }

  /**
   * Clear all chunk seeds
   */
  clear(): void {
    this.chunkSeeds.clear();
  }

  getHeightAt(x: number, y: number): number {
    return this.calculateHeight(x, y);
  }

  /**
   * Calculate smooth rolling hill height at world position
   *
   * Uses world-space continuous noise for seamless terrain across all chunks.
   * Multiple octaves create interesting but smooth hills perfect for ball gameplay:
   * - Large rolling hills (low frequency, high amplitude)
   * - Medium bumps for variety
   * - Fine detail for texture
   *
   * Height is always positive (starts at base level and goes up)
   */
  private calculateHeight(x: number, y: number): number {
    // Use global seed of 42 for consistent world generation
    // Individual chunk seeds add local variation
    const globalSeed = 42;

    // Get chunk-local seed for some variation
    const cx = Math.floor(x / this.chunkSize);
    const cy = Math.floor(y / this.chunkSize);
    const key = `${cx},${cy}`;
    const chunkSeed = this.chunkSeeds.get(key) ?? 0;

    // Large smooth rolling hills - the main terrain shape
    // These create the big jumps and valleys
    // fbm returns -1 to 1, we shift to 0 to 1 for always-positive heights
    const hills = (fbm(
      x * this.hillFrequency,
      y * this.hillFrequency,
      3,    // octaves
      2.0,  // lacunarity
      0.5,  // persistence
      globalSeed
    ) * 0.5 + 0.5) * this.hillAmplitude;

    // Medium bumps for variety (also shifted positive)
    const bumps = (fbm(
      x * this.bumpFrequency,
      y * this.bumpFrequency,
      2,
      2.0,
      0.5,
      globalSeed + 100
    ) * 0.5 + 0.5) * this.bumpAmplitude;

    // Fine detail - subtle surface texture
    const detail = gradientNoise2D(
      x * this.detailFrequency,
      y * this.detailFrequency,
      globalSeed + chunkSeed * 0.01
    ) * this.detailAmplitude;

    // Combine all layers - base terrain is always positive
    // Hills and bumps go from 0 to amplitude, detail adds +/- variation
    const combinedHeight = (hills + bumps + detail) * this.heightScale;

    // Add gentle rolling wave pattern for fun ball physics
    const waveEffect = Math.sin(x * 0.03) * Math.cos(y * 0.03) * 1.5;

    // Ensure minimum height of 0 (above ground plane)
    return Math.max(0, combinedHeight + waveEffect);
  }

  /**
   * Get full terrain sample with slope and normal information
   */
  getSampleAt(x: number, y: number): TerrainSample {
    const height = this.calculateHeight(x, y);

    // Calculate slope using finite differences (central difference)
    const delta = 0.1; // Small step for derivative calculation
    const hPlusX = this.calculateHeight(x + delta, y);
    const hMinusX = this.calculateHeight(x - delta, y);
    const hPlusY = this.calculateHeight(x, y + delta);
    const hMinusY = this.calculateHeight(x, y - delta);

    // Slope = rise / run (partial derivatives)
    const slopeX = (hPlusX - hMinusX) / (2 * delta);
    const slopeY = (hPlusY - hMinusY) / (2 * delta);

    // Calculate surface normal from slopes
    // Normal = normalize(cross(tangentX, tangentY))
    // tangentX = (1, 0, slopeX), tangentY = (0, 1, slopeY)
    // cross = (-slopeX, -slopeY, 1)
    const nx = -slopeX;
    const ny = -slopeY;
    const nz = 1;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

    return {
      height,
      normalX: nx / len,
      normalY: ny / len,
      normalZ: nz / len,
      slopeX,
      slopeY,
    };
  }

  /**
   * Get height with bilinear interpolation for smoother collision
   * Samples at 4 corners and interpolates
   */
  getHeightAtSmooth(x: number, y: number, sampleDistance: number = 0.5): number {
    const h00 = this.calculateHeight(x - sampleDistance, y - sampleDistance);
    const h10 = this.calculateHeight(x + sampleDistance, y - sampleDistance);
    const h01 = this.calculateHeight(x - sampleDistance, y + sampleDistance);
    const h11 = this.calculateHeight(x + sampleDistance, y + sampleDistance);

    // Simple average (could do proper bilinear with fractional position)
    return (h00 + h10 + h01 + h11) / 4;
  }
}

/**
 * Cached Terrain Provider
 * Uses precomputed heightmaps from HeightmapCacheManager for fast queries
 * Falls back to procedural generation when cache misses
 */
export class CachedTerrainProvider implements TerrainHeightProvider {
  private cacheManager: HeightmapCacheManager;
  private chunkSize: number;
  private fallback: ProceduralTerrainProvider;

  constructor(cacheManager: HeightmapCacheManager, chunkSize: number = CHUNK_SIZE) {
    this.cacheManager = cacheManager;
    this.chunkSize = chunkSize;
    this.fallback = new ProceduralTerrainProvider(chunkSize);
  }

  /**
   * Get cache manager for external access
   */
  getCacheManager(): HeightmapCacheManager {
    return this.cacheManager;
  }

  /**
   * Get terrain height using cached heightmap
   */
  getHeightAt(x: number, y: number): number {
    const cx = Math.floor(x / this.chunkSize);
    const cy = Math.floor(y / this.chunkSize);

    // Try to get cached heightmap
    const heightmap = this.cacheManager.getHeightmapSync(cx, cy);
    if (heightmap) {
      const localX = x - cx * this.chunkSize;
      const localY = y - cy * this.chunkSize;
      return getInterpolatedHeight(heightmap, localX, localY, this.chunkSize);
    }

    // Fall back to procedural
    return this.fallback.getHeightAt(x, y);
  }

  /**
   * Get full terrain sample using cached heightmap
   */
  getSampleAt(x: number, y: number): TerrainSample {
    const cx = Math.floor(x / this.chunkSize);
    const cy = Math.floor(y / this.chunkSize);

    // Try to get cached heightmap
    const heightmap = this.cacheManager.getHeightmapSync(cx, cy);
    if (heightmap) {
      const localX = x - cx * this.chunkSize;
      const localY = y - cy * this.chunkSize;

      const height = getInterpolatedHeight(heightmap, localX, localY, this.chunkSize);
      const normal = getInterpolatedNormal(heightmap, localX, localY, this.chunkSize);

      // Calculate slope from normal
      // Normal = (-slopeX, -slopeY, 1) normalized
      // So slopeX = -nx/nz, slopeY = -ny/nz
      const slopeX = normal.nz !== 0 ? -normal.nx / normal.nz : 0;
      const slopeY = normal.nz !== 0 ? -normal.ny / normal.nz : 0;

      return {
        height,
        normalX: normal.nx,
        normalY: normal.ny,
        normalZ: normal.nz,
        slopeX,
        slopeY,
      };
    }

    // Fall back to procedural
    return this.fallback.getSampleAt(x, y);
  }

  /**
   * Check if a chunk's heightmap is loaded
   */
  isChunkLoaded(cx: number, cy: number): boolean {
    return this.cacheManager.isLoaded(cx, cy);
  }

  /**
   * Preload chunks around a position
   */
  async preloadAround(
    worldX: number,
    worldY: number,
    seeds: Map<string, { seed: number; biome: number }>
  ): Promise<void> {
    const cx = Math.floor(worldX / this.chunkSize);
    const cy = Math.floor(worldY / this.chunkSize);
    await this.cacheManager.preloadAround(cx, cy, seeds);
  }
}
