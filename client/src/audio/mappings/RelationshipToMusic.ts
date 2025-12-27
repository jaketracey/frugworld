/**
 * RelationshipToMusic - Maps relationship metrics to musical parameters
 *
 * This module translates the qualities of relationships between NPCs
 * into audio parameters that sonify their social connections.
 *
 * Mapping Philosophy:
 * - Affinity (liking/disliking) -> Harmonic consonance/dissonance
 * - Trust (reliability) -> Spatial depth via reverb (trusted = closer)
 * - Interaction frequency -> Musical density/activity
 * - Relationship type -> Instrument timbre and stereo positioning
 */

import { mapRangeClamped, clamp, smoothstep } from '../utils/AudioMath';
import { affinityToInterval } from '../utils/scales';

// ============================================================================
// Constants
// ============================================================================

/** Minimum reverb wetness (no reverb, close/trusted) */
const MIN_REVERB_WET = 0.05;

/** Maximum reverb wetness (very distant/untrusted) */
const MAX_REVERB_WET = 0.8;

/** Minimum note density for low interaction count */
const MIN_INTERACTION_DENSITY = 0.25;

/** Maximum note density for high interaction count */
const MAX_INTERACTION_DENSITY = 4.0;

/** Interaction count threshold for maximum density */
const MAX_INTERACTION_COUNT = 100;

// ============================================================================
// Affinity to Consonance
// ============================================================================

/**
 * Map affinity (liking/disliking) to harmonic consonance
 *
 * Affinity determines how pleasant the interval sounds when two
 * NPCs' themes are played together:
 *
 * - 0-15 (Hostile): Tritone (6 semitones) - maximum dissonance
 * - 15-35 (Disliking): Minor 2nd/Major 7th - strong dissonance
 * - 35-55 (Neutral): Minor/Major 6th - mild tension
 * - 55-75 (Liking): Major/Minor 3rd - pleasant consonance
 * - 75-90 (Close): Perfect 4th/5th - strong consonance
 * - 90-100 (Intimate): Unison/Octave - perfect consonance
 *
 * Uses the affinityToInterval function from scales.ts for consistent
 * interval mapping across the audio system.
 *
 * @param affinity - Relationship affinity from 0 (hostile) to 100 (intimate)
 * @returns Interval in semitones (0-12)
 *
 * @example
 * affinityToConsonance(5)   // 6 (tritone - hostile)
 * affinityToConsonance(30)  // 1 or 11 (dissonant seconds/sevenths)
 * affinityToConsonance(60)  // 3 or 4 (pleasant thirds)
 * affinityToConsonance(95)  // 0 (unison - intimate)
 */
export function affinityToConsonance(affinity: number): number {
  // Use the canonical interval mapping from scales.ts
  return affinityToInterval(affinity);
}

// ============================================================================
// Trust to Reverb
// ============================================================================

/**
 * Map trust level to reverb send amount
 *
 * Trust affects the perceived "distance" of the relationship:
 * - Low trust (0-30): High reverb (0.5-0.8) - distant, uncertain
 * - Medium trust (30-70): Moderate reverb (0.2-0.5) - developing
 * - High trust (70-100): Low reverb (0.05-0.2) - close, intimate
 *
 * Higher reverb creates a sense of distance and uncertainty,
 * while dry signals feel close and immediate. This mimics how
 * we perceive trusted relationships as "closer" to us.
 *
 * @param trust - Trust level from 0 (no trust) to 100 (complete trust)
 * @returns Reverb wet/dry mix from 0 to 1
 *
 * @example
 * trustToReverb(10)  // ~0.73 (distant, untrusted)
 * trustToReverb(50)  // ~0.42 (moderate distance)
 * trustToReverb(90)  // ~0.12 (close, trusted)
 */
export function trustToReverb(trust: number): number {
  const clamped = clamp(trust, 0, 100);

  // Inverse mapping: high trust = low reverb (closer)
  // Use smoothstep for a more natural perceptual curve
  const t = smoothstep(0, 100, clamped);

  // Interpolate from max reverb (untrusted) to min reverb (trusted)
  return MAX_REVERB_WET - t * (MAX_REVERB_WET - MIN_REVERB_WET);
}

// ============================================================================
// Interaction Count to Density
// ============================================================================

