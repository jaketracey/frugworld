/**
 * Transform component with interpolation buffer (Section 12.2)
 * Maintains a ring buffer of snapshots keyed by server_tick for smooth rendering
 */

import type { QuantizedTransform } from '@/types/protocol.ts';
import { dequantizeTransform } from '@/types/protocol.ts';

export interface TransformSnapshot {
  tick: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  timestamp: number; // Local timestamp when received
}

export interface InterpolatedTransform {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const RING_BUFFER_SIZE = 32; // ~1.5 seconds at 20Hz
const DEFAULT_INTERP_DELAY_MS = 100; // 100ms interpolation delay

export class TransformComponent {
  private snapshots: TransformSnapshot[] = [];
  private bufferHead: number = 0;
  private bufferCount: number = 0;
  private interpDelayMs: number = DEFAULT_INTERP_DELAY_MS;

  // Current interpolated state
  private currentX: number = 0;
  private currentY: number = 0;
  private currentZ: number = 0;
  private currentYaw: number = 0;

  // Client-side wander offset (purely visual)
  private wanderOffsetX: number = 0;
  private wanderOffsetY: number = 0;

  // Last known server state
  private lastTick: number = 0;
  private lastServerX: number = 0;
  private lastServerY: number = 0;
  private lastServerZ: number = 0;
  private lastServerYaw: number = 0;

  constructor() {
    // Pre-allocate ring buffer
    for (let i = 0; i < RING_BUFFER_SIZE; i++) {
      this.snapshots.push({
        tick: 0,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        timestamp: 0,
      });
    }
  }

  /**
   * Set interpolation delay in milliseconds
   */
  setInterpDelay(delayMs: number): void {
    this.interpDelayMs = delayMs;
  }

  /**
   * Add a new transform snapshot from the server
   */
  addSnapshot(tick: number, transform: QuantizedTransform): void {
    const deq = dequantizeTransform(transform);

    // Find the insertion point (maintain sorted order by tick)
    const slot = this.bufferHead;
    const snapshot = this.snapshots[slot];

    snapshot.tick = tick;
    snapshot.x = deq.x;
    snapshot.y = deq.y;
    snapshot.z = deq.z;
    snapshot.yaw = deq.yaw;
    snapshot.vx = deq.vx;
    snapshot.vy = deq.vy;
    snapshot.vz = deq.vz;
    snapshot.timestamp = performance.now();

    this.bufferHead = (this.bufferHead + 1) % RING_BUFFER_SIZE;
    this.bufferCount = Math.min(this.bufferCount + 1, RING_BUFFER_SIZE);

    // Update last known server state
    this.lastTick = tick;
    this.lastServerX = deq.x;
    this.lastServerY = deq.y;
    this.lastServerZ = deq.z;
    this.lastServerYaw = deq.yaw;
  }

  /**
   * Update interpolation for rendering
   * @param renderTime Current render time (performance.now())
   */
  update(renderTime: number): void {
    const targetTime = renderTime - this.interpDelayMs;

    // Find the two snapshots to interpolate between
    const [before, after] = this.findSnapshotsForTime(targetTime);

    if (!before && !after) {
      // No snapshots available, use last known state
      return;
    }

    if (!before) {
      // Only have future snapshot, use it directly
      this.currentX = after!.x;
      this.currentY = after!.y;
      this.currentZ = after!.z;
      this.currentYaw = after!.yaw;
      return;
    }

    if (!after) {
      // Only have past snapshot, extrapolate briefly then clamp
      const elapsed = (targetTime - before.timestamp) / 1000; // seconds
      const maxExtrapolate = 0.2; // Max 200ms extrapolation

      if (elapsed <= maxExtrapolate) {
        this.currentX = before.x + before.vx * elapsed;
        this.currentY = before.y + before.vy * elapsed;
        this.currentZ = before.z + before.vz * elapsed;
        this.currentYaw = before.yaw;
      } else {
        // Clamp to last position
        this.currentX = before.x + before.vx * maxExtrapolate;
        this.currentY = before.y + before.vy * maxExtrapolate;
        this.currentZ = before.z + before.vz * maxExtrapolate;
        this.currentYaw = before.yaw;
      }
      return;
    }

    // Interpolate between before and after
    const t =
      (targetTime - before.timestamp) / (after.timestamp - before.timestamp);
    const clampedT = Math.max(0, Math.min(1, t));

    this.currentX = before.x + (after.x - before.x) * clampedT;
    this.currentY = before.y + (after.y - before.y) * clampedT;
    this.currentZ = before.z + (after.z - before.z) * clampedT;
    this.currentYaw = this.lerpAngle(before.yaw, after.yaw, clampedT);
  }

  /**
   * Get current interpolated transform for rendering (includes wander offset)
   */
  getInterpolated(): InterpolatedTransform {
    return {
      x: this.currentX + this.wanderOffsetX,
      y: this.currentY + this.wanderOffsetY,
      z: this.currentZ,
      yaw: this.currentYaw,
    };
  }

  /**
   * Apply a wander offset (purely visual, doesn't affect server state)
   * The offset accumulates over time for smooth wandering
   */
  applyWanderOffset(dx: number, dy: number): void {
    this.wanderOffsetX += dx;
    this.wanderOffsetY += dy;
  }

  /**
   * Reset wander offset (call when NPC is reset or respawned)
   */
  resetWanderOffset(): void {
    this.wanderOffsetX = 0;
    this.wanderOffsetY = 0;
  }

  /**
   * Get last authoritative server state
   */
  getServerState(): InterpolatedTransform {
    return {
      x: this.lastServerX,
      y: this.lastServerY,
      z: this.lastServerZ,
      yaw: this.lastServerYaw,
    };
  }

  /**
   * Get last server tick
   */
  getLastTick(): number {
    return this.lastTick;
  }

  /**
   * Set transform directly (used for player/prediction)
   */
  setDirect(x: number, y: number, z: number, yaw: number): void {
    this.currentX = x;
    this.currentY = y;
    this.currentZ = z;
    this.currentYaw = yaw;
    this.lastServerX = x;
    this.lastServerY = y;
    this.lastServerZ = z;
    this.lastServerYaw = yaw;
  }

  /**
   * Clear all snapshots (used on entity respawn)
   */
  clear(): void {
    this.bufferHead = 0;
    this.bufferCount = 0;
    this.lastTick = 0;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private findSnapshotsForTime(
    targetTime: number
  ): [TransformSnapshot | null, TransformSnapshot | null] {
    if (this.bufferCount === 0) {
      return [null, null];
    }

    let before: TransformSnapshot | null = null;
    let after: TransformSnapshot | null = null;

    // Search through valid snapshots
    for (let i = 0; i < this.bufferCount; i++) {
      const idx = (this.bufferHead - 1 - i + RING_BUFFER_SIZE) % RING_BUFFER_SIZE;
      const snapshot = this.snapshots[idx];

      if (snapshot.timestamp <= targetTime) {
        if (!before || snapshot.timestamp > before.timestamp) {
          before = snapshot;
        }
      } else {
        if (!after || snapshot.timestamp < after.timestamp) {
          after = snapshot;
        }
      }
    }

    return [before, after];
  }

  private lerpAngle(a: number, b: number, t: number): number {
    // Handle angle wraparound
    let diff = b - a;

    // Normalize to [-PI, PI]
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    return a + diff * t;
  }
}
