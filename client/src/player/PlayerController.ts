/**
 * Player controller with client-side prediction and server reconciliation
 * RTS-style: click-to-move instead of WASD
 * Implements Section 12.1 of the architecture spec
 */

import type {
  InputCommand,
  QuantizedTransform,
  Vec2,
} from '@/types/protocol.ts';
import {
  ClientMessageType,
  quantizeAngle,
} from '@/types/protocol.ts';
import { InputBuffer, type PredictedState } from '@/network/InputBuffer.ts';
import { InputCapture, type InputState } from './InputCapture.ts';
import {
  MovementSimulator,
  type PlayerPhysicsState,
} from './MovementSimulator.ts';
import type { TerrainHeightProvider } from '@/terrain/index.ts';

export interface PlayerControllerConfig {
  playerId: number;
  simTickRate: number; // Fixed simulation rate (default 60Hz)
  correctionThreshold: number; // Max drift before hard correction
  smoothCorrectionRate: number; // Rate of smooth correction
  moveTargetReachDistance: number; // Distance threshold to consider target reached
}

const DEFAULT_CONFIG: PlayerControllerConfig = {
  playerId: 0,
  simTickRate: 60,
  correctionThreshold: 0.5, // 0.5 meters
  smoothCorrectionRate: 10.0, // units per second
  moveTargetReachDistance: 0.5, // 0.5 meters
};

export class PlayerController {
  private config: PlayerControllerConfig;
  private inputCapture: InputCapture;
  private inputBuffer: InputBuffer;
  private simulator: MovementSimulator;

  // Physics state
  private physicsState: PlayerPhysicsState;
  private displayState: PlayerPhysicsState; // Smoothed for rendering
  private serverState: PlayerPhysicsState; // Last confirmed server state

  // Timing
  private simAccumulator: number = 0;
  private simTickDuration: number;

  // Reconciliation
  private lastAckedSeq: number = 0;

  // Input sending callback
  private sendInput: ((command: InputCommand) => void) | null = null;

  // Camera yaw for camera-relative movement direction
  private cameraYaw: number = 0;

  // Click-to-move target (in game coords)
  private moveTarget: { x: number; y: number } | null = null;
  private moveTargetNpcId: number | null = null; // If moving to an NPC
  private onReachNpc: ((npcId: number) => void) | null = null;

  constructor(
    element: HTMLElement,
    config: Partial<PlayerControllerConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.simTickDuration = 1000 / this.config.simTickRate;

    this.inputCapture = new InputCapture(element);
    this.inputBuffer = new InputBuffer();
    this.simulator = new MovementSimulator();

    // Initialize states
    this.physicsState = this.simulator.createState(0, 0, 0, 0);
    this.displayState = this.simulator.cloneState(this.physicsState);
    this.serverState = this.simulator.cloneState(this.physicsState);
  }

  /**
   * Set callback for sending input commands to server
   */
  setSendInputCallback(callback: (command: InputCommand) => void): void {
    this.sendInput = callback;
  }

  /**
   * Set player ID
   */
  setPlayerId(id: number): void {
    this.config.playerId = id;
  }

  /**
   * Set terrain height provider for ground collision
   */
  setTerrainProvider(provider: TerrainHeightProvider): void {
    this.simulator.setTerrainProvider(provider);
  }

  /**
   * Initialize player position from server
   */
  initFromServer(transform: QuantizedTransform): void {
    const x = transform.x / 1000;
    const y = transform.y / 1000;
    const z = transform.z / 1000;
    const yaw = (transform.yaw / 100) * (Math.PI / 180);

    this.physicsState = this.simulator.createState(x, y, z, yaw);
    this.displayState = this.simulator.cloneState(this.physicsState);
    this.serverState = this.simulator.cloneState(this.physicsState);

    // Clear input buffer on init
    this.inputBuffer.clear();
    this.lastAckedSeq = 0;
  }

