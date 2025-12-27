/**
 * Terrain Generation Web Worker
 * Generates heightmaps off the main thread for smooth gameplay
 */

import type {
  WorkerRequest,
  WorkerResponse,
  GenerateRequest,
  GenerateResponse,
  BatchGenerateRequest,
  BatchGenerateResponse,
  ErrorResponse,
  StatusResponse,
} from './types';

// ============================================================
// Inline noise functions (can't import modules in worker easily)
// ============================================================

// Permutation table
const PERM = new Uint8Array(512);
const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

function seedNoise(seed: number): void {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;

  let n = seed;
  for (let i = 255; i > 0; i--) {
    n = (n * 1103515245 + 12345) & 0x7fffffff;
    const j = n % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }

  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

function simplex2D(x: number, y: number): number {
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);

  const t = (i + j) * G2;
  const x0 = x - (i - t);
  const y0 = y - (j - t);

  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;

  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;

  const ii = i & 255;
  const jj = j & 255;
  const gi0 = PERM[ii + PERM[jj]] % 12;
  const gi1 = PERM[ii + i1 + PERM[jj + j1]] % 12;
  const gi2 = PERM[ii + 1 + PERM[jj + 1]] % 12;

  let n0 = 0, n1 = 0, n2 = 0;

  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 >= 0) {
    t0 *= t0;
    n0 = t0 * t0 * (GRAD3[gi0][0] * x0 + GRAD3[gi0][1] * y0);
  }

  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 >= 0) {
    t1 *= t1;
    n1 = t1 * t1 * (GRAD3[gi1][0] * x1 + GRAD3[gi1][1] * y1);
  }

  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 >= 0) {
    t2 *= t2;
    n2 = t2 * t2 * (GRAD3[gi2][0] * x2 + GRAD3[gi2][1] * y2);
  }

  return 70 * (n0 + n1 + n2);
}

function simplex2DSeeded(x: number, y: number, seed: number): number {
  const offset = seed * 0.0001;
  return simplex2D(x + offset, y + offset * 1.31);
}

function fbmSeeded(
  x: number, y: number, seed: number,
  octaves: number, lacunarity: number, persistence: number
): number {
  let value = 0;
  let frequency = 1;
  let amplitude = 1;
  let maxAmp = 0;

  for (let i = 0; i < octaves; i++) {
    value += amplitude * simplex2DSeeded(x * frequency, y * frequency, seed + i * 1000);
    maxAmp += amplitude;
    frequency *= lacunarity;
    amplitude *= persistence;
  }

  return value / maxAmp;
}

function ridgeSeeded(x: number, y: number, seed: number, offset: number = 1.0): number {
  return offset - Math.abs(simplex2DSeeded(x, y, seed));
}

function valleyNoiseSeeded(
  x: number, y: number, seed: number,
  octaves: number, lacunarity: number, gain: number, offset: number
): number {
  let frequency = 1;
  let amplitude = 1;
  let value = 0;
  let weight = 1;

  for (let i = 0; i < octaves; i++) {
    let signal = ridgeSeeded(x * frequency, y * frequency, seed + i * 1000, offset);
    signal *= signal;
    signal *= weight;
    weight = Math.min(1, Math.max(0, signal * gain));
    value += signal * amplitude;
    frequency *= lacunarity;
    amplitude *= 0.5;
  }

  return 1 - Math.min(1, Math.max(0, value * 0.5));
}

function warpCoordinates(
  x: number, y: number, seed: number,
  amplitude: number, frequency: number
): { x: number; y: number } {
  const offsetX = simplex2DSeeded(x * frequency, y * frequency, seed) * amplitude;
  const offsetY = simplex2DSeeded(x * frequency + 5.2, y * frequency + 1.3, seed + 100) * amplitude;
  return { x: x + offsetX, y: y + offsetY };
}

// ============================================================
// Terrain Generation
// ============================================================

interface TerrainStyle {
  hillFrequency: number;
  hillWeight: number;
  mediumFrequency: number;
  mediumWeight: number;
  detailFrequency: number;
  detailWeight: number;
  valleyFrequency: number;
  valleyWeight: number;
  waveFrequency: number;
  waveWeight: number;
  warpAmplitude: number;
  warpFrequency: number;
}

const ROLLING_HILLS: TerrainStyle = {
  hillFrequency: 0.015,
  hillWeight: 0.55,
  mediumFrequency: 0.04,
  mediumWeight: 0.25,
  detailFrequency: 0.12,
  detailWeight: 0.1,
  valleyFrequency: 0.02,
  valleyWeight: 0.15,
  waveFrequency: 0.008,
  waveWeight: 0.05,
  warpAmplitude: 15.0,
  warpFrequency: 0.008,
};

function getStyleForBiome(biome: number): TerrainStyle {
  // All biomes use rolling hills for now, can customize later
  return ROLLING_HILLS;
}

function generateHeightAt(
  worldX: number,
  worldY: number,
  globalSeed: number,
  heightScale: number,
  style: TerrainStyle
): number {
  const warped = warpCoordinates(worldX, worldY, globalSeed, style.warpAmplitude, style.warpFrequency);
  const wx = warped.x;
  const wy = warped.y;

  const hills = fbmSeeded(wx * style.hillFrequency, wy * style.hillFrequency, globalSeed, 4, 2.0, 0.5);
  const medium = fbmSeeded(wx * style.mediumFrequency, wy * style.mediumFrequency, globalSeed + 100, 3, 2.0, 0.5);
  const detail = fbmSeeded(wx * style.detailFrequency, wy * style.detailFrequency, globalSeed + 200, 2, 2.0, 0.5);
  const valleys = valleyNoiseSeeded(worldX * style.valleyFrequency, worldY * style.valleyFrequency, globalSeed + 300, 3, 2.2, 1.8, 1.0);
  const wave = Math.sin(worldX * style.waveFrequency * Math.PI * 2) * Math.cos(worldY * style.waveFrequency * Math.PI * 2);

  const combined =
    hills * style.hillWeight +
    medium * style.mediumWeight +
    detail * style.detailWeight -
    valleys * style.valleyWeight +
    wave * style.waveWeight;

  const normalized = (combined + 1) * 0.5;
  return Math.max(0, normalized * heightScale);
}

