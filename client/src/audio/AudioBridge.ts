/**
 * AudioBridge - Unified audio system for WASM graph-client
 *
 * Provides a bridge between the Rust WASM client and JavaScript audio APIs.
 * Wraps MidiPlayer for music, HTMLAudioElement for ambient/dialogue,
 * and Web Audio API for volume mixing.
 */

import { MidiMusicPlayer } from './MidiPlayer.ts';

export interface AudioBridgeConfig {
  masterVolume: number;
  musicVolume: number;
  ambientVolume: number;
  dialogueVolume: number;
}

const DEFAULT_CONFIG: AudioBridgeConfig = {
  masterVolume: 1.0,
  musicVolume: 0.6,
  ambientVolume: 0.5,
  dialogueVolume: 1.0,
};

/**
 * AudioBridge class that provides a unified interface for all audio in the game.
 * This is exposed on window.frugworldAudio for the Rust WASM client to call.
 */
export class AudioBridge {
  private config: AudioBridgeConfig;
  private initialized: boolean = false;

  // Audio context and gain nodes
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private dialogueGain: GainNode | null = null;

  // MIDI player for background music
  private midiPlayer: MidiMusicPlayer;
  private musicTracks: Map<string, string> = new Map(); // trackId -> url
  private currentMusicTrack: string | null = null;

  // Ambient audio (looping background sounds like forest, rain, etc.)
  private ambientAudio: HTMLAudioElement | null = null;
  private ambientMediaSource: MediaElementAudioSourceNode | null = null;
  private ambientTracks: Map<string, string> = new Map(); // biomeId -> url
  private currentAmbientBiome: string | null = null;
  private ambientFadeInterval: number | null = null;

  // Dialogue/TTS audio
  private dialogueAudio: HTMLAudioElement | null = null;
  private dialogueMediaSource: MediaElementAudioSourceNode | null = null;
  private dialogueQueue: string[] = [];
  private isPlayingDialogue: boolean = false;

  constructor(config: Partial<AudioBridgeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Create MIDI player (will be connected to audio graph on initialize)
    this.midiPlayer = new MidiMusicPlayer({
      volume: this.config.musicVolume,
      loop: true,
      onPlayStart: () => console.log('[AudioBridge] Music started'),
      onPlayEnd: () => console.log('[AudioBridge] Music ended'),
      onError: (err) => console.warn('[AudioBridge] Music error:', err),
    });
  }

  /**
   * Initialize the audio system.
   * Must be called after user interaction due to browser autoplay policies.
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) {
      return true;
    }

    try {
      // Create audio context
      this.audioContext = new AudioContext();

      // Resume if suspended (autoplay policy)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Create gain node hierarchy: master -> [music, ambient, dialogue]
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this.config.masterVolume;
      this.masterGain.connect(this.audioContext.destination);

      this.musicGain = this.audioContext.createGain();
      this.musicGain.gain.value = this.config.musicVolume;
      this.musicGain.connect(this.masterGain);

      this.ambientGain = this.audioContext.createGain();
      this.ambientGain.gain.value = this.config.ambientVolume;
      this.ambientGain.connect(this.masterGain);

      this.dialogueGain = this.audioContext.createGain();
      this.dialogueGain.gain.value = this.config.dialogueVolume;
      this.dialogueGain.connect(this.masterGain);

      // Initialize MIDI player
      await this.midiPlayer.initialize();

      // Create ambient audio element
      this.ambientAudio = new Audio();
      this.ambientAudio.loop = true;
      this.ambientMediaSource = this.audioContext.createMediaElementSource(this.ambientAudio);
      this.ambientMediaSource.connect(this.ambientGain);

      // Create dialogue audio element
      this.dialogueAudio = new Audio();
      this.dialogueAudio.loop = false;
      this.dialogueMediaSource = this.audioContext.createMediaElementSource(this.dialogueAudio);
      this.dialogueMediaSource.connect(this.dialogueGain);

      // Set up dialogue end handler for queue processing
      this.dialogueAudio.onended = () => {
        this.isPlayingDialogue = false;
        this.processDialogueQueue();
      };

      this.initialized = true;
      console.log('[AudioBridge] Initialized successfully');
      return true;
    } catch (err) {
      console.error('[AudioBridge] Failed to initialize:', err);
      return false;
    }
  }

  /**
   * Check if audio is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ===========================================================================
  // Music (MIDI) Controls
  // ===========================================================================

  /**
   * Load a music track from URL
   */
  async loadMusic(url: string, trackId: string): Promise<boolean> {
    try {
      // Store the URL for later playback
      this.musicTracks.set(trackId, url);
      console.log(`[AudioBridge] Music track "${trackId}" registered: ${url}`);
      return true;
    } catch (err) {
      console.error(`[AudioBridge] Failed to load music "${trackId}":`, err);
      return false;
    }
  }

