/**
 * Fractal Brownian Motion (fBm) Noise
 * Combines multiple octaves of noise for natural-looking terrain
 */

import { simplex2D, simplex2DSeeded } from './SimplexNoise';

/**
 * Configuration for fBm noise generation
 */
export interface FBMConfig {
  /** Number of noise layers to combine */
  octaves: number;
  /** Frequency multiplier between octaves (typically 2.0) */
  lacunarity: number;
  /** Amplitude multiplier between octaves (typically 0.5) */
  persistence: number;
  /** Initial frequency scale */
  frequency: number;
  /** Initial amplitude scale */
  amplitude: number;
}

/** Default fBm configuration for rolling hills */
export const DEFAULT_FBM_CONFIG: FBMConfig = {
  octaves: 4,
  lacunarity: 2.0,
  persistence: 0.5,
  frequency: 1.0,
  amplitude: 1.0,
};

/**
 * Fractal Brownian Motion noise
 * Sums multiple octaves of simplex noise with decreasing amplitude
 * Returns value roughly in range [-1, 1]
 */
export function fbm(
  x: number,
  y: number,
  config: Partial<FBMConfig> = {}
): number {
  const {
    octaves,
    lacunarity,
    persistence,
    frequency: initFreq,
    amplitude: initAmp,
  } = { ...DEFAULT_FBM_CONFIG, ...config };

  let value = 0;
  let frequency = initFreq;
  let amplitude = initAmp;
  let maxAmplitude = 0;

  for (let i = 0; i < octaves; i++) {
    value += amplitude * simplex2D(x * frequency, y * frequency);
    maxAmplitude += amplitude;
    frequency *= lacunarity;
    amplitude *= persistence;
  }

  // Normalize to approximately [-1, 1]
  return value / maxAmplitude;
}

/**
 * Seeded fBm noise
 * Each octave uses a different seed offset for variety
 */
export function fbmSeeded(
  x: number,
  y: number,
  seed: number,
  config: Partial<FBMConfig> = {}
): number {
  const {
    octaves,
    lacunarity,
    persistence,
    frequency: initFreq,
    amplitude: initAmp,
  } = { ...DEFAULT_FBM_CONFIG, ...config };

  let value = 0;
  let frequency = initFreq;
  let amplitude = initAmp;
  let maxAmplitude = 0;

  for (let i = 0; i < octaves; i++) {
    // Each octave uses a different seed
    const octaveSeed = seed + i * 1000;
    value += amplitude * simplex2DSeeded(x * frequency, y * frequency, octaveSeed);
    maxAmplitude += amplitude;
    frequency *= lacunarity;
    amplitude *= persistence;
  }

  return value / maxAmplitude;
}

/**
 * Normalized fBm [0, 1]
 */
export function fbmNormalized(
  x: number,
  y: number,
  config: Partial<FBMConfig> = {}
): number {
  return (fbm(x, y, config) + 1) * 0.5;
}

/**
 * Normalized seeded fBm [0, 1]
 */
export function fbmSeededNormalized(
  x: number,
  y: number,
  seed: number,
  config: Partial<FBMConfig> = {}
): number {
  return (fbmSeeded(x, y, seed, config) + 1) * 0.5;
}

/**
 * Turbulence noise (absolute value fBm)
 * Creates sharp ridges and edges
 */
export function turbulence(
  x: number,
  y: number,
  config: Partial<FBMConfig> = {}
): number {
  const {
    octaves,
    lacunarity,
    persistence,
    frequency: initFreq,
    amplitude: initAmp,
  } = { ...DEFAULT_FBM_CONFIG, ...config };

  let value = 0;
  let frequency = initFreq;
  let amplitude = initAmp;
  let maxAmplitude = 0;

  for (let i = 0; i < octaves; i++) {
    // Use absolute value for turbulence effect
    value += amplitude * Math.abs(simplex2D(x * frequency, y * frequency));
    maxAmplitude += amplitude;
    frequency *= lacunarity;
    amplitude *= persistence;
  }

  return value / maxAmplitude;
}

/**
 * Billowed noise (inverted turbulence)
 * Creates smooth, cloud-like bumps
 */
export function billowed(
  x: number,
  y: number,
  config: Partial<FBMConfig> = {}
): number {
  return 1 - turbulence(x, y, config);
}
