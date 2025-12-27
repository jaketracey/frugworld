/**
 * RelationshipSynth - Voices for different relationship types
 *
 * Each relationship type gets a distinct voice:
 * - Friend: Warm pad (PolySynth with AMSynth, slow attack, chorus)
 * - CloseFriend: Resonant bell (MetalSynth with reverb)
 * - Stranger: Sparse pluck (PluckSynth, dry, quiet)
 * - Acquaintance: Soft keys (FMSynth with low mod index)
 * - Rival: Tense string (MonoSynth with filter sweep, slight detune)
 * - Enemy: Dissonant stab (MonoSynth, short decay, tritone intervals)
 * - MentorStudent: Call-response (Two voices, octave apart)
 */

import * as Tone from 'tone';

export type RelationshipType =
  | 'Friend'
  | 'CloseFriend'
  | 'Stranger'
  | 'Acquaintance'
  | 'Rival'
  | 'Enemy'
  | 'MentorStudent';

interface SynthConfig {
  synth: Tone.PolySynth | Tone.MonoSynth | Tone.PluckSynth | Tone.MetalSynth | Tone.FMSynth;
  effects: Tone.ToneAudioNode[];
}

export class RelationshipSynth {
  private currentType: RelationshipType = 'Stranger';
  private synths: Map<RelationshipType, SynthConfig> = new Map();
  private masterChannel: Tone.Channel;
  private reverb: Tone.Reverb;
  private delay: Tone.PingPongDelay;
  private chorus: Tone.Chorus;
  private isDisposed: boolean = false;

  constructor() {
    // Master effects chain
    this.reverb = new Tone.Reverb({ decay: 4, wet: 0.3 });
    this.delay = new Tone.PingPongDelay('8n', 0.2);
    this.chorus = new Tone.Chorus(4, 2.5, 0.5);
    this.masterChannel = new Tone.Channel(-6, 0);

    // Connect master chain
    this.masterChannel.chain(this.delay, this.reverb, Tone.getDestination());

    this.initializeSynths();
  }

  private initializeSynths(): void {
    // Friend - Warm pad with AMSynth
    const friendSynth = new Tone.PolySynth(Tone.AMSynth, {
      harmonicity: 2,
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.5,
        decay: 0.3,
        sustain: 0.8,
        release: 2,
      },
      modulation: { type: 'sine' },
      modulationEnvelope: {
        attack: 0.5,
        decay: 0.2,
        sustain: 0.5,
        release: 1,
      },
    });
    const friendChorus = new Tone.Chorus(3, 2.5, 0.5).start();
    friendSynth.chain(friendChorus, this.masterChannel);
    this.synths.set('Friend', { synth: friendSynth, effects: [friendChorus] });

