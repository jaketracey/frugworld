/**
 * RhythmGenerator - Generates rhythmic patterns based on simulation state
 * Creates timing sequences using Tone.js time notation
 */

import { clamp, mapRange } from '../utils/AudioMath';

// ============================================================================
// Types
// ============================================================================

/**
 * Life stages that affect rhythmic characteristics
 */
export type LifeStage = 'youth' | 'adult' | 'mature' | 'elder';

/**
 * Tone.js time notation values
 */
export type TimeNotation =
  | '1n'   // whole note
  | '2n'   // half note
  | '2n.'  // dotted half
  | '4n'   // quarter note
  | '4n.'  // dotted quarter
  | '8n'   // eighth note
  | '8n.'  // dotted eighth
  | '16n' // sixteenth note
  | '32n' // thirty-second note
  | '8t'   // eighth triplet
  | '16t'; // sixteenth triplet

/**
 * Rhythm event representing when to trigger a note
 */
export interface RhythmEvent {
  /** Time position in bars:beats:sixteenths or Tone.js notation */
  time: string;
  /** Duration of the event */
  duration: TimeNotation;
  /** Accent level (0-1, where 1 is strongest) */
  accent: number;
}

/**
 * Configuration for rhythm generation
 */
export interface RhythmConfig {
  /** Time signature numerator (default: 4) */
  beatsPerBar?: number;
  /** Base subdivision (default: '8n') */
  baseSubdivision?: TimeNotation;
  /** Swing amount 0-1 (default: 0) */
  swing?: number;
  /** Probability of syncopation 0-1 (default: 0.2) */
  syncopation?: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Subdivision hierarchy from longest to shortest
 */
const SUBDIVISIONS: TimeNotation[] = [
  '1n',
  '2n',
  '2n.',
  '4n',
  '4n.',
  '8n',
  '8n.',
  '16n',
  '32n',
];

/**
 * Triplet subdivisions
 */
const TRIPLET_SUBDIVISIONS: TimeNotation[] = ['8t', '16t'];

/**
 * Subdivision values in fractions of a whole note
 */
const SUBDIVISION_VALUES: Record<TimeNotation, number> = {
  '1n': 1,
  '2n': 0.5,
  '2n.': 0.75,
  '4n': 0.25,
  '4n.': 0.375,
  '8n': 0.125,
  '8n.': 0.1875,
  '16n': 0.0625,
  '32n': 0.03125,
  '8t': 1 / 12,
  '16t': 1 / 24,
};

/**
 * Rhythm patterns for different life stages
 * Represented as accent patterns where 1 = hit, 0 = rest
 */
const LIFE_STAGE_PATTERNS: Record<LifeStage, number[][]> = {
  // Youth: energetic, syncopated
  youth: [
    [1, 0, 1, 0, 1, 0, 1, 0], // Straight eighths
    [1, 0, 0, 1, 0, 0, 1, 0], // Syncopated
    [1, 1, 0, 1, 1, 0, 1, 0], // Dense
    [1, 0, 1, 1, 0, 1, 1, 0], // Offbeat heavy
  ],
  // Adult: steady, balanced
  adult: [
    [1, 0, 0, 0, 1, 0, 0, 0], // Quarter notes
    [1, 0, 1, 0, 1, 0, 0, 0], // With pickup
    [1, 0, 0, 1, 0, 0, 1, 0], // Dotted rhythm
    [1, 0, 0, 0, 0, 0, 1, 0], // Sparse with offbeat
  ],
  // Mature: complex, thoughtful
  mature: [
    [1, 0, 0, 1, 0, 1, 0, 0], // Complex syncopation
    [1, 0, 1, 0, 0, 1, 0, 1], // Polyrhythmic feel
    [1, 0, 0, 0, 1, 0, 1, 0], // Shifting accents
    [1, 0, 0, 1, 1, 0, 0, 1], // Cross-rhythm
  ],
  // Elder: sparse, spacious
  elder: [
    [1, 0, 0, 0, 0, 0, 0, 0], // Very sparse
    [1, 0, 0, 0, 1, 0, 0, 0], // Half notes
    [1, 0, 0, 0, 0, 0, 1, 0], // With anticipation
    [1, 0, 0, 1, 0, 0, 0, 0], // Gentle dotted
  ],
};

// ============================================================================
// Seeded Random Number Generator
// ============================================================================

/**
 * Simple seeded PRNG using mulberry32 algorithm
 */
class SeededRandom {
  private state: number;

