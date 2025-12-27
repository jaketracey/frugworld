/**
 * EventChime - One-shot sounds for discrete simulation events
 *
 * Discrete simulation events trigger musical moments:
 * - New relationship formed: Rising arpeggio
 * - Relationship upgraded (Stranger to Friend): Consonant chord swell
 * - Relationship degraded (Friend to Rival): Descending minor phrase
 * - NPC enters LOD0 (player proximity): Soft chime in stereo field
 * - NPC exits LOD0: Fade-out tail
 * - Life stage transition: Modal shift, sustained tone
 */

import * as Tone from 'tone';

export class EventChime {
  private chimeSynth: Tone.PolySynth;
  private bellSynth: Tone.PolySynth;
  private arpeggioSynth: Tone.PolySynth;
  private sustainSynth: Tone.PolySynth;

  private reverb: Tone.Reverb;
  private delay: Tone.PingPongDelay;
  private channel: Tone.Channel;
  private limiter: Tone.Limiter;

  private isDisposed: boolean = false;

  constructor() {
    // Chime synth for proximity events - bell-like quality
    this.chimeSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: {
        type: 'sine',
      },
      envelope: {
        attack: 0.01,
        decay: 1.5,
        sustain: 0.1,
        release: 2,
      },
    });
    this.chimeSynth.maxPolyphony = 4;

    // Bell synth for upgrade events - resonant and warm
    this.bellSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: {
        type: 'triangle',
      },
      envelope: {
        attack: 0.1,
        decay: 0.8,
        sustain: 0.4,
        release: 2.5,
      },
    });
    this.bellSynth.maxPolyphony = 6;

    // Arpeggio synth for relationship formation
    this.arpeggioSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: {
        type: 'triangle',
      },
      envelope: {
        attack: 0.02,
        decay: 0.3,
        sustain: 0.2,
        release: 0.8,
      },
    });
    this.arpeggioSynth.maxPolyphony = 8;

    // Sustain synth for life stage transitions
    this.sustainSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: {
        type: 'sine',
      },
      envelope: {
        attack: 0.5,
        decay: 1,
        sustain: 0.8,
        release: 3,
      },
    });
    this.sustainSynth.maxPolyphony = 6;

    // Effects chain
    this.reverb = new Tone.Reverb({
      decay: 3,
      wet: 0.4,
    });

    this.delay = new Tone.PingPongDelay({
      delayTime: '8n',
      feedback: 0.3,
      wet: 0.25,
    });

    this.channel = new Tone.Channel(-9, 0);
    this.limiter = new Tone.Limiter(-3);

    // Connect all synths through the effects chain
    this.chimeSynth.chain(this.reverb, this.channel, this.limiter, Tone.getDestination());
    this.bellSynth.chain(this.delay, this.reverb, this.channel);
    this.arpeggioSynth.chain(this.delay, this.reverb, this.channel);
    this.sustainSynth.chain(this.reverb, this.channel);
  }

  /**
   * Play a rising arpeggio when a new relationship is formed
   */
  playRelationshipFormed(): void {
    if (this.isDisposed) return;

    const notes = ['C4', 'E4', 'G4', 'C5'];
    const noteDuration = 0.15;
    const now = Tone.now();

    notes.forEach((note, index) => {
      const time = now + index * noteDuration;
      this.arpeggioSynth.triggerAttackRelease(note, '8n', time, 0.6);
    });
  }

  /**
   * Play a consonant chord swell when a relationship is upgraded
   */
  playRelationshipUpgraded(): void {
    if (this.isDisposed) return;

    // Major chord swell
    const notes = ['C4', 'E4', 'G4', 'C5'];
    const now = Tone.now();

    // Initial soft attack
    this.bellSynth.triggerAttackRelease(notes, '2n', now, 0.4);

    // Swell to louder (achieved through overlapping notes)
    setTimeout(() => {
      if (!this.isDisposed) {
        this.bellSynth.triggerAttackRelease(['E5', 'G5'], '4n', undefined, 0.6);
      }
    }, 300);
  }

  /**
   * Play a descending minor phrase when a relationship is degraded
   */
  playRelationshipDegraded(): void {
    if (this.isDisposed) return;

    // Descending minor phrase
    const notes = ['E4', 'D4', 'C4', 'A3'];
    const noteDuration = 0.2;
    const now = Tone.now();

    notes.forEach((note, index) => {
      const time = now + index * noteDuration;
      const velocity = 0.5 - index * 0.08; // Fade out as it descends
      this.arpeggioSynth.triggerAttackRelease(note, '8n', time, Math.max(0.2, velocity));
    });
  }

  /**
   * Play a soft chime when an NPC enters player proximity (LOD0)
   * @param pan - Stereo position (-1 to 1)
   */
  playNPCEnterProximity(pan: number = 0): void {
    if (this.isDisposed) return;

    // Set stereo position
    this.channel.pan.value = Math.max(-1, Math.min(1, pan));

    // Soft bell-like chime
    const notes = ['G5', 'E5'];
    this.chimeSynth.triggerAttackRelease(notes, '4n', undefined, 0.4);

    // Reset pan after a delay
    setTimeout(() => {
      if (!this.isDisposed) {
        this.channel.pan.value = 0;
      }
    }, 500);
  }

  /**
   * Play a fade-out tail when an NPC exits player proximity
   * @param pan - Stereo position (-1 to 1)
   */
  playNPCExitProximity(pan: number = 0): void {
    if (this.isDisposed) return;

    // Set stereo position
    this.channel.pan.value = Math.max(-1, Math.min(1, pan));

    // Descending fade-out
    const notes = ['C5', 'G4'];
    const now = Tone.now();

    this.chimeSynth.triggerAttackRelease(notes[0], '8n', now, 0.3);
    this.chimeSynth.triggerAttackRelease(notes[1], '4n', now + 0.1, 0.2);

    // Reset pan after sound fades
    setTimeout(() => {
      if (!this.isDisposed) {
        this.channel.pan.value = 0;
      }
    }, 1000);
  }

  /**
   * Play a modal shift with sustained tone for life stage transitions
   * @param lifeStage - The new life stage (Youth, Adult, Mature, Elder)
   */
  playLifeStageTransition(lifeStage?: string): void {
    if (this.isDisposed) return;

    // Different modes for different life stages
    let notes: string[];

    switch (lifeStage?.toLowerCase()) {
      case 'youth':
        // Lydian feel - bright and hopeful
        notes = ['C5', 'E5', 'F#5', 'B5'];
        break;
      case 'adult':
        // Mixolydian feel - stable and grounded
        notes = ['C4', 'E4', 'G4', 'Bb4'];
        break;
      case 'mature':
        // Dorian feel - reflective
        notes = ['C3', 'Eb3', 'G3', 'A3'];
        break;
      case 'elder':
        // Phrygian feel - ancient and wise
        notes = ['C2', 'Db2', 'F2', 'G2'];
        break;
      default:
        // Generic modal shift
        notes = ['C4', 'Eb4', 'G4', 'Bb4'];
    }

    // Sustained chord with gentle attack
    this.sustainSynth.triggerAttackRelease(notes, '1n', undefined, 0.5);

    // Add a high harmonic for shimmer
    setTimeout(() => {
      if (!this.isDisposed) {
        const highNote = this.transposeOctave(notes[0], 2);
        this.chimeSynth.triggerAttackRelease(highNote, '2n', undefined, 0.3);
      }
    }, 500);
  }

  /**
   * Play a custom event sound
   */
  playCustomEvent(notes: string[], duration: string = '4n', velocity: number = 0.5): void {
    if (this.isDisposed) return;

    this.bellSynth.triggerAttackRelease(notes, duration, undefined, velocity);
  }

  /**
   * Play an achievement/milestone fanfare
   */
  playMilestone(): void {
    if (this.isDisposed) return;

    const fanfare = [
      { notes: ['C4', 'E4'], time: 0, duration: '8n', velocity: 0.6 },
      { notes: ['G4'], time: 0.15, duration: '8n', velocity: 0.7 },
      { notes: ['C5', 'E5', 'G5'], time: 0.3, duration: '2n', velocity: 0.8 },
    ];

    const now = Tone.now();

    fanfare.forEach((event) => {
      this.bellSynth.triggerAttackRelease(
        event.notes,
        event.duration,
        now + event.time,
        event.velocity
      );
    });
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
   * Set master volume for all event sounds
   */
  setVolume(volumeDb: number): void {
    if (this.isDisposed) return;
    this.channel.volume.rampTo(volumeDb, 0.1);
  }

  /**
   * Dispose of all synths and effects
   */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.chimeSynth.dispose();
    this.bellSynth.dispose();
    this.arpeggioSynth.dispose();
    this.sustainSynth.dispose();

    this.reverb.dispose();
    this.delay.dispose();
    this.channel.dispose();
    this.limiter.dispose();
  }
}
