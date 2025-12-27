/**
 * Frug Thoughts Service
 *
 * Generates random, context-aware thoughts for the player character using OpenAI.
 * Runs as an HTTP server that the game client can query.
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import OpenAI from 'openai';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

// Configuration
const PORT = parseInt(process.env['THOUGHTS_API_PORT'] || '3002', 10);
const OPENAI_API_KEY = process.env['OPENAI_API_KEY'] || '';
const ELEVENLABS_API_KEY = process.env['ELEVENLABS_API_KEY'] || '';
const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

// Game context from client
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

// Frug personality and thought patterns
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

// Thought templates for fallback (no API needed)
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

  constructor() {
    this.openai = new OpenAI({
      apiKey: OPENAI_API_KEY,
    });
  }

  /**
   * Generate a thought based on game context
   */
  async generateThought(context: GameContext): Promise<string> {
    // Rate limit: at least 5 seconds between API calls
    const now = Date.now();
    if (now - this.lastThoughtTime < 5000) {
      return this.getFallbackThought();
    }

    // If no API key, use fallbacks
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

      // Cache good thoughts for reuse
      if (thought.length > 10 && thought.length < 120 && !this.thoughtCache.includes(thought)) {
        this.thoughtCache.push(thought);
        if (this.thoughtCache.length > 50) {
          this.thoughtCache.shift();
        }
      }

      return thought;
    } catch (err) {
      console.error('OpenAI error:', err);
      return this.getFallbackThought();
    }
  }

  private buildContextPrompt(context: GameContext): string {
    const parts: string[] = [];

    // Movement state
    if (context.isMoving && context.velocity > 5) {
      parts.push("You're rolling very fast!");
    } else if (context.isMoving) {
      parts.push("You're rolling along at a nice pace.");
    } else {
      parts.push("You've stopped rolling and are resting.");
    }

    // NPC proximity
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

    // Biome
    if (context.currentBiome) {
      parts.push(`You're in a ${context.currentBiome} area.`);
    }

    // Time
    if (context.timeOfDay) {
      parts.push(`It's ${context.timeOfDay}.`);
    }

    // Position hints
    if (context.playerZ > 10) {
      parts.push("You're high up on a hill.");
    } else if (context.playerZ < -2) {
      parts.push("You're in a valley or low area.");
    }

    parts.push("\nGenerate a single short thought Frug might have right now. Just the thought, no quotes or attribution.");

    return parts.join(' ');
  }

  private getFallbackThought(): string {
    // Use cached AI thoughts first if available
    if (this.thoughtCache.length > 0 && Math.random() > 0.5) {
      this.cacheIndex = (this.cacheIndex + 1) % this.thoughtCache.length;
      return this.thoughtCache[this.cacheIndex] ?? 'Hmm...';
    }

    // Otherwise use hardcoded fallbacks
    return FALLBACK_THOUGHTS[Math.floor(Math.random() * FALLBACK_THOUGHTS.length)] ?? 'Hmm...';
  }
}

// HTTP Server
const thoughtsService = new ThoughtsService();

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // Generate thought
  if (url.pathname === '/thought' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const context: GameContext = JSON.parse(body);
      const thought = await thoughtsService.generateThought(context);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ thought }));
    } catch (err) {
      console.error('Error generating thought:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to generate thought' }));
    }
    return;
  }

  // Quick thought (no context, just random)
  if (url.pathname === '/thought' && req.method === 'GET') {
    const defaultContext: GameContext = {
      playerX: 0,
      playerY: 0,
      playerZ: 0,
      nearbyNpcCount: 0,
      nearestNpcName: null,
      nearestNpcDistance: null,
      currentBiome: 'grassland',
      timeOfDay: 'day',
      isMoving: false,
      velocity: 0,
    };

    try {
      const thought = await thoughtsService.generateThought(defaultContext);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ thought }));
    } catch (err) {
      console.error('Error generating thought:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to generate thought' }));
    }
    return;
  }

  // TTS endpoint - generate speech from text using ElevenLabs
  if (url.pathname === '/tts' && req.method === 'POST') {
    try {
      if (!ELEVENLABS_API_KEY) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'TTS service not configured - missing ELEVENLABS_API_KEY' }));
        return;
      }

      const body = await parseBody(req);
      const { text, voiceId } = JSON.parse(body) as { text: string; voiceId?: string };
      const voice = voiceId || 'D38z5RcWu1voky8WS1ja'; // Default: Fin (young, playful)

      console.log(`[TTS] Generating speech for: "${text.substring(0, 50)}..."`);

      const ttsResponse = await fetch(
        `${ELEVENLABS_API_BASE}/text-to-speech/${voice}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': ELEVENLABS_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: 0.4,
              similarity_boost: 0.7,
              style: 0.6,
              use_speaker_boost: true,
            },
          }),
        }
      );

      if (!ttsResponse.ok) {
        const errorText = await ttsResponse.text();
        console.error('[TTS] ElevenLabs error:', ttsResponse.status, errorText);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'TTS generation failed' }));
        return;
      }

      const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());
      console.log(`[TTS] Generated ${audioBuffer.length} bytes`);

      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.end(audioBuffer);
    } catch (err) {
      console.error('[TTS] Error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'TTS generation failed' }));
    }
    return;
  }

  // Not found
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

// Start server
const server = createServer((req, res) => {
  handleRequest(req, res).catch(err => {
    console.error('Unhandled error:', err);
    res.writeHead(500);
    res.end('Internal server error');
  });
});

server.listen(PORT, () => {
  console.log(`Thoughts API server running on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log(`  GET  /health  - Health check`);
  console.log(`  GET  /thought - Generate random thought`);
  console.log(`  POST /thought - Generate contextual thought`);
  console.log(`  POST /tts     - Generate speech from text (ElevenLabs)`);
  if (!ELEVENLABS_API_KEY) {
    console.log('  ⚠️  TTS disabled - set ELEVENLABS_API_KEY in .env');
  }
});
