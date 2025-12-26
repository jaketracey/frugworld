/**
 * Tool Functions (Section 7.3)
 * Agents SDK compatible interface for NPC data access and updates.
 * These tools can be used by any agent framework for dialogue generation.
 */

import {
  ToolFunction,
  GetBlueprintInput,
  GetRelationshipInput,
  GetLocalFactsInput,
  WriteMemoryInput,
  WriteRelationshipInput,
  GetMemoryInput,
  EmitEventInput,
  GameEvent,
  NPCBlueprint,
  Relationship,
  LocalFacts,
  NPCMemory,
  RelationshipDelta,
  MemorySummaryDelta,
  AIServiceError,
} from './types.js';

/**
 * Storage interface that tools use to access game state.
 * Implement this interface to connect to your actual database (SpacetimeDB).
 */
export interface DataStore {
  // Read operations
  getBlueprint(npcId: string): Promise<NPCBlueprint | null>;
  getRelationship(playerId: string, npcId: string): Promise<Relationship | null>;
  getLocalFacts(zoneId: string, chunkIds: string[]): Promise<LocalFacts>;
  getMemory(npcId: string): Promise<NPCMemory | null>;

  // Write operations
  saveBlueprint(blueprint: NPCBlueprint): Promise<void>;
  saveRelationship(relationship: Relationship): Promise<void>;
  updateMemory(npcId: string, delta: MemorySummaryDelta): Promise<NPCMemory>;
  updateRelationship(
    playerId: string,
    npcId: string,
    delta: RelationshipDelta
  ): Promise<Relationship>;

  // Event emission (server-side only per Section 7.3)
  emitEvent(event: EmitEventInput): Promise<GameEvent>;
}

/**
 * Tool definitions that can be used with the Anthropic tool use API
 * or any other agent framework.
 */
export const TOOL_DEFINITIONS = {
  get_npc_blueprint: {
    name: 'get_npc_blueprint',
    description: 'Retrieves the complete blueprint for an NPC, including identity, personality, backstory, voice style, and constraints. Use this to understand who the NPC is.',
    input_schema: {
      type: 'object',
      properties: {
        npc_id: {
          type: 'string',
          description: 'The unique identifier of the NPC',
        },
      },
      required: ['npc_id'],
    },
  },

  get_relationship: {
    name: 'get_relationship',
    description: 'Retrieves the relationship state between a player and an NPC, including affinity, trust, flags, and conversation history summary.',
    input_schema: {
      type: 'object',
      properties: {
        player_id: {
          type: 'string',
          description: 'The unique identifier of the player',
        },
        npc_id: {
          type: 'string',
          description: 'The unique identifier of the NPC',
        },
      },
      required: ['player_id', 'npc_id'],
    },
  },

  get_local_facts: {
    name: 'get_local_facts',
    description: 'Retrieves local facts about the world in the specified zone and chunks, including nearby threats, opportunities, and relevant information.',
    input_schema: {
      type: 'object',
      properties: {
        zone_id: {
          type: 'string',
          description: 'The zone identifier',
        },
        chunk_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of chunk identifiers to get facts for',
        },
      },
      required: ['zone_id', 'chunk_ids'],
    },
  },

  write_npc_memory: {
    name: 'write_npc_memory',
    description: 'Updates the NPC memory with new facts or removes outdated ones. Use this to record important events or information.',
    input_schema: {
      type: 'object',
      properties: {
        npc_id: {
          type: 'string',
          description: 'The unique identifier of the NPC',
        },
        summary_delta: {
          type: 'object',
          properties: {
            add_facts: {
              type: 'array',
              items: { type: 'string' },
              description: 'New facts to add to memory',
            },
            remove_facts: {
              type: 'array',
              items: { type: 'string' },
              description: 'Facts to remove from memory',
            },
            replace_all: {
              type: 'array',
              items: { type: 'string' },
              description: 'Replace all recent summary with these facts',
            },
          },
        },
      },
      required: ['npc_id', 'summary_delta'],
    },
  },

  write_relationship: {
    name: 'write_relationship',
    description: 'Updates the relationship between a player and NPC. Can modify affinity, trust, flags, and add new conversation summary items.',
    input_schema: {
      type: 'object',
      properties: {
        player_id: {
          type: 'string',
          description: 'The unique identifier of the player',
        },
        npc_id: {
          type: 'string',
          description: 'The unique identifier of the NPC',
        },
        delta: {
          type: 'object',
          properties: {
            affinity_delta: {
              type: 'number',
              description: 'Change to affinity (-100 to 100 scale)',
            },
            trust_delta: {
              type: 'number',
              description: 'Change to trust (-100 to 100 scale)',
            },
            flag_changes: {
              type: 'object',
              description: 'Flags to set or unset',
            },
            new_summary_items: {
              type: 'array',
              items: { type: 'string' },
              description: 'New items to add to conversation summary',
            },
          },
        },
      },
      required: ['player_id', 'npc_id', 'delta'],
    },
  },

  get_npc_memory: {
    name: 'get_npc_memory',
    description: 'Retrieves the memory state for an NPC, including canonical facts from their blueprint and recent summary of events.',
    input_schema: {
      type: 'object',
      properties: {
        npc_id: {
          type: 'string',
          description: 'The unique identifier of the NPC',
        },
      },
      required: ['npc_id'],
    },
  },

  emit_event: {
    name: 'emit_event',
    description: 'Emits a game event to the server event log. Server-side only - used to record significant actions or state changes.',
    input_schema: {
      type: 'object',
      properties: {
        event_type: {
          type: 'string',
          description: 'The type of event (e.g., "DialogueLine", "QuestGiven", "TradeCompleted")',
        },
        payload: {
          type: 'object',
          description: 'Event-specific data payload',
        },
        actor_id: {
          type: 'string',
          description: 'The entity that caused the event (optional)',
        },
        target_id: {
          type: 'string',
          description: 'The entity affected by the event (optional)',
        },
        zone_id: {
          type: 'string',
          description: 'The zone where the event occurred (optional)',
        },
        chunk_x: {
          type: 'number',
          description: 'The chunk X coordinate (optional)',
        },
        chunk_y: {
          type: 'number',
          description: 'The chunk Y coordinate (optional)',
        },
      },
      required: ['event_type', 'payload'],
    },
  },
} as const;

