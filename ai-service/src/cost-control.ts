/**
 * Cost Control Module (Section 16)
 * Implements token caps, rate limiting, and cost tracking for LLM usage.
 */

import {
  RateLimitConfig,
  RateLimitState,
  TokenUsage,
  AIServiceError,
} from './types.js';

// Pricing per 1M tokens (as of late 2024, adjust as needed)
// OpenAI models used by this service
const PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI GPT-4o models
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-2024-11-20': { input: 2.5, output: 10.0 },
  'gpt-4o-2024-08-06': { input: 2.5, output: 10.0 },
  // OpenAI GPT-4o-mini models (cheaper, good for dialogue)
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o-mini-2024-07-18': { input: 0.15, output: 0.60 },
  // OpenAI GPT-4 Turbo
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gpt-4-turbo-2024-04-09': { input: 10.0, output: 30.0 },
  // OpenAI o1 models
  'o1': { input: 15.0, output: 60.0 },
  'o1-mini': { input: 3.0, output: 12.0 },
  // Legacy Claude models (for backward compatibility)
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
};

export class CostController {
  private state: RateLimitState;
  private totalUsage: TokenUsage;

  constructor(private readonly config: RateLimitConfig) {
    this.state = {
      npc_request_counts: new Map(),
      player_request_counts: new Map(),
      npc_last_replan: new Map(),
      conversation_lengths: new Map(),
    };
    this.totalUsage = {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      estimated_cost_usd: 0,
    };
  }

  /**
   * Check if a dialogue request is allowed based on rate limits
   */
  checkDialogueRateLimit(npcId: string, playerId: string): void {
    const now = Date.now();
    const windowMs = 60000; // 1 minute window

    // Check NPC rate limit
    const npcState = this.state.npc_request_counts.get(npcId);
    if (npcState) {
      if (now - npcState.window_start_ms < windowMs) {
        if (npcState.count >= this.config.max_requests_per_minute_per_npc) {
          throw new AIServiceError(
            `NPC ${npcId} has exceeded rate limit of ${this.config.max_requests_per_minute_per_npc} requests/minute`,
            'RATE_LIMITED',
            { npc_id: npcId, limit: this.config.max_requests_per_minute_per_npc }
          );
        }
      } else {
        // Reset window
        this.state.npc_request_counts.set(npcId, { count: 0, window_start_ms: now });
      }
    }

    // Check player rate limit
    const playerState = this.state.player_request_counts.get(playerId);
    if (playerState) {
      if (now - playerState.window_start_ms < windowMs) {
        if (playerState.count >= this.config.max_requests_per_minute_per_player) {
          throw new AIServiceError(
            `Player ${playerId} has exceeded rate limit of ${this.config.max_requests_per_minute_per_player} requests/minute`,
            'RATE_LIMITED',
            { player_id: playerId, limit: this.config.max_requests_per_minute_per_player }
          );
        }
      } else {
        // Reset window
        this.state.player_request_counts.set(playerId, { count: 0, window_start_ms: now });
      }
    }
  }

  /**
   * Record a dialogue request for rate limiting
   */
  recordDialogueRequest(npcId: string, playerId: string): void {
    const now = Date.now();

    // Update NPC count
    const npcState = this.state.npc_request_counts.get(npcId);
    if (npcState && now - npcState.window_start_ms < 60000) {
      npcState.count++;
    } else {
      this.state.npc_request_counts.set(npcId, { count: 1, window_start_ms: now });
    }

    // Update player count
    const playerState = this.state.player_request_counts.get(playerId);
    if (playerState && now - playerState.window_start_ms < 60000) {
      playerState.count++;
    } else {
      this.state.player_request_counts.set(playerId, { count: 1, window_start_ms: now });
    }
  }

  /**
   * Check if replanning is allowed for an NPC
   */
  checkReplanCooldown(npcId: string): void {
    const lastReplan = this.state.npc_last_replan.get(npcId);
    if (lastReplan) {
      const elapsed = Date.now() - lastReplan;
      if (elapsed < this.config.replan_cooldown_ms) {
        const remainingMs = this.config.replan_cooldown_ms - elapsed;
        const remainingMinutes = Math.ceil(remainingMs / 60000);
        throw new AIServiceError(
          `NPC ${npcId} cannot replan for another ${remainingMinutes} minutes`,
          'REPLAN_COOLDOWN',
          { npc_id: npcId, remaining_ms: remainingMs }
        );
      }
    }
  }

