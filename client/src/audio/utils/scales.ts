/**
 * Musical scale and harmony utilities for procedural audio
 * Provides scale definitions, MIDI conversions, and harmonic calculations
 */

// ============================================================================
// Scale Definitions
// ============================================================================

/**
 * Musical scales defined as arrays of semitone offsets from the root note
 * Each scale contains the intervals that make up that scale pattern
 */
export const SCALES = {
  /** Major scale - bright, happy (W-W-H-W-W-W-H) */
  major: [0, 2, 4, 5, 7, 9, 11],

  /** Natural minor scale - darker, melancholic (W-H-W-W-H-W-W) */
  minor: [0, 2, 3, 5, 7, 8, 10],

  /** Dorian mode - minor with raised 6th, jazzy feel */
  dorian: [0, 2, 3, 5, 7, 9, 10],

  /** Phrygian mode - Spanish/Middle Eastern flavor */
  phrygian: [0, 1, 3, 5, 7, 8, 10],

  /** Lydian mode - dreamy, floating quality */
  lydian: [0, 2, 4, 6, 7, 9, 11],

  /** Mixolydian mode - bluesy, dominant feel */
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
} as const;

/** Type for scale names */
export type ScaleType = keyof typeof SCALES;

/**
 * Note names in chromatic order
 */
export const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

/** Type for note names */
export type NoteName = (typeof NOTE_NAMES)[number];

// ============================================================================
// MIDI and Frequency Conversion
// ============================================================================

/** Standard concert pitch A4 = 440 Hz */
const A4_FREQUENCY = 440;

/** MIDI note number for A4 */
const A4_MIDI = 69;

/**
 * Convert a MIDI note number to frequency in Hz
 * Uses the standard equal temperament formula: f = 440 * 2^((n-69)/12)
 *
 * @param midi - MIDI note number (0-127, where 60 is middle C)
 * @returns Frequency in Hz
 *
 * @example
 * midiToFreq(69) // 440 (A4)
 * midiToFreq(60) // 261.63 (Middle C)
 */
export function midiToFreq(midi: number): number {
  return A4_FREQUENCY * Math.pow(2, (midi - A4_MIDI) / 12);
}

/**
 * Convert frequency in Hz to the nearest MIDI note number
 *
 * @param freq - Frequency in Hz
 * @returns MIDI note number (may be fractional for microtones)
 */
export function freqToMidi(freq: number): number {
  return A4_MIDI + 12 * Math.log2(freq / A4_FREQUENCY);
}

// ============================================================================
// Scale Quantization
// ============================================================================

/**
 * Quantize a MIDI note to the nearest note in a given scale
 * Snaps any chromatic note to the closest scale degree
 *
 * @param midi - The MIDI note number to quantize
 * @param scale - Array of semitone offsets defining the scale (e.g., [0, 2, 4, 5, 7, 9, 11] for major)
 * @param root - The root note of the scale as MIDI number (e.g., 60 for C)
 * @returns The quantized MIDI note number
 *
 * @example
 * // Quantize C# (61) to C major scale rooted at C4 (60)
 * quantizeToScale(61, SCALES.major, 60) // Returns 60 (C) or 62 (D)
 */
export function quantizeToScale(
  midi: number,
  scale: readonly number[],
  root: number
): number {
  // Get the note's position relative to the root
  const relativeNote = midi - root;

  // Get the octave offset and the note within the octave
  const octave = Math.floor(relativeNote / 12);
  const noteInOctave = ((relativeNote % 12) + 12) % 12; // Handle negative modulo

  // Find the closest scale degree
  let closestDegree = scale[0];
  let minDistance = Math.abs(noteInOctave - scale[0]);

  for (const degree of scale) {
    const distance = Math.abs(noteInOctave - degree);
    if (distance < minDistance) {
      minDistance = distance;
      closestDegree = degree;
    }
  }

  // Also check wrapping around to the next octave
  const wrapDistance = Math.abs(noteInOctave - (scale[0] + 12));
  if (wrapDistance < minDistance) {
    return root + (octave + 1) * 12 + scale[0];
  }

  return root + octave * 12 + closestDegree;
}

// ============================================================================
// Affinity to Interval Mapping
// ============================================================================

/**
 * Map an affinity value (0-100) to a musical interval in semitones
 * Lower affinity = more dissonant intervals, higher affinity = more consonant
 *
 * Mapping:
 * - 0: Tritone (6 semitones) - most dissonant
 * - 25: Minor 2nd/Major 7th (1 or 11 semitones)
 * - 50: Perfect 4th/5th (5 or 7 semitones)
 * - 75: Major/Minor 3rd (3 or 4 semitones)
 * - 100: Unison/Octave (0 or 12 semitones) - most consonant
 *
 * @param affinity - Value from 0 (hostile) to 100 (friendly)
 * @returns Semitone interval representing the harmonic relationship
 */