  /**
   * Play a loaded music track with optional fade-in
   */
  async playMusic(trackId: string, fadeMs: number = 500): Promise<void> {
    const url = this.musicTracks.get(trackId);
    if (!url) {
      console.warn(`[AudioBridge] Music track "${trackId}" not loaded`);
      return;
    }

    // If same track is already playing, do nothing
    if (this.currentMusicTrack === trackId && this.midiPlayer.getIsPlaying()) {
      return;
    }

    // Switch to new track with crossfade
    await this.midiPlayer.switchTrack(url, this.config.musicVolume * this.config.masterVolume, fadeMs);
    this.currentMusicTrack = trackId;
    console.log(`[AudioBridge] Playing music: ${trackId}`);
  }

  /**
   * Stop music with optional fade-out
   */
  async stopMusic(fadeMs: number = 500): Promise<void> {
    if (!this.midiPlayer.getIsPlaying()) {
      return;
    }

    await this.midiPlayer.fadeVolume(0, fadeMs);
    this.midiPlayer.stop();
    this.currentMusicTrack = null;
    console.log('[AudioBridge] Music stopped');
  }

  /**
   * Pause music
   */
  pauseMusic(): void {
    this.midiPlayer.pause();
  }

  /**
   * Resume music
   */
  resumeMusic(): void {
    this.midiPlayer.play();
  }

  /**
   * Set music volume (0.0 to 1.0)
   */
  setMusicVolume(volume: number): void {
    this.config.musicVolume = Math.max(0, Math.min(1, volume));
    if (this.musicGain) {
      this.musicGain.gain.value = this.config.musicVolume;
    }
    this.midiPlayer.setVolume(this.config.musicVolume);
  }

  /**
   * Get music volume
   */
  getMusicVolume(): number {
    return this.config.musicVolume;
  }

  /**
   * Check if music is currently playing
   */
  isMusicPlaying(): boolean {
    return this.midiPlayer.getIsPlaying();
  }

  /**
   * Get current music track ID
   */
  getCurrentMusicTrack(): string | null {
    return this.currentMusicTrack;
  }

  // ===========================================================================
  // Ambient Audio Controls
  // ===========================================================================

  /**
   * Load an ambient track from URL
   */
  async loadAmbient(url: string, biomeId: string): Promise<boolean> {
    try {
      this.ambientTracks.set(biomeId, url);
      console.log(`[AudioBridge] Ambient track "${biomeId}" registered: ${url}`);
      return true;
    } catch (err) {
      console.error(`[AudioBridge] Failed to load ambient "${biomeId}":`, err);
      return false;
    }
  }

