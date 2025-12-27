/**
 * SpacetimeDB Connection Manager
 * Uses the official SpacetimeDB TypeScript SDK with generated bindings
 */

import {
  DbConnection,
  type SubscriptionHandle,
} from '@/module_bindings/index.ts';

/**
 * Reducer parameter types matching the generated bindings.
 */
interface SubmitInputParams {
  inputSeq: number;
  clientTimeMs: bigint;
  moveX: number;
  moveY: number;
  actions: number;
  aimYaw: number;
  predictedX: number;
  predictedY: number;
  predictedZ: number;
}

interface SubscribeChunksParams {
  playerEntityId: bigint;
  chunkCoordsCx: number[];
  chunkCoordsCy: number[];
}

/**
 * Reducer interface matching the actual signatures from the generated bindings.
 * SpacetimeDB SDK uses object parameters for reducers.
 */
interface Reducers {
  playerConnect(params: { name: string }): void;
  submitInput(params: SubmitInputParams): void;
  subscribeChunks(params: SubscribeChunksParams): void;
  startDialogue(params: { npcId: bigint }): void;
  dialogueSay(params: { utterance: string }): void;
  endDialogue(params?: Record<string, never>): void;
  // Note: sendMessage, yellMessage, performGesture, newWorldSeed are called via (reducers as any)
  // since they may not exist in older generated bindings
}

/**
 * Type alias for the connection to work around generated binding type issues
 * with exactOptionalPropertyTypes. The generated bindings have constraint
 * failures that cause DbConnection.reducers to be typed as 'never'.
 */
type AnyDbConnection = Omit<DbConnection, 'reducers'> & { reducers: Reducers };

// Define local interfaces that match the expected row shapes
// These are based on the generated table schemas but defined as interfaces
// to avoid type inference issues with the SpacetimeDB SDK

/** Entity row type matching entity_table.ts schema */
export interface Entity {
  entityId: bigint;
  kind: number;
  archetypeId: number;
  zoneId: bigint;
  chunkX: number;
  chunkY: number;
  alive: boolean;
}

/** Transform row type matching transform_table.ts schema */
export interface Transform {
  entityId: bigint;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  lastTick: bigint;
}

/** Player row type matching player_table.ts schema */
export interface Player {
  identity: unknown; // Identity type from SDK
  entityId: bigint;
  name: string;
  lastInputSeq: number;
  connectedTsMs: bigint;
  lastActivityTsMs: bigint;
}

/** NpcState row type matching npc_state_table.ts schema */
export interface NpcState {
  npcId: bigint;
  lodState: number;
  longGoal: Uint8Array;
  midGoal: Uint8Array;
  shortIntent: Uint8Array;
  needs: Uint8Array;
  memorySummary: Uint8Array;
  lastReplanTsMs: bigint;
}

/** Chunk row type matching chunk_table.ts schema */
export interface Chunk {
  chunkId: bigint;
  cx: number;
  cy: number;
  zoneId: bigint;
  seed: bigint;
  biome: number;
  poiBlob: Uint8Array;
}

/** NPC Blueprint row type matching npc_blueprint_table.ts schema */
export interface NpcBlueprintRow {
  npcId: bigint;
  blueprintJson: Uint8Array;
  version: number;
  createdTsMs: bigint;
}

export enum ConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Reconnecting = 'reconnecting',
}

export interface SpacetimeDBConfig {
  uri: string;
  moduleName: string;
}

/** Active dialogue row for NPC conversations */
export interface ActiveDialogue {
  playerId: bigint;
  npcId: bigint;
  sessionId: bigint;
  startedTsMs: bigint;
  lastActivityTsMs: bigint;
  lineCount: number;
  context: Uint8Array;
}

/** World message row for player chat/yells */
export interface WorldMessage {
  messageId: bigint;
  senderId: bigint;
  senderName: string;
  message: string;
  isYell: boolean;
  chunkX: number;
  chunkY: number;
  posX: number;
  posY: number;
  posZ: number;
  tsMs: bigint;
  expiresTsMs: bigint;
}

