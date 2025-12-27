/**
 * Ollama LLM Provider
 *
 * Local-first LLM provider using Ollama's REST API.
 * Supports JSON mode and streaming.
 */

import {
  LLMProvider,
  LLMCapabilities,
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMStreamChunk,
  OllamaConfig,
} from '../types.js';

export interface OllamaProviderOptions extends OllamaConfig {
  /** Default max tokens if not specified in request */
  defaultMaxTokens?: number;
  /** Default temperature if not specified in request */
  defaultTemperature?: number;
}

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaStreamChunk {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  readonly type = 'local' as const;
  readonly capabilities: LLMCapabilities;

  private baseUrl: string;
  private model: string;
  private keepAlive: string;
  private defaultMaxTokens: number;
  private defaultTemperature: number;
  private available: boolean | null = null;

  constructor(options: OllamaProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.model = options.model;
    this.keepAlive = options.keepAlive ?? '5m';
    this.defaultMaxTokens = options.defaultMaxTokens ?? 500;
    this.defaultTemperature = options.defaultTemperature ?? 0.7;

    this.capabilities = {
      structuredOutput: true, // Ollama supports JSON mode
      functionCalling: false, // Not natively supported
      maxContextTokens: this.getDefaultContextSize(),
      streaming: true,
    };
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) {
      return this.available;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        this.available = false;
        return false;
      }

      // Check if our model is available
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = data.models ?? [];
      const modelNames = models.map((m) => m.name);

      // Check for exact match or base name match
      const modelBaseName = this.model.split(':')[0] ?? this.model;
      const hasModel = modelNames.some(
        (name) => name === this.model || name.startsWith(modelBaseName)
      );

      this.available = hasModel;
      return hasModel;
    } catch (error) {
      console.warn('Ollama provider not available:', error);
      this.available = false;
      return false;
    }
  }

  async initialize(): Promise<void> {
    // Pre-load the model to reduce first-request latency
    try {
      await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: '',
          keep_alive: this.keepAlive,
        }),
      });
    } catch {
      // Ignore errors during preload
    }
  }

  async shutdown(): Promise<void> {
    // Optionally unload the model
    try {
      await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          keep_alive: '0',
        }),
      });
    } catch {
      // Ignore errors during shutdown
    }
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const messages = request.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        options: {
          num_predict: request.maxTokens ?? this.defaultMaxTokens,
          temperature: request.temperature ?? this.defaultTemperature,
          stop: request.stop,
        },
        format: request.responseFormat === 'json' ? 'json' : undefined,
        keep_alive: this.keepAlive,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as OllamaChatResponse;

    return {
      content: data.message.content,
      usage: {
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
      },
      finishReason: 'stop',
      raw: data,
    };
  }

  async *stream(request: LLMCompletionRequest): AsyncIterable<LLMStreamChunk> {
    const messages = request.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        options: {
          num_predict: request.maxTokens ?? this.defaultMaxTokens,
          temperature: request.temperature ?? this.defaultTemperature,
          stop: request.stop,
        },
        format: request.responseFormat === 'json' ? 'json' : undefined,
        keep_alive: this.keepAlive,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const chunk = JSON.parse(line) as OllamaStreamChunk;
            yield {
              content: chunk.message.content,
              done: chunk.done,
            };
          } catch {
            // Skip malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Update the model being used
   */
  setModel(model: string): void {
    this.model = model;
    this.available = null; // Reset availability check
  }

  /**
   * Get the current model
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Pull a model if not available locally
   */
  async pullModel(model?: string): Promise<void> {
    const modelToPull = model ?? this.model;

    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelToPull }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to pull model: ${error}`);
    }

    // Wait for pull to complete
    const reader = response.body?.getReader();
    if (reader) {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
      reader.releaseLock();
    }

    this.available = null; // Reset availability check
  }

  private getDefaultContextSize(): number {
    // Default context sizes for common models
    // These can vary based on the specific model variant
    return 8192;
  }
}

/**
 * Create an Ollama provider from environment configuration
 */
export function createOllamaProvider(model?: string): OllamaProvider {
  return new OllamaProvider({
    baseUrl: process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434',
    model: model ?? process.env['LLM_MODEL_DIALOGUE'] ?? 'llama3.2:3b',
    keepAlive: process.env['OLLAMA_KEEP_ALIVE'] ?? '5m',
  });
}