/**
 * Tool executor class that wraps the DataStore and provides
 * type-safe tool execution.
 */
export class ToolExecutor {
  constructor(private readonly store: DataStore) {}

  /**
   * Get NPC blueprint by ID
   */
  async getNpcBlueprint(input: GetBlueprintInput): Promise<NPCBlueprint> {
    const blueprint = await this.store.getBlueprint(input.npc_id);

    if (!blueprint) {
      throw new AIServiceError(
        `Blueprint not found for NPC ${input.npc_id}`,
        'BLUEPRINT_NOT_FOUND',
        { npc_id: input.npc_id }
      );
    }

    return blueprint;
  }

  /**
   * Get relationship between player and NPC
   */
  async getRelationship(input: GetRelationshipInput): Promise<Relationship> {
    const relationship = await this.store.getRelationship(
      input.player_id,
      input.npc_id
    );

    if (!relationship) {
      // Return a default relationship if none exists
      return {
        player_id: input.player_id,
        npc_id: input.npc_id,
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
      };
    }

    return relationship;
  }

  /**
   * Get local facts for a zone and chunks
   */
  async getLocalFacts(input: GetLocalFactsInput): Promise<LocalFacts> {
    return this.store.getLocalFacts(input.zone_id, input.chunk_ids);
  }

  /**
   * Write memory updates for an NPC
   */
  async writeNpcMemory(input: WriteMemoryInput): Promise<NPCMemory> {
    return this.store.updateMemory(input.npc_id, input.summary_delta);
  }

  /**
   * Write relationship updates
   */
  async writeRelationship(input: WriteRelationshipInput): Promise<Relationship> {
    return this.store.updateRelationship(
      input.player_id,
      input.npc_id,
      input.delta
    );
  }

  /**
   * Get NPC memory by ID (Section 7.3)
   */
  async getNpcMemory(input: GetMemoryInput): Promise<NPCMemory> {
    const memory = await this.store.getMemory(input.npc_id);

    if (!memory) {
      throw new AIServiceError(
        `Memory not found for NPC ${input.npc_id}`,
        'BLUEPRINT_NOT_FOUND',
        { npc_id: input.npc_id }
      );
    }

    return memory;
  }

  /**
   * Emit a game event (Section 7.3 - server-side only)
   */
  async emitEvent(input: EmitEventInput): Promise<GameEvent> {
    return this.store.emitEvent(input);
  }