  /**
   * Update player simulation - call every frame
   */
  update(deltaMs: number): void {
    this.simAccumulator += deltaMs;

    // Fixed timestep simulation
    while (this.simAccumulator >= this.simTickDuration) {
      this.simulateTick();
      this.simAccumulator -= this.simTickDuration;
    }

    // Smooth display state towards physics state
    this.smoothDisplayState(deltaMs);
  }

  /**
   * Handle server acknowledgment of inputs
   */
  onServerAck(
    lastInputSeqApplied: number,
    serverTransform: QuantizedTransform
  ): void {
    if (lastInputSeqApplied <= this.lastAckedSeq) {
      return;
    }

    // Update server state
    this.serverState.x = serverTransform.x / 1000;
    this.serverState.y = serverTransform.y / 1000;
    this.serverState.z = serverTransform.z / 1000;
    this.serverState.yaw = (serverTransform.yaw / 100) * (Math.PI / 180);

    // Acknowledge inputs
    this.inputBuffer.acknowledge(lastInputSeqApplied);
    this.lastAckedSeq = lastInputSeqApplied;

    // Check if reconciliation needed
    this.reconcile();
  }

  /**
   * Get display position for rendering
   */
  getDisplayPosition(): { x: number; y: number; z: number; yaw: number } {
    return {
      x: this.displayState.x,
      y: this.displayState.y,
      z: this.displayState.z,
      yaw: this.displayState.yaw,
    };
  }

  /**
   * Get current velocity for rendering (ball rolling animation)
   */
  getVelocity(): { vx: number; vy: number; vz: number } {
    return {
      vx: this.displayState.vx,
      vy: this.displayState.vy,
      vz: this.displayState.vz,
    };
  }

  /**
   * Get physics position (predicted)
   */
  getPhysicsPosition(): { x: number; y: number; z: number; yaw: number } {
    return {
      x: this.physicsState.x,
      y: this.physicsState.y,
      z: this.physicsState.z,
      yaw: this.physicsState.yaw,
    };
  }

  /**
   * Get input buffer statistics
   */
  getInputStats(): {
    pendingCount: number;
    lastAckedSeq: number;
    nextSeq: number;
    oldestPendingMs: number | null;
  } {
    return this.inputBuffer.getStats();
  }

  /**
   * Set camera yaw for camera-relative movement direction
   */
  setCameraYaw(yaw: number): void {
    this.cameraYaw = yaw;
  }

  /**
   * Set click-to-move target position (in game coords)
   */
  setMoveTarget(x: number, y: number, npcId: number | null = null): void {
    this.moveTarget = { x, y };
    this.moveTargetNpcId = npcId;
  }

  /**
   * Clear the move target
   */
  clearMoveTarget(): void {
    this.moveTarget = null;
    this.moveTargetNpcId = null;
  }

  /**
   * Check if we have a move target
   */
  hasMoveTarget(): boolean {
    return this.moveTarget !== null;
  }

  /**
   * Get current move target NPC ID (if any)
   */
  getMoveTargetNpcId(): number | null {
    return this.moveTargetNpcId;
  }

