/**
 * Provider Abstraction Layer - Core Types
 *
 * These interfaces define the contract for all AI providers (LLM, Image, TTS).
 * Providers can be local (Ollama, ComfyUI, Piper) or cloud (OpenAI, FAL, ElevenLabs).
 */

// ============================================================================
// Base Provider Interface
// ============================================================================

export type ProviderType = 'local' | 'cloud';

export interface AIProvider {
  readonly name: string;
  readonly type: ProviderType;

  /** Check if the provider is available (server running, API key valid, etc.) */
  isAvailable(): Promise<boolean>;

  /** Initialize the provider (load models, establish connections, etc.) */
  initialize?(): Promise<void>;

  /** Clean shutdown (release resources, close connections, etc.) */
  shutdown?(): Promise<void>;
}

// ============================================================================
// LLM Provider Interface
// ============================================================================

export interface LLMCapabilities {
  /** Whether the provider supports structured JSON output */
  structuredOutput: boolean;
  /** Whether the provider supports function/tool calling */
  functionCalling: boolean;
  /** Maximum context window in tokens */
  maxContextTokens: number;
  /** Whether streaming is supported */
  streaming: boolean;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCompletionRequest {
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Request JSON output format */
  responseFormat?: 'text' | 'json';
  /** JSON schema for structured output validation (provider-specific support) */
  jsonSchema?: Record<string, unknown>;
  /** Stop sequences */
  stop?: string[];
}

export interface LLMCompletionResponse {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  finishReason: 'stop' | 'length' | 'error';
  /** Raw provider response for debugging */
  raw?: unknown;
}

export interface LLMStreamChunk {
  content: string;
  done: boolean;
}

export interface LLMProvider extends AIProvider {
  readonly capabilities: LLMCapabilities;

  /** Generate a completion */
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse>;

  /** Stream a completion (optional) */
  stream?(request: LLMCompletionRequest): AsyncIterable<LLMStreamChunk>;
}

// ============================================================================
// Image Provider Interface
// ============================================================================

export interface ImageCapabilities {
  /** Maximum supported resolution */
  maxResolution: number;
  /** Supported output formats */
  supportedFormats: string[];
  /** Typical generation time in milliseconds */
  averageGenerationTimeMs: number;
  /** Whether img2img is supported */
  img2img: boolean;
}

export interface ImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  /** Number of inference steps */
  steps?: number;
  /** CFG scale / guidance scale */
  guidanceScale?: number;
  /** Seed for reproducibility */
  seed?: number;
  /** Base image for img2img */
  inputImage?: Buffer;
  /** Denoising strength for img2img (0-1) */
  denoisingStrength?: number;
}

export interface ImageGenerationResponse {
  /** Generated image data */
  imageData: Buffer;
  /** MIME type */
  contentType: string;
  /** The prompt used (may be modified by provider) */
  prompt: string;
  /** Generation time in milliseconds */
  generationTimeMs: number;
  /** Seed used */
  seed?: number;
}

export interface ImageProvider extends AIProvider {
  readonly capabilities: ImageCapabilities;

  /** Generate an image */
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResponse>;
}

// ============================================================================
// TTS Provider Interface
// ============================================================================

export interface TTSCapabilities {
  /** Number of available voices */
  voiceCount: number;
  /** Whether SSML is supported */
  supportsSSML: boolean;
  /** Supported audio formats */
  supportedFormats: string[];
  /** Whether voice cloning is supported */
  voiceCloning: boolean;
}

export interface TTSVoice {
  id: string;
  name: string;
  gender?: 'male' | 'female' | 'neutral';
  language: string;
  /** URL to preview the voice */
  previewUrl?: string;
  /** Tags for voice characteristics */
  tags?: string[];
}

export interface TTSSynthesisRequest {
  text: string;
  voiceId: string;
  /** Speech rate multiplier (1.0 = normal) */
  speed?: number;
  /** Pitch adjustment */
  pitch?: number;
  /** Output format */
  format?: 'mp3' | 'wav' | 'ogg' | 'raw';
  /** Voice stability (provider-specific) */
  stability?: number;
  /** Similarity boost (provider-specific) */
  similarityBoost?: number;
}

