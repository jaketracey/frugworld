/**
 * Mathematical utilities for audio processing and procedural generation
 * Provides common math functions optimized for audio applications
 */

// ============================================================================
// Interpolation Functions
// ============================================================================

/**
 * Linear interpolation between two values
 *
 * @param a - Start value
 * @param b - End value
 * @param t - Interpolation factor (0 = a, 1 = b)
 * @returns Interpolated value
 *
 * @example
 * lerp(0, 100, 0.5) // 50
 * lerp(0, 100, 0.25) // 25
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Inverse linear interpolation - find t given a value between a and b
 *
 * @param a - Start value
 * @param b - End value
 * @param value - The value to find t for
 * @returns The interpolation factor t
 */
export function inverseLerp(a: number, b: number, value: number): number {
  if (a === b) return 0;
  return (value - a) / (b - a);
}

// ============================================================================
// Clamping and Range Functions
// ============================================================================

/**
 * Clamp a value between minimum and maximum bounds
 *
 * @param value - The value to clamp
 * @param min - Minimum bound
 * @param max - Maximum bound
 * @returns Clamped value
 *
 * @example
 * clamp(150, 0, 100) // 100
 * clamp(-10, 0, 100) // 0
 * clamp(50, 0, 100) // 50
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Map a value from one range to another
 * Useful for converting between different unit systems or scales
 *
 * @param value - The input value
 * @param inMin - Input range minimum
 * @param inMax - Input range maximum
 * @param outMin - Output range minimum
 * @param outMax - Output range maximum
 * @returns The value mapped to the output range
 *
 * @example
 * mapRange(0.5, 0, 1, 0, 100) // 50
 * mapRange(50, 0, 100, -1, 1) // 0
 */
export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  // Avoid division by zero
  if (inMin === inMax) return outMin;

  const normalized = (value - inMin) / (inMax - inMin);
  return outMin + normalized * (outMax - outMin);
}

/**
 * Map a value from one range to another with clamping
 *
 * @param value - The input value
 * @param inMin - Input range minimum
 * @param inMax - Input range maximum
 * @param outMin - Output range minimum
 * @param outMax - Output range maximum
 * @returns The value mapped to the output range, clamped to bounds
 */
export function mapRangeClamped(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  const mapped = mapRange(value, inMin, inMax, outMin, outMax);
  const minOut = Math.min(outMin, outMax);
  const maxOut = Math.max(outMin, outMax);
  return clamp(mapped, minOut, maxOut);
}

// ============================================================================
// Decibel Conversion
// ============================================================================

/**
 * Convert decibels to linear gain
 * dB = 20 * log10(gain), so gain = 10^(dB/20)
 *
 * @param db - Value in decibels
 * @returns Linear gain value
 *
 * @example
 * dbToGain(0) // 1.0
 * dbToGain(-6) // ~0.501 (half amplitude)
 * dbToGain(-20) // 0.1
 * dbToGain(-Infinity) // 0
 */
export function dbToGain(db: number): number {
  if (db === -Infinity) return 0;
  return Math.pow(10, db / 20);
}

/**
 * Convert linear gain to decibels
 * dB = 20 * log10(gain)
 *
 * @param gain - Linear gain value (0 to any positive number)
 * @returns Value in decibels
 *
 * @example
 * gainToDb(1.0) // 0
 * gainToDb(0.5) // ~-6.02
 * gainToDb(0.1) // -20
 * gainToDb(0) // -Infinity
 */
export function gainToDb(gain: number): number {
  if (gain <= 0) return -Infinity;
  return 20 * Math.log10(gain);
}

// ============================================================================
// Smoothing Functions
// ============================================================================

/**
 * Smoothstep interpolation with smooth edges
 * Provides an S-curve that eases in and out
 *
 * @param edge0 - Lower edge of the range
 * @param edge1 - Upper edge of the range
 * @param x - Input value
 * @returns Smoothly interpolated value between 0 and 1
 *
 * @example
 * smoothstep(0, 1, 0.5) // 0.5
 * smoothstep(0, 1, 0.25) // ~0.156
 * smoothstep(0, 1, 0.75) // ~0.844
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  // Clamp and normalize to 0-1 range
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  // Apply smoothstep polynomial: 3t^2 - 2t^3
  return t * t * (3 - 2 * t);
}

/**
 * Smoother step function (Ken Perlin's improved version)
 * Has zero first and second derivatives at the edges
 *
 * @param edge0 - Lower edge of the range
 * @param edge1 - Upper edge of the range
 * @param x - Input value
 * @returns Smoothly interpolated value between 0 and 1
 */
