/**
 * Tests for the Tools module
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ToolExecutor,
  InMemoryDataStore,
  createToolFunctions,
  TOOL_DEFINITIONS,
} from './tools.js';
import { NPCBlueprint, NPCMemory, AIServiceError } from './types.js';

const testBlueprint: NPCBlueprint = {
  npc_id: 'npc_test_001',
  archetype_id: 'test_archetype',
  identity: {
    name: 'Test NPC',
    age: 30,
    role: 'merchant',
    appearance: ['tall', 'brown hair'],
  },
  personality: {
    traits: ['friendly', 'curious'],
    values: ['honesty', 'hard work'],
    fears: ['failure'],
    desires: ['wealth'],
  },
  backstory: [
    'Born in a small village',
    'Learned trading from parents',
    'Traveled the world',
  ],
  relationships: [],
  voice_style: {
    tone: 'friendly',
    vocabulary_level: 'moderate',
    speech_patterns: ['uses trade terms'],
  },
  constraints: {
    taboo_topics: [],
    safety_constraints: [],
    lore_constraints: [],
  },
  truth_anchors: ['Is a merchant', 'Values honesty'],
  version: 1,
  created_at_ms: Date.now(),
};

const testMemory: NPCMemory = {
  npc_id: 'npc_test_001',
  canonical_facts: ['Born in a small village'],
  recent_summary: ['Met player yesterday', 'Sold them supplies'],
  last_updated_ms: Date.now(),
};

describe('InMemoryDataStore', () => {
  let store: InMemoryDataStore;

  beforeEach(() => {
    store = new InMemoryDataStore();
  });

  describe('Blueprint operations', () => {
    it('should save and retrieve blueprint', async () => {
      await store.saveBlueprint(testBlueprint);
      const retrieved = await store.getBlueprint('npc_test_001');
      expect(retrieved).toEqual(testBlueprint);
    });

    it('should return null for non-existent blueprint', async () => {
      const retrieved = await store.getBlueprint('nonexistent');
      expect(retrieved).toBeNull();
    });
  });

  describe('Relationship operations', () => {
    it('should save and retrieve relationship', async () => {
      const relationship = {
        player_id: 'player_1',
        npc_id: 'npc_1',
        affinity: 50,
        trust: 30,
        flags: {
          offended: false,
          owes_favor: true,
          friend: false,
          hostile: false,
        },
        conversation_summary: ['Had a good chat'],
        interaction_count: 5,
        last_interaction_ms: Date.now(),
      };

      await store.saveRelationship(relationship);
      const retrieved = await store.getRelationship('player_1', 'npc_1');
      expect(retrieved).toEqual(relationship);
    });

    it('should return null for non-existent relationship', async () => {
      const retrieved = await store.getRelationship('player_1', 'nonexistent');
      expect(retrieved).toBeNull();
    });

    it('should update relationship with delta', async () => {
      const updated = await store.updateRelationship('player_1', 'npc_1', {
        affinity_delta: 10,
        trust_delta: -5,
        flag_changes: { friend: true },
        new_summary_items: ['Became friends'],
      });

      expect(updated.affinity).toBe(10);
      expect(updated.trust).toBe(-5);
      expect(updated.flags.friend).toBe(true);
      expect(updated.conversation_summary).toContain('Became friends');
      expect(updated.interaction_count).toBe(1);
    });

    it('should clamp relationship values to -100/100', async () => {
      // First update to get high affinity
      await store.updateRelationship('player_1', 'npc_1', {
        affinity_delta: 90,
      });

      // Second update should clamp
      const updated = await store.updateRelationship('player_1', 'npc_1', {
        affinity_delta: 50,
      });

      expect(updated.affinity).toBe(100); // Clamped
    });
  });

  describe('Memory operations', () => {
    it('should update memory with add_facts', async () => {
      store.setMemory(testMemory);

      const updated = await store.updateMemory('npc_test_001', {
        add_facts: ['New fact 1', 'New fact 2'],
      });

      expect(updated.recent_summary).toContain('New fact 1');
      expect(updated.recent_summary).toContain('New fact 2');
      expect(updated.recent_summary).toContain('Met player yesterday');
    });

    it('should update memory with remove_facts', async () => {
      store.setMemory(testMemory);

      const updated = await store.updateMemory('npc_test_001', {
        remove_facts: ['Met player yesterday'],
      });

      expect(updated.recent_summary).not.toContain('Met player yesterday');
      expect(updated.recent_summary).toContain('Sold them supplies');
    });

    it('should update memory with replace_all', async () => {
      store.setMemory(testMemory);

      const updated = await store.updateMemory('npc_test_001', {
        replace_all: ['Completely new memory'],
      });

      expect(updated.recent_summary).toEqual(['Completely new memory']);
    });

    it('should throw for non-existent memory', async () => {
      await expect(
        store.updateMemory('nonexistent', { add_facts: ['test'] })
      ).rejects.toThrow(AIServiceError);
    });
  });

  describe('Local facts operations', () => {
    it('should aggregate facts from multiple chunks', async () => {
      store.setLocalFacts('zone_1', 'chunk_1', {
        zone_id: 'zone_1',
        chunk_ids: ['chunk_1'],
        facts: ['Fact A'],
        threats: ['Wolf pack'],
        opportunities: [],
      });

      store.setLocalFacts('zone_1', 'chunk_2', {
        zone_id: 'zone_1',
        chunk_ids: ['chunk_2'],
        facts: ['Fact B'],
        threats: [],
        opportunities: ['Treasure chest'],
      });

      const facts = await store.getLocalFacts('zone_1', ['chunk_1', 'chunk_2']);

      expect(facts.facts).toContain('Fact A');
      expect(facts.facts).toContain('Fact B');
      expect(facts.threats).toContain('Wolf pack');
      expect(facts.opportunities).toContain('Treasure chest');
    });

    it('should deduplicate facts', async () => {
      store.setLocalFacts('zone_1', 'chunk_1', {
        zone_id: 'zone_1',
        chunk_ids: ['chunk_1'],
        facts: ['Common fact'],
        threats: [],
        opportunities: [],
      });

      store.setLocalFacts('zone_1', 'chunk_2', {
        zone_id: 'zone_1',
        chunk_ids: ['chunk_2'],
        facts: ['Common fact'],
        threats: [],
        opportunities: [],
      });

      const facts = await store.getLocalFacts('zone_1', ['chunk_1', 'chunk_2']);

      // Should only appear once
      expect(facts.facts.filter(f => f === 'Common fact').length).toBe(1);
    });
  });

  describe('Clear operation', () => {
    it('should clear all data', async () => {
      await store.saveBlueprint(testBlueprint);
      store.setMemory(testMemory);

      store.clear();

      expect(await store.getBlueprint('npc_test_001')).toBeNull();
      expect(await store.getMemory('npc_test_001')).toBeNull();
    });
  });
});

describe('ToolExecutor', () => {
  let store: InMemoryDataStore;
  let executor: ToolExecutor;

  beforeEach(() => {
    store = new InMemoryDataStore();
    executor = new ToolExecutor(store);
  });

  describe('getNpcBlueprint', () => {
    it('should return blueprint when exists', async () => {
      await store.saveBlueprint(testBlueprint);

      const result = await executor.getNpcBlueprint({ npc_id: 'npc_test_001' });
      expect(result.identity.name).toBe('Test NPC');
    });

    it('should throw when blueprint not found', async () => {
      await expect(
        executor.getNpcBlueprint({ npc_id: 'nonexistent' })
      ).rejects.toThrow(AIServiceError);
    });
  });

  describe('getRelationship', () => {
    it('should return default relationship when none exists', async () => {
      const result = await executor.getRelationship({
        player_id: 'player_1',
        npc_id: 'npc_1',
      });

      expect(result.affinity).toBe(0);
      expect(result.trust).toBe(0);
      expect(result.interaction_count).toBe(0);
    });
  });

  describe('executeTool', () => {
    it('should execute get_npc_blueprint tool', async () => {
      await store.saveBlueprint(testBlueprint);

      const result = await executor.executeTool('get_npc_blueprint', {
        npc_id: 'npc_test_001',
      });

      expect(result).toHaveProperty('identity');
    });

    it('should throw for unknown tool', async () => {
      await expect(
        executor.executeTool('unknown_tool', {})
      ).rejects.toThrow(AIServiceError);
    });
  });

  describe('getToolDefinitions', () => {
    it('should return all tool definitions', () => {
      const definitions = executor.getToolDefinitions();

      expect(definitions).toHaveProperty('get_npc_blueprint');
      expect(definitions).toHaveProperty('get_relationship');
      expect(definitions).toHaveProperty('get_local_facts');
      expect(definitions).toHaveProperty('write_npc_memory');
      expect(definitions).toHaveProperty('write_relationship');
    });

    it('should return definitions as array', () => {
      const arr = executor.getToolDefinitionsArray();

      expect(Array.isArray(arr)).toBe(true);
      expect(arr.length).toBe(7);
      expect(arr[0]).toHaveProperty('name');
      expect(arr[0]).toHaveProperty('description');
      expect(arr[0]).toHaveProperty('input_schema');
    });
  });
});

describe('createToolFunctions', () => {
  it('should create tool function objects', () => {
    const store = new InMemoryDataStore();
    const tools = createToolFunctions(store);

    expect(tools.get_npc_blueprint).toHaveProperty('name');
    expect(tools.get_npc_blueprint).toHaveProperty('description');
    expect(tools.get_npc_blueprint).toHaveProperty('execute');
    expect(typeof tools.get_npc_blueprint.execute).toBe('function');
  });

  it('should execute tool functions', async () => {
    const store = new InMemoryDataStore();
    await store.saveBlueprint(testBlueprint);

    const tools = createToolFunctions(store);
    const result = await tools.get_npc_blueprint.execute({ npc_id: 'npc_test_001' });

    expect(result.identity.name).toBe('Test NPC');
  });
});

describe('TOOL_DEFINITIONS', () => {
  it('should have correct structure for all tools', () => {
    Object.values(TOOL_DEFINITIONS).forEach(def => {
      expect(def).toHaveProperty('name');
      expect(def).toHaveProperty('description');
      expect(def).toHaveProperty('input_schema');
      expect(def.input_schema).toHaveProperty('type', 'object');
      expect(def.input_schema).toHaveProperty('properties');
      expect(def.input_schema).toHaveProperty('required');
    });
  });
});
