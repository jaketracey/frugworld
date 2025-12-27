/**
 * FrugState - Comprehensive state management for the player character Frug
 * Tracks mood, physical attributes, emotional states, and environmental awareness
 */

/** Primary mood states that affect visual appearance */
export type MoodType =
  | 'ecstatic'    // Very happy, bouncing
  | 'happy'       // Content and cheerful
  | 'content'     // Neutral, at peace
  | 'tired'       // Sleepy, droopy eyes
  | 'hungry'      // Craving food
  | 'anxious'     // Nervous, wide eyes
  | 'sad'         // Down, frowning
  | 'sick'        // Unwell, green tinge
  | 'excited'     // Hyper, sparkly eyes
  | 'curious'     // Inquisitive, raised brow
  | 'scared'      // Frightened, shaking
  | 'angry'       // Frustrated, furrowed brow
  | 'sleepy'      // Very tired, half-closed eyes
  | 'loved';      // Feeling affection, heart eyes

/** Weather preferences */
export type WeatherPreference = 'sunny' | 'cloudy' | 'rainy' | 'any';

/** Temperature comfort zones */
export type TemperatureComfort = 'cold' | 'cool' | 'comfortable' | 'warm' | 'hot';

/** Activity states */
export type ActivityState =
  | 'idle'
  | 'walking'
  | 'running'
  | 'talking'
  | 'resting'
  | 'eating'
  | 'exploring'
  | 'playing';

/** Physical stats (0-100 scale) */
export interface PhysicalStats {
  health: number;
  maxHealth: number;
  energy: number;
  maxEnergy: number;
  hunger: number;       // 0 = starving, 100 = full
  thirst: number;       // 0 = dehydrated, 100 = hydrated
  fatigue: number;      // 0 = exhausted, 100 = well-rested
  cleanliness: number;  // 0 = dirty, 100 = clean
}

/** Emotional/mental stats (0-100 scale) */
export interface EmotionalStats {
  happiness: number;    // Overall happiness level
  stress: number;       // 0 = calm, 100 = stressed
  comfort: number;      // Physical/environmental comfort
  excitement: number;   // Current excitement level
  curiosity: number;    // Desire to explore
  confidence: number;   // Self-assurance
}

/** Social stats (0-100 scale) */
export interface SocialStats {
  loneliness: number;       // 0 = socially fulfilled, 100 = lonely
  friendshipLevel: number;  // Overall friendship with NPCs
  reputation: number;       // Standing in the world
  charisma: number;         // Social influence
  lastSocialInteraction: number; // Timestamp
}

/** Environmental awareness */
export interface EnvironmentAwareness {
  currentBiome: string;
  temperatureComfort: TemperatureComfort;
  weatherPreference: WeatherPreference;
  currentWeather: string;
  isIndoors: boolean;
  lightLevel: number;     // 0 = dark, 100 = bright
  noiseLevel: number;     // 0 = quiet, 100 = loud
}

/** Recent memories/experiences that affect mood */
export interface RecentExperience {
  type: 'positive' | 'negative' | 'neutral';
  description: string;
  intensity: number;    // 1-10 scale
  timestamp: number;
  decayRate: number;    // How fast the memory fades (per second)
}

/** Personality traits (permanent characteristics) */
export interface PersonalityTraits {
  introversion: number;     // 0 = extrovert, 100 = introvert
  optimism: number;         // 0 = pessimist, 100 = optimist
  adventurousness: number;  // 0 = cautious, 100 = adventurous
  empathy: number;          // 0 = detached, 100 = empathetic
  patience: number;         // 0 = impatient, 100 = patient
  creativity: number;       // 0 = practical, 100 = creative
}

/** Complete Frug state */
export interface FrugState {
  // Identity
  name: string;
  age: number;              // In-game days old

  // Current state
  mood: MoodType;
  activity: ActivityState;

  // Stats categories
  physical: PhysicalStats;
  emotional: EmotionalStats;
  social: SocialStats;
  environment: EnvironmentAwareness;

  // Personality (relatively static)
  personality: PersonalityTraits;

  // Dynamic experiences
  recentExperiences: RecentExperience[];

