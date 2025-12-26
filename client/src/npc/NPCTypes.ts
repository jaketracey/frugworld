/**
 * NPCTypes - Extensible NPC type definitions
 * Allows creating different NPC archetypes with unique behaviors
 */

import type { NPCNeeds } from './NPCNeeds.ts';
import type { NPCSchedule } from './Goal.ts';
import { GoalType } from './Goal.ts';
import type { ActionType } from './Action.ts';
import type { TimePeriod } from './WorldState.ts';

// ============================================================================
// NPC Type Enum
// ============================================================================

export enum NPCType {
  // Villagers
  Villager = 'villager',
  Farmer = 'farmer',
  Merchant = 'merchant',
  Blacksmith = 'blacksmith',
  Innkeeper = 'innkeeper',
  Guard = 'guard',
  Priest = 'priest',
  Healer = 'healer',

  // Special NPCs
  Wanderer = 'wanderer',
  Hermit = 'hermit',
  Noble = 'noble',
  Beggar = 'beggar',

  // Profession-based
  Fisher = 'fisher',
  Hunter = 'hunter',
  Miner = 'miner',
  Woodcutter = 'woodcutter',
  Baker = 'baker',
  Brewer = 'brewer',
}

// ============================================================================
// NPC Type Definition
// ============================================================================

export interface NPCTypeDefinition {
  type: NPCType;
  displayName: string;
  description: string;

  /** Base movement speed multiplier */
  movementSpeedMultiplier: number;

  /** Initial needs values */
  initialNeeds: Partial<NPCNeeds>;

  /** Need decay rate multipliers */
  needDecayMultipliers: Partial<NPCNeeds>;

  /** Preferred goals for this NPC type */
  preferredGoals: GoalType[];

  /** Goals this NPC type avoids */
  avoidedGoals: GoalType[];

  /** Special actions available to this NPC type */
  specialActions: ActionType[];

  /** Work location type preference */
  workLocationType: string | null;

  /** Schedule modifier function */
  scheduleModifier: ((schedule: NPCSchedule) => NPCSchedule) | null;

  /** Weather sensitivity (0-1, higher = more affected) */
  weatherSensitivity: number;

  /** Social tendency (0-1, higher = more social) */
  socialTendency: number;

  /** Personality traits that affect behavior */
  traits: NPCTrait[];

  /** Custom priority modifiers for goals */
  goalPriorityModifiers: Map<GoalType, number>;
}

// ============================================================================
// NPC Traits
// ============================================================================

export enum NPCTrait {
  // Work ethic
  Hardworking = 'hardworking',
  Lazy = 'lazy',
  Diligent = 'diligent',

  // Social
  Friendly = 'friendly',
  Shy = 'shy',
  Gregarious = 'gregarious',
  Loner = 'loner',

  // Survival
  Cautious = 'cautious',
  Reckless = 'reckless',
  Survivor = 'survivor',

  // Schedule
  EarlyBird = 'early_bird',
  NightOwl = 'night_owl',

  // Weather
  WeatherProof = 'weather_proof',
  WeatherSensitive = 'weather_sensitive',

  // Other
  Curious = 'curious',
  Homebrew = 'homebrew',
  Wanderlust = 'wanderlust',
}

// ============================================================================
// Default NPC Type Definitions
// ============================================================================

const createBaseDefinition = (type: NPCType, name: string, desc: string): NPCTypeDefinition => ({
  type,
  displayName: name,
  description: desc,
  movementSpeedMultiplier: 1.0,
  initialNeeds: {},
  needDecayMultipliers: {},
  preferredGoals: [],
  avoidedGoals: [],
  specialActions: [],
  workLocationType: null,
  scheduleModifier: null,
  weatherSensitivity: 0.5,
  socialTendency: 0.5,
  traits: [],
  goalPriorityModifiers: new Map(),
});

export const NPC_TYPE_DEFINITIONS: Map<NPCType, NPCTypeDefinition> = new Map();