export function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  // Apply smootherstep polynomial: 6t^5 - 15t^4 + 10t^3
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// ============================================================================
// Random Functions
// ============================================================================

/**
 * Generate a random number within a range
 *
 * @param min - Minimum value (inclusive)
 * @param max - Maximum value (exclusive)
 * @returns Random number in the range [min, max)
 *
 * @example
 * randomInRange(0, 100) // Random number between 0 and 100
 * randomInRange(-1, 1) // Random number between -1 and 1
 */
export function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Generate a random integer within a range
 *
 * @param min - Minimum value (inclusive)
 * @param max - Maximum value (inclusive)
 * @returns Random integer in the range [min, max]
 */
export function randomIntInRange(min: number, max: number): number {
  const minCeil = Math.ceil(min);
  const maxFloor = Math.floor(max);
  return Math.floor(Math.random() * (maxFloor - minCeil + 1)) + minCeil;
}

/**
 * Generate a random value with gaussian (normal) distribution
 * Uses the Box-Muller transform
 *
 * @param mean - Mean of the distribution
 * @param stdDev - Standard deviation
 * @returns Random value from the gaussian distribution
 */
export function randomGaussian(mean: number = 0, stdDev: number = 1): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z0 * stdDev + mean;
}

// ============================================================================
// Audio-Specific Math
// ============================================================================

/**
 * Calculate the exponential decay value at a given time
 * Useful for envelope generation
 *
 * @param time - Current time
 * @param decayRate - Rate of decay (higher = faster)
 * @returns Decay value (starts at 1, approaches 0)
 */
export function exponentialDecay(time: number, decayRate: number): number {
  return Math.exp(-decayRate * time);
}

/**
 * Calculate the attack-decay-sustain-release (ADSR) envelope value
 *
 * @param time - Current time in seconds
 * @param attack - Attack time in seconds
 * @param decay - Decay time in seconds
 * @param sustain - Sustain level (0-1)
 * @param release - Release time in seconds
 * @param releaseStart - Time when release started (or Infinity if not released)
 * @returns Envelope value (0-1)
 */
export function adsrEnvelope(
  time: number,
  attack: number,
  decay: number,
  sustain: number,
  release: number,
  releaseStart: number = Infinity
): number {
  // Handle release phase
  if (time >= releaseStart) {
    const releaseTime = time - releaseStart;
    const releaseValue = adsrEnvelope(
      releaseStart,
      attack,
      decay,
      sustain,
      release,
      Infinity
    );
    if (release <= 0) return 0;
    return releaseValue * (1 - Math.min(1, releaseTime / release));
  }

  // Attack phase
  if (time < attack) {
    return attack > 0 ? time / attack : 1;
  }

  // Decay phase
  const decayStart = attack;
  if (time < decayStart + decay) {
    const decayTime = time - decayStart;
    const decayProgress = decay > 0 ? decayTime / decay : 1;
    return 1 - (1 - sustain) * decayProgress;
  }

  // Sustain phase
  return sustain;
}

/**
 * Convert BPM (beats per minute) to milliseconds per beat
 *
 * @param bpm - Beats per minute
 * @returns Milliseconds per beat
 */
export function bpmToMs(bpm: number): number {
  if (bpm <= 0) return Infinity;
  return 60000 / bpm;
}

/**
 * Convert milliseconds per beat to BPM
 *
 * @param ms - Milliseconds per beat
 * @returns Beats per minute
 */
export function msToBpm(ms: number): number {
  if (ms <= 0) return Infinity;
  return 60000 / ms;
}

/**
 * Calculate the frequency ratio between two notes
 *
 * @param semitones - Number of semitones between notes
 * @returns Frequency ratio
 */
export function semitonesToRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

/**
 * Calculate the number of semitones from a frequency ratio
 *
 * @param ratio - Frequency ratio
 * @returns Number of semitones
 */
export function ratioToSemitones(ratio: number): number {
  return 12 * Math.log2(ratio);
}
