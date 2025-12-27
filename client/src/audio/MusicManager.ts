/**
 * MusicManager.ts
 *
 * Main orchestrator that manages both the legacy (MIDI) and generative audio systems.
 * Allows switching between music modes at runtime with crossfade transitions.
 */

import * as Tone from 'tone';
import { LegacyAudio } from './LegacyAudio';
import { AudioEngine, GraphState, RelationshipEvent, NPCState, PhysicsState } from './AudioEngine';

// ============================================================================
// Types and Interfaces
// ============================================================================

export type MusicMode = 'legacy' | 'generative';

export interface MusicManagerConfig {
  mode: MusicMode;
  volume: number;  // 0-1
  enabled: boolean;
}

// LocalStorage key for persisting mode preference
const STORAGE_KEY = 'frugworld_music_mode';

// Default configuration
const DEFAULT_CONFIG: MusicManagerConfig = {
  mode: 'legacy',
  volume: 0.6,
  enabled: true,
};

// ============================================================================
// MusicManager Class
// ============================================================================

export class MusicManager {
  private mode: MusicMode = 'legacy';
  private legacyAudio: LegacyAudio;
  private generativeAudio: AudioEngine;
  private crossfadeDuration: number = 2;  // seconds
  private isInitialized: boolean = false;
  private masterVolume: number = 0.6;     // 0-1 linear scale
  private enabled: boolean = true;
  private isPlaying: boolean = false;

  constructor() {
    this.legacyAudio = new LegacyAudio();
    this.generativeAudio = new AudioEngine();
  }

  // ============================================================================
  // Lifecycle Methods
  // ============================================================================

