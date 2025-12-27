/**
 * Unified AI Server
 *
 * Combines all AI services into a single process:
 * 1. SpacetimeDB Dialogue Watcher - NPC conversations
 * 2. HTTP API - Frug's random thoughts
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import OpenAI from 'openai';
import { DbConnection } from './module_bindings/index.js';
import { AIService, createAIService, InMemoryDataStore } from './index.js';
import type { DialogueRequest, DialogueContext, NPCBlueprint, NPCIdentity, NPCPersonality, AIServiceConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { MultiEntityActionService, type MultiEntityActionRequest } from './multi-action.js';
import { PortraitGenerator, PortraitCache } from './portrait.js';
import { CostController } from './cost-control.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

// Configuration
const SPACETIMEDB_URI = process.env['SPACETIMEDB_URI'] || 'ws://localhost:3000';
const SPACETIMEDB_MODULE = process.env['SPACETIMEDB_MODULE'] || 'frugworld';
const OPENAI_API_KEY = process.env['OPENAI_API_KEY'] || '';
const ELEVENLABS_API_KEY = process.env['ELEVENLABS_API_KEY'] || '';
const HTTP_PORT = parseInt(process.env['AI_SERVER_PORT'] || '3002', 10);

// ============================================================================
// Thoughts Service (HTTP API)
// ============================================================================

interface GameContext {
  playerX: number;
  playerY: number;
  playerZ: number;
  nearbyNpcCount: number;
  nearestNpcName: string | null;
  nearestNpcDistance: number | null;
  currentBiome: string;
  timeOfDay: string;
  isMoving: boolean;
  velocity: number;
}

const FRUG_PERSONALITY = `You are Frug, a small green ball-shaped frog creature rolling through a magical world.
You are curious, slightly anxious, and easily distracted. You love exploring but also worry about things.
You have simple but profound observations about the world around you.

Your thoughts should be:
- Short (1-2 sentences max, under 100 characters ideal)
- Whimsical and playful
- Sometimes philosophical in a simple way
- Occasionally worried or nervous
- Full of wonder about your surroundings
- Written in first person as internal monologue

Never use quotes. Just the raw thought.`;

const FALLBACK_THOUGHTS = [
  "Rolling rolling rolling...",
  "I wonder what's over that hill...",
  "My tummy feels rumbly.",
  "The grass smells nice today.",
  "Did I leave the stove on? Wait, I don't have a stove.",
  "Wheeeee!",
  "Being a ball is surprisingly convenient.",
  "I should visit the frogs sometime.",
  "The sky looks extra blue today.",
  "Left or right? Decisions are hard.",
  "I hope I don't roll into any puddles.",
  "Adventure awaits! ...I think.",
  "What if the ground just... stopped?",
  "I'm the roundest thing I know.",
  "Maybe I'll find a friend today.",
  "Rolling uphill is exhausting.",
  "I bet there's treasure somewhere.",
  "My eyes are getting dizzy.",
  "Is anyone else watching me roll?",
  "One day I'll roll to the moon.",
];

/**
 * Generate a rich backstory for an NPC using OpenAI
 */
async function generateRichBackstory(
  identity: NPCIdentity,
  personality: NPCPersonality,
  existingBackstory: string[]
): Promise<string[]> {
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const systemPrompt = `You are a creative writer specializing in character backgrounds for a cozy village life game.
Generate 5-8 bullet point backstory facts for an NPC.
Each bullet should be 1-2 sentences revealing something about their personality, history, or relationships.
Make it vivid and specific - avoid generic statements. Keep it family-friendly and heartwarming.`;

  const userPrompt = `Generate a detailed backstory for:
Name: ${identity.name}
Age: ${identity.age}
Role: ${identity.role}
Appearance: ${identity.appearance?.join(', ') || 'average build'}
Personality: ${personality.traits?.join(', ') || 'friendly'}
Values: ${personality.values?.join(', ') || 'community'}
Fears: ${personality.fears?.join(', ') || 'unknown'}
Desires: ${personality.desires?.join(', ') || 'happiness'}

${existingBackstory.length > 0 ? `Existing facts (expand on these themes):\n${existingBackstory.join('\n')}` : ''}

Return ONLY a JSON array of strings like: ["fact 1", "fact 2", ...]`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 600,
      temperature: 0.8,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return existingBackstory;

    // Parse JSON array from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return existingBackstory;

    const backstory = JSON.parse(jsonMatch[0]) as string[];

    // Validate and limit
    if (!Array.isArray(backstory) || backstory.length === 0) return existingBackstory;
    return backstory.slice(0, 8).filter(s => typeof s === 'string' && s.length > 0);
  } catch (err) {
    console.error('[Backstory] Generation failed:', err);
    return existingBackstory;
  }
}