  // Timestamps
  lastUpdated: number;
  createdAt: number;

  // Misc tracking
  totalDistanceTraveled: number;
  totalNpcInteractions: number;
  totalItemsCollected: number;
  favoriteBiome: string;
  favoriteNpc: string;
}

/** Default state for a new Frug */
export const DEFAULT_FRUG_STATE: FrugState = {
  name: 'Frug',
  age: 0,

  mood: 'content',
  activity: 'idle',

  physical: {
    health: 100,
    maxHealth: 100,
    energy: 100,
    maxEnergy: 100,
    hunger: 75,
    thirst: 80,
    fatigue: 90,
    cleanliness: 85,
  },

  emotional: {
    happiness: 70,
    stress: 15,
    comfort: 75,
    excitement: 40,
    curiosity: 60,
    confidence: 65,
  },

  social: {
    loneliness: 30,
    friendshipLevel: 20,
    reputation: 50,
    charisma: 50,
    lastSocialInteraction: Date.now(),
  },

  environment: {
    currentBiome: 'plains',
    temperatureComfort: 'comfortable',
    weatherPreference: 'sunny',
    currentWeather: 'clear',
    isIndoors: false,
    lightLevel: 80,
    noiseLevel: 20,
  },

  personality: {
    introversion: 40,
    optimism: 70,
    adventurousness: 65,
    empathy: 75,
    patience: 55,
    creativity: 60,
  },

  recentExperiences: [],

  lastUpdated: Date.now(),
  createdAt: Date.now(),

  totalDistanceTraveled: 0,
  totalNpcInteractions: 0,
  totalItemsCollected: 0,
  favoriteBiome: 'plains',
  favoriteNpc: '',
};

/** Get emoji representation of mood */
export function getMoodEmoji(mood: MoodType): string {
  const moodEmojis: Record<MoodType, string> = {
    ecstatic: '🤩',
    happy: '😊',
    content: '😌',
    tired: '😴',
    hungry: '🤤',
    anxious: '😰',
    sad: '😢',
    sick: '🤢',
    excited: '😆',
    curious: '🤔',
    scared: '😨',
    angry: '😤',
    sleepy: '😪',
    loved: '🥰',
  };
  return moodEmojis[mood] || '😐';
}

/** Get mood display name */
export function getMoodDisplayName(mood: MoodType): string {
  const moodNames: Record<MoodType, string> = {
    ecstatic: 'Ecstatic',
    happy: 'Happy',
    content: 'Content',
    tired: 'Tired',
    hungry: 'Hungry',
    anxious: 'Anxious',
    sad: 'Sad',
    sick: 'Sick',
    excited: 'Excited',
    curious: 'Curious',
    scared: 'Scared',
    angry: 'Angry',
    sleepy: 'Sleepy',
    loved: 'Loved',
  };
  return moodNames[mood] || 'Unknown';
}

/** Get mood color for visual indicators */
export function getMoodColor(mood: MoodType): string {
  const moodColors: Record<MoodType, string> = {
    ecstatic: '#fbbf24',    // Gold
    happy: '#4ade80',       // Green
    content: '#60a5fa',     // Blue
    tired: '#94a3b8',       // Gray
    hungry: '#fb923c',      // Orange
    anxious: '#c084fc',     // Purple
    sad: '#60a5fa',         // Light blue
    sick: '#84cc16',        // Lime (sickly)
    excited: '#f472b6',     // Pink
    curious: '#a78bfa',     // Violet
    scared: '#fbbf24',      // Yellow
    angry: '#ef4444',       // Red
    sleepy: '#6366f1',      // Indigo
    loved: '#ec4899',       // Pink
  };
  return moodColors[mood] || '#94a3b8';
}

