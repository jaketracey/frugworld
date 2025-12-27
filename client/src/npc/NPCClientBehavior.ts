/**
 * NPCClientBehavior - Client-side NPC wandering and thought bubbles
 * Handles visual wandering behavior and NPC reactions to the player
 */

export interface NPCWanderState {
  isWandering: boolean;
  isEngaged: boolean; // Stopped to interact with player
  wanderTarget: { x: number; y: number } | null;
  wanderTimer: number;
  idleTimer: number;
  thoughtTimer: number;
  currentThought: string | null;
  thoughtVisible: boolean;
}

export interface NPCClientBehaviorConfig {
  wanderRadius: number; // How far NPCs wander from their spawn point
  wanderSpeed: number; // Movement speed while wandering
  minWanderInterval: number; // Min time between wander movements (ms)
  maxWanderInterval: number; // Max time between wander movements (ms)
  minIdleTime: number; // Min time to stand still (ms)
  maxIdleTime: number; // Max time to stand still (ms)
  thoughtInterval: number; // Time between thoughts (ms)
  thoughtDuration: number; // How long thought is visible (ms)
  engageDistance: number; // Distance at which NPC notices player
  engageStopDistance: number; // Distance at which NPC stops to engage
}

const DEFAULT_CONFIG: NPCClientBehaviorConfig = {
  wanderRadius: 8,
  wanderSpeed: 1.2,
  minWanderInterval: 3000,
  maxWanderInterval: 8000,
  minIdleTime: 2000,
  maxIdleTime: 5000,
  thoughtInterval: 12000,
  thoughtDuration: 4000,
  engageDistance: 15,
  engageStopDistance: 4,
};

// Thoughts NPCs have about Frug based on distance and context
const DISTANT_THOUGHTS = [
  "What's that green thing over there?",
  "Is that... a rolling ball?",
  "Something's moving in the distance...",
  "Hmm, what's that?",
  "I see something green...",
];

const APPROACHING_THOUGHTS = [
  "Oh! It's coming this way!",
  "That ball is getting closer...",
  "Is it friendly?",
  "What a curious creature!",
  "It's rolling towards me!",
];

const NEARBY_THOUGHTS = [
  "Hello there, little one!",
  "What a cute rolling ball!",
  "Nice to meet you!",
  "You seem friendly!",
  "What brings you here?",
];

const IDLE_THOUGHTS = [
  "What a nice day...",
  "I should get moving...",
  "Wonder what's for dinner...",
  "La la la...",
  "Hmm...",
  "*yawn*",
  "Nice weather today!",
];

export class NPCClientBehavior {
  private config: NPCClientBehaviorConfig;
  private states: Map<number, NPCWanderState> = new Map();
  private spawnPoints: Map<number, { x: number; y: number }> = new Map();
  private npcNames: Map<number, string> = new Map();

  // Callbacks
  private onThoughtChanged: ((npcId: number, thought: string | null) => void) | null = null;

