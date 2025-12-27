/**
 * GraphStateToMusic - Maps graph physics and network state to audio parameters
 *
 * This module translates the dynamic state of the social graph simulation
 * into musical parameters that create an ambient soundscape reflecting
 * the overall "mood" and activity level of the world.
 *
 * Mapping Philosophy:
 * - Kinetic energy (movement) -> Volume and timbral brightness of drones
 * - Spring tension -> Filter characteristics (tighter = more resonant)
 * - Clustering -> Harmonic density (more clusters = more chords)
 * - Graph changes -> Pitch modulation (expansion/contraction)
 * - Overall agreeableness -> Musical key and mode
 * - Time of day -> Key transposition (circadian musical shifts)
 */

import { mapRangeClamped, clamp, smoothstep, lerp } from '../utils/AudioMath';
import { type ScaleType, NOTE_NAMES, type NoteName } from '../utils/scales';

// ============================================================================
// Constants
// ============================================================================

/** Minimum tempo in BPM (slow, calm world) */
const MIN_TEMPO = 40;

/** Maximum tempo in BPM (fast, active world) */
const MAX_TEMPO = 120;

/** Expected maximum average velocity for normalization */
const MAX_EXPECTED_VELOCITY = 100;

/** Minimum drone volume in dB (calm, low energy) */
const MIN_ENERGY_VOLUME = -36;

/** Maximum drone volume in dB (high energy, active) */
const MAX_ENERGY_VOLUME = -12;

/** Expected maximum total energy for normalization */
const MAX_EXPECTED_ENERGY = 10000;

/** Minimum filter frequency for drone brightness (dark, low energy) */
const MIN_BRIGHTNESS_FREQ = 200;

/** Maximum filter frequency for drone brightness (bright, high energy) */
const MAX_BRIGHTNESS_FREQ = 4000;

/** Minimum filter cutoff for spring tension (loose springs) */
const MIN_TENSION_CUTOFF = 500;

/** Maximum filter cutoff for spring tension (tight springs) */
const MAX_TENSION_CUTOFF = 8000;

/** Expected maximum average spring tension */
const MAX_EXPECTED_TENSION = 1.0;

/** Minimum chord notes (single note, low clustering) */
const MIN_CHORD_NOTES = 1;

/** Maximum chord notes (full chord, high clustering) */
const MAX_CHORD_NOTES = 6;

/** Maximum pitch bend in cents for diameter changes */
const MAX_PITCH_BEND_CENTS = 100;

/** Maximum expected change in graph diameter */
const MAX_DIAMETER_CHANGE = 10;

// ============================================================================
// Velocity to Tempo
// ============================================================================

/**
 * Map average node velocity to global tempo
 *
 * The overall "speed" of the simulation translates to musical tempo:
 * - Low velocity (0-20): Slow tempo (40-60 BPM) - calm, meditative
 * - Medium velocity (20-60): Moderate tempo (60-90 BPM) - active, engaged
 * - High velocity (60-100): Fast tempo (90-120 BPM) - energetic, chaotic
 *
 * Uses smoothstep for a natural acceleration curve.
 *
 * @param velocity - Average velocity of all nodes (0 to MAX_EXPECTED_VELOCITY)
 * @returns Tempo in beats per minute (40-120)
 *
 * @example
 * velocityToTempo(10)  // ~48 BPM (slow, calm)
 * velocityToTempo(50)  // ~80 BPM (moderate)
 * velocityToTempo(90)  // ~112 BPM (fast, energetic)
 */
export function velocityToTempo(velocity: number): number {
  const clamped = clamp(velocity, 0, MAX_EXPECTED_VELOCITY);

  // Use smoothstep for perceptually natural tempo changes
  const t = smoothstep(0, MAX_EXPECTED_VELOCITY, clamped);

  return lerp(MIN_TEMPO, MAX_TEMPO, t);
}

// ============================================================================
// Agreeableness to Key
// ============================================================================

/**
 * Key mappings based on agreeableness level
 * Maps the circle of fifths to emotional brightness
 */
interface KeyMapping {
  key: NoteName;
  mode: ScaleType;
}

/**
 * Map dominant agreeableness of the population to musical key and mode
 *
 * The overall "mood" of the world's population determines the musical
 * key signature:
 *
 * - 0-20 (Very Disagreeable): E Phrygian - dark, tense, conflict
 * - 20-35 (Disagreeable): A Minor - melancholic, serious
 * - 35-50 (Slightly Negative): D Dorian - reflective, searching
 * - 50-65 (Slightly Positive): G Mixolydian - hopeful, grounded
 * - 65-80 (Agreeable): C Major - bright, stable, happy
 * - 80-100 (Very Agreeable): F Lydian - dreamy, transcendent
 *
 * The key choices follow the circle of fifths for smooth modulation
 * potential as the world mood changes.
 *
 * @param agreeableness - Average agreeableness of population (0-100)
 * @returns Object with key (note name) and mode (scale type)
 *
 * @example
 * agreeablenessToKey(15)  // { key: 'E', mode: 'phrygian' }
 * agreeablenessToKey(45)  // { key: 'D', mode: 'dorian' }
 * agreeablenessToKey(75)  // { key: 'C', mode: 'major' }
 */
