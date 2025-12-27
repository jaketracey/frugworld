/**
 * Music Generator Classes for Frugworld Procedural Audio System
 *
 * This module exports generators for creating procedural music elements:
 * - MelodyGenerator: Creates melodic phrases from NPC state and personality
 * - HarmonyEngine: Generates chord progressions and harmonic content
 * - RhythmGenerator: Creates rhythmic patterns based on simulation state
 */

// ============================================================================
// Generator Classes
// ============================================================================

export { MelodyGenerator } from './MelodyGenerator';
export { HarmonyEngine } from './HarmonyEngine';
export { RhythmGenerator } from './RhythmGenerator';

// ============================================================================
// Types
// ============================================================================

// MelodyGenerator types
export type {
  NoteEvent,
  ContourType,
  MelodyConfig,
} from './MelodyGenerator';
export type { LifeStage as MelodyLifeStage } from './MelodyGenerator';

// HarmonyEngine types
export type {
  Mood,
  ChordQuality,
  HarmonyConfig,
} from './HarmonyEngine';

// RhythmGenerator types
export type {
  TimeNotation,
  RhythmEvent,
  RhythmConfig,
} from './RhythmGenerator';
export type { LifeStage as RhythmLifeStage } from './RhythmGenerator';
