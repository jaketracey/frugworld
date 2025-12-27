/**
 * Blueprint Generator (Section 6.1)
 * Generates NPC blueprints using LLM, with structured output and caching.
 * Blueprints are one-time generation per NPC and cached permanently.
 */

import OpenAI from 'openai';
import { z } from 'zod';
import {
  NPCBlueprint,
  NPCArchetype,
  WorldContext,
  TokenUsage,
  AIServiceError,
  AIServiceConfig,
} from './types.js';
import { CostController, estimateTokenCount } from './cost-control.js';
import type { LLMProvider } from './providers/types.js';
import type { ProviderRegistry } from './providers/registry.js';

// Zod schema for validating LLM output
const BlueprintOutputSchema = z.object({
  identity: z.object({
    name: z.string().min(1),
    age: z.number().int().min(1).max(200),
    role: z.string().min(1),
    appearance: z.array(z.string()).min(1).max(10),
  }),
  personality: z.object({
    traits: z.array(z.string()).min(2).max(6),
    values: z.array(z.string()).min(1).max(5),
    fears: z.array(z.string()).min(1).max(4),
    desires: z.array(z.string()).min(1).max(4),
  }),
  backstory: z.array(z.string()).min(5).max(12),
  relationships: z.array(z.object({
    npc_id: z.string(),
    relationship_type: z.string(),
    description: z.string(),
  })).default([]),
  voice_style: z.object({
    tone: z.string(),
    vocabulary_level: z.enum(['simple', 'moderate', 'sophisticated']),
    speech_patterns: z.array(z.string()).min(1).max(5),
    catchphrases: z.array(z.string()).max(3).optional(),
  }),
  constraints: z.object({
    taboo_topics: z.array(z.string()).default([]),
    safety_constraints: z.array(z.string()).default([]),
    lore_constraints: z.array(z.string()).default([]),
  }),
  truth_anchors: z.array(z.string()).min(2).max(8),
});

type BlueprintOutput = z.infer<typeof BlueprintOutputSchema>;

export interface BlueprintGeneratorOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  /** Use provider registry instead of direct OpenAI client */
  useProviderRegistry?: boolean;
}

export class BlueprintGenerator {
  // Legacy OpenAI client (for backwards compatibility)
  private client: OpenAI | null = null;
  // Provider-based approach
  private llmProvider: LLMProvider | null = null;
  private registry: ProviderRegistry | null = null;

  private costController: CostController;
  private model: string;
  private maxRetries: number;
  private retryDelayMs: number;
  private maxTokensPerResponse: number;
  private useProviderRegistry: boolean;

  /**
   * Create a BlueprintGenerator with direct OpenAI client (legacy mode)
   */
  constructor(
    config: AIServiceConfig,
    costController: CostController,
    options?: BlueprintGeneratorOptions
  ) {
    this.costController = costController;
    this.model = config.model_blueprint;
    this.maxRetries = options?.maxRetries ?? config.max_retries;
    this.retryDelayMs = options?.retryDelayMs ?? config.retry_delay_ms;
    this.maxTokensPerResponse = 2000;
    this.useProviderRegistry = options?.useProviderRegistry ?? false;

    // Initialize legacy OpenAI client if not using provider registry
    if (!this.useProviderRegistry && config.openai_api_key) {
      this.client = new OpenAI({
        apiKey: config.openai_api_key,
      });
    }
  }

  /**
   * Create a BlueprintGenerator using the provider registry
   */
  static withRegistry(
    registry: ProviderRegistry,
    costController: CostController,
    options?: Omit<BlueprintGeneratorOptions, 'useProviderRegistry'>
  ): BlueprintGenerator {
    const generator = new BlueprintGenerator(
      {
        openai_api_key: '',
        model_dialogue: '',
        model_blueprint: registry.getLLMModel('blueprint'),
        model_summary: '',
        model_replan: '',
        max_retries: options?.maxRetries ?? 3,
        retry_delay_ms: options?.retryDelayMs ?? 1000,
        rate_limits: {
          max_requests_per_minute_per_npc: 10,
          max_requests_per_minute_per_player: 30,
          max_tokens_per_response: 2000,
          conversation_auto_summarize_threshold: 20,
          replan_cooldown_ms: 3600000,
        },
        enable_cost_tracking: true,
      },
      costController,
      { ...options, useProviderRegistry: true }
    );
    generator.registry = registry;
    return generator;
  }

