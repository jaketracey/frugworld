/**
 * Multi-Entity Action Service
 * Generates contextual group actions for multiple selected NPCs
 */

import OpenAI from 'openai';
import { z } from 'zod';
import type { WorldContext, RateLimitConfig } from './types.js';
import { CostController, truncateToTokenBudget } from './cost-control.js';

// Simple config for multi-action service
export interface MultiActionConfig {
  openai_api_key: string;
  model?: string;
  max_retries?: number;
  max_tokens_per_response?: number;
}

// ============================================================================
// Types
// ============================================================================

export interface NPCTargetContext {
  npc_id: string;
  name: string;
  role?: string;
  distance_from_player: number;
}

export interface MultiEntityActionRequest {
  player_id: string;
  target_npc_ids: string[];
  target_context: NPCTargetContext[];
  command?: string; // Voice command text if provided
  world_context?: Partial<WorldContext>;
}

export interface MultiEntityAction {
  action_type: string;
  display_label: string;
  display_icon: string; // Emoji
  description: string;
  parameters?: Record<string, unknown>;
  applicable_to: string[]; // Which NPC IDs this applies to
  success_modifier?: number; // -30 to +30
}

export interface MultiEntityActionResponse {
  actions: MultiEntityAction[];
  group_context: string; // e.g., "3 villagers near the tavern"
}

// ============================================================================
// Zod Schemas
// ============================================================================

const MultiActionOutputSchema = z.object({
  actions: z.array(z.object({
    action_type: z.enum([
      'gather', 'disperse', 'follow', 'stay', 'patrol',
      'greet', 'wave', 'chat', 'trade', 'gift',
      'defend', 'flee', 'hide', 'form_group', 'break_group',
      'work', 'rest', 'celebrate', 'mourn', 'pray',
    ]),
    display_label: z.string().max(20),
    display_icon: z.string().max(4), // Emoji (can be multi-codepoint)
    description: z.string().max(100),
    parameters: z.record(z.unknown()).optional(),
    applicable_to: z.array(z.string()),
    success_modifier: z.number().min(-30).max(30).optional(),
  })).min(2).max(6),
  group_context: z.string().max(60),
});

type MultiActionOutput = z.infer<typeof MultiActionOutputSchema>;

// Token budgets for prompt components
const TOKEN_BUDGETS = {
  system_prompt: 400,
  npc_context: 300,
  world_context: 150,
  command: 100,
  buffer: 50,
};

// ============================================================================
// Service Class
// ============================================================================

export class MultiEntityActionService {
  private client: OpenAI;
  private costController: CostController | null;
  private model: string;
  private maxRetries: number;
  private maxTokensPerResponse: number;

  constructor(
    config: MultiActionConfig,
    costController?: CostController
  ) {
    this.client = new OpenAI({
      apiKey: config.openai_api_key,
    });
    this.costController = costController ?? null;
    this.model = config.model ?? 'gpt-4o-mini';
    this.maxRetries = config.max_retries ?? 2;
    this.maxTokensPerResponse = config.max_tokens_per_response ?? 500;
  }

