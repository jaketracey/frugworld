/**
 * LOD component for tracking entity level-of-detail state
 * LOD affects rendering fidelity and update frequency (Section 4)
 *
 * Enhanced with crossfade transitions per Section 4.3 and Section 22
 */

import { LODTier } from '@/types/protocol.ts';

export interface LODConfig {
  lod0Distance: number; // 0-15m by default
  lod1Distance: number; // 15-60m by default
  lod2Distance: number; // 60-250m by default
}

export interface LODTransitionState {
  /** Current primary LOD tier */
  currentLOD: LODTier;
  /** Previous LOD tier (for crossfade) */
  previousLOD: LODTier;
  /** Transition progress 0-1 */
  transitionProgress: number;
  /** Alpha for current LOD mesh */
  currentAlpha: number;
  /** Alpha for previous LOD mesh (crossfade) */
  previousAlpha: number;
  /** Whether currently in transition */
  isTransitioning: boolean;
}

const DEFAULT_LOD_CONFIG: LODConfig = {
  lod0Distance: 15,
  lod1Distance: 60,
  lod2Distance: 250,
};

export class LODComponent {
  private currentLOD: LODTier = LODTier.LOD3_Offline;
  private previousLOD: LODTier = LODTier.LOD3_Offline;
  private lodTransitionTime: number = 0;
  private lodTransitionDuration: number = 500; // ms for visual transitions

  // Calculated from server or local computation
  private distanceToPlayer: number = Infinity;

  // Visual fade for LOD transitions
  private visualAlpha: number = 1.0;
  private targetAlpha: number = 1.0;

  // Crossfade state for smooth LOD mesh transitions
  private crossfadeProgress: number = 1.0; // 1.0 = fully transitioned
  private currentLODAlpha: number = 1.0;
  private previousLODAlpha: number = 0.0;

  constructor(private config: LODConfig = DEFAULT_LOD_CONFIG) {}

  /**
   * Get current LOD tier
   */
  getLOD(): LODTier {
    return this.currentLOD;
  }

  /**
   * Get previous LOD tier (for transition effects)
   */
  getPreviousLOD(): LODTier {
    return this.previousLOD;
  }

  /**
   * Set LOD from server (authoritative)
   */
  setLOD(lod: LODTier): void {
    if (lod !== this.currentLOD) {
      this.previousLOD = this.currentLOD;
      this.currentLOD = lod;
      this.lodTransitionTime = performance.now();

      // Set target alpha based on LOD
      this.targetAlpha = lod === LODTier.LOD3_Offline ? 0 : 1;

      // Initialize crossfade for smooth mesh transition
      // Previous LOD mesh starts visible, current LOD starts invisible
      if (this.previousLOD !== LODTier.LOD3_Offline) {
        this.crossfadeProgress = 0;
        this.previousLODAlpha = 1.0;
        this.currentLODAlpha = 0.0;
      } else {
        // Coming from offline, just fade in
        this.crossfadeProgress = 0;
        this.previousLODAlpha = 0;
        this.currentLODAlpha = 0;
      }
    }
  }

  /**
   * Compute LOD based on distance to player (client-side estimation)
   */
  computeLODFromDistance(distance: number): LODTier {
    this.distanceToPlayer = distance;

    if (distance <= this.config.lod0Distance) {
      return LODTier.LOD0_Interactive;
    } else if (distance <= this.config.lod1Distance) {
      return LODTier.LOD1_Nearby;
    } else if (distance <= this.config.lod2Distance) {
      return LODTier.LOD2_Far;
    } else {
      return LODTier.LOD3_Offline;
    }
  }

  /**
   * Get distance to player
   */
  getDistanceToPlayer(): number {
    return this.distanceToPlayer;
  }

