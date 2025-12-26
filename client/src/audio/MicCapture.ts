/**
 * Push-to-talk microphone capture
 * Records audio while a key is held, sends to STT when released
 */

export interface MicCaptureConfig {
  pushToTalkKey: string; // Key to hold for recording (default: 'v')
  sampleRate: number; // Audio sample rate (default: 16000 for Whisper)
  onRecordingStart?: () => void;
  onRecordingStop?: (audioBlob: Blob) => void;
  onError?: (error: Error) => void;
}

const DEFAULT_CONFIG: MicCaptureConfig = {
  pushToTalkKey: 'v',
  sampleRate: 16000,
};

export class MicCapture {
  private config: MicCaptureConfig;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private isRecording: boolean = false;
  private stream: MediaStream | null = null;
  private isInitialized: boolean = false;

  constructor(config: Partial<MicCaptureConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setupKeyListeners();
  }

  /**
   * Initialize microphone access (call on first user interaction)
   */
  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.config.sampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      this.isInitialized = true;
      console.log('Microphone initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize microphone:', error);
      this.config.onError?.(error as Error);
      return false;
    }
  }

  /**
   * Check if currently recording
   */
  getIsRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Check if initialized
   */
  getIsInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Manually start recording (alternative to push-to-talk key)
   */
  async startRecording(): Promise<void> {
    if (this.isRecording) return;
    if (!this.isInitialized) {
      const success = await this.initialize();
      if (!success) return;
    }

    if (!this.stream) return;

    this.audioChunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType: this.getSupportedMimeType(),
    });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = () => {
      const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
      this.config.onRecordingStop?.(audioBlob);
    };

    this.mediaRecorder.start(100); // Collect data every 100ms
    this.isRecording = true;
    this.config.onRecordingStart?.();
    console.log('Recording started');
  }

  /**
   * Stop recording and trigger callback with audio blob
   */
  stopRecording(): void {
    if (!this.isRecording || !this.mediaRecorder) return;

    this.mediaRecorder.stop();
    this.isRecording = false;
    console.log('Recording stopped');
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.isInitialized = false;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupKeyListeners(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    // Ignore if typing in an input
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    if (e.key.toLowerCase() === this.config.pushToTalkKey && !this.isRecording) {
      e.preventDefault();
      this.startRecording();
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (e.key.toLowerCase() === this.config.pushToTalkKey && this.isRecording) {
      this.stopRecording();
    }
  };

  private getSupportedMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return 'audio/webm'; // Fallback
  }
}
