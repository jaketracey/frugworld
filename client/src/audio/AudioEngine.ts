/**
 * AudioEngine.ts
 *
 * Main generative audio system that orchestrates procedural music
 * based on game state. Sonifies the social simulation in real-time,
 * reflecting emergent social dynamics of the NPC network.
 *
 * Inspired by Brian Eno's generative music principles.
 */

import * as Tone from 'tone';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface AudioEngineConfig {
  masterVolume: number;      // -60 to 0 dB
  enabled: boolean;
  spatialAudio: boolean;     // Pan based on graph position
  density: number;           // 0-1, controls musical busyness
}

export interface GraphState {
  nodeCount: number;
  averageVelocity: number;
  dominantAgreeableness: number;
  timeOfDay: number; // 0-24
}

export interface PhysicsState {
  kineticEnergy: number;
  springTension: number;
  graphDiameter: number;
  clusteringCoefficient: number;
}

export interface RelationshipEvent {
  type: 'created' | 'upgraded' | 'degraded' | 'removed';
  relationshipType: string;
  npcId: number;
  affinity?: number;
  trust?: number;
}

export interface NPCState {
  id: number;
  lod: number;
  extraversion: number;
  agreeableness: number;
  lifeStage: string;
  position?: { x: number; y: number };
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: AudioEngineConfig = {
  masterVolume: -12,
  enabled: true,
  spatialAudio: true,
  density: 0.5,
};

// Musical scales (semitone offsets from root)
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

// Circle of fifths for time-of-day modulation
const CIRCLE_OF_FIFTHS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'Ab', 'Eb', 'Bb', 'F'];

// Life stage to octave mapping
const LIFE_STAGE_OCTAVES: Record<string, number> = {
  'Youth': 5,
  'Adult': 4,
  'Mature': 3,
  'Elder': 2,
};

// Tempo range
const MIN_TEMPO = 40;
const MAX_TEMPO = 120;

// Polyphony limits
const MAX_VOICES = 12;
const MIN_VOICES = 8;

// Update debounce rate (Hz)
const UPDATE_RATE_HZ = 8;
const UPDATE_INTERVAL_MS = 1000 / UPDATE_RATE_HZ;

// ============================================================================
// AudioEngine Class
// ============================================================================

export class AudioEngine {
  private config: AudioEngineConfig;
  private isPlaying: boolean = false;
  private isInitialized: boolean = false;

  // Audio nodes
  private masterChannel: Tone.Channel | null = null;
  private limiter: Tone.Limiter | null = null;
  private reverb: Tone.Reverb | null = null;
  private compressor: Tone.Compressor | null = null;

  // Instruments (lazy-loaded from instruments/ folder)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private instruments: Map<string, any> = new Map();
  private droneSynth: Tone.Synth | null = null;

  // Current musical state
  private currentKey: string = 'C';
  private currentMode: keyof typeof SCALES = 'major';
  private currentTempo: number = 60;
  private currentScale: number[] = SCALES.major;

  // Voice tracking for polyphony limiting
  private activeVoices: Set<string> = new Set();
  private voiceQueue: Array<{ id: string; triggerFn: () => void }> = [];

  // State caching for debouncing
  private lastGraphUpdate: number = 0;
  private lastPhysicsUpdate: number = 0;
  private pendingGraphState: GraphState | null = null;
  private pendingPhysicsState: PhysicsState | null = null;

  // NPC tracking (only LOD0-LOD1)
  private trackedNPCs: Map<number, NPCState> = new Map();

  // Transport scheduling
  private scheduledLoopId: number | null = null;

  // Fade state
  private fadeGain: Tone.Gain | null = null;

