/**
 * Example usage of the Frugworld AI Service
 *
 * This file demonstrates how to use each component of the AI service
 * for NPC blueprint generation, dialogue, and memory management.
 */

import {
  createAIService,
  createDefaultArchetype,
  createEmptyMemory,
  createEmptyConversationMemory,
  createEmptyDialogueContext,
  InMemoryDataStore,
  type NPCArchetype,
  type WorldContext,
  type DialogueRequest,
  type MemoryEvent,
} from './index.js';

async function main() {
  // =========================================================================
  // Setup
  // =========================================================================

  // Create an in-memory data store (replace with SpacetimeDB adapter in production)
  const dataStore = new InMemoryDataStore();

  // Create the AI service with custom config
  const aiService = createAIService(
    process.env['ANTHROPIC_API_KEY'] ?? '',
    dataStore,
    {
      model_dialogue: 'claude-sonnet-4-20250514',  // Cheaper model for dialogue
      rate_limits: {
        max_requests_per_minute_per_npc: 15,
        max_requests_per_minute_per_player: 40,
        max_tokens_per_response: 400,
        conversation_auto_summarize_threshold: 15,
        replan_cooldown_ms: 1800000, // 30 minutes
      },
    }
  );

  // =========================================================================
  // 1. Blueprint Generation (Section 6.1)
  // =========================================================================

  console.log('=== Blueprint Generation ===\n');

  // Define an archetype for a blacksmith NPC
  const blacksmithArchetype: NPCArchetype = {
    archetype_id: 'craftsman_blacksmith',
    category: 'craftsman',
    base_role: 'blacksmith',
    personality_tendencies: {
      traits: ['hardworking', 'practical', 'proud of craft'],
      values: ['quality', 'tradition', 'honest work'],
    },
    typical_voice: {
      tone: 'gruff but friendly',
      vocabulary_level: 'moderate',
      speech_patterns: ['uses forge metaphors', 'direct and to the point'],
    },
    common_backstory_elements: [
      'Learned the trade from a family member',
      'Has been working the forge for decades',
      'Knows the quality of every ore in the region',
    ],
    default_constraints: {
      taboo_topics: ['magic users (distrusts them)'],
      lore_constraints: ['Iron is scarce in this region'],
      safety_constraints: [],
    },
  };

  // Define world context
  const worldContext: WorldContext = {
    zone_id: 'zone_001',
    zone_name: 'Ironhold Village',
    zone_type: 'settlement',
    biome: 'temperate_forest',
    time_of_day: 'morning',
    weather: 'clear',
    nearby_pois: [
      { poi_id: 'poi_001', name: 'The Rusty Anvil Smithy', type: 'shop' },
      { poi_id: 'poi_002', name: 'Ironhold Market', type: 'marketplace' },
      { poi_id: 'poi_003', name: 'Old Mine Entrance', type: 'dungeon' },
    ],
    cultural_notes: [
      'Village was founded by miners 200 years ago',
      'Iron trade is the lifeblood of the community',
    ],
  };

  // Generate the blueprint
  const npcId = 'npc_blacksmith_001';

  try {
    console.log('Generating blueprint for blacksmith NPC...\n');

    const { blueprint, usage } = await aiService.blueprint.generateBlueprint(
      npcId,
      blacksmithArchetype,
      worldContext
    );

    console.log('Generated Blueprint:');
    console.log(`  Name: ${blueprint.identity.name}`);
    console.log(`  Age: ${blueprint.identity.age}`);
    console.log(`  Role: ${blueprint.identity.role}`);
    console.log(`  Traits: ${blueprint.personality.traits.join(', ')}`);
    console.log(`  Voice: ${blueprint.voice_style.tone}`);
    console.log(`  Truth Anchors: ${blueprint.truth_anchors.length} facts`);
    console.log(`\nToken Usage: ${usage.total_tokens} tokens ($${usage.estimated_cost_usd.toFixed(4)})`);

    // Save the blueprint
    await dataStore.saveBlueprint(blueprint);

    // Initialize NPC memory with backstory as canonical facts
    const npcMemory = createEmptyMemory(npcId, blueprint.backstory);
    dataStore.setMemory(npcMemory);

    // =========================================================================
    // 2. Dialogue Generation (Section 7 & 15)
    // =========================================================================

    console.log('\n=== Dialogue Generation ===\n');

    const playerId = 'player_001';

    // Create conversation memory for this player-NPC pair
    const conversationMemory = createEmptyConversationMemory(playerId, npcId);

    // Build the dialogue context
    const dialogueContext = createEmptyDialogueContext(blueprint);
    dialogueContext.relationship.player_id = playerId;
    dialogueContext.world_context = worldContext;
    dialogueContext.npc_memory = npcMemory;
    dialogueContext.conversation_memory = conversationMemory;

    // Set up some local facts
    dataStore.setLocalFacts(worldContext.zone_id, 'chunk_0_0', {
      zone_id: worldContext.zone_id,
      chunk_ids: ['chunk_0_0'],
      facts: [
        'The morning market is bustling with traders',
        'A merchant caravan arrived yesterday from the east',
      ],
      threats: [],
      opportunities: ['Rare ore shipment expected this week'],
    });

    dialogueContext.local_facts = await dataStore.getLocalFacts(
      worldContext.zone_id,
      ['chunk_0_0']
    );

    // Generate dialogue
    const dialogueRequest: DialogueRequest = {
      player_id: playerId,
      npc_id: npcId,
      player_utterance: 'Hello there! I am looking for a new sword. Can you help me?',
    };

    console.log(`Player: "${dialogueRequest.player_utterance}"\n`);

    const { response, usage: dialogueUsage, should_summarize } =
      await aiService.dialogue.generateDialogue(dialogueRequest, dialogueContext);

    console.log(`${blueprint.identity.name}: "${response.text}"\n`);
    console.log(`Intent Tags: ${response.intent_tags.join(', ')}`);
    console.log(`Memory Delta: ${response.memory_delta.length} new facts`);
    console.log(`Should Summarize: ${should_summarize}`);
    console.log(`Token Usage: ${dialogueUsage.total_tokens} tokens ($${dialogueUsage.estimated_cost_usd.toFixed(4)})`);

    // Apply memory delta if any
    if (response.memory_delta.length > 0) {
      const updatedMemory = aiService.memory.applyDialogueMemoryDelta(
        npcMemory,
        response
      );
      dataStore.setMemory(updatedMemory);
      console.log('\nMemory updated with new facts');
    }

    // =========================================================================
    // 3. Deterministic Memory Updates (Section 6.3)
    // =========================================================================

    console.log('\n=== Deterministic Memory Updates ===\n');

    // Simulate a trade event
    const tradeEvent: MemoryEvent = {
      type: 'trade_completed',
      subject: 'player',
      details: 'sold iron sword for 50 gold',
      timestamp_ms: Date.now(),
    };

    const memoryAfterTrade = aiService.memory.applyDeterministicUpdate(
      await dataStore.getMemory(npcId) ?? npcMemory,
      tradeEvent
    );

    console.log('After trade event:');
    console.log(`  Recent Summary Items: ${memoryAfterTrade.recent_summary.length}`);
    console.log(`  Latest: ${memoryAfterTrade.recent_summary[memoryAfterTrade.recent_summary.length - 1]}`);

    dataStore.setMemory(memoryAfterTrade);

    // =========================================================================
    // 4. Conversation Summarization
    // =========================================================================

    console.log('\n=== Conversation Summarization ===\n');

    // Simulate a conversation history
    const conversationHistory = [
      { speaker: 'player' as const, text: 'Hello there! I am looking for a new sword.' },
      { speaker: 'npc' as const, text: response.text },
      { speaker: 'player' as const, text: 'What about a longsword? Something durable.' },
      { speaker: 'npc' as const, text: 'Ah, a longsword! I can forge you one from the finest iron. It will take three days and cost you 75 gold pieces.' },
      { speaker: 'player' as const, text: 'That sounds reasonable. I will return in three days.' },
      { speaker: 'npc' as const, text: 'Very well! I shall have it ready for you. Do not be late, or I may sell it to another customer!' },
    ];

    console.log('Summarizing conversation...\n');

    const { memory: summarizedMemory, usage: summaryUsage } =
      await aiService.memory.summarizeConversation(
        blueprint.identity.name,
        conversationHistory,
        conversationMemory
      );

    console.log('Conversation Summary:');
    summarizedMemory.summary.forEach((item, i) => {
      console.log(`  ${i + 1}. ${item}`);
    });
    console.log(`\nKey Topics: ${summarizedMemory.key_topics_discussed.join(', ')}`);
    console.log(`Promises: ${summarizedMemory.promises_made.join('; ') || 'none'}`);
    console.log(`Token Usage: ${summaryUsage.total_tokens} tokens ($${summaryUsage.estimated_cost_usd.toFixed(4)})`);

    // =========================================================================
    // 5. Tool Functions (Section 7.3)
    // =========================================================================

    console.log('\n=== Tool Functions ===\n');

    // Use tool functions (as an agent would)
    const blueprintFromTool = await aiService.tools.getNpcBlueprint({
      npc_id: npcId,
    });
    console.log(`Tool: get_npc_blueprint -> ${blueprintFromTool.identity.name}`);

    const relationshipFromTool = await aiService.tools.getRelationship({
      player_id: playerId,
      npc_id: npcId,
    });
    console.log(`Tool: get_relationship -> Affinity: ${relationshipFromTool.affinity}, Trust: ${relationshipFromTool.trust}`);

    // Update relationship after positive interaction
    const updatedRelationship = await aiService.tools.writeRelationship({
      player_id: playerId,
      npc_id: npcId,
      delta: {
        affinity_delta: 10,
        trust_delta: 5,
        new_summary_items: ['Player ordered a custom longsword'],
      },
    });
    console.log(`Tool: write_relationship -> New Affinity: ${updatedRelationship.affinity}`);

    // =========================================================================
    // 6. Cost and Rate Limit Tracking (Section 16)
    // =========================================================================

    console.log('\n=== Cost and Rate Limit Status ===\n');

    const stats = aiService.getUsageStats();
    console.log('Total Usage:');
    console.log(`  Input Tokens: ${stats.total_input_tokens}`);
    console.log(`  Output Tokens: ${stats.total_output_tokens}`);
    console.log(`  Estimated Cost: $${stats.estimated_cost_usd.toFixed(4)}`);

    const npcRateStatus = aiService.getNpcRateLimitStatus(npcId);
    console.log(`\nNPC Rate Limit Status:`);
    console.log(`  Requests in Window: ${npcRateStatus.requests_in_window}`);
    console.log(`  Window Resets In: ${Math.ceil(npcRateStatus.window_resets_in_ms / 1000)}s`);
    console.log(`  Can Replan: ${npcRateStatus.can_replan}`);

    const playerRateStatus = aiService.getPlayerRateLimitStatus(playerId);
    console.log(`\nPlayer Rate Limit Status:`);
    console.log(`  Requests in Window: ${playerRateStatus.requests_in_window}`);
    console.log(`  Window Resets In: ${Math.ceil(playerRateStatus.window_resets_in_ms / 1000)}s`);

    console.log('\n=== Example Complete ===\n');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run if executed directly
main().catch(console.error);
