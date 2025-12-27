/**
 * Audio utility modules for procedural audio generation
 * Provides mathematical and musical utilities for the Frugworld audio system
 */

// Scale and harmony utilities
export {
  // Scale definitions
  SCALES,
  NOTE_NAMES,
  type ScaleType,
  type NoteName,
  // MIDI/Frequency conversion
  midiToFreq,
  freqToMidi,
  // Scale quantization
  quantizeToScale,
  // Affinity mapping
  affinityToInterval,
  // Note lookup
  getNoteInScale,
  noteToMidi,
  midiToNote,
  getScaleNotes,
} from './scales.ts';

// Mathematical utilities for audio
export {
  // Interpolation
  lerp,
  inverseLerp,
  // Clamping and range
  clamp,
  mapRange,
  mapRangeClamped,
  // Decibel conversion
  dbToGain,
  gainToDb,
  // Smoothing
  smoothstep,
  smootherstep,
  // Random functions
  randomInRange,
  randomIntInRange,
  randomGaussian,
  // Audio-specific math
  exponentialDecay,
  adsrEnvelope,
  bpmToMs,
  msToBpm,
  semitonesToRatio,
  ratioToSemitones,
} from './AudioMath.ts';
