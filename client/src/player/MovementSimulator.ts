/**
 * Super Monkey Ball-style physics for rolling ball movement
 * Ball rolls on terrain with proper slope physics, momentum, and gravity
 */

import type { Vec2 } from '@/types/protocol.ts';
import { ActionFlags, hasAction } from '@/types/protocol.ts';
import type { TerrainHeightProvider, TerrainSample } from '@/terrain/index.ts';

export interface PlayerPhysicsState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
}

export interface MovementConfig {
  // Ball physics
  ballRadius: number;
  moveForce: number; // Force applied by input (tilt simulation)
  gravity: number; // Vertical gravity for jumping/falling
  slopeGravity: number; // How strongly slopes affect ball rolling
  rollingFriction: number; // Rolling resistance (deceleration factor)
  airResistance: number;
  bounciness: number; // Coefficient of restitution

  // Speed limits
  maxSpeed: number;
  maxFallSpeed: number;

  // Jump
  jumpForce: number;

  // Ground following
  groundHeight: number;
  groundSnapDistance: number; // How far above ground before considered airborne
  groundSmoothFactor: number; // Smoothing for terrain height changes
}

const DEFAULT_CONFIG: MovementConfig = {
  ballRadius: 0.6,
  moveForce: 35.0, // Increased for more responsive control
  gravity: 25.0, // Slightly stronger gravity for snappy feel
  slopeGravity: 40.0, // Strong slope influence for SMB-style rolling
  rollingFriction: 3.5, // Deceleration rate (units per second^2)
  airResistance: 0.98,
  bounciness: 0.3,

  maxSpeed: 18.0, // Slightly higher max speed
  maxFallSpeed: 50.0,

  jumpForce: 12.0,
  groundHeight: 0.0,
  groundSnapDistance: 0.15, // Snap to ground if within this distance
  groundSmoothFactor: 0.3, // Smooth terrain height transitions
};

export class MovementSimulator {
  private config: MovementConfig;
  private terrainProvider: TerrainHeightProvider | null = null;