  /**
   * Initialize the LLM provider (required when using provider registry)
   */
  async initialize(): Promise<void> {
    if (this.useProviderRegistry && this.registry && !this.llmProvider) {
      // Import dynamically to avoid circular dependencies
      const { ProviderRegistry } = await import('./providers/registry.js');
      this.llmProvider = await (this.registry as InstanceType<typeof ProviderRegistry>).getLLMProvider('blueprint');
    }
  }

  /**
   * Generate a new NPC blueprint based on archetype and world context.
   * This should only be called once per NPC and the result cached permanently.
   */
  async generateBlueprint(
    npcId: string,
    archetype: NPCArchetype,
    worldContext: WorldContext,
    existingNpcNames?: string[]
  ): Promise<{ blueprint: NPCBlueprint; usage: TokenUsage }> {
    const userPrompt = this.buildPrompt(archetype, worldContext, existingNpcNames);
    const systemPrompt = this.getSystemPrompt();

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        let textContent: string;
        let inputTokens: number;
        let outputTokens: number;

        if (this.useProviderRegistry && this.llmProvider) {
          // Use provider-based approach
          const response = await this.llmProvider.complete({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            maxTokens: this.maxTokensPerResponse,
            responseFormat: 'json',
          });

          textContent = response.content;
          inputTokens = response.usage.inputTokens;
          outputTokens = response.usage.outputTokens;
        } else if (this.client) {
          // Use legacy OpenAI client
          const response = await this.client.chat.completions.create({
            model: this.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            max_tokens: this.maxTokensPerResponse,
          });

          textContent = response.choices[0]?.message?.content ?? '';
          inputTokens = response.usage?.prompt_tokens ?? 0;
          outputTokens = response.usage?.completion_tokens ?? 0;
        } else {
          throw new AIServiceError(
            'No LLM provider available. Call initialize() first or provide OpenAI API key.',
            'PROVIDER_NOT_AVAILABLE'
          );
        }

        if (!textContent) {
          throw new AIServiceError(
            'No text content in response',
            'PARSE_ERROR'
          );
        }

        // Parse and validate the JSON output
        const blueprintOutput = this.parseAndValidate(textContent);

        // Calculate token usage
        const usage = this.costController.calculateCost(
          this.model,
          inputTokens,
          outputTokens
        );
        this.costController.recordUsage(usage);

        // Construct the full blueprint
        const blueprint: NPCBlueprint = {
          npc_id: npcId,
          archetype_id: archetype.archetype_id,
          ...blueprintOutput,
          version: 1,
          created_at_ms: Date.now(),
        };

        return { blueprint, usage };
      } catch (error) {
        lastError = error as Error;
        if (error instanceof AIServiceError) {
          // Don't retry validation errors
          if (error.code === 'PARSE_ERROR' || error.code === 'VALIDATION_ERROR') {
            throw error;
          }
        }
        // Wait before retrying
        if (attempt < this.maxRetries - 1) {
          await this.sleep(this.retryDelayMs * (attempt + 1));
        }
      }
    }

    throw new AIServiceError(
      `Failed to generate blueprint after ${this.maxRetries} attempts: ${lastError?.message}`,
      'API_ERROR',
      { original_error: lastError?.message }
    );
  }

  private getSystemPrompt(): string {
    return `You are an NPC character designer for a fantasy simulation game called Frugworld. Your task is to create detailed, coherent NPC blueprints that will drive realistic dialogue and behavior.

REQUIREMENTS:
1. Create unique, memorable characters with consistent personalities
2. Backstories should be plausible within the world context
3. Personality traits should influence speaking style
4. Truth anchors are ABSOLUTE FACTS the NPC will never contradict
5. All output must be valid JSON matching the specified schema

OUTPUT FORMAT:
You must respond with ONLY valid JSON (no markdown, no explanation). The JSON must match this structure:
{
  "identity": { "name": string, "age": number, "role": string, "appearance": string[] },
  "personality": { "traits": string[], "values": string[], "fears": string[], "desires": string[] },
  "backstory": string[] (5-12 bullet points),
  "relationships": [{ "npc_id": string, "relationship_type": string, "description": string }],
  "voice_style": { "tone": string, "vocabulary_level": "simple"|"moderate"|"sophisticated", "speech_patterns": string[], "catchphrases"?: string[] },
  "constraints": { "taboo_topics": string[], "safety_constraints": string[], "lore_constraints": string[] },
  "truth_anchors": string[] (2-8 absolute facts)
}`;
  }

  private buildPrompt(
    archetype: NPCArchetype,
    worldContext: WorldContext,
    existingNpcNames?: string[]
  ): string {
    const parts: string[] = [];

    parts.push('Create an NPC blueprint with the following context:\n');

    // Archetype info
    parts.push('## ARCHETYPE');
    parts.push(`Category: ${archetype.category}`);
    parts.push(`Base Role: ${archetype.base_role}`);
    if (archetype.personality_tendencies.traits) {
      parts.push(`Personality Tendencies: ${archetype.personality_tendencies.traits.join(', ')}`);
    }
    if (archetype.common_backstory_elements.length > 0) {
      parts.push(`Common Background Elements: ${archetype.common_backstory_elements.join('; ')}`);
    }
    parts.push('');

    // World context
    parts.push('## WORLD CONTEXT');
    parts.push(`Zone: ${worldContext.zone_name} (${worldContext.zone_type})`);
    parts.push(`Biome: ${worldContext.biome}`);
    if (worldContext.cultural_notes && worldContext.cultural_notes.length > 0) {
      parts.push(`Cultural Notes: ${worldContext.cultural_notes.join('; ')}`);
    }
    if (worldContext.nearby_pois.length > 0) {
      const poiList = worldContext.nearby_pois
        .slice(0, 3)
        .map(p => `${p.name} (${p.type})`)
        .join(', ');
      parts.push(`Nearby Places: ${poiList}`);
    }
    parts.push('');

    // Constraints from archetype
    if (archetype.default_constraints) {
      parts.push('## REQUIRED CONSTRAINTS');
      if (archetype.default_constraints.taboo_topics?.length) {
        parts.push(`Must avoid topics: ${archetype.default_constraints.taboo_topics.join(', ')}`);
      }
      if (archetype.default_constraints.lore_constraints?.length) {
        parts.push(`Lore rules: ${archetype.default_constraints.lore_constraints.join('; ')}`);
      }
      parts.push('');
    }

    // Avoid duplicate names
    if (existingNpcNames && existingNpcNames.length > 0) {
      parts.push('## AVOID THESE NAMES (already used)');
      parts.push(existingNpcNames.slice(0, 20).join(', '));
      parts.push('');
    }

    parts.push('Generate a complete, unique NPC blueprint as JSON.');

    return parts.join('\n');
  }

  private parseAndValidate(responseText: string): BlueprintOutput {
    // Try to extract JSON from the response
    let jsonStr = responseText.trim();

    // Handle potential markdown code blocks
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch?.[1]) {
      jsonStr = jsonMatch[1].trim();
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new AIServiceError(
        'Failed to parse LLM response as JSON',
        'PARSE_ERROR',
        { response_preview: jsonStr.slice(0, 200) }
      );
    }

    // Validate against schema
    const result = BlueprintOutputSchema.safeParse(parsed);
    if (!result.success) {
      throw new AIServiceError(
        `Blueprint validation failed: ${result.error.message}`,
        'VALIDATION_ERROR',
        { validation_errors: result.error.errors }
      );
    }

    return result.data;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Estimate the token cost for generating a blueprint (for budgeting)
   */
  estimateBlueprintCost(archetype: NPCArchetype, worldContext: WorldContext): {
    estimated_input_tokens: number;
    estimated_output_tokens: number;
    estimated_cost_usd: number;
  } {
    const prompt = this.buildPrompt(archetype, worldContext);
    const systemPrompt = this.getSystemPrompt();

    const inputTokens = estimateTokenCount(prompt + systemPrompt);
    const outputTokens = 800; // Average expected output

    const usage = this.costController.calculateCost(this.model, inputTokens, outputTokens);

    return {
      estimated_input_tokens: inputTokens,
      estimated_output_tokens: outputTokens,
      estimated_cost_usd: usage.estimated_cost_usd,
    };
  }
}

/**
 * Create a default archetype for testing or when no specific archetype is provided
 */
export function createDefaultArchetype(category: string, role: string): NPCArchetype {
  return {
    archetype_id: `default_${category.toLowerCase()}_${role.toLowerCase()}`.replace(/\s+/g, '_'),
    category,
    base_role: role,
    personality_tendencies: {
      traits: ['practical', 'reserved'],
    },
    typical_voice: {
      tone: 'neutral',
      vocabulary_level: 'moderate',
    },
    common_backstory_elements: [
      'Has lived in the region for years',
      'Knows the local customs well',
    ],
    default_constraints: {
      taboo_topics: [],
      safety_constraints: ['No extreme violence', 'No explicit content'],
      lore_constraints: [],
    },
  };
}