class ThoughtsService {
  private openai: OpenAI;
  private lastThoughtTime: number = 0;
  private thoughtCache: string[] = [];
  private cacheIndex: number = 0;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  async generateThought(context: GameContext): Promise<string> {
    const now = Date.now();
    if (now - this.lastThoughtTime < 5000) {
      return this.getFallbackThought();
    }

    if (!OPENAI_API_KEY) {
      return this.getFallbackThought();
    }

    try {
      const contextPrompt = this.buildContextPrompt(context);

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: FRUG_PERSONALITY },
          { role: 'user', content: contextPrompt },
        ],
        max_tokens: 60,
        temperature: 0.9,
      });

      this.lastThoughtTime = now;
      const thought = response.choices[0]?.message?.content?.trim() || this.getFallbackThought();

      if (thought.length > 10 && thought.length < 120 && !this.thoughtCache.includes(thought)) {
        this.thoughtCache.push(thought);
        if (this.thoughtCache.length > 50) {
          this.thoughtCache.shift();
        }
      }

      return thought;
    } catch (err) {
      console.error('[Thoughts] OpenAI error:', err);
      return this.getFallbackThought();
    }
  }

  private buildContextPrompt(context: GameContext): string {
    const parts: string[] = [];

    if (context.isMoving && context.velocity > 5) {
      parts.push("You're rolling very fast!");
    } else if (context.isMoving) {
      parts.push("You're rolling along at a nice pace.");
    } else {
      parts.push("You've stopped rolling and are resting.");
    }

    if (context.nearestNpcName && context.nearestNpcDistance !== null) {
      if (context.nearestNpcDistance < 5) {
        parts.push(`${context.nearestNpcName} is very close to you.`);
      } else if (context.nearestNpcDistance < 15) {
        parts.push(`You can see ${context.nearestNpcName} nearby.`);
      }
    }

    if (context.nearbyNpcCount > 1) {
      parts.push(`There are ${context.nearbyNpcCount} creatures around.`);
    } else if (context.nearbyNpcCount === 0) {
      parts.push("You're all alone out here.");
    }

    if (context.currentBiome) {
      parts.push(`You're in a ${context.currentBiome} area.`);
    }

    if (context.playerZ > 10) {
      parts.push("You're high up on a hill.");
    } else if (context.playerZ < -2) {
      parts.push("You're in a valley or low area.");
    }

    parts.push("\nGenerate a single short thought Frug might have right now. Just the thought, no quotes or attribution.");

    return parts.join(' ');
  }

  private getFallbackThought(): string {
    if (this.thoughtCache.length > 0 && Math.random() > 0.5) {
      this.cacheIndex = (this.cacheIndex + 1) % this.thoughtCache.length;
      return this.thoughtCache[this.cacheIndex] ?? "Hmm...";
    }
    return FALLBACK_THOUGHTS[Math.floor(Math.random() * FALLBACK_THOUGHTS.length)] ?? "Hmm...";
  }
}

// ============================================================================
// STT Service (Speech-to-Text via OpenAI Whisper)
// ============================================================================

class STTService {
  private openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  async transcribe(audioBuffer: Buffer, mimeType: string = 'audio/webm'): Promise<string> {
    // OpenAI expects a File-like object, we'll convert the buffer
    const extension = this.getExtensionFromMimeType(mimeType);
    const filename = `audio.${extension}`;

    // Create a Blob-like object that OpenAI SDK can handle
    const file = new File([audioBuffer], filename, { type: mimeType });

    try {
      const response = await this.openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        language: 'en',
      });