  /**
   * Initialize both audio systems and load saved preferences.
   * Must be called after a user gesture due to browser autoplay policies.
   */
  async init(): Promise<void> {
    if (this.isInitialized) {
      console.warn('[MusicManager] Already initialized');
      return;
    }

    try {
      // Start Tone.js audio context (requires user gesture)
      await Tone.start();
      console.log('[MusicManager] Audio context started');

      // Load saved mode preference from localStorage
      this.loadPreferences();

      // Initialize both audio systems in parallel
      await Promise.all([
        this.legacyAudio.init(),
        this.generativeAudio.init(),
      ]);

      // Apply saved volume to both systems
      this.applyVolumeToSystems();

      this.isInitialized = true;
      console.log(`[MusicManager] Initialized in ${this.mode} mode`);
    } catch (error) {
      console.error('[MusicManager] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Start music playback in the current mode
   */
  start(): void {
    if (!this.isInitialized) {
      console.warn('[MusicManager] Cannot start - not initialized. Call init() first.');
      return;
    }

    if (!this.enabled) {
      console.warn('[MusicManager] Cannot start - music is disabled');
      return;
    }

    if (this.isPlaying) {
      console.warn('[MusicManager] Already playing');
      return;
    }

    // Resume audio context if suspended
    if (Tone.context.state === 'suspended') {
      Tone.context.resume();
    }

    this.isPlaying = true;

    if (this.mode === 'legacy') {
      this.legacyAudio.start();
      this.legacyAudio.fadeIn(this.crossfadeDuration);
    } else {
      this.generativeAudio.start();
      this.generativeAudio.fadeIn(this.crossfadeDuration);
    }

    console.log(`[MusicManager] Started in ${this.mode} mode`);
  }

  /**
   * Stop both audio systems
   */
  stop(): void {
    if (!this.isPlaying) {
      return;
    }

    this.isPlaying = false;

    // Stop both systems
    this.legacyAudio.stop();
    this.generativeAudio.stop();

    console.log('[MusicManager] Stopped');
  }

  /**
   * Clean up all resources
   */
  dispose(): void {
    this.stop();

    // Dispose both audio systems
    this.legacyAudio.destroy();
    this.generativeAudio.dispose();

    this.isInitialized = false;
    console.log('[MusicManager] Disposed');
  }

  // ============================================================================
  // Mode Switching
  // ============================================================================

  /**
   * Switch between legacy and generative modes with crossfade
   */
  setMode(newMode: MusicMode): void {
    if (newMode === this.mode) {
      return;
    }

    const oldMode = this.mode;
    this.mode = newMode;

    // Save preference to localStorage
    this.savePreferences();

    console.log(`[MusicManager] Switching from ${oldMode} to ${newMode} mode`);

    // If not playing, just update the mode
    if (!this.isPlaying) {
      return;
    }

    // Crossfade between systems
    if (oldMode === 'legacy' && newMode === 'generative') {
      // Fade out legacy, fade in generative
      this.legacyAudio.fadeOut(this.crossfadeDuration, () => {
        this.legacyAudio.stop();
      });
      this.generativeAudio.start();
      this.generativeAudio.fadeIn(this.crossfadeDuration);
    } else if (oldMode === 'generative' && newMode === 'legacy') {
      // Fade out generative, fade in legacy
      this.generativeAudio.fadeOut(this.crossfadeDuration, () => {
        this.generativeAudio.stop();
      });
      this.legacyAudio.start();
      this.legacyAudio.fadeIn(this.crossfadeDuration);
    }
  }

  /**
   * Get the current music mode
   */
  getMode(): MusicMode {
    return this.mode;
  }

  // ============================================================================
  // Volume Control
  // ============================================================================

  /**
   * Set the master volume (0-1)
   */
  setVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    this.applyVolumeToSystems();
    this.savePreferences();
  }

  /**
   * Get the current master volume (0-1)
   */
  getVolume(): number {
    return this.masterVolume;
  }

  /**
   * Enable or disable music playback
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }

    this.enabled = enabled;
    this.savePreferences();

    if (!enabled && this.isPlaying) {
      // Fade out and stop
      if (this.mode === 'legacy') {
        this.legacyAudio.fadeOut(this.crossfadeDuration, () => {
          this.stop();
        });
      } else {
        this.generativeAudio.fadeOut(this.crossfadeDuration, () => {
          this.stop();
        });
      }
    }

    console.log(`[MusicManager] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  /**
   * Check if music is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  // ============================================================================
  // State Update Handlers (forwarded to generative system)
  // ============================================================================

  /**
   * Forward graph state updates to the generative audio system
   * Only processes updates when in generative mode
   */
  onGraphStateUpdate(state: GraphState): void {
    if (this.mode === 'generative' && this.isPlaying) {
      this.generativeAudio.onGraphStateUpdate(state);
    }
  }

  /**
   * Forward relationship change events to the generative audio system
   * Only processes updates when in generative mode
   */
  onRelationshipChange(event: RelationshipEvent): void {
    if (this.mode === 'generative' && this.isPlaying) {
      this.generativeAudio.onRelationshipChange(event);
    }
  }

  /**
   * Forward NPC state updates to the generative audio system
   * Only processes updates when in generative mode
   */
  onNPCUpdate(npc: NPCState): void {
    if (this.mode === 'generative' && this.isPlaying) {
      this.generativeAudio.onNPCUpdate(npc);
    }
  }

  /**
   * Forward physics state updates to the generative audio system
   * Only processes updates when in generative mode
   */
  onPhysicsUpdate(physics: PhysicsState): void {
    if (this.mode === 'generative' && this.isPlaying) {
      this.generativeAudio.onPhysicsUpdate(physics);
    }
  }

  // ============================================================================
  // Configuration Access
  // ============================================================================

  /**
   * Get the current configuration
   */
  getConfig(): MusicManagerConfig {
    return {
      mode: this.mode,
      volume: this.masterVolume,
      enabled: this.enabled,
    };
  }

  /**
   * Check if the manager is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Get the crossfade duration in seconds
   */
  getCrossfadeDuration(): number {
    return this.crossfadeDuration;
  }

  /**
   * Set the crossfade duration in seconds
   */
  setCrossfadeDuration(duration: number): void {
    this.crossfadeDuration = Math.max(0.5, Math.min(10, duration));
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Apply the master volume to both audio systems
   */
  private applyVolumeToSystems(): void {
    // Legacy audio uses linear volume (0-1)
    this.legacyAudio.setVolume(this.masterVolume);

    // Generative audio uses dB (-60 to 0)
    // Convert linear to dB: -60 + (volume * 60)
    const dbVolume = this.masterVolume <= 0 ? -60 : -60 + (this.masterVolume * 60);
    this.generativeAudio.setMasterVolume(dbVolume);
  }

  /**
   * Load preferences from localStorage
   */
  private loadPreferences(): void {
    try {
      const savedMode = localStorage.getItem(STORAGE_KEY);
      if (savedMode === 'legacy' || savedMode === 'generative') {
        this.mode = savedMode;
      }

      const savedVolume = localStorage.getItem(`${STORAGE_KEY}_volume`);
      if (savedVolume !== null) {
        const volume = parseFloat(savedVolume);
        if (!isNaN(volume) && volume >= 0 && volume <= 1) {
          this.masterVolume = volume;
        }
      }

      const savedEnabled = localStorage.getItem(`${STORAGE_KEY}_enabled`);
      if (savedEnabled !== null) {
        this.enabled = savedEnabled === 'true';
      }

      console.log(`[MusicManager] Loaded preferences: mode=${this.mode}, volume=${this.masterVolume}, enabled=${this.enabled}`);
    } catch (error) {
      // localStorage might not be available (e.g., private browsing)
      console.warn('[MusicManager] Could not load preferences from localStorage:', error);
    }
  }

  /**
   * Save preferences to localStorage
   */
  private savePreferences(): void {
    try {
      localStorage.setItem(STORAGE_KEY, this.mode);
      localStorage.setItem(`${STORAGE_KEY}_volume`, this.masterVolume.toString());
      localStorage.setItem(`${STORAGE_KEY}_enabled`, this.enabled.toString());
    } catch (error) {
      // localStorage might not be available (e.g., private browsing)
      console.warn('[MusicManager] Could not save preferences to localStorage:', error);
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

// Export a singleton instance for easy use throughout the application
export const musicManager = new MusicManager();

export default MusicManager;