/** NPC Perception row for player gesture reactions */
export interface NpcPerception {
  perceptionId: bigint;
  npcId: bigint;
  thought: string;
  sourceEntityId: bigint;
  perceptionType: string;
  createdTsMs: bigint;
  expiresTsMs: bigint;
}

export interface SpacetimeDBEvents {
  onStateChange?: (state: ConnectionState) => void;
  onConnect?: (identity: string) => void;
  onError?: (error: Error) => void;
  onEntityUpdate?: (entity: Entity) => void;
  onEntityDelete?: (entity: Entity) => void;
  onTransformUpdate?: (transform: Transform) => void;
  onPlayerUpdate?: (player: Player) => void;
  onPlayerDelete?: (player: Player) => void;
  onNpcStateUpdate?: (npcState: NpcState) => void;
  onChunkUpdate?: (chunk: Chunk) => void;
  onNpcBlueprintUpdate?: (blueprint: NpcBlueprintRow) => void;
  onActiveDialogueUpdate?: (dialogue: ActiveDialogue) => void;
  onWorldMessageUpdate?: (message: WorldMessage) => void;
  onWorldMessageDelete?: (message: WorldMessage) => void;
  onNpcPerception?: (perception: NpcPerception) => void;
}

const DEFAULT_CONFIG: SpacetimeDBConfig = {
  uri: 'ws://localhost:3000',
  moduleName: 'frugworld',
};

export class SpacetimeDBConnection {
  private config: SpacetimeDBConfig;
  private events: SpacetimeDBEvents;
  private connection: AnyDbConnection | null = null;
  private state: ConnectionState = ConnectionState.Disconnected;
  private subscriptions: SubscriptionHandle[] = [];
  private identity: string | null = null;

  /** Optional callback invoked when connection is established (for bridge wiring) */
  public onConnectCallback?: () => void;

