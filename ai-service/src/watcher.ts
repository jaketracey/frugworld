/**
 * Dialogue Watcher Service
 *
 * Bridges SpacetimeDB and the AI service by:
 * 1. Subscribing to active_dialogue table updates
 * 2. Detecting when a player sends a message
 * 3. Generating AI responses using DialogueService
 * 4. Sending responses back via dialogue_npc_respond reducer
 */

// Load environment variables from parent directory
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

import { DbConnection } from './module_bindings/index.js';
import { AIService, createAIService, InMemoryDataStore } from './index.js';
import type { DialogueRequest, DialogueContext, NPCBlueprint } from './types.js';

// Configuration
const SPACETIMEDB_URI = process.env['SPACETIMEDB_URI'] || 'ws://localhost:3000';
const SPACETIMEDB_MODULE = process.env['SPACETIMEDB_MODULE'] || 'frugworld';
const OPENAI_API_KEY = process.env['OPENAI_API_KEY'] || '';

// Track which dialogues we've processed to avoid duplicates
const processedLines = new Map<bigint, number>(); // playerId -> last processed lineCount

// Dialogue context structure (matches server's DialogueContext)
interface ServerDialogueContext {
  npc_name: string;
  npc_role: string;
  npc_personality_traits: string[];
  affinity: number;
  trust: number;
  relationship_flags: string[];
  memory_summary: string[];
  conversation_summary: string;
  local_facts: string[];
  current_action: string;
  current_needs: {
    hunger: number;
    fatigue: number;
    safety: number;
    social: number;
    wealth: number;
  };
  recent_lines: Array<{
    speaker: string;
    text: string;
    ts_ms: number;
  }>;
}

// Active dialogue row type
interface ActiveDialogueRow {
  playerId: bigint;
  npcId: bigint;
  sessionId: bigint;
  startedTsMs: bigint;
  lastActivityTsMs: bigint;
  lineCount: number;
  context: Uint8Array;
}

// NPC Blueprint row type
interface NpcBlueprintRow {
  npcId: bigint;
  blueprintJson: Uint8Array;
  version: number;
  createdTsMs: bigint;
}

class DialogueWatcher {
  private connection: DbConnection | null = null;
  private aiService: AIService;
  private dataStore: InMemoryDataStore;
  private isProcessing = new Set<string>(); // Track in-flight requests

  constructor() {
    this.dataStore = new InMemoryDataStore();
    this.aiService = createAIService(OPENAI_API_KEY, this.dataStore, {
      model_dialogue: 'gpt-4o-mini', // Use cheaper model for dialogue
      rate_limits: {
        max_requests_per_minute_per_npc: 20,
        max_requests_per_minute_per_player: 60,
        max_tokens_per_response: 500,
        conversation_auto_summarize_threshold: 20,
        replan_cooldown_ms: 1800000,
      },
    });
  }

  async start(): Promise<void> {
    console.log('Starting Dialogue Watcher...');
    console.log(`  SpacetimeDB URI: ${SPACETIMEDB_URI}`);
    console.log(`  Module: ${SPACETIMEDB_MODULE}`);

    if (!OPENAI_API_KEY) {
      console.error('ERROR: OPENAI_API_KEY environment variable not set');
      process.exit(1);
    }

    try {
      // Connect to SpacetimeDB
      this.connection = await DbConnection.builder()
        .withUri(SPACETIMEDB_URI)
        .withModuleName(SPACETIMEDB_MODULE)
        .onConnect((conn, identity) => {
          console.log(`Connected to SpacetimeDB with identity: ${identity.toHexString()}`);
          this.setupSubscriptions(conn);
        })
        .onDisconnect(() => {
          console.log('Disconnected from SpacetimeDB');
        })
        .onConnectError((_ctx, error) => {
          console.error('Connection error:', error);
        })
        .build();

      console.log('Dialogue Watcher started successfully');
    } catch (error) {
      console.error('Failed to start Dialogue Watcher:', error);
      process.exit(1);
    }
  }

