/**
 * Replanning Service (Section 8)
 * Handles rare LLM-based replanning for NPCs when major triggers occur.
 * Rate-limited to max 1 per NPC per hour.
 *
 * Supports multiple LLM providers through the provider abstraction layer:
 * - OpenAI (cloud)
 * - Ollama (local)
 * - Other providers via ProviderRegistry
 */

import OpenAI from 'openai';
import type { LLMProvider } from './providers/types.js';
import type { ProviderRegistry } from './providers/registry.js';
import { z } from 'zod';
import {
  ReplanRequest,
  ReplanResponse,
  ReplanTrigger,
  NPCBlueprint,
  NPCMemory,
  TokenUsage,
  AIServiceError,
  AIServiceConfig,
} from './types.js';
import { CostController, truncateToTokenBudget } from './cost-control.js';

// Zod schema for validating replan output
const ReplanOutputSchema = z.object({
  new_mid_term_goal: z.string().min(1).max(500),
  new_constraints: z.array(z.string()).max(5),
  planned_steps: z.array(z.string()).min(1).max(3),
  updated_memory_summary: z.array(z.string()).max(10),
  reasoning: z.string().max(500),
});

type ReplanOutput = z.infer<typeof ReplanOutputSchema>;

export interface ReplanServiceOptions {
  maxRetries?: number;
  /** Use provider registry instead of direct OpenAI client */
  useProviderRegistry?: boolean;
}

// Trigger descriptions for prompt context
const TRIGGER_DESCRIPTIONS: Record<ReplanTrigger, string> = {
  lost_job: 'The NPC has lost their job or primary occupation',
  lost_home: 'The NPC has lost their home or shelter',
  relationship_change: 'A major relationship has drastically changed (friend became enemy, ally betrayed, etc.)',
  persistent_threat: 'The NPC faces an ongoing, persistent threat to their safety',
  injury: 'The NPC has been injured or is facing health issues',
  quest_milestone: 'A significant story or quest milestone has been reached',
  major_discovery: 'The NPC has made a major discovery that changes their worldview',
  betrayal: 'The NPC has been betrayed by someone they trusted',
};

export class ReplanService {
  // Legacy OpenAI client (for backwards compatibility)
  private client: OpenAI | null = null;
  // Provider-based approach
  private llmProvider: LLMProvider | null = null;
  private registry: ProviderRegistry | null = null;

  private costController: CostController;
  private model: string;
  private maxRetries: number;
  private retryDelayMs: number;
  private useProviderRegistry: boolean;

  /**
   * Create a ReplanService with direct OpenAI client (legacy mode)
   */
  constructor(
    config: AIServiceConfig,
    costController: CostController,
    options?: ReplanServiceOptions
  ) {
    this.costController = costController;
    this.model = config.model_replan;
    this.maxRetries = config.max_retries;
    this.retryDelayMs = config.retry_delay_ms;
    this.useProviderRegistry = options?.useProviderRegistry ?? false;

    // Initialize legacy OpenAI client if not using provider registry
    if (!this.useProviderRegistry && config.openai_api_key) {
      this.client = new OpenAI({
        apiKey: config.openai_api_key,
      });
    }
  }

  /**
   * Create a ReplanService using the provider registry
   */
  static withRegistry(
    registry: ProviderRegistry,
    costController: CostController,
    options?: Omit<ReplanServiceOptions, 'useProviderRegistry'>
  ): ReplanService {
    const service = new ReplanService(
      {
        openai_api_key: '',
        model_dialogue: '',
        model_blueprint: '',
        model_summary: '',
        model_replan: registry.getLLMModel('replan'),
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
      this.llmProvider = await (this.registry as InstanceType<typeof ProviderRegistry>).getLLMProvider('replan');
    }
  }

  /**
   * Generate a replan for an NPC based on a major trigger event.
   * This is rate-limited per NPC (max 1 per hour by default).
   */
  async replan(
    request: ReplanRequest,
    blueprint: NPCBlueprint,
    memory: NPCMemory
  ): Promise<{ response: ReplanResponse; usage: TokenUsage }> {
    // Check replan cooldown
    this.costController.checkReplanCooldown(request.npc_id);

    // Build the prompt
    const { systemPrompt, userPrompt } = this.buildPrompts(request, blueprint, memory);

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
            maxTokens: 1000,
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
            max_tokens: 1000,
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
            'No text content in replan response',
            'PARSE_ERROR'
          );
        }

