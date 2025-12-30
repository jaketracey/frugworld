/**
 * LegacyAudio - Wrapper for MidiMusicPlayer with consistent interface for MusicManager
 * Uses MidiMusicPlayer for MIDI playback with Web Audio API
 */

import * as Tone from 'tone';
import { MidiMusicPlayer } from './MidiPlayer';

// Default MIDI file path for legacy background music
const DEFAULT_MIDI_PATH = '/music/theme.mid';

export class LegacyAudio {
  private midiPlayer: MidiMusicPlayer;
  private initialized: boolean = false;
  private ready: boolean = false;
  private targetVolume: number = 0.6; // Store target volume (0-1)
  private currentFadeCallback: (() => void) | null = null;

  constructor() {
    this.midiPlayer = new MidiMusicPlayer({
      volume: this.targetVolume,
      loop: true,
      onPlayStart: () => {
        // Playback started
      },
      onPlayEnd: () => {
        // Playback ended
      },
      onError: (error: Error) => {
        console.error('[LegacyAudio] MIDI playback error:', error);
      },
    });
  }

  /**
   * Initialize the audio system
   * Must be called after a user gesture due to browser autoplay policies
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Start Tone.js audio context (requires user gesture)
      await Tone.start();

      // Initialize the MIDI player
      await this.midiPlayer.initialize();

      // Load the default MIDI file
      try {
        await this.midiPlayer.loadUrl(DEFAULT_MIDI_PATH);
        this.ready = true;
      } catch (error) {
        console.warn('[LegacyAudio] Failed to load default MIDI file:', error);
        // Still mark as initialized even if default file fails to load
        // The player can still be used with other MIDI files
      }

      this.initialized = true;
    } catch (error) {
      console.error('[LegacyAudio] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Start music playback
   */
  start(): void {
    if (!this.initialized) {
      console.warn('[LegacyAudio] Cannot start - not initialized. Call init() first.');
      return;
    }

    // Resume Tone.js context if suspended
    if (Tone.context.state === 'suspended') {
      Tone.context.resume();
    }

    this.midiPlayer.play();
  }

  /**
   * Stop music playback
   */
  stop(): void {
    this.midiPlayer.stop();
  }

  /**
   * Fade volume in over specified duration
   * @param duration - Fade duration in seconds
   */
  fadeIn(duration: number): void {
    // Start from silent, then fade to target volume using MIDI player's fade
    this.midiPlayer.setVolume(0);
    this.midiPlayer.fadeVolume(this.targetVolume, duration * 1000);
  }

  /**
   * Fade volume out over specified duration with optional callback
   * @param duration - Fade duration in seconds
   * @param callback - Optional callback to execute when fade completes
   */
  fadeOut(duration: number, callback?: () => void): void {
    // Cancel any pending fade callback
    this.currentFadeCallback = null;

    // Fade to silent using MIDI player's fade
    this.midiPlayer.fadeVolume(0, duration * 1000).then(() => {
      if (callback) {
        callback();
      }
    });

    // Also store callback for potential cancellation
    if (callback) {
      this.currentFadeCallback = callback;
    }
  }

  /**
   * Set the volume level
   * @param volume - Volume level from 0 to 1
   */
  setVolume(volume: number): void {
    this.targetVolume = Math.max(0, Math.min(1, volume));
    // Update the MIDI player's volume directly
    this.midiPlayer.setVolume(this.targetVolume);
  }

  /**
   * Get the current volume level
   * @returns Volume level from 0 to 1
   */
  getVolume(): number {
    return this.targetVolume;
  }

  /**
   * Check if the audio system is ready for playback
   * @returns true if initialized and MIDI is loaded
   */
  isReady(): boolean {
    return this.initialized && this.ready;
  }

  /**
   * Load a different MIDI file
   * @param url - URL of the MIDI file to load
   */
  async loadMidi(url: string): Promise<void> {
    await this.midiPlayer.loadUrl(url);
    this.ready = true;
  }

  /**
   * Switch to a different MIDI track with crossfade
   * @param url - URL of the MIDI file to switch to
   * @param volume - Optional volume level (0-1)
   * @param fadeMs - Fade duration in milliseconds (default 300)
   */
  async switchTrack(url: string, volume?: number, fadeMs: number = 300): Promise<void> {
    if (volume !== undefined) {
      this.targetVolume = Math.max(0, Math.min(1, volume));
    }
    await this.midiPlayer.switchTrack(url, this.targetVolume, fadeMs);
    this.ready = true;
  }

  /**
   * Check if the player is currently playing
   */
  isPlaying(): boolean {
    return this.midiPlayer.getIsPlaying();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.midiPlayer.destroy();
    this.initialized = false;
    this.ready = false;
    this.currentFadeCallback = null;
  }
}
