/**
 * Protocol types matching server messages (Section 11)
 * All numeric fields use quantized representations for efficiency
 */

// ============================================================================
// Common Types
// ============================================================================

export type EntityId = number; // u64 on server
export type PlayerId = number;
export type NpcId = number;
export type ChunkCoord = number; // i32

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Quantized transform for network efficiency
 * Positions in millimeters, angles in 0.01 degree units
 */
export interface QuantizedTransform {
  x: number; // i32 millimeters
  y: number; // i32 millimeters
  z: number; // i32 millimeters
  yaw: number; // i16 (0.01 degree units)
  vx?: number; // i16 velocity mm/s
  vy?: number;
  vz?: number;
}

// ============================================================================
// LOD Types (Section 4)
// ============================================================================

export enum LODTier {
  LOD0_Interactive = 0, // 0-15m: full updates, dialogue enabled
  LOD1_Nearby = 1, // 15-60m: simplified updates
  LOD2_Far = 2, // 60-250m: coarse waypoints
  LOD3_Offline = 3, // >250m: abstract/dormant
}

// ============================================================================
// Entity Types (Section 9.2)
// ============================================================================

export enum EntityKind {
  Player = 0,
  Npc = 1,
  Prop = 2,
  Item = 3,
}

export interface EntityData {
  entityId: EntityId;
  kind: EntityKind;
  archetypeId: number;
  zoneId: number;
  chunkX: ChunkCoord;
  chunkY: ChunkCoord;
  alive: boolean;
}

export interface TransformData {
  entityId: EntityId;
  transform: QuantizedTransform;
  lastTick: number;
}

// ============================================================================
// Client -> Server Messages (Section 11.1)
// ============================================================================

export enum ClientMessageType {
  InputCommand = 'input_command',
  ChunkSubscribe = 'chunk_subscribe',
  DialogueRequest = 'dialogue_request',
}

/**
 * Player input command with sequence number for reconciliation
 */
export interface InputCommand {
  type: ClientMessageType.InputCommand;
  playerId: PlayerId;
  inputSeq: number; // u32, monotonically increasing
  clientTimeMs: number; // u64 client timestamp
  move: Vec2; // normalized (-1 to 1)
  actions: number; // bitset (jump=1, interact=2, etc.)
  aimYaw?: number; // i16 optional aiming direction
  predictedPosition: Vec3; // client's predicted position in meters (sent as mm to server)
}

export interface ChunkSubscribe {
  type: ClientMessageType.ChunkSubscribe;
  playerId: PlayerId;
  chunks: Array<{ cx: ChunkCoord; cy: ChunkCoord }>;
}

export interface DialogueRequest {
  type: ClientMessageType.DialogueRequest;
  playerId: PlayerId;
  npcId: NpcId;
  utterance: string;
  contextHint?: Uint8Array;
}

export type ClientMessage = InputCommand | ChunkSubscribe | DialogueRequest;

// ============================================================================
// Server -> Client Messages (Section 11.2)
// ============================================================================

export enum ServerMessageType {
  WorldSnapshot = 'world_snapshot',
  WorldDelta = 'world_delta',
  ChunkData = 'chunk_data',
  DialogueResponse = 'dialogue_response',
}

/**
 * Initial world state or resync
 */
export interface WorldSnapshot {
  type: ServerMessageType.WorldSnapshot;
  serverTick: number;
  serverTimeMs: number;
  chunks: ChunkData[];
  entities: EntityData[];
  transforms: TransformData[];
  playerState: PlayerState;
  lastInputSeqApplied: number;
}

/**
 * Incremental world update (10-20Hz)
 */
export interface WorldDelta {
  type: ServerMessageType.WorldDelta;
  serverTick: number;
  serverTimeMs: number;
  spawnedEntities: EntityData[];
  updatedTransforms: TransformData[];
  updatedComponents: ComponentUpdate[];
  removedEntityIds: EntityId[];
  lodChanges: LODChange[];
  lastInputSeqApplied: number;
}

export interface ComponentUpdate {
  entityId: EntityId;
  componentType: string;
  data: unknown;
}

export interface LODChange {
  entityId: EntityId;
  newLod: LODTier;
}

/**
 * Chunk terrain and POI data
 */
export interface ChunkData {
  type: ServerMessageType.ChunkData;
  cx: ChunkCoord;
  cy: ChunkCoord;
  seed: number;
  biome: number;
  poiBlob?: Uint8Array;
  deltaBlob?: Uint8Array;
}

/**
 * NPC dialogue response
 */
export interface DialogueResponse {
  type: ServerMessageType.DialogueResponse;
  npcId: NpcId;
  text: string;
  intentTags: string[];
  optionalActions: DialogueAction[];
  serverEventsEmitted: Array<{ id: number; type: string }>;
}

export interface DialogueAction {
  actionType: string;
  params: Record<string, unknown>;
}

export type ServerMessage =
  | WorldSnapshot
  | WorldDelta
  | ChunkData
  | DialogueResponse;

// ============================================================================
// Player State
// ============================================================================

export interface PlayerState {
  entityId: EntityId;
  transform: QuantizedTransform;
  health: number;
  stamina: number;
  inventory: InventorySlot[];
}

export interface InventorySlot {
  itemId: number;
  quantity: number;
}

// ============================================================================
// Action Bitset Helpers
// ============================================================================

export const ActionFlags = {
  JUMP: 1 << 0,
  INTERACT: 1 << 1,
  ATTACK: 1 << 2,
  SPRINT: 1 << 3,
  CROUCH: 1 << 4,
} as const;

export function hasAction(actions: number, flag: number): boolean {
  return (actions & flag) !== 0;
}

export function setAction(actions: number, flag: number): number {
  return actions | flag;
}

export function clearAction(actions: number, flag: number): number {
  return actions & ~flag;
}

// ============================================================================
// Quantization Helpers
// ============================================================================

const POSITION_SCALE = 1000; // mm per unit
const ANGLE_SCALE = 100; // 0.01 degrees per unit

export function quantizePosition(value: number): number {
  return Math.round(value * POSITION_SCALE);
}

export function dequantizePosition(value: number): number {
  return value / POSITION_SCALE;
}

export function quantizeAngle(radians: number): number {
  const degrees = (radians * 180) / Math.PI;
  return Math.round(degrees * ANGLE_SCALE);
}

export function dequantizeAngle(value: number): number {
  const degrees = value / ANGLE_SCALE;
  return (degrees * Math.PI) / 180;
}

export function dequantizeTransform(qt: QuantizedTransform): {
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
} {
  return {
    x: dequantizePosition(qt.x),
    y: dequantizePosition(qt.y),
    z: dequantizePosition(qt.z),
    yaw: dequantizeAngle(qt.yaw),
    vx: qt.vx ? dequantizePosition(qt.vx) : 0,
    vy: qt.vy ? dequantizePosition(qt.vy) : 0,
    vz: qt.vz ? dequantizePosition(qt.vz) : 0,
  };
}
