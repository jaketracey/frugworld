/**
 * Provider Registry
 *
 * Manages AI provider instances and handles provider selection with fallback chains.
 * Supports local-first, cloud-first, local-only, and cloud-only modes.
 */

import {
  AIProvider,
  LLMProvider,
  ImageProvider,
  TTSProvider,
  STTProvider,
  ProviderPriority,
  ProviderRegistryConfig,
  LLMProviderConfig,
  ImageProviderConfig,
  TTSProviderConfig,
  STTProviderConfig,
} from './types.js';

export type LLMTask = 'dialogue' | 'blueprint' | 'summary' | 'replan';

export interface ProviderStatus {
  name: string;
  type: 'local' | 'cloud';
  available: boolean;
  error?: string;
}

/**
 * Provider Registry
 *
 * Manages provider instances and handles fallback logic.
 */
export class ProviderRegistry {
  private llmProviders: Map<string, LLMProvider> = new Map();
  private imageProviders: Map<string, ImageProvider> = new Map();
  private ttsProviders: Map<string, TTSProvider> = new Map();
  private sttProviders: Map<string, STTProvider> = new Map();

  private config: ProviderRegistryConfig;
  private initialized = false;

  constructor(config: ProviderRegistryConfig) {
    this.config = config;
  }

  /**
   * Initialize all configured providers
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Providers will be lazily initialized when first requested
    this.initialized = true;
  }

  /**
   * Register an LLM provider
   */
  registerLLMProvider(provider: LLMProvider): void {
    this.llmProviders.set(provider.name, provider);
  }

  /**
   * Register an image provider
   */
  registerImageProvider(provider: ImageProvider): void {
    this.imageProviders.set(provider.name, provider);
  }

  /**
   * Register a TTS provider
   */
  registerTTSProvider(provider: TTSProvider): void {
    this.ttsProviders.set(provider.name, provider);
  }

  /**
   * Register an STT provider
   */
  registerSTTProvider(provider: STTProvider): void {
    this.sttProviders.set(provider.name, provider);
  }

  /**
   * Get an available LLM provider for the specified task
   */
  async getLLMProvider(task: LLMTask): Promise<LLMProvider> {
    const provider = await this.selectProvider(
      this.llmProviders,
      this.config.llm.priority
    );

    if (!provider) {
      throw new Error(
        `No LLM provider available for task '${task}' with priority '${this.config.llm.priority}'`
      );
    }

    return provider;
  }

  /**
   * Get the model name for a specific LLM task
   */
  getLLMModel(task: LLMTask): string {
    return this.config.llm.models[task];
  }

  /**
   * Get an available image provider
   */
  async getImageProvider(): Promise<ImageProvider> {
    const provider = await this.selectProvider(
      this.imageProviders,
      this.config.image.priority
    );

    if (!provider) {
      throw new Error(
        `No image provider available with priority '${this.config.image.priority}'`
      );
    }

    return provider;
  }

  /**
   * Get an available TTS provider
   */
  async getTTSProvider(): Promise<TTSProvider> {
    if (!this.config.tts.enabled) {
      throw new Error('TTS is disabled in configuration');
    }

    const provider = await this.selectProvider(
      this.ttsProviders,
      this.config.tts.priority
    );

    if (!provider) {
      throw new Error(
        `No TTS provider available with priority '${this.config.tts.priority}'`
      );
    }

    return provider;
  }

  /**
   * Get an available STT provider
   */
  async getSTTProvider(): Promise<STTProvider> {
    const provider = await this.selectProvider(
      this.sttProviders,
      this.config.stt.priority
    );

    if (!provider) {
      throw new Error(
        `No STT provider available with priority '${this.config.stt.priority}'`
      );
    }

    return provider;
  }