  /**
   * Record a replan event
   */
  recordReplan(npcId: string): void {
    this.state.npc_last_replan.set(npcId, Date.now());
  }

  /**
   * Check if conversation needs auto-summarization
   */
  shouldAutoSummarize(playerId: string, npcId: string): boolean {
    const key = `${playerId}:${npcId}`;
    const length = this.state.conversation_lengths.get(key) ?? 0;
    return length >= this.config.conversation_auto_summarize_threshold;
  }

  /**
   * Increment conversation length
   */
  incrementConversationLength(playerId: string, npcId: string): number {
    const key = `${playerId}:${npcId}`;
    const current = this.state.conversation_lengths.get(key) ?? 0;
    const newLength = current + 1;
    this.state.conversation_lengths.set(key, newLength);
    return newLength;
  }

  /**
   * Reset conversation length after summarization
   */
  resetConversationLength(playerId: string, npcId: string): void {
    const key = `${playerId}:${npcId}`;
    this.state.conversation_lengths.set(key, 0);
  }

  /**
   * Get conversation length
   */
  getConversationLength(playerId: string, npcId: string): number {
    const key = `${playerId}:${npcId}`;
    return this.state.conversation_lengths.get(key) ?? 0;
  }

  /**
   * Calculate cost for token usage
   */
  calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number
  ): TokenUsage {
    const pricing = PRICING[model] ?? { input: 3.0, output: 15.0 };
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;

    return {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      estimated_cost_usd: inputCost + outputCost,
    };
  }

  /**
   * Record token usage and update totals
   */
  recordUsage(usage: TokenUsage): void {
    this.totalUsage.input_tokens += usage.input_tokens;
    this.totalUsage.output_tokens += usage.output_tokens;
    this.totalUsage.total_tokens += usage.total_tokens;
    this.totalUsage.estimated_cost_usd += usage.estimated_cost_usd;
  }

  /**
   * Get total usage statistics
   */
  getTotalUsage(): Readonly<TokenUsage> {
    return { ...this.totalUsage };
  }

  /**
   * Get rate limit status for an NPC
   */
  getNpcRateLimitStatus(npcId: string): {
    requests_in_window: number;
    window_resets_in_ms: number;
  } {
    const state = this.state.npc_request_counts.get(npcId);
    if (!state) {
      return { requests_in_window: 0, window_resets_in_ms: 0 };
    }
    const elapsed = Date.now() - state.window_start_ms;
    return {
      requests_in_window: state.count,
      window_resets_in_ms: Math.max(0, 60000 - elapsed),
    };
  }

  /**
   * Get rate limit status for a player
   */
  getPlayerRateLimitStatus(playerId: string): {
    requests_in_window: number;
    window_resets_in_ms: number;
  } {
    const state = this.state.player_request_counts.get(playerId);
    if (!state) {
      return { requests_in_window: 0, window_resets_in_ms: 0 };
    }
    const elapsed = Date.now() - state.window_start_ms;
    return {
      requests_in_window: state.count,
      window_resets_in_ms: Math.max(0, 60000 - elapsed),
    };
  }

  /**
   * Clear all rate limit state (for testing or reset)
   */
  clearState(): void {
    this.state.npc_request_counts.clear();
    this.state.player_request_counts.clear();
    this.state.npc_last_replan.clear();
    this.state.conversation_lengths.clear();
  }

  /**
   * Validate that output tokens are within limits
   */
  validateTokenLimit(outputTokens: number): void {
    if (outputTokens > this.config.max_tokens_per_response) {
      throw new AIServiceError(
        `Response exceeded token limit: ${outputTokens} > ${this.config.max_tokens_per_response}`,
        'TOKEN_LIMIT_EXCEEDED',
        { actual: outputTokens, limit: this.config.max_tokens_per_response }
      );
    }
  }
}

/**
 * Estimate token count for a string (rough approximation)
 * More accurate would be to use a tokenizer, but this is a reasonable estimate
 */
export function estimateTokenCount(text: string): number {
  // Rough estimate: ~4 characters per token for English text
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within a token budget
 */
export function truncateToTokenBudget(text: string, maxTokens: number): string {
  const estimatedTokens = estimateTokenCount(text);
  if (estimatedTokens <= maxTokens) {
    return text;
  }

  // Approximate character limit
  const charLimit = maxTokens * 4;
  return text.slice(0, charLimit - 3) + '...';
}
