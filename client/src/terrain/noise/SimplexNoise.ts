/**
 * Simplex Noise Implementation
 * Based on Stefan Gustavson's simplex noise algorithm
 * Provides smooth, isotropic noise ideal for terrain generation
 */

// Permutation table for hashing
const PERM = new Uint8Array(512);
const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

// Skewing factors for 2D simplex
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

/**
 * Initialize the permutation table with a seed
 */
export function seedSimplex(seed: number): void {
  const p = new Uint8Array(256);

  // Fill with values 0-255
  for (let i = 0; i < 256; i++) {
    p[i] = i;
  }

  // Shuffle using seed
  let n = seed;
  for (let i = 255; i > 0; i--) {
    // Simple LCG for reproducible shuffle
    n = (n * 1103515245 + 12345) & 0x7fffffff;
    const j = n % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }

  // Duplicate for wrapping
  for (let i = 0; i < 512; i++) {
    PERM[i] = p[i & 255];
  }
}

// Initialize with default seed
seedSimplex(42);

/**
 * Fast floor function
 */
function fastFloor(x: number): number {
  return x > 0 ? (x | 0) : ((x | 0) - 1);
}

/**
 * Dot product of gradient and distance vector
 */
function dot2(g: number[], x: number, y: number): number {
  return g[0] * x + g[1] * y;
}

/**
 * 2D Simplex noise
 * Returns value in range [-1, 1]
 */
export function simplex2D(x: number, y: number): number {
  // Skew input space to determine simplex cell
  const s = (x + y) * F2;
  const i = fastFloor(x + s);
  const j = fastFloor(y + s);

  // Unskew back to (x,y) space
  const t = (i + j) * G2;
  const X0 = i - t;
  const Y0 = j - t;

  // Distance from cell origin
  const x0 = x - X0;
  const y0 = y - Y0;

  // Determine which simplex we're in
  let i1: number, j1: number;
  if (x0 > y0) {
    i1 = 1; j1 = 0; // Lower triangle
  } else {
    i1 = 0; j1 = 1; // Upper triangle
  }

  // Offsets for corners
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;

  // Hash coordinates for gradient indices
  const ii = i & 255;
  const jj = j & 255;
  const gi0 = PERM[ii + PERM[jj]] % 12;
  const gi1 = PERM[ii + i1 + PERM[jj + j1]] % 12;
  const gi2 = PERM[ii + 1 + PERM[jj + 1]] % 12;

  // Calculate contributions from corners
  let n0 = 0, n1 = 0, n2 = 0;

  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 >= 0) {
    t0 *= t0;
    n0 = t0 * t0 * dot2(GRAD3[gi0], x0, y0);
  }

  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 >= 0) {
    t1 *= t1;
    n1 = t1 * t1 * dot2(GRAD3[gi1], x1, y1);
  }

  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 >= 0) {
    t2 *= t2;
    n2 = t2 * t2 * dot2(GRAD3[gi2], x2, y2);
  }

  // Scale to [-1, 1]
  return 70 * (n0 + n1 + n2);
}

/**
 * 2D Simplex noise with seed offset
 * Allows different noise patterns with different seeds
 */
export function simplex2DSeeded(x: number, y: number, seed: number): number {
  // Offset coordinates by seed for variation
  const seedOffset = seed * 0.0001;
  return simplex2D(x + seedOffset, y + seedOffset * 1.31);
}

/**
 * Normalized simplex noise [0, 1]
 */
export function simplex2DNormalized(x: number, y: number): number {
  return (simplex2D(x, y) + 1) * 0.5;
}
