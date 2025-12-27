/**
 * Piper TTS Provider
 *
 * Local text-to-speech using Piper (ONNX-based TTS).
 * Fast, lightweight, and runs fully offline.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  TTSProvider,
  TTSCapabilities,
  TTSVoice,
  TTSSynthesisRequest,
  TTSSynthesisResponse,
  PiperConfig,
} from '../types.js';

export interface PiperProviderOptions extends PiperConfig {
  /** Path to piper executable */
  piperPath?: string;
  /** Sample rate for output */
  sampleRate?: number;
}

interface PiperVoiceInfo {
  name: string;
  language: string;
  quality: string;
  gender?: 'male' | 'female';
}

export class PiperProvider implements TTSProvider {
  readonly name = 'piper';
  readonly type = 'local' as const;
  readonly capabilities: TTSCapabilities;

  private modelsPath: string;
  private defaultVoice: string;
  private piperPath: string;
  private sampleRate: number;
  private available: boolean | null = null;
  private voiceCache: Map<string, TTSVoice> = new Map();

  constructor(options: PiperProviderOptions) {
    this.modelsPath = options.modelsPath;
    this.defaultVoice = options.defaultVoice ?? 'en_US-lessac-medium';
    this.piperPath = options.piperPath ?? 'piper';
    this.sampleRate = options.sampleRate ?? 22050;

    this.capabilities = {
      voiceCount: 0, // Will be populated when scanning models
      supportsSSML: false,
      supportedFormats: ['wav', 'raw'],
      voiceCloning: false,
    };
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) {
      return this.available;
    }