      return response.text;
    } catch (error) {
      console.error('[STT] Transcription error:', error);
      throw error;
    }
  }

  private getExtensionFromMimeType(mimeType: string): string {
    if (mimeType.includes('webm')) return 'webm';
    if (mimeType.includes('mp3') || mimeType.includes('mpeg')) return 'mp3';
    if (mimeType.includes('wav')) return 'wav';
    if (mimeType.includes('ogg')) return 'ogg';
    if (mimeType.includes('m4a')) return 'm4a';
    return 'webm'; // default
  }
}

// ============================================================================
// TTS Service (Text-to-Speech via ElevenLabs)
// ============================================================================

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

// Default voice (Rachel - warm female voice)
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

class TTSService {
  private apiKey: string;
  private modelId: string = 'eleven_multilingual_v2';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isEnabled(): boolean {
    return this.apiKey.length > 0;
  }

  async generateSpeech(text: string, voiceId: string = DEFAULT_VOICE_ID): Promise<Buffer> {
    if (!this.isEnabled()) {
      throw new Error('TTS service not configured - missing ELEVENLABS_API_KEY');
    }

    const response = await fetch(
      `${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: this.modelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`TTS generation failed: ${response.statusText} - ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

// ============================================================================
// Dialogue Watcher (SpacetimeDB)
// ============================================================================

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

interface ActiveDialogueRow {
  playerId: bigint;
  npcId: bigint;
  sessionId: bigint;
  startedTsMs: bigint;
  lastActivityTsMs: bigint;
  lineCount: number;
  context: Uint8Array;
}

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
  private isProcessing = new Set<string>();
  private processedLines = new Map<bigint, number>();
  private connectionReady: Promise<void>;
  private resolveConnectionReady: (() => void) | null = null;

  constructor() {
    // Create a promise that resolves when connection is ready
    this.connectionReady = new Promise((resolve) => {
      this.resolveConnectionReady = resolve;
    });
    this.dataStore = new InMemoryDataStore();
    this.aiService = createAIService(OPENAI_API_KEY, this.dataStore, {
      model_dialogue: 'gpt-4o-mini',
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
    console.log('[Dialogue] Connecting to SpacetimeDB...');
    console.log(`[Dialogue]   URI: ${SPACETIMEDB_URI}`);
    console.log(`[Dialogue]   Module: ${SPACETIMEDB_MODULE}`);

    try {
      this.connection = await DbConnection.builder()
        .withUri(SPACETIMEDB_URI)
        .withModuleName(SPACETIMEDB_MODULE)
        .onConnect((conn, identity) => {
          console.log(`[Dialogue] Connected with identity: ${identity.toHexString()}`);
          this.setupSubscriptions(conn);
          // Signal that connection is ready for blueprint lookups
          if (this.resolveConnectionReady) {
            this.resolveConnectionReady();
          }
        })
        .onDisconnect(() => {
          console.log('[Dialogue] Disconnected from SpacetimeDB');
          // Try to reconnect after a delay
          setTimeout(() => {
            console.log('[Dialogue] Attempting to reconnect...');
            this.start();
          }, 5000);
        })
        .onConnectError((_ctx, error) => {
          console.error('[Dialogue] Connection error:', error);
        })
        .build();

      console.log('[Dialogue] Watcher started successfully');
    } catch (error) {
      console.error('[Dialogue] Failed to start:', error);
      // Retry connection after delay
      console.log('[Dialogue] Will retry in 5 seconds...');
      setTimeout(() => this.start(), 5000);
    }
  }

  private setupSubscriptions(conn: DbConnection): void {
    console.log('[Dialogue] Setting up subscriptions...');

    conn.subscriptionBuilder()
      .onApplied((ctx) => {
        console.log('[Dialogue] Subscription applied!');

        // Count existing data
        let dialogueCount = 0;
        let blueprintCount = 0;
        for (const _ of ctx.db.activeDialogue.iter()) dialogueCount++;
        for (const _ of ctx.db.npcBlueprint.iter()) blueprintCount++;

        console.log(`[Dialogue] Found ${dialogueCount} active dialogues, ${blueprintCount} NPC blueprints`);

        for (const dialogue of ctx.db.activeDialogue.iter()) {
          this.handleDialogueUpdate(dialogue as ActiveDialogueRow);
        }
      })
      .onError((ctx) => {
        console.error('[Dialogue] Subscription error:', ctx);
      })
      .subscribe([
        'SELECT * FROM active_dialogue',
        'SELECT * FROM npc_blueprint',
      ]);

    conn.db.activeDialogue.onInsert((_ctx, dialogue) => {
      console.log(`[Dialogue] >>> NEW DIALOGUE: player=${dialogue.playerId}, npc=${dialogue.npcId}, lines=${dialogue.lineCount}`);
      this.handleDialogueUpdate(dialogue as ActiveDialogueRow);
    });

    conn.db.activeDialogue.onUpdate((_ctx, oldDialogue, newDialogue) => {
      console.log(`[Dialogue] >>> UPDATE: player=${newDialogue.playerId}, lines: ${oldDialogue.lineCount} -> ${newDialogue.lineCount}`);
      this.handleDialogueUpdate(newDialogue as ActiveDialogueRow);
    });

    conn.db.activeDialogue.onDelete((_ctx, dialogue) => {
      console.log(`[Dialogue] >>> DELETED: player=${dialogue.playerId}`);
      this.processedLines.delete(dialogue.playerId);
    });

    console.log('[Dialogue] Subscriptions configured, waiting for events...');
  }

  private async handleDialogueUpdate(dialogue: ActiveDialogueRow): Promise<void> {
    const playerId = dialogue.playerId;
    const npcId = dialogue.npcId;
    const lineCount = dialogue.lineCount;

    console.log(`[Dialogue] handleDialogueUpdate called: player=${playerId}, npc=${npcId}, lines=${lineCount}`);

    const lastProcessed = this.processedLines.get(playerId) || 0;
    if (lineCount <= lastProcessed) {
      console.log(`[Dialogue]   Skipping: already processed (last=${lastProcessed})`);
      return;
    }

    let context: ServerDialogueContext;
    try {
      const contextStr = new TextDecoder().decode(dialogue.context);
      console.log(`[Dialogue]   Context length: ${contextStr.length} chars`);
      context = JSON.parse(contextStr);
    } catch (error) {
      console.error(`[Dialogue]   Failed to parse context:`, error);
      return;
    }

    const recentLines = context.recent_lines || [];
    console.log(`[Dialogue]   Recent lines: ${recentLines.length}`);

    if (recentLines.length === 0) {
      console.log(`[Dialogue]   Skipping: no recent lines`);
      return;
    }

    const lastLine = recentLines[recentLines.length - 1];
    if (!lastLine) {
      console.log(`[Dialogue]   Skipping: no last line`);
      return;
    }
    console.log(`[Dialogue]   Last line: speaker=${lastLine.speaker}, text="${lastLine.text}"`);

    if (lastLine.speaker !== 'player') {
      console.log(`[Dialogue]   Skipping: last speaker was not player`);
      return;
    }

    const requestKey = `${playerId}-${lineCount}`;
    if (this.isProcessing.has(requestKey)) {
      console.log(`[Dialogue]   Skipping: already processing this request`);
      return;
    }

    this.isProcessing.add(requestKey);
    this.processedLines.set(playerId, lineCount);

    console.log(`[Dialogue] >>> Processing player message: "${lastLine.text}"`);

    try {
      console.log(`[Dialogue]   Looking up blueprint for NPC ${npcId}...`);
      const blueprint = await this.getNpcBlueprint(npcId);
      if (!blueprint) {
        console.error(`[Dialogue]   ERROR: No blueprint found for NPC ${npcId}`);
        return;
      }
      console.log(`[Dialogue]   Found blueprint: ${blueprint.identity?.name ?? 'Unknown'} (${blueprint.identity?.role ?? 'Unknown'})`);

      const dialogueContext = this.buildDialogueContext(context, blueprint);
      const dialogueRequest: DialogueRequest = {
        player_id: playerId.toString(),
        npc_id: npcId.toString(),
        player_utterance: lastLine.text,
      };

      console.log('[Dialogue]   Calling OpenAI...');
      const startTime = Date.now();
      const { response, usage } = await this.aiService.dialogue.generateDialogue(
        dialogueRequest,
        dialogueContext
      );
      const duration = Date.now() - startTime;

      console.log(`[Dialogue]   AI response in ${duration}ms: "${response.text}"`);
      console.log(`[Dialogue]   Tokens: ${usage.total_tokens} ($${usage.estimated_cost_usd.toFixed(4)})`);

      console.log(`[Dialogue]   Sending response to SpacetimeDB...`);
      await this.sendNpcResponse(playerId, response);
      console.log(`[Dialogue]   Done!`);

    } catch (error) {
      console.error(`[Dialogue]   ERROR generating response:`, error);
    } finally {
      this.isProcessing.delete(requestKey);
    }
  }

  /**
   * Get blueprint for an NPC, waiting for connection if needed.
   * This is the public method for external use (e.g., portrait generation).
   */
  async getBlueprintForPortrait(npcId: string): Promise<NPCBlueprint | null> {
    // Wait for connection to be ready (with timeout)
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), 5000)
    );

    try {
      await Promise.race([this.connectionReady, timeout]);
    } catch {
      console.warn(`[Portrait] Connection not ready for blueprint lookup`);
      return null;
    }

    return this.getNpcBlueprint(BigInt(npcId));
  }

  /**
   * Get the database connection for calling reducers (for backstory persistence)
   */
  getConnection(): DbConnection | null {
    return this.connection;
  }

  private async getNpcBlueprint(npcId: bigint): Promise<NPCBlueprint | null> {
    if (!this.connection) {
      console.error(`[Dialogue]   getNpcBlueprint: No connection!`);
      return null;
    }

    const blueprintRow = this.connection.db.npcBlueprint.npcId.find(npcId) as NpcBlueprintRow | undefined;

    if (blueprintRow && blueprintRow.blueprintJson.length > 2) {
      try {
        const jsonStr = new TextDecoder().decode(blueprintRow.blueprintJson);
        const parsed = JSON.parse(jsonStr) as NPCBlueprint;
        if (parsed.identity?.name) {
          console.log(`[Dialogue]   Using stored blueprint for NPC ${npcId}`);
          return parsed;
        }
      } catch (error) {
        console.warn(`[Dialogue]   Failed to parse blueprint for NPC ${npcId}, using default:`, error);
      }
    }

    // Return a default blueprint for NPCs without one
    console.log(`[Dialogue]   Using default blueprint for NPC ${npcId}`);
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
    } as NPCBlueprint;
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
      console.error('[Dialogue]   sendNpcResponse: Not connected to SpacetimeDB!');
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

    const responseJson = JSON.stringify({
      text: response.text,
      intent_tags: response.intent_tags,
      memory_delta: response.memory_delta,
      relationship_delta: serverRelationshipDelta,
      actions: response.actions || [],
    });

    console.log(`[Dialogue]   Reducer payload: playerId=${playerId}, responseLen=${responseJson.length}`);

    try {
      // Check if reducer exists
      if (!this.connection.reducers.dialogueNpcRespond) {
        console.error('[Dialogue]   ERROR: dialogueNpcRespond reducer not found!');
        console.log('[Dialogue]   Available reducers:', Object.keys(this.connection.reducers));
        return;
      }

      this.connection.reducers.dialogueNpcRespond({
        playerId,
        response: responseJson,
      });
      console.log(`[Dialogue]   Response sent successfully to player ${playerId}`);
    } catch (error) {
      console.error(`[Dialogue]   ERROR calling reducer:`, error);
    }
  }