        // Parse and validate the JSON output
        const replanOutput = this.parseAndValidate(textContent);

        // Calculate token usage
        const usage = this.costController.calculateCost(
          this.model,
          inputTokens,
          outputTokens
        );
        this.costController.recordUsage(usage);

        // Record the replan for cooldown tracking
        this.costController.recordReplan(request.npc_id);

        // Convert to ReplanResponse
        const replanResponse: ReplanResponse = {
          new_mid_term_goal: replanOutput.new_mid_term_goal,
          new_constraints: replanOutput.new_constraints,
          planned_steps: replanOutput.planned_steps,
          updated_memory_summary: replanOutput.updated_memory_summary,
          reasoning: replanOutput.reasoning,
        };

        return { response: replanResponse, usage };
      } catch (error) {
        lastError = error as Error;
        if (error instanceof AIServiceError) {
          // Don't retry validation errors or cooldown errors
          if (
            error.code === 'PARSE_ERROR' ||
            error.code === 'VALIDATION_ERROR' ||
            error.code === 'REPLAN_COOLDOWN'
          ) {
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
      `Failed to generate replan after ${this.maxRetries} attempts: ${lastError?.message}`,
      'API_ERROR',
      { original_error: lastError?.message }
    );
  }

  /**
   * Check if an NPC can be replanned (not in cooldown)
   */
  canReplan(npcId: string): boolean {
    try {
      this.costController.checkReplanCooldown(npcId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate that a trigger is appropriate for replanning
   */
  isValidTrigger(trigger: string): trigger is ReplanTrigger {
    return trigger in TRIGGER_DESCRIPTIONS;
  }

  private buildPrompts(
    request: ReplanRequest,
    blueprint: NPCBlueprint,
    memory: NPCMemory
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(request, blueprint, memory);
    return { systemPrompt, userPrompt };
  }

  private buildSystemPrompt(): string {
    return `You are an AI game director responsible for generating coherent NPC goal changes in response to major life events. Your task is to update an NPC's mid-term goals and plans based on a significant trigger event.

REQUIREMENTS:
1. New goals must be consistent with the NPC's personality, values, and constraints
2. Plans should be actionable within the game world
3. Memory updates should reflect the impact of the trigger event
4. Reasoning should explain why the NPC would make these changes
5. Keep responses concise and focused

OUTPUT FORMAT:
Respond with ONLY valid JSON (no markdown, no explanation):
{
  "new_mid_term_goal": "The updated mid-term goal (1-2 sentences)",
  "new_constraints": ["Any new constraints or limitations", "Up to 5 items"],
  "planned_steps": ["Step 1 toward goal", "Step 2", "Step 3 (max 3 steps)"],
  "updated_memory_summary": ["Key memory of the trigger event", "Impact on NPC"],
  "reasoning": "Brief explanation of why the NPC would respond this way"
}`;
  }

  private buildUserPrompt(
    request: ReplanRequest,
    blueprint: NPCBlueprint,
    memory: NPCMemory
  ): string {
    const parts: string[] = [];

    // NPC Identity
    parts.push('## NPC IDENTITY');
    parts.push(`Name: ${blueprint.identity.name}`);
    parts.push(`Role: ${blueprint.identity.role}`);
    parts.push(`Age: ${blueprint.identity.age}`);
    parts.push('');

    // Personality
    parts.push('## PERSONALITY');
    parts.push(`Traits: ${blueprint.personality.traits.join(', ')}`);
    parts.push(`Values: ${blueprint.personality.values.join(', ')}`);
    parts.push(`Fears: ${blueprint.personality.fears.join(', ')}`);
    parts.push(`Desires: ${blueprint.personality.desires.join(', ')}`);
    parts.push('');

    // Key backstory (limited)
    parts.push('## KEY BACKSTORY');
    blueprint.backstory.slice(0, 5).forEach(fact => {
      parts.push(`- ${fact}`);
    });
    parts.push('');

    // Truth anchors (constraints that must not be violated)
    parts.push('## TRUTH ANCHORS (never contradict)');
    blueprint.truth_anchors.forEach(anchor => {
      parts.push(`- ${anchor}`);
    });
    parts.push('');

    // Current state
    parts.push('## CURRENT STATE');
    parts.push(`Location: ${request.current_state.location}`);
    parts.push(`Long-term goal: ${request.current_state.long_term_goal}`);
    parts.push(`Current mid-term goal: ${request.current_state.mid_term_goal}`);
    parts.push('');

    // Needs
    parts.push('## CURRENT NEEDS');
    for (const [need, value] of Object.entries(request.current_state.needs)) {
      parts.push(`- ${need}: ${value}/100`);
    }
    parts.push('');

    // Recent memory
    if (memory.recent_summary.length > 0) {
      parts.push('## RECENT MEMORY');
      memory.recent_summary.slice(-5).forEach(fact => {
        parts.push(`- ${fact}`);
      });
      parts.push('');
    }

    // Trigger event
    parts.push('## TRIGGER EVENT');
    parts.push(`Type: ${request.trigger}`);
    parts.push(`Description: ${TRIGGER_DESCRIPTIONS[request.trigger]}`);
    parts.push(`Details: ${request.trigger_details}`);
    parts.push('');

    parts.push('Generate an appropriate replan response as JSON.');

    return truncateToTokenBudget(parts.join('\n'), 2000);
  }

  private parseAndValidate(responseText: string): ReplanOutput {
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
        'Failed to parse replan response as JSON',
        'PARSE_ERROR',
        { response_preview: jsonStr.slice(0, 200) }
      );
    }

    // Validate against schema
    const result = ReplanOutputSchema.safeParse(parsed);
    if (!result.success) {
      throw new AIServiceError(
        `Replan validation failed: ${result.error.message}`,
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
   * Estimate the token cost for a replan operation
   */
  estimateReplanCost(): {
    estimated_input_tokens: number;
    estimated_output_tokens: number;
    estimated_cost_usd: number;
  } {
    const estimatedInputTokens = 1500; // Typical prompt size
    const estimatedOutputTokens = 500; // Typical response size

    const usage = this.costController.calculateCost(
      this.model,
      estimatedInputTokens,
      estimatedOutputTokens
    );

    return {
      estimated_input_tokens: estimatedInputTokens,
      estimated_output_tokens: estimatedOutputTokens,
      estimated_cost_usd: usage.estimated_cost_usd,
    };
  }
}

/**
 * Helper to determine if a game event should trigger replanning
 */
export function shouldTriggerReplan(
  eventType: string,
  severity: 'low' | 'medium' | 'high'
): ReplanTrigger | null {
  // Only high severity events trigger replanning
  if (severity !== 'high') {
    return null;
  }

  // Map event types to triggers
  const eventTriggerMap: Record<string, ReplanTrigger> = {
    job_lost: 'lost_job',
    fired: 'lost_job',
    home_destroyed: 'lost_home',
    evicted: 'lost_home',
    relationship_ended: 'relationship_change',
    friend_became_enemy: 'relationship_change',
    persistent_attack: 'persistent_threat',
    stalked: 'persistent_threat',
    seriously_injured: 'injury',
    near_death: 'injury',
    quest_complete: 'quest_milestone',
    major_story_event: 'quest_milestone',
    secret_revealed: 'major_discovery',
    truth_uncovered: 'major_discovery',
    ally_betrayal: 'betrayal',
    trust_broken: 'betrayal',
  };

  return eventTriggerMap[eventType.toLowerCase()] ?? null;
}

/**
 * Create a replan request from game state
 */
export function createReplanRequest(
  npcId: string,
  trigger: ReplanTrigger,
  triggerDetails: string,
  currentState: {
    long_term_goal: string;
    mid_term_goal: string;
    needs: Record<string, number>;
    location: string;
  }
): ReplanRequest {
  return {
    npc_id: npcId,
    trigger,
    trigger_details: triggerDetails,
    current_state: currentState,
  };
}
