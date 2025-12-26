/**
 * SpacetimeDB Adapter - Type bridge between SpacetimeDB table rows and client protocol types
 *
 * This adapter provides conversion functions to transform SpacetimeDB generated table row types
 * into the existing protocol types used by the client (EntityManager, ChunkRenderer, etc.).
 *
 * The SpacetimeDB SDK uses bigint (u64) for entity IDs and timestamps, while the client
 * protocol uses number types for compatibility with existing rendering/game logic.
 */

import type { Infer } from 'spacetimedb';

// Import SpacetimeDB row type schemas
import EntityRowSchema from '../module_bindings/entity_table';
import TransformRowSchema from '../module_bindings/transform_table';
import ChunkRowSchema from '../module_bindings/chunk_table';
import NpcStateRowSchema from '../module_bindings/npc_state_table';
import NpcBlueprintRowSchema from '../module_bindings/npc_blueprint_table';

// Import client protocol types
import type {
  EntityData,
  TransformData,
  ChunkData,
  QuantizedTransform,
  EntityKind,
  LODTier,
  ServerMessageType,
} from '../types/protocol';

// ============================================================================
// Inferred SpacetimeDB Row Types
// ============================================================================

/** SpacetimeDB Entity table row type */
export type EntityRow = Infer<typeof EntityRowSchema>;

/** SpacetimeDB Transform table row type */
export type TransformRow = Infer<typeof TransformRowSchema>;

/** SpacetimeDB Chunk table row type */
export type ChunkRow = Infer<typeof ChunkRowSchema>;

/** SpacetimeDB NpcState table row type */
export type NpcStateRow = Infer<typeof NpcStateRowSchema>;

/** SpacetimeDB NpcBlueprint table row type */
export type NpcBlueprintRow = Infer<typeof NpcBlueprintRowSchema>;

// ============================================================================
// NPC Data Types (extended protocol types for NPC state)
// ============================================================================

/**
 * Decoded NPC needs from the binary blob
 */
export interface NpcNeeds {
  hunger: number;
  energy: number;
  social: number;
  safety: number;
  purpose: number;
}

/**
 * NPC AI state data for client rendering/logic
 */
export interface NpcData {
  npcId: number;
  entityId: number;
  lodState: LODTier;
  longGoal: string | null;
  midGoal: string | null;
  shortIntent: string | null;
  needs: NpcNeeds | null;
  memorySummary: string | null;
  lastReplanTsMs: number;
}

/**
 * NPC blueprint data containing personality and background
 */
export interface NpcBlueprintData {
  npcId: number;
  blueprint: NpcBlueprint | null;
  version: number;
  createdTsMs: number;
}

/**
 * Decoded NPC blueprint JSON structure
 */
export interface NpcBlueprint {
  name: string;
  archetype?: string;
  personality?: string;
  backstory?: string;
  traits?: string[];
  occupation?: string;
  greeting?: string;
  [key: string]: unknown;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Safely converts a bigint to number.
 * Throws if the value exceeds Number.MAX_SAFE_INTEGER.
 *
 * @param value - The bigint value to convert
 * @param fieldName - Field name for error messages
 * @returns The number representation
 */
export function bigintToNumber(value: bigint, fieldName?: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    const field = fieldName ? ` for ${fieldName}` : '';
    console.warn(
      `BigInt value${field} exceeds MAX_SAFE_INTEGER: ${value}. Precision may be lost.`
    );
  }
  return Number(value);
}

/**
 * Decodes a UTF-8 byte array to string.
 * Returns null if the array is empty or decoding fails.
 *
 * @param bytes - The byte array to decode
 * @returns The decoded string or null
 */
export function decodeUtf8Bytes(bytes: Uint8Array | null | undefined): string | null {
  if (!bytes || bytes.length === 0) {
    return null;
  }
  try {
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    console.warn('Failed to decode UTF-8 bytes');
    return null;
  }
}

/**
 * Parses JSON from a byte array.
 * Returns null if parsing fails.
 *
 * @param bytes - The byte array containing JSON
 * @returns The parsed object or null
 */
