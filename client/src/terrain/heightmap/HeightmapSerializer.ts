/**
 * Heightmap Serialization
 * Binary serialization/deserialization for efficient storage and transfer
 */

import {
  HeightmapData,
  HeightmapCompact,
  HEIGHTMAP_VERSION,
  HEIGHTMAP_RESOLUTION,
} from './HeightmapData';

/** Magic number for file identification: "HGHT" */
const MAGIC_NUMBER = 0x48474854;

/** Flags for optional data */
const FLAG_HAS_NORMALS = 0x01;
const FLAG_IS_COMPRESSED = 0x02;

/**
 * Header structure (fixed size: 32 bytes)
 *
 * [4 bytes] Magic number (0x48474854)
 * [2 bytes] Version (uint16)
 * [4 bytes] cx (int32)
 * [4 bytes] cy (int32)
 * [4 bytes] seed (float32, truncated from full seed)
 * [1 byte]  resolution (uint8)
 * [4 bytes] heightScale (float32)
 * [1 byte]  biome (uint8)
 * [1 byte]  flags (uint8)
 * [4 bytes] minHeight (float32)
 * [4 bytes] maxHeight (float32)
 * [3 bytes] reserved
 */
const HEADER_SIZE = 36;

/**
 * Serialize heightmap to binary ArrayBuffer
 * Optionally includes normals
 */
export function serializeHeightmap(
  data: HeightmapData,
  includeNormals: boolean = true
): ArrayBuffer {
  const samplesCount = (data.resolution + 1) * (data.resolution + 1);
  const heightsBytes = samplesCount * 4;
  const normalsBytes = includeNormals ? samplesCount * 3 * 4 : 0;

  const totalSize = HEADER_SIZE + 4 + heightsBytes + (includeNormals ? 4 + normalsBytes : 0);
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  let offset = 0;

  // Header
  view.setUint32(offset, MAGIC_NUMBER, true); offset += 4;
  view.setUint16(offset, data.version, true); offset += 2;
  view.setInt32(offset, data.cx, true); offset += 4;
  view.setInt32(offset, data.cy, true); offset += 4;
  view.setFloat32(offset, data.seed, true); offset += 4;
  view.setUint8(offset, data.resolution); offset += 1;
  view.setFloat32(offset, data.heightScale, true); offset += 4;
  view.setUint8(offset, data.biome); offset += 1;

  // Flags
  let flags = 0;
  if (includeNormals) flags |= FLAG_HAS_NORMALS;
  view.setUint8(offset, flags); offset += 1;

  view.setFloat32(offset, data.minHeight, true); offset += 4;
  view.setFloat32(offset, data.maxHeight, true); offset += 4;

  // Reserved bytes
  offset += 3;

  // Heights data size and content
  view.setUint32(offset, heightsBytes, true); offset += 4;
  const heightsView = new Float32Array(buffer, offset, samplesCount);
  heightsView.set(data.heights);
  offset += heightsBytes;

  // Normals data if included
  if (includeNormals) {
    view.setUint32(offset, normalsBytes, true); offset += 4;
    const normalsView = new Float32Array(buffer, offset, samplesCount * 3);
    normalsView.set(data.normals);
  }

  return buffer;
}

/**
 * Serialize compact heightmap (without normals)
 */
export function serializeCompact(data: HeightmapCompact): ArrayBuffer {
  const samplesCount = (data.resolution + 1) * (data.resolution + 1);
  const heightsBytes = samplesCount * 4;

  const totalSize = HEADER_SIZE + 4 + heightsBytes;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  let offset = 0;

  // Header
  view.setUint32(offset, MAGIC_NUMBER, true); offset += 4;
  view.setUint16(offset, data.version, true); offset += 2;
  view.setInt32(offset, data.cx, true); offset += 4;
  view.setInt32(offset, data.cy, true); offset += 4;
  view.setFloat32(offset, data.seed, true); offset += 4;
  view.setUint8(offset, data.resolution); offset += 1;
  view.setFloat32(offset, data.heightScale, true); offset += 4;
  view.setUint8(offset, data.biome); offset += 1;
  view.setUint8(offset, 0); offset += 1; // flags (no normals)
  view.setFloat32(offset, data.minHeight, true); offset += 4;
  view.setFloat32(offset, data.maxHeight, true); offset += 4;
  offset += 3; // reserved

  // Heights
  view.setUint32(offset, heightsBytes, true); offset += 4;
  const heightsView = new Float32Array(buffer, offset, samplesCount);
  heightsView.set(data.heights);

  return buffer;
}

/**
 * Deserialize binary buffer to heightmap data
 * Returns null if invalid format
 */