function generateNormals(
  heights: Float32Array,
  resolution: number,
  chunkSize: number
): Float32Array {
  const samplesPerEdge = resolution + 1;
  const step = chunkSize / resolution;
  const normals = new Float32Array(samplesPerEdge * samplesPerEdge * 3);

  for (let y = 0; y <= resolution; y++) {
    for (let x = 0; x <= resolution; x++) {
      const idx = y * samplesPerEdge + x;

      const xL = Math.max(0, x - 1);
      const xR = Math.min(resolution, x + 1);
      const yD = Math.max(0, y - 1);
      const yU = Math.min(resolution, y + 1);

      const hL = heights[y * samplesPerEdge + xL];
      const hR = heights[y * samplesPerEdge + xR];
      const hD = heights[yD * samplesPerEdge + x];
      const hU = heights[yU * samplesPerEdge + x];

      const dx = (xR - xL) * step;
      const dy = (yU - yD) * step;
      const slopeX = dx > 0 ? (hR - hL) / dx : 0;
      const slopeY = dy > 0 ? (hU - hD) / dy : 0;

      let nx = -slopeX;
      let ny = -slopeY;
      let nz = 1;

      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 0) {
        nx /= len;
        ny /= len;
        nz /= len;
      }

      normals[idx * 3] = nx;
      normals[idx * 3 + 1] = ny;
      normals[idx * 3 + 2] = nz;
    }
  }

  return normals;
}

function processGenerateRequest(request: GenerateRequest): GenerateResponse {
  const startTime = performance.now();

  const { cx, cy, biome, resolution, heightScale, globalSeed, includeNormals } = request;
  const chunkSize = 64;
  const style = getStyleForBiome(biome);

  seedNoise(globalSeed);

  const samplesPerEdge = resolution + 1;
  const heights = new Float32Array(samplesPerEdge * samplesPerEdge);

  const step = chunkSize / resolution;
  const worldOffsetX = cx * chunkSize;
  const worldOffsetY = cy * chunkSize;

  let minHeight = Infinity;
  let maxHeight = -Infinity;

  for (let y = 0; y <= resolution; y++) {
    for (let x = 0; x <= resolution; x++) {
      const worldX = worldOffsetX + x * step;
      const worldY = worldOffsetY + y * step;
      const height = generateHeightAt(worldX, worldY, globalSeed, heightScale, style);

      heights[y * samplesPerEdge + x] = height;
      if (height < minHeight) minHeight = height;
      if (height > maxHeight) maxHeight = height;
    }
  }

  const normals = includeNormals ? generateNormals(heights, resolution, chunkSize) : undefined;

  return {
    type: 'generate_complete',
    id: request.id,
    cx,
    cy,
    heights,
    normals,
    minHeight,
    maxHeight,
    generationTimeMs: performance.now() - startTime,
  };
}

function processBatchRequest(request: BatchGenerateRequest): BatchGenerateResponse {
  const startTime = performance.now();
  const { chunks, resolution, heightScale, globalSeed, includeNormals } = request;

  seedNoise(globalSeed);

  const results = chunks.map((chunk) => {
    const genRequest: GenerateRequest = {
      type: 'generate',
      id: 0,
      cx: chunk.cx,
      cy: chunk.cy,
      seed: chunk.seed,
      biome: chunk.biome,
      resolution,
      heightScale,
      globalSeed,
      includeNormals,
    };

    const result = processGenerateRequest(genRequest);
    return {
      cx: result.cx,
      cy: result.cy,
      heights: result.heights,
      normals: result.normals,
      minHeight: result.minHeight,
      maxHeight: result.maxHeight,
    };
  });

  return {
    type: 'batch_complete',
    id: request.id,
    results,
    totalTimeMs: performance.now() - startTime,
  };
}

// ============================================================
// Message Handler
// ============================================================

let pendingCount = 0;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case 'generate': {
        pendingCount++;
        const response = processGenerateRequest(request);
        const transfer: Transferable[] = [response.heights.buffer];
        if (response.normals) transfer.push(response.normals.buffer);
        self.postMessage(response, { transfer });
        pendingCount--;
        break;
      }

      case 'batch_generate': {
        pendingCount++;
        const response = processBatchRequest(request);
        const transfer: Transferable[] = [];
        for (const result of response.results) {
          transfer.push(result.heights.buffer);
          if (result.normals) transfer.push(result.normals.buffer);
        }
        self.postMessage(response, { transfer });
        pendingCount--;
        break;
      }

      case 'status': {
        const statusResponse: StatusResponse = {
          type: 'status_response',
          pendingCount,
          busy: pendingCount > 0,
        };
        self.postMessage(statusResponse);
        break;
      }

      case 'cancel':
        // Cancellation not implemented for sync operations
        break;
    }
  } catch (error) {
    const errorResponse: ErrorResponse = {
      type: 'error',
      id: 'id' in request ? request.id : -1,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(errorResponse);
    pendingCount = Math.max(0, pendingCount - 1);
  }
};

// Signal ready
self.postMessage({ type: 'ready' });
