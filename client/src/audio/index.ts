/**
 * Audio module exports
 *
 * This module provides both legacy MIDI-based music and a new generative
 * procedural audio system that sonifies the social simulation in real-time.
 */

// Core audio services
export { MicCapture, type MicCaptureConfig } from './MicCapture.ts';
export { AudioPlayer, type AudioPlayerConfig } from './AudioPlayer.ts';
export { VoiceChatService, type VoiceChatConfig } from './VoiceChatService.ts';
export { MidiMusicPlayer, type MidiPlayerConfig } from './MidiPlayer.ts';

// Legacy audio wrapper (MIDI-based music)
export { LegacyAudio } from './LegacyAudio.ts';

// Generative audio engine
export {
  AudioEngine,
  type AudioEngineConfig,
  type GraphState,
  type PhysicsState,
  type RelationshipEvent,
  type NPCState,
} from './AudioEngine.ts';

// Music manager (orchestrates legacy and generative systems)
export {
  MusicManager,
  musicManager,
  type MusicMode,
  type MusicManagerConfig,
} from './MusicManager.ts';

// Instruments for procedural audio
export * from './instruments/index.ts';

// Music generators
export * from './generators/index.ts';

// Data-to-music mappings
export * from './mappings/index.ts';

// Audio utilities
export * from './utils/index.ts';

// UI components
export * from './ui/index.ts';

// SpacetimeDB integration
export {
  AudioIntegration,
  audioIntegration,
  setupAudioIntegration,
  type AudioIntegrationConfig,
  RelationshipType,
  LODState,
  LifeStage,
} from './AudioIntegration.ts';
