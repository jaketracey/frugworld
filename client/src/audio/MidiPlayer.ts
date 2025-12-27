/**
 * MIDI Player for background music
 * Uses midi-player-js for parsing and soundfont-player for synthesis
 */

import MidiPlayer from 'midi-player-js';
import Soundfont, { type Player as SoundfontPlayer } from 'soundfont-player';

export interface MidiPlayerConfig {
  volume: number; // 0.0 to 1.0
  loop: boolean;
  onPlayStart?: () => void;
  onPlayEnd?: () => void;
  onError?: (error: Error) => void;
}

const DEFAULT_CONFIG: MidiPlayerConfig = {
  volume: 0.6,
  loop: true,
};

// General MIDI program numbers to soundfont names
const GM_INSTRUMENTS: Record<number, string> = {
  0: 'acoustic_grand_piano',
  1: 'bright_acoustic_piano',
  4: 'electric_piano_1',
  5: 'electric_piano_2',
  24: 'acoustic_guitar_nylon',
  25: 'acoustic_guitar_steel',
  26: 'electric_guitar_jazz',
  27: 'electric_guitar_clean',
  29: 'overdriven_guitar',
  30: 'distortion_guitar',
  32: 'acoustic_bass',
  33: 'electric_bass_finger',
  34: 'electric_bass_pick',
  35: 'fretless_bass',
  36: 'slap_bass_1',
  38: 'synth_bass_1',
  39: 'synth_bass_2',
  40: 'violin',
  41: 'viola',
  42: 'cello',
  48: 'string_ensemble_1',
  49: 'string_ensemble_2',
  50: 'synth_strings_1',
  52: 'choir_aahs',
  56: 'trumpet',
  57: 'trombone',
  61: 'brass_section',
  64: 'soprano_sax',
  65: 'alto_sax',
  66: 'tenor_sax',
  73: 'flute',
  80: 'lead_1_square',
  81: 'lead_2_sawtooth',
  88: 'pad_1_new_age',
  89: 'pad_2_warm',
  90: 'pad_3_polysynth',
};

export class MidiMusicPlayer {
  private config: MidiPlayerConfig;
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private player: MidiPlayer.Player | null = null;
  private instruments: Map<number, SoundfontPlayer> = new Map();
  private drums: SoundfontPlayer | null = null;
  private channelPrograms: Map<number, number> = new Map(); // Track program changes per channel
  private isPlaying: boolean = false;
  private isLoaded: boolean = false;
  private currentMidiData: ArrayBuffer | null = null;
  private instrumentsLoading: Set<number> = new Set();

