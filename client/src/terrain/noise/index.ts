/**
 * Noise Module
 * Provides various noise algorithms for terrain generation
 */

// Simplex Noise
export {
  seedSimplex,
  simplex2D,
  simplex2DSeeded,
  simplex2DNormalized,
} from './SimplexNoise';

// Fractal Brownian Motion
export {
  fbm,
  fbmSeeded,
  fbmNormalized,
  fbmSeededNormalized,
  turbulence,
  billowed,
  DEFAULT_FBM_CONFIG,
  type FBMConfig,
} from './FBM';

// Ridged Multi-Fractal
export {
  ridge,
  ridgedMultiFractal,
  ridgedMultiFractalSeeded,
  swissNoise,
  valleyNoise,
  valleyNoiseSeeded,
  DEFAULT_RIDGED_CONFIG,
  type RidgedConfig,
} from './RidgedNoise';

// Domain Warping
export {
  warpCoordinates,
  warpCoordinatesSeeded,
  multiWarp,
  fbmWarp,
  fbmWarpSeeded,
  warpedNoise,
  warpedFBM,
  warpedFBMSeeded,
  DEFAULT_WARP_CONFIG,
  type WarpConfig,
} from './DomainWarping';
