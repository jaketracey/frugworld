/**
 * Voice Chat Service
 * Orchestrates push-to-talk recording, STT, and TTS playback
 */

import { MicCapture } from './MicCapture.ts';
import { AudioPlayer } from './AudioPlayer.ts';

export interface VoiceChatConfig {
  aiServiceUrl: string;
  pushToTalkKey: string;
  onTranscription?: (text: string) => void;
  onRecordingStart?: () => void;
  onRecordingStop?: () => void;
  onSpeakingStart?: () => void;
  onSpeakingStop?: () => void;
  onError?: (error: Error) => void;
}

const DEFAULT_CONFIG: VoiceChatConfig = {
  aiServiceUrl: 'http://localhost:3002',
  pushToTalkKey: 'v',
};

export class VoiceChatService {
  private config: VoiceChatConfig;
  private micCapture: MicCapture;
  private audioPlayer: AudioPlayer;
  private isEnabled: boolean = false;

  constructor(config: Partial<VoiceChatConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.micCapture = new MicCapture({
      pushToTalkKey: this.config.pushToTalkKey,
      onRecordingStart: () => {
        console.log('[VoiceChat] Recording started');
        this.config.onRecordingStart?.();
      },
      onRecordingStop: async (audioBlob) => {
        console.log('[VoiceChat] Recording stopped, transcribing...');
        this.config.onRecordingStop?.();
        await this.transcribeAudio(audioBlob);
      },
      onError: (error) => {
        console.error('[VoiceChat] Mic error:', error);
        this.config.onError?.(error);
      },
    });

    this.audioPlayer = new AudioPlayer({
      onPlayStart: () => {
        console.log('[VoiceChat] NPC speaking');
        this.config.onSpeakingStart?.();
      },
      onPlayEnd: () => {
        console.log('[VoiceChat] NPC finished speaking');
        this.config.onSpeakingStop?.();
      },
      onError: (error) => {
        console.error('[VoiceChat] Playback error:', error);
        this.config.onError?.(error);
      },
    });
  }

  /**
   * Initialize the voice chat service (must be called on user interaction)
   */
  async initialize(): Promise<boolean> {
    const success = await this.micCapture.initialize();
    if (success) {
      this.isEnabled = true;
      console.log('[VoiceChat] Voice chat initialized');
    }
    return success;
  }

  /**
   * Check if voice chat is enabled
   */
  getIsEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Check if currently recording
   */
  getIsRecording(): boolean {
    return this.micCapture.getIsRecording();
  }

  /**
   * Check if NPC is currently speaking
   */
  getIsSpeaking(): boolean {
    return this.audioPlayer.getIsPlaying();
  }

  /**
   * Stop any current NPC speech
   */
  stopSpeaking(): void {
    this.audioPlayer.stop();
  }

  /**
   * Generate and play TTS for NPC dialogue
   */
  async speakNpcDialogue(text: string, voiceId?: string): Promise<void> {
    try {
      const response = await fetch(`${this.config.aiServiceUrl}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceId }),
      });

      if (!response.ok) {
        const error = await response.json() as { error: string };
        throw new Error(error.error || 'TTS request failed');
      }

      const audioBlob = await response.blob();
      this.audioPlayer.playBlob(audioBlob);
    } catch (error) {
      console.error('[VoiceChat] TTS error:', error);
      this.config.onError?.(error as Error);
    }
  }

  /**
   * Set volume for NPC speech (0.0 to 1.0)
   */
  setVolume(volume: number): void {
    this.audioPlayer.setVolume(volume);
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.micCapture.destroy();
    this.audioPlayer.destroy();
    this.isEnabled = false;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async transcribeAudio(audioBlob: Blob): Promise<void> {
    try {
      const response = await fetch(`${this.config.aiServiceUrl}/stt`, {
        method: 'POST',
        headers: { 'Content-Type': audioBlob.type },
        body: audioBlob,
      });

      if (!response.ok) {
        const error = await response.json() as { error: string };
        throw new Error(error.error || 'STT request failed');
      }

      const result = await response.json() as { text: string };
      console.log('[VoiceChat] Transcribed:', result.text);
      this.config.onTranscription?.(result.text);
    } catch (error) {
      console.error('[VoiceChat] STT error:', error);
      this.config.onError?.(error as Error);
    }
  }
}
