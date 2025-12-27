/**
 * PersonalityToMusic - Maps NPC personality traits to musical parameters
 *
 * This module translates the Big Five personality traits (specifically
 * Extraversion and Agreeableness) into audio parameters that shape
 * the musical character of each NPC's sonic signature.
 *
 * Mapping Philosophy:
 * - Introverts (low extraversion) = quiet, sparse, contemplative sounds in high registers
 * - Extraverts (high extraversion) = loud, dense, energetic sounds in mid registers
 * - Disagreeable NPCs = minor modes, harsh harmonics (dissonance)
 * - Agreeable NPCs = major modes, soft harmonics (consonance)
 * - Life stages affect octave range and rhythmic activity
 */

import { mapRangeClamped, clamp } from '../utils/AudioMath';
import { type ScaleType } from '../utils/scales';

// ============================================================================
// Constants
// ============================================================================

/** Minimum volume in dB for introverted NPCs */
const MIN_VOLUME_DB = -24;

/** Maximum volume in dB for extraverted NPCs */
const MAX_VOLUME_DB = -6;

/** Lowest octave for extraverted NPCs (warmer, grounded) */
const EXTRAVERT_OCTAVE = 3;

/** Highest octave for introverted NPCs (airy, ethereal) */
const INTROVERT_OCTAVE = 5;

/** Minimum notes per beat (sparse, introverted) */
const MIN_DENSITY = 0.25;

/** Maximum notes per beat (dense, extraverted) */
const MAX_DENSITY = 2.0;

/** Bright filter frequency for agreeable NPCs (Hz) */
const AGREEABLE_FILTER_FREQ = 8000;

/** Darker filter frequency for disagreeable NPCs (Hz) */
const DISAGREEABLE_FILTER_FREQ = 800;

// ============================================================================
// Extraversion Mappings
// ============================================================================

/**
 * Map extraversion to volume level
 *
 * Extraversion affects how "loud" an NPC's musical presence is:
 * - 0-30 (Introverted): Quiet, subtle presence (-24 to -18 dB)
 * - 30-70 (Ambivert): Moderate presence (-18 to -12 dB)
 * - 70-100 (Extraverted): Loud, prominent presence (-12 to -6 dB)
 *
 * @param extraversion - Extraversion value from 0 to 100
 * @returns Volume in decibels (negative values)
 *
 * @example
 * extraversionToVolume(15)  // ~-21 dB (introverted, quiet)
 * extraversionToVolume(50)  // ~-15 dB (moderate)
 * extraversionToVolume(85)  // ~-9 dB (extraverted, loud)
 */
export function extraversionToVolume(extraversion: number): number {
  // Clamp input to valid range
  const clamped = clamp(extraversion, 0, 100);

  // Linear mapping from extraversion to volume
  // Low extraversion = quiet, high extraversion = loud
  return mapRangeClamped(clamped, 0, 100, MIN_VOLUME_DB, MAX_VOLUME_DB);
}

/**
 * Map extraversion to octave register
 *
 * Extraversion affects the pitch register:
 * - Introverts (0-30): Higher octaves (4-5) - airy, delicate, contemplative
 * - Ambiverts (30-70): Mid octaves (3-4) - balanced, versatile
 * - Extraverts (70-100): Lower-mid octaves (3) - grounded, warm, present
 *
 * The inverse relationship creates contrast: quiet introverts use high
 * frequencies that cut through gently, while loud extraverts use mid
 * frequencies that fill space without being shrill.
 *
 * @param extraversion - Extraversion value from 0 to 100
 * @returns Octave number (3-5, where 4 is middle C octave)
 *
 * @example
 * extraversionToOctave(10)  // 5 (high register for introvert)
 * extraversionToOctave(50)  // 4 (mid register)
 * extraversionToOctave(90)  // 3 (lower register for extravert)
 */
