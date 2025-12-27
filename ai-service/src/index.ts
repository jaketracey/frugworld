/**
 * Frugworld AI Service
 *
 * Main entry point that exports all AI service components:
 * - BlueprintGenerator: One-time NPC blueprint generation
 * - DialogueService: NPC dialogue generation with rate limiting
 * - MemorySummarizer: Memory compression and summarization
 * - ToolExecutor: Agent SDK compatible tool functions
 * - CostController: Token budgets and rate limiting
 * - VoiceService: ElevenLabs text-to-speech integration
 * - ReplanService: LLM-based NPC goal replanning on major triggers
 * - PortraitGenerator: OpenAI gpt-image-1 portrait generation
 */

// Types
export * from './types.js';

// Core services
export { BlueprintGenerator, createDefaultArchetype } from './blueprint.js';
export { DialogueService, createEmptyDialogueContext } from './dialogue.js';
export {
  MemorySummarizer,
  createEmptyMemory,
  createEmptyConversationMemory,
  type MemoryEvent,
  type MemoryEventType,
} from './memory.js';

// Voice service (ElevenLabs)
export {
  VoiceService,
  createDefaultVoiceConfig,
  PREMADE_VOICES,
  type VoiceServiceOptions,
} from './voice.js';

// Replanning service (Section 8)
export {
  ReplanService,
  shouldTriggerReplan,
  createReplanRequest,
} from './replan.js';

// Portrait generation service (OpenAI gpt-image-1)
export {
  PortraitGenerator,
  DEFAULT_STYLE_PREFIX,
  DEFAULT_PORTRAIT_CONFIG,
} from './portrait.js';

// Tools
export {
  ToolExecutor,
  InMemoryDataStore,
  createToolFunctions,
  TOOL_DEFINITIONS,
  type DataStore,
} from './tools.js';

// Cost control
export {
  CostController,
  estimateTokenCount,
  truncateToTokenBudget,
} from './cost-control.js';

// S3 Storage (Portrait Storage)
export {
  S3StorageService,
  createS3ConfigFromEnv,
} from './storage.js';

// Provider Abstraction Layer
export { ProviderRegistry, type LLMTask, type ProviderStatus } from './providers/registry.js';
export type {
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
  OllamaConfig,
  OpenAIConfig,
  FalConfig,
  ComfyUIConfig,
  PiperConfig,
  ElevenLabsConfig,
} from './providers/types.js';

// Unified Configuration System
export {
  buildProviderRegistryConfig,
  createProviderRegistry,
  buildLegacyConfig,
  getLocalFirstPreset,
  getCloudFirstPreset,
  getOfflinePreset,
} from './config.js';

// Re-export commonly used types for convenience
export type {
  NPCBlueprint,
  NPCArchetype,
  WorldContext,
  DialogueRequest,
  DialogueResponse,
  DialogueContext,
  Relationship,
  RelationshipDelta,
  NPCMemory,
  ConversationMemory,
  LocalFacts,
  TokenUsage,
  AIServiceConfig,
  RateLimitConfig,
  // Voice types
  VoiceConfig,
  VoiceGenerationRequest,
  VoiceGenerationResponse,
  ElevenLabsVoice,
  NPCVoiceMapping,
  // Replan types
  ReplanRequest,
  ReplanResponse,
  ReplanTrigger,
  // Tool types
  GameEvent,
  EmitEventInput,
  GetMemoryInput,
  // Portrait types
  PortraitResult,
  PortraitConfig,
  // S3 Storage types
  S3Config,
} from './types.js';

import { AIServiceConfig, DEFAULT_CONFIG } from './types.js';
import { CostController } from './cost-control.js';
import { BlueprintGenerator } from './blueprint.js';
import { DialogueService } from './dialogue.js';
import { MemorySummarizer } from './memory.js';
import { ToolExecutor, DataStore } from './tools.js';
import { VoiceService } from './voice.js';
import { ReplanService } from './replan.js';
import { PortraitGenerator } from './portrait.js';

/**
 * Main AI Service class that provides a unified interface
 * to all AI capabilities.
 */
export class AIService {
  public readonly blueprint: BlueprintGenerator;
  public readonly dialogue: DialogueService;
  public readonly memory: MemorySummarizer;
  public readonly tools: ToolExecutor;
  public readonly costController: CostController;
  public readonly voice: VoiceService;
  public readonly replan: ReplanService;
  public readonly portrait: PortraitGenerator;

  private readonly config: AIServiceConfig;

