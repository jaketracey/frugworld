/**
 * Tests for the Memory Summarization module
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MemorySummarizer,
  createEmptyMemory,
  createEmptyConversationMemory,
  type MemoryEvent,
} from './memory.js';
import { CostController } from './cost-control.js';
import { AIServiceConfig, NPCMemory, DialogueResponse } from './types.js';

// Mock the OpenAI SDK
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary_bullets: ['Player asked about swords', 'NPC offered to forge a longsword'],
                    key_topics: ['weapons', 'crafting'],
                    important_promises: ['Will forge sword in 3 days'],
                    relationship_notes: 'Positive interaction, potential customer',
                  }),
                },
              },
            ],
            usage: {
              prompt_tokens: 500,
              completion_tokens: 100,
            },
          }),
        },
      },
    })),
  };
});

const testConfig: AIServiceConfig = {
  openai_api_key: 'test-key',
  model_blueprint: 'gpt-4o',
  model_dialogue: 'gpt-4o-mini',
  model_summary: 'gpt-4o-mini',
  model_replan: 'gpt-4o',
  rate_limits: {
    max_requests_per_minute_per_npc: 10,
    max_requests_per_minute_per_player: 30,
    max_tokens_per_response: 500,
    conversation_auto_summarize_threshold: 20,
    replan_cooldown_ms: 3600000,
  },
  enable_cost_tracking: true,
  max_retries: 1,
  retry_delay_ms: 100,
};

describe('MemorySummarizer - Deterministic Updates', () => {
  let summarizer: MemorySummarizer;
  let costController: CostController;

  beforeEach(() => {
    costController = new CostController(testConfig.rate_limits);
    summarizer = new MemorySummarizer(testConfig, costController);
  });

  describe('applyDeterministicUpdate', () => {
    it('should add gift_received event to memory', () => {
      const memory = createEmptyMemory('npc_1', ['Original fact']);

      const event: MemoryEvent = {
        type: 'gift_received',
        subject: 'Player',
        object: 'gold coins',
        timestamp_ms: Date.now(),
      };

      const updated = summarizer.applyDeterministicUpdate(memory, event);

      expect(updated.recent_summary.length).toBe(1);
      expect(updated.recent_summary[0]).toContain('gold coins');
      expect(updated.recent_summary[0]).toContain('Player');
    });

    it('should add trade_completed event', () => {
      const memory = createEmptyMemory('npc_1', []);

      const event: MemoryEvent = {
        type: 'trade_completed',
        subject: 'merchant',
        details: 'exchanged sword for shield',
        timestamp_ms: Date.now(),
      };

      const updated = summarizer.applyDeterministicUpdate(memory, event);

      expect(updated.recent_summary[0]).toContain('exchanged sword for shield');
    });

    it('should add quest_given event', () => {
      const memory = createEmptyMemory('npc_1', []);

      const event: MemoryEvent = {
        type: 'quest_given',
        object: 'Find the Lost Artifact',
        timestamp_ms: Date.now(),
      };

      const updated = summarizer.applyDeterministicUpdate(memory, event);

      expect(updated.recent_summary[0]).toContain('Find the Lost Artifact');
    });

    it('should not add duplicate facts', () => {
      const now = Date.now();
      const memory: NPCMemory = {
        npc_id: 'npc_1',
        canonical_facts: [],
        recent_summary: ['Received gold coins from Player'],
        last_updated_ms: now,
      };

      const event: MemoryEvent = {
        type: 'gift_received',
        subject: 'Player',
        object: 'gold coins',
        timestamp_ms: now,
      };

      const updated = summarizer.applyDeterministicUpdate(memory, event);

      // Should not add duplicate (ignoring timestamp in parentheses)
      expect(updated.recent_summary.length).toBe(1);
    });

    it('should trim memory when exceeding max items', () => {
      const memory: NPCMemory = {
        npc_id: 'npc_1',
        canonical_facts: [],
        recent_summary: Array.from({ length: 15 }, (_, i) => `Fact ${i + 1}`),
        last_updated_ms: Date.now(),
      };

      const event: MemoryEvent = {
        type: 'location_visited',
        subject: 'New Location',
        timestamp_ms: Date.now(),
      };

      const updated = summarizer.applyDeterministicUpdate(memory, event);

      expect(updated.recent_summary.length).toBe(15);
      expect(updated.recent_summary[0]).not.toBe('Fact 1'); // First fact should be trimmed
    });
  });

  describe('applyDialogueMemoryDelta', () => {
    it('should add memory delta from dialogue response', () => {
      const memory = createEmptyMemory('npc_1', []);

      const dialogueResponse: DialogueResponse = {
        text: 'Hello there!',
        intent_tags: ['greeting'],
        memory_delta: ['Player introduced themselves', 'Player seems friendly'],
        actions: [],
      };

      const updated = summarizer.applyDialogueMemoryDelta(memory, dialogueResponse);

      expect(updated.recent_summary).toContain('Player introduced themselves');
      expect(updated.recent_summary).toContain('Player seems friendly');
    });

    it('should not modify memory when delta is empty', () => {
      const memory = createEmptyMemory('npc_1', []);
      memory.recent_summary = ['Existing fact'];

      const dialogueResponse: DialogueResponse = {
        text: 'Hello!',
        intent_tags: ['greeting'],
        memory_delta: [],
        actions: [],
      };

      const updated = summarizer.applyDialogueMemoryDelta(memory, dialogueResponse);

      expect(updated).toBe(memory); // Same reference
    });
  });

  describe('All event types', () => {
    const eventTypes: Array<{ type: MemoryEvent['type']; expectedContent: string }> = [
      { type: 'gift_received', expectedContent: 'Received' },
      { type: 'gift_given', expectedContent: 'Gave' },
      { type: 'helped_player', expectedContent: 'Helped player' },
      { type: 'helped_by_player', expectedContent: 'Player helped' },
      { type: 'trade_completed', expectedContent: 'Traded' },
      { type: 'attacked_player', expectedContent: 'Attacked player' },
      { type: 'attacked_by_player', expectedContent: 'Was attacked' },
      { type: 'quest_given', expectedContent: 'Gave quest' },
      { type: 'quest_completed', expectedContent: 'completed quest' },
      { type: 'location_visited', expectedContent: 'Visited' },
      { type: 'item_acquired', expectedContent: 'Acquired' },
      { type: 'item_lost', expectedContent: 'Lost' },
      { type: 'relationship_changed', expectedContent: 'Relationship' },
      { type: 'secret_shared', expectedContent: 'Shared secret' },
      { type: 'promise_made', expectedContent: 'Promised' },
      { type: 'promise_broken', expectedContent: 'Broke promise' },
    ];

    eventTypes.forEach(({ type, expectedContent }) => {
      it(`should handle ${type} event`, () => {
        const memory = createEmptyMemory('npc_1', []);

        const event: MemoryEvent = {
          type,
          subject: 'test subject',
          object: 'test object',
          details: 'test details',
          timestamp_ms: Date.now(),
        };

        const updated = summarizer.applyDeterministicUpdate(memory, event);

        expect(updated.recent_summary[0]).toContain(expectedContent);
      });
    });
  });
});

describe('MemorySummarizer - LLM Summarization', () => {
  let summarizer: MemorySummarizer;
  let costController: CostController;

  beforeEach(() => {
    costController = new CostController(testConfig.rate_limits);
    summarizer = new MemorySummarizer(testConfig, costController);
  });

  describe('summarizeConversation', () => {
    it('should summarize conversation history', async () => {
      const conversationMemory = createEmptyConversationMemory('player_1', 'npc_1');

      const history = [
        { speaker: 'player' as const, text: 'Hello!' },
        { speaker: 'npc' as const, text: 'Greetings traveler!' },
      ];

      const { memory, usage } = await summarizer.summarizeConversation(
        'Test NPC',
        history,
        conversationMemory
      );

      expect(memory.summary.length).toBeGreaterThan(0);
      expect(memory.key_topics_discussed).toContain('weapons');
      expect(memory.promises_made).toContain('Will forge sword in 3 days');
      expect(usage.total_tokens).toBeGreaterThan(0);
    });

    it('should return unchanged memory for empty history', async () => {
      const conversationMemory = createEmptyConversationMemory('player_1', 'npc_1');

      const { memory, usage } = await summarizer.summarizeConversation(
        'Test NPC',
        [],
        conversationMemory
      );

      expect(memory).toBe(conversationMemory);
      expect(usage.total_tokens).toBe(0);
    });

    it('should merge with existing summary', async () => {
      const conversationMemory = createEmptyConversationMemory('player_1', 'npc_1');
      conversationMemory.summary = ['Previous summary item'];
      conversationMemory.key_topics_discussed = ['old_topic'];

      const history = [
        { speaker: 'player' as const, text: 'Hello again!' },
        { speaker: 'npc' as const, text: 'Welcome back!' },
      ];

      const { memory } = await summarizer.summarizeConversation(
        'Test NPC',
        history,
        conversationMemory
      );

      // Should include both old and new topics
      expect(memory.key_topics_discussed).toContain('old_topic');
      expect(memory.key_topics_discussed).toContain('weapons');
    });
  });
});

describe('Helper Functions', () => {
  describe('createEmptyMemory', () => {
    it('should create empty memory with canonical facts', () => {
      const memory = createEmptyMemory('npc_1', ['Fact 1', 'Fact 2']);

      expect(memory.npc_id).toBe('npc_1');
      expect(memory.canonical_facts).toEqual(['Fact 1', 'Fact 2']);
      expect(memory.recent_summary).toEqual([]);
      expect(memory.last_updated_ms).toBeGreaterThan(0);
    });
  });

  describe('createEmptyConversationMemory', () => {
    it('should create empty conversation memory', () => {
      const memory = createEmptyConversationMemory('player_1', 'npc_1');

      expect(memory.player_id).toBe('player_1');
      expect(memory.npc_id).toBe('npc_1');
      expect(memory.summary).toEqual([]);
      expect(memory.key_topics_discussed).toEqual([]);
      expect(memory.promises_made).toEqual([]);
      expect(memory.last_updated_ms).toBeGreaterThan(0);
    });
  });
});