export function agreeablenessToKey(agreeableness: number): KeyMapping {
  const clamped = clamp(agreeableness, 0, 100);

  // Tiered mapping based on agreeableness levels
  if (clamped < 20) {
    // Very disagreeable: E Phrygian - dark and tense
    return { key: 'E', mode: 'phrygian' };
  } else if (clamped < 35) {
    // Disagreeable: A Minor - melancholic
    return { key: 'A', mode: 'minor' };
  } else if (clamped < 50) {
    // Slightly negative: D Dorian - reflective
    return { key: 'D', mode: 'dorian' };
  } else if (clamped < 65) {
    // Slightly positive: G Mixolydian - hopeful
    return { key: 'G', mode: 'mixolydian' };
  } else if (clamped < 80) {
    // Agreeable: C Major - bright and stable
    return { key: 'C', mode: 'major' };
  } else {
    // Very agreeable: F Lydian - dreamy, transcendent
    return { key: 'F', mode: 'lydian' };
  }
}

// ============================================================================
// Time of Day to Key Shift
// ============================================================================

/**
 * Map time of day to key transposition
 *
 * Creates circadian musical variation:
 * - Dawn (4-8): Rising from night, +2 semitones (brighter)
 * - Morning (8-12): Peak brightness, +4 semitones (highest)
 * - Afternoon (12-16): Settling, +2 semitones
 * - Evening (16-20): Warming, 0 semitones (neutral)
 * - Dusk (20-24): Darkening, -2 semitones
 * - Night (0-4): Deepest, -4 semitones (lowest)
 *
 * This creates a natural musical progression through the day cycle.
 *
 * @param hour - Hour of day (0-23)
 * @returns Semitone shift from base key (-4 to +4)
 *
 * @example
 * timeOfDayToKeyShift(2)   // -4 (deep night)
 * timeOfDayToKeyShift(10)  // +4 (bright morning)
 * timeOfDayToKeyShift(18)  // 0 (neutral evening)
 */
export function timeOfDayToKeyShift(hour: number): number {
  // Normalize hour to 0-23 range
  const normalizedHour = ((hour % 24) + 24) % 24;

  // Map hour to semitone shift using a sine-like curve
  // Peak brightness at noon (hour 12), deepest at midnight (hour 0)
  // Use cosine for smooth transitions, offset so noon = peak

  // Convert to radians (0 = midnight, PI = noon)
  const radians = (normalizedHour / 24) * 2 * Math.PI;

  // Cosine gives us: midnight = 1, noon = -1
  // We want: midnight = -4, noon = +4
  // So we negate and scale
  const cosValue = Math.cos(radians);

  // Map from [-1, 1] to [-4, +4]
  return Math.round(-cosValue * 4);
}

// ============================================================================
// Energy to Volume and Brightness
// ============================================================================

/**
 * Map total kinetic energy to drone volume
 *
 * The overall energy in the simulation affects the drone's loudness:
 * - Low energy (calm world): Quiet drones (-36 dB)
 * - High energy (active world): Loud drones (-12 dB)
 *
 * Uses logarithmic scaling since energy can vary over large ranges.
 *
 * @param energy - Total kinetic energy of all nodes
 * @returns Volume in decibels (negative values)
 *
 * @example
 * energyToVolume(100)    // ~-33 dB (quiet, calm)
 * energyToVolume(2500)   // ~-24 dB (moderate)
 * energyToVolume(8000)   // ~-15 dB (loud, active)
 */
export function energyToVolume(energy: number): number {
  const clamped = clamp(energy, 0, MAX_EXPECTED_ENERGY);

  // Logarithmic scaling for perceptual linearity
  // Add 1 to avoid log(0), use log10 for intuitive scaling
  const logEnergy = Math.log10(clamped + 1);
  const logMax = Math.log10(MAX_EXPECTED_ENERGY + 1);

  const t = logEnergy / logMax;

  return lerp(MIN_ENERGY_VOLUME, MAX_ENERGY_VOLUME, t);
}

/**
 * Map total kinetic energy to timbral brightness (filter frequency)
 *
 * Higher energy creates brighter, more present drones:
 * - Low energy: Dark, muted drones (200 Hz cutoff)
 * - High energy: Bright, shimmering drones (4000 Hz cutoff)
 *
 * @param energy - Total kinetic energy of all nodes
 * @returns Filter frequency in Hz
 *
 * @example
 * energyToBrightness(100)   // ~400 Hz (dark)
 * energyToBrightness(2500)  // ~1200 Hz (moderate)
 * energyToBrightness(8000)  // ~3200 Hz (bright)
 */