  private setupSubscriptions(conn: DbConnection): void {
    // Subscribe to active_dialogue and npc_blueprint tables
    const subscription = conn.subscriptionBuilder()
      .onApplied((ctx) => {
        console.log('Subscription applied');

        // Process any existing active dialogues
        for (const dialogue of ctx.db.activeDialogue.iter()) {
          this.handleDialogueUpdate(dialogue as ActiveDialogueRow);
        }
      })
      .onError((ctx) => {
        console.error('Subscription error:', ctx);
      })
      .subscribe([
        'SELECT * FROM active_dialogue',
        'SELECT * FROM npc_blueprint',
      ]);

    // Watch for dialogue updates
    conn.db.activeDialogue.onInsert((_ctx, dialogue) => {
      console.log(`New dialogue started for player ${dialogue.playerId}`);
      this.handleDialogueUpdate(dialogue as ActiveDialogueRow);
    });

    conn.db.activeDialogue.onUpdate((_ctx, _oldDialogue, newDialogue) => {
      console.log(`Dialogue updated for player ${newDialogue.playerId}, lines: ${newDialogue.lineCount}`);
      this.handleDialogueUpdate(newDialogue as ActiveDialogueRow);
    });

    conn.db.activeDialogue.onDelete((_ctx, dialogue) => {
      console.log(`Dialogue ended for player ${dialogue.playerId}`);
      processedLines.delete(dialogue.playerId);
    });
  }

  private async handleDialogueUpdate(dialogue: ActiveDialogueRow): Promise<void> {
    const playerId = dialogue.playerId;
    const npcId = dialogue.npcId;
    const lineCount = dialogue.lineCount;

    // Check if we've already processed this line count
    const lastProcessed = processedLines.get(playerId) || 0;
    if (lineCount <= lastProcessed) {
      return; // Already processed
    }

    // Parse the context
    let context: ServerDialogueContext;
    try {
      const contextStr = new TextDecoder().decode(dialogue.context);
      context = JSON.parse(contextStr);
    } catch (error) {
      console.error(`Failed to parse dialogue context for player ${playerId}:`, error);
      return;
    }

    // Check if the last speaker was the player
    const recentLines = context.recent_lines || [];
    if (recentLines.length === 0) {
      return;
    }

    const lastLine = recentLines[recentLines.length - 1];
    if (lastLine.speaker !== 'player') {
      return; // Last message was from NPC, nothing to respond to
    }

    // Create a unique key for this request
    const requestKey = `${playerId}-${lineCount}`;
    if (this.isProcessing.has(requestKey)) {
      return; // Already processing this request
    }

    this.isProcessing.add(requestKey);
    processedLines.set(playerId, lineCount);

    console.log(`Processing player message: "${lastLine.text}" (player ${playerId} to NPC ${npcId})`);

    try {
      // Get NPC blueprint
      const blueprint = await this.getNpcBlueprint(npcId);
      if (!blueprint) {
        console.error(`No blueprint found for NPC ${npcId}`);
        return;
      }

      // Build dialogue context for AI service
      const dialogueContext = this.buildDialogueContext(context, blueprint);

      // Create dialogue request
      const dialogueRequest: DialogueRequest = {
        player_id: playerId.toString(),
        npc_id: npcId.toString(),
        player_utterance: lastLine.text,
      };

      // Generate response
      console.log('Generating AI response...');
      const startTime = Date.now();
      const { response, usage } = await this.aiService.dialogue.generateDialogue(
        dialogueRequest,
        dialogueContext
      );
      const duration = Date.now() - startTime;

      console.log(`AI response generated in ${duration}ms:`);
      console.log(`  Text: "${response.text}"`);
      console.log(`  Intent tags: ${response.intent_tags.join(', ')}`);
      console.log(`  Tokens: ${usage.total_tokens} ($${usage.estimated_cost_usd.toFixed(4)})`);

      // Send response back to SpacetimeDB
      await this.sendNpcResponse(playerId, response);

    } catch (error) {
      console.error(`Failed to generate response for player ${playerId}:`, error);
    } finally {
      this.isProcessing.delete(requestKey);
    }
  }

  private async getNpcBlueprint(npcId: bigint): Promise<NPCBlueprint | null> {
    if (!this.connection) return null;

    // Find blueprint in the subscribed data
    const blueprintRow = this.connection.db.npcBlueprint.npcId.find(npcId) as NpcBlueprintRow | undefined;

    if (blueprintRow && blueprintRow.blueprintJson.length > 2) {
      try {
        const jsonStr = new TextDecoder().decode(blueprintRow.blueprintJson);
        const parsed = JSON.parse(jsonStr) as NPCBlueprint;
        if (parsed.identity?.name) {
          return parsed;
        }
      } catch (error) {
        console.warn(`Failed to parse blueprint for NPC ${npcId}, using default:`, error);
      }
    }

    // Return a default blueprint for NPCs without one
    console.log(`Using default blueprint for NPC ${npcId}`);
    return {
      npc_id: npcId.toString(),
      archetype_id: 'default_villager',
      identity: {
        name: `Villager ${npcId}`,
        age: 30,
        role: 'Villager',
        appearance: ['average height', 'weathered clothes'],
      },
      personality: {
        traits: ['friendly', 'curious'],
        values: ['community', 'hard work'],
        fears: ['monsters', 'famine'],
        desires: ['peace', 'prosperity'],
      },
      backstory: [
        'Has lived in this area for many years.',
        'Works hard to make a living.',
        'Enjoys meeting travelers.',
      ],
      relationships: [],
      voice_style: {
        tone: 'friendly and casual',
        vocabulary_level: 'simple',
        speech_patterns: ['speaks plainly', 'asks questions'],
      },
      constraints: {
        taboo_topics: [],
        safety_constraints: [],
        lore_constraints: [],
      },
      truth_anchors: [
        'Is a simple villager',
        'Lives in this area',
      ],
      version: 0,
      created_at_ms: Date.now(),
    };
  }

