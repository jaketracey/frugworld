/**
 * Dialogue Service (Section 7 & 15)
 * Generates NPC dialogue responses with structured output,
 * bounded prompts, and rate limiting.
 *
 * Supports multiple LLM providers through the provider abstraction layer:
 * - OpenAI (cloud)
 * - Ollama (local)
 * - Other providers via ProviderRegistry
 */

import OpenAI from 'openai';
import { z } from 'zod';
import {
  DialogueRequest,
  DialogueResponse,
  DialogueContext,
  NPCBlueprint,
  Relationship,
  NPCMemory,
  ConversationMemory,
  LocalFacts,
  WorldContext,
  IntentTag,
  TokenUsage,
  AIServiceError,
  AIServiceConfig,
  RelationshipDelta,
} from './types.js';
import { CostController, estimateTokenCount, truncateToTokenBudget } from './cost-control.js';
import type { LLMProvider } from './providers/types.js';
import type { ProviderRegistry } from './providers/registry.js';

// Valid intent tags
const VALID_INTENT_TAGS: IntentTag[] = [
  'greeting', 'farewell', 'offer_trade', 'accept_trade', 'reject_trade',
  'ask_question', 'answer_question', 'give_hint', 'give_quest', 'complete_quest',
  'express_emotion', 'make_request', 'grant_request', 'deny_request',
  'share_rumor', 'warn', 'threaten', 'apologize', 'thank', 'small_talk', 'lore_dump',
];

// Zod schema for validating dialogue output
const DialogueOutputSchema = z.object({
  text: z.string().min(1).max(1000),
  intent_tags: z.array(z.enum(VALID_INTENT_TAGS as [IntentTag, ...IntentTag[]])).min(1).max(5),
  memory_delta: z.array(z.string()).max(5),
  relationship_delta: z.object({
    affinity_delta: z.number().min(-20).max(20).optional(),
    trust_delta: z.number().min(-20).max(20).optional(),
    flag_changes: z.object({
      offended: z.boolean().optional(),
      owes_favor: z.boolean().optional(),
      friend: z.boolean().optional(),
      hostile: z.boolean().optional(),
    }).optional(),
    new_summary_items: z.array(z.string()).max(3).optional(),
  }).optional(),
  actions: z.array(z.object({
    action_type: z.string(),
    target_id: z.string().optional(),
    parameters: z.record(z.unknown()).optional(),
    description: z.string(),
  })).max(3),
});

type DialogueOutput = z.infer<typeof DialogueOutputSchema>;

// Token budget allocation for prompt components
const TOKEN_BUDGETS = {
  system_prompt: 500,
  blueprint_identity: 150,
  blueprint_personality: 200,
  blueprint_backstory: 300,
  blueprint_voice: 100,
  blueprint_constraints: 150,
  relationship: 100,
  npc_memory: 200,
  conversation_memory: 200,
  local_facts: 200,
  world_context: 100,
  player_utterance: 200,
  buffer: 100,
};

const TOTAL_INPUT_BUDGET = Object.values(TOKEN_BUDGETS).reduce((a, b) => a + b, 0);

export interface DialogueServiceOptions {
  enableActionValidation?: boolean;
  maxRetries?: number;
  /** Use provider registry instead of direct OpenAI client */
  useProviderRegistry?: boolean;
}

export class DialogueService {
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
   * Create a DialogueService with direct OpenAI client (legacy mode)
   */
  constructor(
    config: AIServiceConfig,
    costController: CostController,
    options?: DialogueServiceOptions
  ) {
    this.costController = costController;
    this.model = config.model_dialogue;
    this.maxRetries = config.max_retries;
    this.retryDelayMs = config.retry_delay_ms;
    this.maxTokensPerResponse = config.rate_limits.max_tokens_per_response;
    this.useProviderRegistry = options?.useProviderRegistry ?? false;

    // Initialize legacy OpenAI client if not using provider registry
    if (!this.useProviderRegistry && config.openai_api_key) {
      this.client = new OpenAI({
        apiKey: config.openai_api_key,
      });
    }
  }

