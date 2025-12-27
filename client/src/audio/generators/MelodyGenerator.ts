/**
 * MelodyGenerator - Generates melodic phrases from NPC state and personality
 * Creates note sequences that stay in key and express character through music
 */

import {
  SCALES,
  ScaleType,
  NoteName,
  NOTE_NAMES,
  getNoteInScale,
  noteToMidi,
  midiToNote,
  quantizeToScale,
} from '../utils/scales';
import {
  clamp,
  mapRange,
  randomInRange,
  randomIntInRange,
  randomGaussian,
} from '../utils/AudioMath';

// ============================================================================
// Types
// ============================================================================

/**
 * A single note event in a melodic phrase
 */
export interface NoteEvent {
  /** Note name with octave (e.g., 'C4', 'F#5') */
  note: string;
  /** Start time in Tone.js notation or seconds */
  time: number;
  /** Duration in Tone.js notation or seconds */
  duration: number;
  /** Velocity/loudness (0-1) */
  velocity: number;
}

/**
 * Contour types for melodic shape
 */
export type ContourType = 'ascending' | 'descending' | 'arch' | 'wave' | 'random';

/**
 * Life stages that affect melodic characteristics
 */
export type LifeStage = 'youth' | 'adult' | 'mature' | 'elder';

/**
 * Configuration options for melody generation
 */
export interface MelodyConfig {
  /** Base octave for the melody (default: 4) */
  baseOctave?: number;
  /** Octave range to explore (default: 2) */
  octaveRange?: number;
  /** Base duration for notes in seconds (default: 0.25) */
  baseDuration?: number;
  /** Base velocity (default: 0.7) */
  baseVelocity?: number;
  /** Probability of rest (0-1, default: 0.1) */
  restProbability?: number;
  /** Maximum interval jump in scale degrees (default: 4) */
  maxIntervalJump?: number;
}

// ============================================================================
// Seeded Random Number Generator
// ============================================================================

/**
 * Simple seeded PRNG using mulberry32 algorithm
 * Provides deterministic random numbers when given a seed
 */
class SeededRandom {
  private state: number;

  constructor(seed: number = Date.now()) {
    this.state = seed;
  }

  /**
   * Generate next random number between 0 and 1
   */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Generate random number in range
   */
  nextInRange(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Generate random integer in range (inclusive)
   */
  nextIntInRange(min: number, max: number): number {
    return Math.floor(this.nextInRange(min, max + 1));
  }

  /**
   * Generate gaussian-distributed random number
   */
  nextGaussian(mean: number = 0, stdDev: number = 1): number {
    const u1 = this.next();
    const u2 = this.next();
    const z0 = Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
    return z0 * stdDev + mean;
  }
}

// ============================================================================
// MelodyGenerator Class
// ============================================================================

/**
 * Generates melodic phrases based on musical parameters and NPC personality
 */
export class MelodyGenerator {
  private contour: ContourType = 'random';
  private config: Required<MelodyConfig>;
  private rng: SeededRandom;

  constructor(config: MelodyConfig = {}, seed?: number) {
    this.config = {
      baseOctave: config.baseOctave ?? 4,
      octaveRange: config.octaveRange ?? 2,
      baseDuration: config.baseDuration ?? 0.25,
      baseVelocity: config.baseVelocity ?? 0.7,
      restProbability: config.restProbability ?? 0.1,
      maxIntervalJump: config.maxIntervalJump ?? 4,
    };
    this.rng = new SeededRandom(seed);
  }

  /**
   * Set the melodic contour type
   * @param type - The contour shape for generated melodies
   */
  setContour(type: ContourType): void {
    this.contour = type;
  }

  /**
   * Get the current contour type
   */
  getContour(): ContourType {
    return this.contour;
  }

  /**
   * Reset the random number generator with a new seed
   */
  setSeed(seed: number): void {
    this.rng = new SeededRandom(seed);
  }

