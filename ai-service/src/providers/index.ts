/**
 * Provider Abstraction Layer
 *
 * Exports all provider types, interfaces, and implementations.
 * This is the main entry point for using the provider system.
 */

// Core types and interfaces
export * from './types.js';

// Provider registry
export { ProviderRegistry, createDefaultProviderConfig } from './registry.js';
export type { LLMTask, ProviderStatus } from './registry.js';

// LLM Providers
export { OpenAIProvider, createOpenAIProvider } from './llm/openai.js';
export { OllamaProvider, createOllamaProvider } from './llm/ollama.js';

// Image Providers
export { FalProvider, createFalProvider } from './image/fal.js';
export { ComfyUIProvider, createComfyUIProvider } from './image/comfyui.js';

// TTS Providers
export { ElevenLabsProvider, createElevenLabsProvider } from './tts/elevenlabs.js';
export { PiperProvider, createPiperProvider } from './tts/piper.js';

// Factory function to create a fully configured registry
import { ProviderRegistry, createDefaultProviderConfig } from './registry.js';
import { createOpenAIProvider } from './llm/openai.js';
import { createOllamaProvider } from './llm/ollama.js';
import { createFalProvider } from './image/fal.js';
import { createComfyUIProvider } from './image/comfyui.js';
import { createElevenLabsProvider } from './tts/elevenlabs.js';
import { createPiperProvider } from './tts/piper.js';

/**
 * Create a provider registry with all available providers registered.
 * Providers are registered based on environment configuration.
 */
export async function createProviderRegistry(): Promise<ProviderRegistry> {
  const config = createDefaultProviderConfig();
  const registry = new ProviderRegistry(config);

  // Register LLM providers
  const ollamaProvider = createOllamaProvider();
  if (ollamaProvider) {
    registry.registerLLMProvider(ollamaProvider);
  }

  // Register OpenAI with different model configurations
  if (config.llm.openai?.apiKey) {
    // Dialogue model (fast)
    const dialogueProvider = createOpenAIProvider(config.llm.models.dialogue);
    if (dialogueProvider) {
      registry.registerLLMProvider(dialogueProvider);
    }
  }

  // Register Image providers
  const comfyProvider = createComfyUIProvider();
  if (comfyProvider) {
    registry.registerImageProvider(comfyProvider);
  }

  const falProvider = createFalProvider();
  if (falProvider) {
    registry.registerImageProvider(falProvider);
  }

  // Register TTS providers
  const piperProvider = createPiperProvider();
  if (piperProvider) {
    registry.registerTTSProvider(piperProvider);
  }

  const elevenLabsProvider = createElevenLabsProvider();
  if (elevenLabsProvider) {
    registry.registerTTSProvider(elevenLabsProvider);
  }

  await registry.initialize();
  return registry;
}
