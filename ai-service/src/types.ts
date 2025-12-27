/**
 * Core types for the Frugworld AI Service
 * These types define the data structures used across blueprint generation,
 * dialogue, memory summarization, and tool functions.
 */

// ============================================================================
// NPC Blueprint Types (Section 6.1)
// ============================================================================

export interface NPCIdentity {
  name: string;
  age: number;
  role: string;
  gender?: string; // "male" or "female"
  appearance: string[];
}

export interface NPCPersonality {
  traits: string[];
  values: string[];
  fears: string[];
  desires: string[];
}

export interface NPCRelationshipLink {
  npc_id: string;
  relationship_type: string;
  description: string;
}

export interface NPCVoiceStyle {
  tone: string;
  vocabulary_level: 'simple' | 'moderate' | 'sophisticated';
  speech_patterns: string[];
  catchphrases?: string[];
}

export interface NPCConstraints {
  taboo_topics: string[];
  safety_constraints: string[];
  lore_constraints: string[];
}

export interface NPCBlueprint {
  npc_id: string;
  archetype_id: string;
  identity: NPCIdentity;
  personality: NPCPersonality;
  backstory: string[]; // 5-12 bullet facts
  relationships: NPCRelationshipLink[];
  voice_style: NPCVoiceStyle;
  constraints: NPCConstraints;
  truth_anchors: string[]; // Facts the NPC will never contradict
  version: number;
  created_at_ms: number;
}

// ============================================================================
// World Context Types
// ============================================================================

export interface WorldContext {
  zone_id: string;
  zone_name: string;
  zone_type: string;
  biome: string;
  time_of_day: 'dawn' | 'morning' | 'midday' | 'afternoon' | 'dusk' | 'night';
  weather?: string;
  nearby_pois: POI[];
  active_events?: string[];
  cultural_notes?: string[];
}

export interface POI {
  poi_id: string;
  name: string;
  type: string;
  description?: string;
}

export interface LocalFacts {
  zone_id: string;
  chunk_ids: string[];
  facts: string[];
  threats: string[];
  opportunities: string[];
}

// ============================================================================
// Archetype Types
// ============================================================================

export interface NPCArchetype {
  archetype_id: string;
  category: string;
  base_role: string;
  personality_tendencies: Partial<NPCPersonality>;
  typical_voice: Partial<NPCVoiceStyle>;
  common_backstory_elements: string[];
  default_constraints: Partial<NPCConstraints>;
}

// ============================================================================
// Relationship Types (Section 14.3)
// ============================================================================

export interface RelationshipFlags {
  offended: boolean;
  owes_favor: boolean;
  friend: boolean;
  hostile: boolean;
  romantic_interest?: boolean;
  business_partner?: boolean;
}

export interface Relationship {
  player_id: string;
  npc_id: string;
  affinity: number;  // -100 to 100
  trust: number;     // -100 to 100
  flags: RelationshipFlags;
  conversation_summary: string[];
  interaction_count: number;
  last_interaction_ms: number;
}

export interface RelationshipDelta {
  affinity_delta?: number;
  trust_delta?: number;
  flag_changes?: Partial<RelationshipFlags>;
  new_summary_items?: string[];
}

// ============================================================================
// Memory Types (Section 6.3)
// ============================================================================

export interface NPCMemory {
  npc_id: string;
  canonical_facts: string[];       // From blueprint, immutable
  recent_summary: string[];        // 5-15 bullets of recent events
  last_updated_ms: number;
}

export interface ConversationMemory {
  player_id: string;
  npc_id: string;
  summary: string[];               // Rolling summary of interactions
  key_topics_discussed: string[];
  promises_made: string[];
  last_updated_ms: number;
}

export interface MemorySummaryDelta {
  add_facts?: string[];
  remove_facts?: string[];
  replace_all?: string[];
}

// ============================================================================
// Dialogue Types (Section 7 & 15)
// ============================================================================