  /**
   * Set callback for when player reaches an NPC
   */
  setOnReachNpc(callback: (npcId: number) => void): void {
    this.onReachNpc = callback;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.inputCapture.destroy();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private simulateTick(): void {
    // Capture current input (for actions like interact, but not movement)
    const inputState = this.inputCapture.getState();

    // Calculate movement towards click-to-move target
    let moveVec: Vec2 = { x: 0, y: 0 };

    if (this.moveTarget) {
      const dx = this.moveTarget.x - this.physicsState.x;
      const dy = this.moveTarget.y - this.physicsState.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Check if we've reached the target
      const reachDistance = this.moveTargetNpcId !== null ? 2.5 : this.config.moveTargetReachDistance;
      if (distance <= reachDistance) {
        // Reached target - stop moving
        this.physicsState.vx = 0;
        this.physicsState.vy = 0;

        if (this.moveTargetNpcId !== null && this.onReachNpc) {
          const npcId = this.moveTargetNpcId;
          this.clearMoveTarget();
          this.onReachNpc(npcId);
        } else {
          this.clearMoveTarget();
        }
      } else {
        // Move towards target (normalized direction)
        moveVec = {
          x: dx / distance,
          y: dy / distance,
        };
      }
    }

    // Simulate ball physics with click-to-move direction
    const simDeltaSeconds = this.simTickDuration / 1000;
    this.simulator.simulate(
      this.physicsState,
      moveVec,
      inputState.actions,
      simDeltaSeconds
    );

    // Create and buffer input command
    const seq = this.inputBuffer.getNextSeq();
    const command = this.createInputCommand(seq, { ...inputState, move: moveVec });

    const predictedState: PredictedState = {
      x: this.physicsState.x,
      y: this.physicsState.y,
      z: this.physicsState.z,
      yaw: this.physicsState.yaw,
    };

    this.inputBuffer.push(command, predictedState);

    // Send to server
    this.sendInput?.(command);
  }

  private createInputCommand(seq: number, input: InputState): InputCommand {
    return {
      type: ClientMessageType.InputCommand,
      playerId: this.config.playerId,
      inputSeq: seq,
      clientTimeMs: Date.now(),
      move: input.move,
      actions: input.actions,
      aimYaw: quantizeAngle(input.aimYaw),
      predictedPosition: {
        x: this.physicsState.x,
        y: this.physicsState.y,
        z: this.physicsState.z,
      },
    };
  }

  private reconcile(): void {
    // Calculate drift between predicted and server state
    const drift = this.simulator.stateDistance(
      this.physicsState,
      this.serverState
    );

    if (drift > this.config.correctionThreshold) {
      // Large drift - hard reset to server state and replay
      this.hardReconcile();
    }
    // Small drift is handled by smoothDisplayState
  }

  private hardReconcile(): void {
    // Reset to server authoritative state
    this.simulator.copyState(this.serverState, this.physicsState);

    // Replay all unacknowledged inputs
    const unacked = this.inputBuffer.getUnacknowledged();
    const simDeltaSeconds = this.simTickDuration / 1000;

    for (const buffered of unacked) {
      const cmd = buffered.command;
      this.physicsState.yaw = cmd.aimYaw
        ? (cmd.aimYaw / 100) * (Math.PI / 180)
        : this.physicsState.yaw;
      this.simulator.simulate(
        this.physicsState,
        cmd.move,
        cmd.actions,
        simDeltaSeconds
      );
    }
  }

  private smoothDisplayState(deltaMs: number): void {
    const rate = this.config.smoothCorrectionRate * (deltaMs / 1000);

    // Interpolate display towards physics
    this.displayState.x = this.approach(
      this.displayState.x,
      this.physicsState.x,
      rate
    );
    this.displayState.y = this.approach(
      this.displayState.y,
      this.physicsState.y,
      rate
    );
    this.displayState.z = this.approach(
      this.displayState.z,
      this.physicsState.z,
      rate
    );
    this.displayState.yaw = this.approachAngle(
      this.displayState.yaw,
      this.physicsState.yaw,
      rate * 2
    );

    // If close enough, snap
    if (
      this.simulator.stateDistance(this.displayState, this.physicsState) < 0.01
    ) {
      this.simulator.copyState(this.physicsState, this.displayState);
    }
  }

  private approach(current: number, target: number, rate: number): number {
    const diff = target - current;
    if (Math.abs(diff) <= rate) {
      return target;
    }
    return current + Math.sign(diff) * rate;
  }

  private approachAngle(
    current: number,
    target: number,
    rate: number
  ): number {
    let diff = target - current;

    // Normalize to [-PI, PI]
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    if (Math.abs(diff) <= rate) {
      return target;
    }
    return current + Math.sign(diff) * rate;
  }
}
