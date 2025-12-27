/**
 * LegacyAudio - Wrapper for MidiMusicPlayer with consistent interface for MusicManager
 * Uses Tone.js Volume node for smooth fading capabilities
 */

import * as Tone from 'tone';
import { MidiMusicPlayer } from './MidiPlayer';

// Default MIDI file path for legacy ambient music
const DEFAULT_MIDI_PATH = '/music/ambient.mid';

export class LegacyAudio {
  private midiPlayer: MidiMusicPlayer;
  private volumeNode: Tone.Volume | null = null;
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

      // Create Tone.js Volume node for smooth fading
      // Convert linear volume (0-1) to decibels for Tone.js
      this.volumeNode = new Tone.Volume(this.linearToDb(this.targetVolume));
      this.volumeNode.toDestination();

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
    if (!this.volumeNode) {
      // Fallback: just set volume immediately
      this.midiPlayer.setVolume(this.targetVolume);
      return;
    }

    const now = Tone.now();
    const targetDb = this.linearToDb(this.targetVolume);

    // Start from silent
    this.volumeNode.volume.setValueAtTime(-Infinity, now);
    // Ramp to target volume
    this.volumeNode.volume.linearRampToValueAtTime(targetDb, now + duration);

    // Also update MIDI player's internal volume to match
    this.midiPlayer.setVolume(this.targetVolume);
  }

  /**
   * Fade volume out over specified duration with optional callback
   * @param duration - Fade duration in seconds
   * @param callback - Optional callback to execute when fade completes
   */
  fadeOut(duration: number, callback?: () => void): void {
    if (!this.volumeNode) {
      // Fallback: just set volume to 0 immediately
      this.midiPlayer.setVolume(0);
      if (callback) {
        callback();
      }
      return;
    }

    // Cancel any pending fade callback
    this.currentFadeCallback = null;

    const now = Tone.now();
    const currentDb = this.volumeNode.volume.value;

    // Start from current volume
    this.volumeNode.volume.setValueAtTime(currentDb, now);
    // Ramp to silent
    this.volumeNode.volume.linearRampToValueAtTime(-Infinity, now + duration);

    // Schedule callback execution
    if (callback) {
      this.currentFadeCallback = callback;
      setTimeout(() => {
        if (this.currentFadeCallback === callback) {
          this.currentFadeCallback = null;
          callback();
        }
      }, duration * 1000);
    }
  }

  /**
   * Set the volume level
   * @param volume - Volume level from 0 to 1
   */
  setVolume(volume: number): void {
    this.targetVolume = Math.max(0, Math.min(1, volume));

    if (this.volumeNode) {
      const db = this.linearToDb(this.targetVolume);
      this.volumeNode.volume.value = db;
    }

    // Also update the MIDI player's internal volume
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
   * Clean up resources
   */
  destroy(): void {
    this.midiPlayer.destroy();

    if (this.volumeNode) {
      this.volumeNode.dispose();
      this.volumeNode = null;
    }

    this.initialized = false;
    this.ready = false;
    this.currentFadeCallback = null;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Convert linear volume (0-1) to decibels for Tone.js
   * @param linear - Linear volume from 0 to 1
   * @returns Volume in decibels
   */
  private linearToDb(linear: number): number {
    if (linear <= 0) {
      return -Infinity;
    }
    // Convert linear to dB: 20 * log10(linear)
    return 20 * Math.log10(linear);
  }
}