  private buildDialogueContext(serverContext: ServerDialogueContext, blueprint: NPCBlueprint): DialogueContext {
    return {
      blueprint,
      relationship: {
        player_id: '',
        npc_id: blueprint.npc_id,
        affinity: serverContext.affinity,
        trust: serverContext.trust,
        flags: {
          offended: serverContext.relationship_flags.includes('offended'),
          owes_favor: serverContext.relationship_flags.includes('owes_favor'),
          friend: serverContext.relationship_flags.includes('friend'),
          hostile: serverContext.relationship_flags.includes('hostile'),
        },
        conversation_summary: serverContext.conversation_summary ? [serverContext.conversation_summary] : [],
        interaction_count: serverContext.recent_lines.length,
        last_interaction_ms: Date.now(),
      },
      npc_memory: {
        npc_id: blueprint.npc_id,
        canonical_facts: blueprint.backstory,
        recent_summary: serverContext.memory_summary || [],
        last_updated_ms: Date.now(),
      },
      conversation_memory: {
        player_id: '',
        npc_id: blueprint.npc_id,
        summary: serverContext.conversation_summary ? [serverContext.conversation_summary] : [],
        key_topics_discussed: [],
        promises_made: [],
        last_updated_ms: Date.now(),
      },
      local_facts: {
        zone_id: '',
        chunk_ids: [],
        facts: serverContext.local_facts || [],
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

  private async sendNpcResponse(
    playerId: bigint,
    response: { text: string; intent_tags: string[]; memory_delta: string[]; relationship_delta?: unknown; actions: unknown[] }
  ): Promise<void> {
    if (!this.connection) {
      console.error('Not connected to SpacetimeDB');
      return;
    }

    // Transform relationship_delta to match server format
    // Server expects: { affinity_delta: i16, trust_delta: i16, flags_add: string[], flags_remove: string[] }
    // AI returns: { affinity_delta?: number, trust_delta?: number, flag_changes?: { offended?, owes_favor?, friend?, hostile? } }
    let serverRelationshipDelta: { affinity_delta: number; trust_delta: number; flags_add: string[]; flags_remove: string[] } | null = null;

    if (response.relationship_delta && typeof response.relationship_delta === 'object') {
      const aiDelta = response.relationship_delta as {
        affinity_delta?: number;
        trust_delta?: number;
        flag_changes?: Record<string, boolean>;
      };

      const flagsAdd: string[] = [];
      const flagsRemove: string[] = [];

      if (aiDelta.flag_changes) {
        for (const [flag, value] of Object.entries(aiDelta.flag_changes)) {
          if (value === true) flagsAdd.push(flag);
          else if (value === false) flagsRemove.push(flag);
        }
      }

      serverRelationshipDelta = {
        affinity_delta: aiDelta.affinity_delta ?? 0,
        trust_delta: aiDelta.trust_delta ?? 0,
        flags_add: flagsAdd,
        flags_remove: flagsRemove,
      };
    }

    // Serialize response to JSON for the reducer
    const responseJson = JSON.stringify({
      text: response.text,
      intent_tags: response.intent_tags,
      memory_delta: response.memory_delta,
      relationship_delta: serverRelationshipDelta,
      actions: response.actions || [],
    });

    try {
      // Call the dialogue_npc_respond reducer
      this.connection.reducers.dialogueNpcRespond({
        playerId,
        response: responseJson,
      });
      console.log(`Response sent to player ${playerId}`);
    } catch (error) {
      console.error(`Failed to send response to player ${playerId}:`, error);
    }
  }

  stop(): void {
    if (this.connection) {
      this.connection.disconnect();
      this.connection = null;
    }
    console.log('Dialogue Watcher stopped');
  }
}

// Main entry point
async function main(): Promise<void> {
  const watcher = new DialogueWatcher();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    watcher.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    watcher.stop();
    process.exit(0);
  });

  await watcher.start();

  // Keep the process running
  console.log('\nDialogue Watcher is running. Press Ctrl+C to stop.\n');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