/**
 * Map interaction count to musical note density
 *
 * More interactions between NPCs create a richer, more active
 * musical conversation:
 * - 0-10 interactions: Sparse (0.25-0.5 notes/beat) - unfamiliar
 * - 10-50 interactions: Moderate (0.5-2.0 notes/beat) - developing
 * - 50-100+ interactions: Dense (2.0-4.0 notes/beat) - intimate
 *
 * Uses logarithmic scaling since the perceptual difference between
 * 1 and 10 interactions is greater than between 90 and 100.
 *
 * @param count - Number of interactions between two NPCs
 * @returns Notes per beat (0.25 to 4.0)
 *
 * @example
 * interactionCountToDensity(0)    // 0.25 (strangers)
 * interactionCountToDensity(10)   // ~1.2 (acquaintances)
 * interactionCountToDensity(50)   // ~2.8 (familiar)
 * interactionCountToDensity(100)  // 4.0 (intimate)
 */
export function interactionCountToDensity(count: number): number {
  const clamped = clamp(count, 0, MAX_INTERACTION_COUNT);

  // Logarithmic mapping for perceptual linearity
  // Early interactions matter more than later ones
  const logScale = Math.log1p(clamped) / Math.log1p(MAX_INTERACTION_COUNT);

  return MIN_INTERACTION_DENSITY +
    logScale * (MAX_INTERACTION_DENSITY - MIN_INTERACTION_DENSITY);
}

// ============================================================================
// Relationship Type to Instrument
// ============================================================================

/** Relationship types and their associated synth instruments */
type RelationshipType =
  | 'stranger'
  | 'acquaintance'
  | 'friend'
  | 'close_friend'
  | 'romantic'
  | 'family'
  | 'rival'
  | 'enemy';

/**
 * Instrument mappings for each relationship type
 * Each type has a distinct timbral character
 */
const RELATIONSHIP_INSTRUMENTS: Record<RelationshipType, string> = {
  stranger: 'pad', // Ambient, undefined, background
  acquaintance: 'keys', // Clear, simple, neutral
  friend: 'pluck', // Warm, rhythmic, engaging
  close_friend: 'lead', // Prominent, melodic, expressive
  romantic: 'strings', // Lush, emotional, rich
  family: 'brass', // Strong, resonant, fundamental
  rival: 'bass', // Powerful, driving, competitive
  enemy: 'noise', // Harsh, unpredictable, threatening
};

/**
 * Stereo pan positions for each relationship type
 * Creates spatial separation between different relationship types
 */
const RELATIONSHIP_PAN: Record<RelationshipType, number> = {
  stranger: 0, // Center - neutral, undefined
  acquaintance: -0.2, // Slightly left
  friend: 0.3, // Slightly right
  close_friend: 0.1, // Near center right
  romantic: -0.1, // Near center left - intimate, close
  family: -0.4, // Left - foundational
  rival: 0.6, // Right - opposition
  enemy: 0.8, // Far right - distant, opposing
};

/**
 * Map relationship type to synthesizer instrument name
 *
 * Each relationship type has a distinct timbral character:
 * - Stranger: Pad (ambient, undefined)
 * - Acquaintance: Keys (clear, neutral)
 * - Friend: Pluck (warm, engaging)
 * - Close Friend: Lead (prominent, expressive)
 * - Romantic: Strings (lush, emotional)
 * - Family: Brass (strong, fundamental)
 * - Rival: Bass (powerful, competitive)
 * - Enemy: Noise (harsh, threatening)
 *
 * @param type - The relationship type string
 * @returns Synth instrument name
 *
 * @example
 * relationshipTypeToInstrument('friend')   // 'pluck'
 * relationshipTypeToInstrument('romantic') // 'strings'
 * relationshipTypeToInstrument('enemy')    // 'noise'
 */
export function relationshipTypeToInstrument(type: string): string {
  const relType = type.toLowerCase() as RelationshipType;

  // Return the instrument for known types, default to 'pad' for unknown
  return RELATIONSHIP_INSTRUMENTS[relType] ?? 'pad';
}

/**
 * Map relationship type to stereo pan position
 *
 * Creates spatial separation in the stereo field:
 * - Center (0): Neutral relationships (strangers, close/romantic)
 * - Left (-1 to 0): Family, foundational relationships
 * - Right (0 to 1): External relationships (friends, rivals, enemies)
 *
 * This spatial arrangement creates an intuitive sonic landscape
 * where different relationship types occupy distinct positions.
 *
 * @param type - The relationship type string
 * @returns Pan value from -1 (full left) to 1 (full right)
 *
 * @example
 * relationshipTypeToPan('stranger')  // 0 (center)
 * relationshipTypeToPan('family')    // -0.4 (left)
 * relationshipTypeToPan('rival')     // 0.6 (right)
 */
export function relationshipTypeToPan(type: string): number {
  const relType = type.toLowerCase() as RelationshipType;

  // Return the pan position for known types, default to center
  return RELATIONSHIP_PAN[relType] ?? 0;
}
