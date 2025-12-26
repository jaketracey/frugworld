/**
 * WebSocket connection manager for Frugworld client
 * Handles connection lifecycle, message routing, and reconnection
 */

import {
  serializeClientMessage,
  deserializeServerMessage,
} from './serialization.ts';
import type {
  ClientMessage,
  ServerMessage,
  WorldSnapshot,
  WorldDelta,
  ChunkData,
  DialogueResponse,
  ServerMessageType,
} from '@/types/protocol.ts';

export enum ConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Reconnecting = 'reconnecting',
}

export interface ConnectionConfig {
  url: string;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
  reconnectAttempts?: number;
  heartbeatInterval?: number;
}

export type MessageHandler<T extends ServerMessage> = (message: T) => void;

export interface ConnectionEvents {
  onStateChange?: (state: ConnectionState) => void;
  onWorldSnapshot?: MessageHandler<WorldSnapshot>;
  onWorldDelta?: MessageHandler<WorldDelta>;
  onChunkData?: MessageHandler<ChunkData>;
  onDialogueResponse?: MessageHandler<DialogueResponse>;
  onError?: (error: Event | Error) => void;
  onLatencyUpdate?: (latencyMs: number) => void;
}

const DEFAULT_CONFIG: Required<Omit<ConnectionConfig, 'url'>> = {
  reconnectDelay: 1000,
  maxReconnectDelay: 30000,
  reconnectAttempts: 10,
  heartbeatInterval: 5000,
};

export class ConnectionManager {
  private config: Required<ConnectionConfig>;
  private events: ConnectionEvents;
  private socket: WebSocket | null = null;
  private state: ConnectionState = ConnectionState.Disconnected;
  private reconnectAttempt: number = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private lastServerTime: number = 0;
  private estimatedLatency: number = 0;

  constructor(config: ConnectionConfig, events: ConnectionEvents = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
    this.events = events;
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Get estimated network latency
   */
  getLatency(): number {
    return this.estimatedLatency;
  }

  /**
   * Get last known server time
   */
  getLastServerTime(): number {
    return this.lastServerTime;
  }

  /**
   * Connect to the game server
   */
  connect(): void {
    if (
      this.state === ConnectionState.Connected ||
      this.state === ConnectionState.Connecting
    ) {
      return;
    }

    this.setState(ConnectionState.Connecting);
    this.createSocket();
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.cleanup();
    this.setState(ConnectionState.Disconnected);
  }

  /**
   * Send a message to the server
   */
  send(message: ClientMessage): boolean {
    if (this.state !== ConnectionState.Connected || !this.socket) {
      console.warn('Cannot send message: not connected');
      return false;
    }

    try {
      const data = serializeClientMessage(message);
      this.socket.send(data);
      return true;
    } catch (error) {
      console.error('Failed to send message:', error);
      return false;
    }
  }

  /**
   * Update event handlers
   */
  setEvents(events: Partial<ConnectionEvents>): void {
    this.events = { ...this.events, ...events };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.events.onStateChange?.(state);
    }
  }

  private createSocket(): void {
    try {
      this.socket = new WebSocket(this.config.url);
      this.socket.binaryType = 'arraybuffer';

      this.socket.onopen = this.handleOpen.bind(this);
      this.socket.onmessage = this.handleMessage.bind(this);
      this.socket.onclose = this.handleClose.bind(this);
      this.socket.onerror = this.handleError.bind(this);
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  private handleOpen(): void {
    console.log('WebSocket connected');
    this.setState(ConnectionState.Connected);
    this.reconnectAttempt = 0;
    this.startHeartbeat();
  }

  private handleMessage(event: MessageEvent): void {
    const data = event.data as ArrayBuffer | string;
    const message = deserializeServerMessage(data);

    if (!message) {
      return;
    }

    // Update latency estimate from server time
    if ('serverTimeMs' in message) {
      this.updateLatency(message.serverTimeMs);
    }

    // Route to appropriate handler
    this.routeMessage(message);
  }

  private routeMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'world_snapshot' as ServerMessageType:
        this.events.onWorldSnapshot?.(message as WorldSnapshot);
        break;
      case 'world_delta' as ServerMessageType:
        this.events.onWorldDelta?.(message as WorldDelta);
        break;
      case 'chunk_data' as ServerMessageType:
        this.events.onChunkData?.(message as ChunkData);
        break;
      case 'dialogue_response' as ServerMessageType:
        this.events.onDialogueResponse?.(message as DialogueResponse);
        break;
    }
  }

  private handleClose(event: CloseEvent): void {
    console.log(
      `WebSocket closed: code=${event.code}, reason=${event.reason}`
    );
    this.stopHeartbeat();

    if (this.state !== ConnectionState.Disconnected) {
      this.setState(ConnectionState.Reconnecting);
      this.scheduleReconnect();
    }
  }

  private handleError(event: Event): void {
    console.error('WebSocket error:', event);
    this.events.onError?.(event);
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= this.config.reconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.setState(ConnectionState.Disconnected);
      return;
    }

    const delay = Math.min(
      this.config.reconnectDelay * Math.pow(2, this.reconnectAttempt),
      this.config.maxReconnectDelay
    );

    console.log(
      `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt + 1})`
    );

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempt++;
      this.createSocket();
    }, delay);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      // Heartbeat is implicit through regular input commands
      // This is just for connection health monitoring
      if (this.socket?.readyState !== WebSocket.OPEN) {
        this.stopHeartbeat();
        this.handleClose(new CloseEvent('close'));
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private updateLatency(serverTimeMs: number): void {
    const now = Date.now();
    // Simple RTT estimate (assumes minimal server processing time)
    const rtt = now - serverTimeMs;

    // Exponential moving average for smoothing
    if (this.estimatedLatency === 0) {
      this.estimatedLatency = rtt / 2;
    } else {
      this.estimatedLatency = this.estimatedLatency * 0.9 + (rtt / 2) * 0.1;
    }

    this.lastServerTime = serverTimeMs;
    this.events.onLatencyUpdate?.(this.estimatedLatency);
  }

  private cleanup(): void {
    this.stopHeartbeat();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;

      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.close(1000, 'Client disconnect');
      }

      this.socket = null;
    }
  }
}
