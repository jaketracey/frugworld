/**
 * Memory Summarization Module (Section 6.3)
 * Handles the three-layer memory model:
 * 1. Canonical facts (from blueprint, immutable)
 * 2. Recent summary (5-15 bullets of recent events)
 * 3. Per-player conversation summary
 *
 * Uses deterministic rules for simple events and LLM for conversation summarization.
 */

import OpenAI from 'openai';
import { z } from 'zod';
import {
  NPCMemory,
  ConversationMemory,
  MemorySummaryDelta,
  DialogueResponse,
  TokenUsage,
  AIServiceError,
  AIServiceConfig,
} from './types.js';
import { CostController, truncateToTokenBudget } from './cost-control.js';

// Schema for LLM summarization output
const SummaryOutputSchema = z.object({
  summary_bullets: z.array(z.string()).min(1).max(15),
  key_topics: z.array(z.string()).max(10),
  important_promises: z.array(z.string()).max(5),
  relationship_notes: z.string().max(200).optional(),
});

type SummaryOutput = z.infer<typeof SummaryOutputSchema>;

// Types of events that can trigger deterministic memory updates
export type MemoryEventType =
  | 'gift_received'
  | 'gift_given'
  | 'helped_player'
  | 'helped_by_player'
  | 'trade_completed'
  | 'attacked_player'
  | 'attacked_by_player'
  | 'quest_given'
  | 'quest_completed'
  | 'location_visited'
  | 'item_acquired'
  | 'item_lost'
  | 'relationship_changed'
  | 'secret_shared'
  | 'promise_made'
  | 'promise_broken';

export interface MemoryEvent {
  type: MemoryEventType;
  subject?: string;
  object?: string;
  details?: string;
  timestamp_ms: number;
}

// Configuration for memory limits
const MEMORY_LIMITS = {
  max_recent_summary_items: 15,
  min_recent_summary_items: 5,
  max_conversation_summary_items: 10,
  max_key_topics: 10,
  max_promises: 5,
  summarization_token_budget: 1000,
};

export class MemorySummarizer {
  private client: OpenAI;
  private costController: CostController;
  private model: string;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(
    config: AIServiceConfig,
    costController: CostController
  ) {
    this.client = new OpenAI({
      apiKey: config.openai_api_key,
    });
    this.costController = costController;
    this.model = config.model_summary;
    this.maxRetries = config.max_retries;
    this.retryDelayMs = config.retry_delay_ms;
  }

  // =========================================================================
  // Deterministic Rule-Based Updates
  // =========================================================================

  /**
   * Apply a deterministic memory update based on a game event.
   * This does NOT use LLM - it's pure rule-based logic.
   */
  applyDeterministicUpdate(
    memory: NPCMemory,
    event: MemoryEvent
  ): NPCMemory {
    const newFact = this.eventToFact(event);
    if (!newFact) {
      return memory;
    }

    // Check if a similar fact already exists (avoid duplicates)
    const isDuplicate = memory.recent_summary.some(
      existing => this.factsAreSimilar(existing, newFact)
    );

    if (isDuplicate) {
      return memory;
    }

    // Add new fact and trim if needed
    const updatedSummary = [...memory.recent_summary, newFact];
    const trimmedSummary = this.trimMemory(updatedSummary);

    return {
      ...memory,
      recent_summary: trimmedSummary,
      last_updated_ms: Date.now(),
    };
  }

  /**
   * Apply memory deltas from a dialogue response.
   * This is also deterministic - just adds the provided facts.
   */
  applyDialogueMemoryDelta(
    memory: NPCMemory,
    dialogueResponse: DialogueResponse
  ): NPCMemory {
    if (dialogueResponse.memory_delta.length === 0) {
      return memory;
    }

    const updatedSummary = [...memory.recent_summary, ...dialogueResponse.memory_delta];
    const trimmedSummary = this.trimMemory(updatedSummary);

    return {
      ...memory,
      recent_summary: trimmedSummary,
      last_updated_ms: Date.now(),
    };
  }

