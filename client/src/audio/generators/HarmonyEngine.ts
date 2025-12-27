/**
 * HarmonyEngine - Generates chord progressions and harmonic content
 * Creates chords based on mood, affinity, and musical structure
 */

import {
  SCALES,
  ScaleType,
  NoteName,
  NOTE_NAMES,
  getNoteInScale,
  noteToMidi,
  midiToNote,
  affinityToInterval,
} from '../utils/scales';
import { clamp, mapRange } from '../utils/AudioMath';

// ============================================================================
// Types
// ============================================================================

/**
 * Mood types that influence harmonic choices
 */
export type Mood = 'happy' | 'sad' | 'tense' | 'peaceful';

/**
 * Chord quality types
 */
export type ChordQuality =
  | 'major'
  | 'minor'
  | 'diminished'
  | 'augmented'
  | 'sus2'
  | 'sus4'
  | 'major7'
  | 'minor7'
  | 'dominant7';

/**
 * Configuration for harmony generation
 */
export interface HarmonyConfig {
  /** Base octave for chord voicings (default: 3) */
  baseOctave?: number;
  /** Include 7th extensions (default: false) */
  includeSevenths?: boolean;
  /** Chord voicing spread in octaves (default: 1) */
  voicingSpread?: number;
}

// ============================================================================
// Chord Definitions
// ============================================================================

/**
 * Chord intervals from root (in semitones)
 */
const CHORD_INTERVALS: Record<ChordQuality, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  dominant7: [0, 4, 7, 10],
};

/**
 * Circle of fifths for key modulation
 * Moving clockwise = sharper keys, counterclockwise = flatter keys
 */
const CIRCLE_OF_FIFTHS: NoteName[] = [
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F#',
  'C#',
  'G#',
  'D#',
  'A#',
  'F',
];

/**
 * Common chord progressions by mood
 * Numbers represent scale degrees (1-indexed, so 1 = root/tonic)
 */
