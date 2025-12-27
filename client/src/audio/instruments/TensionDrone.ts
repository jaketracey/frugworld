/**
 * TensionDrone - Background drone layer for graph physics
 *
 * A continuous low drone that responds to the force-directed simulation:
 * - totalEnergy: Controls drone volume and brightness (harmonics)
 * - springTension: Controls filter cutoff
 * - graphDiameter: Controls pitch bend on root drone
 */

import * as Tone from 'tone';

interface PhysicsState {
  energy: number; // Total kinetic energy
  tension: number; // Average spring tension
  diameter: number; // Graph diameter
}

export class TensionDrone {
  private baseSynth: Tone.Synth;
  private harmonicSynth: Tone.Synth;
  private subSynth: Tone.Synth;
  private lfo: Tone.LFO;
  private filter: Tone.Filter;
  private reverb: Tone.Reverb;
  private channel: Tone.Channel;
  private limiter: Tone.Limiter;

  private isPlaying: boolean = false;
  private isDisposed: boolean = false;
  private baseFrequency: number = 55; // A1 - low fundamental
  private currentPhysics: PhysicsState = { energy: 0.5, tension: 0.5, diameter: 0.5 };

  constructor() {
    // Main drone voice - low sustained tone
    this.baseSynth = new Tone.Synth({
      oscillator: {
        type: 'sine',
      },
      envelope: {
        attack: 2,
        decay: 1,
        sustain: 1,
        release: 4,
      },
    });

    // Harmonic overtone voice - adds brightness based on energy
    this.harmonicSynth = new Tone.Synth({
      oscillator: {
        type: 'sine',
      },
      envelope: {
        attack: 3,
        decay: 2,
        sustain: 0.8,
        release: 5,
      },
    });

    // Sub bass voice for depth
    this.subSynth = new Tone.Synth({
      oscillator: {
        type: 'sine',
      },
      envelope: {
        attack: 3,
        decay: 1,
        sustain: 1,
        release: 6,
      },
    });

    // LFO for subtle pitch modulation
    this.lfo = new Tone.LFO({
      frequency: 0.05,
      min: -20,
      max: 20,
    });

    // Filter for tension-controlled brightness
    this.filter = new Tone.Filter({
      type: 'lowpass',
      frequency: 400,
      Q: 1,
      rolloff: -24,
    });

    // Reverb for spaciousness
    this.reverb = new Tone.Reverb({
      decay: 8,
      wet: 0.5,
    });

    // Master channel for volume control
    this.channel = new Tone.Channel(-18, 0);

    // Limiter to prevent clipping
    this.limiter = new Tone.Limiter(-6);

    // Connect the signal chain
    const synthMerge = new Tone.Merge();
    this.baseSynth.connect(synthMerge);
    this.harmonicSynth.connect(synthMerge);
    this.subSynth.connect(synthMerge);

    synthMerge.chain(this.filter, this.reverb, this.channel, this.limiter, Tone.getDestination());

    // Connect LFO to base synth frequency for subtle pitch drift
    this.lfo.connect(this.baseSynth.frequency);
  }

  /**
   * Start the drone
   */
  start(): void {
    if (this.isDisposed || this.isPlaying) return;

    this.isPlaying = true;

    // Start the LFO
    this.lfo.start();

    // Start all voices with the base frequency
    const now = Tone.now();
    this.baseSynth.triggerAttack(this.baseFrequency, now);
    this.harmonicSynth.triggerAttack(this.baseFrequency * 2, now); // Octave up
    this.subSynth.triggerAttack(this.baseFrequency / 2, now); // Octave down

    // Apply current physics state
    this.applyPhysicsState();
  }

  /**
   * Stop the drone with a fade out
   */
  stop(): void {
    if (this.isDisposed || !this.isPlaying) return;

    this.isPlaying = false;

    const now = Tone.now();
    this.baseSynth.triggerRelease(now);
    this.harmonicSynth.triggerRelease(now);
    this.subSynth.triggerRelease(now);

    this.lfo.stop();
  }