export type IntentTag =
  | 'greeting'
  | 'farewell'
  | 'offer_trade'
  | 'accept_trade'
  | 'reject_trade'
  | 'ask_question'
  | 'answer_question'
  | 'give_hint'
  | 'give_quest'
  | 'complete_quest'
  | 'express_emotion'
  | 'make_request'
  | 'grant_request'
  | 'deny_request'
  | 'share_rumor'
  | 'warn'
  | 'threaten'
  | 'apologize'
  | 'thank'
  | 'small_talk'
  | 'lore_dump';

export interface DialogueAction {
  action_type: string;
  target_id?: string;
  parameters?: Record<string, unknown>;
  description: string;
}

export interface DialogueRequest {
  player_id: string;
  npc_id: string;
  player_utterance: string;
  context_hint?: string;
}

export interface DialogueResponse {
  text: string;
  intent_tags: IntentTag[];
  memory_delta: string[];
  relationship_delta?: RelationshipDelta;
  actions: DialogueAction[];
}

export interface DialogueContext {
  blueprint: NPCBlueprint;
  relationship: Relationship;
  npc_memory: NPCMemory;
  conversation_memory: ConversationMemory;
  local_facts: LocalFacts;
  world_context: WorldContext;
}

// ============================================================================
// Cost Control Types (Section 16)
// ============================================================================

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
}

export interface RateLimitConfig {
  max_requests_per_minute_per_npc: number;
  max_requests_per_minute_per_player: number;
  max_tokens_per_response: number;
  conversation_auto_summarize_threshold: number;
  replan_cooldown_ms: number; // e.g., 3600000 for 1 hour
}

export interface RateLimitState {
  npc_request_counts: Map<string, { count: number; window_start_ms: number }>;
  player_request_counts: Map<string, { count: number; window_start_ms: number }>;
  npc_last_replan: Map<string, number>;
  conversation_lengths: Map<string, number>; // key: `${player_id}:${npc_id}`
}

// ============================================================================
// Tool Function Types (Section 7.3)
// ============================================================================

export interface ToolFunction<TInput, TOutput> {
  name: string;
  description: string;
  execute: (input: TInput) => Promise<TOutput>;
}

export interface GetBlueprintInput {
  npc_id: string;
}

export interface GetRelationshipInput {
  player_id: string;
  npc_id: string;
}

export interface GetLocalFactsInput {
  zone_id: string;
  chunk_ids: string[];
}

export interface WriteMemoryInput {
  npc_id: string;
  summary_delta: MemorySummaryDelta;
}

export interface WriteRelationshipInput {
  player_id: string;
  npc_id: string;
  delta: RelationshipDelta;
}

export interface GetMemoryInput {
  npc_id: string;
}

export interface EmitEventInput {
  event_type: string;
  payload: Record<string, unknown>;
  actor_id?: string;
  target_id?: string;
  zone_id?: string;
  chunk_x?: number;
  chunk_y?: number;
}

export interface GameEvent {
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  actor_id?: string;
  target_id?: string;
  zone_id?: string;
  chunk_x?: number;
  chunk_y?: number;
  timestamp_ms: number;
}

// ============================================================================
// Voice Generation Types (ElevenLabs Integration)
// ============================================================================

export interface VoiceConfig {
  voice_id: string;
  model_id?: string;
  stability?: number;      // 0.0 to 1.0
  similarity_boost?: number; // 0.0 to 1.0
  style?: number;          // 0.0 to 1.0
  use_speaker_boost?: boolean;
}

export interface VoiceGenerationRequest {
  text: string;
  voice_config: VoiceConfig;
  output_format?: 'mp3_44100_128' | 'mp3_22050_32' | 'pcm_16000' | 'pcm_22050' | 'pcm_44100';
}

export interface VoiceGenerationResponse {
  audio_data: Buffer;
  content_type: string;
  character_count: number;
  estimated_cost_usd: number;
}

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  description?: string;
  preview_url?: string;
}

export interface NPCVoiceMapping {
  npc_id: string;
  voice_id: string;
  voice_settings: Omit<VoiceConfig, 'voice_id'>;
}

// ============================================================================
// Replanning Types (Section 8)
// ============================================================================

export type ReplanTrigger =
  | 'lost_job'
  | 'lost_home'
  | 'relationship_change'
  | 'persistent_threat'
  | 'injury'
  | 'quest_milestone'
  | 'major_discovery'
  | 'betrayal';

