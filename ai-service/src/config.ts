/**
 * Unified Configuration System
 *
 * Loads AI provider configuration from environment variables and creates
 * a ProviderRegistry with the appropriate settings.
 *
 * Environment Variables:
 * - AI_PROVIDER_MODE: 'local-first' | 'cloud-first' | 'local-only' | 'cloud-only'
 *
 * LLM Configuration:
 * - OLLAMA_BASE_URL: Ollama server URL (default: http://localhost:11434)
 * - LLM_MODEL_DIALOGUE: Model for dialogue (default: llama3.2:3b)
 * - LLM_MODEL_BLUEPRINT: Model for blueprint generation (default: qwen2.5:7b)
 * - LLM_MODEL_SUMMARY: Model for summarization (default: llama3.2:3b)
 * - LLM_MODEL_REPLAN: Model for replanning (default: llama3.2:3b)
 * - OPENAI_API_KEY: OpenAI API key for cloud fallback
 *
 * Image Configuration:
 * - COMFYUI_BASE_URL: ComfyUI server URL (default: http://localhost:8188)
 * - FAL_API_KEY: FAL.ai API key for cloud fallback
 *
 * TTS Configuration:
 * - PIPER_MODELS_PATH: Path to Piper voice models
 * - PIPER_DEFAULT_VOICE: Default Piper voice name
 * - ELEVENLABS_API_KEY: ElevenLabs API key for cloud fallback
 * - ELEVENLABS_MODEL_ID: ElevenLabs model ID (default: eleven_multilingual_v2)
 */

import {
  ProviderPriority,
  ProviderRegistryConfig,
  LLMProviderConfig,
  ImageProviderConfig,
  TTSProviderConfig,
  STTProviderConfig,
} from './providers/types.js';
import { ProviderRegistry } from './providers/registry.js';
import { CostController } from './cost-control.js';
import { AIServiceConfig } from './types.js';

// ============================================================================
// Environment Variable Helpers
// ============================================================================

function getEnv(key: string): string | undefined;
function getEnv(key: string, defaultValue: string): string;
function getEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] ?? defaultValue;
}

