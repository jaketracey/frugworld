# Frugworld AI Service

AI/LLM integration layer for Frugworld NPC dialogue, blueprints, and memory management.

## Overview

This service provides the AI capabilities for NPCs in Frugworld, following the architecture defined in the game design document. It implements:

- **Blueprint Generation** (Section 6.1): One-time NPC character generation with structured output
- **Dialogue Generation** (Section 7 & 15): Rate-limited, cost-controlled NPC dialogue
- **Memory Summarization** (Section 6.3): Three-layer memory model with deterministic and LLM-based updates
- **Tool Functions** (Section 7.3): Agent SDK compatible interface for data access
- **Cost Controls** (Section 16): Token caps, rate limiting, and usage tracking

## Installation

```bash
cd ai-service
npm install
npm run build
```

## Configuration

Create a `.env` file or set environment variables:

```env
ANTHROPIC_API_KEY=your-api-key-here
```

## Usage

### Basic Setup

```typescript
import { createAIService, InMemoryDataStore } from '@frugworld/ai-service';

// Create data store (use SpacetimeDB adapter in production)
const dataStore = new InMemoryDataStore();

// Create AI service
const aiService = createAIService(
  process.env.ANTHROPIC_API_KEY,
  dataStore,
  {
    model_dialogue: 'claude-sonnet-4-20250514',
    rate_limits: {
      max_requests_per_minute_per_npc: 10,
      max_requests_per_minute_per_player: 30,
      max_tokens_per_response: 500,
      conversation_auto_summarize_threshold: 20,
      replan_cooldown_ms: 3600000, // 1 hour
    },
  }
);
```

### Blueprint Generation

Generate NPC blueprints once per NPC and cache permanently:

```typescript
import { createDefaultArchetype } from '@frugworld/ai-service';

const archetype = createDefaultArchetype('craftsman', 'blacksmith');

const worldContext = {
  zone_id: 'zone_001',
  zone_name: 'Ironhold Village',
  zone_type: 'settlement',
  biome: 'temperate_forest',
  time_of_day: 'morning',
  nearby_pois: [
    { poi_id: 'poi_001', name: 'The Smithy', type: 'shop' },
  ],
};

const { blueprint, usage } = await aiService.blueprint.generateBlueprint(
  'npc_001',
  archetype,
  worldContext
);

console.log(`Generated ${blueprint.identity.name} ($${usage.estimated_cost_usd.toFixed(4)})`);
```

### Dialogue Generation

Generate NPC dialogue with rate limiting and cost control:

```typescript
import { createEmptyDialogueContext } from '@frugworld/ai-service';

// Build dialogue context
const context = createEmptyDialogueContext(blueprint);
context.relationship.player_id = 'player_001';
context.world_context = worldContext;

// Generate dialogue
const { response, usage, should_summarize } = await aiService.dialogue.generateDialogue(
  {
    player_id: 'player_001',
    npc_id: 'npc_001',
    player_utterance: 'Hello! Can you forge me a sword?',
  },
  context
);

console.log(`NPC: "${response.text}"`);
console.log(`Intents: ${response.intent_tags.join(', ')}`);

// Handle auto-summarization when needed
if (should_summarize) {
  await summarizeConversation();
}
```

### Memory Management

Handle both deterministic and LLM-based memory updates:

```typescript
import { createEmptyMemory } from '@frugworld/ai-service';

// Deterministic update (no LLM call)
const memory = createEmptyMemory('npc_001', blueprint.backstory);
const updatedMemory = aiService.memory.applyDeterministicUpdate(memory, {
  type: 'trade_completed',
  subject: 'player',
  details: 'sold iron sword for 50 gold',
  timestamp_ms: Date.now(),
});

// Apply dialogue memory delta
const finalMemory = aiService.memory.applyDialogueMemoryDelta(
  updatedMemory,
  dialogueResponse
);

// LLM-based conversation summarization (at conversation end)
const { memory: summarized } = await aiService.memory.summarizeConversation(
  blueprint.identity.name,
  conversationHistory,
  existingConversationMemory
);
```

### Tool Functions

Use tools with any agent framework:

```typescript
// Get tool definitions for Anthropic API
const toolDefs = aiService.tools.getToolDefinitionsArray();

// Execute tools
const blueprint = await aiService.tools.getNpcBlueprint({ npc_id: 'npc_001' });
const relationship = await aiService.tools.getRelationship({
  player_id: 'player_001',
  npc_id: 'npc_001',
});

// Update data
await aiService.tools.writeRelationship({
  player_id: 'player_001',
  npc_id: 'npc_001',
  delta: {
    affinity_delta: 10,
    new_summary_items: ['Player ordered a custom sword'],
  },
});
```

### Cost and Rate Limit Tracking

```typescript
// Get usage statistics
const stats = aiService.getUsageStats();
console.log(`Total cost: $${stats.estimated_cost_usd.toFixed(4)}`);

// Check rate limit status
const npcStatus = aiService.getNpcRateLimitStatus('npc_001');
console.log(`Requests in window: ${npcStatus.requests_in_window}`);
console.log(`Can replan: ${npcStatus.can_replan}`);
```

## Architecture

### File Structure

```
ai-service/
  src/
    index.ts          # Main entry point and AIService class
    types.ts          # TypeScript type definitions
    blueprint.ts      # NPC blueprint generation
    dialogue.ts       # Dialogue generation with rate limiting
    memory.ts         # Memory summarization (deterministic + LLM)
    tools.ts          # Agent SDK compatible tool functions
    cost-control.ts   # Token budgets and rate limiting
    example.ts        # Usage examples
    *.test.ts         # Test files
```

### Data Flow

1. **Blueprint Generation** (one-time per NPC):
   - Input: Archetype + World Context
   - Output: Complete NPC blueprint (cached forever)

2. **Dialogue Generation** (per conversation turn):
   - Input: Player utterance + NPC context (blueprint, memory, relationship)
   - Output: Structured response with intents and memory deltas
   - Rate limited per NPC and per player

3. **Memory Updates**:
   - Deterministic: Game events trigger rule-based memory additions
   - LLM-based: Conversation summarization at end of dialogue

### Cost Controls

- **Token caps**: Max tokens per response (default: 500)
- **Rate limiting**: Max requests per minute per NPC (default: 10) and per player (default: 30)
- **Auto-summarization**: Triggered after N conversation turns (default: 20)
- **Replan cooldown**: Max 1 replan per NPC per hour

## Implementing the DataStore

Replace `InMemoryDataStore` with a SpacetimeDB adapter:

```typescript
import { DataStore } from '@frugworld/ai-service';

class SpacetimeDBDataStore implements DataStore {
  async getBlueprint(npcId: string): Promise<NPCBlueprint | null> {
    // Query SpacetimeDB npc_blueprint table
  }

  async getRelationship(playerId: string, npcId: string): Promise<Relationship | null> {
    // Query SpacetimeDB relationship table
  }

  async getLocalFacts(zoneId: string, chunkIds: string[]): Promise<LocalFacts> {
    // Query SpacetimeDB chunk tables
  }

  async getMemory(npcId: string): Promise<NPCMemory | null> {
    // Query SpacetimeDB npc_state table
  }

  async saveBlueprint(blueprint: NPCBlueprint): Promise<void> {
    // Insert/update npc_blueprint table
  }

  // ... implement other methods
}
```

## Testing

```bash
npm test           # Run all tests
npm run test:watch # Watch mode
```

## License

MIT