  /**
   * Update LOD transition animations
   */
  update(deltaMs: number): void {
    // Smooth alpha transition
    const alphaSpeed = 3.0 * (deltaMs / 1000); // 3x per second
    if (this.visualAlpha < this.targetAlpha) {
      this.visualAlpha = Math.min(
        this.targetAlpha,
        this.visualAlpha + alphaSpeed
      );
    } else if (this.visualAlpha > this.targetAlpha) {
      this.visualAlpha = Math.max(
        this.targetAlpha,
        this.visualAlpha - alphaSpeed
      );
    }

    // Update crossfade progress for LOD mesh transitions
    if (this.crossfadeProgress < 1.0) {
      const crossfadeSpeed = (deltaMs / this.lodTransitionDuration);
      this.crossfadeProgress = Math.min(1.0, this.crossfadeProgress + crossfadeSpeed);

      // Smoothstep easing for smoother visual transition
      const t = this.smoothstep(this.crossfadeProgress);

      // Crossfade: previous fades out while current fades in
      this.previousLODAlpha = (1.0 - t) * this.visualAlpha;
      this.currentLODAlpha = t * this.visualAlpha;
    } else {
      // Transition complete
      this.currentLODAlpha = this.visualAlpha;
      this.previousLODAlpha = 0;
    }
  }

  /**
   * Smoothstep interpolation for natural-feeling transitions
   */
  private smoothstep(t: number): number {
    return t * t * (3 - 2 * t);
  }

  /**
   * Get visual alpha for rendering (handles fade in/out)
   */
  getVisualAlpha(): number {
    return this.visualAlpha;
  }

  /**
   * Check if currently transitioning between LODs
   */
  isTransitioning(): boolean {
    const elapsed = performance.now() - this.lodTransitionTime;
    return elapsed < this.lodTransitionDuration;
  }

  /**
   * Get transition progress (0-1)
   */
  getTransitionProgress(): number {
    const elapsed = performance.now() - this.lodTransitionTime;
    return Math.min(1, elapsed / this.lodTransitionDuration);
  }

  /**
   * Check if dialogue is allowed at current LOD
   */
  canDialogue(): boolean {
    return this.currentLOD === LODTier.LOD0_Interactive;
  }

  /**
   * Check if interaction is allowed at current LOD
   */
  canInteract(): boolean {
    return (
      this.currentLOD === LODTier.LOD0_Interactive ||
      this.currentLOD === LODTier.LOD1_Nearby
    );
  }

  /**
   * Get update frequency multiplier based on LOD
   * LOD0: every tick, LOD1: every 2 ticks, LOD2: every 10+ ticks
   */
  getUpdateFrequencyDivisor(): number {
    switch (this.currentLOD) {
      case LODTier.LOD0_Interactive:
        return 1;
      case LODTier.LOD1_Nearby:
        return 2;
      case LODTier.LOD2_Far:
        return 10;
      case LODTier.LOD3_Offline:
        return Infinity;
    }
  }

  /**
   * Get render detail level (0.0 to 1.0)
   */
  getRenderDetailLevel(): number {
    switch (this.currentLOD) {
      case LODTier.LOD0_Interactive:
        return 1.0;
      case LODTier.LOD1_Nearby:
        return 0.6;
      case LODTier.LOD2_Far:
        return 0.2;
      case LODTier.LOD3_Offline:
        return 0.0;
    }
  }

  /**
   * Get full LOD transition state for renderer
   * Used for crossfade effects between LOD meshes
   */
  getTransitionState(): LODTransitionState {
    return {
      currentLOD: this.currentLOD,
      previousLOD: this.previousLOD,
      transitionProgress: this.crossfadeProgress,
      currentAlpha: this.currentLODAlpha,
      previousAlpha: this.previousLODAlpha,
      isTransitioning: this.crossfadeProgress < 1.0,
    };
  }

  /**
   * Get current LOD mesh alpha (for crossfade)
   */
  getCurrentLODAlpha(): number {
    return this.currentLODAlpha;
  }

  /**
   * Get previous LOD mesh alpha (for crossfade)
   */
  getPreviousLODAlpha(): number {
    return this.previousLODAlpha;
  }

  /**
   * Set transition duration
   */
  setTransitionDuration(ms: number): void {
    this.lodTransitionDuration = ms;
  }
}