  constructor(
    apiKey: string,
    dataStore: DataStore,
    configOverrides?: Partial<Omit<AIServiceConfig, 'openai_api_key'>>
  ) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...configOverrides,
      openai_api_key: apiKey,
    };

    this.costController = new CostController(this.config.rate_limits);
    this.blueprint = new BlueprintGenerator(this.config, this.costController);
    this.dialogue = new DialogueService(this.config, this.costController);
    this.memory = new MemorySummarizer(this.config, this.costController);
    this.tools = new ToolExecutor(dataStore);
    this.voice = new VoiceService(this.config, this.costController);
    this.replan = new ReplanService(this.config, this.costController);
    this.portrait = new PortraitGenerator(this.config, this.costController);
  }

  /**
   * Get current token usage and cost statistics
   */
  getUsageStats(): {
    total_input_tokens: number;
    total_output_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
  } {
    const usage = this.costController.getTotalUsage();
    return {
      total_input_tokens: usage.input_tokens,
      total_output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
      estimated_cost_usd: usage.estimated_cost_usd,
    };
  }

  /**
   * Get rate limit status for an NPC
   */
  getNpcRateLimitStatus(npcId: string): {
    requests_in_window: number;
    window_resets_in_ms: number;
    can_replan: boolean;
  } {
    const status = this.costController.getNpcRateLimitStatus(npcId);
    let canReplan = true;

    try {
      this.costController.checkReplanCooldown(npcId);
    } catch {
      canReplan = false;
    }

    return {
      ...status,
      can_replan: canReplan,
    };
  }

  /**
   * Get rate limit status for a player
   */
  getPlayerRateLimitStatus(playerId: string): {
    requests_in_window: number;
    window_resets_in_ms: number;
  } {
    return this.costController.getPlayerRateLimitStatus(playerId);
  }

  /**
   * Reset all rate limit state (for testing or admin purposes)
   */
  resetRateLimits(): void {
    this.costController.clearState();
  }

  /**
   * Get the configuration (read-only)
   */
  getConfig(): Readonly<AIServiceConfig> {
    // Return a copy without exposing API keys
    return {
      ...this.config,
      openai_api_key: '***REDACTED***',
      elevenlabs_api_key: this.config.elevenlabs_api_key ? '***REDACTED***' : undefined,
    };
  }

  /**
   * Check if voice service is enabled
   */
  isVoiceEnabled(): boolean {
    return this.voice.isEnabled();
  }

  /**
   * Enable voice service (requires ElevenLabs API key in config)
   */
  enableVoice(): void {
    this.voice.setEnabled(true);
  }

  /**
   * Disable voice service
   */
  disableVoice(): void {
    this.voice.setEnabled(false);
  }
}

/**
 * Factory function to create an AIService instance
 */
export function createAIService(
  apiKey: string,
  dataStore: DataStore,
  config?: Partial<Omit<AIServiceConfig, 'openai_api_key'>>
): AIService {
  return new AIService(apiKey, dataStore, config);
}

// Import for provider-based factory
import { ProviderRegistry } from './providers/registry.js';
import { buildProviderRegistryConfig, buildLegacyConfig } from './config.js';

/**
 * Factory function to create an AIService instance with provider registry support.
 * This enables local-first AI with Ollama, ComfyUI, Piper, etc.
 *
 * Usage:
 * ```typescript
 * const aiService = await createAIServiceWithProviders(dataStore);
 * // Configure via environment variables:
 * // - AI_PROVIDER_MODE=local-first
 * // - OLLAMA_BASE_URL=http://localhost:11434
 * // - LLM_MODEL_DIALOGUE=llama3.2:3b
 * ```
 */
export async function createAIServiceWithProviders(
  dataStore: DataStore
): Promise<{
  service: AIService;
  registry: ProviderRegistry;
  initialize: () => Promise<void>;
}> {
  // Create provider registry from environment variables
  const registryConfig = buildProviderRegistryConfig();
  const registry = new ProviderRegistry(registryConfig);

  // Create legacy config for AIService constructor (backwards compat)
  const legacyConfig = buildLegacyConfig();

  // Create cost controller
  const costController = new CostController(legacyConfig.rate_limits);

  // Create services using provider registry
  const blueprint = BlueprintGenerator.withRegistry(registry, costController);
  const dialogue = DialogueService.withRegistry(registry, costController);
  const memory = MemorySummarizer.withRegistry(registry, costController);
  const voice = VoiceService.withRegistry(registry, costController);
  const replan = ReplanService.withRegistry(registry, costController);
  const portrait = PortraitGenerator.withRegistry(registry, costController);
  const tools = new ToolExecutor(dataStore);

  // Create AIService wrapper
  const service = new AIService(legacyConfig.openai_api_key ?? '', dataStore);

  // Replace services with provider-based versions
  (service as unknown as {
    blueprint: BlueprintGenerator;
    dialogue: DialogueService;
    memory: MemorySummarizer;
    voice: VoiceService;
    replan: ReplanService;
    portrait: PortraitGenerator;
    tools: ToolExecutor;
    costController: CostController;
  }).blueprint = blueprint;
  (service as unknown as { dialogue: DialogueService }).dialogue = dialogue;
  (service as unknown as { memory: MemorySummarizer }).memory = memory;
  (service as unknown as { voice: VoiceService }).voice = voice;
  (service as unknown as { replan: ReplanService }).replan = replan;
  (service as unknown as { portrait: PortraitGenerator }).portrait = portrait;
  (service as unknown as { tools: ToolExecutor }).tools = tools;
  (service as unknown as { costController: CostController }).costController = costController;

  // Return service with initialization function
  return {
    service,
    registry,
    initialize: async () => {
      await registry.initialize();
      await Promise.all([
        blueprint.initialize(),
        dialogue.initialize(),
        memory.initialize(),
        voice.initialize(),
        replan.initialize(),
        portrait.initialize(),
      ]);
    },
  };
}
