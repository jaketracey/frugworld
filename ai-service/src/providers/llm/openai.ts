/**
 * OpenAI LLM Provider
 *
 * Wraps the OpenAI SDK to implement the LLMProvider interface.
 * Supports structured JSON output, function calling, and streaming.
 */

import OpenAI from 'openai';
import {
  LLMProvider,
  LLMCapabilities,
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMStreamChunk,
  OpenAIConfig,
} from '../types.js';

export interface OpenAIProviderOptions extends OpenAIConfig {
  /** Model to use for completions */
  model: string;
  /** Default max tokens if not specified in request */
  defaultMaxTokens?: number;
  /** Default temperature if not specified in request */
  defaultTemperature?: number;
}

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  readonly type = 'cloud' as const;
  readonly capabilities: LLMCapabilities;

  private client: OpenAI;
  private model: string;
  private defaultMaxTokens: number;
  private defaultTemperature: number;
  private available: boolean | null = null;

  constructor(options: OpenAIProviderOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
      organization: options.organization,
    });

    this.model = options.model;
    this.defaultMaxTokens = options.defaultMaxTokens ?? 500;
    this.defaultTemperature = options.defaultTemperature ?? 0.7;

    // Set capabilities based on model
    this.capabilities = {
      structuredOutput: true,
      functionCalling: true,
      maxContextTokens: this.getMaxContextTokens(options.model),
      streaming: true,
    };
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) {
      return this.available;
    }

    try {
      // Simple availability check - list models
      await this.client.models.list();
      this.available = true;
      return true;
    } catch (error) {
      console.warn('OpenAI provider not available:', error);
      this.available = false;
      return false;
    }
  }

  async initialize(): Promise<void> {
    // OpenAI SDK doesn't require initialization
  }

  async shutdown(): Promise<void> {
    // OpenAI SDK doesn't require shutdown
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = request.messages.map(
      (msg) => ({
        role: msg.role,
        content: msg.content,
      })
    );

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      temperature: request.temperature ?? this.defaultTemperature,
      stop: request.stop,
      response_format:
        request.responseFormat === 'json' ? { type: 'json_object' } : undefined,
    });

    const choice = response.choices[0];
    const content = choice?.message?.content ?? '';

    return {
      content,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      finishReason: this.mapFinishReason(choice?.finish_reason),
      raw: response,
    };
  }

  async *stream(request: LLMCompletionRequest): AsyncIterable<LLMStreamChunk> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = request.messages.map(
      (msg) => ({
        role: msg.role,
        content: msg.content,
      })
    );

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      temperature: request.temperature ?? this.defaultTemperature,
      stop: request.stop,
      response_format:
        request.responseFormat === 'json' ? { type: 'json_object' } : undefined,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content ?? '';
      const done = chunk.choices[0]?.finish_reason !== null;

      yield { content, done };
    }
  }

  /**
   * Update the model being used
   */
  setModel(model: string): void {
    this.model = model;
    this.capabilities.maxContextTokens = this.getMaxContextTokens(model);
  }

  /**
   * Get the current model
   */
  getModel(): string {
    return this.model;
  }

  private mapFinishReason(
    reason: string | null | undefined
  ): 'stop' | 'length' | 'error' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      default:
        return 'stop';
    }
  }

  private getMaxContextTokens(model: string): number {
    // Context window sizes for common OpenAI models
    const contextSizes: Record<string, number> = {
      'gpt-4o': 128000,
      'gpt-4o-mini': 128000,
      'gpt-4-turbo': 128000,
      'gpt-4': 8192,
      'gpt-3.5-turbo': 16385,
      'o1': 200000,
      'o1-mini': 128000,
    };

    // Check for exact match or prefix match
    for (const [modelName, tokens] of Object.entries(contextSizes)) {
      if (model === modelName || model.startsWith(modelName)) {
        return tokens;
      }
    }

    // Default to 4096 for unknown models
    return 4096;
  }
}

/**
 * Create an OpenAI provider from environment configuration
 */
export function createOpenAIProvider(model: string): OpenAIProvider | null {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    return null;
  }

  return new OpenAIProvider({
    apiKey,
    model,
    baseUrl: process.env['OPENAI_BASE_URL'],
    organization: process.env['OPENAI_ORGANIZATION'],
  });
}