export interface TTSSynthesisResponse {
  /** Audio data */
  audioData: Buffer;
  /** MIME type */
  contentType: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Sample rate */
  sampleRate?: number;
}

export interface TTSProvider extends AIProvider {
  readonly capabilities: TTSCapabilities;

  /** List available voices */
  listVoices(): Promise<TTSVoice[]>;

  /** Synthesize speech */
  synthesize(request: TTSSynthesisRequest): Promise<TTSSynthesisResponse>;
}

// ============================================================================
// STT Provider Interface (Speech-to-Text)
// ============================================================================

export interface STTCapabilities {
  /** Supported audio formats */
  supportedFormats: string[];
  /** Maximum audio duration in seconds */
  maxDurationSeconds: number;
  /** Supported languages (ISO codes) */
  languages: string[];
}

export interface STTTranscriptionRequest {
  /** Audio data */
  audioData: Buffer;
  /** Audio format */
  format: string;
  /** Language hint */
  language?: string;
  /** Enable word-level timestamps */
  timestamps?: boolean;
}

export interface STTTranscriptionResponse {
  text: string;
  /** Word-level timestamps if requested */
  words?: Array<{
    word: string;
    start: number;
    end: number;
  }>;
  /** Detected language */
  language?: string;
  /** Confidence score (0-1) */
  confidence?: number;
}

export interface STTProvider extends AIProvider {
  readonly capabilities: STTCapabilities;

  /** Transcribe audio to text */
  transcribe(request: STTTranscriptionRequest): Promise<STTTranscriptionResponse>;
}

// ============================================================================
// Provider Configuration Types
// ============================================================================

export type ProviderPriority = 'local-first' | 'cloud-first' | 'local-only' | 'cloud-only';

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  keepAlive?: string;
}

export interface LlamaCppConfig {
  modelPath: string;
  contextSize?: number;
  gpuLayers?: number;
  threads?: number;
}

export interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
}

export interface AnthropicConfig {
  apiKey: string;
}

export interface ComfyUIConfig {
  baseUrl: string;
  checkpointName?: string;
}

export interface Automatic1111Config {
  baseUrl: string;
  checkpointName?: string;
}

export interface FalConfig {
  apiKey: string;
  model?: string;
}

export interface PiperConfig {
  modelsPath: string;
  defaultVoice?: string;
  piperPath?: string;
}

export interface CoquiConfig {
  modelsPath: string;
  defaultVoice?: string;
}

export interface ElevenLabsConfig {
  apiKey: string;
  modelId?: string;
}

// ============================================================================
// Provider Registry Configuration
// ============================================================================

export interface LLMProviderConfig {
  priority: ProviderPriority;
  /** Model mappings for different tasks */
  models: {
    dialogue: string;
    blueprint: string;
    summary: string;
    replan: string;
  };
  ollama?: OllamaConfig;
  llamaCpp?: LlamaCppConfig;
  openai?: OpenAIConfig;
  anthropic?: AnthropicConfig;
}

export interface ImageProviderConfig {
  priority: ProviderPriority;
  comfyui?: ComfyUIConfig;
  automatic1111?: Automatic1111Config;
  fal?: FalConfig;
  openai?: OpenAIConfig;
}

export interface TTSProviderConfig {
  priority: ProviderPriority;
  enabled: boolean;
  piper?: PiperConfig;
  coqui?: CoquiConfig;
  elevenlabs?: ElevenLabsConfig;
}

export interface STTProviderConfig {
  priority: ProviderPriority;
  openai?: OpenAIConfig;
}

export interface ProviderRegistryConfig {
  llm: LLMProviderConfig;
  image: ImageProviderConfig;
  tts: TTSProviderConfig;
  stt: STTProviderConfig;
}
