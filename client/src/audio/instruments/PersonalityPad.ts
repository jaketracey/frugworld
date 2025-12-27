/**
 * PersonalityPad - Personality-driven timbre synthesis
 *
 * NPC personality shapes the character of notes they "emit":
 * - Extraversion (0-100): Controls volume and density
 *   - 0-30 (Introverted): Quiet, sparse, high register
 *   - 70-100 (Extraverted): Loud, dense, mid register
 * - Agreeableness (0-100): Controls intervals and harmonics
 *   - 0-30 (Disagreeable): Minor intervals, harsh harmonics
 *   - 70-100 (Agreeable): Major intervals, soft harmonics
 */

import * as Tone from 'tone';

interface PersonalityState {
  extraversion: number; // 0-100
  agreeableness: number; // 0-100
}

export class PersonalityPad {
  private synth: Tone.PolySynth;
  private filter: Tone.Filter;
  private reverb: Tone.Reverb;
  private tremolo: Tone.Tremolo;
  private channel: Tone.Channel;
  private personality: PersonalityState = { extraversion: 50, agreeableness: 50 };
  private isDisposed: boolean = false;

  constructor() {
    // Create the main pad synth
    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: {
        type: 'sine',
      },
      envelope: {
        attack: 0.8,
        decay: 0.5,
        sustain: 0.7,
        release: 2,
      },
    });
    this.synth.maxPolyphony = 8;

    // Effects chain
    this.filter = new Tone.Filter({
      type: 'lowpass',
      frequency: 2000,
      Q: 1,
    });

    this.tremolo = new Tone.Tremolo({
      frequency: 3,
      depth: 0.3,
    }).start();

    this.reverb = new Tone.Reverb({
      decay: 4,
      wet: 0.4,
    });

    this.channel = new Tone.Channel(-12, 0);

    // Connect the chain
    this.synth.chain(this.filter, this.tremolo, this.reverb, this.channel, Tone.getDestination());
  }

  /**
   * Update the synth parameters based on personality traits
   */
  updatePersonality(extraversion: number, agreeableness: number): void {
    if (this.isDisposed) return;

    // Clamp values to 0-100
    extraversion = Math.max(0, Math.min(100, extraversion));
    agreeableness = Math.max(0, Math.min(100, agreeableness));

    this.personality = { extraversion, agreeableness };

    // Extraversion affects volume and density
    // Low extraversion = quiet (-24dB), high extraversion = louder (-6dB)
    const volumeDb = this.mapRange(extraversion, 0, 100, -24, -6);
    this.channel.volume.rampTo(volumeDb, 0.5);

    // Extraversion affects tremolo depth (introverts: more subtle movement)
    const tremoloDepth = this.mapRange(extraversion, 0, 100, 0.1, 0.5);
    this.tremolo.depth.rampTo(tremoloDepth, 0.5);

    // Agreeableness affects filter brightness
    // Disagreeable = harsher/brighter, Agreeable = softer/warmer
    const filterFreq = this.mapRange(agreeableness, 0, 100, 3000, 1200);
    this.filter.frequency.rampTo(filterFreq, 0.5);

    // Agreeableness affects reverb wetness (trust = shared space)
    const reverbWet = this.mapRange(agreeableness, 0, 100, 0.2, 0.6);
    this.reverb.wet.rampTo(reverbWet, 0.5);

    // Update oscillator type based on agreeableness
    // Disagreeable = harsher wave, Agreeable = softer wave
    if (agreeableness < 30) {
      this.synth.set({ oscillator: { type: 'sawtooth' } });
    } else if (agreeableness < 70) {
      this.synth.set({ oscillator: { type: 'triangle' } });
    } else {
      this.synth.set({ oscillator: { type: 'sine' } });
    }
  }

  /**
   * Play a chord with personality-influenced characteristics
   */
  playChord(notes: string[], duration: number = 2): void {
    if (this.isDisposed) return;

    // Modify notes based on personality
    const modifiedNotes = this.applyPersonalityToNotes(notes);

    // Calculate velocity based on extraversion
    const velocity = this.mapRange(this.personality.extraversion, 0, 100, 0.3, 0.9);

    this.synth.triggerAttackRelease(modifiedNotes, duration, undefined, velocity);
  }

  /**
   * Apply personality traits to modify the notes
   */
  private applyPersonalityToNotes(notes: string[]): string[] {
    const { extraversion, agreeableness } = this.personality;

    return notes.map((note) => {
      let modifiedNote = note;

      // Extraversion affects register
      // Introverts (low extraversion): shift to higher register
      // Extraverts (high extraversion): keep in mid register
      if (extraversion < 30) {
        modifiedNote = this.transposeOctave(modifiedNote, 1);
      } else if (extraversion > 70) {
        // Keep in mid range, potentially lower
        modifiedNote = this.transposeOctave(modifiedNote, 0);
      }

      // Agreeableness could affect interval adjustments
      // This is handled more in the chord construction
      // but we can apply subtle pitch adjustments for "harshness"
      if (agreeableness < 30) {
        // For disagreeable personalities, we might add dissonance
        // but this is better handled in chord selection
      }

      return modifiedNote;
    });
  }

  /**
   * Generate a chord based on personality
   * Returns notes that reflect the personality traits
   */
  generatePersonalityChord(rootNote: string): string[] {
    const { agreeableness } = this.personality;

    const root = rootNote;

    if (agreeableness >= 70) {
      // Agreeable: Major intervals, consonant
      return [root, this.transposeNote(root, 4), this.transposeNote(root, 7)]; // Major triad
    } else if (agreeableness >= 30) {
      // Neutral: Minor or suspended intervals
      return [root, this.transposeNote(root, 3), this.transposeNote(root, 7)]; // Minor triad
    } else {
      // Disagreeable: Dissonant intervals, tritones
      return [root, this.transposeNote(root, 3), this.transposeNote(root, 6)]; // Diminished
    }
  }

  /**
   * Transpose a note by semitones
   */
  private transposeNote(note: string, semitones: number): string {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const match = note.match(/^([A-Ga-g][#b]?)(\d+)$/);
    if (!match) return note;

    let [, pitch, octaveStr] = match;
    let octave = parseInt(octaveStr);

    // Normalize flats to sharps
    if (pitch.includes('b')) {
      const flatIndex = noteNames.indexOf(pitch.replace('b', ''));
      if (flatIndex > 0) {
        pitch = noteNames[flatIndex - 1];
      } else {
        pitch = 'B';
        octave -= 1;
      }
    }

    const currentIndex = noteNames.indexOf(pitch.toUpperCase());
    if (currentIndex === -1) return note;

    const newIndex = currentIndex + semitones;
    const newOctave = octave + Math.floor(newIndex / 12);
    const newNoteIndex = ((newIndex % 12) + 12) % 12;

    return `${noteNames[newNoteIndex]}${newOctave}`;
  }

  /**
   * Transpose a note by octaves
   */
  private transposeOctave(note: string, octaves: number): string {
    const match = note.match(/^([A-Ga-g][#b]?)(\d+)$/);
    if (!match) return note;
    const [, pitch, octave] = match;
    return `${pitch}${parseInt(octave) + octaves}`;
  }

  /**
   * Map a value from one range to another
   */
  private mapRange(
    value: number,
    inMin: number,
    inMax: number,
    outMin: number,
    outMax: number
  ): number {
    return ((value - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin;
  }

  /**
   * Get current personality state
   */
  getPersonality(): PersonalityState {
    return { ...this.personality };
  }

  /**
   * Dispose of all synths and effects
   */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.synth.dispose();
    this.filter.dispose();
    this.tremolo.dispose();
    this.reverb.dispose();
    this.channel.dispose();
  }
}