    try {
      // Check if piper executable exists
      const piperExists = await this.checkPiperExists();
      if (!piperExists) {
        this.available = false;
        return false;
      }

      // Check if models directory exists and has at least one model
      if (!fs.existsSync(this.modelsPath)) {
        this.available = false;
        return false;
      }

      const models = await this.scanModels();
      this.available = models.length > 0;
      return this.available;
    } catch {
      this.available = false;
      return false;
    }
  }

  async initialize(): Promise<void> {
    // Scan for available voices
    await this.listVoices();
  }

  async shutdown(): Promise<void> {
    this.voiceCache.clear();
  }

  async listVoices(): Promise<TTSVoice[]> {
    const models = await this.scanModels();
    const voices: TTSVoice[] = [];

    for (const model of models) {
      const voice: TTSVoice = {
        id: model.name,
        name: this.formatVoiceName(model.name),
        gender: model.gender,
        language: model.language,
        tags: [model.quality],
      };

      voices.push(voice);
      this.voiceCache.set(model.name, voice);
    }

    // Update capability
    (this.capabilities as { voiceCount: number }).voiceCount = voices.length;

    return voices;
  }

  async synthesize(request: TTSSynthesisRequest): Promise<TTSSynthesisResponse> {
    const voiceId = request.voiceId || this.defaultVoice;
    const modelPath = path.join(this.modelsPath, `${voiceId}.onnx`);

    if (!fs.existsSync(modelPath)) {
      throw new Error(`Voice model not found: ${voiceId}`);
    }

    const startTime = Date.now();

    // Use piper to generate audio
    const audioData = await this.runPiper(request.text, modelPath, request.speed);

    // Convert raw PCM to WAV if needed
    const wavData =
      request.format === 'raw' ? audioData : this.pcmToWav(audioData, this.sampleRate);

    const durationMs = Date.now() - startTime;

    return {
      audioData: wavData,
      contentType: request.format === 'raw' ? 'audio/raw' : 'audio/wav',
      durationMs,
      sampleRate: this.sampleRate,
    };
  }

  /**
   * Set the default voice
   */
  setDefaultVoice(voiceId: string): void {
    this.defaultVoice = voiceId;
  }

  /**
   * Get the default voice
   */
  getDefaultVoice(): string {
    return this.defaultVoice;
  }

  /**
   * Download a voice model from Piper's model repository
   */
  async downloadVoice(voiceId: string): Promise<void> {
    // Piper models are available from Hugging Face
    const baseUrl = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';
    const [lang, region, name, quality] = voiceId.split(/[-_]/);

    const languageCode = `${lang}_${region}`;
    const voicePath = `${languageCode}/${name}/${quality}`;

    // Download .onnx file
    const onnxUrl = `${baseUrl}/${voicePath}/${voiceId}.onnx`;
    const onnxPath = path.join(this.modelsPath, `${voiceId}.onnx`);

    // Download .onnx.json config file
    const jsonUrl = `${baseUrl}/${voicePath}/${voiceId}.onnx.json`;
    const jsonPath = path.join(this.modelsPath, `${voiceId}.onnx.json`);

    // Ensure models directory exists
    if (!fs.existsSync(this.modelsPath)) {
      fs.mkdirSync(this.modelsPath, { recursive: true });
    }

    // Download files
    await this.downloadFile(onnxUrl, onnxPath);
    await this.downloadFile(jsonUrl, jsonPath);

    // Reset availability check
    this.available = null;
  }

  private async checkPiperExists(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this.piperPath, ['--version']);

      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0));

      // Timeout after 5 seconds
      setTimeout(() => {
        proc.kill();
        resolve(false);
      }, 5000);
    });
  }

  private async scanModels(): Promise<PiperVoiceInfo[]> {
    if (!fs.existsSync(this.modelsPath)) {
      return [];
    }

    const files = fs.readdirSync(this.modelsPath);
    const models: PiperVoiceInfo[] = [];

    for (const file of files) {
      if (file.endsWith('.onnx')) {
        const name = file.replace('.onnx', '');
        const info = this.parseVoiceName(name);
        if (info) {
          models.push(info);
        }
      }
    }

    return models;
  }

  private parseVoiceName(name: string): PiperVoiceInfo | null {
    // Piper voice names follow the pattern: lang_REGION-name-quality
    // e.g., en_US-lessac-medium, de_DE-thorsten-high
    const match = name.match(/^([a-z]{2})_([A-Z]{2})-([a-z]+)-(\w+)$/);
    if (!match) {
      return null;
    }

    const [, lang, region, voiceName, quality] = match;

    return {
      name,
      language: `${lang}-${region}`,
      quality: quality ?? 'medium',
      gender: undefined, // Piper doesn't encode gender in the name
    };
  }

  private formatVoiceName(name: string): string {
    // Convert en_US-lessac-medium to "Lessac (US English, Medium)"
    const match = name.match(/^([a-z]{2})_([A-Z]{2})-([a-z]+)-(\w+)$/);
    if (!match) {
      return name;
    }

    const [, lang, region, voiceName, quality] = match;
    const langName = this.getLanguageName(lang ?? '', region ?? '');
    const formattedName = (voiceName ?? '').charAt(0).toUpperCase() + (voiceName ?? '').slice(1);
    const formattedQuality = (quality ?? '').charAt(0).toUpperCase() + (quality ?? '').slice(1);

    return `${formattedName} (${langName}, ${formattedQuality})`;
  }

  private getLanguageName(lang: string, region: string): string {
    const languages: Record<string, string> = {
      en_US: 'US English',
      en_GB: 'British English',
      de_DE: 'German',
      fr_FR: 'French',
      es_ES: 'Spanish',
      it_IT: 'Italian',
      pt_BR: 'Brazilian Portuguese',
      nl_NL: 'Dutch',
      pl_PL: 'Polish',
      ru_RU: 'Russian',
      zh_CN: 'Chinese',
      ja_JP: 'Japanese',
      ko_KR: 'Korean',
    };

    return languages[`${lang}_${region}`] ?? `${lang}-${region}`;
  }

  private async runPiper(
    text: string,
    modelPath: string,
    speed?: number
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const args = ['--model', modelPath, '--output_raw'];

      if (speed && speed !== 1.0) {
        args.push('--length_scale', String(1.0 / speed));
      }

      const piper = spawn(this.piperPath, args);

      const chunks: Buffer[] = [];
      let errorOutput = '';

      piper.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      piper.stderr.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      piper.on('error', (err) => {
        reject(new Error(`Piper process error: ${err.message}`));
      });

      piper.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Piper exited with code ${code}: ${errorOutput}`));
        } else {
          resolve(Buffer.concat(chunks));
        }
      });

      // Send text to piper stdin
      piper.stdin.write(text);
      piper.stdin.end();

      // Timeout after 30 seconds
      setTimeout(() => {
        piper.kill();
        reject(new Error('Piper synthesis timed out'));
      }, 30000);
    });
  }

  private pcmToWav(pcmData: Buffer, sampleRate: number): Buffer {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;

    const wavHeader = Buffer.alloc(44);

    // RIFF header
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36 + pcmData.length, 4);
    wavHeader.write('WAVE', 8);

    // fmt chunk
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16); // Subchunk1Size
    wavHeader.writeUInt16LE(1, 20); // AudioFormat (PCM)
    wavHeader.writeUInt16LE(numChannels, 22);
    wavHeader.writeUInt32LE(sampleRate, 24);
    wavHeader.writeUInt32LE(byteRate, 28);
    wavHeader.writeUInt16LE(blockAlign, 32);
    wavHeader.writeUInt16LE(bitsPerSample, 34);

    // data chunk
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(pcmData.length, 40);

    return Buffer.concat([wavHeader, pcmData]);
  }

  private async downloadFile(url: string, outputPath: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
  }
}

/**
 * Create a Piper provider from environment configuration
 */
export function createPiperProvider(): PiperProvider | null {
  const modelsPath = process.env['PIPER_MODELS_PATH'];
  if (!modelsPath) {
    return null;
  }

  return new PiperProvider({
    modelsPath,
    defaultVoice: process.env['PIPER_DEFAULT_VOICE'] ?? 'en_US-lessac-medium',
    piperPath: process.env['PIPER_PATH'] ?? 'piper',
  });
}