  /**
   * Convert an event to a memory fact string.
   */
  private eventToFact(event: MemoryEvent): string | null {
    const timestamp = new Date(event.timestamp_ms).toLocaleDateString();

    switch (event.type) {
      case 'gift_received':
        return `Received ${event.object ?? 'a gift'} from ${event.subject ?? 'someone'} (${timestamp})`;

      case 'gift_given':
        return `Gave ${event.object ?? 'a gift'} to ${event.subject ?? 'someone'} (${timestamp})`;

      case 'helped_player':
        return `Helped player with ${event.details ?? 'something'} (${timestamp})`;

      case 'helped_by_player':
        return `Player helped with ${event.details ?? 'something'} (${timestamp})`;

      case 'trade_completed':
        return `Traded ${event.details ?? 'items'} with ${event.subject ?? 'player'} (${timestamp})`;

      case 'attacked_player':
        return `Attacked player: ${event.details ?? 'in conflict'} (${timestamp})`;

      case 'attacked_by_player':
        return `Was attacked by player: ${event.details ?? 'in conflict'} (${timestamp})`;

      case 'quest_given':
        return `Gave quest "${event.object ?? 'untitled'}" to player (${timestamp})`;

      case 'quest_completed':
        return `Player completed quest "${event.object ?? 'untitled'}" (${timestamp})`;

      case 'location_visited':
        return `Visited ${event.subject ?? 'a location'} (${timestamp})`;

      case 'item_acquired':
        return `Acquired ${event.object ?? 'an item'} (${timestamp})`;

      case 'item_lost':
        return `Lost ${event.object ?? 'an item'} (${timestamp})`;

      case 'relationship_changed':
        return `Relationship with ${event.subject ?? 'someone'} changed: ${event.details ?? 'unknown'} (${timestamp})`;

      case 'secret_shared':
        return `Shared secret with player: ${event.details ?? 'something important'} (${timestamp})`;

      case 'promise_made':
        return `Promised player: ${event.details ?? 'something'} (${timestamp})`;

      case 'promise_broken':
        return `Broke promise: ${event.details ?? 'something'} (${timestamp})`;

      default:
        return null;
    }
  }

  /**
   * Check if two facts are similar enough to be considered duplicates.
   */
  private factsAreSimilar(fact1: string, fact2: string): boolean {
    // Simple similarity check - could be enhanced
    const normalize = (s: string) =>
      s.toLowerCase().replace(/\([^)]*\)/g, '').trim();