  stop(): void {
    if (this.connection) {
      this.connection.disconnect();
      this.connection = null;
    }
    console.log('[Dialogue] Watcher stopped');
  }
}

// ============================================================================
// Voice Selection from Blueprint
// ============================================================================

// ElevenLabs voice IDs mapped to personality types
const VOICE_LIBRARY: Record<string, string> = {
  // Warm, friendly voices
  'warm_female': 'EXAVITQu4vr4xnSDxMaL', // Rachel
  'warm_male': 'VR6AewLTigWG4xSOukaG', // Arnold
  // Gruff, stern voices
  'stern_male': 'pNInz6obpgDQGcFmaJgB', // Adam
  'stern_female': '21m00Tcm4TlvDq8ikWAM', // Bella
  // Elderly, wise voices
  'wise_male': 'yoZ06aMxZJJ28mfd3POQ', // Sam
  'wise_female': 'MF3mGyEYCl7XYWbV9V6O', // Elli
  // Young, energetic voices
  'young_male': 'TxGEqnHWrfWFTfGW9XjX', // Josh
  'young_female': 'jsCqWAovK2LkecY7zXl4', // Freya
  // Mysterious, calm voices
  'mysterious': 'onwK4e9ZLuTAKqWW03F9', // Daniel
  // Default
  'default': 'EXAVITQu4vr4xnSDxMaL', // Rachel
};