export function deserializeHeightmap(buffer: ArrayBuffer): HeightmapData | null {
  if (buffer.byteLength < HEADER_SIZE + 4) {
    console.error('[HeightmapSerializer] Buffer too small');
    return null;
  }

  const view = new DataView(buffer);
  let offset = 0;

  // Validate magic number
  const magic = view.getUint32(offset, true); offset += 4;
  if (magic !== MAGIC_NUMBER) {
    console.error('[HeightmapSerializer] Invalid magic number');
    return null;
  }

  // Read header
  const version = view.getUint16(offset, true); offset += 2;
  const cx = view.getInt32(offset, true); offset += 4;
  const cy = view.getInt32(offset, true); offset += 4;
  const seed = view.getFloat32(offset, true); offset += 4;
  const resolution = view.getUint8(offset); offset += 1;
  const heightScale = view.getFloat32(offset, true); offset += 4;
  const biome = view.getUint8(offset); offset += 1;
  const flags = view.getUint8(offset); offset += 1;
  const minHeight = view.getFloat32(offset, true); offset += 4;
  const maxHeight = view.getFloat32(offset, true); offset += 4;
  offset += 3; // reserved

  const hasNormals = (flags & FLAG_HAS_NORMALS) !== 0;
  const samplesCount = (resolution + 1) * (resolution + 1);

  // Read heights
  const heightsSize = view.getUint32(offset, true); offset += 4;
  if (offset + heightsSize > buffer.byteLength) {
    console.error('[HeightmapSerializer] Buffer truncated at heights');
    return null;
  }
  const heights = new Float32Array(buffer.slice(offset, offset + heightsSize));
  offset += heightsSize;

  // Read normals if present
  let normals: Float32Array;
  if (hasNormals && offset + 4 <= buffer.byteLength) {
    const normalsSize = view.getUint32(offset, true); offset += 4;
    if (offset + normalsSize <= buffer.byteLength) {
      normals = new Float32Array(buffer.slice(offset, offset + normalsSize));
    } else {
      // Generate normals from heights
      normals = generateNormalsFromHeights(heights, resolution, heightScale);
    }
  } else {
    // Generate normals from heights
    normals = generateNormalsFromHeights(heights, resolution, heightScale);
  }

  return {
    version,
    cx,
    cy,
    seed,
    resolution,
    heightScale,
    biome,
    heights,
    normals,
    minHeight,
    maxHeight,
  };
}

/**
 * Deserialize to compact format (without regenerating normals)
 */
export function deserializeCompact(buffer: ArrayBuffer): HeightmapCompact | null {
  if (buffer.byteLength < HEADER_SIZE + 4) {
    return null;
  }

  const view = new DataView(buffer);
  let offset = 0;

  const magic = view.getUint32(offset, true); offset += 4;
  if (magic !== MAGIC_NUMBER) return null;

  const version = view.getUint16(offset, true); offset += 2;
  const cx = view.getInt32(offset, true); offset += 4;
  const cy = view.getInt32(offset, true); offset += 4;
  const seed = view.getFloat32(offset, true); offset += 4;
  const resolution = view.getUint8(offset); offset += 1;
  const heightScale = view.getFloat32(offset, true); offset += 4;
  const biome = view.getUint8(offset); offset += 1;
  offset += 1; // flags
  const minHeight = view.getFloat32(offset, true); offset += 4;
  const maxHeight = view.getFloat32(offset, true); offset += 4;
  offset += 3; // reserved

  const heightsSize = view.getUint32(offset, true); offset += 4;
  const heights = new Float32Array(buffer.slice(offset, offset + heightsSize));

  return {
    version,
    cx,
    cy,
    seed,
    resolution,
    heightScale,
    biome,
    heights,
    minHeight,
    maxHeight,
  };
}

/**
 * Generate normals from height data
 * Uses central differences for smooth normals
 */
export function generateNormalsFromHeights(
  heights: Float32Array,
  resolution: number,
  heightScale: number,
  chunkSize: number = 64
): Float32Array {
  const samplesPerEdge = resolution + 1;
  const step = chunkSize / resolution;
  const normals = new Float32Array(samplesPerEdge * samplesPerEdge * 3);

  for (let y = 0; y <= resolution; y++) {
    for (let x = 0; x <= resolution; x++) {
      const idx = y * samplesPerEdge + x;

      // Get neighboring heights (clamp at edges)
      const xL = Math.max(0, x - 1);
      const xR = Math.min(resolution, x + 1);
      const yD = Math.max(0, y - 1);
      const yU = Math.min(resolution, y + 1);

      const hL = heights[y * samplesPerEdge + xL];
      const hR = heights[y * samplesPerEdge + xR];
      const hD = heights[yD * samplesPerEdge + x];
      const hU = heights[yU * samplesPerEdge + x];

      // Calculate slope using central differences
      const dx = (xR - xL) * step;
      const dy = (yU - yD) * step;
      const slopeX = dx > 0 ? (hR - hL) / dx : 0;
      const slopeY = dy > 0 ? (hU - hD) / dy : 0;

      // Normal from cross product of tangent vectors
      // Tangent X: (1, 0, slopeX)
      // Tangent Y: (0, 1, slopeY)
      // Normal = Tx × Ty = (-slopeX, -slopeY, 1)
      let nx = -slopeX;
      let ny = -slopeY;
      let nz = 1;

      // Normalize
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

/**
 * Validate heightmap data integrity
 */
export function validateHeightmap(data: HeightmapData): boolean {
  const expectedSamples = (data.resolution + 1) * (data.resolution + 1);

  if (data.heights.length !== expectedSamples) {
    console.error('[HeightmapSerializer] Invalid heights array length');
    return false;
  }

  if (data.normals.length !== expectedSamples * 3) {
    console.error('[HeightmapSerializer] Invalid normals array length');
    return false;
  }

  if (data.version !== HEIGHTMAP_VERSION) {
    console.warn('[HeightmapSerializer] Version mismatch, may need migration');
  }

  return true;
}