export function parseJsonBytes<T>(bytes: Uint8Array | null | undefined): T | null {
  const str = decodeUtf8Bytes(bytes);
  if (!str) {
    return null;
  }
  try {
    return JSON.parse(str) as T;
  } catch {
    console.warn('Failed to parse JSON from bytes');
    return null;
  }
}

// ============================================================================
// Entity Conversion Functions
// ============================================================================

/**
 * Converts a SpacetimeDB Entity row to the client EntityData type.
 *
 * @param row - The SpacetimeDB Entity table row
 * @returns The converted EntityData for client use
 *
 * @example
 * ```typescript
 * const entityRow = db.getTable('Entity').find(entityId);
 * const entityData = entityRowToEntityData(entityRow);
 * entityManager.spawnEntity(entityData);
 * ```
 */
export function entityRowToEntityData(row: EntityRow): EntityData {
  return {
    entityId: bigintToNumber(row.entityId, 'entityId'),
    kind: row.kind as EntityKind,
    archetypeId: row.archetypeId,
    zoneId: bigintToNumber(row.zoneId, 'zoneId'),
    chunkX: row.chunkX,
    chunkY: row.chunkY,
    alive: row.alive,
  };
}

/**
 * Batch converts multiple Entity rows to EntityData array.
 *
 * @param rows - Array of SpacetimeDB Entity table rows
 * @returns Array of converted EntityData
 */
export function entityRowsToEntityData(rows: EntityRow[]): EntityData[] {
  return rows.map(entityRowToEntityData);
}

// ============================================================================
// Transform Conversion Functions
// ============================================================================

/**
 * Converts a SpacetimeDB Transform row to the client TransformData type.
 *
 * @param row - The SpacetimeDB Transform table row
 * @returns The converted TransformData for client use
 *
 * @example
 * ```typescript
 * const transformRow = db.getTable('Transform').find(entityId);
 * const transformData = transformRowToTransformData(transformRow);
 * entityManager.updateTransform(transformData);
 * ```
 */
export function transformRowToTransformData(row: TransformRow): TransformData {
  const transform: QuantizedTransform = {
    x: row.x,
    y: row.y,
    z: row.z,
    yaw: row.yaw,
    vx: row.vx,
    vy: row.vy,
    vz: row.vz,
  };

  return {
    entityId: bigintToNumber(row.entityId, 'entityId'),
    transform,
    lastTick: bigintToNumber(row.lastTick, 'lastTick'),
  };
}

/**
 * Batch converts multiple Transform rows to TransformData array.
 *
 * @param rows - Array of SpacetimeDB Transform table rows
 * @returns Array of converted TransformData
 */
export function transformRowsToTransformData(rows: TransformRow[]): TransformData[] {
  return rows.map(transformRowToTransformData);
}

/**
 * Extracts just the QuantizedTransform from a Transform row.
 * Useful when you only need the position/velocity data.
 *
 * @param row - The SpacetimeDB Transform table row
 * @returns The QuantizedTransform
 */
export function transformRowToQuantizedTransform(row: TransformRow): QuantizedTransform {
  return {
    x: row.x,
    y: row.y,
    z: row.z,
    yaw: row.yaw,
    vx: row.vx,
    vy: row.vy,
    vz: row.vz,
  };
}

// ============================================================================
// Chunk Conversion Functions
// ============================================================================

/**
 * Converts a SpacetimeDB Chunk row to the client ChunkData type.
 *
 * Note: The ChunkData type includes a `type` discriminator field for message routing.
 * The `deltaBlob` field is not present in the SpacetimeDB row and will be undefined.
 *
 * @param row - The SpacetimeDB Chunk table row
 * @returns The converted ChunkData for client use
 *
 * @example
 * ```typescript
 * const chunkRow = db.getTable('Chunk').find(chunkId);
 * const chunkData = chunkRowToChunkData(chunkRow);
 * chunkRenderer.loadChunk(chunkData);
 * ```
 */
