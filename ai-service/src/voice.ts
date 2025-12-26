/**
 * Voice Service (ElevenLabs Integration)
 * Provides text-to-speech capabilities for NPC dialogue.
 * Uses ElevenLabs API for high-quality voice synthesis.
 */

import {
  VoiceConfig,
  VoiceGenerationRequest,
  VoiceGenerationResponse,
  ElevenLabsVoice,
  NPCVoiceMapping,
  NPCBlueprint,
  AIServiceConfig,
  AIServiceError,
  TokenUsage,
} from './types.js';
import { CostController } from './cost-control.js';

// ElevenLabs API base URL
const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

// Pricing per character (as of late 2024)
// ElevenLabs charges per character, rates vary by plan
const ELEVENLABS_PRICING = {
  characters_per_dollar: 10000, // Approximate for paid plans
};

// Default voice settings for different personality types
type VoiceSettings = Omit<VoiceConfig, 'voice_id' | 'model_id' | 'use_speaker_boost'>;
const PERSONALITY_VOICE_PRESETS: Record<string, VoiceSettings> = {
  aggressive: { stability: 0.3, similarity_boost: 0.8, style: 0.7 },
  calm: { stability: 0.8, similarity_boost: 0.6, style: 0.2 },
  friendly: { stability: 0.6, similarity_boost: 0.7, style: 0.5 },
  mysterious: { stability: 0.5, similarity_boost: 0.9, style: 0.4 },
  elderly: { stability: 0.7, similarity_boost: 0.5, style: 0.3 },
  young: { stability: 0.4, similarity_boost: 0.7, style: 0.6 },
  authoritative: { stability: 0.7, similarity_boost: 0.8, style: 0.5 },
  nervous: { stability: 0.2, similarity_boost: 0.6, style: 0.3 },
};

// Recommended voices for different NPC archetypes
const ARCHETYPE_VOICE_SUGGESTIONS: Record<string, string[]> = {
  merchant: ['Adam', 'Antoni', 'Josh'],
  guard: ['Arnold', 'Clyde', 'Dave'],
  elder: ['Bill', 'George', 'Harry'],
  child: ['Charlotte', 'Dorothy', 'Emily'],
  noble: ['Daniel', 'Fin', 'Grace'],
  peasant: ['Michael', 'Patrick', 'Sam'],
  mystic: ['Domi', 'Elli', 'Rachel'],
  warrior: ['Arnold', 'Clyde', 'Thomas'],
};

export interface VoiceServiceOptions {
  enableCaching?: boolean;
  maxCacheSize?: number;
}

export class VoiceService {
  private apiKey: string;
  private modelId: string;
  private enabled: boolean;
  private costController: CostController;
  private voiceCache: Map<string, ElevenLabsVoice> = new Map();
  private npcVoiceMappings: Map<string, NPCVoiceMapping> = new Map();
  private audioCache: Map<string, VoiceGenerationResponse> = new Map();
  private maxCacheSize: number;

  constructor(
    config: AIServiceConfig,
    costController: CostController,
    options?: VoiceServiceOptions
  ) {
    this.apiKey = config.elevenlabs_api_key ?? '';
    this.modelId = config.elevenlabs_model_id ?? 'eleven_multilingual_v2';
    this.enabled = config.voice_enabled ?? false;
    this.costController = costController;
    this.maxCacheSize = options?.maxCacheSize ?? 100;
  }

  /**
   * Check if voice service is enabled and configured
   */
  isEnabled(): boolean {
    return this.enabled && this.apiKey.length > 0;
  }

  /**
   * Enable or disable the voice service
   */
  setEnabled(enabled: boolean): void {
    if (enabled && !this.apiKey) {
      throw new AIServiceError(
        'Cannot enable voice service without ElevenLabs API key',
        'VOICE_SERVICE_DISABLED'
      );
    }
    this.enabled = enabled;
  }