/** Calculate overall mood from stats */
export function calculateMood(state: FrugState): MoodType {
  const { physical, emotional, social } = state;

  // Check critical physical states first
  if (physical.health < 30) return 'sick';
  if (physical.hunger < 20) return 'hungry';
  if (physical.fatigue < 20) return 'sleepy';
  if (physical.energy < 20) return 'tired';

  // Check emotional states
  if (emotional.stress > 80) return 'anxious';
  if (emotional.excitement > 80) return 'excited';
  if (emotional.curiosity > 80) return 'curious';

  // Check social states
  if (social.loneliness > 80) return 'sad';

  // Calculate overall happiness score
  const happinessScore = (
    emotional.happiness * 0.3 +
    emotional.comfort * 0.2 +
    (100 - emotional.stress) * 0.2 +
    physical.health * 0.15 +
    (100 - social.loneliness) * 0.15
  );

  if (happinessScore > 85) return 'ecstatic';
  if (happinessScore > 70) return 'happy';
  if (happinessScore > 50) return 'content';
  if (happinessScore > 30) return 'tired';
  return 'sad';
}

/** Get stat bar color based on value */
export function getStatColor(value: number): string {
  if (value >= 70) return '#4ade80';      // Green - good
  if (value >= 40) return '#fbbf24';      // Yellow - okay
  if (value >= 20) return '#fb923c';      // Orange - warning
  return '#ef4444';                        // Red - critical
}

/** Get stat icon */
export function getStatIcon(statName: string): string {
  const icons: Record<string, string> = {
    health: '❤️',
    energy: '⚡',
    hunger: '🍖',
    thirst: '💧',
    fatigue: '😴',
    cleanliness: '✨',
    happiness: '😊',
    stress: '😰',
    comfort: '🛋️',
    excitement: '🎉',
    curiosity: '🔍',
    confidence: '💪',
    loneliness: '💔',
    friendshipLevel: '🤝',
    reputation: '⭐',
    charisma: '✨',
  };
  return icons[statName] || '📊';
}

/** Stat impact types matching server FrugStatEvent */
export enum FrugStatEvent {
  AteFood = 200,
  DrankWater = 201,
  Rested = 202,
  TookDamage = 203,
  Healed = 204,
  SocialInteraction = 205,
  Discovery = 206,
  WeatherImpact = 207,
  StatDecay = 208,
  Restored = 209,
  MoodChanged = 210,
}

/** Target stat indices for Restored event */
export enum TargetStat {
  Health = 0,
  Energy = 1,
  Hunger = 2,
  Thirst = 3,
  Fatigue = 4,
  Cleanliness = 5,
  Happiness = 6,
}

/** Activity state as u8 matching server */
export enum ActivityStateCode {
  Idle = 0,
  Walking = 1,
  Running = 2,
  Talking = 3,
  Resting = 4,
  Eating = 5,
  Exploring = 6,
  Playing = 7,
}

/**
 * FrugStateManager - Manages the state of the player character
 * Now with server synchronization support
 */
export class FrugStateManager {
  private state: FrugState;
  private listeners: Set<(state: FrugState) => void> = new Set();
  private updateInterval: number | null = null;
  private serverSyncInterval: number | null = null;
  private dbConnection: unknown = null; // SpacetimeDB connection
  private playerId: bigint | null = null;
  private lastSyncTime: number = 0;
  private pendingSync: boolean = false;

  // Server sync settings
  private static readonly SYNC_INTERVAL_MS = 5000; // Sync every 5 seconds
  private static readonly MIN_SYNC_INTERVAL_MS = 1000; // Don't sync more than once per second

  constructor(initialState?: Partial<FrugState>) {
    this.state = { ...DEFAULT_FRUG_STATE, ...initialState };
  }

  /** Set the SpacetimeDB connection for server sync */
  setConnection(connection: unknown, playerId: bigint): void {
    this.dbConnection = connection;
    this.playerId = playerId;
    this.startServerSync();
  }

  /** Clear the connection */
  clearConnection(): void {
    this.stopServerSync();
    this.dbConnection = null;
    this.playerId = null;
  }

  /** Start periodic server sync */
  startServerSync(): void {
    if (this.serverSyncInterval) return;

    // Immediate sync on connect
    this.syncToServer();

    // Periodic sync
    this.serverSyncInterval = window.setInterval(() => {
      this.syncToServer();
    }, FrugStateManager.SYNC_INTERVAL_MS);
  }

  /** Stop periodic server sync */
  stopServerSync(): void {
    if (this.serverSyncInterval) {
      clearInterval(this.serverSyncInterval);
      this.serverSyncInterval = null;
    }
  }

