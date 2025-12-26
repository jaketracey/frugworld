/**
 * Tests for the CostController module
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CostController,
  estimateTokenCount,
  truncateToTokenBudget,
} from './cost-control.js';
import { RateLimitConfig, AIServiceError } from './types.js';

const testConfig: RateLimitConfig = {
  max_requests_per_minute_per_npc: 5,
  max_requests_per_minute_per_player: 10,
  max_tokens_per_response: 500,
  conversation_auto_summarize_threshold: 10,
  replan_cooldown_ms: 60000, // 1 minute for testing
};

describe('CostController', () => {
  let controller: CostController;

  beforeEach(() => {
    controller = new CostController(testConfig);
  });

  describe('NPC Rate Limiting', () => {
    it('should allow requests within rate limit', () => {
      expect(() => {
        controller.checkDialogueRateLimit('npc_1', 'player_1');
      }).not.toThrow();
    });

    it('should track NPC request counts', () => {
      for (let i = 0; i < 3; i++) {
        controller.recordDialogueRequest('npc_1', 'player_1');
      }

      const status = controller.getNpcRateLimitStatus('npc_1');
      expect(status.requests_in_window).toBe(3);
    });

    it('should throw when NPC rate limit exceeded', () => {
      // Record max requests
      for (let i = 0; i < testConfig.max_requests_per_minute_per_npc; i++) {
        controller.recordDialogueRequest('npc_1', 'player_1');
      }

      // Next check should fail
      expect(() => {
        controller.checkDialogueRateLimit('npc_1', 'player_1');
      }).toThrow(AIServiceError);
    });

    it('should track different NPCs independently', () => {
      for (let i = 0; i < 3; i++) {
        controller.recordDialogueRequest('npc_1', 'player_1');
      }
      for (let i = 0; i < 2; i++) {
        controller.recordDialogueRequest('npc_2', 'player_1');
      }

      expect(controller.getNpcRateLimitStatus('npc_1').requests_in_window).toBe(3);
      expect(controller.getNpcRateLimitStatus('npc_2').requests_in_window).toBe(2);
    });
  });

  describe('Player Rate Limiting', () => {
    it('should throw when player rate limit exceeded', () => {
      // Record max requests from player to different NPCs
      for (let i = 0; i < testConfig.max_requests_per_minute_per_player; i++) {
        controller.recordDialogueRequest(`npc_${i}`, 'player_1');
      }

      // Next check should fail
      expect(() => {
        controller.checkDialogueRateLimit('npc_999', 'player_1');
      }).toThrow(AIServiceError);
    });

    it('should track player requests across NPCs', () => {
      controller.recordDialogueRequest('npc_1', 'player_1');
      controller.recordDialogueRequest('npc_2', 'player_1');
      controller.recordDialogueRequest('npc_3', 'player_1');

      const status = controller.getPlayerRateLimitStatus('player_1');
      expect(status.requests_in_window).toBe(3);
    });
  });

  describe('Replan Cooldown', () => {
    it('should allow first replan', () => {
      expect(() => {
        controller.checkReplanCooldown('npc_1');
      }).not.toThrow();
    });

    it('should block replan during cooldown', () => {
      controller.recordReplan('npc_1');

      expect(() => {
        controller.checkReplanCooldown('npc_1');
      }).toThrow(AIServiceError);
    });

    it('should track replan per NPC independently', () => {
      controller.recordReplan('npc_1');

      expect(() => {
        controller.checkReplanCooldown('npc_2');
      }).not.toThrow();
    });
  });

  describe('Conversation Length', () => {
    it('should track conversation length', () => {
      controller.incrementConversationLength('player_1', 'npc_1');
      controller.incrementConversationLength('player_1', 'npc_1');
      controller.incrementConversationLength('player_1', 'npc_1');

      expect(controller.getConversationLength('player_1', 'npc_1')).toBe(3);
    });

    it('should trigger summarization at threshold', () => {
      for (let i = 0; i < testConfig.conversation_auto_summarize_threshold; i++) {
        controller.incrementConversationLength('player_1', 'npc_1');
      }

      expect(controller.shouldAutoSummarize('player_1', 'npc_1')).toBe(true);
    });

    it('should reset conversation length', () => {
      for (let i = 0; i < 5; i++) {
        controller.incrementConversationLength('player_1', 'npc_1');
      }

      controller.resetConversationLength('player_1', 'npc_1');

      expect(controller.getConversationLength('player_1', 'npc_1')).toBe(0);
      expect(controller.shouldAutoSummarize('player_1', 'npc_1')).toBe(false);
    });
  });

  describe('Token Cost Calculation', () => {
    it('should calculate cost correctly for claude-sonnet-4-20250514', () => {
      const usage = controller.calculateCost(
        'claude-sonnet-4-20250514',
        1000,  // input tokens
        500    // output tokens
      );

      expect(usage.input_tokens).toBe(1000);
      expect(usage.output_tokens).toBe(500);
      expect(usage.total_tokens).toBe(1500);
      // $3/1M input + $15/1M output
      // 1000 * 3 / 1M + 500 * 15 / 1M = 0.003 + 0.0075 = 0.0105
      expect(usage.estimated_cost_usd).toBeCloseTo(0.0105, 4);
    });

    it('should track cumulative usage', () => {
      controller.recordUsage({
        input_tokens: 1000,
        output_tokens: 500,
        total_tokens: 1500,
        estimated_cost_usd: 0.01,
      });

      controller.recordUsage({
        input_tokens: 2000,
        output_tokens: 1000,
        total_tokens: 3000,
        estimated_cost_usd: 0.02,
      });

      const total = controller.getTotalUsage();
      expect(total.input_tokens).toBe(3000);
      expect(total.output_tokens).toBe(1500);
      expect(total.total_tokens).toBe(4500);
      expect(total.estimated_cost_usd).toBeCloseTo(0.03, 4);
    });
  });

  describe('Token Limit Validation', () => {
    it('should pass for tokens within limit', () => {
      expect(() => {
        controller.validateTokenLimit(400);
      }).not.toThrow();
    });

    it('should throw for tokens exceeding limit', () => {
      expect(() => {
        controller.validateTokenLimit(600);
      }).toThrow(AIServiceError);
    });
  });

  describe('Clear State', () => {
    it('should clear all rate limit state', () => {
      controller.recordDialogueRequest('npc_1', 'player_1');
      controller.recordReplan('npc_1');
      controller.incrementConversationLength('player_1', 'npc_1');

      controller.clearState();

      expect(controller.getNpcRateLimitStatus('npc_1').requests_in_window).toBe(0);
      expect(controller.getConversationLength('player_1', 'npc_1')).toBe(0);
      expect(() => controller.checkReplanCooldown('npc_1')).not.toThrow();
    });
  });
});

describe('estimateTokenCount', () => {
  it('should estimate tokens for short text', () => {
    const text = 'Hello world';
    const estimate = estimateTokenCount(text);
    // ~4 chars per token, 11 chars -> ~3 tokens
    expect(estimate).toBeGreaterThan(0);
    expect(estimate).toBeLessThan(10);
  });

  it('should estimate tokens for longer text', () => {
    const text = 'This is a longer piece of text that should result in more tokens being estimated for the input.';
    const estimate = estimateTokenCount(text);
    // ~95 chars -> ~24 tokens
    expect(estimate).toBeGreaterThan(15);
    expect(estimate).toBeLessThan(40);
  });
});

describe('truncateToTokenBudget', () => {
  it('should not truncate text within budget', () => {
    const text = 'Short text';
    const result = truncateToTokenBudget(text, 100);
    expect(result).toBe(text);
  });

  it('should truncate text exceeding budget', () => {
    const text = 'This is a much longer piece of text that definitely exceeds our tiny token budget and should be truncated.';
    const result = truncateToTokenBudget(text, 5);
    expect(result.length).toBeLessThan(text.length);
    expect(result.endsWith('...')).toBe(true);
  });
});