  /**
   * Generate a melodic phrase
   *
   * @param length - Number of notes in the phrase
   * @param scale - Scale intervals to use (e.g., SCALES.major)
   * @param root - Root note name (e.g., 'C', 'F#')
   * @returns Array of note events forming the melody
   */
  generatePhrase(
    length: number,
    scale: readonly number[],
    root: NoteName
  ): NoteEvent[] {
    const notes: NoteEvent[] = [];
    const rootMidi = noteToMidi(root, this.config.baseOctave);
    let currentDegree = 0; // Start on the root
    let currentTime = 0;

    for (let i = 0; i < length; i++) {
      // Check for rest
      if (this.rng.next() < this.config.restProbability && i > 0) {
        currentTime += this.config.baseDuration;
        continue;
      }

      // Calculate next scale degree based on contour
      const nextDegree = this.getNextDegree(
        currentDegree,
        i,
        length,
        scale.length
      );

      // Convert scale degree to MIDI note
      const octaveOffset = Math.floor(nextDegree / scale.length);
      const degreeInScale = ((nextDegree % scale.length) + scale.length) % scale.length;
      const midiNote = rootMidi + scale[degreeInScale] + octaveOffset * 12;

      // Clamp to valid MIDI range
      const clampedMidi = clamp(midiNote, 36, 96);
      const { note, octave } = midiToNote(clampedMidi);

      // Generate duration variation
      const durationVariation = this.rng.nextInRange(0.8, 1.2);
      const duration = this.config.baseDuration * durationVariation;

      // Generate velocity variation with contour influence
      const velocityVariation = this.rng.nextInRange(0.85, 1.15);
      const contourVelocity = this.getContourVelocity(i, length);
      const velocity = clamp(
        this.config.baseVelocity * velocityVariation * contourVelocity,
        0.1,
        1.0
      );

      notes.push({
        note: `${note}${octave}`,
        time: currentTime,
        duration,
        velocity,
      });

      currentDegree = nextDegree;
      currentTime += duration;
    }

    return notes;
  }

  /**
   * Generate a melody based on NPC personality traits
   *
   * @param extraversion - Extraversion score (0-100): affects note density and dynamics
   * @param agreeableness - Agreeableness score (0-100): affects consonance and smoothness
   * @param lifeStage - Life stage: affects tempo, register, and complexity
   * @returns Array of note events tailored to the personality
   */
  generateFromPersonality(
    extraversion: number,
    agreeableness: number,
    lifeStage: LifeStage
  ): NoteEvent[] {
    // Determine phrase length based on life stage and extraversion
    const baseLengthByStage: Record<LifeStage, number> = {
      youth: 8,
      adult: 12,
      mature: 10,
      elder: 6,
    };
    const baseLength = baseLengthByStage[lifeStage];
    const lengthModifier = mapRange(extraversion, 0, 100, 0.7, 1.5);
    const phraseLength = Math.round(baseLength * lengthModifier);

    // Determine scale based on agreeableness
    const scaleType = this.getScaleFromAgreeableness(agreeableness);
    const scale = SCALES[scaleType];

    // Determine root note (could be expanded to be more dynamic)
    const root: NoteName = 'C';

    // Set contour based on personality
    this.setContourFromPersonality(extraversion, agreeableness, lifeStage);

    // Adjust config based on personality
    const originalConfig = { ...this.config };

    // Life stage affects register
    this.config.baseOctave = this.getOctaveFromLifeStage(lifeStage);

    // Extraversion affects dynamics
    this.config.baseVelocity = mapRange(extraversion, 0, 100, 0.5, 0.9);

    // Agreeableness affects smoothness (interval jumps)
    this.config.maxIntervalJump = Math.round(mapRange(agreeableness, 0, 100, 5, 2));

    // Life stage affects rest probability
    this.config.restProbability = this.getRestProbabilityFromLifeStage(lifeStage);

    // Generate the phrase
    const phrase = this.generatePhrase(phraseLength, scale, root);

    // Restore original config
    this.config = originalConfig;

    return phrase;
  }