  /** Sync current state to server */
  async syncToServer(): Promise<void> {
    if (!this.dbConnection || !this.playerId) return;

    // Throttle syncs
    const now = Date.now();
    if (now - this.lastSyncTime < FrugStateManager.MIN_SYNC_INTERVAL_MS) {
      this.pendingSync = true;
      return;
    }

    this.lastSyncTime = now;
    this.pendingSync = false;

    try {
      const conn = this.dbConnection as {
        reducers?: {
          saveFrugState?: (
            health: number, energy: number, hunger: number, thirst: number,
            fatigue: number, cleanliness: number, happiness: number, stress: number,
            comfort: number, excitement: number, curiosity: number, confidence: number,
            loneliness: number, friendshipLevel: number, reputation: number, charisma: number,
            activity: number, currentBiome: number, totalDistanceMm: bigint,
            totalNpcInteractions: number, totalItemsCollected: number
          ) => void;
        };
      };

      if (conn.reducers?.saveFrugState) {
        const { physical, emotional, social } = this.state;
        const activityCode = this.activityToCode(this.state.activity);
        const biomeCode = 0; // TODO: Map biome string to code

        conn.reducers.saveFrugState(
          physical.health,
          physical.energy,
          physical.hunger,
          physical.thirst,
          physical.fatigue,
          physical.cleanliness,
          emotional.happiness,
          emotional.stress,
          emotional.comfort,
          emotional.excitement,
          emotional.curiosity,
          emotional.confidence,
          social.loneliness,
          social.friendshipLevel,
          social.reputation,
          social.charisma,
          activityCode,
          biomeCode,
          BigInt(Math.floor(this.state.totalDistanceTraveled * 1000)), // meters to mm
          this.state.totalNpcInteractions,
          this.state.totalItemsCollected
        );
      }
    } catch (e) {
      console.error('Failed to sync Frug state to server:', e);
    }
  }

  /** Apply a stat impact through the server */
  async applyImpact(impactType: FrugStatEvent, amount: number, targetStat: TargetStat = TargetStat.Health): Promise<void> {
    if (!this.dbConnection) {
      // Fallback to local-only update
      this.applyLocalImpact(impactType, amount, targetStat);
      return;
    }

    try {
      const conn = this.dbConnection as {
        reducers?: {
          applyFrugImpact?: (impactType: number, amount: number, targetStat: number) => void;
        };
      };

      if (conn.reducers?.applyFrugImpact) {
        conn.reducers.applyFrugImpact(impactType, amount, targetStat);
      }

      // Also apply locally for immediate feedback
      this.applyLocalImpact(impactType, amount, targetStat);
    } catch (e) {
      console.error('Failed to apply impact via server:', e);
      this.applyLocalImpact(impactType, amount, targetStat);
    }
  }