  constructor(seed: number = Date.now()) {
    this.state = seed;
  }

  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextIntInRange(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

// ============================================================================
// RhythmGenerator Class
// ============================================================================

/**
 * Generates rhythmic patterns for procedural audio
 */
export class RhythmGenerator {
  private config: Required<RhythmConfig>;
  private rng: SeededRandom;

  constructor(config: RhythmConfig = {}, seed?: number) {
    this.config = {
      beatsPerBar: config.beatsPerBar ?? 4,
      baseSubdivision: config.baseSubdivision ?? '8n',
      swing: config.swing ?? 0,
      syncopation: config.syncopation ?? 0.2,
    };
    this.rng = new SeededRandom(seed);
  }

  /**
   * Reset the random number generator with a new seed
   */
  setSeed(seed: number): void {
    this.rng = new SeededRandom(seed);
  }

  /**
   * Generate a rhythmic pattern
   *
   * @param density - How dense the pattern is (0 = sparse, 1 = dense)
   * @param bars - Number of bars to generate
   * @returns Array of time positions in Tone.js notation
   */
  generatePattern(density: number, bars: number): string[] {
    const clampedDensity = clamp(density, 0, 1);
    const pattern: string[] = [];

    // Determine subdivision based on density
    const subdivision = this.densityToSubdivision(clampedDensity);
    const subdivisionValue = SUBDIVISION_VALUES[subdivision];
    const stepsPerBar = Math.floor(1 / subdivisionValue);

    // Calculate probability of hitting each step
    const hitProbability = mapRange(clampedDensity, 0, 1, 0.2, 0.9);

    for (let bar = 0; bar < bars; bar++) {
      for (let step = 0; step < stepsPerBar; step++) {
        // Always hit the downbeat
        const isDownbeat = step === 0;

        // Calculate beat position
        const beatPosition = (step * subdivisionValue * this.config.beatsPerBar);

        // Higher probability on strong beats
        const isStrongBeat = beatPosition % 1 === 0;
        const beatBonus = isStrongBeat ? 0.2 : 0;

        // Apply syncopation
        const syncopationModifier =
          !isStrongBeat && this.rng.next() < this.config.syncopation ? 0.3 : 0;

        const shouldHit =
          isDownbeat ||
          this.rng.next() < hitProbability + beatBonus + syncopationModifier;

        if (shouldHit) {
          // Format as "bar:beat:sixteenth"
          const beatInBar = Math.floor(beatPosition);
          const sixteenthInBeat = Math.round((beatPosition % 1) * 4);
          pattern.push(`${bar}:${beatInBar}:${sixteenthInBeat}`);
        }
      }
    }

    return pattern;
  }

  /**
   * Generate a rhythm pattern based on life stage
   *
   * @param lifeStage - The life stage of the entity
   * @returns Array of time positions in Tone.js notation
   */
  lifeStageToRhythm(lifeStage: LifeStage): string[] {
    const patterns = LIFE_STAGE_PATTERNS[lifeStage];
    const selectedPattern = patterns[this.rng.nextIntInRange(0, patterns.length - 1)];

    const rhythm: string[] = [];

    // Convert pattern to time positions (one bar)
    const stepsPerBeat = selectedPattern.length / this.config.beatsPerBar;

    for (let i = 0; i < selectedPattern.length; i++) {
      if (selectedPattern[i] === 1) {
        const beat = Math.floor(i / stepsPerBeat);
        const sixteenth = Math.round((i % stepsPerBeat) * (4 / stepsPerBeat));
        rhythm.push(`0:${beat}:${sixteenth}`);
      }
    }

    return rhythm;
  }

  /**
   * Convert energy level to a subdivision
   * Higher energy = faster subdivisions
   *
   * @param energy - Energy level (0-100)
   * @returns Tone.js time notation for the subdivision
   */
  energyToSubdivision(energy: number): TimeNotation {
    const clampedEnergy = clamp(energy, 0, 100);

    // Map energy to subdivision index
    // Low energy = slow subdivisions, high energy = fast subdivisions
    if (clampedEnergy >= 90) return '32n';
    if (clampedEnergy >= 75) return '16n';
    if (clampedEnergy >= 60) return '8n';
    if (clampedEnergy >= 45) return '8n.';
    if (clampedEnergy >= 30) return '4n';
    if (clampedEnergy >= 15) return '2n';
    return '1n';
  }

  /**
   * Generate rhythm events with full timing information
   *
   * @param density - Pattern density (0-1)
   * @param bars - Number of bars
   * @returns Array of rhythm events with timing, duration, and accent
   */
  generateRhythmEvents(density: number, bars: number): RhythmEvent[] {
    const times = this.generatePattern(density, bars);
    const subdivision = this.densityToSubdivision(density);
    const events: RhythmEvent[] = [];

    for (const time of times) {
      const parts = time.split(':').map(Number);
      const bar = parts[0];
      const beat = parts[1];
      const sixteenth = parts[2];

      // Calculate accent based on position
      let accent = 0.5;
      if (beat === 0 && sixteenth === 0) {
        accent = 1.0; // Downbeat
      } else if (sixteenth === 0) {
        accent = 0.8; // On the beat
      } else if (sixteenth === 2) {
        accent = 0.6; // Upbeat
      }

      // Add some variation
      accent *= 0.8 + this.rng.next() * 0.4;
      accent = clamp(accent, 0.1, 1.0);

      events.push({
        time,
        duration: subdivision,
        accent,
      });
    }

    return events;
  }

  /**
   * Generate a polyrhythmic pattern
   * Creates two interlocking rhythms
   *
   * @param ratio - Ratio of the polyrhythm (e.g., [3, 2] for 3 against 2)
   * @param bars - Number of bars
   * @returns Object with two rhythm patterns
   */
  generatePolyrhythm(
    ratio: [number, number],
    bars: number
  ): { primary: string[]; secondary: string[] } {
    const [primary, secondary] = ratio;
    const primaryPattern: string[] = [];
    const secondaryPattern: string[] = [];

    for (let bar = 0; bar < bars; bar++) {
      // Primary rhythm
      for (let i = 0; i < primary; i++) {
        const beat = (i * this.config.beatsPerBar) / primary;
        const beatInt = Math.floor(beat);
        const sixteenth = Math.round((beat % 1) * 4);
        primaryPattern.push(`${bar}:${beatInt}:${sixteenth}`);
      }

      // Secondary rhythm
      for (let i = 0; i < secondary; i++) {
        const beat = (i * this.config.beatsPerBar) / secondary;
        const beatInt = Math.floor(beat);
        const sixteenth = Math.round((beat % 1) * 4);
        secondaryPattern.push(`${bar}:${beatInt}:${sixteenth}`);
      }
    }

    return { primary: primaryPattern, secondary: secondaryPattern };
  }

  /**
   * Apply swing to a pattern
   *
   * @param pattern - Array of time positions
   * @param swingAmount - Amount of swing (0-1)
   * @returns Modified pattern with swing applied
   */
  applySwing(pattern: string[], swingAmount: number): string[] {
    const swing = clamp(swingAmount, 0, 1);
    if (swing === 0) return pattern;

    return pattern.map((time) => {
      const parts = time.split(':').map(Number);
      const bar = parts[0];
      const beat = parts[1];
      let sixteenth = parts[2];

      // Swing only affects off-beat sixteenths (1 and 3)
      if (sixteenth === 1 || sixteenth === 3) {
        // Delay by swing amount (up to a 16th note)
        const delay = swing * 0.5;
        sixteenth += delay;

        // Handle overflow
        if (sixteenth >= 4) {
          sixteenth -= 4;
          // Note: This would need to increment beat and potentially bar
          // Simplified here for demonstration
        }
      }

      return `${bar}:${beat}:${sixteenth.toFixed(2)}`;
    });
  }

  /**
   * Get the subdivision value in fractions of a whole note
   */
  getSubdivisionValue(subdivision: TimeNotation): number {
    return SUBDIVISION_VALUES[subdivision];
  }

  /**
   * Convert density to subdivision
   */
  private densityToSubdivision(density: number): TimeNotation {
    if (density >= 0.9) return '16n';
    if (density >= 0.7) return '8n';
    if (density >= 0.5) return '8n.';
    if (density >= 0.3) return '4n';
    if (density >= 0.1) return '2n';
    return '1n';
  }
}

export default RhythmGenerator;
