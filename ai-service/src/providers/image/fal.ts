/**
 * FAL.ai Image Provider
 *
 * Cloud image generation using FAL's Flux models.
 * Supports text-to-image with various model options.
 */

import { fal } from '@fal-ai/client';
import {
  ImageProvider,
  ImageCapabilities,
  ImageGenerationRequest,
  ImageGenerationResponse,
  FalConfig,
} from '../types.js';

export type FalModel =
  | 'fal-ai/flux/schnell'
  | 'fal-ai/flux-2-pro'
  | 'fal-ai/flux/dev'
  | 'fal-ai/stable-diffusion-v3-medium';

export interface FalProviderOptions extends FalConfig {
  /** Default model to use */
  defaultModel?: FalModel;
}

interface FalImageOutput {
  images?: Array<{
    url: string;
    width?: number;
    height?: number;
    content_type?: string;
  }>;
  seed?: number;
  has_nsfw_concepts?: boolean[];
}

export class FalProvider implements ImageProvider {
  readonly name = 'fal';
  readonly type = 'cloud' as const;
  readonly capabilities: ImageCapabilities;

  private apiKey: string;
  private defaultModel: FalModel;
  private configured = false;

  constructor(options: FalProviderOptions) {
    this.apiKey = options.apiKey;
    this.defaultModel = options.defaultModel ?? 'fal-ai/flux/schnell';

    this.capabilities = {
      maxResolution: 1536,
      supportedFormats: ['png', 'jpeg', 'webp'],
      averageGenerationTimeMs: 5000,
      img2img: true,
    };
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) {
      return false;
    }

    try {
      // Configure FAL client
      if (!this.configured) {
        fal.config({ credentials: this.apiKey });
        this.configured = true;
      }

      // Simple health check - FAL doesn't have a dedicated health endpoint
      // so we just check if we have credentials
      return true;
    } catch {
      return false;
    }
  }

  async initialize(): Promise<void> {
    if (!this.configured) {
      fal.config({ credentials: this.apiKey });
      this.configured = true;
    }
  }

  async shutdown(): Promise<void> {
    // FAL client doesn't require shutdown
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    if (!this.configured) {
      await this.initialize();
    }

    const startTime = Date.now();

    // Determine image size
    const imageSize = this.getImageSize(request.width, request.height);

    // Build FAL request
    const falInput: Record<string, unknown> = {
      prompt: request.prompt,
      image_size: imageSize,
      num_images: 1,
      enable_safety_checker: false,
    };

    // Add optional parameters
    if (request.negativePrompt) {
      falInput['negative_prompt'] = request.negativePrompt;
    }
    if (request.steps) {
      falInput['num_inference_steps'] = request.steps;
    }
    if (request.guidanceScale) {
      falInput['guidance_scale'] = request.guidanceScale;
    }
    if (request.seed !== undefined) {
      falInput['seed'] = request.seed;
    }

    // Handle img2img
    if (request.inputImage) {
      const base64 = request.inputImage.toString('base64');
      falInput['image_url'] = `data:image/png;base64,${base64}`;
      if (request.denoisingStrength !== undefined) {
        falInput['strength'] = request.denoisingStrength;
      }
    }

    const result = await fal.subscribe(this.defaultModel, {
      input: falInput as never, // Type assertion needed for dynamic input
      logs: false,
    });

    const output = result.data as FalImageOutput;
    const image = output.images?.[0];

    if (!image?.url) {
      throw new Error('No image URL in FAL response');
    }

    // Download the image
    const imageResponse = await fetch(image.url);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download image: ${imageResponse.statusText}`);
    }

    const imageData = Buffer.from(await imageResponse.arrayBuffer());
    const generationTimeMs = Date.now() - startTime;

    return {
      imageData,
      contentType: image.content_type ?? 'image/png',
      prompt: request.prompt,
      generationTimeMs,
      seed: output.seed,
    };
  }

  /**
   * Set the model to use for generation
   */
  setModel(model: FalModel): void {
    this.defaultModel = model;
  }

  /**
   * Get the current model
   */
  getModel(): FalModel {
    return this.defaultModel;
  }

  /**
   * Get available models
   */
  getAvailableModels(): FalModel[] {
    return [
      'fal-ai/flux/schnell',
      'fal-ai/flux-2-pro',
      'fal-ai/flux/dev',
      'fal-ai/stable-diffusion-v3-medium',
    ];
  }

  private getImageSize(
    width: number,
    height: number
  ): 'square' | 'square_hd' | 'portrait_4_3' | 'portrait_16_9' | 'landscape_4_3' | 'landscape_16_9' | { width: number; height: number } {
    // Map common sizes to FAL presets
    if (width === height) {
      return width > 1024 ? 'square_hd' : 'square';
    }

    const aspectRatio = width / height;

    if (aspectRatio > 1) {
      // Landscape
      if (aspectRatio >= 1.7) return 'landscape_16_9';
      return 'landscape_4_3';
    } else {
      // Portrait
      if (aspectRatio <= 0.6) return 'portrait_16_9';
      return 'portrait_4_3';
    }
  }
}

/**
 * Create a FAL provider from environment configuration
 */
export function createFalProvider(): FalProvider | null {
  const apiKey = process.env['FAL_KEY'];
  if (!apiKey) {
    return null;
  }

  return new FalProvider({
    apiKey,
    defaultModel: (process.env['FAL_DEFAULT_MODEL'] as FalModel) ?? 'fal-ai/flux/schnell',
  });
}
