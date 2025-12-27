/**
 * Ridged Multi-Fractal Noise
 * Creates sharp mountain ridges and valleys
 * Good for dramatic terrain features
 */

import { simplex2D, simplex2DSeeded } from './SimplexNoise';

/**
 * Configuration for ridged noise
 */
export interface RidgedConfig {
  /** Number of noise layers */
  octaves: number;
  /** Frequency multiplier between octaves */
  lacunarity: number;
  /** How much the ridge affects subsequent octaves */
  gain: number;
  /** Sharpness of ridges (higher = sharper) */
  offset: number;
  /** Initial frequency */
  frequency: number;
}

/** Default ridged noise configuration */
export const DEFAULT_RIDGED_CONFIG: RidgedConfig = {
  octaves: 4,
  lacunarity: 2.0,
  gain: 2.0,
  offset: 1.0,
  frequency: 1.0,
};

/**
 * Basic ridged noise (single octave)
 * Creates sharp peaks where noise crosses zero
 * Returns value in range [0, 1]
 */
export function ridge(x: number, y: number, offset: number = 1.0): number {
  const n = simplex2D(x, y);
  // Invert absolute value to create ridges
  return offset - Math.abs(n);
}

/**
 * Ridged multi-fractal noise
 * Each octave's amplitude is weighted by the previous ridge value
 * Returns value approximately in range [0, 1]
 */
export function ridgedMultiFractal(
  x: number,
  y: number,
  config: Partial<RidgedConfig> = {}
): number {
  const {
    octaves,
    lacunarity,
    gain,
    offset,
    frequency: initFreq,
  } = { ...DEFAULT_RIDGED_CONFIG, ...config };

  let frequency = initFreq;
  let amplitude = 1.0;
  let value = 0;
  let weight = 1.0;

  for (let i = 0; i < octaves; i++) {
    // Calculate signal using ridge function
    let signal = ridge(x * frequency, y * frequency, offset);

    // Square for sharper ridges
    signal *= signal;

    // Weight by previous octave's signal
    signal *= weight;

    // Update weight for next octave
    weight = Math.min(1.0, Math.max(0.0, signal * gain));

    // Accumulate
    value += signal * amplitude;

    // Update frequency and amplitude
    frequency *= lacunarity;
    amplitude *= 0.5;
  }

  // Normalize roughly to [0, 1]
  return Math.min(1.0, Math.max(0.0, value * 0.5));
}

/**
 * Seeded ridged multi-fractal noise
 */
export function ridgedMultiFractalSeeded(
  x: number,
  y: number,
  seed: number,
  config: Partial<RidgedConfig> = {}
): number {
  const {
    octaves,
    lacunarity,
    gain,
    offset,
    frequency: initFreq,
  } = { ...DEFAULT_RIDGED_CONFIG, ...config };

  let frequency = initFreq;
  let amplitude = 1.0;
  let value = 0;
  let weight = 1.0;

  for (let i = 0; i < octaves; i++) {
    const octaveSeed = seed + i * 1000;

    // Calculate signal using simplex with seed
    let signal = offset - Math.abs(simplex2DSeeded(x * frequency, y * frequency, octaveSeed));
    signal *= signal;
    signal *= weight;

    weight = Math.min(1.0, Math.max(0.0, signal * gain));
    value += signal * amplitude;

    frequency *= lacunarity;
    amplitude *= 0.5;
  }

  return Math.min(1.0, Math.max(0.0, value * 0.5));
}

/**
 * Swiss (erosion-like) ridged noise
 * Similar to ridged but with eroded valleys
 */
export function swissNoise(
  x: number,
  y: number,
  config: Partial<RidgedConfig> = {}
): number {
  const {
    octaves,
    lacunarity,
    gain,
    offset,
    frequency: initFreq,
  } = { ...DEFAULT_RIDGED_CONFIG, ...config };

  let frequency = initFreq;
  let amplitude = 1.0;
  let value = 0;
  let warp = 0;

  // Derivative tracking for erosion effect
  let dx = 0;
  let dy = 0;

  for (let i = 0; i < octaves; i++) {
    // Warp the coordinates based on derivatives
    const wx = x * frequency + warp * dx;
    const wy = y * frequency + warp * dy;

    const n = simplex2D(wx, wy);
    const signal = offset - Math.abs(n);

    // Estimate derivatives for warping
    const eps = 0.01;
    dx = (simplex2D(wx + eps, wy) - n) / eps;
    dy = (simplex2D(wx, wy + eps) - n) / eps;

    value += signal * signal * amplitude;
    warp += gain;

    frequency *= lacunarity;
    amplitude *= 0.5;
  }

  return Math.min(1.0, Math.max(0.0, value * 0.5));
}

/**
 * Valley noise (inverted ridged)
 * Creates valleys and river-like channels
 */
export function valleyNoise(
  x: number,
  y: number,
  config: Partial<RidgedConfig> = {}
): number {
  return 1 - ridgedMultiFractal(x, y, config);
}

/**
 * Seeded valley noise
 */
export function valleyNoiseSeeded(
  x: number,
  y: number,
  seed: number,
  config: Partial<RidgedConfig> = {}
): number {
  return 1 - ridgedMultiFractalSeeded(x, y, seed, config);
}