  /**
   * Check status of all registered providers
   */
  async getProviderStatus(): Promise<{
    llm: ProviderStatus[];
    image: ProviderStatus[];
    tts: ProviderStatus[];
    stt: ProviderStatus[];
  }> {
    const checkProviders = async <T extends AIProvider>(
      providers: Map<string, T>
    ): Promise<ProviderStatus[]> => {
      const results: ProviderStatus[] = [];
      for (const [name, provider] of providers) {
        try {
          const available = await provider.isAvailable();
          results.push({ name, type: provider.type, available });
        } catch (error) {
          results.push({
            name,
            type: provider.type,
            available: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return results;
    };

    return {
      llm: await checkProviders(this.llmProviders),
      image: await checkProviders(this.imageProviders),
      tts: await checkProviders(this.ttsProviders),
      stt: await checkProviders(this.sttProviders),
    };
  }

  /**
   * Get the current configuration
   */
  getConfig(): ProviderRegistryConfig {
    return this.config;
  }

  /**
   * Shutdown all providers
   */
  async shutdown(): Promise<void> {
    const shutdownAll = async <T extends AIProvider>(
      providers: Map<string, T>
    ): Promise<void> => {
      for (const provider of providers.values()) {
        try {
          await provider.shutdown?.();
        } catch (error) {
          console.error(`Error shutting down provider ${provider.name}:`, error);
        }
      }
    };

    await Promise.all([
      shutdownAll(this.llmProviders),
      shutdownAll(this.imageProviders),
      shutdownAll(this.ttsProviders),
      shutdownAll(this.sttProviders),
    ]);
  }

  /**
   * Select an available provider based on priority
   */
  private async selectProvider<T extends AIProvider>(
    providers: Map<string, T>,
    priority: ProviderPriority
  ): Promise<T | null> {
    if (providers.size === 0) {
      return null;
    }

    // Sort providers based on priority
    const sortedProviders = this.sortProvidersByPriority(
      Array.from(providers.values()),
      priority
    );

    // Filter by priority mode
    const filteredProviders = this.filterProvidersByPriority(
      sortedProviders,
      priority
    );

    // Find the first available provider
    for (const provider of filteredProviders) {
      try {
        // Initialize if needed
        if (provider.initialize) {
          await provider.initialize();
        }

        const available = await provider.isAvailable();
        if (available) {
          return provider;
        }
      } catch (error) {
        console.warn(`Provider ${provider.name} not available:`, error);
        continue;
      }
    }

    return null;
  }

  /**
   * Sort providers based on priority preference
   */
  private sortProvidersByPriority<T extends AIProvider>(
    providers: T[],
    priority: ProviderPriority
  ): T[] {
    const preferLocal = priority === 'local-first' || priority === 'local-only';

    return [...providers].sort((a, b) => {
      if (a.type === b.type) return 0;
      if (preferLocal) {
        return a.type === 'local' ? -1 : 1;
      } else {
        return a.type === 'cloud' ? -1 : 1;
      }
    });
  }

  /**
   * Filter providers based on priority mode
   */
  private filterProvidersByPriority<T extends AIProvider>(
    providers: T[],
    priority: ProviderPriority
  ): T[] {
    switch (priority) {
      case 'local-only':
        return providers.filter((p) => p.type === 'local');
      case 'cloud-only':
        return providers.filter((p) => p.type === 'cloud');
      case 'local-first':
      case 'cloud-first':
      default:
        return providers; // All providers, already sorted
    }
  }
}

/**
 * Create a provider registry with default configuration from environment
 */
export function createDefaultProviderConfig(): ProviderRegistryConfig {
  const priority = (process.env['AI_PROVIDER_MODE'] as ProviderPriority) ?? 'local-first';

  return {
    llm: {
      priority,
      models: {
        dialogue: process.env['LLM_MODEL_DIALOGUE'] ?? 'llama3.2:3b',
        blueprint: process.env['LLM_MODEL_BLUEPRINT'] ?? 'qwen2.5:7b',
        summary: process.env['LLM_MODEL_SUMMARY'] ?? 'llama3.2:3b',
        replan: process.env['LLM_MODEL_REPLAN'] ?? 'qwen2.5:7b',
      },
      ollama: {
        baseUrl: process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434',
        model: process.env['LLM_MODEL_DIALOGUE'] ?? 'llama3.2:3b',
        keepAlive: '5m',
      },
      openai: process.env['OPENAI_API_KEY']
        ? {
            apiKey: process.env['OPENAI_API_KEY'],
          }
        : undefined,
    },
    image: {
      priority,
      comfyui: process.env['COMFYUI_BASE_URL']
        ? {
            baseUrl: process.env['COMFYUI_BASE_URL'],
          }
        : undefined,
      fal: process.env['FAL_KEY']
        ? {
            apiKey: process.env['FAL_KEY'],
          }
        : undefined,
      openai: process.env['OPENAI_API_KEY']
        ? {
            apiKey: process.env['OPENAI_API_KEY'],
          }
        : undefined,
    },
    tts: {
      priority,
      enabled: process.env['TTS_ENABLED'] !== 'false',
      piper: process.env['PIPER_MODELS_PATH']
        ? {
            modelsPath: process.env['PIPER_MODELS_PATH'],
            defaultVoice: process.env['PIPER_DEFAULT_VOICE'] ?? 'en_US-lessac-medium',
          }
        : undefined,
      elevenlabs: process.env['ELEVENLABS_API_KEY']
        ? {
            apiKey: process.env['ELEVENLABS_API_KEY'],
            modelId: process.env['ELEVENLABS_MODEL_ID'] ?? 'eleven_multilingual_v2',
          }
        : undefined,
    },
    stt: {
      priority,
      openai: process.env['OPENAI_API_KEY']
        ? {
            apiKey: process.env['OPENAI_API_KEY'],
          }
        : undefined,
    },
  };
}