export function chunkRowToChunkData(row: ChunkRow): ChunkData {
  const result: ChunkData = {
    type: 'chunk_data' as ServerMessageType.ChunkData,
    cx: row.cx,
    cy: row.cy,
    seed: bigintToNumber(row.seed, 'seed'),
    biome: row.biome,
  };

  // Only set optional properties if they have values
  // (exactOptionalPropertyTypes requires this pattern)
  if (row.poiBlob && row.poiBlob.length > 0) {
    result.poiBlob = row.poiBlob;
  }

  return result;
}

/**
 * Batch converts multiple Chunk rows to ChunkData array.
 *
 * @param rows - Array of SpacetimeDB Chunk table rows
 * @returns Array of converted ChunkData
 */
export function chunkRowsToChunkData(rows: ChunkRow[]): ChunkData[] {
  return rows.map(chunkRowToChunkData);
}

/**
 * Creates a chunk key string for use in Maps/Sets.
 *
 * @param cx - Chunk X coordinate
 * @param cy - Chunk Y coordinate
 * @returns A unique string key for the chunk
 */
export function makeChunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/**
 * Parses a chunk key string back to coordinates.
 *
 * @param key - The chunk key string
 * @returns The chunk coordinates or null if invalid
 */
export function parseChunkKey(key: string): { cx: number; cy: number } | null {
  const parts = key.split(',');
  const part0 = parts[0];
  const part1 = parts[1];
  if (parts.length !== 2 || part0 === undefined || part1 === undefined) {
    return null;
  }
  const cx = parseInt(part0, 10);
  const cy = parseInt(part1, 10);
  if (isNaN(cx) || isNaN(cy)) {
    return null;
  }
  return { cx, cy };
}

// ============================================================================
// NPC State Conversion Functions
// ============================================================================

/**
 * Decodes NPC needs from the binary blob.
 *
 * @param bytes - The needs byte array
 * @returns Decoded NpcNeeds or null
 */
export function decodeNpcNeeds(bytes: Uint8Array | null | undefined): NpcNeeds | null {
  return parseJsonBytes<NpcNeeds>(bytes);
}

/**
 * Converts a SpacetimeDB NpcState row to the client NpcData type.
 *
 * This decodes the JSON blobs for goals, intent, needs, and memory summary.
 *
 * @param row - The SpacetimeDB NpcState table row
 * @param entityId - Optional entity ID if known (not in NpcState row)
 * @returns The converted NpcData for client use
 *
 * @example
 * ```typescript
 * const npcStateRow = db.getTable('NpcState').find(npcId);
 * const npcData = npcStateRowToNpcData(npcStateRow);
 * npcManager.updateNpcState(npcData);
 * ```
 */
export function npcStateRowToNpcData(row: NpcStateRow, entityId?: number): NpcData {
  const npcId = bigintToNumber(row.npcId, 'npcId');

  return {
    npcId,
    entityId: entityId ?? npcId, // NPC ID often equals entity ID, but caller can override
    lodState: row.lodState as LODTier,
    longGoal: decodeUtf8Bytes(row.longGoal),
    midGoal: decodeUtf8Bytes(row.midGoal),
    shortIntent: decodeUtf8Bytes(row.shortIntent),
    needs: decodeNpcNeeds(row.needs),
    memorySummary: decodeUtf8Bytes(row.memorySummary),
    lastReplanTsMs: bigintToNumber(row.lastReplanTsMs, 'lastReplanTsMs'),
  };
}

/**
 * Batch converts multiple NpcState rows to NpcData array.
 *
 * @param rows - Array of SpacetimeDB NpcState table rows
 * @returns Array of converted NpcData
 */
export function npcStateRowsToNpcData(rows: NpcStateRow[]): NpcData[] {
  return rows.map((row) => npcStateRowToNpcData(row));
}

// ============================================================================
// NPC Blueprint Conversion Functions
// ============================================================================

/**
 * Converts a SpacetimeDB NpcBlueprint row to the client NpcBlueprintData type.
 *
 * @param row - The SpacetimeDB NpcBlueprint table row
 * @returns The converted NpcBlueprintData for client use
 *
 * @example
 * ```typescript
 * const blueprintRow = db.getTable('NpcBlueprint').find(npcId);
 * const blueprintData = npcBlueprintRowToNpcBlueprintData(blueprintRow);
 * dialogueSystem.setNpcBlueprint(blueprintData);
 * ```
 */
