/**
 * Domain Warping
 * Distorts coordinates before sampling noise
 * Creates organic, flowing terrain shapes
 */

import { simplex2D, simplex2DSeeded } from './SimplexNoise';
import { fbm, fbmSeeded } from './FBM';

/**
 * Configuration for domain warping
 */
export interface WarpConfig {
  /** Strength of the warp displacement */
  amplitude: number;
  /** Frequency of the warp noise */
  frequency: number;
  /** Number of warp iterations */
  iterations: number;
}

/** Default warp configuration */
export const DEFAULT_WARP_CONFIG: WarpConfig = {
  amplitude: 20.0,
  frequency: 0.01,
  iterations: 1,
};

/**
 * Simple domain warping
 * Offsets input coordinates using noise
 */
export function warpCoordinates(
  x: number,
  y: number,
  config: Partial<WarpConfig> = {}
): { x: number; y: number } {
  const {
    amplitude,
    frequency,
  } = { ...DEFAULT_WARP_CONFIG, ...config };

  // Sample noise for X and Y offsets
  const offsetX = simplex2D(x * frequency, y * frequency) * amplitude;
  const offsetY = simplex2D(x * frequency + 5.2, y * frequency + 1.3) * amplitude;

  return {
    x: x + offsetX,
    y: y + offsetY,
  };
}

/**
 * Seeded domain warping
 */
export function warpCoordinatesSeeded(
  x: number,
  y: number,
  seed: number,
  config: Partial<WarpConfig> = {}
): { x: number; y: number } {
  const {
    amplitude,
    frequency,
  } = { ...DEFAULT_WARP_CONFIG, ...config };

  const offsetX = simplex2DSeeded(x * frequency, y * frequency, seed) * amplitude;
  const offsetY = simplex2DSeeded(x * frequency + 5.2, y * frequency + 1.3, seed + 100) * amplitude;

  return {
    x: x + offsetX,
    y: y + offsetY,
  };
}

/**
 * Multi-iteration domain warping (warp of warp)
 * Creates complex, flowing patterns
 */
export function multiWarp(
  x: number,
  y: number,
  config: Partial<WarpConfig> = {}
): { x: number; y: number } {
  const {
    amplitude,
    frequency,
    iterations,
  } = { ...DEFAULT_WARP_CONFIG, ...config };

  let wx = x;
  let wy = y;
  let amp = amplitude;
  let freq = frequency;

  for (let i = 0; i < iterations; i++) {
    const newX = wx + simplex2D(wx * freq, wy * freq) * amp;
    const newY = wy + simplex2D(wx * freq + 5.2, wy * freq + 1.3) * amp;
    wx = newX;
    wy = newY;
    amp *= 0.5;
    freq *= 2.0;
  }

  return { x: wx, y: wy };
}

/**
 * FBM-based domain warping
 * Uses fBm noise for smoother, more varied warping
 */
export function fbmWarp(
  x: number,
  y: number,
  config: Partial<WarpConfig> = {}
): { x: number; y: number } {
  const {
    amplitude,
    frequency,
  } = { ...DEFAULT_WARP_CONFIG, ...config };

  const offsetX = fbm(x * frequency, y * frequency, { octaves: 3 }) * amplitude;
  const offsetY = fbm(x * frequency + 5.2, y * frequency + 1.3, { octaves: 3 }) * amplitude;

  return {
    x: x + offsetX,
    y: y + offsetY,
  };
}

/**
 * Seeded FBM domain warping
 */
export function fbmWarpSeeded(
  x: number,
  y: number,
  seed: number,
  config: Partial<WarpConfig> = {}
): { x: number; y: number } {
  const {
    amplitude,
    frequency,
  } = { ...DEFAULT_WARP_CONFIG, ...config };

  const offsetX = fbmSeeded(x * frequency, y * frequency, seed, { octaves: 3 }) * amplitude;
  const offsetY = fbmSeeded(x * frequency + 5.2, y * frequency + 1.3, seed + 100, { octaves: 3 }) * amplitude;

  return {
    x: x + offsetX,
    y: y + offsetY,
  };
}

/**
 * Sample noise with domain warping applied
 * Convenience function that warps then samples
 */
export function warpedNoise(
  x: number,
  y: number,
  noiseFrequency: number,
  warpConfig: Partial<WarpConfig> = {}
): number {
  const warped = warpCoordinates(x, y, warpConfig);
  return simplex2D(warped.x * noiseFrequency, warped.y * noiseFrequency);
}

/**
 * Sample fBm with domain warping
 */
export function warpedFBM(
  x: number,
  y: number,
  noiseConfig: { frequency?: number; octaves?: number } = {},
  warpConfig: Partial<WarpConfig> = {}
): number {
  const warped = fbmWarp(x, y, warpConfig);
  return fbm(warped.x, warped.y, {
    frequency: noiseConfig.frequency ?? 1.0,
    octaves: noiseConfig.octaves ?? 4,
  });
}

/**
 * Seeded warped fBm
 */
export function warpedFBMSeeded(
  x: number,
  y: number,
  seed: number,
  noiseConfig: { frequency?: number; octaves?: number } = {},
  warpConfig: Partial<WarpConfig> = {}
): number {
  const warped = fbmWarpSeeded(x, y, seed, warpConfig);
  return fbmSeeded(warped.x, warped.y, seed + 200, {
    frequency: noiseConfig.frequency ?? 1.0,
    octaves: noiseConfig.octaves ?? 4,
  });
}