  /**
   * Calculate the next scale degree based on current contour
   */
  private getNextDegree(
    currentDegree: number,
    position: number,
    totalLength: number,
    scaleLength: number
  ): number {
    const progress = position / (totalLength - 1 || 1);
    const maxJump = this.config.maxIntervalJump;

    switch (this.contour) {
      case 'ascending': {
        // Gradually move up with some variation
        const upwardBias = this.rng.nextIntInRange(0, maxJump);
        return currentDegree + upwardBias;
      }

      case 'descending': {
        // Gradually move down with some variation
        const downwardBias = this.rng.nextIntInRange(-maxJump, 0);
        return currentDegree + downwardBias;
      }

      case 'arch': {
        // Rise to middle, then fall
        const midpoint = 0.5;
        const targetDegree =
          progress < midpoint
            ? Math.round(mapRange(progress, 0, midpoint, 0, scaleLength * 1.5))
            : Math.round(mapRange(progress, midpoint, 1, scaleLength * 1.5, 0));
        const variation = this.rng.nextIntInRange(-1, 1);
        return targetDegree + variation;
      }

      case 'wave': {
        // Sinusoidal motion
        const waveFreq = 2; // Number of waves
        const amplitude = scaleLength;
        const targetDegree = Math.round(
          amplitude * Math.sin(progress * waveFreq * Math.PI * 2)
        );
        const variation = this.rng.nextIntInRange(-1, 1);
        return targetDegree + variation;
      }

      case 'random':
      default: {
        // Random walk with constraints
        const step = this.rng.nextIntInRange(-maxJump, maxJump);
        return currentDegree + step;
      }
    }
  }

  /**
   * Get velocity modifier based on contour position
   */
  private getContourVelocity(position: number, totalLength: number): number {
    const progress = position / (totalLength - 1 || 1);

    switch (this.contour) {
      case 'ascending':
        // Crescendo
        return mapRange(progress, 0, 1, 0.7, 1.2);

      case 'descending':
        // Decrescendo
        return mapRange(progress, 0, 1, 1.2, 0.7);

      case 'arch':
        // Swell in the middle
        return progress < 0.5
          ? mapRange(progress, 0, 0.5, 0.8, 1.2)
          : mapRange(progress, 0.5, 1, 1.2, 0.8);

      case 'wave':
        // Pulsing dynamics
        return 0.9 + 0.2 * Math.sin(progress * 4 * Math.PI);

      case 'random':
      default:
        return 1.0;
    }
  }

  /**
   * Determine scale type from agreeableness score
   */
  private getScaleFromAgreeableness(agreeableness: number): ScaleType {
    if (agreeableness >= 80) return 'lydian'; // Bright and dreamy
    if (agreeableness >= 60) return 'major'; // Happy and stable
    if (agreeableness >= 40) return 'mixolydian'; // Slightly bluesy
    if (agreeableness >= 20) return 'dorian'; // Minor but not too dark
    return 'phrygian'; // Darker, more tense
  }

  /**
   * Set contour based on personality traits
   */
  private setContourFromPersonality(
    extraversion: number,
    agreeableness: number,
    lifeStage: LifeStage
  ): void {
    // Youth tends to be more energetic and varied
    if (lifeStage === 'youth') {
      this.contour = extraversion > 50 ? 'wave' : 'arch';
      return;
    }

    // Adults are more directed
    if (lifeStage === 'adult') {
      this.contour = extraversion > 50 ? 'ascending' : 'arch';
      return;
    }

    // Mature individuals are more contemplative
    if (lifeStage === 'mature') {
      this.contour = agreeableness > 50 ? 'arch' : 'descending';
      return;
    }

    // Elders tend toward calm, descending phrases
    this.contour = 'descending';
  }

  /**
   * Get base octave from life stage
   */
  private getOctaveFromLifeStage(lifeStage: LifeStage): number {
    switch (lifeStage) {
      case 'youth':
        return 5; // Higher, brighter
      case 'adult':
        return 4; // Middle
      case 'mature':
        return 4; // Middle
      case 'elder':
        return 3; // Lower, warmer
    }
  }

  /**
   * Get rest probability from life stage
   */
  private getRestProbabilityFromLifeStage(lifeStage: LifeStage): number {
    switch (lifeStage) {
      case 'youth':
        return 0.05; // Few rests, energetic
      case 'adult':
        return 0.1; // Moderate
      case 'mature':
        return 0.15; // More breathing room
      case 'elder':
        return 0.25; // Spacious, contemplative
    }
  }
}

export default MelodyGenerator;