  /**
   * Play ambient audio for a biome with crossfade
   */
  async playAmbient(biomeId: string, crossfadeMs: number = 2000): Promise<void> {
    if (!this.ambientAudio || !this.ambientGain || !this.audioContext) {
      console.warn('[AudioBridge] Ambient audio not initialized');
      return;
    }

    const url = this.ambientTracks.get(biomeId);
    if (!url) {
      console.warn(`[AudioBridge] Ambient track "${biomeId}" not loaded`);
      return;
    }

    // If same biome is playing, do nothing
    if (this.currentAmbientBiome === biomeId && !this.ambientAudio.paused) {
      return;
    }

    // Clear any existing fade
    if (this.ambientFadeInterval !== null) {
      window.clearInterval(this.ambientFadeInterval);
      this.ambientFadeInterval = null;
    }

    // Fade out current ambient if playing
    if (!this.ambientAudio.paused && crossfadeMs > 0) {
      await this.fadeAmbientVolume(0, crossfadeMs / 2);
    }

    // Load and play new ambient
    this.ambientAudio.src = url;
    this.ambientAudio.volume = 0;
    this.currentAmbientBiome = biomeId;

    try {
      await this.ambientAudio.play();
      // Fade in
      await this.fadeAmbientVolume(this.config.ambientVolume, crossfadeMs / 2);
      console.log(`[AudioBridge] Playing ambient: ${biomeId}`);
    } catch (err) {
      console.warn('[AudioBridge] Failed to play ambient:', err);
    }
  }

  /**
   * Stop ambient audio with optional fade-out
   */
  async stopAmbient(fadeMs: number = 1000): Promise<void> {
    if (!this.ambientAudio || this.ambientAudio.paused) {
      return;
    }

    await this.fadeAmbientVolume(0, fadeMs);
    this.ambientAudio.pause();
    this.ambientAudio.currentTime = 0;
    this.currentAmbientBiome = null;
    console.log('[AudioBridge] Ambient stopped');
  }

  /**
   * Set ambient volume (0.0 to 1.0)
   */
  setAmbientVolume(volume: number): void {
    this.config.ambientVolume = Math.max(0, Math.min(1, volume));
    if (this.ambientGain) {
      this.ambientGain.gain.value = this.config.ambientVolume;
    }
    if (this.ambientAudio) {
      this.ambientAudio.volume = this.config.ambientVolume;
    }
  }

  /**
   * Get ambient volume
   */
  getAmbientVolume(): number {
    return this.config.ambientVolume;
  }

  /**
   * Get current ambient biome
   */
  getCurrentAmbientBiome(): string | null {
    return this.currentAmbientBiome;
  }

  /**
   * Fade ambient volume
   */
  private fadeAmbientVolume(targetVolume: number, durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.ambientAudio || durationMs <= 0) {
        if (this.ambientAudio) {
          this.ambientAudio.volume = targetVolume;
        }
        resolve();
        return;
      }

      const startVolume = this.ambientAudio.volume;
      const startTime = Date.now();
      const volumeDiff = targetVolume - startVolume;

      if (this.ambientFadeInterval !== null) {
        window.clearInterval(this.ambientFadeInterval);
      }

      this.ambientFadeInterval = window.setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(1, elapsed / durationMs);

        if (this.ambientAudio) {
          this.ambientAudio.volume = startVolume + volumeDiff * progress;
        }