  /**
   * Create a DialogueService using the provider registry
   */
  static withRegistry(
    registry: ProviderRegistry,
    costController: CostController,
    options?: Omit<DialogueServiceOptions, 'useProviderRegistry'>
  ): DialogueService {
    const service = new DialogueService(
      {
        openai_api_key: '',
        model_dialogue: registry.getLLMModel('dialogue'),
        model_blueprint: '',
        model_summary: '',
        model_replan: '',
        max_retries: options?.maxRetries ?? 3,
        retry_delay_ms: 1000,
        rate_limits: {
          max_requests_per_minute_per_npc: 10,
          max_requests_per_minute_per_player: 30,
          max_tokens_per_response: 500,
          conversation_auto_summarize_threshold: 20,
          replan_cooldown_ms: 3600000,
        },
        enable_cost_tracking: true,
      },
      costController,
      { ...options, useProviderRegistry: true }
    );
    service.registry = registry;
    return service;
  }

  /**
   * Initialize the LLM provider (required when using provider registry)
   */
  async initialize(): Promise<void> {
    if (this.useProviderRegistry && this.registry && !this.llmProvider) {
      // Import dynamically to avoid circular dependencies
      const { ProviderRegistry } = await import('./providers/registry.js');
      this.llmProvider = await (this.registry as InstanceType<typeof ProviderRegistry>).getLLMProvider('dialogue');
    }
  }