  /**
   * Update the drone based on physics simulation state
   */
  updatePhysics(energy: number, tension: number, diameter: number): void {
    if (this.isDisposed) return;

    // Normalize values to 0-1 range
    energy = Math.max(0, Math.min(1, energy));
    tension = Math.max(0, Math.min(1, tension));
    diameter = Math.max(0, Math.min(1, diameter));

    this.currentPhysics = { energy, tension, diameter };

    if (this.isPlaying) {
      this.applyPhysicsState();
    }
  }

  /**
   * Apply the current physics state to synth parameters
   */
  private applyPhysicsState(): void {
    const { energy, tension, diameter } = this.currentPhysics;
    const rampTime = 0.5; // Smooth parameter transitions

    // Energy affects volume and brightness
    // Higher energy = louder and more harmonics
    const volumeDb = this.mapRange(energy, 0, 1, -30, -12);
    this.channel.volume.rampTo(volumeDb, rampTime);

    // Energy affects harmonic synth volume (brightness)
    const harmonicVolume = this.mapRange(energy, 0, 1, -40, -12);
    this.harmonicSynth.volume.rampTo(harmonicVolume, rampTime);

    // Spring tension affects filter cutoff
    // Higher tension = brighter sound
    const filterFreq = this.mapRange(tension, 0, 1, 200, 1200);
    this.filter.frequency.rampTo(filterFreq, rampTime);

    // Graph diameter affects pitch bend
    // Larger diameter = slight pitch shift down (expanding universe feel)
    // Smaller diameter = slight pitch shift up (contraction)
    const pitchBend = this.mapRange(diameter, 0, 1, 10, -10); // cents
    const bendFactor = Math.pow(2, pitchBend / 1200);
    const newBaseFreq = this.baseFrequency * bendFactor;

    this.baseSynth.frequency.rampTo(newBaseFreq, rampTime);
    this.harmonicSynth.frequency.rampTo(newBaseFreq * 2, rampTime);
    this.subSynth.frequency.rampTo(newBaseFreq / 2, rampTime);

    // LFO rate changes with energy (more active = faster modulation)
    const lfoFreq = this.mapRange(energy, 0, 1, 0.02, 0.15);
    this.lfo.frequency.rampTo(lfoFreq, rampTime);

    // Reverb wetness changes with diameter (larger = more spacious)
    const reverbWet = this.mapRange(diameter, 0, 1, 0.3, 0.7);
    this.reverb.wet.rampTo(reverbWet, rampTime);
  }

  /**
   * Set the base frequency of the drone
   */
  setBaseFrequency(freq: number): void {
    if (this.isDisposed) return;

    this.baseFrequency = freq;

    if (this.isPlaying) {
      this.baseSynth.frequency.rampTo(freq, 1);
      this.harmonicSynth.frequency.rampTo(freq * 2, 1);
      this.subSynth.frequency.rampTo(freq / 2, 1);
    }
  }

  /**
   * Set the base frequency using a note name (e.g., "A1")
   */
  setBaseNote(note: string): void {
    const freq = Tone.Frequency(note).toFrequency();
    this.setBaseFrequency(freq);
  }

  /**
   * Check if the drone is currently playing
   */
  isActive(): boolean {
    return this.isPlaying;
  }

  /**
   * Get current physics state
   */
  getPhysicsState(): PhysicsState {
    return { ...this.currentPhysics };
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
   * Dispose of all synths and effects
   */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    // Stop if playing
    if (this.isPlaying) {
      this.stop();
    }

    // Dispose all components
    this.baseSynth.dispose();
    this.harmonicSynth.dispose();
    this.subSynth.dispose();
    this.lfo.dispose();
    this.filter.dispose();
    this.reverb.dispose();
    this.channel.dispose();
    this.limiter.dispose();
  }
}