export function npcBlueprintRowToNpcBlueprintData(row: NpcBlueprintRow): NpcBlueprintData {
  return {
    npcId: bigintToNumber(row.npcId, 'npcId'),
    blueprint: parseJsonBytes<NpcBlueprint>(row.blueprintJson),
    version: row.version,
    createdTsMs: bigintToNumber(row.createdTsMs, 'createdTsMs'),
  };
}

/**
 * Batch converts multiple NpcBlueprint rows to NpcBlueprintData array.
 *
 * @param rows - Array of SpacetimeDB NpcBlueprint table rows
 * @returns Array of converted NpcBlueprintData
 */
export function npcBlueprintRowsToNpcBlueprintData(rows: NpcBlueprintRow[]): NpcBlueprintData[] {
  return rows.map(npcBlueprintRowToNpcBlueprintData);
}

// ============================================================================
// Combined Entity + Transform Helpers
// ============================================================================

/**
 * Represents a complete entity with both entity data and transform.
 */
export interface EntityWithTransform {
  entity: EntityData;
  transform: TransformData | null;
}

/**
 * Combines an Entity row and optional Transform row into a complete entity representation.
 *
 * @param entityRow - The SpacetimeDB Entity table row
 * @param transformRow - The optional SpacetimeDB Transform table row
 * @returns Combined entity with transform
 */
export function combineEntityAndTransform(
  entityRow: EntityRow,
  transformRow?: TransformRow | null
): EntityWithTransform {
  return {
    entity: entityRowToEntityData(entityRow),
    transform: transformRow ? transformRowToTransformData(transformRow) : null,
  };
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a value is a valid EntityRow.
 */
export function isEntityRow(value: unknown): value is EntityRow {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.entityId === 'bigint' &&
    typeof obj.kind === 'number' &&
    typeof obj.archetypeId === 'number' &&
    typeof obj.zoneId === 'bigint' &&
    typeof obj.chunkX === 'number' &&
    typeof obj.chunkY === 'number' &&
    typeof obj.alive === 'boolean'
  );
}

/**
 * Type guard to check if a value is a valid TransformRow.
 */
export function isTransformRow(value: unknown): value is TransformRow {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.entityId === 'bigint' &&
    typeof obj.x === 'number' &&
    typeof obj.y === 'number' &&
    typeof obj.z === 'number' &&
    typeof obj.yaw === 'number' &&
    typeof obj.lastTick === 'bigint'
  );
}

/**
 * Type guard to check if a value is a valid ChunkRow.
 */
export function isChunkRow(value: unknown): value is ChunkRow {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.chunkId === 'bigint' &&
    typeof obj.cx === 'number' &&
    typeof obj.cy === 'number' &&
    typeof obj.zoneId === 'bigint' &&
    typeof obj.seed === 'bigint' &&
    typeof obj.biome === 'number'
  );
}

/**
 * Type guard to check if a value is a valid NpcStateRow.
 */
export function isNpcStateRow(value: unknown): value is NpcStateRow {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.npcId === 'bigint' &&
    typeof obj.lodState === 'number' &&
    typeof obj.lastReplanTsMs === 'bigint'
  );
}

// ============================================================================
// Reverse Conversions (Client -> SpacetimeDB format)
// These are useful for preparing data to send to reducers
// ============================================================================

/**
 * Converts an entity ID from number to bigint for SpacetimeDB calls.
 */
export function numberToBigint(value: number): bigint {
  return BigInt(value);
}

/**
 * Encodes a string to UTF-8 bytes.
 */
export function encodeUtf8String(str: string | null | undefined): Uint8Array {
  if (!str) {
    return new Uint8Array(0);
  }
  return new TextEncoder().encode(str);
}

/**
 * Encodes an object to JSON bytes.
 */
export function encodeJsonToBytes<T>(obj: T | null | undefined): Uint8Array {
  if (obj === null || obj === undefined) {
    return new Uint8Array(0);
  }
  try {
    const json = JSON.stringify(obj);
    return encodeUtf8String(json);
  } catch {
    console.warn('Failed to encode object to JSON bytes');
    return new Uint8Array(0);
  }
}