export function extraversionToOctave(extraversion: number): number {
  const clamped = clamp(extraversion, 0, 100);

  // Inverse mapping: high extraversion = lower octave
  // This creates an interesting contrast where introverts are high and airy
  const octave = mapRangeClamped(clamped, 0, 100, INTROVERT_OCTAVE, EXTRAVERT_OCTAVE);

  // Return rounded octave value
  return Math.round(octave);
}

/**
 * Map extraversion to note density (notes per beat)
 *
 * Extraversion affects musical activity level:
 * - Introverts (0-30): Sparse (0.25-0.5 notes/beat) - contemplative pauses
 * - Ambiverts (30-70): Moderate (0.5-1.0 notes/beat) - balanced rhythm
 * - Extraverts (70-100): Dense (1.0-2.0 notes/beat) - energetic, busy
 *
 * @param extraversion - Extraversion value from 0 to 100
 * @returns Notes per beat (0.25 to 2.0)
 *
 * @example
 * extraversionToDensity(20)  // ~0.4 (sparse, introverted)
 * extraversionToDensity(50)  // ~1.0 (moderate)
 * extraversionToDensity(80)  // ~1.6 (dense, extraverted)
 */
export function extraversionToDensity(extraversion: number): number {
  const clamped = clamp(extraversion, 0, 100);

  // Direct mapping: high extraversion = more notes
  return mapRangeClamped(clamped, 0, 100, MIN_DENSITY, MAX_DENSITY);
}

// ============================================================================
// Agreeableness Mappings
// ============================================================================

/**
 * Map agreeableness to musical mode/scale type
 *
 * Agreeableness affects the harmonic character:
 * - 0-20 (Very Disagreeable): Phrygian - tense, exotic, confrontational
 * - 20-40 (Disagreeable): Minor - melancholic, serious, reserved
 * - 40-60 (Neutral): Dorian - balanced, slightly melancholic but hopeful
 * - 60-80 (Agreeable): Mixolydian - bright but with depth
 * - 80-100 (Very Agreeable): Major - bright, happy, open
 *
 * @param agreeableness - Agreeableness value from 0 to 100
 * @returns Scale type string for use with SCALES constant
 *
 * @example
 * agreeablenessToMode(10)  // 'phrygian' (very disagreeable)
 * agreeablenessToMode(30)  // 'minor' (disagreeable)
 * agreeablenessToMode(50)  // 'dorian' (neutral)
 * agreeablenessToMode(70)  // 'mixolydian' (agreeable)
 * agreeablenessToMode(90)  // 'major' (very agreeable)
 */
export function agreeablenessToMode(agreeableness: number): ScaleType {
  const clamped = clamp(agreeableness, 0, 100);

  // Tiered mapping based on agreeableness levels
  if (clamped < 20) {
    // Very disagreeable: Phrygian - tense, confrontational
    return 'phrygian';
  } else if (clamped < 40) {
    // Disagreeable: Natural minor - melancholic, reserved
    return 'minor';
  } else if (clamped < 60) {
    // Neutral: Dorian - balanced minor with hope
    return 'dorian';
  } else if (clamped < 80) {
    // Agreeable: Mixolydian - bright but grounded
    return 'mixolydian';
  } else {
    // Very agreeable: Major - bright, open, friendly
    return 'major';
  }
}

/**
 * Map agreeableness to filter frequency for harmonic content
 *
 * Agreeableness affects timbral brightness:
 * - Disagreeable (0-30): Low cutoff (800-2000 Hz) - harsh, muted
 * - Neutral (30-70): Mid cutoff (2000-5000 Hz) - balanced
 * - Agreeable (70-100): High cutoff (5000-8000 Hz) - soft, bright
 *
 * Lower cutoff frequencies attenuate high harmonics, creating a darker,
 * more "closed" or harsh sound. Higher cutoffs let harmonics through
 * for a brighter, more "open" and pleasant sound.
 *
 * @param agreeableness - Agreeableness value from 0 to 100
 * @returns Filter cutoff frequency in Hz
 *
 * @example
 * agreeablenessToHarmonics(15)  // ~1400 Hz (harsh, disagreeable)
 * agreeablenessToHarmonics(50)  // ~4400 Hz (balanced)
 * agreeablenessToHarmonics(85)  // ~7200 Hz (soft, agreeable)
 */
