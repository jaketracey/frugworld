/**
 * ElevenLabs TTS Provider
 *
 * Cloud text-to-speech using ElevenLabs API.
 * Supports high-quality voice synthesis with customizable settings.
 */

import {
  TTSProvider,
  TTSCapabilities,
  TTSVoice,
  TTSSynthesisRequest,
  TTSSynthesisResponse,
  ElevenLabsConfig,
} from '../types.js';

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

interface ElevenLabsVoiceResponse {
  voice_id: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  description?: string;
  preview_url?: string;
}

export interface ElevenLabsProviderOptions extends ElevenLabsConfig {
  /** Default voice ID to use */
  defaultVoiceId?: string;
}

export class ElevenLabsProvider implements TTSProvider {
  readonly name = 'elevenlabs';
  readonly type = 'cloud' as const;
  readonly capabilities: TTSCapabilities;

  private apiKey: string;
  private modelId: string;
  private defaultVoiceId: string;
  private voiceCache: Map<string, TTSVoice> = new Map();
  private available: boolean | null = null;

  constructor(options: ElevenLabsProviderOptions) {
    this.apiKey = options.apiKey;
    this.modelId = options.modelId ?? 'eleven_multilingual_v2';
    this.defaultVoiceId = options.defaultVoiceId ?? 'EXAVITQu4vr4xnSDxMaL'; // Rachel

    this.capabilities = {
      voiceCount: 100, // ElevenLabs has many voices
      supportsSSML: false,
      supportedFormats: ['mp3', 'wav', 'ogg'],
      voiceCloning: true,
    };
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) {
      return this.available;
    }

    if (!this.apiKey) {
      this.available = false;
      return false;
    }

    try {
      const response = await fetch(`${ELEVENLABS_API_BASE}/voices`, {
        headers: {
          'xi-api-key': this.apiKey,
        },
        signal: AbortSignal.timeout(5000),
      });

      this.available = response.ok;
      return this.available;
    } catch {
      this.available = false;
      return false;
    }
  }

  async initialize(): Promise<void> {
    // Pre-fetch voices to populate cache
    try {
      await this.listVoices();
    } catch {
      // Ignore errors during initialization
    }
  }

  async shutdown(): Promise<void> {
    this.voiceCache.clear();
  }

  async listVoices(): Promise<TTSVoice[]> {
    const response = await fetch(`${ELEVENLABS_API_BASE}/voices`, {
      headers: {
        'xi-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch voices: ${response.statusText}`);
    }

    const data = (await response.json()) as { voices: ElevenLabsVoiceResponse[] };

    const voices: TTSVoice[] = data.voices.map((v) => {
      const voice: TTSVoice = {
        id: v.voice_id,
        name: v.name,
        gender: this.mapGender(v.labels?.gender),
        language: v.labels?.language ?? 'en',
        previewUrl: v.preview_url,
        tags: Object.entries(v.labels ?? {})
          .filter(([key]) => key !== 'gender' && key !== 'language')
          .map(([_, value]) => value),
      };

      // Cache the voice
      this.voiceCache.set(v.voice_id, voice);

      return voice;
    });

    return voices;
  }

  async synthesize(request: TTSSynthesisRequest): Promise<TTSSynthesisResponse> {
    const voiceId = request.voiceId || this.defaultVoiceId;
    const outputFormat = this.getOutputFormat(request.format);

    const response = await fetch(
      `${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}?output_format=${outputFormat}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: request.text,
          model_id: this.modelId,
          voice_settings: {
            stability: request.stability ?? 0.5,
            similarity_boost: request.similarityBoost ?? 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Voice generation failed: ${response.statusText} - ${errorText}`);
    }

    const audioData = Buffer.from(await response.arrayBuffer());

    // Estimate duration (very rough - about 150 words per minute, 5 chars per word)
    const estimatedDurationMs = (request.text.length / 5 / 150) * 60 * 1000;

    return {
      audioData,
      contentType: this.getContentType(request.format),
      durationMs: estimatedDurationMs,
      sampleRate: 44100,
    };
  }

  /**
   * Get a voice by ID
   */
  async getVoice(voiceId: string): Promise<TTSVoice | null> {
    // Check cache first
    const cached = this.voiceCache.get(voiceId);
    if (cached) {
      return cached;
    }

    // Fetch from API
    const response = await fetch(`${ELEVENLABS_API_BASE}/voices/${voiceId}`, {
      headers: {
        'xi-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to fetch voice: ${response.statusText}`);
    }

    const data = (await response.json()) as ElevenLabsVoiceResponse;

    const voice: TTSVoice = {
      id: data.voice_id,
      name: data.name,
      gender: this.mapGender(data.labels?.gender),
      language: data.labels?.language ?? 'en',
      previewUrl: data.preview_url,
    };

    this.voiceCache.set(voiceId, voice);
    return voice;
  }

  /**
   * Set the default voice
   */
  setDefaultVoice(voiceId: string): void {
    this.defaultVoiceId = voiceId;
  }

  /**
   * Get the default voice
   */
  getDefaultVoice(): string {
    return this.defaultVoiceId;
  }

  /**
   * Set the model ID
   */
  setModel(modelId: string): void {
    this.modelId = modelId;
  }

  private mapGender(gender: string | undefined): 'male' | 'female' | 'neutral' | undefined {
    if (!gender) return undefined;
    const lower = gender.toLowerCase();
    if (lower === 'male') return 'male';
    if (lower === 'female') return 'female';
    return 'neutral';
  }

  private getOutputFormat(format?: string): string {
    switch (format) {
      case 'wav':
        return 'pcm_44100';
      case 'ogg':
        return 'opus_44100';
      case 'mp3':
      default:
        return 'mp3_44100_128';
    }
  }

  private getContentType(format?: string): string {
    switch (format) {
      case 'wav':
        return 'audio/wav';
      case 'ogg':
        return 'audio/ogg';
      case 'mp3':
      default:
        return 'audio/mpeg';
    }
  }
}

/**
 * Create an ElevenLabs provider from environment configuration
 */
export function createElevenLabsProvider(): ElevenLabsProvider | null {
  const apiKey = process.env['ELEVENLABS_API_KEY'];
  if (!apiKey) {
    return null;
  }

  return new ElevenLabsProvider({
    apiKey,
    modelId: process.env['ELEVENLABS_MODEL_ID'] ?? 'eleven_multilingual_v2',
    defaultVoiceId: process.env['ELEVENLABS_DEFAULT_VOICE'],
  });
}