/**
 * Select an ElevenLabs voice based on NPC voice_style from blueprint
 */
function selectVoiceFromStyle(
  voiceStyle: { tone?: string; vocabulary_level?: string; speech_patterns?: string[] },
  npcId: string
): string {
  const tone = (voiceStyle.tone ?? '').toLowerCase();

  // Map tone keywords to voice types
  if (tone.includes('stern') || tone.includes('gruff') || tone.includes('authoritative')) {
    return VOICE_LIBRARY['stern_male'] ?? VOICE_LIBRARY['default']!;
  }
  if (tone.includes('wise') || tone.includes('elderly') || tone.includes('sagely')) {
    return VOICE_LIBRARY['wise_male'] ?? VOICE_LIBRARY['default']!;
  }
  if (tone.includes('young') || tone.includes('energetic') || tone.includes('enthusiastic')) {
    return VOICE_LIBRARY['young_female'] ?? VOICE_LIBRARY['default']!;
  }
  if (tone.includes('mysterious') || tone.includes('calm') || tone.includes('measured')) {
    return VOICE_LIBRARY['mysterious'] ?? VOICE_LIBRARY['default']!;
  }
  if (tone.includes('warm') || tone.includes('friendly') || tone.includes('kind')) {
    return VOICE_LIBRARY['warm_female'] ?? VOICE_LIBRARY['default']!;
  }

  // Use NPC ID to deterministically pick a voice for variety
  const voiceKeys = Object.keys(VOICE_LIBRARY).filter(k => k !== 'default');
  const hash = npcId.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  const selectedKey = voiceKeys[hash % voiceKeys.length] ?? 'default';

  return VOICE_LIBRARY[selectedKey] ?? VOICE_LIBRARY['default']!;
}