  constructor(config: Partial<NPCClientBehaviorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register an NPC for wandering behavior
   */
  registerNpc(npcId: number, x: number, y: number, name: string): void {
    this.spawnPoints.set(npcId, { x, y });
    this.npcNames.set(npcId, name);
    this.states.set(npcId, {
      isWandering: false,
      isEngaged: false,
      wanderTarget: null,
      wanderTimer: this.randomInterval(this.config.minWanderInterval, this.config.maxWanderInterval),
      idleTimer: 0,
      thoughtTimer: this.randomInterval(5000, this.config.thoughtInterval),
      currentThought: null,
      thoughtVisible: false,
    });
  }

  /**
   * Unregister an NPC
   */
  unregisterNpc(npcId: number): void {
    this.states.delete(npcId);
    this.spawnPoints.delete(npcId);
    this.npcNames.delete(npcId);
  }

  /**
   * Set callback for thought changes
   */
  setOnThoughtChanged(callback: (npcId: number, thought: string | null) => void): void {
    this.onThoughtChanged = callback;
  }

  /**
   * Stop an NPC (when clicked for dialogue)
   */
  engageNpc(npcId: number): void {
    const state = this.states.get(npcId);
    if (state) {
      state.isEngaged = true;
      state.isWandering = false;
      state.wanderTarget = null;
    }
  }

  /**
   * Resume NPC wandering (when dialogue ends)
   */
  disengageNpc(npcId: number): void {
    const state = this.states.get(npcId);
    if (state) {
      state.isEngaged = false;
      state.idleTimer = this.randomInterval(this.config.minIdleTime, this.config.maxIdleTime);
    }
  }

  /**
   * React to a yell - NPC stops briefly and looks toward the source
   */
  onYellHeard(npcId: number, yellX: number, yellY: number): void {
    const state = this.states.get(npcId);
    if (!state) return;

    // Stop current movement
    state.isWandering = false;
    state.wanderTarget = null;

    // Set a brief idle timer (1-2 seconds) before resuming
    state.idleTimer = this.randomInterval(1000, 2000);

    // Note: The actual look-at behavior would be handled by the renderer
    // based on the yell position. We just signal the pause here.
  }

  /**
   * Update all NPC behaviors
   * @param deltaMs Time since last update
   * @param npcPositions Map of NPC positions
   * @param playerPosition Player position
   * @param npcLods Optional map of NPC LOD tiers (0-3). Thoughts only generated for LOD 0/1.
   */
  update(
    deltaMs: number,
    npcPositions: Map<number, { x: number; y: number; z: number }>,
    playerPosition: { x: number; y: number; z: number },
    npcLods?: Map<number, number>
  ): Map<number, { dx: number; dy: number }> {
    const movements = new Map<number, { dx: number; dy: number }>();

    for (const [npcId, state] of this.states) {
      const pos = npcPositions.get(npcId);
      if (!pos) continue;

      const spawn = this.spawnPoints.get(npcId);
      if (!spawn) continue;

      // Get LOD tier (default to LOD0 if not provided)
      const lodTier = npcLods?.get(npcId) ?? 0;
      // Only generate thoughts for LOD 0 and 1 (interactive and nearby)
      const allowThoughts = lodTier <= 1;

      // Calculate distance to player
      const dx = playerPosition.x - pos.x;
      const dy = playerPosition.y - pos.y;
      const distanceToPlayer = Math.sqrt(dx * dx + dy * dy);

      // Check if player is close enough to engage
      if (!state.isEngaged && distanceToPlayer < this.config.engageStopDistance) {
        // Stop and face player
        state.isWandering = false;
        state.wanderTarget = null;
        movements.set(npcId, { dx: 0, dy: 0 });

        // Trigger a nearby thought (only if LOD allows)
        if (allowThoughts && !state.thoughtVisible && state.thoughtTimer <= 0) {
          this.triggerThought(npcId, state, 'nearby');
        }
      } else if (state.isEngaged) {
        // NPC is engaged in dialogue, don't move
        movements.set(npcId, { dx: 0, dy: 0 });
      } else {
        // Normal wandering behavior
        const movement = this.updateWandering(npcId, state, pos, spawn, deltaMs, distanceToPlayer);
        movements.set(npcId, movement);
      }

      // Update thought timer (only if LOD allows thoughts)
      if (allowThoughts) {
        this.updateThoughts(npcId, state, deltaMs, distanceToPlayer);
      } else {
        // Clear any visible thought for far NPCs
        if (state.thoughtVisible) {
          state.thoughtVisible = false;
          state.currentThought = null;
          this.onThoughtChanged?.(npcId, null);
        }
      }
    }

    return movements;
  }

  /**
   * Get current state for an NPC
   */
  getState(npcId: number): NPCWanderState | undefined {
    return this.states.get(npcId);
  }

  /**
   * Get current thought for an NPC
   */
  getThought(npcId: number): string | null {
    const state = this.states.get(npcId);
    return state?.thoughtVisible ? state.currentThought : null;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private updateWandering(
    npcId: number,
    state: NPCWanderState,
    pos: { x: number; y: number },
    spawn: { x: number; y: number },
    deltaMs: number,
    distanceToPlayer: number
  ): { dx: number; dy: number } {
    // If currently wandering to a target
    if (state.wanderTarget) {
      const dx = state.wanderTarget.x - pos.x;
      const dy = state.wanderTarget.y - pos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 0.3) {
        // Reached target, start idle timer
        state.wanderTarget = null;
        state.isWandering = false;
        state.idleTimer = this.randomInterval(this.config.minIdleTime, this.config.maxIdleTime);
        return { dx: 0, dy: 0 };
      }

      // Move towards target
      const moveSpeed = this.config.wanderSpeed * (deltaMs / 1000);
      const moveAmount = Math.min(distance, moveSpeed);
      return {
        dx: (dx / distance) * moveAmount,
        dy: (dy / distance) * moveAmount,
      };
    }

    // Idle - waiting to wander again
    if (state.idleTimer > 0) {
      state.idleTimer -= deltaMs;
      return { dx: 0, dy: 0 };
    }

    // Time to pick a new wander target
    state.wanderTimer -= deltaMs;
    if (state.wanderTimer <= 0) {
      // Pick random point within wander radius of spawn
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * this.config.wanderRadius;
      state.wanderTarget = {
        x: spawn.x + Math.cos(angle) * distance,
        y: spawn.y + Math.sin(angle) * distance,
      };
      state.isWandering = true;
      state.wanderTimer = this.randomInterval(this.config.minWanderInterval, this.config.maxWanderInterval);
    }

    return { dx: 0, dy: 0 };
  }

  private updateThoughts(
    npcId: number,
    state: NPCWanderState,
    deltaMs: number,
    distanceToPlayer: number
  ): void {
    // Hide thought after duration
    if (state.thoughtVisible) {
      state.thoughtTimer -= deltaMs;
      if (state.thoughtTimer <= 0) {
        state.thoughtVisible = false;
        state.currentThought = null;
        state.thoughtTimer = this.randomInterval(8000, this.config.thoughtInterval);
        this.onThoughtChanged?.(npcId, null);
      }
      return;
    }

    // Countdown to next thought
    state.thoughtTimer -= deltaMs;
    if (state.thoughtTimer <= 0) {
      // Determine thought type based on player distance
      let thoughtType: 'distant' | 'approaching' | 'nearby' | 'idle';
      if (distanceToPlayer < this.config.engageStopDistance) {
        thoughtType = 'nearby';
      } else if (distanceToPlayer < this.config.engageDistance) {
        thoughtType = 'approaching';
      } else if (distanceToPlayer < this.config.engageDistance * 2) {
        thoughtType = 'distant';
      } else {
        thoughtType = 'idle';
      }

      this.triggerThought(npcId, state, thoughtType);
    }
  }

  private triggerThought(
    npcId: number,
    state: NPCWanderState,
    type: 'distant' | 'approaching' | 'nearby' | 'idle'
  ): void {
    let thoughts: string[];
    switch (type) {
      case 'distant':
        thoughts = DISTANT_THOUGHTS;
        break;
      case 'approaching':
        thoughts = APPROACHING_THOUGHTS;
        break;
      case 'nearby':
        thoughts = NEARBY_THOUGHTS;
        break;
      default:
        thoughts = IDLE_THOUGHTS;
    }

    state.currentThought = thoughts[Math.floor(Math.random() * thoughts.length)] ?? null;
    state.thoughtVisible = true;
    state.thoughtTimer = this.config.thoughtDuration;
    this.onThoughtChanged?.(npcId, state.currentThought);
  }

  private randomInterval(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }
}