export function energyToBrightness(energy: number): number {
  const clamped = clamp(energy, 0, MAX_EXPECTED_ENERGY);

  // Logarithmic scaling matching volume curve
  const logEnergy = Math.log10(clamped + 1);
  const logMax = Math.log10(MAX_EXPECTED_ENERGY + 1);

  const t = logEnergy / logMax;

  return lerp(MIN_BRIGHTNESS_FREQ, MAX_BRIGHTNESS_FREQ, t);
}

// ============================================================================
// Spring Tension to Filter Cutoff
// ============================================================================

/**
 * Map average spring tension to filter cutoff frequency
 *
 * Spring tension represents the "tightness" of social bonds in the graph:
 * - Low tension (loose springs): Relaxed, low filter (500 Hz)
 * - High tension (tight springs): Tense, high filter (8000 Hz)
 *
 * Higher filter cutoffs create a more "tense" or "tight" sound
 * with more harmonic content.
 *
 * @param tension - Average spring tension (0 to MAX_EXPECTED_TENSION)
 * @returns Filter cutoff frequency in Hz
 *
 * @example
 * tensionToFilterCutoff(0.1)  // ~1250 Hz (relaxed)
 * tensionToFilterCutoff(0.5)  // ~4250 Hz (moderate)
 * tensionToFilterCutoff(0.9)  // ~7250 Hz (tense)
 */
export function tensionToFilterCutoff(tension: number): number {
  const clamped = clamp(tension, 0, MAX_EXPECTED_TENSION);

  // Linear mapping for tension
  return mapRangeClamped(
    clamped,
    0,
    MAX_EXPECTED_TENSION,
    MIN_TENSION_CUTOFF,
    MAX_TENSION_CUTOFF
  );
}

// ============================================================================
// Clustering to Chord Density
// ============================================================================

/**
 * Map clustering coefficient to chord density
 *
 * The clustering coefficient (0-1) measures how interconnected
 * nodes' neighbors are. This translates to harmonic density:
 *
 * - Low clustering (0-0.3): Single notes or dyads (1-2 notes)
 * - Medium clustering (0.3-0.6): Triads (3-4 notes)
 * - High clustering (0.6-1.0): Full chords (5-6 notes)
 *
 * More interconnected communities create richer, fuller harmonies.
 *
 * @param clustering - Clustering coefficient (0 to 1)
 * @returns Number of notes in chord (1 to 6)
 *
 * @example
 * clusteringToChordDensity(0.2)  // 2 (sparse, dyad)
 * clusteringToChordDensity(0.5)  // 4 (moderate, tetrad)
 * clusteringToChordDensity(0.9)  // 6 (dense, full chord)
 */
export function clusteringToChordDensity(clustering: number): number {
  const clamped = clamp(clustering, 0, 1);

  // Direct mapping from clustering to chord size
  const density = mapRangeClamped(
    clamped,
    0,
    1,
    MIN_CHORD_NOTES,
    MAX_CHORD_NOTES
  );

  // Return rounded integer for number of notes
  return Math.round(density);
}

// ============================================================================
// Diameter to Pitch Bend
// ============================================================================

/**
 * Map graph diameter changes to pitch bend
 *
 * Changes in graph diameter (the longest shortest path) create
 * pitch modulation effects:
 *
 * - Diameter increasing (spreading out): Pitch bends down (stretching)
 * - Diameter stable: No pitch bend
 * - Diameter decreasing (clustering): Pitch bends up (compressing)
 *
 * This creates an organic "breathing" effect as the graph expands
 * and contracts.
 *
 * @param diameter - Current graph diameter
 * @param prevDiameter - Previous graph diameter
 * @returns Pitch bend in cents (-100 to +100)
 *
 * @example
 * diameterToPitchBend(15, 10) // -50 (expanding, pitch down)
 * diameterToPitchBend(10, 10) // 0 (stable)
 * diameterToPitchBend(5, 10)  // +50 (contracting, pitch up)
 */
export function diameterToPitchBend(
  diameter: number,
  prevDiameter: number
): number {
  // Calculate the change in diameter
  const change = diameter - prevDiameter;

  // Clamp the change to expected range
  const clampedChange = clamp(change, -MAX_DIAMETER_CHANGE, MAX_DIAMETER_CHANGE);

  // Map change to pitch bend
  // Positive change (expansion) = negative pitch bend (lower)
  // Negative change (contraction) = positive pitch bend (higher)
  return mapRangeClamped(
    clampedChange,
    -MAX_DIAMETER_CHANGE,
    MAX_DIAMETER_CHANGE,
    MAX_PITCH_BEND_CENTS, // Contraction -> pitch up
    -MAX_PITCH_BEND_CENTS // Expansion -> pitch down
  );
}