    return normalize(fact1) === normalize(fact2);
  }

  /**
   * Trim memory to stay within limits.
   * Removes oldest items (first in array) to maintain limit.
   */
  private trimMemory(summary: string[]): string[] {
    if (summary.length <= MEMORY_LIMITS.max_recent_summary_items) {
      return summary;
    }

    // Keep only the most recent items
    return summary.slice(-MEMORY_LIMITS.max_recent_summary_items);
  }

  // =========================================================================
  // LLM-Based Conversation Summarization
  // =========================================================================

  /**
   * Summarize a conversation using LLM.
   * Called when conversation ends or reaches auto-summarize threshold.
   */
  async summarizeConversation(
    npcName: string,
    conversationHistory: Array<{ speaker: 'player' | 'npc'; text: string }>,
    existingSummary: ConversationMemory
  ): Promise<{ memory: ConversationMemory; usage: TokenUsage }> {
    if (conversationHistory.length === 0) {
      return {
        memory: existingSummary,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          estimated_cost_usd: 0,
        },
      };
    }

    const prompt = this.buildSummarizationPrompt(
      npcName,
      conversationHistory,
      existingSummary
    );

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: this.getSummarizationSystemPrompt() },
            { role: 'user', content: prompt },
          ],
          max_tokens: 500,
        });

        // Extract text content from response
        const textContent = response.choices[0]?.message?.content;
        if (!textContent) {
          throw new AIServiceError(
            'No text content in summarization response',
            'PARSE_ERROR'
          );
        }

        // Parse and validate
        const summaryOutput = this.parseAndValidateSummary(textContent);

        // Calculate token usage
        const usage = this.costController.calculateCost(
          this.model,
          response.usage?.prompt_tokens ?? 0,
          response.usage?.completion_tokens ?? 0
        );
        this.costController.recordUsage(usage);

        // Merge with existing summary
        const updatedMemory: ConversationMemory = {
          ...existingSummary,
          summary: this.mergeAndTrimSummaries(
            existingSummary.summary,
            summaryOutput.summary_bullets
          ),
          key_topics_discussed: this.mergeAndDedup(
            existingSummary.key_topics_discussed,
            summaryOutput.key_topics,
            MEMORY_LIMITS.max_key_topics
          ),
          promises_made: this.mergeAndDedup(
            existingSummary.promises_made,
            summaryOutput.important_promises,
            MEMORY_LIMITS.max_promises
          ),
          last_updated_ms: Date.now(),
        };

        return { memory: updatedMemory, usage };
      } catch (error) {
        lastError = error as Error;
        if (error instanceof AIServiceError) {
          if (error.code === 'PARSE_ERROR' || error.code === 'VALIDATION_ERROR') {
            throw error;
          }
        }
        if (attempt < this.maxRetries - 1) {
          await this.sleep(this.retryDelayMs * (attempt + 1));
        }
      }
    }

    throw new AIServiceError(
      `Failed to summarize conversation after ${this.maxRetries} attempts: ${lastError?.message}`,
      'API_ERROR',
      { original_error: lastError?.message }
    );
  }

  /**
   * Compress NPC recent memory when it gets too long.
   * This consolidates older facts into more abstract summaries.
   */
  async compressMemory(
    memory: NPCMemory,
    npcName: string
  ): Promise<{ memory: NPCMemory; usage: TokenUsage }> {
    if (memory.recent_summary.length <= MEMORY_LIMITS.min_recent_summary_items) {
      return {
        memory,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          estimated_cost_usd: 0,
        },
      };
    }

    const prompt = this.buildCompressionPrompt(npcName, memory);

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: this.getCompressionSystemPrompt() },
          { role: 'user', content: prompt },
        ],
        max_tokens: 400,
      });

      const textContent = response.choices[0]?.message?.content;
      if (!textContent) {
        throw new AIServiceError(
          'No text content in compression response',
          'PARSE_ERROR'
        );
      }

      const compressed = this.parseCompressedMemory(textContent);

      const usage = this.costController.calculateCost(
        this.model,
        response.usage?.prompt_tokens ?? 0,
        response.usage?.completion_tokens ?? 0
      );
      this.costController.recordUsage(usage);

      return {
        memory: {
          ...memory,
          recent_summary: compressed,
          last_updated_ms: Date.now(),
        },
        usage,
      };
    } catch (error) {
      // If compression fails, just trim the old way
      console.warn('Memory compression failed, using simple trim:', error);
      return {
        memory: {
          ...memory,
          recent_summary: this.trimMemory(memory.recent_summary),
          last_updated_ms: Date.now(),
        },
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          estimated_cost_usd: 0,
        },
      };
    }
  }

  private getSummarizationSystemPrompt(): string {
    return `You are a memory summarizer for an NPC in a game. Your task is to create concise, factual summaries of conversations that capture the essential information.

REQUIREMENTS:
1. Focus on facts, not feelings or interpretations
2. Capture key topics discussed
3. Note any promises or commitments made
4. Keep bullets short and scannable
5. Preserve important details like names, locations, items

OUTPUT FORMAT:
Respond with ONLY valid JSON:
{
  "summary_bullets": ["Short factual statement 1", "Short factual statement 2"],
  "key_topics": ["topic1", "topic2"],
  "important_promises": ["promise1"],
  "relationship_notes": "Brief note on relationship state (optional)"
}`;
  }

  private getCompressionSystemPrompt(): string {
    return `You are a memory compressor for an NPC in a game. Your task is to consolidate a list of memory facts into fewer, more general statements while preserving important information.

REQUIREMENTS:
1. Merge similar or related facts into single statements
2. Keep the most important and recent information
3. Maintain factual accuracy
4. Target 5-8 compressed facts from the input
5. Preserve names, places, and significant events

OUTPUT FORMAT:
Respond with a JSON array of strings:
["Compressed fact 1", "Compressed fact 2", ...]`;
  }

  private buildSummarizationPrompt(
    npcName: string,
    history: Array<{ speaker: 'player' | 'npc'; text: string }>,
    existing: ConversationMemory
  ): string {
    const parts: string[] = [];

    parts.push(`Summarize this conversation with NPC "${npcName}":\n`);

    // Add existing context if any
    if (existing.summary.length > 0) {
      parts.push('PREVIOUS CONTEXT:');
      existing.summary.slice(-3).forEach(s => parts.push(`- ${s}`));
      parts.push('');
    }

    // Add conversation
    parts.push('CONVERSATION:');
    history.forEach(turn => {
      const speaker = turn.speaker === 'player' ? 'Player' : npcName;
      parts.push(`${speaker}: "${turn.text}"`);
    });

    parts.push('\nSummarize the key points, topics, and any promises made.');

    return truncateToTokenBudget(
      parts.join('\n'),
      MEMORY_LIMITS.summarization_token_budget
    );
  }

  private buildCompressionPrompt(npcName: string, memory: NPCMemory): string {
    const parts: string[] = [];

    parts.push(`Compress these memory facts for NPC "${npcName}" into fewer, consolidated statements:\n`);

    memory.recent_summary.forEach((fact, i) => {
      parts.push(`${i + 1}. ${fact}`);
    });

    parts.push('\nOutput 5-8 compressed facts as a JSON array.');

    return parts.join('\n');
  }

  private parseAndValidateSummary(responseText: string): SummaryOutput {
    let jsonStr = responseText.trim();

    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch?.[1]) {
      jsonStr = jsonMatch[1].trim();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new AIServiceError(
        'Failed to parse summary response as JSON',
        'PARSE_ERROR',
        { response_preview: jsonStr.slice(0, 200) }
      );
    }

    const result = SummaryOutputSchema.safeParse(parsed);
    if (!result.success) {
      throw new AIServiceError(
        `Summary validation failed: ${result.error.message}`,
        'VALIDATION_ERROR',
        { validation_errors: result.error.errors }
      );
    }

    return result.data;
  }

  private parseCompressedMemory(responseText: string): string[] {
    let jsonStr = responseText.trim();

    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch?.[1]) {
      jsonStr = jsonMatch[1].trim();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new AIServiceError(
        'Failed to parse compression response as JSON',
        'PARSE_ERROR',
        { response_preview: jsonStr.slice(0, 200) }
      );
    }

    if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) {
      throw new AIServiceError(
        'Compression output is not a string array',
        'VALIDATION_ERROR'
      );
    }

    return parsed.slice(0, MEMORY_LIMITS.max_recent_summary_items);
  }

  private mergeAndTrimSummaries(existing: string[], newItems: string[]): string[] {
    // Keep most recent from existing, add new items
    const maxExisting = Math.max(0, MEMORY_LIMITS.max_conversation_summary_items - newItems.length);
    const trimmedExisting = existing.slice(-maxExisting);
    return [...trimmedExisting, ...newItems].slice(-MEMORY_LIMITS.max_conversation_summary_items);
  }

  private mergeAndDedup(existing: string[], newItems: string[], max: number): string[] {
    const set = new Set([...existing, ...newItems]);
    return Array.from(set).slice(-max);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create an empty NPC memory object
 */
export function createEmptyMemory(npcId: string, canonicalFacts: string[]): NPCMemory {
  return {
    npc_id: npcId,
    canonical_facts: canonicalFacts,
    recent_summary: [],
    last_updated_ms: Date.now(),
  };
}

/**
 * Create an empty conversation memory object
 */
export function createEmptyConversationMemory(
  playerId: string,
  npcId: string
): ConversationMemory {
  return {
    player_id: playerId,
    npc_id: npcId,
    summary: [],
    key_topics_discussed: [],
    promises_made: [],
    last_updated_ms: Date.now(),
  };
}