  /**
   * Generate a dialogue response for an NPC.
   * Checks rate limits, builds bounded prompts, and validates output.
   */
  async generateDialogue(
    request: DialogueRequest,
    context: DialogueContext
  ): Promise<{ response: DialogueResponse; usage: TokenUsage; should_summarize: boolean }> {
    // Check rate limits
    this.costController.checkDialogueRateLimit(request.npc_id, request.player_id);

    // Record the request for rate limiting
    this.costController.recordDialogueRequest(request.npc_id, request.player_id);

    // Increment conversation length and check if summarization needed
    const conversationLength = this.costController.incrementConversationLength(
      request.player_id,
      request.npc_id
    );
    const shouldSummarize = this.costController.shouldAutoSummarize(
      request.player_id,
      request.npc_id
    );

    // Build the prompt with token budgets
    const { systemPrompt, userPrompt } = this.buildPrompts(request, context);

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
        const dialogueOutput = this.parseAndValidate(textContent, context.blueprint);

        // Calculate token usage
        const usage = this.costController.calculateCost(
          this.model,
          inputTokens,
          outputTokens
        );
        this.costController.recordUsage(usage);

        // Convert to DialogueResponse
        const dialogueResponse: DialogueResponse = {
          text: dialogueOutput.text,
          intent_tags: dialogueOutput.intent_tags,
          memory_delta: dialogueOutput.memory_delta,
          relationship_delta: dialogueOutput.relationship_delta as RelationshipDelta | undefined,
          actions: dialogueOutput.actions,
        };

        return {
          response: dialogueResponse,
          usage,
          should_summarize: shouldSummarize,
        };
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
      `Failed to generate dialogue after ${this.maxRetries} attempts: ${lastError?.message}`,
      'API_ERROR',
      { original_error: lastError?.message }
    );
  }

  private buildPrompts(
    request: DialogueRequest,
    context: DialogueContext
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = this.buildSystemPrompt(context.blueprint);
    const userPrompt = this.buildUserPrompt(request, context);

    return { systemPrompt, userPrompt };
  }

  private buildSystemPrompt(blueprint: NPCBlueprint): string {
    const parts: string[] = [];

    parts.push(`You are roleplaying as ${blueprint.identity.name}, a ${blueprint.identity.age}-year-old ${blueprint.identity.role}.`);
    parts.push('');

    // Voice style
    parts.push('SPEAKING STYLE:');
    parts.push(`- Tone: ${blueprint.voice_style.tone}`);
    parts.push(`- Vocabulary: ${blueprint.voice_style.vocabulary_level}`);
    if (blueprint.voice_style.speech_patterns.length > 0) {
      parts.push(`- Patterns: ${blueprint.voice_style.speech_patterns.join(', ')}`);
    }
    if (blueprint.voice_style.catchphrases && blueprint.voice_style.catchphrases.length > 0) {
      parts.push(`- May use phrases like: "${blueprint.voice_style.catchphrases.join('", "')}"`);
    }
    parts.push('');

    // Constraints
    parts.push('ABSOLUTE RULES (never break these):');
    blueprint.truth_anchors.forEach(anchor => {
      parts.push(`- TRUTH: ${anchor}`);
    });
    if (blueprint.constraints.taboo_topics.length > 0) {
      parts.push(`- NEVER discuss: ${blueprint.constraints.taboo_topics.join(', ')}`);
    }
    if (blueprint.constraints.lore_constraints.length > 0) {
      blueprint.constraints.lore_constraints.forEach(c => {
        parts.push(`- LORE: ${c}`);
      });
    }
    parts.push('');

    // Output format
    parts.push('OUTPUT FORMAT:');
    parts.push('Respond with ONLY valid JSON (no markdown, no explanation):');
    parts.push('{');
    parts.push('  "text": "Your dialogue line (in character, max 500 chars)",');
    parts.push('  "intent_tags": ["greeting", "small_talk"], // 1-5 tags from allowed list');
    parts.push('  "memory_delta": ["new fact to remember"], // 0-5 items');
    parts.push('  "relationship_delta": { "affinity_delta": 5 }, // optional');
    parts.push('  "actions": [] // optional suggested actions');
    parts.push('}');
    parts.push('');
    parts.push(`ALLOWED INTENT TAGS: ${VALID_INTENT_TAGS.join(', ')}`);

    return truncateToTokenBudget(parts.join('\n'), TOKEN_BUDGETS.system_prompt);
  }

  private buildUserPrompt(
    request: DialogueRequest,
    context: DialogueContext
  ): string {
    const parts: string[] = [];

    // Identity summary
    parts.push('## CHARACTER CONTEXT');
    const identity = context.blueprint.identity;
    parts.push(truncateToTokenBudget(
      `Name: ${identity.name}, ${identity.age}yo ${identity.role}. Appearance: ${identity.appearance.slice(0, 3).join(', ')}`,
      TOKEN_BUDGETS.blueprint_identity
    ));

    // Personality
    const personality = context.blueprint.personality;
    parts.push(truncateToTokenBudget(
      `Traits: ${personality.traits.join(', ')}. Values: ${personality.values.join(', ')}. Fears: ${personality.fears.join(', ')}. Desires: ${personality.desires.join(', ')}`,
      TOKEN_BUDGETS.blueprint_personality
    ));

    // Key backstory (trimmed)
    const backstory = context.blueprint.backstory.slice(0, 5).join('; ');
    parts.push(truncateToTokenBudget(
      `Background: ${backstory}`,
      TOKEN_BUDGETS.blueprint_backstory
    ));
    parts.push('');

    // Relationship with player
    parts.push('## RELATIONSHIP WITH PLAYER');
    const rel = context.relationship;
    parts.push(truncateToTokenBudget(
      `Affinity: ${rel.affinity}/100, Trust: ${rel.trust}/100. Interactions: ${rel.interaction_count}. Flags: ${this.formatFlags(rel.flags)}`,
      TOKEN_BUDGETS.relationship
    ));
    if (rel.conversation_summary.length > 0) {
      parts.push(truncateToTokenBudget(
        `Previous: ${rel.conversation_summary.slice(-3).join('; ')}`,
        TOKEN_BUDGETS.conversation_memory
      ));
    }
    parts.push('');

    // NPC memory
    if (context.npc_memory.recent_summary.length > 0) {
      parts.push('## RECENT MEMORY');
      parts.push(truncateToTokenBudget(
        context.npc_memory.recent_summary.slice(-5).join('; '),
        TOKEN_BUDGETS.npc_memory
      ));
      parts.push('');
    }

    // World context
    parts.push('## CURRENT SITUATION');
    const wc = context.world_context;
    parts.push(truncateToTokenBudget(
      `Location: ${wc.zone_name} (${wc.biome}). Time: ${wc.time_of_day}${wc.weather ? `. Weather: ${wc.weather}` : ''}`,
      TOKEN_BUDGETS.world_context
    ));

    // Local facts
    if (context.local_facts.facts.length > 0) {
      parts.push(truncateToTokenBudget(
        `Local info: ${context.local_facts.facts.slice(0, 3).join('; ')}`,
        TOKEN_BUDGETS.local_facts
      ));
    }
    if (context.local_facts.threats.length > 0) {
      parts.push(`Threats nearby: ${context.local_facts.threats.slice(0, 2).join(', ')}`);
    }
    parts.push('');

    // Player utterance
    parts.push('## PLAYER SAYS');
    parts.push(truncateToTokenBudget(
      `"${request.player_utterance}"`,
      TOKEN_BUDGETS.player_utterance
    ));

    if (request.context_hint) {
      parts.push(`(Context: ${request.context_hint})`);
    }

    parts.push('');
    parts.push('Respond in character as JSON.');

    return parts.join('\n');
  }

  private formatFlags(flags: Relationship['flags']): string {
    const active: string[] = [];
    if (flags.offended) active.push('offended');
    if (flags.owes_favor) active.push('owes_favor');
    if (flags.friend) active.push('friend');
    if (flags.hostile) active.push('hostile');
    if (flags.romantic_interest) active.push('romantic');
    if (flags.business_partner) active.push('business');
    return active.length > 0 ? active.join(', ') : 'none';
  }

  private parseAndValidate(responseText: string, blueprint: NPCBlueprint): DialogueOutput {
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
        'Failed to parse dialogue response as JSON',
        'PARSE_ERROR',
        { response_preview: jsonStr.slice(0, 200) }
      );
    }

    // Validate against schema
    const result = DialogueOutputSchema.safeParse(parsed);
    if (!result.success) {
      throw new AIServiceError(
        `Dialogue validation failed: ${result.error.message}`,
        'VALIDATION_ERROR',
        { validation_errors: result.error.errors }
      );
    }

    // Additional validation: check that response doesn't violate truth anchors
    this.validateTruthAnchors(result.data.text, blueprint.truth_anchors);

    return result.data;
  }

  private validateTruthAnchors(text: string, truthAnchors: string[]): void {
    // This is a simplified check - in production, you might use
    // more sophisticated NLI or fact-checking
    const lowerText = text.toLowerCase();

    // Check for obvious contradictions
    for (const anchor of truthAnchors) {
      // Look for negations of key terms
      const terms = anchor.toLowerCase().split(/\s+/).filter(t => t.length > 4);
      for (const term of terms) {
        // Simple patterns like "not a [term]" or "never [term]"
        if (
          lowerText.includes(`not a ${term}`) ||
          lowerText.includes(`never ${term}`) ||
          lowerText.includes(`no ${term}`)
        ) {
          // This might be a violation - log warning but don't fail
          console.warn(`Potential truth anchor violation detected: "${anchor}" vs response containing negation of "${term}"`);
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Estimate the token cost for a dialogue exchange
   */
  estimateDialogueCost(): {
    estimated_input_tokens: number;
    estimated_output_tokens: number;
    estimated_cost_usd: number;
  } {
    const usage = this.costController.calculateCost(
      this.model,
      TOTAL_INPUT_BUDGET,
      this.maxTokensPerResponse
    );

    return {
      estimated_input_tokens: TOTAL_INPUT_BUDGET,
      estimated_output_tokens: this.maxTokensPerResponse,
      estimated_cost_usd: usage.estimated_cost_usd,
    };
  }

  /**
   * Get the current conversation length for rate limit tracking
   */
  getConversationLength(playerId: string, npcId: string): number {
    return this.costController.getConversationLength(playerId, npcId);
  }
}

/**
 * Create empty/default context objects for testing
 */
export function createEmptyDialogueContext(blueprint: NPCBlueprint): DialogueContext {
  return {
    blueprint,
    relationship: {
      player_id: '',
      npc_id: blueprint.npc_id,
      affinity: 0,
      trust: 0,
      flags: {
        offended: false,
        owes_favor: false,
        friend: false,
        hostile: false,
      },
      conversation_summary: [],
      interaction_count: 0,
      last_interaction_ms: 0,
    },
    npc_memory: {
      npc_id: blueprint.npc_id,
      canonical_facts: blueprint.backstory,
      recent_summary: [],
      last_updated_ms: 0,
    },
    conversation_memory: {
      player_id: '',
      npc_id: blueprint.npc_id,
      summary: [],
      key_topics_discussed: [],
      promises_made: [],
      last_updated_ms: 0,
    },
    local_facts: {
      zone_id: '',
      chunk_ids: [],
      facts: [],
      threats: [],
      opportunities: [],
    },
    world_context: {
      zone_id: '',
      zone_name: 'Unknown',
      zone_type: 'wilderness',
      biome: 'temperate',
      time_of_day: 'midday',
      nearby_pois: [],
    },
  };
}