export function affinityToInterval(affinity: number): number {
  // Clamp affinity to valid range
  const clampedAffinity = Math.max(0, Math.min(100, affinity));

  // Map affinity to consonance levels
  // Higher affinity = more consonant intervals
  if (clampedAffinity >= 90) {
    // Unison or octave - perfect consonance
    return clampedAffinity >= 95 ? 0 : 12;
  } else if (clampedAffinity >= 75) {
    // Perfect 5th or 4th - strong consonance
    return clampedAffinity >= 85 ? 7 : 5;
  } else if (clampedAffinity >= 55) {
    // Major or minor 3rd - mild consonance
    return clampedAffinity >= 65 ? 4 : 3;
  } else if (clampedAffinity >= 35) {
    // Major 6th or minor 6th
    return clampedAffinity >= 45 ? 9 : 8;
  } else if (clampedAffinity >= 15) {
    // Minor 2nd or major 7th - strong dissonance
    return clampedAffinity >= 25 ? 11 : 1;
  } else {
    // Tritone - maximum dissonance
    return 6;
  }
}

// ============================================================================
// Scale Note Lookup
// ============================================================================

/**
 * Get the note name at a specific scale degree
 *
 * @param scaleType - The type of scale ('major', 'minor', 'dorian', etc.)
 * @param root - The root note name ('C', 'D', 'F#', etc.)
 * @param degree - The scale degree (0-indexed, 0 = root, 1 = 2nd, etc.)
 * @returns The note name at that scale degree
 *
 * @example
 * getNoteInScale('major', 'C', 0) // 'C' (root)
 * getNoteInScale('major', 'C', 4) // 'G' (5th)
 * getNoteInScale('minor', 'A', 2) // 'C' (minor 3rd)
 */
export function getNoteInScale(
  scaleType: ScaleType,
  root: NoteName,
  degree: number
): NoteName {
  const scale = SCALES[scaleType];
  const rootIndex = NOTE_NAMES.indexOf(root);

  if (rootIndex === -1) {
    throw new Error(`Invalid root note: ${root}`);
  }

  // Handle degrees beyond the scale length (wrap around with octave offset)
  const normalizedDegree = ((degree % scale.length) + scale.length) % scale.length;
  const octaveOffset = Math.floor(degree / scale.length);

  // Calculate the semitone offset from the scale
  const semitoneOffset = scale[normalizedDegree] + octaveOffset * 12;

  // Calculate the final note index (wrapping within the 12-note octave)
  const noteIndex = (rootIndex + semitoneOffset) % 12;

  return NOTE_NAMES[noteIndex];
}

/**
 * Get the MIDI note number for a note name at a specific octave
 *
 * @param note - The note name ('C', 'D#', etc.)
 * @param octave - The octave number (4 = middle C octave)
 * @returns MIDI note number
 */
export function noteToMidi(note: NoteName, octave: number): number {
  const noteIndex = NOTE_NAMES.indexOf(note);
  if (noteIndex === -1) {
    throw new Error(`Invalid note name: ${note}`);
  }
  return (octave + 1) * 12 + noteIndex;
}

/**
 * Get the note name and octave from a MIDI note number
 *
 * @param midi - MIDI note number
 * @returns Object with note name and octave
 */
export function midiToNote(midi: number): { note: NoteName; octave: number } {
  const noteIndex = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  return {
    note: NOTE_NAMES[noteIndex],
    octave,
  };
}

/**
 * Generate all notes in a scale for a given octave range
 *
 * @param scaleType - The type of scale
 * @param root - The root note name
 * @param startOctave - Starting octave
 * @param endOctave - Ending octave (inclusive)
 * @returns Array of MIDI note numbers
 */
export function getScaleNotes(
  scaleType: ScaleType,
  root: NoteName,
  startOctave: number,
  endOctave: number
): number[] {
  const scale = SCALES[scaleType];
  const rootMidi = noteToMidi(root, startOctave);
  const notes: number[] = [];

  for (let octave = startOctave; octave <= endOctave; octave++) {
    const octaveOffset = (octave - startOctave) * 12;
    for (const interval of scale) {
      const midiNote = rootMidi + octaveOffset + interval;
      if (midiNote <= 127) {
        notes.push(midiNote);
      }
    }
  }

  return notes;
}
