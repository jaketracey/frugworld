/**
 * Network module exports
 */

export { ConnectionManager, ConnectionState } from './ConnectionManager.ts';
export type { ConnectionConfig, ConnectionEvents } from './ConnectionManager.ts';

// SpacetimeDB SDK connection (preferred)
export { SpacetimeDBConnection } from './SpacetimeDBConnection.ts';
export type { SpacetimeDBConfig, SpacetimeDBEvents } from './SpacetimeDBConnection.ts';
export { ConnectionState as SpacetimeDBConnectionState } from './SpacetimeDBConnection.ts';

export { InputBuffer } from './InputBuffer.ts';
export type { BufferedInput, PredictedState } from './InputBuffer.ts';

export {
  serializeClientMessage,
  deserializeServerMessage,
  encodeBase64,
  decodeBase64,
} from './serialization.ts';

// SpacetimeDB type adapters
export {
  // Conversion functions
  entityRowToEntityData,
  entityRowsToEntityData,
  transformRowToTransformData,
  transformRowsToTransformData,
  transformRowToQuantizedTransform,
  chunkRowToChunkData,
  chunkRowsToChunkData,
  npcStateRowToNpcData,
  npcStateRowsToNpcData,
  npcBlueprintRowToNpcBlueprintData,
  npcBlueprintRowsToNpcBlueprintData,
  combineEntityAndTransform,
  // Utility functions
  bigintToNumber,
  numberToBigint,
  decodeUtf8Bytes,
  encodeUtf8String,
  parseJsonBytes,
  encodeJsonToBytes,
  decodeNpcNeeds,
  makeChunkKey,
  parseChunkKey,
  // Type guards
  isEntityRow,
  isTransformRow,
  isChunkRow,
  isNpcStateRow,
} from './SpacetimeDBAdapter.ts';

export type {
  // Row types (re-exported for convenience)
  EntityRow,
  TransformRow,
  ChunkRow,
  NpcStateRow,
  NpcBlueprintRow,
  // Extended client types
  NpcData,
  NpcNeeds,
  NpcBlueprintData,
  NpcBlueprint,
  EntityWithTransform,
} from './SpacetimeDBAdapter.ts';
