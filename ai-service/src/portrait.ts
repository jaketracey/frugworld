/**
 * Portrait Generator Service
 * Generates stylized NPC portraits using OpenAI's gpt-image-1 model.
 * Portraits maintain visual cohesion through a consistent art style prefix.
 */

import OpenAI from 'openai';
import {
  NPCIdentity,
  NPCPersonality,
  PortraitResult,
  PortraitConfig,
  AIServiceError,
  AIServiceConfig,
} from './types.js';
import { CostController } from './cost-control.js';

/**
 * Default art style prefix for consistent visual identity across all NPC portraits.
 * Inspired by indie games with low-poly aesthetics and soft cel-shading.
 */
export const DEFAULT_STYLE_PREFIX =
  'Stylized digital portrait in a whimsical low-poly art style with soft cel-shading, ' +
  'muted earth tones with occasional vibrant accents, reminiscent of indie games like ' +
  'Monument Valley meets Stardew Valley. Character portrait showing head and shoulders ' +
  'against a simple gradient background.';

/**
 * Default portrait configuration
 */
export const DEFAULT_PORTRAIT_CONFIG: PortraitConfig = {
  style_prefix: DEFAULT_STYLE_PREFIX,
  size: 'auto',
  quality: 'low',
};

// gpt-image-1 pricing per image (as of late 2024)
// Prices vary by quality and size
const IMAGE_PRICING: Record<string, Record<string, number>> = {
  low: {
    'auto': 0.011,
    '1024x1024': 0.011,
    '1024x1536': 0.016,
    '1536x1024': 0.016,
  },
  medium: {
    'auto': 0.042,
    '1024x1024': 0.042,
    '1024x1536': 0.063,
    '1536x1024': 0.063,
  },
  high: {
    'auto': 0.167,
    '1024x1024': 0.167,
    '1024x1536': 0.250,
    '1536x1024': 0.250,
  },
  auto: {
    'auto': 0.042,
    '1024x1024': 0.042,
    '1024x1536': 0.063,
    '1536x1024': 0.063,
  },
};

export interface PortraitGeneratorOptions {
  maxRetries?: number;
  retryDelayMs?: number;
}

export class PortraitGenerator {
  private client: OpenAI;
  private costController: CostController;
  private config: PortraitConfig;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(
    aiConfig: AIServiceConfig,
    costController: CostController,
    portraitConfig?: Partial<PortraitConfig>
  ) {
    this.client = new OpenAI({
      apiKey: aiConfig.openai_api_key,
    });
    this.costController = costController;
    this.config = {
      ...DEFAULT_PORTRAIT_CONFIG,
      ...portraitConfig,
    };
    this.maxRetries = aiConfig.max_retries;
    this.retryDelayMs = aiConfig.retry_delay_ms;
  }