export function agreeablenessToHarmonics(agreeableness: number): number {
  const clamped = clamp(agreeableness, 0, 100);

  // Direct mapping: high agreeableness = brighter (higher filter)
  return mapRangeClamped(
    clamped,
    0,
    100,
    DISAGREEABLE_FILTER_FREQ,
    AGREEABLE_FILTER_FREQ
  );
}

// ============================================================================
// Life Stage Mappings
// ============================================================================

/** Life stage definitions with their musical characteristics */
type LifeStage = 'child' | 'adolescent' | 'adult' | 'elder';

/**
 * Octave offsets for each life stage
 * Children are high and playful, elders are lower and wise
 */
const LIFE_STAGE_OCTAVES: Record<LifeStage, number> = {
  child: 5, // High, playful, innocent
  adolescent: 4, // Mid-high, energetic, searching
  adult: 4, // Mid, grounded, mature
  elder: 3, // Lower, wise, deep
};

/**
 * Rhythm multipliers for each life stage
 * Affects the base tempo/activity level
 */
const LIFE_STAGE_RHYTHM_MULTIPLIERS: Record<LifeStage, number> = {
  child: 1.5, // Fast, energetic, playful
  adolescent: 1.2, // Quick, eager
  adult: 1.0, // Steady, measured
  elder: 0.7, // Slow, deliberate, contemplative
};

/**
 * Map life stage to octave register
 *
 * Life stages affect the fundamental pitch register:
 * - Child: Octave 5 - high, bright, innocent
 * - Adolescent: Octave 4 - mid-high, energetic
 * - Adult: Octave 4 - mid, grounded, balanced
 * - Elder: Octave 3 - low, wise, deep
 *
 * @param lifeStage - The NPC's life stage
 * @returns Octave number (3-5)
 *
 * @example
 * lifeStageToOctave('child')      // 5
 * lifeStageToOctave('adolescent') // 4
 * lifeStageToOctave('adult')      // 4
 * lifeStageToOctave('elder')      // 3
 */
export function lifeStageToOctave(lifeStage: string): number {
  const stage = lifeStage.toLowerCase() as LifeStage;

  // Return the octave for known life stages, default to adult
  return LIFE_STAGE_OCTAVES[stage] ?? LIFE_STAGE_OCTAVES.adult;
}

/**
 * Map life stage to rhythm multiplier
 *
 * Life stages affect the tempo/activity multiplier:
 * - Child: 1.5x - fast, energetic, playful rhythms
 * - Adolescent: 1.2x - quick, eager tempos
 * - Adult: 1.0x - steady, baseline tempo
 * - Elder: 0.7x - slow, deliberate, contemplative
 *
 * This multiplier is applied to the base tempo or note duration.
 *
 * @param lifeStage - The NPC's life stage
 * @returns Rhythm multiplier (0.7 to 1.5)
 *
 * @example
 * lifeStageToRhythmMultiplier('child')      // 1.5 (fast)
 * lifeStageToRhythmMultiplier('adolescent') // 1.2 (quick)
 * lifeStageToRhythmMultiplier('adult')      // 1.0 (steady)
 * lifeStageToRhythmMultiplier('elder')      // 0.7 (slow)
 */
export function lifeStageToRhythmMultiplier(lifeStage: string): number {
  const stage = lifeStage.toLowerCase() as LifeStage;

  // Return the rhythm multiplier for known life stages, default to adult
  return LIFE_STAGE_RHYTHM_MULTIPLIERS[stage] ?? LIFE_STAGE_RHYTHM_MULTIPLIERS.adult;
}