// Villager - basic NPC type
NPC_TYPE_DEFINITIONS.set(NPCType.Villager, {
  ...createBaseDefinition(NPCType.Villager, 'Villager', 'A common villager going about daily life'),
  socialTendency: 0.6,
  traits: [NPCTrait.Friendly],
});

// Farmer - works the fields
NPC_TYPE_DEFINITIONS.set(NPCType.Farmer, {
  ...createBaseDefinition(NPCType.Farmer, 'Farmer', 'Works the fields from dawn to dusk'),
  workLocationType: 'farm',
  weatherSensitivity: 0.3, // More tolerant of weather
  traits: [NPCTrait.Hardworking, NPCTrait.EarlyBird, NPCTrait.WeatherProof],
  scheduleModifier: (schedule) => ({
    ...schedule,
    workStart: 0.25, // Earlier start
    workEnd: 0.7, // Later end
  }),
  goalPriorityModifiers: new Map([
    [GoalType.GoToWork, 15], // Higher priority for work
  ]),
});

// Merchant - trades at the market
NPC_TYPE_DEFINITIONS.set(NPCType.Merchant, {
  ...createBaseDefinition(NPCType.Merchant, 'Merchant', 'Buys and sells goods at the market'),
  workLocationType: 'market',
  socialTendency: 0.8,
  traits: [NPCTrait.Gregarious, NPCTrait.Diligent],
  scheduleModifier: (schedule) => ({
    ...schedule,
    workStart: 0.35,
    workEnd: 0.7,
    daysOff: [0], // Only Sunday off
  }),
  preferredGoals: [GoalType.Socialize, GoalType.Trade],
});

// Blacksmith - works at the forge
NPC_TYPE_DEFINITIONS.set(NPCType.Blacksmith, {
  ...createBaseDefinition(NPCType.Blacksmith, 'Blacksmith', 'Forges weapons and tools'),
  workLocationType: 'workplace',
  movementSpeedMultiplier: 0.9, // Slightly slower due to heavy work
  weatherSensitivity: 0.2, // Works indoors
  traits: [NPCTrait.Hardworking, NPCTrait.Loner],
  socialTendency: 0.3,
  initialNeeds: { energy: 70 }, // Starts with less energy (hard work)
});

// Guard - patrols and protects
NPC_TYPE_DEFINITIONS.set(NPCType.Guard, {
  ...createBaseDefinition(NPCType.Guard, 'Guard', 'Protects the village and its people'),
  movementSpeedMultiplier: 1.1,
  weatherSensitivity: 0.3,
  traits: [NPCTrait.Cautious, NPCTrait.Diligent, NPCTrait.WeatherProof],
  preferredGoals: [GoalType.Wander], // Patrols
  avoidedGoals: [GoalType.Socialize], // Stays focused
  scheduleModifier: (schedule) => ({
    ...schedule,
    workStart: 0.3,
    workEnd: 0.8,
    daysOff: [], // Works every day
  }),
});

// Innkeeper - manages the tavern
NPC_TYPE_DEFINITIONS.set(NPCType.Innkeeper, {
  ...createBaseDefinition(NPCType.Innkeeper, 'Innkeeper', 'Runs the local tavern'),
  workLocationType: 'tavern',
  socialTendency: 0.9,
  traits: [NPCTrait.Friendly, NPCTrait.Gregarious, NPCTrait.NightOwl],
  preferredGoals: [GoalType.Socialize],
  scheduleModifier: (schedule) => ({
    ...schedule,
    workStart: 0.5, // Afternoon start
    workEnd: 0.95, // Works late
    sleepStart: 0.0, // Sleeps after midnight
    sleepEnd: 0.35, // Wakes up later
  }),
});

// Priest - serves at the temple
NPC_TYPE_DEFINITIONS.set(NPCType.Priest, {
  ...createBaseDefinition(NPCType.Priest, 'Priest', 'Tends to the spiritual needs of villagers'),
  workLocationType: 'temple',
  socialTendency: 0.7,
  traits: [NPCTrait.Friendly, NPCTrait.EarlyBird],
  preferredGoals: [GoalType.Socialize],
  scheduleModifier: (schedule) => ({
    ...schedule,
    workStart: 0.25, // Early morning prayers
    workEnd: 0.6,
  }),
});

