/**
 * Message serialization/deserialization for WebSocket communication
 * Uses JSON for now, can be swapped to binary (MessagePack/CBOR) later
 */

import type {
  ClientMessage,
  ServerMessage,
  WorldSnapshot,
  WorldDelta,
  ChunkData,
  DialogueResponse,
} from '@/types/protocol.ts';
import { ServerMessageType } from '@/types/protocol.ts';

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serialize a client message to send over WebSocket
 */
export function serializeClientMessage(message: ClientMessage): ArrayBuffer {
  const json = JSON.stringify(message);
  const encoder = new TextEncoder();
  return encoder.encode(json).buffer;
}

// ============================================================================
// Deserialization
// ============================================================================

/**
 * Deserialize a server message from WebSocket data
 */
export function deserializeServerMessage(
  data: ArrayBuffer | string
): ServerMessage | null {
  try {
    let json: string;

    if (typeof data === 'string') {
      json = data;
    } else {
      const decoder = new TextDecoder();
      json = decoder.decode(data);
    }

    const parsed = JSON.parse(json) as { type: ServerMessageType };

    switch (parsed.type) {
      case ServerMessageType.WorldSnapshot:
        return validateWorldSnapshot(parsed);
      case ServerMessageType.WorldDelta:
        return validateWorldDelta(parsed);
      case ServerMessageType.ChunkData:
        return validateChunkData(parsed);
      case ServerMessageType.DialogueResponse:
        return validateDialogueResponse(parsed);
      default:
        console.warn('Unknown server message type:', parsed.type);
        return null;
    }
  } catch (error) {
    console.error('Failed to deserialize server message:', error);
    return null;
  }
}

// ============================================================================
// Validation Helpers
// ============================================================================

function validateWorldSnapshot(data: unknown): WorldSnapshot | null {
  const msg = data as Partial<WorldSnapshot>;

  if (
    typeof msg.serverTick !== 'number' ||
    typeof msg.serverTimeMs !== 'number' ||
    !Array.isArray(msg.chunks) ||
    !Array.isArray(msg.entities) ||
    !Array.isArray(msg.transforms) ||
    !msg.playerState ||
    typeof msg.lastInputSeqApplied !== 'number'
  ) {
    console.warn('Invalid WorldSnapshot structure');
    return null;
  }

  return msg as WorldSnapshot;
}

function validateWorldDelta(data: unknown): WorldDelta | null {
  const msg = data as Partial<WorldDelta>;

  if (
    typeof msg.serverTick !== 'number' ||
    typeof msg.serverTimeMs !== 'number' ||
    !Array.isArray(msg.spawnedEntities) ||
    !Array.isArray(msg.updatedTransforms) ||
    !Array.isArray(msg.removedEntityIds) ||
    typeof msg.lastInputSeqApplied !== 'number'
  ) {
    console.warn('Invalid WorldDelta structure');
    return null;
  }

  // Provide defaults for optional arrays
  msg.updatedComponents = msg.updatedComponents ?? [];
  msg.lodChanges = msg.lodChanges ?? [];

  return msg as WorldDelta;
}

function validateChunkData(data: unknown): ChunkData | null {
  const msg = data as Partial<ChunkData>;

  if (
    typeof msg.cx !== 'number' ||
    typeof msg.cy !== 'number' ||
    typeof msg.seed !== 'number' ||
    typeof msg.biome !== 'number'
  ) {
    console.warn('Invalid ChunkData structure');
    return null;
  }

  return msg as ChunkData;
}

function validateDialogueResponse(data: unknown): DialogueResponse | null {
  const msg = data as Partial<DialogueResponse>;

  if (
    typeof msg.npcId !== 'number' ||
    typeof msg.text !== 'string' ||
    !Array.isArray(msg.intentTags)
  ) {
    console.warn('Invalid DialogueResponse structure');
    return null;
  }

  // Provide defaults for optional arrays
  msg.optionalActions = msg.optionalActions ?? [];
  msg.serverEventsEmitted = msg.serverEventsEmitted ?? [];

  return msg as DialogueResponse;
}

// ============================================================================
// Binary Helpers (for future optimization)
// ============================================================================

/**
 * Decode base64 to Uint8Array (for blob fields)
 */
export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encode Uint8Array to base64 (for blob fields)
 */
export function encodeBase64(bytes: Uint8Array): string {
  let binaryString = '';
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}
