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
import type { DialogueRequest, DialogueContext, NPCBlueprint } from './types.js';

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

  constructor() {
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
      console.log(`[Dialogue]   Found blueprint: ${blueprint.name} (${blueprint.role})`);

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

  private async getNpcBlueprint(npcId: bigint): Promise<NPCBlueprint | null> {
    if (!this.connection) {
      console.error(`[Dialogue]   getNpcBlueprint: No connection!`);
      return null;
    }

    // List all available blueprints for debugging
    let count = 0;
    const availableIds: string[] = [];
    for (const bp of this.connection.db.npcBlueprint.iter()) {
      count++;
      availableIds.push(String((bp as NpcBlueprintRow).npcId));
    }
    console.log(`[Dialogue]   Available blueprints (${count}): [${availableIds.slice(0, 10).join(', ')}${count > 10 ? '...' : ''}]`);

    const blueprintRow = this.connection.db.npcBlueprint.npcId.find(npcId) as NpcBlueprintRow | undefined;
    if (!blueprintRow) {
      console.log(`[Dialogue]   Blueprint not found for NPC ${npcId}`);
      return null;
    }

    try {
      const jsonStr = new TextDecoder().decode(blueprintRow.blueprintJson);
      const blueprint = JSON.parse(jsonStr) as NPCBlueprint;
      console.log(`[Dialogue]   Parsed blueprint: name="${blueprint.name}", npc_id="${blueprint.npc_id}"`);
      return blueprint;
    } catch (error) {
      console.error(`[Dialogue]   Failed to parse blueprint JSON:`, error);
      return null;
    }
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

    const responseJson = JSON.stringify({
      text: response.text,
      intent_tags: response.intent_tags,
      memory_delta: response.memory_delta,
      relationship_delta: response.relationship_delta || null,
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
  ttsService: TTSService
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
    if (url.pathname === '/tts' && req.method === 'POST') {
      try {
        if (!ttsService.isEnabled()) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'TTS service not configured' }));
          return;
        }

        const body = await parseBody(req);
        const { text, voiceId } = JSON.parse(body) as { text: string; voiceId?: string };
        console.log(`[TTS] Generating speech for: "${text.substring(0, 50)}..."`);

        const audioBuffer = await ttsService.generateSpeech(text, voiceId);
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

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(HTTP_PORT, () => {
    console.log(`[HTTP] Server running on http://localhost:${HTTP_PORT}`);
    console.log('[HTTP] Endpoints:');
    console.log('  GET  /health  - Health check');
    console.log('  GET  /thought - Generate random thought');
    console.log('  POST /thought - Generate contextual thought');
    console.log('  POST /stt     - Transcribe audio to text');
    console.log('  POST /tts     - Generate speech from text');
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

  if (!ELEVENLABS_API_KEY) {
    console.warn('WARNING: ELEVENLABS_API_KEY not set - TTS will be disabled');
  }

  // Start HTTP server with all services
  await createHttpServer(thoughtsService, sttService, ttsService);

  // Start dialogue watcher
  const dialogueWatcher = new DialogueWatcher();
  await dialogueWatcher.start();

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