  constructor(config: Partial<MidiPlayerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize audio context (must be called after user interaction)
   */
  async initialize(): Promise<void> {
    if (this.audioContext) return;

    this.audioContext = new AudioContext();
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = this.config.volume;
    this.gainNode.connect(this.audioContext.destination);

    // Load a full General MIDI instrument set

    // All instruments we want to load with their GM program numbers
    const instrumentsToLoad: [number, string, number][] = [
      // Pianos (0-7)
      [0, 'acoustic_grand_piano', 0.8],
      [1, 'bright_acoustic_piano', 0.8],
      [4, 'electric_piano_1', 0.8],
      [5, 'electric_piano_2', 0.8],

      // Guitars (24-31)
      [24, 'acoustic_guitar_nylon', 0.7],
      [25, 'acoustic_guitar_steel', 0.7],
      [26, 'electric_guitar_jazz', 0.7],
      [27, 'electric_guitar_clean', 0.8],
      [29, 'overdriven_guitar', 0.9],
      [30, 'distortion_guitar', 0.9],

      // Bass (32-39)
      [32, 'acoustic_bass', 1.0],
      [33, 'electric_bass_finger', 1.0],
      [34, 'electric_bass_pick', 1.0],
      [35, 'fretless_bass', 1.0],
      [36, 'slap_bass_1', 1.0],
      [38, 'synth_bass_1', 1.0],
      [39, 'synth_bass_2', 1.0],

      // Strings (40-51)
      [40, 'violin', 0.7],
      [41, 'viola', 0.7],
      [42, 'cello', 0.7],
      [48, 'string_ensemble_1', 0.7],
      [49, 'string_ensemble_2', 0.7],
      [50, 'synth_strings_1', 0.7],

      // Choir (52-54)
      [52, 'choir_aahs', 0.6],

      // Brass (56-63)
      [56, 'trumpet', 0.8],
      [57, 'trombone', 0.8],
      [61, 'brass_section', 0.8],

      // Sax (64-67)
      [65, 'alto_sax', 0.8],
      [66, 'tenor_sax', 0.8],

      // Flute/Pipe (72-79)
      [73, 'flute', 0.7],

      // Synth Lead (80-87)
      [80, 'lead_1_square', 0.7],
      [81, 'lead_2_sawtooth', 0.7],

      // Synth Pad (88-95)
      [88, 'pad_1_new_age', 0.6],
      [89, 'pad_2_warm', 0.6],
      [90, 'pad_3_polysynth', 0.6],

      // Organ (16-23)
      [16, 'drawbar_organ', 0.7],
      [17, 'percussive_organ', 0.7],
      [18, 'rock_organ', 0.8],
      [19, 'church_organ', 0.7],
    ];

    try {
      // Load instruments in batches to avoid overwhelming the browser
      const batchSize = 8;
      for (let i = 0; i < instrumentsToLoad.length; i += batchSize) {
        const batch = instrumentsToLoad.slice(i, i + batchSize);
        await Promise.all(batch.map(async ([program, name, gain]) => {
          try {
            const inst = await Soundfont.instrument(this.audioContext!, name, {
              gain: gain,
              destination: this.gainNode!,
            });
            this.instruments.set(program, inst);
          } catch {
            // Failed to load instrument, will use fallback
          }
        }));
      }

      // Load drums separately (for channel 9/10)
      try {
        this.drums = await Soundfont.instrument(this.audioContext, 'synth_drum', {
          gain: 1.3,
          destination: this.gainNode,
        });
      } catch {
        // Failed to load drums
      }

    } catch {
      // Failed to load some soundfonts
    }
  }

  /**
   * Load a MIDI file from URL
   */
  async loadUrl(url: string): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch MIDI: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      await this.loadArrayBuffer(arrayBuffer);
    } catch (err) {
      this.config.onError?.(err as Error);
    }
  }

  /**
   * Load a MIDI file from ArrayBuffer
   */
  async loadArrayBuffer(buffer: ArrayBuffer): Promise<void> {
    await this.initialize();

    this.currentMidiData = buffer;

    // Create player
    this.player = new MidiPlayer.Player();

    // Set up event handlers
    this.player.on('midiEvent', (event: MidiPlayer.Event) => {
      this.handleMidiEvent(event);
    });

    this.player.on('endOfFile', () => {
      this.isPlaying = false;

      if (this.config.loop && this.currentMidiData) {
        // Reload and restart for looping
        setTimeout(() => {
          if (this.config.loop) {
            this.player?.loadArrayBuffer(this.currentMidiData!);
            this.player?.play();
            this.isPlaying = true;
          }
        }, 100);
      } else {
        this.config.onPlayEnd?.();
      }
    });

    // Load the MIDI data
    this.player.loadArrayBuffer(buffer);
    this.isLoaded = true;
  }

  /**
   * Load MIDI from a File object
   */
  async loadFile(file: File): Promise<void> {
    const buffer = await file.arrayBuffer();
    await this.loadArrayBuffer(buffer);
  }

  /**
   * Start playback
   */
  play(): void {
    if (!this.player || !this.isLoaded) {
      return;
    }

    // Resume audio context if suspended (browser autoplay policy)
    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume();
    }

    this.player.play();
    this.isPlaying = true;
    this.config.onPlayStart?.();
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (this.player && this.isPlaying) {
      this.player.pause();
      this.isPlaying = false;
    }
  }

  /**
   * Stop playback and reset
   */
  stop(): void {
    if (this.player) {
      this.player.stop();
      this.isPlaying = false;
    }
  }

  /**
   * Set volume (0.0 to 1.0)
   */
  setVolume(volume: number): void {
    this.config.volume = Math.max(0, Math.min(1, volume));
    if (this.gainNode) {
      this.gainNode.gain.value = this.config.volume;
    }
  }

  /**
   * Get current volume
   */
  getVolume(): number {
    return this.config.volume;
  }

  /**
   * Check if currently playing
   */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Check if a MIDI is loaded
   */
  getIsLoaded(): boolean {
    return this.isLoaded;
  }

  /**
   * Set loop mode
   */
  setLoop(loop: boolean): void {
    this.config.loop = loop;
  }

  /**
   * Smoothly fade volume to a new level
   */
  fadeVolume(targetVolume: number, durationMs: number = 500): Promise<void> {
    return new Promise((resolve) => {
      if (!this.gainNode || !this.audioContext) {
        this.config.volume = targetVolume;
        resolve();
        return;
      }

      const startVolume = this.gainNode.gain.value;
      const startTime = this.audioContext.currentTime;
      const endTime = startTime + durationMs / 1000;

      this.gainNode.gain.setValueAtTime(startVolume, startTime);
      this.gainNode.gain.linearRampToValueAtTime(targetVolume, endTime);
      this.config.volume = targetVolume;

      setTimeout(resolve, durationMs);
    });
  }

  /**
   * Switch to a different MIDI track with optional crossfade
   */
  async switchTrack(url: string, volume?: number, fadeMs: number = 300): Promise<void> {
    // Fade out current track
    if (this.isPlaying) {
      await this.fadeVolume(0, fadeMs);
      this.stop();
    }

    // Load new track
    await this.loadUrl(url);

    // Set new volume and fade in
    const targetVolume = volume ?? this.config.volume;
    if (this.gainNode) {
      this.gainNode.gain.value = 0;
    }
    this.play();
    await this.fadeVolume(targetVolume, fadeMs);
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stop();
    this.player = null;
    this.instruments.clear();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.gainNode = null;
    this.isLoaded = false;
    this.currentMidiData = null;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private handleMidiEvent(event: MidiPlayer.Event): void {
    // midi-player-js uses 1-indexed channels, convert to 0-indexed
    const channel = ((event.channel ?? 1) - 1);

    // Handle program change (instrument selection)
    if (event.name === 'Program Change') {
      const extEvent = event as unknown as { value?: number; program?: number };
      const program = extEvent.value ?? extEvent.program ?? 0;
      this.channelPrograms.set(channel, program);
      // Dynamically load instrument if not already loaded
      this.ensureInstrumentLoaded(program);
      return;
    }

    // Handle note on/off events
    if (event.name === 'Note on' && event.velocity && event.velocity > 0) {
      this.playNote(event.noteNumber!, event.velocity, channel);
    } else if (event.name === 'Note off' || (event.name === 'Note on' && event.velocity === 0)) {
      this.stopNote(event.noteNumber!, channel);
    }
  }

  private async ensureInstrumentLoaded(program: number): Promise<void> {
    // Skip if already loaded or loading
    if (this.instruments.has(program) || this.instrumentsLoading.has(program)) {
      return;
    }

    const instrumentName = GM_INSTRUMENTS[program];
    if (!instrumentName || !this.audioContext || !this.gainNode) {
      return;
    }

    this.instrumentsLoading.add(program);
    try {
      const inst = await Soundfont.instrument(this.audioContext, instrumentName, {
        gain: 0.8,
        destination: this.gainNode,
      });
      this.instruments.set(program, inst);
    } catch {
      // Failed to load instrument
    } finally {
      this.instrumentsLoading.delete(program);
    }
  }

  private playNote(noteNumber: number, velocity: number, channel: number): void {
    const gain = (velocity / 127) * this.config.volume;

    // Channel 9 (0-indexed, = MIDI channel 10) is always drums in General MIDI
    if (channel === 9) {
      if (this.drums) {
        // For drums, map MIDI note to drum sound
        // GM drum map: 35=kick, 38=snare, 42=hihat closed, 46=hihat open, 49=crash, etc.
        const noteName = this.midiNoteToName(noteNumber);
        try {
          this.drums.play(noteName, this.audioContext!.currentTime, {
            gain: gain * 1.5, // Boost drums
            duration: 0.3,
          });
        } catch {
          // Ignore drum errors
        }
      }
      return;
    }

    // Get the program for this channel, default to piano (0)
    const program = this.channelPrograms.get(channel) ?? 0;

    // Try to find the exact instrument, or find a suitable fallback
    let instrument = this.instruments.get(program);

    // Fallback logic for instrument families
    if (!instrument) {
      // Bass instruments (32-39) -> use any available bass
      if (program >= 32 && program <= 39) {
        instrument = this.instruments.get(33) ?? this.instruments.get(38);
      }
      // String instruments (40-51) -> use string ensemble
      else if (program >= 40 && program <= 51) {
        instrument = this.instruments.get(48);
      }
      // Pads (88-95) -> use warm pad
      else if (program >= 88 && program <= 95) {
        instrument = this.instruments.get(89);
      }
      // Default fallback to piano
      if (!instrument) {
        instrument = this.instruments.get(0);
      }
    }

    if (!instrument) return;

    const noteName = this.midiNoteToName(noteNumber);

    try {
      instrument.play(noteName, this.audioContext!.currentTime, {
        gain: gain,
        duration: 2, // Default duration
      });
    } catch {
      // Ignore note errors
    }
  }

  private stopNote(_noteNumber: number, _channel: number): void {
    // Soundfont-player handles note duration internally
    // For more accurate note-off, we'd need to track active notes
  }

  private midiNoteToName(noteNumber: number): string {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(noteNumber / 12) - 1;
    const note = noteNames[noteNumber % 12];
    return `${note}${octave}`;
  }
}