  /** Apply impact locally (for immediate feedback) */
  private applyLocalImpact(impactType: FrugStatEvent, amount: number, targetStat: TargetStat): void {
    const { physical, emotional, social } = this.state;

    switch (impactType) {
      case FrugStatEvent.AteFood:
        physical.hunger = Math.min(100, physical.hunger + amount);
        emotional.happiness = Math.min(100, emotional.happiness + amount / 4);
        emotional.comfort = Math.min(100, emotional.comfort + amount / 6);
        break;

      case FrugStatEvent.DrankWater:
        physical.thirst = Math.min(100, physical.thirst + amount);
        break;

      case FrugStatEvent.Rested:
        physical.fatigue = Math.min(100, physical.fatigue + amount);
        physical.energy = Math.min(physical.maxEnergy, physical.energy + amount / 2);
        emotional.stress = Math.max(0, emotional.stress - amount / 3);
        break;

      case FrugStatEvent.TookDamage:
        physical.health = Math.max(0, physical.health - amount);
        emotional.stress = Math.min(100, emotional.stress + amount / 2);
        emotional.happiness = Math.max(0, emotional.happiness - amount / 3);
        break;

      case FrugStatEvent.Healed:
        physical.health = Math.min(physical.maxHealth, physical.health + amount);
        emotional.comfort = Math.min(100, emotional.comfort + amount / 4);
        break;

      case FrugStatEvent.SocialInteraction:
        social.loneliness = Math.max(0, social.loneliness - amount);
        emotional.happiness = Math.min(100, emotional.happiness + amount / 3);
        social.friendshipLevel = Math.min(100, social.friendshipLevel + 1);
        social.lastSocialInteraction = Date.now();
        this.state.totalNpcInteractions++;
        break;

      case FrugStatEvent.Discovery:
        emotional.curiosity = Math.min(100, emotional.curiosity + amount / 2);
        emotional.excitement = Math.min(100, emotional.excitement + amount);
        emotional.happiness = Math.min(100, emotional.happiness + amount / 4);
        break;

      case FrugStatEvent.Restored:
        switch (targetStat) {
          case TargetStat.Health:
            physical.health = Math.min(physical.maxHealth, physical.health + amount);
            break;
          case TargetStat.Energy:
            physical.energy = Math.min(physical.maxEnergy, physical.energy + amount);
            break;
          case TargetStat.Hunger:
            physical.hunger = Math.min(100, physical.hunger + amount);
            break;
          case TargetStat.Thirst:
            physical.thirst = Math.min(100, physical.thirst + amount);
            break;
          case TargetStat.Fatigue:
            physical.fatigue = Math.min(100, physical.fatigue + amount);
            break;
          case TargetStat.Cleanliness:
            physical.cleanliness = Math.min(100, physical.cleanliness + amount);
            break;
          case TargetStat.Happiness:
            emotional.happiness = Math.min(100, emotional.happiness + amount);
            break;
        }
        break;
    }

    this.state.mood = calculateMood(this.state);
    this.state.lastUpdated = Date.now();
    this.notify();
  }

  /** Convert activity string to code */
  private activityToCode(activity: ActivityState): number {
    const codes: Record<ActivityState, number> = {
      idle: ActivityStateCode.Idle,
      walking: ActivityStateCode.Walking,
      running: ActivityStateCode.Running,
      talking: ActivityStateCode.Talking,
      resting: ActivityStateCode.Resting,
      eating: ActivityStateCode.Eating,
      exploring: ActivityStateCode.Exploring,
      playing: ActivityStateCode.Playing,
    };
    return codes[activity] ?? ActivityStateCode.Idle;
  }

  /** Load state from server */
  loadFromServer(serverState: {
    health: number;
    maxHealth: number;
    energy: number;
    maxEnergy: number;
    hunger: number;
    thirst: number;
    fatigue: number;
    cleanliness: number;
    happiness: number;
    stress: number;
    comfort: number;
    excitement: number;
    curiosity: number;
    confidence: number;
    loneliness: number;
    friendshipLevel: number;
    reputation: number;
    charisma: number;
    activity: number;
    ageTicks: bigint;
    totalDistanceMm: bigint;
    totalNpcInteractions: number;
    totalItemsCollected: number;
  }): void {
    this.state.physical = {
      health: serverState.health,
      maxHealth: serverState.maxHealth,
      energy: serverState.energy,
      maxEnergy: serverState.maxEnergy,
      hunger: serverState.hunger,
      thirst: serverState.thirst,
      fatigue: serverState.fatigue,
      cleanliness: serverState.cleanliness,
    };

    this.state.emotional = {
      happiness: serverState.happiness,
      stress: serverState.stress,
      comfort: serverState.comfort,
      excitement: serverState.excitement,
      curiosity: serverState.curiosity,
      confidence: serverState.confidence,
    };

    this.state.social = {
      ...this.state.social,
      loneliness: serverState.loneliness,
      friendshipLevel: serverState.friendshipLevel,
      reputation: serverState.reputation,
      charisma: serverState.charisma,
    };

    // Convert activity code to string
    const activityMap: Record<number, ActivityState> = {
      [ActivityStateCode.Idle]: 'idle',
      [ActivityStateCode.Walking]: 'walking',
      [ActivityStateCode.Running]: 'running',
      [ActivityStateCode.Talking]: 'talking',
      [ActivityStateCode.Resting]: 'resting',
      [ActivityStateCode.Eating]: 'eating',
      [ActivityStateCode.Exploring]: 'exploring',
      [ActivityStateCode.Playing]: 'playing',
    };
    this.state.activity = activityMap[serverState.activity] ?? 'idle';

    // Convert bigints
    this.state.age = Number(serverState.ageTicks) / (20 * 60 * 10); // ticks to game days
    this.state.totalDistanceTraveled = Number(serverState.totalDistanceMm) / 1000; // mm to meters
    this.state.totalNpcInteractions = serverState.totalNpcInteractions;
    this.state.totalItemsCollected = serverState.totalItemsCollected;

    this.state.mood = calculateMood(this.state);
    this.state.lastUpdated = Date.now();
    this.notify();
  }