// ============================================================================
// HTTP Server
// ============================================================================

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function parseBodyRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => { chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function createHttpServer(
  thoughtsService: ThoughtsService,
  sttService: STTService,
  ttsService: TTSService,
  multiActionService: MultiEntityActionService,
  portraitGenerator: PortraitGenerator,
  portraitCache: PortraitCache,
  dialogueWatcher: DialogueWatcher
): Promise<void> {
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${HTTP_PORT}`);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        services: ['thoughts', 'dialogue', 'stt', ttsService.isEnabled() ? 'tts' : 'tts-disabled']
      }));
      return;
    }

    // Frug intro endpoint - generate a backstory/status for the player's Frug
    if (url.pathname === '/frug-intro' && req.method === 'GET') {
      try {
        const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are a narrator introducing Frug, a small green ball-shaped frog creature.
Generate a brief, whimsical one-sentence status about Frug waking up and starting a new day of adventure.
Be playful and charming. Keep it under 80 characters. No quotes, just the sentence.
Examples:
- Frug woke from a dream about giant acorns.
- After a cozy nap, Frug is ready to roll.
- Frug stretches tiny legs and yawns.`,
            },
            { role: 'user', content: 'Generate a brief intro status for Frug starting their day.' },
          ],
          max_tokens: 40,
          temperature: 1.0,
        });

        const intro = response.choices[0]?.message?.content?.trim() || 'Frug woke up feeling adventurous.';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ intro }));
      } catch (err) {
        console.error('[HTTP] Frug intro error:', err);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ intro: 'Frug woke up feeling adventurous.' }));
      }
      return;
    }

    if (url.pathname === '/thought' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const context: GameContext = JSON.parse(body);
        const thought = await thoughtsService.generateThought(context);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ thought }));
      } catch (err) {
        console.error('[HTTP] Error generating thought:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to generate thought' }));
      }
      return;
    }

    if (url.pathname === '/thought' && req.method === 'GET') {
      const defaultContext: GameContext = {
        playerX: 0, playerY: 0, playerZ: 0,
        nearbyNpcCount: 0, nearestNpcName: null, nearestNpcDistance: null,
        currentBiome: 'grassland', timeOfDay: 'day',
        isMoving: false, velocity: 0,
      };

      try {
        const thought = await thoughtsService.generateThought(defaultContext);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ thought }));
      } catch (err) {
        console.error('[HTTP] Error generating thought:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to generate thought' }));
      }
      return;
    }

    // STT endpoint - transcribe audio to text
    if (url.pathname === '/stt' && req.method === 'POST') {
      try {
        const audioBuffer = await parseBodyRaw(req);
        const mimeType = req.headers['content-type'] || 'audio/webm';
        console.log(`[STT] Received ${audioBuffer.length} bytes, type: ${mimeType}`);

        const text = await sttService.transcribe(audioBuffer, mimeType);
        console.log(`[STT] Transcribed: "${text}"`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text }));
      } catch (err) {
        console.error('[HTTP] STT error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Transcription failed' }));
      }
      return;
    }

    // TTS endpoint - generate speech from text
    // Accepts optional npc_id to fetch voice style from blueprint
    if (url.pathname === '/tts' && req.method === 'POST') {
      try {
        if (!ttsService.isEnabled()) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'TTS service not configured' }));
          return;
        }

        const body = await parseBody(req);
        const { text, voiceId, npcId } = JSON.parse(body) as {
          text: string;
          voiceId?: string;
          npcId?: string;
        };

        // Get voice settings from blueprint if npcId provided
        let selectedVoiceId = voiceId;
        let voiceStyle: { tone?: string; vocabulary_level?: string } | undefined;

        if (npcId && !voiceId) {
          const blueprint = await dialogueWatcher.getBlueprintForPortrait(npcId);
          if (blueprint?.voice_style) {
            voiceStyle = blueprint.voice_style;
            // Select voice based on blueprint voice_style
            selectedVoiceId = selectVoiceFromStyle(blueprint.voice_style, npcId);
            console.log(`[TTS] Using voice ${selectedVoiceId} for NPC ${npcId} (${voiceStyle.tone ?? 'default'})`);
          }
        }

        console.log(`[TTS] Generating speech for: "${text.substring(0, 50)}..."`);

        const audioBuffer = await ttsService.generateSpeech(text, selectedVoiceId);
        console.log(`[TTS] Generated ${audioBuffer.length} bytes`);

        res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
        res.end(audioBuffer);
      } catch (err) {
        console.error('[HTTP] TTS error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Speech generation failed' }));
      }
      return;
    }

    // Multi-action endpoint - generate group actions for selected NPCs
    if (url.pathname === '/multi-action' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const request: MultiEntityActionRequest = JSON.parse(body);
        console.log(`[MultiAction] Generating actions for ${request.target_npc_ids.length} NPCs`);

        const response = await multiActionService.generateActions(request);
        console.log(`[MultiAction] Generated ${response.actions.length} actions`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (err) {
        console.error('[HTTP] Multi-action error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to generate actions' }));
      }
      return;
    }

    // Portrait endpoint - generate NPC portrait using Fal
    // Fetches blueprint from SpacetimeDB for accurate creature generation
    if (url.pathname === '/portrait' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const { npc_id } = JSON.parse(body) as { npc_id: string };

        console.log(`[Portrait] Request for NPC ${npc_id}`);

        // Check cache first
        const cached = portraitCache.get(npc_id);
        if (cached) {
          console.log(`[Portrait] Cache hit for NPC ${npc_id}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ portrait_url: cached, cached: true }));
          return;
        }

        // Get blueprint from SpacetimeDB
        const blueprint = await dialogueWatcher.getBlueprintForPortrait(npc_id);

        // Build identity and personality from blueprint
        const identity: NPCIdentity = blueprint?.identity ?? {
          name: `Creature ${npc_id}`,
          age: 30,
          role: 'Villager',
          appearance: ['soft fur', 'bright eyes'],
        };

        const personality: NPCPersonality = blueprint?.personality ?? {
          traits: ['friendly', 'curious'],
          values: ['community'],
          fears: [],
          desires: [],
        };

        console.log(`[Portrait] Generating for ${identity.name} (${identity.role}), traits: ${personality.traits.join(', ')}`);

        // Generate new portrait
        const result = await portraitGenerator.generateFalPortrait(npc_id, identity, personality, 64);
        const dataUrl = portraitCache.set(npc_id, result.image_data);

        console.log(`[Portrait] Generated for NPC ${npc_id} (${result.image_data.length} bytes)`);

        // Generate rich backstory if not already present
        let backstoryGenerated = false;
        if (blueprint && (!blueprint.backstory || blueprint.backstory.length < 3)) {
          try {
            console.log(`[Portrait] Generating rich backstory for ${identity.name}...`);
            const backstory = await generateRichBackstory(identity, personality, blueprint.backstory || []);

            // Persist updated blueprint to SpacetimeDB
            if (backstory.length > 0) {
              const updatedBlueprint = {
                ...blueprint,
                backstory,
              };

              // Use the dialogue watcher's connection to call the reducer
              const connection = dialogueWatcher.getConnection();
              if (connection) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const reducers = (connection as any).reducers;
                if (reducers?.setLlmBlueprint) {
                  reducers.setLlmBlueprint({
                    npcId: BigInt(npc_id),
                    blueprintJson: JSON.stringify(updatedBlueprint),
                    modelId: 'gpt-4o-mini',
                  });
                  backstoryGenerated = true;
                  console.log(`[Portrait] Persisted ${backstory.length} backstory facts for ${identity.name}`);
                }
              }
            }
          } catch (err) {
            console.warn(`[Portrait] Failed to generate backstory:`, err);
            // Don't fail portrait generation if backstory fails
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ portrait_url: dataUrl, cached: false, backstory_generated: backstoryGenerated }));
      } catch (err) {
        console.error('[HTTP] Portrait error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Portrait generation failed' }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(HTTP_PORT, () => {
    console.log(`[HTTP] Server running on http://localhost:${HTTP_PORT}`);
    console.log('[HTTP] Endpoints:');
    console.log('  GET  /health       - Health check');
    console.log('  GET  /thought      - Generate random thought');
    console.log('  POST /thought      - Generate contextual thought');
    console.log('  POST /stt          - Transcribe audio to text');
    console.log('  POST /tts          - Generate speech from text');
    console.log('  POST /multi-action - Generate group actions for selected NPCs');
    console.log('  POST /portrait     - Generate NPC portrait via Fal');
  });
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('  Frugworld AI Server');
  console.log('='.repeat(60));

  if (!OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY environment variable not set');
    process.exit(1);
  }

  // Initialize services
  const thoughtsService = new ThoughtsService(OPENAI_API_KEY);
  const sttService = new STTService(OPENAI_API_KEY);
  const ttsService = new TTSService(ELEVENLABS_API_KEY);

  // Initialize multi-action service
  const multiActionService = new MultiEntityActionService({
    openai_api_key: OPENAI_API_KEY,
    model: 'gpt-4o-mini',
    max_retries: 2,
    max_tokens_per_response: 500,
  });

  // Initialize portrait services
  const costController = new CostController({
    max_requests_per_minute_per_npc: 20,
    max_requests_per_minute_per_player: 60,
    max_tokens_per_response: 500,
    conversation_auto_summarize_threshold: 20,
    replan_cooldown_ms: 1800000,
  });
  const aiConfig: AIServiceConfig = {
    ...DEFAULT_CONFIG,
    openai_api_key: OPENAI_API_KEY,
    elevenlabs_api_key: ELEVENLABS_API_KEY,
    max_retries: 2,
    retry_delay_ms: 1000,
  };
  const portraitGenerator = new PortraitGenerator(aiConfig, costController);
  const portraitCache = new PortraitCache(100); // Cache up to 100 portraits

  if (!ELEVENLABS_API_KEY) {
    console.warn('WARNING: ELEVENLABS_API_KEY not set - TTS will be disabled');
  }

  // Start dialogue watcher first (needed for blueprint lookups in HTTP endpoints)
  const dialogueWatcher = new DialogueWatcher();
  await dialogueWatcher.start();

  // Start HTTP server with all services (including dialogueWatcher for blueprint access)
  await createHttpServer(thoughtsService, sttService, ttsService, multiActionService, portraitGenerator, portraitCache, dialogueWatcher);

  // Handle graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down...');
    dialogueWatcher.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('\n' + '='.repeat(60));
  console.log('  AI Server is running. Press Ctrl+C to stop.');
  console.log('='.repeat(60) + '\n');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