        if (progress >= 1) {
          if (this.ambientFadeInterval !== null) {
            window.clearInterval(this.ambientFadeInterval);
            this.ambientFadeInterval = null;
          }
          resolve();
        }
      }, 16); // ~60fps
    });
  }

  // ===========================================================================
  // Dialogue/TTS Controls
  // ===========================================================================

  /**
   * Play dialogue audio from URL (queues if another is playing)
   */
  async playDialogue(audioUrl: string): Promise<void> {
    if (!this.dialogueAudio) {
      console.warn('[AudioBridge] Dialogue audio not initialized');
      return;
    }

    // Add to queue
    this.dialogueQueue.push(audioUrl);

    // If not currently playing, start playing
    if (!this.isPlayingDialogue) {
      this.processDialogueQueue();
    }
  }

  /**
   * Play dialogue from a blob (e.g., TTS response)
   */
  async playDialogueBlob(blob: Blob): Promise<void> {
    const url = URL.createObjectURL(blob);
    await this.playDialogue(url);

    // Clean up blob URL after playback
    if (this.dialogueAudio) {
      const cleanup = () => {
        URL.revokeObjectURL(url);
        this.dialogueAudio?.removeEventListener('ended', cleanup);
      };
      this.dialogueAudio.addEventListener('ended', cleanup);
    }
  }

  /**
   * Stop current dialogue and clear queue
   */
  stopDialogue(): void {
    if (this.dialogueAudio) {
      this.dialogueAudio.pause();
      this.dialogueAudio.currentTime = 0;
    }
    this.dialogueQueue = [];
    this.isPlayingDialogue = false;
    console.log('[AudioBridge] Dialogue stopped');
  }

  /**
   * Set dialogue volume (0.0 to 1.0)
   */
  setDialogueVolume(volume: number): void {
    this.config.dialogueVolume = Math.max(0, Math.min(1, volume));
    if (this.dialogueGain) {
      this.dialogueGain.gain.value = this.config.dialogueVolume;
    }
  }

  /**
   * Get dialogue volume
   */
  getDialogueVolume(): number {
    return this.config.dialogueVolume;
  }

  /**
   * Check if dialogue is playing
   */
  isDialoguePlaying(): boolean {
    return this.isPlayingDialogue;
  }

  /**
   * Process the dialogue queue
   */
  private async processDialogueQueue(): Promise<void> {
    if (this.dialogueQueue.length === 0 || !this.dialogueAudio) {
      this.isPlayingDialogue = false;
      return;
    }

    const url = this.dialogueQueue.shift()!;
    this.isPlayingDialogue = true;
    this.dialogueAudio.src = url;

    try {
      await this.dialogueAudio.play();
    } catch (err) {
      console.warn('[AudioBridge] Failed to play dialogue:', err);
      this.isPlayingDialogue = false;
      // Try next in queue
      this.processDialogueQueue();
    }
  }

  // ===========================================================================
  // Master Volume Controls
  // ===========================================================================

  /**
   * Set master volume (0.0 to 1.0) - affects all audio
   */
  setMasterVolume(volume: number): void {
    this.config.masterVolume = Math.max(0, Math.min(1, volume));
    if (this.masterGain) {
      this.masterGain.gain.value = this.config.masterVolume;
    }
  }

  /**
   * Get master volume
   */
  getMasterVolume(): number {
    return this.config.masterVolume;
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Mute all audio
   */
  muteAll(): void {
    if (this.masterGain) {
      this.masterGain.gain.value = 0;
    }
  }

  /**
   * Unmute all audio (restore to config volume)
   */
  unmuteAll(): void {
    if (this.masterGain) {
      this.masterGain.gain.value = this.config.masterVolume;
    }
  }

  /**
   * Get all volume settings
   */
  getVolumes(): AudioBridgeConfig {
    return { ...this.config };
  }

  /**
   * Set all volumes at once
   */
  setVolumes(config: Partial<AudioBridgeConfig>): void {
    if (config.masterVolume !== undefined) {
      this.setMasterVolume(config.masterVolume);
    }
    if (config.musicVolume !== undefined) {
      this.setMusicVolume(config.musicVolume);
    }
    if (config.ambientVolume !== undefined) {
      this.setAmbientVolume(config.ambientVolume);
    }
    if (config.dialogueVolume !== undefined) {
      this.setDialogueVolume(config.dialogueVolume);
    }
  }

  /**
   * Resume audio context if suspended (call on user interaction)
   */
  async resumeContext(): Promise<void> {
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume();
      console.log('[AudioBridge] Audio context resumed');
    }
  }

  /**
   * Clean up all resources
   */
  destroy(): void {
    // Stop all audio
    this.midiPlayer.destroy();

    if (this.ambientAudio) {
      this.ambientAudio.pause();
      this.ambientAudio.src = '';
    }

    if (this.dialogueAudio) {
      this.dialogueAudio.pause();
      this.dialogueAudio.src = '';
    }

    // Clear intervals
    if (this.ambientFadeInterval !== null) {
      window.clearInterval(this.ambientFadeInterval);
    }

    // Close audio context
    if (this.audioContext) {
      this.audioContext.close();
    }

    this.initialized = false;
    console.log('[AudioBridge] Destroyed');
  }
}