export interface ReplanRequest {
  npc_id: string;
  trigger: ReplanTrigger;
  trigger_details: string;
  current_state: {
    long_term_goal: string;
    mid_term_goal: string;
    needs: Record<string, number>;
    location: string;
  };
}

export interface ReplanResponse {
  new_mid_term_goal: string;
  new_constraints: string[];
  planned_steps: string[];  // 1-3 steps
  updated_memory_summary: string[];
  reasoning: string;
}

// ============================================================================
// Service Configuration
// ============================================================================

export interface AIServiceConfig {
  openai_api_key: string;
  model_blueprint: string;      // e.g., 'gpt-4o' for blueprints
  model_dialogue: string;       // e.g., 'gpt-4o-mini' for dialogue
  model_summary: string;        // e.g., 'gpt-4o-mini' for summaries
  model_replan: string;         // e.g., 'gpt-4o' for replanning
  rate_limits: RateLimitConfig;
  enable_cost_tracking: boolean;
  max_retries: number;
  retry_delay_ms: number;
  // ElevenLabs voice configuration
  elevenlabs_api_key?: string;
  elevenlabs_model_id?: string;  // e.g., 'eleven_multilingual_v2'
  voice_enabled?: boolean;
}

export const DEFAULT_CONFIG: Omit<AIServiceConfig, 'openai_api_key'> = {
  model_blueprint: 'gpt-4o',
  model_dialogue: 'gpt-4o-mini',
  model_summary: 'gpt-4o-mini',
  model_replan: 'gpt-4o',
  rate_limits: {
    max_requests_per_minute_per_npc: 10,
    max_requests_per_minute_per_player: 30,
    max_tokens_per_response: 500,
    conversation_auto_summarize_threshold: 20,
    replan_cooldown_ms: 3600000, // 1 hour
  },
  enable_cost_tracking: true,
  max_retries: 3,
  retry_delay_ms: 1000,
  // ElevenLabs defaults
  elevenlabs_model_id: 'eleven_multilingual_v2',
  voice_enabled: false,
};

// ============================================================================
// Error Types
// ============================================================================

export class AIServiceError extends Error {
  constructor(
    message: string,
    public readonly code: AIErrorCode,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AIServiceError';
  }
}

export type AIErrorCode =
  | 'RATE_LIMITED'
  | 'TOKEN_LIMIT_EXCEEDED'
  | 'INVALID_INPUT'
  | 'BLUEPRINT_NOT_FOUND'
  | 'RELATIONSHIP_NOT_FOUND'
  | 'API_ERROR'
  | 'PARSE_ERROR'
  | 'REPLAN_COOLDOWN'
  | 'VALIDATION_ERROR'
  | 'VOICE_NOT_FOUND'
  | 'VOICE_GENERATION_FAILED'
  | 'VOICE_SERVICE_DISABLED'
  | 'PORTRAIT_GENERATION_FAILED'
  | 'STORAGE_ERROR'
  | 'PORTRAIT_NOT_FOUND'
  | 'PORTRAIT_UPLOAD_FAILED';

// ============================================================================
// Portrait Generation Types
// ============================================================================

export interface PortraitResult {
  npc_id: string;
  image_data: Buffer;  // base64 decoded image data
  prompt_used: string;
  size: string;
  created_at_ms: number;
}

export interface PortraitConfig {
  style_prefix: string;
  size: 'auto' | '1024x1024' | '1024x1536' | '1536x1024';
  quality: 'low' | 'medium' | 'high' | 'auto';
}

// ============================================================================
// S3 Storage Types (Portrait Storage)
// ============================================================================

export interface S3Config {
  /** AWS region (e.g., 'us-east-1') */
  region: string;
  /** S3 bucket name */
  bucket: string;
  /** AWS access key ID (optional, uses default credentials if not provided) */
  accessKeyId?: string;
  /** AWS secret access key (optional, uses default credentials if not provided) */
  secretAccessKey?: string;
  /** Prefix for portrait keys (e.g., 'portraits/') */
  portraitsPrefix: string;
}