  /**
   * Generate actions for multiple selected entities
   */
  async generateActions(request: MultiEntityActionRequest): Promise<MultiEntityActionResponse> {
    // Build the prompt
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(request);

    // Make API call
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const completion = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: this.maxTokensPerResponse,
          temperature: 0.7,
          response_format: { type: 'json_object' },
        });

        const content = completion.choices[0]?.message?.content;
        if (!content) {
          throw new Error('Empty response from LLM');
        }

        // Parse and validate
        const parsed = JSON.parse(content) as unknown;
        const validated = MultiActionOutputSchema.parse(parsed);

        // Track costs
        if (completion.usage && this.costController) {
          const cost = this.costController.calculateCost(
            this.model,
            completion.usage.prompt_tokens,
            completion.usage.completion_tokens
          );
          this.costController.recordUsage(cost);
        }

        return {
          actions: validated.actions.map(action => ({
            action_type: action.action_type,
            display_label: action.display_label,
            display_icon: action.display_icon,
            description: action.description,
            parameters: action.parameters,
            applicable_to: action.applicable_to,
            success_modifier: action.success_modifier,
          })),
          group_context: validated.group_context,
        };

      } catch (error) {
        lastError = error as Error;
        console.warn(`[MultiAction] Attempt ${attempt + 1} failed:`, error);

        if (attempt < this.maxRetries) {
          await this.sleep(500 * (attempt + 1)); // Exponential backoff
        }
      }
    }

    // All retries failed - return fallback actions
    console.error('[MultiAction] All retries failed, returning fallback actions');
    return this.getFallbackActions(request);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private buildSystemPrompt(): string {
    return truncateToTokenBudget(`You are a game action generator for a multiplayer world simulation.
Your task is to generate 3-6 contextual group actions that a player could perform on selected NPCs.

Each action should:
- Be sensible for the group context (roles, relationships, location)
- Have a short, clear label (max 20 chars)
- Include an appropriate emoji icon
- Have a brief description of the effect
- Specify which NPCs it applies to (usually all selected)
- Optionally include a success modifier (-30 to +30) based on difficulty

Consider:
- NPC roles and what actions make sense for them
- Group dynamics (strangers vs friends, different professions)
- Player's implied intent from any voice command
- Actions should feel natural and immersive

IMPORTANT: Return valid JSON only. No markdown, no explanations.

Example output format:
{
  "actions": [
    {
      "action_type": "gather",
      "display_label": "Gather Here",
      "display_icon": "🤝",
      "description": "Have the villagers gather around you",
      "applicable_to": ["npc_1", "npc_2", "npc_3"],
      "success_modifier": 10
    }
  ],
  "group_context": "3 villagers near the market"
}`, TOKEN_BUDGETS.system_prompt);
  }

  private buildUserPrompt(request: MultiEntityActionRequest): string {
    // Build NPC context section
    const npcLines = request.target_context.map(npc => {
      const role = npc.role ? ` (${npc.role})` : '';
      return `- ${npc.name}${role}, ${npc.distance_from_player}m away [id: ${npc.npc_id}]`;
    });
    const npcSection = truncateToTokenBudget(
      `## Selected NPCs (${request.target_context.length})\n${npcLines.join('\n')}`,
      TOKEN_BUDGETS.npc_context
    );

    // Build world context section
    let worldSection = '';
    if (request.world_context) {
      const ctx = request.world_context;
      const parts: string[] = [];
      if (ctx.zone_name) parts.push(`Location: ${ctx.zone_name}`);
      if (ctx.time_of_day) parts.push(`Time: ${ctx.time_of_day}`);
      if (ctx.weather) parts.push(`Weather: ${ctx.weather}`);
      if (parts.length > 0) {
        worldSection = truncateToTokenBudget(
          `\n\n## World Context\n${parts.join(', ')}`,
          TOKEN_BUDGETS.world_context
        );
      }
    }

    // Build command section
    let commandSection = '';
    if (request.command) {
      commandSection = truncateToTokenBudget(
        `\n\n## Player Voice Command\n"${request.command}"\n\nGenerate actions that fulfill this command while also including other reasonable options.`,
        TOKEN_BUDGETS.command
      );
    }

    return `${npcSection}${worldSection}${commandSection}

Generate 3-6 appropriate group actions for this selection.`;
  }

  private getFallbackActions(request: MultiEntityActionRequest): MultiEntityActionResponse {
    const npcIds = request.target_npc_ids;
    const count = npcIds.length;
    const groupLabel = count === 1 ? 'NPC' : `${count} NPCs`;

    return {
      actions: [
        {
          action_type: 'gather',
          display_label: 'Gather',
          display_icon: '🤝',
          description: `Bring ${groupLabel} together`,
          applicable_to: npcIds,
        },
        {
          action_type: 'follow',
          display_label: 'Follow Me',
          display_icon: '🚶',
          description: `Have ${groupLabel} follow you`,
          applicable_to: npcIds,
        },
        {
          action_type: 'disperse',
          display_label: 'Disperse',
          display_icon: '💨',
          description: `Send ${groupLabel} away`,
          applicable_to: npcIds,
        },
        {
          action_type: 'wave',
          display_label: 'Wave',
          display_icon: '👋',
          description: `Wave at ${groupLabel}`,
          applicable_to: npcIds,
          success_modifier: 20,
        },
      ],
      group_context: `${count} selected NPC${count === 1 ? '' : 's'}`,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