  /**
   * Execute a tool by name with the given input
   */
  async executeTool(
    toolName: string,
    input: unknown
  ): Promise<unknown> {
    switch (toolName) {
      case 'get_npc_blueprint':
        return this.getNpcBlueprint(input as GetBlueprintInput);

      case 'get_relationship':
        return this.getRelationship(input as GetRelationshipInput);

      case 'get_local_facts':
        return this.getLocalFacts(input as GetLocalFactsInput);

      case 'write_npc_memory':
        return this.writeNpcMemory(input as WriteMemoryInput);

      case 'write_relationship':
        return this.writeRelationship(input as WriteRelationshipInput);

      case 'get_npc_memory':
        return this.getNpcMemory(input as GetMemoryInput);

      case 'emit_event':
        return this.emitEvent(input as EmitEventInput);

      default:
        throw new AIServiceError(
          `Unknown tool: ${toolName}`,
          'INVALID_INPUT',
          { tool_name: toolName }
        );
    }
  }

  /**
   * Get all tool definitions for use with the Anthropic API
   */
  getToolDefinitions(): typeof TOOL_DEFINITIONS {
    return TOOL_DEFINITIONS;
  }

  /**
   * Get tool definitions as an array (format needed by Anthropic SDK)
   */
  getToolDefinitionsArray(): Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }> {
    return Object.values(TOOL_DEFINITIONS);
  }
}

/**
 * In-memory implementation of DataStore for testing purposes
 */
export class InMemoryDataStore implements DataStore {
  private blueprints: Map<string, NPCBlueprint> = new Map();
  private relationships: Map<string, Relationship> = new Map();
  private memories: Map<string, NPCMemory> = new Map();
  private localFacts: Map<string, LocalFacts> = new Map();
  private events: GameEvent[] = [];
  private eventCounter = 0;

  private relationshipKey(playerId: string, npcId: string): string {
    return `${playerId}:${npcId}`;
  }

  async getBlueprint(npcId: string): Promise<NPCBlueprint | null> {
    return this.blueprints.get(npcId) ?? null;
  }

  async getRelationship(
    playerId: string,
    npcId: string
  ): Promise<Relationship | null> {
    return this.relationships.get(this.relationshipKey(playerId, npcId)) ?? null;
  }

  async getLocalFacts(zoneId: string, chunkIds: string[]): Promise<LocalFacts> {
    // Aggregate facts from all requested chunks
    const allFacts: string[] = [];
    const allThreats: string[] = [];
    const allOpportunities: string[] = [];

    for (const chunkId of chunkIds) {
      const key = `${zoneId}:${chunkId}`;
      const facts = this.localFacts.get(key);
      if (facts) {
        allFacts.push(...facts.facts);
        allThreats.push(...facts.threats);
        allOpportunities.push(...facts.opportunities);
      }
    }

    return {
      zone_id: zoneId,
      chunk_ids: chunkIds,
      facts: [...new Set(allFacts)],
      threats: [...new Set(allThreats)],
      opportunities: [...new Set(allOpportunities)],
    };
  }

  async getMemory(npcId: string): Promise<NPCMemory | null> {
    return this.memories.get(npcId) ?? null;
  }

  async saveBlueprint(blueprint: NPCBlueprint): Promise<void> {
    this.blueprints.set(blueprint.npc_id, blueprint);
  }

  async saveRelationship(relationship: Relationship): Promise<void> {
    const key = this.relationshipKey(relationship.player_id, relationship.npc_id);
    this.relationships.set(key, relationship);
  }

  async updateMemory(
    npcId: string,
    delta: MemorySummaryDelta
  ): Promise<NPCMemory> {
    const existing = this.memories.get(npcId);

    if (!existing) {
      throw new AIServiceError(
        `Memory not found for NPC ${npcId}`,
        'BLUEPRINT_NOT_FOUND',
        { npc_id: npcId }
      );
    }

    let updatedSummary = [...existing.recent_summary];

    if (delta.replace_all) {
      updatedSummary = delta.replace_all;
    } else {
      if (delta.remove_facts) {
        updatedSummary = updatedSummary.filter(
          fact => !delta.remove_facts?.includes(fact)
        );
      }
      if (delta.add_facts) {
        updatedSummary.push(...delta.add_facts);
      }
    }

    const updated: NPCMemory = {
      ...existing,
      recent_summary: updatedSummary.slice(-15), // Keep max 15 items
      last_updated_ms: Date.now(),
    };

    this.memories.set(npcId, updated);
    return updated;
  }