  /**
   * Generate a portrait for an NPC based on their identity and personality.
   * Returns the raw image data as a Buffer for upload to storage.
   */
  async generatePortrait(
    npcId: string,
    identity: NPCIdentity,
    personality: NPCPersonality
  ): Promise<PortraitResult> {
    const prompt = this.buildPrompt(identity, personality);

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.client.images.generate({
          model: 'gpt-image-1',
          prompt,
          n: 1,
          size: this.config.size,
          quality: this.config.quality,
          response_format: 'b64_json',
        });

        const imageData = response.data?.[0];
        if (!imageData || !imageData.b64_json) {
          throw new AIServiceError(
            'No image data in response',
            'PORTRAIT_GENERATION_FAILED'
          );
        }

        // Decode base64 to Buffer
        const b64Data = imageData.b64_json;
        const buffer = Buffer.from(b64Data, 'base64');

        // Track cost
        const cost = this.calculateImageCost(this.config.quality, this.config.size);
        this.costController.recordUsage({
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          estimated_cost_usd: cost,
        });

        return {
          npc_id: npcId,
          image_data: buffer,
          prompt_used: prompt,
          size: this.config.size,
          created_at_ms: Date.now(),
        };
      } catch (error) {
        lastError = error as Error;

        // Don't retry on validation/parse errors
        if (error instanceof AIServiceError) {
          throw error;
        }

        // Wait before retrying for API errors
        if (attempt < this.maxRetries - 1) {
          await this.sleep(this.retryDelayMs * (attempt + 1));
        }
      }
    }

    throw new AIServiceError(
      `Failed to generate portrait after ${this.maxRetries} attempts: ${lastError?.message}`,
      'PORTRAIT_GENERATION_FAILED',
      { original_error: lastError?.message }
    );
  }

  /**
   * Build the full prompt by combining the style prefix with NPC-specific details.
   */
  private buildPrompt(identity: NPCIdentity, personality: NPCPersonality): string {
    const parts: string[] = [];

    // Start with the consistent style prefix
    parts.push(this.config.style_prefix);

    // Add character-specific details
    parts.push('');
    parts.push('Character details:');

    // Role and age
    const ageDescriptor = this.getAgeDescriptor(identity.age);
    parts.push(`- ${ageDescriptor} ${identity.role}`);

    // Appearance tags
    if (identity.appearance.length > 0) {
      parts.push(`- Physical features: ${identity.appearance.join(', ')}`);
    }

    // Personality traits influence expression
    if (personality.traits.length > 0) {
      const expressionTraits = personality.traits.slice(0, 3);
      const expression = this.traitsToExpression(expressionTraits);
      parts.push(`- Expression: ${expression}`);
    }

    return parts.join('\n');
  }

  /**
   * Convert age number to a descriptive term for the prompt.
   */
  private getAgeDescriptor(age: number): string {
    if (age < 13) return 'young child';
    if (age < 20) return 'teenage';
    if (age < 30) return 'young adult';
    if (age < 50) return 'adult';
    if (age < 70) return 'middle-aged';
    return 'elderly';
  }

  /**
   * Convert personality traits to facial expression description.
   */
  private traitsToExpression(traits: string[]): string {
    // Map common traits to expression descriptors
    const expressionMap: Record<string, string> = {
      'cheerful': 'warm smile',
      'friendly': 'welcoming expression',
      'grumpy': 'slightly furrowed brow',
      'stern': 'serious gaze',
      'mysterious': 'enigmatic half-smile',
      'wise': 'knowing eyes',
      'shy': 'gentle, slightly averted gaze',
      'confident': 'self-assured smirk',
      'nervous': 'uncertain expression',
      'kind': 'soft, gentle eyes',
      'suspicious': 'narrowed eyes',
      'jovial': 'broad grin',
      'melancholic': 'wistful expression',
      'stoic': 'calm, neutral expression',
      'curious': 'wide-eyed interest',
      'proud': 'chin slightly raised',
      'humble': 'modest, down-to-earth look',
      'aggressive': 'intense stare',
      'peaceful': 'serene expression',
      'mischievous': 'playful smirk',
    };

    const expressions: string[] = [];
    for (const trait of traits) {
      const traitLower = trait.toLowerCase();
      for (const [key, value] of Object.entries(expressionMap)) {
        if (traitLower.includes(key)) {
          expressions.push(value);
          break;
        }
      }
    }

    if (expressions.length === 0) {
      return 'neutral, approachable expression';
    }

    return expressions.slice(0, 2).join(' with ');
  }

  /**
   * Calculate the cost for image generation based on quality and size.
   */
  private calculateImageCost(
    quality: PortraitConfig['quality'],
    size: PortraitConfig['size']
  ): number {
    const qualityPricing = IMAGE_PRICING[quality];
    if (!qualityPricing) {
      // Fallback to auto pricing
      const autoPricing = IMAGE_PRICING['auto'];
      return autoPricing ? autoPricing['auto'] ?? 0.042 : 0.042;
    }
    const sizeCost = qualityPricing[size];
    if (sizeCost !== undefined) {
      return sizeCost;
    }
    const autoSizeCost = qualityPricing['auto'];
    return autoSizeCost !== undefined ? autoSizeCost : 0.042;
  }

  /**
   * Estimate the cost for generating a portrait (for budgeting).
   */
  estimatePortraitCost(): {
    quality: string;
    size: string;
    estimated_cost_usd: number;
  } {
    const cost = this.calculateImageCost(this.config.quality, this.config.size);
    return {
      quality: this.config.quality,
      size: this.config.size,
      estimated_cost_usd: cost,
    };
  }

  /**
   * Update the portrait configuration.
   */
  updateConfig(newConfig: Partial<PortraitConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
    };
  }

  /**
   * Get the current configuration.
   */
  getConfig(): Readonly<PortraitConfig> {
    return { ...this.config };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