function getEnvRequired(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getProviderMode(): ProviderPriority {
  const mode = getEnv('AI_PROVIDER_MODE', 'local-first');
  if (!['local-first', 'cloud-first', 'local-only', 'cloud-only'].includes(mode!)) {
    console.warn(`Invalid AI_PROVIDER_MODE: ${mode}, defaulting to 'local-first'`);
    return 'local-first';
  }
  return mode as ProviderPriority;
}

// ============================================================================
// LLM Configuration
// ============================================================================

function getLLMConfig(): LLMProviderConfig {
  const priority = getProviderMode();
  const ollamaBaseUrl = getEnv('OLLAMA_BASE_URL', 'http://localhost:11434');
  const openaiApiKey = getEnv('OPENAI_API_KEY');

  return {
    priority,
    models: {
      dialogue: getEnv('LLM_MODEL_DIALOGUE', 'llama3.2:3b')!,
      blueprint: getEnv('LLM_MODEL_BLUEPRINT', 'qwen2.5:7b')!,
      summary: getEnv('LLM_MODEL_SUMMARY', 'llama3.2:3b')!,
      replan: getEnv('LLM_MODEL_REPLAN', 'llama3.2:3b')!,
    },
    ollama: {
      baseUrl: ollamaBaseUrl!,
      model: getEnv('LLM_MODEL_DIALOGUE', 'llama3.2:3b')!,
      keepAlive: getEnv('OLLAMA_KEEP_ALIVE', '5m'),
    },
    openai: openaiApiKey ? {
      apiKey: openaiApiKey,
      baseUrl: getEnv('OPENAI_BASE_URL'),
    } : undefined,
  };
}

// ============================================================================
// Image Configuration
// ============================================================================

function getImageConfig(): ImageProviderConfig {
  const priority = getProviderMode();
  const comfyuiBaseUrl = getEnv('COMFYUI_BASE_URL', 'http://localhost:8188');
  const falApiKey = getEnv('FAL_API_KEY');
  const openaiApiKey = getEnv('OPENAI_API_KEY');

  return {
    priority,
    comfyui: {
      baseUrl: comfyuiBaseUrl!,
      checkpointName: getEnv('COMFYUI_CHECKPOINT'),
    },
    fal: falApiKey ? {
      apiKey: falApiKey,
      model: getEnv('FAL_MODEL', 'fal-ai/flux/schnell'),
    } : undefined,
    openai: openaiApiKey ? {
      apiKey: openaiApiKey,
    } : undefined,
  };
}

// ============================================================================
// TTS Configuration
// ============================================================================

function getTTSConfig(): TTSProviderConfig {
  const priority = getProviderMode();
  const piperModelsPath = getEnv('PIPER_MODELS_PATH');
  const elevenlabsApiKey = getEnv('ELEVENLABS_API_KEY');

  return {
    priority,
    enabled: Boolean(piperModelsPath || elevenlabsApiKey),
    piper: piperModelsPath ? {
      modelsPath: piperModelsPath,
      defaultVoice: getEnv('PIPER_DEFAULT_VOICE'),
      piperPath: getEnv('PIPER_PATH'),
    } : undefined,
    elevenlabs: elevenlabsApiKey ? {
      apiKey: elevenlabsApiKey,
      modelId: getEnv('ELEVENLABS_MODEL_ID', 'eleven_multilingual_v2'),
    } : undefined,
  };
}

// ============================================================================
// STT Configuration
// ============================================================================

function getSTTConfig(): STTProviderConfig {
  const priority = getProviderMode();
  const openaiApiKey = getEnv('OPENAI_API_KEY');

  return {
    priority,
    openai: openaiApiKey ? {
      apiKey: openaiApiKey,
    } : undefined,
  };
}

// ============================================================================
// Full Configuration
// ============================================================================

/**
 * Build complete provider registry configuration from environment variables
 */
export function buildProviderRegistryConfig(): ProviderRegistryConfig {
  return {
    llm: getLLMConfig(),
    image: getImageConfig(),
    tts: getTTSConfig(),
    stt: getSTTConfig(),
  };
}

/**
 * Create a ProviderRegistry from environment variables
 */
export async function createProviderRegistry(): Promise<ProviderRegistry> {
  const config = buildProviderRegistryConfig();
  const registry = new ProviderRegistry(config);
  await registry.initialize();
  return registry;
}

/**
 * Build legacy AIServiceConfig from environment variables for backwards compatibility
 */
export function buildLegacyConfig(): AIServiceConfig {
  return {
    openai_api_key: getEnv('OPENAI_API_KEY', ''),
    model_dialogue: getEnv('LLM_MODEL_DIALOGUE', 'gpt-4o-mini')!,
    model_blueprint: getEnv('LLM_MODEL_BLUEPRINT', 'gpt-4o-mini')!,
    model_summary: getEnv('LLM_MODEL_SUMMARY', 'gpt-4o-mini')!,
    model_replan: getEnv('LLM_MODEL_REPLAN', 'gpt-4o-mini')!,
    max_retries: parseInt(getEnv('AI_MAX_RETRIES', '3')!, 10),
    retry_delay_ms: parseInt(getEnv('AI_RETRY_DELAY_MS', '1000')!, 10),
    rate_limits: {
      max_requests_per_minute_per_npc: parseInt(getEnv('AI_MAX_REQUESTS_PER_NPC', '10')!, 10),
      max_requests_per_minute_per_player: parseInt(getEnv('AI_MAX_REQUESTS_PER_PLAYER', '30')!, 10),
      max_tokens_per_response: parseInt(getEnv('AI_MAX_TOKENS_PER_RESPONSE', '500')!, 10),
      conversation_auto_summarize_threshold: parseInt(getEnv('AI_AUTO_SUMMARIZE_THRESHOLD', '20')!, 10),
      replan_cooldown_ms: parseInt(getEnv('AI_REPLAN_COOLDOWN_MS', '3600000')!, 10),
    },
    enable_cost_tracking: getEnv('AI_ENABLE_COST_TRACKING', 'true') === 'true',
    elevenlabs_api_key: getEnv('ELEVENLABS_API_KEY'),
    elevenlabs_model_id: getEnv('ELEVENLABS_MODEL_ID', 'eleven_multilingual_v2'),
    voice_enabled: getEnv('AI_VOICE_ENABLED', 'false') === 'true',
  };
}

// ============================================================================
// Preset Configurations
// ============================================================================

/**
 * Local-first configuration preset
 * Prioritizes local providers (Ollama, ComfyUI, Piper) with cloud fallbacks
 */
export function getLocalFirstPreset(): ProviderRegistryConfig {
  return {
    llm: {
      priority: 'local-first',
      models: {
        dialogue: 'llama3.2:3b',
        blueprint: 'qwen2.5:7b',
        summary: 'llama3.2:3b',
        replan: 'llama3.2:3b',
      },
      ollama: {
        baseUrl: 'http://localhost:11434',
        model: 'llama3.2:3b',
        keepAlive: '5m',
      },
    },
    image: {
      priority: 'local-first',
      comfyui: {
        baseUrl: 'http://localhost:8188',
      },
    },
    tts: {
      priority: 'local-first',
      enabled: true,
      piper: {
        modelsPath: './models/piper',
      },
    },
    stt: {
      priority: 'local-first',
    },
  };
}

/**
 * Cloud-first configuration preset
 * Prioritizes cloud providers (OpenAI, FAL, ElevenLabs) with local fallbacks
 */
export function getCloudFirstPreset(
  openaiApiKey: string,
  falApiKey?: string,
  elevenlabsApiKey?: string
): ProviderRegistryConfig {
  return {
    llm: {
      priority: 'cloud-first',
      models: {
        dialogue: 'gpt-4o-mini',
        blueprint: 'gpt-4o',
        summary: 'gpt-4o-mini',
        replan: 'gpt-4o-mini',
      },
      openai: {
        apiKey: openaiApiKey,
      },
      ollama: {
        baseUrl: 'http://localhost:11434',
        model: 'llama3.2:3b',
      },
    },
    image: {
      priority: 'cloud-first',
      fal: falApiKey ? {
        apiKey: falApiKey,
        model: 'fal-ai/flux/schnell',
      } : undefined,
      openai: {
        apiKey: openaiApiKey,
      },
      comfyui: {
        baseUrl: 'http://localhost:8188',
      },
    },
    tts: {
      priority: 'cloud-first',
      enabled: Boolean(elevenlabsApiKey),
      elevenlabs: elevenlabsApiKey ? {
        apiKey: elevenlabsApiKey,
      } : undefined,
      piper: {
        modelsPath: './models/piper',
      },
    },
    stt: {
      priority: 'cloud-first',
      openai: {
        apiKey: openaiApiKey,
      },
    },
  };
}

/**
 * Fully offline configuration preset
 * Only uses local providers with no cloud fallbacks
 */
export function getOfflinePreset(): ProviderRegistryConfig {
  return {
    llm: {
      priority: 'local-only',
      models: {
        dialogue: 'llama3.2:3b',
        blueprint: 'qwen2.5:7b',
        summary: 'llama3.2:3b',
        replan: 'llama3.2:3b',
      },
      ollama: {
        baseUrl: 'http://localhost:11434',
        model: 'llama3.2:3b',
      },
    },
    image: {
      priority: 'local-only',
      comfyui: {
        baseUrl: 'http://localhost:8188',
      },
    },
    tts: {
      priority: 'local-only',
      enabled: true,
      piper: {
        modelsPath: './models/piper',
      },
    },
    stt: {
      priority: 'local-only',
    },
  };
}