const MOOD_PROGRESSIONS: Record<Mood, number[][]> = {
  happy: [
    [1, 4, 5, 1], // I-IV-V-I (classic happy)
    [1, 5, 6, 4], // I-V-vi-IV (pop progression)
    [1, 4, 1, 5], // I-IV-I-V
  ],
  sad: [
    [6, 4, 1, 5], // vi-IV-I-V (melancholic pop)
    [1, 6, 4, 5], // I-vi-IV-V (doo-wop sad)
    [2, 5, 1, 6], // ii-V-I-vi (jazz sad)
  ],
  tense: [
    [1, 7, 6, 7], // Creates tension with vii (diminished)
    [1, 4, 7, 3], // Unexpected movements
    [5, 4, 3, 2], // Descending tension
  ],
  peaceful: [
    [1, 4, 1, 4], // Simple oscillation
    [1, 3, 4, 1], // I-iii-IV-I (gentle)
    [1, 2, 4, 1], // I-ii-IV-I (suspended feel)
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
// HarmonyEngine Class
// ============================================================================

/**
 * Generates harmonic content including chord progressions and voicings
 */
export class HarmonyEngine {
  private config: Required<HarmonyConfig>;
  private rng: SeededRandom;

  constructor(config: HarmonyConfig = {}, seed?: number) {
    this.config = {
      baseOctave: config.baseOctave ?? 3,
      includeSevenths: config.includeSevenths ?? false,
      voicingSpread: config.voicingSpread ?? 1,
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
   * Generate a chord progression
   *
   * @param length - Number of chords in the progression
   * @param scale - Scale intervals to use
   * @param root - Root note of the key
   * @returns Array of chord arrays (each chord is an array of note names with octaves)
   */
  generateChordProgression(
    length: number,
    scale: readonly number[],
    root: NoteName
  ): string[][] {
    const progression: string[][] = [];
    const scaleLength = scale.length;

    // Generate a progression following common patterns
    for (let i = 0; i < length; i++) {
      // Determine the scale degree for this chord
      let degree: number;

      if (i === 0) {
        // Start on tonic or dominant
        degree = this.rng.next() > 0.3 ? 0 : 4;
      } else if (i === length - 1) {
        // End on tonic
        degree = 0;
      } else {
        // Choose from common progressions with some randomness
        const prevDegree = this.getLastChordDegree(progression, scale, root);
        degree = this.getNextChordDegree(prevDegree, scaleLength);
      }

      // Build the chord
      const chord = this.buildChord(degree, scale, root);
      progression.push(chord);
    }

    return progression;
  }

  /**
   * Get a chord appropriate for a specific mood
   *
   * @param mood - The emotional quality desired
   * @returns Array of note names with octaves forming the chord
   */
  getChordForMood(mood: Mood): string[] {
    const progressions = MOOD_PROGRESSIONS[mood];
    const progression = progressions[this.rng.nextIntInRange(0, progressions.length - 1)];

    // Pick a chord from the progression
    const chordIndex = this.rng.nextIntInRange(0, progression.length - 1);
    const scaleDegree = progression[chordIndex] - 1; // Convert to 0-indexed

    // Determine scale and quality based on mood
    const root: NoteName = 'C';
    let scale: readonly number[];
    let quality: ChordQuality;

    switch (mood) {
      case 'happy':
        scale = SCALES.major;
        quality = scaleDegree === 0 || scaleDegree === 3 || scaleDegree === 4 ? 'major' : 'minor';
        break;
      case 'sad':
        scale = SCALES.minor;
        quality = scaleDegree === 0 || scaleDegree === 2 || scaleDegree === 4 ? 'minor' : 'major';
        break;
      case 'tense':
        scale = SCALES.phrygian;
        quality = scaleDegree === 6 ? 'diminished' : scaleDegree % 2 === 0 ? 'minor' : 'major';
        if (this.config.includeSevenths) {
          quality = 'dominant7';
        }
        break;
      case 'peaceful':
        scale = SCALES.lydian;
        quality = 'sus2'; // Suspended chords for floating feel
        break;
    }

    return this.buildChordWithQuality(scaleDegree, scale, root, quality);
  }

  /**
   * Convert an affinity value to a chord
   * Low affinity = dissonant, high affinity = consonant
   *
   * @param affinity - Value from 0 (hostile) to 100 (friendly)
   * @param root - Root note for the chord
   * @returns Array of note names with octaves forming the chord
   */
  affinityToChord(affinity: number, root: NoteName): string[] {
    const clampedAffinity = clamp(affinity, 0, 100);

    // Use the affinityToInterval function to get a harmonic interval
    const interval = affinityToInterval(clampedAffinity);

    // Determine chord quality based on affinity
    let quality: ChordQuality;
    if (clampedAffinity >= 85) {
      quality = 'major'; // Very consonant
    } else if (clampedAffinity >= 70) {
      quality = 'sus4'; // Slightly suspended
    } else if (clampedAffinity >= 55) {
      quality = 'minor'; // Mild tension
    } else if (clampedAffinity >= 40) {
      quality = 'sus2'; // More tension
    } else if (clampedAffinity >= 25) {
      quality = 'dominant7'; // Dissonant with direction
    } else if (clampedAffinity >= 10) {
      quality = 'diminished'; // Very dissonant
    } else {
      quality = 'augmented'; // Maximum dissonance
    }

    // Build the chord
    return this.buildChordFromRoot(root, quality);
  }

  /**
   * Modulate to a new key using the circle of fifths
   *
   * @param currentKey - Current key root note
   * @param direction - Direction to modulate ('up' = sharper, 'down' = flatter)
   * @returns New key root note
   */
  modulateKey(currentKey: NoteName, direction: 'up' | 'down'): NoteName {
    const currentIndex = CIRCLE_OF_FIFTHS.indexOf(currentKey);

    if (currentIndex === -1) {
      // Key not in circle, find closest equivalent
      const noteIndex = NOTE_NAMES.indexOf(currentKey);
      if (noteIndex === -1) {
        throw new Error(`Invalid key: ${currentKey}`);
      }
      // Find the closest match in circle of fifths
      return CIRCLE_OF_FIFTHS[noteIndex % CIRCLE_OF_FIFTHS.length];
    }

    // Move around the circle
    const step = direction === 'up' ? 1 : -1;
    const newIndex = (currentIndex + step + CIRCLE_OF_FIFTHS.length) % CIRCLE_OF_FIFTHS.length;

    return CIRCLE_OF_FIFTHS[newIndex];
  }

  /**
   * Get the diatonic chord quality for a scale degree
   */
  getDiatonicChordQuality(degree: number, scaleType: ScaleType): ChordQuality {
    // Qualities for each degree in major scale
    const majorQualities: ChordQuality[] = [
      'major',      // I
      'minor',      // ii
      'minor',      // iii
      'major',      // IV
      'major',      // V
      'minor',      // vi
      'diminished', // vii
    ];

    // Qualities for each degree in minor scale
    const minorQualities: ChordQuality[] = [
      'minor',      // i
      'diminished', // ii
      'major',      // III
      'minor',      // iv
      'minor',      // v (or major V in harmonic minor)
      'major',      // VI
      'major',      // VII
    ];

    const qualities = scaleType === 'major' ? majorQualities : minorQualities;
    const normalizedDegree = ((degree % 7) + 7) % 7;

    return qualities[normalizedDegree];
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Build a chord from a scale degree
   */
  private buildChord(
    degree: number,
    scale: readonly number[],
    root: NoteName
  ): string[] {
    const rootIndex = NOTE_NAMES.indexOf(root);
    const scaleLength = scale.length;
    const octave = this.config.baseOctave;

    // Get the root of the chord from the scale degree
    const normalizedDegree = ((degree % scaleLength) + scaleLength) % scaleLength;
    const chordRootSemitone = (rootIndex + scale[normalizedDegree]) % 12;
    const chordRoot = NOTE_NAMES[chordRootSemitone];

    // Determine chord quality based on scale degree and scale type
    // For simplicity, use major/minor pattern (can be expanded)
    const quality = this.inferQualityFromScale(normalizedDegree, scale);

    return this.buildChordFromRoot(chordRoot, quality);
  }

  /**
   * Build a chord with a specific quality
   */
  private buildChordWithQuality(
    degree: number,
    scale: readonly number[],
    root: NoteName,
    quality: ChordQuality
  ): string[] {
    const rootIndex = NOTE_NAMES.indexOf(root);
    const scaleLength = scale.length;

    // Get the root of the chord from the scale degree
    const normalizedDegree = ((degree % scaleLength) + scaleLength) % scaleLength;
    const chordRootSemitone = (rootIndex + scale[normalizedDegree]) % 12;
    const chordRoot = NOTE_NAMES[chordRootSemitone];

    return this.buildChordFromRoot(chordRoot, quality);
  }

  /**
   * Build a chord from a root note and quality
   */
  private buildChordFromRoot(root: NoteName, quality: ChordQuality): string[] {
    const rootIndex = NOTE_NAMES.indexOf(root);
    const intervals = CHORD_INTERVALS[quality];
    const octave = this.config.baseOctave;
    const chord: string[] = [];

    for (let i = 0; i < intervals.length; i++) {
      const interval = intervals[i];
      const noteIndex = (rootIndex + interval) % 12;
      const noteName = NOTE_NAMES[noteIndex];

      // Apply voicing spread
      const noteOctave = octave + Math.floor((rootIndex + interval) / 12);
      chord.push(`${noteName}${noteOctave}`);
    }

    return chord;
  }

  /**
   * Infer chord quality from scale position
   */
  private inferQualityFromScale(degree: number, scale: readonly number[]): ChordQuality {
    // Calculate the third and fifth intervals to determine quality
    const scaleLength = scale.length;
    const thirdDegree = (degree + 2) % scaleLength;
    const fifthDegree = (degree + 4) % scaleLength;

    const root = scale[degree];
    const third = scale[thirdDegree];
    const fifth = scale[fifthDegree];

    // Calculate actual intervals in semitones
    const thirdInterval = ((third - root) + 12) % 12;
    const fifthInterval = ((fifth - root) + 12) % 12;

    // Determine quality based on intervals
    if (thirdInterval === 4 && fifthInterval === 7) {
      return 'major';
    } else if (thirdInterval === 3 && fifthInterval === 7) {
      return 'minor';
    } else if (thirdInterval === 3 && fifthInterval === 6) {
      return 'diminished';
    } else if (thirdInterval === 4 && fifthInterval === 8) {
      return 'augmented';
    }

    // Default to major if uncertain
    return 'major';
  }

  /**
   * Get the scale degree of the last chord in a progression
   */
  private getLastChordDegree(
    progression: string[][],
    scale: readonly number[],
    root: NoteName
  ): number {
    if (progression.length === 0) return 0;

    const lastChord = progression[progression.length - 1];
    if (lastChord.length === 0) return 0;

    // Parse the root of the last chord
    const lastNote = lastChord[0];
    const noteMatch = lastNote.match(/^([A-G]#?)(\d+)$/);
    if (!noteMatch) return 0;

    const noteName = noteMatch[1] as NoteName;
    const noteIndex = NOTE_NAMES.indexOf(noteName);
    const rootIndex = NOTE_NAMES.indexOf(root);

    // Find the closest scale degree
    const semitones = ((noteIndex - rootIndex) + 12) % 12;
    for (let i = 0; i < scale.length; i++) {
      if (scale[i] === semitones) return i;
    }

    return 0;
  }

  /**
   * Get the next chord degree based on common progressions
   */
  private getNextChordDegree(prevDegree: number, scaleLength: number): number {
    // Common chord movements
    const commonMoves: Record<number, number[]> = {
      0: [3, 4, 5], // I -> IV, V, vi
      1: [4, 0],     // ii -> V, I
      2: [3, 5],     // iii -> IV, vi
      3: [0, 4, 1],  // IV -> I, V, ii
      4: [0, 5, 3],  // V -> I, vi, IV
      5: [3, 1, 4],  // vi -> IV, ii, V
      6: [0, 2],     // vii -> I, iii
    };

    const normalizedPrev = ((prevDegree % scaleLength) + scaleLength) % scaleLength;
    const possibleMoves = commonMoves[normalizedPrev] || [0, 3, 4];

    const randomIndex = this.rng.nextIntInRange(0, possibleMoves.length - 1);
    return possibleMoves[randomIndex];
  }
}

export default HarmonyEngine;