  constructor(config: Partial<SpacetimeDBConfig> = {}, events: SpacetimeDBEvents = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.events = events;
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Get current identity
   */
  getIdentity(): string | null {
    return this.identity;
  }

  /**
   * Get the underlying connection for direct reducer calls
   */
  getConnection(): AnyDbConnection | null {
    return this.connection;
  }

  /**
   * Connect to SpacetimeDB
   */
  async connect(): Promise<void> {
    if (this.state === ConnectionState.Connected || this.state === ConnectionState.Connecting) {
      return;
    }

    this.setState(ConnectionState.Connecting);

    try {
      // Get stored token from localStorage if available
      const storedToken = localStorage.getItem('spacetimedb_token') ?? undefined;

      this.connection = await DbConnection.builder()
        .withUri(this.config.uri)
        .withModuleName(this.config.moduleName)
        .withToken(storedToken)
        .onConnect((conn, identity, token) => {
          console.log('Connected to SpacetimeDB with identity:', identity.toHexString());
          this.identity = identity.toHexString();

          // Store token for future reconnections
          if (token) {
            localStorage.setItem('spacetimedb_token', token);
          }

          this.setState(ConnectionState.Connected);
          this.events.onConnect?.(this.identity);

          // Setup subscriptions to relevant tables
          this.setupSubscriptions(conn as AnyDbConnection);

          // Call optional connect callback (for bridge wiring)
          this.onConnectCallback?.();
        })
        .onDisconnect(() => {
          console.log('Disconnected from SpacetimeDB');
          this.setState(ConnectionState.Disconnected);
        })
        .onConnectError((_ctx, error) => {
          console.error('SpacetimeDB connection error:', error);
          this.setState(ConnectionState.Disconnected);
          this.events.onError?.(error);
        })
        .build() as AnyDbConnection;

    } catch (error) {
      console.error('Failed to connect to SpacetimeDB:', error);
      this.setState(ConnectionState.Disconnected);
      this.events.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Disconnect from SpacetimeDB
   */
  disconnect(): void {
    if (this.connection) {
      // Unsubscribe from all subscriptions
      for (const sub of this.subscriptions) {
        sub.unsubscribe();
      }
      this.subscriptions = [];

      this.connection.disconnect();
      this.connection = null;
    }
    this.setState(ConnectionState.Disconnected);
  }

  /**
   * Setup table subscriptions
   */
  private setupSubscriptions(conn: AnyDbConnection): void {
    // Subscribe to core game tables
    const subscription = conn.subscriptionBuilder()
      .onApplied((ctx) => {
        console.log('Subscription applied');

        // Process initial data from tables
        for (const entity of ctx.db.entity.iter()) {
          this.events.onEntityUpdate?.(entity as Entity);
        }
        for (const transform of ctx.db.transform.iter()) {
          this.events.onTransformUpdate?.(transform as Transform);
        }
        for (const player of ctx.db.player.iter()) {
          this.events.onPlayerUpdate?.(player as Player);
        }
        for (const npcState of ctx.db.npcState.iter()) {
          this.events.onNpcStateUpdate?.(npcState as NpcState);
        }
        for (const chunk of ctx.db.chunk.iter()) {
          this.events.onChunkUpdate?.(chunk as Chunk);
        }
      })
      .onError((ctx) => {
        console.error('Subscription error:', ctx);
      })
      .subscribe([
        'SELECT * FROM entity',
        'SELECT * FROM transform',
        'SELECT * FROM player',
        'SELECT * FROM npc_state',
        'SELECT * FROM chunk',
        'SELECT * FROM npc_blueprint',
        'SELECT * FROM active_dialogue',
        'SELECT * FROM world_message',
        'SELECT * FROM npc_perception',
        'SELECT * FROM npc_npc_relationship',
      ]);

    this.subscriptions.push(subscription);

    // Setup table change callbacks
    conn.db.entity.onInsert((_ctx, entity) => {
      this.events.onEntityUpdate?.(entity as Entity);
    });
    conn.db.entity.onUpdate((_ctx, _oldEntity, newEntity) => {
      this.events.onEntityUpdate?.(newEntity as Entity);
    });
    conn.db.entity.onDelete((_ctx, entity) => {
      this.events.onEntityDelete?.(entity as Entity);
    });

    conn.db.transform.onInsert((_ctx, transform) => {
      this.events.onTransformUpdate?.(transform as Transform);
    });
    conn.db.transform.onUpdate((_ctx, _oldTransform, newTransform) => {
      this.events.onTransformUpdate?.(newTransform as Transform);
    });

    conn.db.player.onInsert((_ctx, player) => {
      this.events.onPlayerUpdate?.(player as Player);
    });
    conn.db.player.onUpdate((_ctx, _oldPlayer, newPlayer) => {
      this.events.onPlayerUpdate?.(newPlayer as Player);
    });
    conn.db.player.onDelete((_ctx, player) => {
      this.events.onPlayerDelete?.(player as Player);
    });

    conn.db.npcState.onInsert((_ctx, npcState) => {
      this.events.onNpcStateUpdate?.(npcState as NpcState);
    });
    conn.db.npcState.onUpdate((_ctx, _oldNpcState, newNpcState) => {
      this.events.onNpcStateUpdate?.(newNpcState as NpcState);
    });

    conn.db.chunk.onInsert((_ctx, chunk) => {
      this.events.onChunkUpdate?.(chunk as Chunk);
    });
    conn.db.chunk.onUpdate((_ctx, _oldChunk, newChunk) => {
      this.events.onChunkUpdate?.(newChunk as Chunk);
    });

    // NPC Blueprint callbacks for NPC names and personality
    conn.db.npcBlueprint.onInsert((_ctx, blueprint) => {
      this.events.onNpcBlueprintUpdate?.(blueprint as NpcBlueprintRow);
    });
    conn.db.npcBlueprint.onUpdate((_ctx, _oldBlueprint, newBlueprint) => {
      this.events.onNpcBlueprintUpdate?.(newBlueprint as NpcBlueprintRow);
    });

    // Active dialogue callbacks for NPC conversation updates
    conn.db.activeDialogue.onInsert((_ctx, dialogue) => {
      console.log('[SpacetimeDB] activeDialogue.onInsert:', dialogue);
      this.events.onActiveDialogueUpdate?.(dialogue as ActiveDialogue);
    });
    conn.db.activeDialogue.onUpdate((_ctx, _oldDialogue, newDialogue) => {
      console.log('[SpacetimeDB] activeDialogue.onUpdate:', newDialogue);
      this.events.onActiveDialogueUpdate?.(newDialogue as ActiveDialogue);
    });
    conn.db.activeDialogue.onDelete((_ctx, dialogue) => {
      console.log('[SpacetimeDB] activeDialogue.onDelete:', dialogue);
    });

    // World message callbacks for player chat/yells
    // Note: worldMessage table may not exist in all server versions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = conn.db as any;
    if (db.worldMessage) {
      db.worldMessage.onInsert((_ctx: unknown, message: unknown) => {
        this.events.onWorldMessageUpdate?.(message as WorldMessage);
      });
      db.worldMessage.onUpdate((_ctx: unknown, _oldMessage: unknown, newMessage: unknown) => {
        this.events.onWorldMessageUpdate?.(newMessage as WorldMessage);
      });
      db.worldMessage.onDelete((_ctx: unknown, message: unknown) => {
        this.events.onWorldMessageDelete?.(message as WorldMessage);
      });
    }

    // NPC perception callbacks for gesture reactions
    if (db.npcPerception) {
      db.npcPerception.onInsert((_ctx: unknown, perception: unknown) => {
        console.log('[SpacetimeDB] NPC perception received:', perception);
        this.events.onNpcPerception?.(perception as NpcPerception);
      });
    }
  }

  /**
   * Call the player_connect reducer
   * @param playerName - The display name for the player
   */
  playerConnect(playerName: string): void {
    if (!this.connection || this.state !== ConnectionState.Connected) {
      console.warn('Cannot call playerConnect: not connected');
      return;
    }
    try {
      this.connection.reducers.playerConnect({ name: playerName });
    } catch (error) {
      console.error('Failed to call playerConnect reducer:', error);
      throw error;
    }
  }

  /**
   * Call the submit_input reducer
   * Signature: inputSeq: u32, clientTimeMs: u64, moveX: i16, moveY: i16, actions: u32, aimYaw: i16, predictedX: i32, predictedY: i32, predictedZ: i32
   * @param inputSeq - Sequence number for this input (u32)
   * @param clientTimeMs - Client timestamp in milliseconds (u64)
   * @param moveX - X movement input (-1, 0, or 1 scaled to i16)
   * @param moveY - Y movement input (-1, 0, or 1 scaled to i16)
   * @param actions - Bitmask of action flags (u32)
   * @param aimYaw - Aim direction in degrees (i16)
   * @param predictedX - Client's predicted X position in millimeters (i32)
   * @param predictedY - Client's predicted Y position in millimeters (i32)
   * @param predictedZ - Client's predicted Z position in millimeters (i32)
   */
  submitInput(
    inputSeq: number,
    clientTimeMs: bigint,
    moveX: number,
    moveY: number,
    actions: number,
    aimYaw: number,
    predictedX: number,
    predictedY: number,
    predictedZ: number
  ): void {
    if (!this.connection || this.state !== ConnectionState.Connected) {
      // Silently ignore if not connected - inputs will be dropped until connected
      return;
    }
    try {
      // Clamp values to their expected ranges
      const clampedMoveX = Math.max(-32768, Math.min(32767, Math.round(moveX)));
      const clampedMoveY = Math.max(-32768, Math.min(32767, Math.round(moveY)));
      const clampedAimYaw = Math.max(-32768, Math.min(32767, Math.round(aimYaw)));
      const clampedInputSeq = Math.max(0, Math.min(4294967295, Math.round(inputSeq)));
      const clampedActions = Math.max(0, Math.min(4294967295, Math.round(actions)));
      // Clamp predicted positions to i32 range
      const clampedPredictedX = Math.max(-2147483648, Math.min(2147483647, Math.round(predictedX)));
      const clampedPredictedY = Math.max(-2147483648, Math.min(2147483647, Math.round(predictedY)));
      const clampedPredictedZ = Math.max(-2147483648, Math.min(2147483647, Math.round(predictedZ)));

      // SpacetimeDB SDK expects an object with named properties matching the reducer schema
      this.connection.reducers.submitInput({
        inputSeq: clampedInputSeq,
        clientTimeMs: clientTimeMs,
        moveX: clampedMoveX,
        moveY: clampedMoveY,
        actions: clampedActions,
        aimYaw: clampedAimYaw,
        predictedX: clampedPredictedX,
        predictedY: clampedPredictedY,
        predictedZ: clampedPredictedZ,
      });
    } catch (error) {
      console.error('Failed to call submitInput reducer:', error);
      throw error;
    }
  }

  /**
   * Call the subscribe_chunks reducer
   * Signature: playerEntityId: u64, chunkCoordsCx: i32[], chunkCoordsCy: i32[]
   * @param playerEntityId - The player's entity ID
   * @param chunks - Array of chunk coordinates to subscribe to
   */
  subscribeChunks(playerEntityId: bigint, chunks: Array<{ cx: number; cy: number }>): void {
    if (!this.connection || this.state !== ConnectionState.Connected) {
      console.warn('Cannot call subscribeChunks: not connected');
      return;
    }
    try {
      // Extract cx and cy arrays from chunks
      const chunkCoordsCx: number[] = chunks.map(c => Math.round(c.cx));
      const chunkCoordsCy: number[] = chunks.map(c => Math.round(c.cy));

      this.connection.reducers.subscribeChunks({
        playerEntityId,
        chunkCoordsCx,
        chunkCoordsCy,
      });
    } catch (error) {
      console.error('Failed to call subscribeChunks reducer:', error);
      throw error;
    }
  }

  /**
   * Call the start_dialogue reducer
   * Signature: npcId: u64
   * @param npcId - The NPC entity ID to start dialogue with
   */
  startDialogue(npcId: bigint): void {
    console.log(`[SpacetimeDB] startDialogue called with npcId=${npcId}`);
    if (!this.connection || this.state !== ConnectionState.Connected) {
      console.warn('[SpacetimeDB] Cannot call startDialogue: not connected');
      return;
    }
    try {
      console.log('[SpacetimeDB] Calling startDialogue reducer...');
      this.connection.reducers.startDialogue({ npcId });
      console.log('[SpacetimeDB] startDialogue reducer called successfully');
    } catch (error) {
      console.error('[SpacetimeDB] Failed to call startDialogue reducer:', error);
      throw error;
    }
  }

  /**
   * Call the dialogue_say reducer
   * Signature: utterance: string
   * Note: The active dialogue is determined by the caller's identity
   * @param utterance - The message to send in the dialogue
   */
  dialogueSay(utterance: string): void {
    console.log(`[SpacetimeDB] dialogueSay called with utterance="${utterance}"`);
    if (!this.connection || this.state !== ConnectionState.Connected) {
      console.warn('[SpacetimeDB] Cannot call dialogueSay: not connected');
      return;
    }
    try {
      console.log('[SpacetimeDB] Calling dialogueSay reducer...');
      this.connection.reducers.dialogueSay({ utterance });
      console.log('[SpacetimeDB] dialogueSay reducer called successfully');
    } catch (error) {
      console.error('[SpacetimeDB] Failed to call dialogueSay reducer:', error);
      throw error;
    }
  }

  /**
   * Call the end_dialogue reducer
   * Signature: no arguments
   * Note: The active dialogue is determined by the caller's identity
   */
  endDialogue(): void {
    if (!this.connection || this.state !== ConnectionState.Connected) {
      console.warn('Cannot call endDialogue: not connected');
      return;
    }
    try {
      this.connection.reducers.endDialogue({});
    } catch (error) {
      console.error('Failed to call endDialogue reducer:', error);
      throw error;
    }
  }

  /**
   * Call the new_world_seed reducer
   * Generates a new world seed and teleports the player to unexplored terrain.
   * Existing chunks keep their seeds; only new chunks use the new seed.
   */
  newWorldSeed(): void {
    if (!this.connection || this.state !== ConnectionState.Connected) {
      console.warn('[SpacetimeDB] Cannot generate new world seed: not connected');
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reducers = this.connection.reducers as any;
    if (typeof reducers.newWorldSeed !== 'function') {
      console.warn('[SpacetimeDB] newWorldSeed reducer not available - regenerate bindings');
      return;
    }
    try {
      reducers.newWorldSeed({});
      console.log('[SpacetimeDB] New world seed requested');
    } catch (error) {
      console.error('[SpacetimeDB] Failed to call newWorldSeed reducer:', error);
      throw error;
    }
  }

  /**
   * Call the send_message reducer
   * Sends a normal chat message to nearby players
   * @param message - The message text to send
   */
  sendMessage(message: string): void {
    if (!this.connection || this.state !== ConnectionState.Connected) {
      console.warn('Cannot call sendMessage: not connected');
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reducers = this.connection.reducers as any;
    if (typeof reducers.sendMessage !== 'function') {
      console.warn('[SpacetimeDB] sendMessage reducer not available - regenerate bindings with: spacetime generate --out-dir client/src/module_bindings --lang typescript');
      return;
    }
    try {
      reducers.sendMessage({ message });
    } catch (error) {
      console.error('Failed to call sendMessage reducer:', error);
    }
  }

  /**
   * Call the yell_message reducer
   * Yells a message to a larger area and affects nearby NPCs
   * @param message - The message text to yell
   */
  yellMessage(message: string): void {
    if (!this.connection || this.state !== ConnectionState.Connected) {
      console.warn('Cannot call yellMessage: not connected');
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reducers = this.connection.reducers as any;
    if (typeof reducers.yellMessage !== 'function') {
      console.warn('[SpacetimeDB] yellMessage reducer not available - regenerate bindings with: spacetime generate --out-dir client/src/module_bindings --lang typescript');
      return;
    }
    try {
      reducers.yellMessage({ message });
    } catch (error) {
      console.error('Failed to call yellMessage reducer:', error);
    }
  }

  /**
   * Call the perform_gesture reducer
   * Performs a gesture (wave, greet, etc.) toward one or more NPCs
   * @param gestureType - The type of gesture (wave, greet, bow, beckon, dismiss)
   * @param targetNpcIds - Array of NPC entity IDs to perform the gesture toward
   */
  performGesture(gestureType: string, targetNpcIds: bigint[]): void {
    if (!this.connection || this.state !== ConnectionState.Connected) {
      console.warn('Cannot call performGesture: not connected');
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reducers = this.connection.reducers as any;
    if (typeof reducers.performGesture !== 'function') {
      console.warn('[SpacetimeDB] performGesture reducer not available - regenerate bindings');
      return;
    }
    try {
      console.log(`[SpacetimeDB] Performing gesture: ${gestureType} toward NPCs:`, targetNpcIds);
      reducers.performGesture({ gestureType, targetNpcIds });
    } catch (error) {
      console.error('Failed to call performGesture reducer:', error);
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      console.log('Connection state:', state);
      this.events.onStateChange?.(state);
    }
  }
}
