# Voice Service Refactor Plan

## Goal
Refactor `voice.ts` to use the provider registry for TTS.

## File to Modify
`/Users/jake/Projects/frugworld/ai-service/src/voice.ts`

## Current State
- Uses ElevenLabs API directly via fetch
- Complex voice mapping logic based on NPC personality

## Changes Required

### 1. Add Imports
```typescript
import type { TTSProvider, TTSVoice } from './providers/types.js';
import type { ProviderRegistry } from './providers/registry.js';
```

### 2. Update Class Properties
Add:
```typescript
private ttsProvider: TTSProvider | null = null;
private registry: ProviderRegistry | null = null;
private useProviderRegistry: boolean;
```

### 3. Update Constructor
- Add `useProviderRegistry` option
- Keep existing ElevenLabs setup for backwards compatibility

### 4. Add Static Factory Method
```typescript
static withRegistry(
  registry: ProviderRegistry,
  costController: CostController,
  options?: VoiceServiceOptions
): VoiceService
```

### 5. Add Initialize Method
```typescript
async initialize(): Promise<void> {
  if (this.useProviderRegistry && this.registry && !this.ttsProvider) {
    const { ProviderRegistry } = await import('./providers/registry.js');
    try {
      this.ttsProvider = await (this.registry as InstanceType<typeof ProviderRegistry>).getTTSProvider();
    } catch {
      // TTS may be disabled, that's OK
    }
  }
}
```

### 6. Update getAvailableVoices Method
```typescript
async getAvailableVoices(): Promise<ElevenLabsVoice[]> {
  if (this.useProviderRegistry && this.ttsProvider) {
    const voices = await this.ttsProvider.listVoices();
    // Map TTSVoice to ElevenLabsVoice format for compatibility
    return voices.map(v => ({
      voice_id: v.id,
      name: v.name,
      category: 'generated',
      labels: { gender: v.gender ?? 'neutral', language: v.language },
      preview_url: v.previewUrl,
    }));
  }
  // Legacy ElevenLabs approach
  this.ensureEnabled();
  // ... existing code
}
```

### 7. Update generateSpeech Method
```typescript
if (this.useProviderRegistry && this.ttsProvider) {
  const response = await this.ttsProvider.synthesize({
    text: request.text,
    voiceId: request.voice_config.voice_id,
    stability: request.voice_config.stability,
    similarityBoost: request.voice_config.similarity_boost,
    format: 'mp3',
  });
  return {
    audio_data: response.audioData,
    content_type: response.contentType,
    character_count: request.text.length,
    estimated_cost_usd: 0, // Local providers are free
  };
}
// Legacy ElevenLabs approach...
```

## Validation
- Backwards compatibility with ElevenLabs
- Voice mapping logic preserved
- Run `npx tsc --noEmit` to verify
