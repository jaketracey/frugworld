/**
 * S3 Storage Service
 * Provides upload and management of NPC portraits in AWS S3.
 * Uses AWS SDK v3 for S3 operations.
 */

import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';

import { S3Config, AIServiceError } from './types.js';

/**
 * Default cache control header for portrait images.
 * Set to 1 year (immutable content, versioned by npc_id).
 */
const DEFAULT_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Default content type for portrait images.
 */
const DEFAULT_CONTENT_TYPE = 'image/png';

/**
 * Creates S3Config from environment variables.
 *
 * Environment variables:
 * - AWS_REGION: AWS region (required)
 * - S3_BUCKET_NAME: S3 bucket name (required)
 * - AWS_ACCESS_KEY_ID: AWS access key (optional)
 * - AWS_SECRET_ACCESS_KEY: AWS secret key (optional)
 * - S3_PORTRAITS_PREFIX: Prefix for portrait keys (optional, defaults to 'portraits/')
 */
export function createS3ConfigFromEnv(): S3Config {
  const region = process.env.AWS_REGION;
  const bucket = process.env.S3_BUCKET_NAME;

  if (!region) {
    throw new AIServiceError(
      'AWS_REGION environment variable is required',
      'STORAGE_ERROR',
      { missing: 'AWS_REGION' }
    );
  }

  if (!bucket) {
    throw new AIServiceError(
      'S3_BUCKET_NAME environment variable is required',
      'STORAGE_ERROR',
      { missing: 'S3_BUCKET_NAME' }
    );
  }

  return {
    region,
    bucket,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    portraitsPrefix: process.env.S3_PORTRAITS_PREFIX ?? 'portraits/',
  };
}

/**
 * S3StorageService provides methods for uploading and managing NPC portraits.
 *
 * @example
 * ```typescript
 * const config = createS3ConfigFromEnv();
 * const storage = new S3StorageService(config);
 *
 * // Upload a portrait
 * const url = await storage.uploadPortrait('npc_001', imageBuffer);
 * console.log(url); // https://bucket.s3.region.amazonaws.com/portraits/npc_001.png
 *
 * // Check if portrait exists
 * const exists = await storage.portraitExists('npc_001');
 *
 * // Get the URL without uploading
 * const portraitUrl = storage.getPortraitUrl('npc_001');
 *
 * // Delete a portrait
 * await storage.deletePortrait('npc_001');
 * ```
 */
export class S3StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly region: string;
  private readonly portraitsPrefix: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.region = config.region;
    this.portraitsPrefix = this.normalizePrefix(config.portraitsPrefix);

    // Create S3 client with optional explicit credentials
    const clientConfig: {
      region: string;
      credentials?: {
        accessKeyId: string;
        secretAccessKey: string;
      };
    } = {
      region: config.region,
    };

    // Only set credentials if both are provided
    // Otherwise, the SDK will use the default credential provider chain
    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }

    this.client = new S3Client(clientConfig);
  }

  /**
   * Upload a portrait image for an NPC.
   *
   * @param npcId - The unique identifier for the NPC
   * @param imageData - The image data as a Buffer
   * @param contentType - The MIME type of the image (defaults to 'image/png')
   * @returns The public URL of the uploaded portrait
   * @throws AIServiceError if the upload fails
   */
  async uploadPortrait(
    npcId: string,
    imageData: Buffer,
    contentType: string = DEFAULT_CONTENT_TYPE
  ): Promise<string> {
    const key = this.getPortraitKey(npcId);

    const params: PutObjectCommandInput = {
      Bucket: this.bucket,
      Key: key,
      Body: imageData,
      ContentType: contentType,
      CacheControl: DEFAULT_CACHE_CONTROL,
    };

    try {
      const command = new PutObjectCommand(params);
      await this.client.send(command);

      return this.getPortraitUrl(npcId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new AIServiceError(
        `Failed to upload portrait for NPC ${npcId}: ${errorMessage}`,
        'PORTRAIT_UPLOAD_FAILED',
        {
          npc_id: npcId,
          bucket: this.bucket,
          key,
          error: errorMessage,
        }
      );
    }
  }

  /**
   * Get the public S3 URL for an NPC's portrait.
   *
   * Note: This returns the URL regardless of whether the portrait exists.
   * Use `portraitExists()` to check if the portrait is actually present.
   *
   * @param npcId - The unique identifier for the NPC
   * @returns The public S3 URL for the portrait
   */
  getPortraitUrl(npcId: string): string {
    const key = this.getPortraitKey(npcId);
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  /**
   * Check if a portrait exists for the given NPC.
   *
   * @param npcId - The unique identifier for the NPC
   * @returns True if the portrait exists, false otherwise
   */
  async portraitExists(npcId: string): Promise<boolean> {
    const key = this.getPortraitKey(npcId);

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.client.send(command);
      return true;
    } catch (error) {
      // Check if the error is a "not found" error
      if (this.isNotFoundError(error)) {
        return false;
      }
      // Re-throw other errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new AIServiceError(
        `Failed to check portrait existence for NPC ${npcId}: ${errorMessage}`,
        'STORAGE_ERROR',
        {
          npc_id: npcId,
          bucket: this.bucket,
          key,
          error: errorMessage,
        }
      );
    }
  }

  /**
   * Delete a portrait for the given NPC.
   *
   * Note: S3 DeleteObject is idempotent - it succeeds even if the object
   * doesn't exist. Use `portraitExists()` first if you need to verify
   * the portrait exists before deletion.
   *
   * @param npcId - The unique identifier for the NPC
   * @throws AIServiceError if the deletion fails
   */
  async deletePortrait(npcId: string): Promise<void> {
    const key = this.getPortraitKey(npcId);

    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.client.send(command);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new AIServiceError(
        `Failed to delete portrait for NPC ${npcId}: ${errorMessage}`,
        'STORAGE_ERROR',
        {
          npc_id: npcId,
          bucket: this.bucket,
          key,
          error: errorMessage,
        }
      );
    }
  }

  /**
   * Get the S3 key for an NPC's portrait.
   *
   * @param npcId - The unique identifier for the NPC
   * @returns The S3 key in format: {prefix}{npcId}.png
   */
  private getPortraitKey(npcId: string): string {
    return `${this.portraitsPrefix}${npcId}.png`;
  }

  /**
   * Normalize the prefix to ensure it ends with a slash.
   */
  private normalizePrefix(prefix: string): string {
    if (!prefix) {
      return '';
    }
    return prefix.endsWith('/') ? prefix : `${prefix}/`;
  }

  /**
   * Check if an error is a "not found" error from S3.
   */
  private isNotFoundError(error: unknown): boolean {
    if (error && typeof error === 'object') {
      const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      // Check for NotFound error name or 404 status code
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return true;
      }
    }
    return false;
  }
}