  /**
   * Fetch available voices from ElevenLabs
   */
  async getAvailableVoices(): Promise<ElevenLabsVoice[]> {
    this.ensureEnabled();

    const response = await fetch(`${ELEVENLABS_API_BASE}/voices`, {
      headers: {
        'xi-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new AIServiceError(
        `Failed to fetch voices: ${response.statusText}`,
        'API_ERROR',
        { status: response.status }
      );
    }

    const data = await response.json() as { voices: Array<{
      voice_id: string;
      name: string;
      category: string;
      labels: Record<string, string>;
      description?: string;
      preview_url?: string;
    }> };

    const voices: ElevenLabsVoice[] = data.voices.map(v => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category,
      labels: v.labels ?? {},
      description: v.description,
      preview_url: v.preview_url,
    }));

    // Cache voices
    voices.forEach(v => this.voiceCache.set(v.voice_id, v));

    return voices;
  }

  /**
   * Get a specific voice by ID
   */
  async getVoice(voiceId: string): Promise<ElevenLabsVoice> {
    // Check cache first
    const cached = this.voiceCache.get(voiceId);
    if (cached) {
      return cached;
    }

    this.ensureEnabled();

    const response = await fetch(`${ELEVENLABS_API_BASE}/voices/${voiceId}`, {
      headers: {
        'xi-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new AIServiceError(
          `Voice not found: ${voiceId}`,
          'VOICE_NOT_FOUND',
          { voice_id: voiceId }
        );
      }
      throw new AIServiceError(
        `Failed to fetch voice: ${response.statusText}`,
        'API_ERROR',
        { status: response.status }
      );
    }

    const data = await response.json() as {
      voice_id: string;
      name: string;
      category: string;
      labels: Record<string, string>;
      description?: string;
      preview_url?: string;
    };

    const voice: ElevenLabsVoice = {
      voice_id: data.voice_id,
      name: data.name,
      category: data.category,
      labels: data.labels ?? {},
      description: data.description,
      preview_url: data.preview_url,
    };

    this.voiceCache.set(voiceId, voice);
    return voice;
  }

  /**
   * Generate speech audio for text
   */
  async generateSpeech(request: VoiceGenerationRequest): Promise<VoiceGenerationResponse> {
    this.ensureEnabled();

    // Check cache
    const cacheKey = this.getCacheKey(request);
    const cached = this.audioCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const outputFormat = request.output_format ?? 'mp3_44100_128';

    const response = await fetch(
      `${ELEVENLABS_API_BASE}/text-to-speech/${request.voice_config.voice_id}?output_format=${outputFormat}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: request.text,
          model_id: request.voice_config.model_id ?? this.modelId,
          voice_settings: {
            stability: request.voice_config.stability ?? 0.5,
            similarity_boost: request.voice_config.similarity_boost ?? 0.75,
            style: request.voice_config.style ?? 0.0,
            use_speaker_boost: request.voice_config.use_speaker_boost ?? true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new AIServiceError(
        `Voice generation failed: ${response.statusText}`,
        'VOICE_GENERATION_FAILED',
        { status: response.status, error: errorText }
      );
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const characterCount = request.text.length;
    const estimatedCost = characterCount / ELEVENLABS_PRICING.characters_per_dollar;

    const result: VoiceGenerationResponse = {
      audio_data: audioBuffer,
      content_type: this.getContentType(outputFormat),
      character_count: characterCount,
      estimated_cost_usd: estimatedCost,
    };

    // Track cost
    const tokenUsage: TokenUsage = {
      input_tokens: characterCount,
      output_tokens: 0,
      total_tokens: characterCount,
      estimated_cost_usd: estimatedCost,
    };
    this.costController.recordUsage(tokenUsage);

    // Cache result
    this.cacheAudio(cacheKey, result);

    return result;
  }

  /**
   * Generate speech for NPC dialogue
   */
  async generateNPCDialogue(
    npcId: string,
    text: string,
    blueprint?: NPCBlueprint
  ): Promise<VoiceGenerationResponse> {
    // Get or create voice mapping for NPC
    let mapping = this.npcVoiceMappings.get(npcId);

    if (!mapping && blueprint) {
      mapping = await this.createVoiceMappingFromBlueprint(npcId, blueprint);
    }

    if (!mapping) {
      throw new AIServiceError(
        `No voice mapping found for NPC ${npcId}. Provide a blueprint or set mapping manually.`,
        'VOICE_NOT_FOUND',
        { npc_id: npcId }
      );
    }

    return this.generateSpeech({
      text,
      voice_config: {
        voice_id: mapping.voice_id,
        ...mapping.voice_settings,
      },
    });
  }

  /**
   * Set voice mapping for an NPC
   */
  setNPCVoiceMapping(mapping: NPCVoiceMapping): void {
    this.npcVoiceMappings.set(mapping.npc_id, mapping);
  }

  /**
   * Get voice mapping for an NPC
   */
  getNPCVoiceMapping(npcId: string): NPCVoiceMapping | undefined {
    return this.npcVoiceMappings.get(npcId);
  }

  /**
   * Create a voice mapping from NPC blueprint
   * Analyzes personality traits to select appropriate voice and settings
   */
  async createVoiceMappingFromBlueprint(
    npcId: string,
    blueprint: NPCBlueprint
  ): Promise<NPCVoiceMapping> {
    // Get available voices
    const voices = await this.getAvailableVoices();
    if (voices.length === 0) {
      throw new AIServiceError(
        'No voices available',
        'VOICE_NOT_FOUND'
      );
    }

    // Determine voice based on archetype
    const suggestedVoiceNames = ARCHETYPE_VOICE_SUGGESTIONS[blueprint.archetype_id.toLowerCase()] ?? [];

    // Try to find a matching voice
    let selectedVoice: ElevenLabsVoice | undefined;

    for (const name of suggestedVoiceNames) {
      selectedVoice = voices.find(v =>
        v.name.toLowerCase().includes(name.toLowerCase())
      );
      if (selectedVoice) break;
    }

    // Fall back to first available voice if no match
    if (!selectedVoice) {
      selectedVoice = voices[0];
    }

    // Safety check - should never happen since we check voices.length > 0 above
    if (!selectedVoice) {
      throw new AIServiceError('No voices available', 'VOICE_NOT_FOUND');
    }

    // Determine voice settings from personality
    const settings = this.getVoiceSettingsFromPersonality(blueprint);

    const mapping: NPCVoiceMapping = {
      npc_id: npcId,
      voice_id: selectedVoice.voice_id,
      voice_settings: settings,
    };

    this.npcVoiceMappings.set(npcId, mapping);
    return mapping;
  }

  /**
   * Analyze personality traits to determine voice settings
   */
  private getVoiceSettingsFromPersonality(
    blueprint: NPCBlueprint
  ): VoiceSettings {
    const traits = blueprint.personality.traits.map(t => t.toLowerCase());
    const defaultSettings: VoiceSettings = {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.35,
    };

    // Find matching preset
    for (const [key, preset] of Object.entries(PERSONALITY_VOICE_PRESETS)) {
      if (traits.some(t => t.includes(key) || key.includes(t))) {
        return preset;
      }
    }

    // Check for fear-based settings
    if (blueprint.personality.fears.length > 2) {
      return PERSONALITY_VOICE_PRESETS['nervous'] ?? defaultSettings;
    }

    // Age-based adjustments from blueprint
    if (blueprint.identity.age > 60) {
      return PERSONALITY_VOICE_PRESETS['elderly'] ?? defaultSettings;
    }
    if (blueprint.identity.age < 20) {
      return PERSONALITY_VOICE_PRESETS['young'] ?? defaultSettings;
    }

    // Voice style from blueprint
    const tone = blueprint.voice_style.tone.toLowerCase();
    if (tone.includes('calm') || tone.includes('gentle')) {
      return PERSONALITY_VOICE_PRESETS['calm'] ?? defaultSettings;
    }
    if (tone.includes('aggressive') || tone.includes('harsh')) {
      return PERSONALITY_VOICE_PRESETS['aggressive'] ?? defaultSettings;
    }
    if (tone.includes('friendly') || tone.includes('warm')) {
      return PERSONALITY_VOICE_PRESETS['friendly'] ?? defaultSettings;
    }

    // Default balanced settings
    return defaultSettings;
  }

  /**
   * Get suggested voices for an archetype
   */
  getSuggestedVoicesForArchetype(archetypeId: string): string[] {
    return ARCHETYPE_VOICE_SUGGESTIONS[archetypeId.toLowerCase()] ?? [];
  }

  /**
   * Search voices by criteria
   */
  async searchVoices(criteria: {
    gender?: 'male' | 'female';
    age?: 'young' | 'middle_aged' | 'old';
    accent?: string;
    use_case?: string;
  }): Promise<ElevenLabsVoice[]> {
    const voices = await this.getAvailableVoices();

    return voices.filter(voice => {
      const labels = voice.labels;

      if (criteria.gender && labels.gender !== criteria.gender) {
        return false;
      }
      if (criteria.age && labels.age !== criteria.age) {
        return false;
      }
      if (criteria.accent && !labels.accent?.toLowerCase().includes(criteria.accent.toLowerCase())) {
        return false;
      }
      if (criteria.use_case && !labels.use_case?.toLowerCase().includes(criteria.use_case.toLowerCase())) {
        return false;
      }

      return true;
    });
  }

  /**
   * Estimate cost for generating speech
   */
  estimateCost(text: string): number {
    return text.length / ELEVENLABS_PRICING.characters_per_dollar;
  }

  /**
   * Clear audio cache
   */
  clearCache(): void {
    this.audioCache.clear();
  }

  /**
   * Clear all NPC voice mappings
   */
  clearMappings(): void {
    this.npcVoiceMappings.clear();
  }

  private ensureEnabled(): void {
    if (!this.isEnabled()) {
      throw new AIServiceError(
        'Voice service is not enabled or API key is not configured',
        'VOICE_SERVICE_DISABLED'
      );
    }
  }

  private getCacheKey(request: VoiceGenerationRequest): string {
    return `${request.voice_config.voice_id}:${request.text}:${request.output_format ?? 'mp3_44100_128'}`;
  }

  private cacheAudio(key: string, response: VoiceGenerationResponse): void {
    // Evict oldest entries if cache is full
    if (this.audioCache.size >= this.maxCacheSize) {
      const firstKey = this.audioCache.keys().next().value;
      if (firstKey) {
        this.audioCache.delete(firstKey);
      }
    }
    this.audioCache.set(key, response);
  }

  private getContentType(format: string): string {
    if (format.startsWith('mp3')) {
      return 'audio/mpeg';
    }
    if (format.startsWith('pcm')) {
      return 'audio/pcm';
    }
    return 'audio/mpeg';
  }
}

/**
 * Create default voice config for testing
 */
export function createDefaultVoiceConfig(voiceId: string): VoiceConfig {
  return {
    voice_id: voiceId,
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.0,
    use_speaker_boost: true,
  };
}

/**
 * Recommended voice IDs for quick setup (ElevenLabs premade voices)
 */
export const PREMADE_VOICES = {
  rachel: 'EXAVITQu4vr4xnSDxMaL', // Female, warm
  clyde: 'IKne3meq5aSn9XLyUdCD', // Male, authoritative
  domi: 'AZnzlk1XvdvUeBnXmlld', // Female, mysterious
  dave: 'TxGEqnHWrfWFTfGW9XjX', // Male, friendly
  fin: 'D38z5RcWu1voky8WS1ja', // Male, young
  bella: 'sYqU3LQNzRuGYzX2bZQe', // Female, friendly
  adam: 'pNInz6obpgDQGcFmaJgB', // Male, deep
  sam: 'yoZ06aMxZJJ28mfd3POQ', // Male, casual
};