    // CloseFriend - Resonant bell with MetalSynth
    const closeFriendSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.01,
        decay: 1.5,
        sustain: 0.1,
        release: 2,
      },
    });
    const bellReverb = new Tone.Reverb({ decay: 6, wet: 0.5 });
    closeFriendSynth.chain(bellReverb, this.masterChannel);
    this.synths.set('CloseFriend', { synth: closeFriendSynth, effects: [bellReverb] });

    // Stranger - Sparse pluck, dry and quiet
    const strangerSynth = new Tone.PluckSynth({
      attackNoise: 1,
      dampening: 4000,
      resonance: 0.7,
    });
    const strangerGain = new Tone.Gain(0.4);
    strangerSynth.chain(strangerGain, this.masterChannel);
    this.synths.set('Stranger', { synth: strangerSynth, effects: [strangerGain] });

    // Acquaintance - Soft keys with FMSynth, low modulation index
    const acquaintanceSynth = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3,
      modulationIndex: 1,
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.1,
        decay: 0.3,
        sustain: 0.4,
        release: 1.2,
      },
      modulation: { type: 'triangle' },
      modulationEnvelope: {
        attack: 0.2,
        decay: 0.2,
        sustain: 0.3,
        release: 0.8,
      },
    });
    acquaintanceSynth.connect(this.masterChannel);
    this.synths.set('Acquaintance', { synth: acquaintanceSynth, effects: [] });

    // Rival - Tense string with filter sweep and detune
    const rivalSynth = new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      filter: {
        type: 'lowpass',
        frequency: 800,
        Q: 2,
      },
      envelope: {
        attack: 0.1,
        decay: 0.3,
        sustain: 0.4,
        release: 0.8,
      },
      filterEnvelope: {
        attack: 0.05,
        decay: 0.2,
        sustain: 0.3,
        release: 0.5,
        baseFrequency: 200,
        octaves: 3,
      },
    });
    const rivalDetune = new Tone.PitchShift(0.1); // Slight detune for tension
    rivalSynth.chain(rivalDetune, this.masterChannel);
    this.synths.set('Rival', { synth: rivalSynth, effects: [rivalDetune] });

    // Enemy - Dissonant stab, short decay
    const enemySynth = new Tone.MonoSynth({
      oscillator: { type: 'square' },
      filter: {
        type: 'lowpass',
        frequency: 1200,
        Q: 4,
      },
      envelope: {
        attack: 0.01,
        decay: 0.15,
        sustain: 0.1,
        release: 0.3,
      },
      filterEnvelope: {
        attack: 0.01,
        decay: 0.1,
        sustain: 0.2,
        release: 0.2,
        baseFrequency: 400,
        octaves: 2,
      },
    });
    const enemyDistortion = new Tone.Distortion(0.2);
    enemySynth.chain(enemyDistortion, this.masterChannel);
    this.synths.set('Enemy', { synth: enemySynth, effects: [enemyDistortion] });

    // MentorStudent - Call-response with two voices an octave apart
    const mentorSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: {
        attack: 0.2,
        decay: 0.4,
        sustain: 0.6,
        release: 1.5,
      },
    });
    const mentorReverb = new Tone.Reverb({ decay: 3, wet: 0.4 });
    mentorSynth.chain(mentorReverb, this.masterChannel);
    this.synths.set('MentorStudent', { synth: mentorSynth, effects: [mentorReverb] });
  }

  /**
   * Play a note using the current relationship type's synth
   */
  playNote(note: string, duration: number = 0.5, velocity: number = 0.7): void {
    if (this.isDisposed) return;

    const config = this.synths.get(this.currentType);
    if (!config) return;

    const { synth } = config;

    // Handle MentorStudent special case - play call and response
    if (this.currentType === 'MentorStudent') {
      const polySynth = synth as Tone.PolySynth;
      // Mentor voice (lower octave)
      polySynth.triggerAttackRelease(note, duration, undefined, velocity);
      // Student response (higher octave) with slight delay
      const studentNote = this.transposeOctave(note, 1);
      setTimeout(() => {
        if (!this.isDisposed) {
          polySynth.triggerAttackRelease(studentNote, duration * 0.8, undefined, velocity * 0.8);
        }
      }, duration * 500); // Delay in ms
      return;
    }

    // Handle different synth types
    if (synth instanceof Tone.PluckSynth) {
      synth.triggerAttack(note);
    } else if (synth instanceof Tone.MonoSynth) {
      synth.triggerAttackRelease(note, duration, undefined, velocity);
    } else if (synth instanceof Tone.PolySynth) {
      synth.triggerAttackRelease(note, duration, undefined, velocity);
    }
  }

  /**
   * Stop any currently playing notes
   */
  stopNote(): void {
    if (this.isDisposed) return;

    const config = this.synths.get(this.currentType);
    if (!config) return;

    const { synth } = config;

    if (synth instanceof Tone.PolySynth) {
      synth.releaseAll();
    } else if (synth instanceof Tone.MonoSynth) {
      synth.triggerRelease();
    }
  }

  /**
   * Set the current relationship type
   */
  setRelationshipType(type: RelationshipType): void {
    if (this.isDisposed) return;
    this.currentType = type;
  }

  /**
   * Get the current relationship type
   */
  getRelationshipType(): RelationshipType {
    return this.currentType;
  }

  /**
   * Transpose a note by the specified number of octaves
   */
  private transposeOctave(note: string, octaves: number): string {
    const match = note.match(/^([A-Ga-g][#b]?)(\d+)$/);
    if (!match) return note;
    const [, pitch, octave] = match;
    return `${pitch}${parseInt(octave) + octaves}`;
  }

  /**
   * Dispose of all synths and effects
   */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    // Dispose all synths and their effects
    for (const [, config] of this.synths) {
      config.synth.dispose();
      config.effects.forEach((effect) => effect.dispose());
    }
    this.synths.clear();

    // Dispose master effects
    this.reverb.dispose();
    this.delay.dispose();
    this.chorus.dispose();
    this.masterChannel.dispose();
  }
}