  async updateRelationship(
    playerId: string,
    npcId: string,
    delta: RelationshipDelta
  ): Promise<Relationship> {
    const key = this.relationshipKey(playerId, npcId);
    const existing = this.relationships.get(key);

    // Create default if doesn't exist
    const current: Relationship = existing ?? {
      player_id: playerId,
      npc_id: npcId,
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
    };

    // Apply delta
    const updated: Relationship = {
      ...current,
      affinity: this.clamp(current.affinity + (delta.affinity_delta ?? 0), -100, 100),
      trust: this.clamp(current.trust + (delta.trust_delta ?? 0), -100, 100),
      flags: {
        ...current.flags,
        ...delta.flag_changes,
      },
      conversation_summary: delta.new_summary_items
        ? [...current.conversation_summary, ...delta.new_summary_items].slice(-10)
        : current.conversation_summary,
      interaction_count: current.interaction_count + 1,
      last_interaction_ms: Date.now(),
    };

    this.relationships.set(key, updated);
    return updated;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Emit a game event (Section 7.3)
   */
  async emitEvent(input: EmitEventInput): Promise<GameEvent> {
    this.eventCounter++;
    const event: GameEvent = {
      event_id: `event_${this.eventCounter}_${Date.now()}`,
      event_type: input.event_type,
      payload: input.payload,
      actor_id: input.actor_id,
      target_id: input.target_id,
      zone_id: input.zone_id,
      chunk_x: input.chunk_x,
      chunk_y: input.chunk_y,
      timestamp_ms: Date.now(),
    };
    this.events.push(event);
    return event;
  }

  // Helper methods for testing
  setLocalFacts(zoneId: string, chunkId: string, facts: LocalFacts): void {
    this.localFacts.set(`${zoneId}:${chunkId}`, facts);
  }

  setMemory(memory: NPCMemory): void {
    this.memories.set(memory.npc_id, memory);
  }

  getEvents(): GameEvent[] {
    return [...this.events];
  }

  getEventsByType(eventType: string): GameEvent[] {
    return this.events.filter(e => e.event_type === eventType);
  }

  clear(): void {
    this.blueprints.clear();
    this.relationships.clear();
    this.memories.clear();
    this.localFacts.clear();
    this.events = [];
    this.eventCounter = 0;
  }
}

/**
 * Create tool function objects compatible with various agent frameworks
 */
export function createToolFunctions(store: DataStore): {
  get_npc_blueprint: ToolFunction<GetBlueprintInput, NPCBlueprint>;
  get_relationship: ToolFunction<GetRelationshipInput, Relationship>;
  get_local_facts: ToolFunction<GetLocalFactsInput, LocalFacts>;
  write_npc_memory: ToolFunction<WriteMemoryInput, NPCMemory>;
  write_relationship: ToolFunction<WriteRelationshipInput, Relationship>;
  get_npc_memory: ToolFunction<GetMemoryInput, NPCMemory>;
  emit_event: ToolFunction<EmitEventInput, GameEvent>;
} {
  const executor = new ToolExecutor(store);

  return {
    get_npc_blueprint: {
      name: 'get_npc_blueprint',
      description: TOOL_DEFINITIONS.get_npc_blueprint.description,
      execute: (input) => executor.getNpcBlueprint(input),
    },
    get_relationship: {
      name: 'get_relationship',
      description: TOOL_DEFINITIONS.get_relationship.description,
      execute: (input) => executor.getRelationship(input),
    },
    get_local_facts: {
      name: 'get_local_facts',
      description: TOOL_DEFINITIONS.get_local_facts.description,
      execute: (input) => executor.getLocalFacts(input),
    },
    write_npc_memory: {
      name: 'write_npc_memory',
      description: TOOL_DEFINITIONS.write_npc_memory.description,
      execute: (input) => executor.writeNpcMemory(input),
    },
    write_relationship: {
      name: 'write_relationship',
      description: TOOL_DEFINITIONS.write_relationship.description,
      execute: (input) => executor.writeRelationship(input),
    },
    get_npc_memory: {
      name: 'get_npc_memory',
      description: TOOL_DEFINITIONS.get_npc_memory.description,
      execute: (input) => executor.getNpcMemory(input),
    },
    emit_event: {
      name: 'emit_event',
      description: TOOL_DEFINITIONS.emit_event.description,
      execute: (input) => executor.emitEvent(input),
    },
  };
}
