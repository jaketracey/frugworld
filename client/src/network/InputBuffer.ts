/**
 * Input buffer with sequence numbers for client-side prediction
 * Stores unacknowledged inputs for reconciliation after server ack
 */

import type { InputCommand } from '@/types/protocol.ts';

export interface BufferedInput {
  inputSeq: number;
  command: InputCommand;
  predictedState: PredictedState;
  timestamp: number;
}

export interface PredictedState {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const MAX_BUFFER_SIZE = 256; // About 4 seconds at 60Hz

export class InputBuffer {
  private buffer: BufferedInput[] = [];
  private nextSeq: number = 1;
  private lastAckedSeq: number = 0;

  /**
   * Get the next sequence number and increment
   */
  getNextSeq(): number {
    return this.nextSeq++;
  }

  /**
   * Get current sequence number without incrementing
   */
  getCurrentSeq(): number {
    return this.nextSeq;
  }

  /**
   * Add an input to the buffer
   */
  push(command: InputCommand, predictedState: PredictedState): void {
    const entry: BufferedInput = {
      inputSeq: command.inputSeq,
      command,
      predictedState,
      timestamp: performance.now(),
    };

    this.buffer.push(entry);

    // Prevent buffer from growing unbounded
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      // Drop oldest entries
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER_SIZE);
    }
  }

  /**
   * Acknowledge inputs up to and including the given sequence number
   * Returns the acknowledged inputs for potential replay
   */
  acknowledge(lastAckedSeq: number): BufferedInput[] {
    if (lastAckedSeq <= this.lastAckedSeq) {
      return [];
    }

    this.lastAckedSeq = lastAckedSeq;

    // Find and remove all acknowledged inputs
    const acked: BufferedInput[] = [];
    const remaining: BufferedInput[] = [];

    for (const entry of this.buffer) {
      if (entry.inputSeq <= lastAckedSeq) {
        acked.push(entry);
      } else {
        remaining.push(entry);
      }
    }

    this.buffer = remaining;
    return acked;
  }

  /**
   * Get all unacknowledged inputs for replay during reconciliation
   */
  getUnacknowledged(): BufferedInput[] {
    return [...this.buffer];
  }

  /**
   * Get the predicted state for a specific sequence number
   */
  getPredictedState(seq: number): PredictedState | null {
    const entry = this.buffer.find((e) => e.inputSeq === seq);
    return entry?.predictedState ?? null;
  }

  /**
   * Get the last predicted state
   */
  getLastPredictedState(): PredictedState | null {
    if (this.buffer.length === 0) {
      return null;
    }
    return this.buffer[this.buffer.length - 1].predictedState;
  }

  /**
   * Get the number of unacknowledged inputs
   */
  getPendingCount(): number {
    return this.buffer.length;
  }

  /**
   * Get the last acknowledged sequence number
   */
  getLastAckedSeq(): number {
    return this.lastAckedSeq;
  }

  /**
   * Calculate round-trip time based on acknowledged input
   */
  calculateRTT(ackedSeq: number, serverTimeMs: number): number | null {
    const entry = this.buffer.find((e) => e.inputSeq === ackedSeq);
    if (!entry) {
      return null;
    }
    return performance.now() - entry.timestamp;
  }

  /**
   * Clear all buffered inputs (used on disconnect/resync)
   */
  clear(): void {
    this.buffer = [];
    this.lastAckedSeq = 0;
    // Don't reset nextSeq to maintain monotonicity
  }

  /**
   * Get buffer statistics for debugging
   */
  getStats(): {
    pendingCount: number;
    lastAckedSeq: number;
    nextSeq: number;
    oldestPendingMs: number | null;
  } {
    const oldestPendingMs =
      this.buffer.length > 0
        ? performance.now() - this.buffer[0].timestamp
        : null;

    return {
      pendingCount: this.buffer.length,
      lastAckedSeq: this.lastAckedSeq,
      nextSeq: this.nextSeq,
      oldestPendingMs,
    };
  }
}