  constructor(config: Partial<AudioEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ============================================================================
  // Lifecycle Methods
  // ============================================================================

  /**
   * Initialize the audio engine (requires user gesture for Web Audio)
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;

    // Ensure Tone.js context is started
    await Tone.start();

    // Create master channel with limiter
    this.limiter = new Tone.Limiter(-3);
    this.compressor = new Tone.Compressor({
      threshold: -24,
      ratio: 4,
      attack: 0.003,
      release: 0.25,
    });
    this.reverb = new Tone.Reverb({
      decay: 4,
      wet: 0.3,
    });
    await this.reverb.generate();

    this.masterChannel = new Tone.Channel({
      volume: this.config.masterVolume,
      pan: 0,
    });

    this.fadeGain = new Tone.Gain(0);

    // Chain: masterChannel -> fadeGain -> reverb -> compressor -> limiter -> destination
    this.masterChannel.chain(
      this.fadeGain,
      this.reverb,
      this.compressor,
      this.limiter,
      Tone.getDestination()
    );

    // Create instruments
    this.createInstruments();

    this.isInitialized = true;
    console.log('[AudioEngine] Initialized');
  }

  /**
   * Start the generative audio system
   */
  start(): void {
    if (!this.isInitialized) {
      console.warn('[AudioEngine] Not initialized. Call init() first.');
      return;
    }

    if (this.isPlaying) return;

    this.isPlaying = true;
    Tone.getTransport().bpm.value = this.currentTempo;
    Tone.getTransport().start();

    // Schedule the main music loop
    this.scheduleMusicLoop();

    // Start the drone
    this.startDrone();

    console.log('[AudioEngine] Started');
  }

  /**
   * Stop the generative audio system
   */
  stop(): void {
    if (!this.isPlaying) return;

    this.isPlaying = false;

    // Cancel scheduled loop
    if (this.scheduledLoopId !== null) {
      Tone.getTransport().clear(this.scheduledLoopId);
      this.scheduledLoopId = null;
    }

    // Stop the drone
    this.stopDrone();

    // Release all active voices
    this.releaseAllVoices();

    Tone.getTransport().stop();

    console.log('[AudioEngine] Stopped');
  }

  /**
   * Clean up all resources
   */
  dispose(): void {
    this.stop();

    // Dispose instruments
    this.instruments.forEach((instrument) => {
      instrument.dispose();
    });
    this.instruments.clear();

    // Dispose drone
    if (this.droneSynth) {
      this.droneSynth.dispose();
      this.droneSynth = null;
    }

    // Dispose audio nodes
    if (this.masterChannel) {
      this.masterChannel.dispose();
      this.masterChannel = null;
    }
    if (this.fadeGain) {
      this.fadeGain.dispose();
      this.fadeGain = null;
    }
    if (this.reverb) {
      this.reverb.dispose();
      this.reverb = null;
    }
    if (this.compressor) {
      this.compressor.dispose();
      this.compressor = null;
    }
    if (this.limiter) {
      this.limiter.dispose();
      this.limiter = null;
    }

    // Clear state
    this.trackedNPCs.clear();
    this.activeVoices.clear();
    this.voiceQueue = [];

    this.isInitialized = false;
    console.log('[AudioEngine] Disposed');
  }

  // ============================================================================
  // Fade Methods
  // ============================================================================

  /**
   * Fade in the audio over specified duration
   */
  fadeIn(duration: number = 2): void {
    if (!this.fadeGain) return;
    this.fadeGain.gain.cancelScheduledValues(Tone.now());
    this.fadeGain.gain.setValueAtTime(this.fadeGain.gain.value, Tone.now());
    this.fadeGain.gain.rampTo(1, duration);
  }

  /**
   * Fade out the audio over specified duration
   */
  fadeOut(duration: number = 2, onComplete?: () => void): void {
    if (!this.fadeGain) return;
    this.fadeGain.gain.cancelScheduledValues(Tone.now());
    this.fadeGain.gain.setValueAtTime(this.fadeGain.gain.value, Tone.now());
    this.fadeGain.gain.rampTo(0, duration);

    if (onComplete) {
      setTimeout(onComplete, duration * 1000);
    }
  }

  // ============================================================================
  // State Update Handlers
  // ============================================================================

  /**
   * Handle graph state updates from SpacetimeDB
   * Debounced to UPDATE_RATE_HZ
   */
  onGraphStateUpdate(state: GraphState): void {
    if (!this.config.enabled || !this.isPlaying) return;

    const now = Date.now();
    this.pendingGraphState = state;

    if (now - this.lastGraphUpdate >= UPDATE_INTERVAL_MS) {
      this.processGraphState(state);
      this.lastGraphUpdate = now;
      this.pendingGraphState = null;
    }
  }

  /**
   * Handle relationship change events
   */
  onRelationshipChange(event: RelationshipEvent): void {
    if (!this.config.enabled || !this.isPlaying) return;

    // Trigger appropriate musical response
    switch (event.type) {
      case 'created':
        this.playRelationshipCreated(event);
        break;
      case 'upgraded':
        this.playRelationshipUpgraded(event);
        break;
      case 'degraded':
        this.playRelationshipDegraded(event);
        break;
      case 'removed':
        this.playRelationshipRemoved(event);
        break;
    }
  }

  /**
   * Handle NPC state updates
   * Only tracks NPCs in LOD0-LOD1
   */
  onNPCUpdate(npc: NPCState): void {
    if (!this.config.enabled || !this.isPlaying) return;

    // Only sonify NPCs in LOD0-LOD1
    if (npc.lod <= 1) {
      this.trackedNPCs.set(npc.id, npc);
    } else {
      // Remove from tracking if moved to LOD2+
      if (this.trackedNPCs.has(npc.id)) {
        this.playNPCExit(npc);
        this.trackedNPCs.delete(npc.id);
      }
    }
  }

  /**
   * Handle physics state updates
   * Debounced to UPDATE_RATE_HZ
   */
  onPhysicsUpdate(physics: PhysicsState): void {
    if (!this.config.enabled || !this.isPlaying) return;

    const now = Date.now();
    this.pendingPhysicsState = physics;

    if (now - this.lastPhysicsUpdate >= UPDATE_INTERVAL_MS) {
      this.processPhysicsState(physics);
      this.lastPhysicsUpdate = now;
      this.pendingPhysicsState = null;
    }
  }

  // ============================================================================
  // Configuration Methods
  // ============================================================================

  /**
   * Set master volume (-60 to 0 dB)
   */
  setMasterVolume(volume: number): void {
    this.config.masterVolume = Math.max(-60, Math.min(0, volume));
    if (this.masterChannel) {
      this.masterChannel.volume.rampTo(this.config.masterVolume, 0.1);
    }
  }

  /**
   * Set musical density (0-1)
   */
  setDensity(density: number): void {
    this.config.density = Math.max(0, Math.min(1, density));
  }

  /**
   * Enable/disable the audio engine
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (!enabled && this.isPlaying) {
      this.fadeOut(1, () => this.stop());
    }
  }

  /**
   * Enable/disable spatial audio
   */
  setSpatialAudio(enabled: boolean): void {
    this.config.spatialAudio = enabled;
  }

  /**
   * Get current configuration
   */
  getConfig(): AudioEngineConfig {
    return { ...this.config };
  }

  /**
   * Get current musical state
   */
  getMusicalState(): { key: string; mode: string; tempo: number } {
    return {
      key: this.currentKey,
      mode: this.currentMode,
      tempo: this.currentTempo,
    };
  }

  // ============================================================================
  // Private: Instrument Creation
  // ============================================================================

  private createInstruments(): void {
    if (!this.masterChannel) return;

    // Friend pad - warm, sustained
    const friendPad = new Tone.PolySynth(Tone.AMSynth, {
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
    friendPad.maxPolyphony = 4;
    friendPad.connect(this.masterChannel);
    this.instruments.set('friend', friendPad);

    // Close friend bell - resonant, bright
    const closeFriendBell = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 8,
      modulationIndex: 2,
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.01,
        decay: 1.5,
        sustain: 0,
        release: 1,
      },
      modulation: { type: 'square' },
      modulationEnvelope: {
        attack: 0.01,
        decay: 0.5,
        sustain: 0.2,
        release: 0.5,
      },
    });
    closeFriendBell.maxPolyphony = 3;
    closeFriendBell.connect(this.masterChannel);
    this.instruments.set('closeFriend', closeFriendBell);

    // Stranger pluck - sparse, dry
    const strangerPluck = new Tone.PluckSynth({
      attackNoise: 1,
      dampening: 4000,
      resonance: 0.9,
    });
    strangerPluck.connect(this.masterChannel);
    this.instruments.set('stranger', strangerPluck);

    // Acquaintance keys - soft FM
    const acquaintanceKeys = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 1.5,
      modulationIndex: 0.5,
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.1,
        decay: 0.3,
        sustain: 0.4,
        release: 0.8,
      },
      modulation: { type: 'triangle' },
      modulationEnvelope: {
        attack: 0.2,
        decay: 0.1,
        sustain: 0.3,
        release: 0.3,
      },
    });
    acquaintanceKeys.maxPolyphony = 4;
    acquaintanceKeys.connect(this.masterChannel);
    this.instruments.set('acquaintance', acquaintanceKeys);

    // Rival string - tense, filtered
    const rivalString = new Tone.MonoSynth({
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
    rivalString.connect(this.masterChannel);
    this.instruments.set('rival', rivalString);

    // Enemy stab - dissonant, short
    const enemyStab = new Tone.MonoSynth({
      oscillator: { type: 'square' },
      filter: {
        type: 'highpass',
        frequency: 400,
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
    enemyStab.connect(this.masterChannel);
    this.instruments.set('enemy', enemyStab);

    // Event chime - for general events
    const eventChime = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.01,
        decay: 0.8,
        sustain: 0,
        release: 0.5,
      },
    });
    eventChime.maxPolyphony = 4;
    eventChime.connect(this.masterChannel);
    this.instruments.set('chime', eventChime);

    // Drone synth - background texture
    this.droneSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: {
        attack: 2,
        decay: 1,
        sustain: 1,
        release: 4,
      },
    });
    this.droneSynth.volume.value = -18;
    this.droneSynth.connect(this.masterChannel);
  }

  // ============================================================================
  // Private: Music Scheduling
  // ============================================================================

  private scheduleMusicLoop(): void {
    // Schedule a repeating callback on every beat
    this.scheduledLoopId = Tone.getTransport().scheduleRepeat(
      (time) => {
        this.onBeat(time);
      },
      '4n',
      0
    );
  }

  private onBeat(time: number): void {
    // Process any pending state updates
    if (this.pendingGraphState) {
      this.processGraphState(this.pendingGraphState);
      this.pendingGraphState = null;
    }

    // Generate notes based on tracked NPCs and density
    this.generateMusicForBeat(time);
  }

  private generateMusicForBeat(time: number): void {
    if (!this.config.enabled) return;

    // Determine how many notes to play based on density
    const noteChance = this.config.density * 0.5;

    // Iterate through tracked NPCs (LOD0-LOD1 only)
    for (const [npcId, npc] of this.trackedNPCs) {
      if (Math.random() > noteChance) continue;
      if (this.activeVoices.size >= MAX_VOICES) break;

      // Generate a note for this NPC
      this.playNPCNote(npc, time);
    }
  }

  // ============================================================================
  // Private: Note Playing
  // ============================================================================

  private playNPCNote(npc: NPCState, time: number): void {
    // Determine octave from life stage
    const octave = LIFE_STAGE_OCTAVES[npc.lifeStage] || 4;

    // Determine note from agreeableness and current scale
    const scaleIndex = Math.floor((npc.agreeableness / 100) * this.currentScale.length);
    const semitone = this.currentScale[Math.min(scaleIndex, this.currentScale.length - 1)];
    const rootMidi = this.keyToMidi(this.currentKey);
    const noteMidi = rootMidi + semitone + (octave * 12);
    const noteFreq = Tone.Frequency(noteMidi, 'midi').toFrequency();

    // Determine velocity from extraversion
    const velocity = 0.3 + (npc.extraversion / 100) * 0.5;

    // Determine duration from life stage
    const durations: Record<string, string> = {
      'Youth': '8n',
      'Adult': '4n',
      'Mature': '2n',
      'Elder': '1n',
    };
    const duration = durations[npc.lifeStage] || '4n';

    // Choose instrument based on relationship type (simplified - use chime for now)
    const instrument = this.instruments.get('chime') as Tone.PolySynth;
    if (!instrument) return;

    // Apply spatial panning if enabled
    if (this.config.spatialAudio && npc.position) {
      // Normalize position to -1 to 1 range (assuming position is in some coordinate system)
      const pan = Math.max(-1, Math.min(1, npc.position.x / 500));
      // Create a panner for this note (simplified - in production would pool these)
      const panner = new Tone.Panner(pan);
      instrument.disconnect();
      instrument.connect(panner);
      panner.connect(this.masterChannel!);
    }

    // Track the voice
    const voiceId = `npc-${npc.id}-${time}`;
    this.activeVoices.add(voiceId);

    // Play the note
    instrument.triggerAttackRelease(noteFreq, duration, time, velocity);

    // Remove voice tracking after duration
    const durationMs = Tone.Time(duration).toMilliseconds();
    setTimeout(() => {
      this.activeVoices.delete(voiceId);
      this.processVoiceQueue();
    }, durationMs);
  }

  // ============================================================================
  // Private: Relationship Event Sounds
  // ============================================================================

  private playRelationshipCreated(event: RelationshipEvent): void {
    if (this.activeVoices.size >= MAX_VOICES) {
      this.queueVoice(`rel-created-${event.npcId}`, () => this.playRelationshipCreated(event));
      return;
    }

    // Rising arpeggio
    const instrument = this.instruments.get('chime') as Tone.PolySynth;
    if (!instrument) return;

    const rootMidi = this.keyToMidi(this.currentKey);
    const octave = 4;
    const notes = [0, 4, 7, 12].map((interval) => {
      return Tone.Frequency(rootMidi + interval + octave * 12, 'midi').toFrequency();
    });

    const voiceId = `rel-created-${event.npcId}-${Date.now()}`;
    this.activeVoices.add(voiceId);

    const now = Tone.now();
    notes.forEach((freq, i) => {
      instrument.triggerAttackRelease(freq, '8n', now + i * 0.1, 0.5);
    });

    setTimeout(() => {
      this.activeVoices.delete(voiceId);
    }, 600);
  }

  private playRelationshipUpgraded(event: RelationshipEvent): void {
    if (this.activeVoices.size >= MAX_VOICES) {
      this.queueVoice(`rel-upgraded-${event.npcId}`, () => this.playRelationshipUpgraded(event));
      return;
    }

    // Consonant chord swell
    const instrument = this.instruments.get('friend') as Tone.PolySynth;
    if (!instrument) return;

    const rootMidi = this.keyToMidi(this.currentKey);
    const octave = 4;
    // Major chord
    const notes = [0, 4, 7].map((interval) => {
      return Tone.Frequency(rootMidi + interval + octave * 12, 'midi').toFrequency();
    });

    const voiceId = `rel-upgraded-${event.npcId}-${Date.now()}`;
    this.activeVoices.add(voiceId);

    notes.forEach((freq) => {
      instrument.triggerAttackRelease(freq, '2n', Tone.now(), 0.6);
    });

    setTimeout(() => {
      this.activeVoices.delete(voiceId);
    }, 1500);
  }

  private playRelationshipDegraded(event: RelationshipEvent): void {
    if (this.activeVoices.size >= MAX_VOICES) {
      this.queueVoice(`rel-degraded-${event.npcId}`, () => this.playRelationshipDegraded(event));
      return;
    }

    // Descending minor phrase
    const instrument = this.instruments.get('rival');
    if (!instrument) return;

    const rootMidi = this.keyToMidi(this.currentKey);
    const octave = 4;
    // Descending minor pattern
    const notes = [12, 10, 8, 7].map((interval) => {
      return Tone.Frequency(rootMidi + interval + octave * 12, 'midi').toFrequency();
    });

    const voiceId = `rel-degraded-${event.npcId}-${Date.now()}`;
    this.activeVoices.add(voiceId);

    const now = Tone.now();
    notes.forEach((freq, i) => {
      (instrument as Tone.MonoSynth).triggerAttackRelease(freq, '8n', now + i * 0.15, 0.5);
    });

    setTimeout(() => {
      this.activeVoices.delete(voiceId);
    }, 800);
  }

  private playRelationshipRemoved(event: RelationshipEvent): void {
    if (this.activeVoices.size >= MAX_VOICES) return;

    // Soft fade-out tone
    const instrument = this.instruments.get('stranger');
    if (!instrument) return;

    const rootMidi = this.keyToMidi(this.currentKey);
    const noteFreq = Tone.Frequency(rootMidi + 36, 'midi').toFrequency();

    instrument.triggerAttack(noteFreq, Tone.now());
  }

  // ============================================================================
  // Private: NPC Entry/Exit Sounds
  // ============================================================================

  private playNPCExit(npc: NPCState): void {
    // Fade-out tail when NPC leaves LOD0-LOD1
    const instrument = this.instruments.get('chime') as Tone.PolySynth;
    if (!instrument) return;

    const rootMidi = this.keyToMidi(this.currentKey);
    const octave = LIFE_STAGE_OCTAVES[npc.lifeStage] || 4;
    const noteFreq = Tone.Frequency(rootMidi + octave * 12, 'midi').toFrequency();

    instrument.triggerAttackRelease(noteFreq, '4n', Tone.now(), 0.2);
  }

  // ============================================================================
  // Private: Drone Management
  // ============================================================================

  private startDrone(): void {
    if (!this.droneSynth) return;

    const rootMidi = this.keyToMidi(this.currentKey);
    const droneFreq = Tone.Frequency(rootMidi + 24, 'midi').toFrequency(); // Low octave
    this.droneSynth.triggerAttack(droneFreq, Tone.now());
  }

  private stopDrone(): void {
    if (!this.droneSynth) return;
    this.droneSynth.triggerRelease(Tone.now());
  }

  private updateDrone(physics: PhysicsState): void {
    if (!this.droneSynth) return;

    // Map kinetic energy to drone volume (-30 to -12 dB)
    const normalizedEnergy = Math.min(1, physics.kineticEnergy / 100);
    const droneVolume = -30 + normalizedEnergy * 18;
    this.droneSynth.volume.rampTo(droneVolume, 0.5);

    // Could also modulate filter based on spring tension if filter was added
  }

  // ============================================================================
  // Private: State Processing
  // ============================================================================

  private processGraphState(state: GraphState): void {
    // Map average velocity to tempo (40-120 BPM)
    const normalizedVelocity = Math.min(1, state.averageVelocity / 10);
    const newTempo = MIN_TEMPO + normalizedVelocity * (MAX_TEMPO - MIN_TEMPO);
    this.updateTempo(newTempo);

    // Map dominant agreeableness to mode
    this.updateModeFromAgreeableness(state.dominantAgreeableness);

    // Map time of day to key (circle of fifths modulation)
    this.updateKeyFromTimeOfDay(state.timeOfDay);
  }

  private processPhysicsState(physics: PhysicsState): void {
    // Update drone based on physics
    this.updateDrone(physics);

    // Could map clustering coefficient to chord density
    // Could map graph diameter to pitch bend
  }

  // ============================================================================
  // Private: Musical Parameter Updates
  // ============================================================================

  private updateTempo(newTempo: number): void {
    // Smooth tempo transition
    const clampedTempo = Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, newTempo));
    if (Math.abs(clampedTempo - this.currentTempo) > 2) {
      this.currentTempo = clampedTempo;
      Tone.getTransport().bpm.rampTo(this.currentTempo, 2);
    }
  }

  private updateModeFromAgreeableness(agreeableness: number): void {
    let newMode: keyof typeof SCALES;

    if (agreeableness >= 70) {
      newMode = 'major';
    } else if (agreeableness >= 50) {
      newMode = 'lydian';
    } else if (agreeableness >= 30) {
      newMode = 'dorian';
    } else if (agreeableness >= 15) {
      newMode = 'minor';
    } else {
      newMode = 'phrygian';
    }

    if (newMode !== this.currentMode) {
      this.currentMode = newMode;
      this.currentScale = SCALES[newMode];
    }
  }

  private updateKeyFromTimeOfDay(timeOfDay: number): void {
    // Modulate through circle of fifths based on time
    // Complete one full cycle per 24 hours
    const keyIndex = Math.floor((timeOfDay / 24) * CIRCLE_OF_FIFTHS.length) % CIRCLE_OF_FIFTHS.length;
    const newKey = CIRCLE_OF_FIFTHS[keyIndex];

    if (newKey !== this.currentKey) {
      this.currentKey = newKey;
      // Restart drone on new root if playing
      if (this.isPlaying && this.droneSynth) {
        this.stopDrone();
        setTimeout(() => this.startDrone(), 500);
      }
    }
  }

  // ============================================================================
  // Private: Voice Management
  // ============================================================================

  private releaseAllVoices(): void {
    this.instruments.forEach((instrument) => {
      if ('releaseAll' in instrument) {
        (instrument as Tone.PolySynth).releaseAll();
      }
    });
    this.activeVoices.clear();
    this.voiceQueue = [];
  }

  private queueVoice(id: string, triggerFn: () => void): void {
    this.voiceQueue.push({ id, triggerFn });
  }

  private processVoiceQueue(): void {
    if (this.voiceQueue.length === 0) return;
    if (this.activeVoices.size >= MIN_VOICES) return;

    const next = this.voiceQueue.shift();
    if (next) {
      next.triggerFn();
    }
  }

  // ============================================================================
  // Private: Utility Methods
  // ============================================================================

  private keyToMidi(key: string): number {
    const keyMap: Record<string, number> = {
      'C': 0, 'C#': 1, 'Db': 1,
      'D': 2, 'D#': 3, 'Eb': 3,
      'E': 4,
      'F': 5, 'F#': 6, 'Gb': 6,
      'G': 7, 'G#': 8, 'Ab': 8,
      'A': 9, 'A#': 10, 'Bb': 10,
      'B': 11,
    };
    return keyMap[key] ?? 0;
  }
}

export default AudioEngine;