  constructor(config: Partial<MovementConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the terrain height provider for ground collision
   */
  setTerrainProvider(provider: TerrainHeightProvider): void {
    this.terrainProvider = provider;
  }

  /**
   * Get terrain sample (height and slope) at a position
   */
  private getTerrainSample(x: number, y: number): TerrainSample {
    if (this.terrainProvider) {
      return this.terrainProvider.getSampleAt(x, y);
    }
    return {
      height: this.config.groundHeight,
      normalX: 0,
      normalY: 0,
      normalZ: 1,
      slopeX: 0,
      slopeY: 0,
    };
  }

  /**
   * Get ground height at a position
   */
  private getGroundHeight(x: number, y: number): number {
    if (this.terrainProvider) {
      return this.terrainProvider.getHeightAt(x, y);
    }
    return this.config.groundHeight;
  }

  /**
   * Simulate Super Monkey Ball-style physics
   * The ball rolls on terrain following slope, with player input acting like tilting the stage
   * @param state Current player state (mutated)
   * @param move Movement input vector (-1 to 1) - simulates stage tilt
   * @param actions Action bitset
   * @param deltaSeconds Time step in seconds
   */
  simulate(
    state: PlayerPhysicsState,
    move: Vec2,
    actions: number,
    deltaSeconds: number
  ): void {
    // Get terrain sample at current position for height and slope
    const terrain = this.getTerrainSample(state.x, state.y);
    const groundHeight = terrain.height + this.config.ballRadius;

    // Check if ball is on/near ground
    const heightAboveGround = state.z - groundHeight;
    const wasOnGround = state.onGround;

    if (state.onGround) {
      // ========================================
      // GROUND PHYSICS (Super Monkey Ball style)
      // ========================================

      // 1. Input force - like tilting the stage
      // Input directly affects acceleration (responsive controls)
      const inputForceX = move.x * this.config.moveForce;
      const inputForceY = move.y * this.config.moveForce;

      // 2. Slope gravity - ball naturally rolls downhill
      // Stronger effect for SMB feel - slopes should really pull the ball
      const slopeForceX = this.config.slopeGravity * terrain.slopeX;
      const slopeForceY = this.config.slopeGravity * terrain.slopeY;

      // 3. Apply combined forces as acceleration
      state.vx += (inputForceX + slopeForceX) * deltaSeconds;
      state.vy += (inputForceY + slopeForceY) * deltaSeconds;

      // 4. Rolling friction - gradual deceleration when no input
      // Only apply if moving and not actively pushing against motion
      const speed = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
      if (speed > 0.01) {
        // Calculate friction deceleration
        const frictionDecel = this.config.rollingFriction * deltaSeconds;

        // Only apply friction up to the point of stopping
        if (frictionDecel < speed) {
          const frictionFactor = 1 - frictionDecel / speed;
          state.vx *= frictionFactor;
          state.vy *= frictionFactor;
        } else {
          // Would decelerate past zero, just stop
          state.vx = 0;
          state.vy = 0;
        }
      }

      // 5. Snap Z position to terrain (smooth following)
      // Ball center follows terrain + ball radius
      if (Math.abs(heightAboveGround) < this.config.groundSnapDistance) {
        // Smoothly adjust to terrain height for gentle rolling over bumps
        state.z = groundHeight;
        state.vz = 0;
      } else if (heightAboveGround < 0) {
        // Below ground - push up immediately (collision)
        state.z = groundHeight;
        state.vz = 0;
      } else {
        // Above snap distance - become airborne
        state.onGround = false;
      }

    } else {
      // ========================================
      // AIR PHYSICS
      // ========================================

      // Reduced air control (can slightly influence direction)
      const airControlFactor = 0.25;
      state.vx += move.x * this.config.moveForce * airControlFactor * deltaSeconds;
      state.vy += move.y * this.config.moveForce * airControlFactor * deltaSeconds;

      // Apply vertical gravity
      state.vz -= this.config.gravity * deltaSeconds;

      // Air resistance
      state.vx *= Math.pow(this.config.airResistance, deltaSeconds * 60);
      state.vy *= Math.pow(this.config.airResistance, deltaSeconds * 60);

      // Clamp fall speed
      state.vz = Math.max(state.vz, -this.config.maxFallSpeed);
    }

    // Handle jumping
    if (hasAction(actions, ActionFlags.JUMP) && wasOnGround && state.onGround) {
      state.vz = this.config.jumpForce;
      state.onGround = false;
    }

    // Clamp horizontal speed
    const horizontalSpeed = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
    if (horizontalSpeed > this.config.maxSpeed) {
      const scale = this.config.maxSpeed / horizontalSpeed;
      state.vx *= scale;
      state.vy *= scale;
    }

    // Apply velocities to position
    state.x += state.vx * deltaSeconds;
    state.y += state.vy * deltaSeconds;
    state.z += state.vz * deltaSeconds;

    // Ground collision check after movement
    const newTerrain = this.getTerrainSample(state.x, state.y);
    const newGroundHeight = newTerrain.height + this.config.ballRadius;

    if (state.z <= newGroundHeight) {
      // Hit the ground
      state.z = newGroundHeight;

      if (!wasOnGround && state.vz < -2.0) {
        // Landing with significant downward velocity - bounce!
        state.vz = -state.vz * this.config.bounciness;
        if (Math.abs(state.vz) < 1.0) {
          state.vz = 0;
          state.onGround = true;
        }
      } else {
        // Gentle landing or was already on ground
        state.vz = 0;
        state.onGround = true;
      }
    }
  }

  /**
   * Create initial state from position
   */
  createState(
    x: number,
    y: number,
    z: number,
    yaw: number
  ): PlayerPhysicsState {
    const groundHeight = this.getGroundHeight(x, y) + this.config.ballRadius;
    return {
      x,
      y,
      z: Math.max(z, groundHeight),
      yaw,
      vx: 0,
      vy: 0,
      vz: 0,
      onGround: z <= groundHeight + 0.1,
    };
  }

  /**
   * Clone a physics state
   */
  cloneState(state: PlayerPhysicsState): PlayerPhysicsState {
    return { ...state };
  }

  /**
   * Copy state values
   */
  copyState(from: PlayerPhysicsState, to: PlayerPhysicsState): void {
    to.x = from.x;
    to.y = from.y;
    to.z = from.z;
    to.yaw = from.yaw;
    to.vx = from.vx;
    to.vy = from.vy;
    to.vz = from.vz;
    to.onGround = from.onGround;
  }

  /**
   * Calculate distance between two states
   */
  stateDistance(a: PlayerPhysicsState, b: PlayerPhysicsState): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<MovementConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
