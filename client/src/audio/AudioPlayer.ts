/**
 * Audio player for TTS playback
 * Plays audio from blobs or URLs
 */

export interface AudioPlayerConfig {
  volume: number; // 0.0 to 1.0
  onPlayStart?: () => void;
  onPlayEnd?: () => void;
  onError?: (error: Error) => void;
}

const DEFAULT_CONFIG: AudioPlayerConfig = {
  volume: 1.0,
};

export class AudioPlayer {
  private config: AudioPlayerConfig;
  private audioElement: HTMLAudioElement;
  private currentUrl: string | null = null;
  private isPlaying: boolean = false;

  constructor(config: Partial<AudioPlayerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.audioElement = new Audio();
    this.audioElement.volume = this.config.volume;

    this.setupEventListeners();
  }

  /**
   * Play audio from a Blob (e.g., from TTS response)
   */
  playBlob(blob: Blob): void {
    // Clean up previous URL if exists
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
    }

    this.currentUrl = URL.createObjectURL(blob);
    this.audioElement.src = this.currentUrl;
    this.audioElement.play().catch((error) => {
      console.error('Failed to play audio:', error);
      this.config.onError?.(error);
    });
  }

  /**
   * Play audio from a URL
   */
  playUrl(url: string): void {
    // Clean up previous blob URL if exists
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }

    this.audioElement.src = url;
    this.audioElement.play().catch((error) => {
      console.error('Failed to play audio:', error);
      this.config.onError?.(error);
    });
  }

  /**
   * Play audio from an ArrayBuffer
   */
  playArrayBuffer(buffer: ArrayBuffer, mimeType: string = 'audio/mpeg'): void {
    const blob = new Blob([buffer], { type: mimeType });
    this.playBlob(blob);
  }

  /**
   * Stop current playback
   */
  stop(): void {
    this.audioElement.pause();
    this.audioElement.currentTime = 0;
  }

  /**
   * Pause current playback
   */
  pause(): void {
    this.audioElement.pause();
  }

  /**
   * Resume paused playback
   */
  resume(): void {
    this.audioElement.play().catch((error) => {
      console.error('Failed to resume audio:', error);
      this.config.onError?.(error);
    });
  }

  /**
   * Set volume (0.0 to 1.0)
   */
  setVolume(volume: number): void {
    this.config.volume = Math.max(0, Math.min(1, volume));
    this.audioElement.volume = this.config.volume;
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
   * Cleanup resources
   */
  destroy(): void {
    this.stop();
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupEventListeners(): void {
    this.audioElement.onplay = () => {
      this.isPlaying = true;
      this.config.onPlayStart?.();
    };

    this.audioElement.onended = () => {
      this.isPlaying = false;
      this.config.onPlayEnd?.();
    };

    this.audioElement.onpause = () => {
      this.isPlaying = false;
    };

    this.audioElement.onerror = () => {
      this.isPlaying = false;
      const error = new Error('Audio playback error');
      console.error('Audio error:', this.audioElement.error);
      this.config.onError?.(error);
    };
  }
}
