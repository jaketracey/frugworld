/**
 * ComfyUI Image Provider
 *
 * Local image generation using ComfyUI's API.
 * Supports text-to-image and img2img with customizable workflows.
 */

import {
  ImageProvider,
  ImageCapabilities,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ComfyUIConfig,
} from '../types.js';

export interface ComfyUIProviderOptions extends ComfyUIConfig {
  /** Timeout for generation in milliseconds */
  timeout?: number;
  /** Poll interval for checking generation status */
  pollIntervalMs?: number;
}

interface ComfyUIPromptResponse {
  prompt_id: string;
  number: number;
}

interface ComfyUIHistoryItem {
  outputs: Record<
    string,
    {
      images?: Array<{
        filename: string;
        subfolder: string;
        type: string;
      }>;
    }
  >;
}

export class ComfyUIProvider implements ImageProvider {
  readonly name = 'comfyui';
  readonly type = 'local' as const;
  readonly capabilities: ImageCapabilities;

  private baseUrl: string;
  private checkpointName: string;
  private timeout: number;
  private pollIntervalMs: number;
  private available: boolean | null = null;

  constructor(options: ComfyUIProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.checkpointName = options.checkpointName ?? 'sd_xl_base_1.0.safetensors';
    this.timeout = options.timeout ?? 120000;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;

    this.capabilities = {
      maxResolution: 2048,
      supportedFormats: ['png', 'jpeg', 'webp'],
      averageGenerationTimeMs: 15000,
      img2img: true,
    };
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) {
      return this.available;
    }

    try {
      const response = await fetch(`${this.baseUrl}/system_stats`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      this.available = response.ok;
      return this.available;
    } catch {
      this.available = false;
      return false;
    }
  }

  async initialize(): Promise<void> {
    // ComfyUI doesn't require initialization
  }

  async shutdown(): Promise<void> {
    // ComfyUI doesn't require shutdown
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    const startTime = Date.now();

    // Build the workflow
    const workflow = this.buildWorkflow(request);

    // Queue the prompt
    const promptResponse = await this.queuePrompt(workflow);
    const promptId = promptResponse.prompt_id;

    // Wait for completion
    const outputs = await this.waitForCompletion(promptId);

    // Find the output image
    const imageInfo = this.findOutputImage(outputs);
    if (!imageInfo) {
      throw new Error('No output image found in ComfyUI response');
    }

    // Download the image
    const imageData = await this.downloadImage(imageInfo.filename, imageInfo.subfolder);
    const generationTimeMs = Date.now() - startTime;

    return {
      imageData,
      contentType: 'image/png',
      prompt: request.prompt,
      generationTimeMs,
      seed: request.seed,
    };
  }

  /**
   * Build a ComfyUI workflow for text-to-image generation
   */
  private buildWorkflow(request: ImageGenerationRequest): Record<string, unknown> {
    const seed = request.seed ?? Math.floor(Math.random() * 2147483647);
    const steps = request.steps ?? 20;
    const cfg = request.guidanceScale ?? 7.0;

    // Basic SDXL workflow
    const workflow: Record<string, unknown> = {
      '1': {
        class_type: 'CheckpointLoaderSimple',
        inputs: {
          ckpt_name: this.checkpointName,
        },
      },
      '2': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: request.prompt,
          clip: ['1', 1],
        },
      },
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: request.negativePrompt ?? '',
          clip: ['1', 1],
        },
      },
      '4': {
        class_type: 'EmptyLatentImage',
        inputs: {
          width: request.width,
          height: request.height,
          batch_size: 1,
        },
      },
      '5': {
        class_type: 'KSampler',
        inputs: {
          model: ['1', 0],
          positive: ['2', 0],
          negative: ['3', 0],
          latent_image: ['4', 0],
          seed,
          steps,
          cfg,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: request.denoisingStrength ?? 1.0,
        },
      },
      '6': {
        class_type: 'VAEDecode',
        inputs: {
          samples: ['5', 0],
          vae: ['1', 2],
        },
      },
      '7': {
        class_type: 'SaveImage',
        inputs: {
          images: ['6', 0],
          filename_prefix: 'frugworld',
        },
      },
    };

    return workflow;
  }

  /**
   * Queue a prompt in ComfyUI
   */
  private async queuePrompt(workflow: Record<string, unknown>): Promise<ComfyUIPromptResponse> {
    const response = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ComfyUI queue error: ${response.status} - ${error}`);
    }

    return (await response.json()) as ComfyUIPromptResponse;
  }

  /**
   * Wait for a prompt to complete
   */
  private async waitForCompletion(promptId: string): Promise<ComfyUIHistoryItem> {
    const startTime = Date.now();

    while (Date.now() - startTime < this.timeout) {
      const response = await fetch(`${this.baseUrl}/history/${promptId}`);

      if (response.ok) {
        const history = (await response.json()) as Record<string, ComfyUIHistoryItem>;
        const item = history[promptId];

        if (item && Object.keys(item.outputs).length > 0) {
          return item;
        }
      }

      await this.sleep(this.pollIntervalMs);
    }

    throw new Error(`ComfyUI generation timed out after ${this.timeout}ms`);
  }

  /**
   * Find the output image from the history
   */
  private findOutputImage(
    history: ComfyUIHistoryItem
  ): { filename: string; subfolder: string } | null {
    for (const output of Object.values(history.outputs)) {
      if (output.images && output.images.length > 0) {
        const image = output.images[0];
        if (image) {
          return {
            filename: image.filename,
            subfolder: image.subfolder || '',
          };
        }
      }
    }
    return null;
  }

  /**
   * Download an image from ComfyUI
   */
  private async downloadImage(filename: string, subfolder: string): Promise<Buffer> {
    const params = new URLSearchParams({
      filename,
      subfolder,
      type: 'output',
    });

    const response = await fetch(`${this.baseUrl}/view?${params}`);

    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Set the checkpoint to use
   */
  setCheckpoint(checkpointName: string): void {
    this.checkpointName = checkpointName;
  }

  /**
   * Get the current checkpoint
   */
  getCheckpoint(): string {
    return this.checkpointName;
  }

  /**
   * Get available checkpoints from ComfyUI
   */
  async getAvailableCheckpoints(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/object_info/CheckpointLoaderSimple`);
      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as {
        CheckpointLoaderSimple?: {
          input?: {
            required?: {
              ckpt_name?: [string[]];
            };
          };
        };
      };

      return data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
    } catch {
      return [];
    }
  }
}

/**
 * Create a ComfyUI provider from environment configuration
 */
export function createComfyUIProvider(): ComfyUIProvider | null {
  const baseUrl = process.env['COMFYUI_BASE_URL'];
  if (!baseUrl) {
    return null;
  }

  return new ComfyUIProvider({
    baseUrl,
    checkpointName: process.env['COMFYUI_CHECKPOINT'],
  });
}