  /** Get current state */
  getState(): FrugState {
    return { ...this.state };
  }

  /** Subscribe to state changes */
  subscribe(listener: (state: FrugState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Notify all listeners of state change */
  private notify(): void {
    const stateCopy = this.getState();
    this.listeners.forEach(listener => listener(stateCopy));
  }

  /** Update partial state */
  updateState(partial: Partial<FrugState>): void {
    this.state = {
      ...this.state,
      ...partial,
      lastUpdated: Date.now(),
    };

    // Recalculate mood based on new stats
    this.state.mood = calculateMood(this.state);

    this.notify();
  }

  /** Update physical stats */
  updatePhysical(stats: Partial<PhysicalStats>): void {
    this.state.physical = { ...this.state.physical, ...stats };
    this.state.mood = calculateMood(this.state);
    this.state.lastUpdated = Date.now();
    this.notify();
  }

  /** Update emotional stats */
  updateEmotional(stats: Partial<EmotionalStats>): void {
    this.state.emotional = { ...this.state.emotional, ...stats };
    this.state.mood = calculateMood(this.state);
    this.state.lastUpdated = Date.now();
    this.notify();
  }

  /** Update social stats */
  updateSocial(stats: Partial<SocialStats>): void {
    this.state.social = { ...this.state.social, ...stats };
    this.state.mood = calculateMood(this.state);
    this.state.lastUpdated = Date.now();
    this.notify();
  }

  /** Add a recent experience */
  addExperience(experience: Omit<RecentExperience, 'timestamp'>): void {
    this.state.recentExperiences.push({
      ...experience,
      timestamp: Date.now(),
    });

    // Keep only last 20 experiences
    if (this.state.recentExperiences.length > 20) {
      this.state.recentExperiences = this.state.recentExperiences.slice(-20);
    }

    // Adjust emotional stats based on experience
    const { emotional } = this.state;
    if (experience.type === 'positive') {
      emotional.happiness = Math.min(100, emotional.happiness + experience.intensity * 2);
      emotional.stress = Math.max(0, emotional.stress - experience.intensity);
    } else if (experience.type === 'negative') {
      emotional.happiness = Math.max(0, emotional.happiness - experience.intensity * 2);
      emotional.stress = Math.min(100, emotional.stress + experience.intensity);
    }

    this.state.mood = calculateMood(this.state);
    this.state.lastUpdated = Date.now();
    this.notify();
  }

  /** Set activity state */
  setActivity(activity: ActivityState): void {
    this.state.activity = activity;
    this.state.lastUpdated = Date.now();
    this.notify();
  }

  /** Record NPC interaction */
  recordNpcInteraction(npcName: string): void {
    this.state.totalNpcInteractions++;
    this.state.social.lastSocialInteraction = Date.now();
    this.state.social.loneliness = Math.max(0, this.state.social.loneliness - 10);
    this.state.social.friendshipLevel = Math.min(100, this.state.social.friendshipLevel + 1);

    // Update favorite NPC (most interacted)
    if (!this.state.favoriteNpc) {
      this.state.favoriteNpc = npcName;
    }

    this.state.mood = calculateMood(this.state);
    this.state.lastUpdated = Date.now();
    this.notify();
  }

  /** Start automatic stat decay/update */
  startAutoUpdate(intervalMs: number = 10000): void {
    if (this.updateInterval) return;

    this.updateInterval = window.setInterval(() => {
      this.tickStats();
    }, intervalMs);
  }

  /** Stop automatic updates */
  stopAutoUpdate(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /** Tick stats (decay over time) */
  private tickStats(): void {
    const { physical, emotional, social } = this.state;

    // Physical decay
    physical.hunger = Math.max(0, physical.hunger - 0.5);
    physical.thirst = Math.max(0, physical.thirst - 0.3);
    physical.energy = Math.max(0, physical.energy - 0.2);
    physical.cleanliness = Math.max(0, physical.cleanliness - 0.1);

    // Fatigue recovery when energy is high
    if (physical.energy > 50) {
      physical.fatigue = Math.min(100, physical.fatigue + 0.3);
    }

    // Emotional changes
    const timeSinceSocial = Date.now() - social.lastSocialInteraction;
    if (timeSinceSocial > 60000) { // 1 minute
      social.loneliness = Math.min(100, social.loneliness + 0.5);
    }

    // Stress naturally decreases over time
    emotional.stress = Math.max(0, emotional.stress - 0.2);

    // Decay recent experiences
    this.state.recentExperiences = this.state.recentExperiences.filter(exp => {
      const age = (Date.now() - exp.timestamp) / 1000;
      return age < 300 / exp.decayRate; // Experiences last based on decay rate
    });

    // Age increases (1 game day = 10 real minutes)
    this.state.age += 0.001;

    this.state.mood = calculateMood(this.state);
    this.state.lastUpdated = Date.now();
    this.notify();
  }

  /** Restore stats (eating, drinking, resting) */
  restore(type: 'food' | 'water' | 'rest' | 'clean', amount: number): void {
    const { physical, emotional } = this.state;

    switch (type) {
      case 'food':
        physical.hunger = Math.min(100, physical.hunger + amount);
        emotional.happiness = Math.min(100, emotional.happiness + amount * 0.1);
        break;
      case 'water':
        physical.thirst = Math.min(100, physical.thirst + amount);
        break;
      case 'rest':
        physical.fatigue = Math.min(100, physical.fatigue + amount);
        physical.energy = Math.min(physical.maxEnergy, physical.energy + amount * 0.5);
        emotional.stress = Math.max(0, emotional.stress - amount * 0.2);
        break;
      case 'clean':
        physical.cleanliness = Math.min(100, physical.cleanliness + amount);
        emotional.comfort = Math.min(100, emotional.comfort + amount * 0.3);
        break;
    }

    this.state.mood = calculateMood(this.state);
    this.state.lastUpdated = Date.now();
    this.notify();
  }

  /** Take damage */
  takeDamage(amount: number): void {
    this.state.physical.health = Math.max(0, this.state.physical.health - amount);
    this.addExperience({
      type: 'negative',
      description: 'Took damage',
      intensity: Math.min(10, amount / 10),
      decayRate: 0.5,
    });
  }

  /** Heal */
  heal(amount: number): void {
    this.state.physical.health = Math.min(
      this.state.physical.maxHealth,
      this.state.physical.health + amount
    );
    this.state.lastUpdated = Date.now();
    this.notify();
  }

  /** Export state for saving */
  exportState(): string {
    return JSON.stringify(this.state);
  }

  /** Import state from saved data */
  importState(json: string): void {
    try {
      const imported = JSON.parse(json);
      this.state = { ...DEFAULT_FRUG_STATE, ...imported };
      this.notify();
    } catch (e) {
      console.error('Failed to import Frug state:', e);
    }
  }

  /** Destroy manager */
  destroy(): void {
    this.stopAutoUpdate();
    this.stopServerSync();
    this.listeners.clear();
  }

  /** Force an immediate sync to server (useful before disconnect) */
  forceSync(): void {
    this.lastSyncTime = 0; // Reset throttle
    this.syncToServer();
  }
}

// Singleton instance
let instance: FrugStateManager | null = null;

export function getFrugStateManager(): FrugStateManager {
  if (!instance) {
    instance = new FrugStateManager();
  }
  return instance;
}

export function resetFrugStateManager(): void {
  if (instance) {
    instance.destroy();
  }
  instance = null;
}