// Wanderer - travels between locations
NPC_TYPE_DEFINITIONS.set(NPCType.Wanderer, {
  ...createBaseDefinition(NPCType.Wanderer, 'Wanderer', 'A traveler passing through'),
  movementSpeedMultiplier: 1.2,
  workLocationType: null, // No fixed workplace
  socialTendency: 0.4,
  traits: [NPCTrait.Wanderlust, NPCTrait.Survivor, NPCTrait.WeatherProof],
  preferredGoals: [GoalType.Wander],
  avoidedGoals: [GoalType.GoToWork],
  weatherSensitivity: 0.2,
});

// Hermit - lives alone, avoids others
NPC_TYPE_DEFINITIONS.set(NPCType.Hermit, {
  ...createBaseDefinition(NPCType.Hermit, 'Hermit', 'Prefers solitude over company'),
  socialTendency: 0.1,
  traits: [NPCTrait.Loner, NPCTrait.Shy, NPCTrait.Survivor],
  avoidedGoals: [GoalType.Socialize],
  needDecayMultipliers: { social: 0.2 }, // Social need decays slowly
});

// Hunter - tracks game in the forest
NPC_TYPE_DEFINITIONS.set(NPCType.Hunter, {
  ...createBaseDefinition(NPCType.Hunter, 'Hunter', 'Tracks and hunts game'),
  workLocationType: 'forest',
  movementSpeedMultiplier: 1.15,
  weatherSensitivity: 0.25,
  traits: [NPCTrait.Cautious, NPCTrait.Survivor, NPCTrait.EarlyBird],
  scheduleModifier: (schedule) => ({
    ...schedule,
    workStart: 0.22, // Very early
    workEnd: 0.55,
  }),
});

// ============================================================================
// NPC Type Factory
// ============================================================================

export class NPCTypeFactory {
  /**
   * Get type definition by type
   */
  static getDefinition(type: NPCType): NPCTypeDefinition {
    return NPC_TYPE_DEFINITIONS.get(type) ?? NPC_TYPE_DEFINITIONS.get(NPCType.Villager)!;
  }

  /**
   * Get all available NPC types
   */
  static getAllTypes(): NPCType[] {
    return Array.from(NPC_TYPE_DEFINITIONS.keys());
  }

  /**
   * Create a custom NPC type
   */
  static createCustomType(
    base: NPCType,
    overrides: Partial<NPCTypeDefinition>
  ): NPCTypeDefinition {
    const baseDefinition = this.getDefinition(base);
    return {
      ...baseDefinition,
      ...overrides,
      traits: [...baseDefinition.traits, ...(overrides.traits ?? [])],
      goalPriorityModifiers: new Map([
        ...baseDefinition.goalPriorityModifiers,
        ...(overrides.goalPriorityModifiers ?? new Map()),
      ]),
    };
  }

  /**
   * Get goal priority modifier for an NPC type
   */
  static getGoalPriorityModifier(type: NPCType, goal: GoalType): number {
    const definition = this.getDefinition(type);
    return definition.goalPriorityModifiers.get(goal) ?? 0;
  }

  /**
   * Check if NPC type prefers a goal
   */
  static prefersGoal(type: NPCType, goal: GoalType): boolean {
    const definition = this.getDefinition(type);
    return definition.preferredGoals.includes(goal);
  }

  /**
   * Check if NPC type avoids a goal
   */
  static avoidsGoal(type: NPCType, goal: GoalType): boolean {
    const definition = this.getDefinition(type);
    return definition.avoidedGoals.includes(goal);
  }

  /**
   * Check if NPC has a trait
   */
  static hasTrait(type: NPCType, trait: NPCTrait): boolean {
    const definition = this.getDefinition(type);
    return definition.traits.includes(trait);
  }
}
