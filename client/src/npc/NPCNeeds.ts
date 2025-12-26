/**
 * NPCNeeds - Tracks NPC needs/drives that influence goal selection
 * Similar to Sims-style need system
 */

export interface NPCNeeds {
  /** Energy level (0-100), 0 = exhausted */
  energy: number;
  /** Hunger level (0-100), 0 = starving */
  hunger: number;
  /** Social need (0-100), 0 = lonely */
  social: number;
  /** Comfort level (0-100), 0 = uncomfortable */
  comfort: number;
  /** Fun/entertainment (0-100), 0 = bored */
  fun: number;
  /** Hygiene (0-100), 0 = dirty */
  hygiene: number;
  /** Health (0-100), 0 = near death */
  health: number;
  /** Safety feeling (0-100), 0 = terrified */
  safety: number;
}

export interface NeedDecayRates {
  energy: number;
  hunger: number;
  social: number;
  comfort: number;
  fun: number;
  hygiene: number;
  health: number;
  safety: number;
}

export interface NeedThresholds {
  critical: number;
  low: number;
  satisfied: number;
}

const DEFAULT_NEEDS: NPCNeeds = {
  energy: 80,
  hunger: 80,
  social: 60,
  comfort: 70,
  fun: 60,
  hygiene: 80,
  health: 100,
  safety: 80,
};

const DEFAULT_DECAY_RATES: NeedDecayRates = {
  energy: 0.008, // per second
  hunger: 0.005,
  social: 0.003,
  comfort: 0.002,
  fun: 0.004,
  hygiene: 0.001,
  health: 0, // Only decays from damage/sickness
  safety: 0, // Contextual, doesn't decay
};

const DEFAULT_THRESHOLDS: NeedThresholds = {
  critical: 15,
  low: 35,
  satisfied: 70,
};

export class NPCNeedsManager {
  private needs: NPCNeeds;
  private decayRates: NeedDecayRates;
  private thresholds: NeedThresholds;
  private isSleeping: boolean = false;
  private isEating: boolean = false;
  private isSocializing: boolean = false;
  private isInShelter: boolean = false;

  constructor(
    initialNeeds: Partial<NPCNeeds> = {},
    decayRates: Partial<NeedDecayRates> = {},
    thresholds: Partial<NeedThresholds> = {}
  ) {
    this.needs = { ...DEFAULT_NEEDS, ...initialNeeds };
    this.decayRates = { ...DEFAULT_DECAY_RATES, ...decayRates };
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  /**
   * Update needs over time
   */
  update(deltaMs: number): void {
    const deltaS = deltaMs / 1000;

    // Apply decay
    if (!this.isSleeping) {
      this.needs.energy = Math.max(0, this.needs.energy - this.decayRates.energy * deltaS);
    } else {
      // Sleeping restores energy
      this.needs.energy = Math.min(100, this.needs.energy + 0.05 * deltaS);
    }

    if (!this.isEating) {
      this.needs.hunger = Math.max(0, this.needs.hunger - this.decayRates.hunger * deltaS);
    }

    if (!this.isSocializing) {
      this.needs.social = Math.max(0, this.needs.social - this.decayRates.social * deltaS);
    }

    this.needs.comfort = Math.max(0, this.needs.comfort - this.decayRates.comfort * deltaS);
    this.needs.fun = Math.max(0, this.needs.fun - this.decayRates.fun * deltaS);
    this.needs.hygiene = Math.max(0, this.needs.hygiene - this.decayRates.hygiene * deltaS);

    // Safety is contextual
    if (this.isInShelter) {
      this.needs.safety = Math.min(100, this.needs.safety + 0.1 * deltaS);
    }
  }

  /**
   * Get current needs snapshot
   */
  getNeeds(): NPCNeeds {
    return { ...this.needs };
  }

  /**
   * Set a specific need value
   */
  setNeed(need: keyof NPCNeeds, value: number): void {
    this.needs[need] = Math.max(0, Math.min(100, value));
  }

  /**
   * Modify a need by delta
   */
  modifyNeed(need: keyof NPCNeeds, delta: number): void {
    this.needs[need] = Math.max(0, Math.min(100, this.needs[need] + delta));
  }

  /**
   * Check if a need is critical
   */
  isCritical(need: keyof NPCNeeds): boolean {
    return this.needs[need] <= this.thresholds.critical;
  }

  /**
   * Check if a need is low
   */
  isLow(need: keyof NPCNeeds): boolean {
    return this.needs[need] <= this.thresholds.low;
  }

  /**
   * Check if a need is satisfied
   */
  isSatisfied(need: keyof NPCNeeds): boolean {
    return this.needs[need] >= this.thresholds.satisfied;
  }

  /**
   * Get the most critical need
   */
  getMostCriticalNeed(): keyof NPCNeeds | null {
    let lowest: keyof NPCNeeds | null = null;
    let lowestValue = 100;

    for (const [key, value] of Object.entries(this.needs)) {
      if (value < lowestValue) {
        lowestValue = value;
        lowest = key as keyof NPCNeeds;
      }
    }

    return lowestValue <= this.thresholds.low ? lowest : null;
  }

  /**
   * Get all critical needs
   */
  getCriticalNeeds(): (keyof NPCNeeds)[] {
    const critical: (keyof NPCNeeds)[] = [];
    for (const [key, value] of Object.entries(this.needs)) {
      if (value <= this.thresholds.critical) {
        critical.push(key as keyof NPCNeeds);
      }
    }
    return critical;
  }

  /**
   * Get urgency score (0-1) based on lowest needs
   */
  getUrgencyScore(): number {
    const lowestNeed = Math.min(...Object.values(this.needs));
    if (lowestNeed <= this.thresholds.critical) return 1;
    if (lowestNeed <= this.thresholds.low) return 0.7;
    if (lowestNeed <= this.thresholds.satisfied) return 0.3;
    return 0;
  }

  /**
   * Set activity states that affect need changes
   */
  setSleeping(sleeping: boolean): void {
    this.isSleeping = sleeping;
  }

  setEating(eating: boolean): void {
    this.isEating = eating;
    if (eating) {
      // Eating restores hunger
      this.modifyNeed('hunger', 30);
    }
  }

  setSocializing(socializing: boolean): void {
    this.isSocializing = socializing;
    if (socializing) {
      this.modifyNeed('social', 5);
    }
  }

  setInShelter(inShelter: boolean): void {
    this.isInShelter = inShelter;
    if (inShelter) {
      this.modifyNeed('comfort', 10);
    }
  }

  /**
   * Apply environmental effects
   */
  applyWeatherEffects(isOutdoors: boolean, temperature: number, weatherType: string): void {
    if (!isOutdoors) return;

    // Extreme temperatures affect comfort
    if (temperature < 5 || temperature > 35) {
      this.modifyNeed('comfort', -0.1);
    }

    // Bad weather affects safety feeling
    if (weatherType === 'stormy') {
      this.modifyNeed('safety', -0.2);
      this.modifyNeed('comfort', -0.15);
    } else if (weatherType === 'rainy') {
      this.modifyNeed('comfort', -0.05);
    }
  }

  /**
   * Serialize needs for persistence
   */
  serialize(): NPCNeeds {
    return { ...this.needs };
  }

  /**
   * Deserialize needs from persistence
   */
  deserialize(data: NPCNeeds): void {
    this.needs = { ...DEFAULT_NEEDS, ...data };
  }
}
