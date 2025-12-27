/**
 * Data-to-Music Mappings for Frugworld Procedural Audio System
 *
 * This module exports all mapping functions that translate game data
 * (personalities, relationships, graph state) into musical parameters.
 *
 * The mappings are organized into three categories:
 * 1. PersonalityToMusic - Individual NPC traits to musical character
 * 2. RelationshipToMusic - Social connections to harmonic relationships
 * 3. GraphStateToMusic - World state to ambient soundscape
 */

// ============================================================================
// Personality Mappings
// ============================================================================

export {
  extraversionToVolume,
  extraversionToOctave,
  extraversionToDensity,
  agreeablenessToMode,
  agreeablenessToHarmonics,
  lifeStageToOctave,
  lifeStageToRhythmMultiplier,
} from './PersonalityToMusic';

// ============================================================================
// Relationship Mappings
// ============================================================================

export {
  affinityToConsonance,
  trustToReverb,
  interactionCountToDensity,
  relationshipTypeToInstrument,
  relationshipTypeToPan,
} from './RelationshipToMusic';

// ============================================================================
// Graph State Mappings
// ============================================================================

export {
  velocityToTempo,
  agreeablenessToKey,
  timeOfDayToKeyShift,
  energyToVolume,
  energyToBrightness,
  tensionToFilterCutoff,
  clusteringToChordDensity,
  diameterToPitchBend,
} from './GraphStateToMusic';
