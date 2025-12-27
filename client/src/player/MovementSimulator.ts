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

/**
 * Ground movement state for enhanced physics
 */
export type GroundState = 'grounded' | 'sliding' | 'airborne';

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

  // Slope handling
  maxSlopeAngle: number; // Maximum walkable slope in degrees
  slideThreshold: number; // Slope angle where sliding begins (degrees)
  slideFriction: number; // Reduced friction when sliding
  uphillPenalty: number; // Speed reduction when going uphill (0-1)
  downhillBoost: number; // Speed boost when going downhill
}

const DEFAULT_CONFIG: MovementConfig = {
  ballRadius: 0.6,
  moveForce: 40.0, // Increased for more responsive control
  gravity: 25.0, // Slightly stronger gravity for snappy feel
  slopeGravity: 45.0, // Strong slope influence for SMB-style rolling
  rollingFriction: 4.0, // Deceleration rate (units per second^2)
  airResistance: 0.98,
  bounciness: 0.3,

  maxSpeed: 16.0, // Balanced max speed
  maxFallSpeed: 50.0,

  jumpForce: 10.0,
  groundHeight: 0.0,
  groundSnapDistance: 0.2, // Snap to ground if within this distance
  groundSmoothFactor: 0.3, // Smooth terrain height transitions

  // Slope settings for rolling terrain
  maxSlopeAngle: 50.0, // Can't climb steeper than 50 degrees
  slideThreshold: 40.0, // Start sliding at 40 degrees
  slideFriction: 1.5, // Low friction when sliding
  uphillPenalty: 0.6, // 60% speed when going uphill
  downhillBoost: 1.3, // 130% speed boost downhill
};

export class MovementSimulator {
  private config: MovementConfig;
  private terrainProvider: TerrainHeightProvider | null = null;

  // Track ground state for more nuanced physics
  private groundState: GroundState = 'grounded';

  constructor(config: Partial<MovementConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get current ground state
   */
  getGroundState(): GroundState {
    return this.groundState;
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
   * Calculate slope angle in degrees from terrain slope values
   */
  private calculateSlopeAngle(slopeX: number, slopeY: number): number {
    const slopeMagnitude = Math.sqrt(slopeX * slopeX + slopeY * slopeY);
    return Math.atan(slopeMagnitude) * (180 / Math.PI);
  }

  /**
   * Check if player is moving uphill or downhill
   * Returns positive for uphill, negative for downhill, 0 for flat
   */
  private getMovementSlopeAlignment(vx: number, vy: number, slopeX: number, slopeY: number): number {
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed < 0.1) return 0;

    // Movement direction
    const moveDirX = vx / speed;
    const moveDirY = vy / speed;

    // Slope direction (uphill is opposite of slope vector)
    // Slope vector points downhill, so dot product with movement tells us:
    // positive = moving with slope (downhill), negative = moving against slope (uphill)
    const slopeDot = moveDirX * slopeX + moveDirY * slopeY;

    return -slopeDot; // Flip sign: positive = uphill, negative = downhill
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

    // Calculate slope angle for physics decisions
    const slopeAngle = this.calculateSlopeAngle(terrain.slopeX, terrain.slopeY);

    if (state.onGround) {
      // ========================================
      // GROUND PHYSICS (Super Monkey Ball style)
      // ========================================

      // Determine if sliding on steep slope
      const isSliding = slopeAngle >= this.config.slideThreshold;
      const isTooSteep = slopeAngle >= this.config.maxSlopeAngle;
      this.groundState = isSliding ? 'sliding' : 'grounded';

      // Calculate movement alignment with slope (uphill/downhill)
      const slopeAlignment = this.getMovementSlopeAlignment(
        state.vx, state.vy, terrain.slopeX, terrain.slopeY
      );

      // 1. Input force - like tilting the stage
      let inputMultiplier = 1.0;

      if (isSliding) {
        // Reduced control when sliding
        inputMultiplier = isTooSteep ? 0.2 : 0.5;
      } else if (slopeAlignment > 0.3) {
        // Going uphill - reduce input effectiveness
        inputMultiplier = this.config.uphillPenalty;
      }

      const inputForceX = move.x * this.config.moveForce * inputMultiplier;
      const inputForceY = move.y * this.config.moveForce * inputMultiplier;

      // 2. Slope gravity - ball naturally rolls downhill
      let slopeMultiplier = 1.0;

      if (isTooSteep) {
        // Very steep - strong slide force, can't climb
        slopeMultiplier = 1.5;
      } else if (isSliding) {
        // Moderate slope - increased slide force
        const slideInfluence = (slopeAngle - this.config.slideThreshold) /
          (this.config.maxSlopeAngle - this.config.slideThreshold);
        slopeMultiplier = 1.0 + slideInfluence * 0.5;
      }

      const slopeForceX = this.config.slopeGravity * terrain.slopeX * slopeMultiplier;
      const slopeForceY = this.config.slopeGravity * terrain.slopeY * slopeMultiplier;

      // 3. Apply combined forces as acceleration
      state.vx += (inputForceX + slopeForceX) * deltaSeconds;
      state.vy += (inputForceY + slopeForceY) * deltaSeconds;

      // 4. Rolling friction - varies based on slope state
      const speed = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
      if (speed > 0.01) {
        // Use reduced friction when sliding for momentum preservation
        const frictionRate = isSliding ? this.config.slideFriction : this.config.rollingFriction;
        const frictionDecel = frictionRate * deltaSeconds;

        // Only apply friction up to the point of stopping
        if (frictionDecel < speed) {
          const frictionFactor = 1 - frictionDecel / speed;
          state.vx *= frictionFactor;
          state.vy *= frictionFactor;
        } else if (!isSliding) {
          // Only stop completely if not sliding
          state.vx = 0;
          state.vy = 0;
        }
      }

      // 5. Apply downhill boost for fun momentum
      if (slopeAlignment < -0.3 && speed > 2.0) {
        // Going downhill with speed - slight boost
        const boostFactor = 1 + (this.config.downhillBoost - 1) * 0.1 * deltaSeconds;
        state.vx *= boostFactor;
        state.vy *= boostFactor;
      }

      // 6. Snap Z position to terrain (smooth following)
      if (Math.abs(heightAboveGround) < this.config.groundSnapDistance) {
        state.z = groundHeight;
        state.vz = 0;
      } else if (heightAboveGround < 0) {
        state.z = groundHeight;
        state.vz = 0;
      } else {
        state.onGround = false;
        this.groundState = 'airborne';
      }

    } else {
      // ========================================
      // AIR PHYSICS
      // ========================================
      this.groundState = 'airborne';

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
      this.groundState = 'airborne';
    }

    // Clamp horizontal speed (allow slight overspeed when sliding downhill)
    const horizontalSpeed = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
    const effectiveMaxSpeed = this.groundState === 'sliding'
      ? this.config.maxSpeed * this.config.downhillBoost
      : this.config.maxSpeed;

    if (horizontalSpeed > effectiveMaxSpeed) {
      const scale = effectiveMaxSpeed / horizontalSpeed;
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
