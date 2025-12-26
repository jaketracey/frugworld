/**
 * Goal - GOAP goal system for NPC decision making
 * Goals represent desired world states that NPCs try to achieve
 */

import type { Vec3 } from '@/types/protocol.ts';
import type { WorldStateSnapshot, TimePeriod } from './WorldState.ts';
import type { NPCNeeds } from './NPCNeeds.ts';

// ============================================================================
// Goal Types
// ============================================================================

export enum GoalType {
  // Survival goals (highest priority)
  SeekShelter = 'seek_shelter',
  FindFood = 'find_food',
  FindWater = 'find_water',
  Sleep = 'sleep',
  Heal = 'heal',

  // Social goals
  Socialize = 'socialize',
  Trade = 'trade',
  Talk = 'talk',

  // Work goals
  GoToWork = 'go_to_work',
  PerformJob = 'perform_job',
  ReturnHome = 'return_home',

  // Leisure goals
  Wander = 'wander',
  Rest = 'rest',
  Entertainment = 'entertainment',

  // Reactive goals
  FleeFromDanger = 'flee_from_danger',
  InvestigateSound = 'investigate_sound',
  FollowPlayer = 'follow_player',
}

export enum GoalCategory {
  Survival = 'survival',
  Social = 'social',
  Work = 'work',
  Leisure = 'leisure',
  Reactive = 'reactive',
}

// ============================================================================
// Goal State Conditions
// ============================================================================

export interface GoalCondition {
  /** Type of condition */
  type: 'at_location' | 'has_item' | 'need_above' | 'need_below' | 'time_is' | 'weather_is' | 'is_sheltered' | 'custom';
  /** Condition parameters */
  params: Record<string, unknown>;
}

export interface GoalState {
  /** Conditions that must be true for goal to be satisfied */
  conditions: GoalCondition[];
}

// ============================================================================
// Goal Context
// ============================================================================

export interface GoalContext {
  /** Current NPC position */
  position: Vec3;
  /** Current NPC needs */
  needs: NPCNeeds;
  /** Current world state */
  worldState: WorldStateSnapshot;
  /** NPC-specific data */
  npcData: {
    homeLocationId: string | null;
    workLocationId: string | null;
    currentLocationId: string | null;
    isInShelter: boolean;
    isSleeping: boolean;
    isWorking: boolean;
    schedule: NPCSchedule;
  };
}

export interface NPCSchedule {
  /** Work start time (0-1) */
  workStart: number;
  /** Work end time (0-1) */
  workEnd: number;
  /** Sleep start time (0-1) */
  sleepStart: number;
  /** Sleep end time (0-1) */
  sleepEnd: number;
  /** Days off (0=Sunday, 6=Saturday) */
  daysOff: number[];
}

// ============================================================================
// Goal Definition
// ============================================================================

export interface GoalDefinition {
  type: GoalType;
  category: GoalCategory;
  /** Base priority (0-100) */
  basePriority: number;
  /** Priority calculation function */
  calculatePriority: (context: GoalContext) => number;
  /** Check if goal is currently valid/applicable */
  isValid: (context: GoalContext) => boolean;
  /** Check if goal is satisfied */
  isSatisfied: (context: GoalContext) => boolean;
  /** Get the target world state for this goal */
  getTargetState: (context: GoalContext) => GoalState;
  /** Optional: interruption priority (goals with higher can interrupt this) */
  interruptThreshold: number;
}

// ============================================================================
// Goal Instance
// ============================================================================

export interface GoalInstance {
  definition: GoalDefinition;
  priority: number;
  activatedAt: number;
  targetState: GoalState;
  targetLocation: Vec3 | null;
  metadata: Record<string, unknown>;
}

// ============================================================================
// Built-in Goal Definitions
// ============================================================================

export const GOAL_DEFINITIONS: Map<GoalType, GoalDefinition> = new Map();

// Seek Shelter - highest priority during bad weather
GOAL_DEFINITIONS.set(GoalType.SeekShelter, {
  type: GoalType.SeekShelter,
  category: GoalCategory.Survival,
  basePriority: 95,
  interruptThreshold: 10,
  calculatePriority: (context: GoalContext): number => {
    const { worldState, npcData } = context;
    if (npcData.isInShelter) return 0;
    if (worldState.isOutdoorsDangerous) return 100;
    if (worldState.weather.type === 'stormy') return 95;
    if (worldState.weather.type === 'rainy' && worldState.weather.severity >= 2) return 85;
    if (worldState.weather.type === 'snowy' && worldState.weather.severity >= 2) return 80;
    return 0;
  },
  isValid: (context: GoalContext): boolean => {
    return !context.npcData.isInShelter &&
      (context.worldState.isOutdoorsDangerous || context.worldState.weather.type !== 'clear');
  },
  isSatisfied: (context: GoalContext): boolean => {
    return context.npcData.isInShelter;
  },
  getTargetState: (): GoalState => ({
    conditions: [{ type: 'is_sheltered', params: { value: true } }],
  }),
});

// Sleep - needed at night or when energy is low
GOAL_DEFINITIONS.set(GoalType.Sleep, {
  type: GoalType.Sleep,
  category: GoalCategory.Survival,
  basePriority: 80,
  interruptThreshold: 30,
  calculatePriority: (context: GoalContext): number => {
    const { needs, worldState, npcData } = context;
    const energyNeed = 100 - needs.energy;
    const isScheduledSleep = isTimeInRange(
      worldState.timeOfDay,
      npcData.schedule.sleepStart,
      npcData.schedule.sleepEnd
    );
    if (needs.energy < 10) return 100; // Exhausted
    if (needs.energy < 30 && isScheduledSleep) return 90;
    if (isScheduledSleep) return 60 + energyNeed * 0.3;
    if (needs.energy < 20) return 75;
    return energyNeed * 0.5;
  },
  isValid: (context: GoalContext): boolean => {
    return context.needs.energy < 80 || isTimeInRange(
      context.worldState.timeOfDay,
      context.npcData.schedule.sleepStart,
      context.npcData.schedule.sleepEnd
    );
  },
  isSatisfied: (context: GoalContext): boolean => {
    return context.needs.energy >= 95;
  },
  getTargetState: (): GoalState => ({
    conditions: [
      { type: 'at_location', params: { locationType: 'home' } },
      { type: 'need_above', params: { need: 'energy', value: 90 } },
    ],
  }),
});

// Find Food
GOAL_DEFINITIONS.set(GoalType.FindFood, {
  type: GoalType.FindFood,
  category: GoalCategory.Survival,
  basePriority: 75,
  interruptThreshold: 25,
  calculatePriority: (context: GoalContext): number => {
    const hunger = 100 - context.needs.hunger;
    if (context.needs.hunger < 10) return 100;
    if (context.needs.hunger < 30) return 85;
    if (context.needs.hunger < 50) return 60;
    return hunger * 0.5;
  },
  isValid: (context: GoalContext): boolean => {
    return context.needs.hunger < 70;
  },
  isSatisfied: (context: GoalContext): boolean => {
    return context.needs.hunger >= 90;
  },
  getTargetState: (): GoalState => ({
    conditions: [{ type: 'need_above', params: { need: 'hunger', value: 85 } }],
  }),
});

// Go To Work
GOAL_DEFINITIONS.set(GoalType.GoToWork, {
  type: GoalType.GoToWork,
  category: GoalCategory.Work,
  basePriority: 60,
  interruptThreshold: 40,
  calculatePriority: (context: GoalContext): number => {
    const { worldState, npcData, needs } = context;
    if (!npcData.workLocationId) return 0;
    const isWorkTime = isTimeInRange(worldState.timeOfDay, npcData.schedule.workStart, npcData.schedule.workEnd);
    if (!isWorkTime) return 0;
    if (npcData.isWorking) return 0;
    if (needs.energy < 20) return 20; // Too tired
    if (worldState.isOutdoorsDangerous) return 30; // Weather concerns
    return 70;
  },
  isValid: (context: GoalContext): boolean => {
    const { worldState, npcData } = context;
    return !!npcData.workLocationId &&
      isTimeInRange(worldState.timeOfDay, npcData.schedule.workStart, npcData.schedule.workEnd) &&
      !npcData.isWorking;
  },
  isSatisfied: (context: GoalContext): boolean => {
    return context.npcData.isWorking;
  },
  getTargetState: (context: GoalContext): GoalState => ({
    conditions: [
      { type: 'at_location', params: { locationId: context.npcData.workLocationId } },
    ],
  }),
});

// Return Home
GOAL_DEFINITIONS.set(GoalType.ReturnHome, {
  type: GoalType.ReturnHome,
  category: GoalCategory.Work,
  basePriority: 50,
  interruptThreshold: 35,
  calculatePriority: (context: GoalContext): number => {
    const { worldState, npcData, needs } = context;
    if (!npcData.homeLocationId) return 0;
    if (npcData.currentLocationId === npcData.homeLocationId) return 0;

    const isNight = worldState.timePhase === 'night' || worldState.timePhase === 'dusk';
    const isSleepTime = isTimeInRange(worldState.timeOfDay, npcData.schedule.sleepStart, npcData.schedule.sleepEnd);
    const isAfterWork = !isTimeInRange(worldState.timeOfDay, npcData.schedule.workStart, npcData.schedule.workEnd);

    if (isSleepTime) return 80;
    if (isNight && isAfterWork) return 70;
    if (needs.energy < 30) return 65;
    if (worldState.isOutdoorsDangerous) return 75;
    return 0;
  },
  isValid: (context: GoalContext): boolean => {
    const { npcData } = context;
    return !!npcData.homeLocationId && npcData.currentLocationId !== npcData.homeLocationId;
  },
  isSatisfied: (context: GoalContext): boolean => {
    return context.npcData.currentLocationId === context.npcData.homeLocationId;
  },
  getTargetState: (context: GoalContext): GoalState => ({
    conditions: [
      { type: 'at_location', params: { locationId: context.npcData.homeLocationId } },
    ],
  }),
});

// Socialize
GOAL_DEFINITIONS.set(GoalType.Socialize, {
  type: GoalType.Socialize,
  category: GoalCategory.Social,
  basePriority: 40,
  interruptThreshold: 50,
  calculatePriority: (context: GoalContext): number => {
    const { needs, worldState, npcData } = context;
    const socialNeed = 100 - needs.social;

    if (worldState.isOutdoorsDangerous) return 0;
    if (npcData.isWorking) return 0;
    if (needs.energy < 20 || needs.hunger < 20) return 0;

    // More social during day
    const timeBonus = worldState.timePhase === 'day' ? 15 : 0;
    return Math.min(socialNeed * 0.6 + timeBonus, 60);
  },
  isValid: (context: GoalContext): boolean => {
    return context.needs.social < 70 &&
      !context.worldState.isOutdoorsDangerous &&
      context.needs.energy >= 20;
  },
  isSatisfied: (context: GoalContext): boolean => {
    return context.needs.social >= 80;
  },
  getTargetState: (): GoalState => ({
    conditions: [{ type: 'need_above', params: { need: 'social', value: 75 } }],
  }),
});

// Wander (idle behavior)
GOAL_DEFINITIONS.set(GoalType.Wander, {
  type: GoalType.Wander,
  category: GoalCategory.Leisure,
  basePriority: 10,
  interruptThreshold: 80,
  calculatePriority: (context: GoalContext): number => {
    const { worldState, npcData, needs } = context;

    if (worldState.isOutdoorsDangerous) return 0;
    if (needs.energy < 30) return 0;
    if (npcData.isWorking) return 0;

    // Higher during pleasant weather
    const weatherBonus = worldState.weather.type === 'clear' ? 10 : 0;
    const dayBonus = worldState.timePhase === 'day' ? 10 : 0;

    return 15 + weatherBonus + dayBonus;
  },
  isValid: (context: GoalContext): boolean => {
    return !context.worldState.isOutdoorsDangerous &&
      context.needs.energy >= 30 &&
      !context.npcData.isWorking;
  },
  isSatisfied: (): boolean => false, // Never fully satisfied, always available
  getTargetState: (): GoalState => ({
    conditions: [], // No specific end condition
  }),
});

// Flee From Danger
GOAL_DEFINITIONS.set(GoalType.FleeFromDanger, {
  type: GoalType.FleeFromDanger,
  category: GoalCategory.Reactive,
  basePriority: 100,
  interruptThreshold: 0,
  calculatePriority: (context: GoalContext): number => {
    // This would be triggered by threat detection
    // For now, just weather-based
    if (context.worldState.isOutdoorsDangerous && !context.npcData.isInShelter) {
      return 100;
    }
    return 0;
  },
  isValid: (context: GoalContext): boolean => {
    return context.worldState.isOutdoorsDangerous && !context.npcData.isInShelter;
  },
  isSatisfied: (context: GoalContext): boolean => {
    return context.npcData.isInShelter || !context.worldState.isOutdoorsDangerous;
  },
  getTargetState: (): GoalState => ({
    conditions: [{ type: 'is_sheltered', params: { value: true } }],
  }),
});

// ============================================================================
// Goal Factory
// ============================================================================

export class GoalFactory {
  /**
   * Create a goal instance from a goal type
   */
  static createGoal(type: GoalType, context: GoalContext): GoalInstance | null {
    const definition = GOAL_DEFINITIONS.get(type);
    if (!definition) return null;
    if (!definition.isValid(context)) return null;

    return {
      definition,
      priority: definition.calculatePriority(context),
      activatedAt: performance.now(),
      targetState: definition.getTargetState(context),
      targetLocation: null,
      metadata: {},
    };
  }

  /**
   * Get all valid goals for current context, sorted by priority
   */
  static getValidGoals(context: GoalContext): GoalInstance[] {
    const goals: GoalInstance[] = [];

    for (const [type, definition] of GOAL_DEFINITIONS) {
      if (definition.isValid(context)) {
        const goal = this.createGoal(type, context);
        if (goal && goal.priority > 0) {
          goals.push(goal);
        }
      }
    }

    // Sort by priority descending
    goals.sort((a, b) => b.priority - a.priority);
    return goals;
  }

  /**
   * Get the highest priority goal
   */
  static getHighestPriorityGoal(context: GoalContext): GoalInstance | null {
    const goals = this.getValidGoals(context);
    return goals.length > 0 ? goals[0] : null;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function isTimeInRange(current: number, start: number, end: number): boolean {
  if (start <= end) {
    return current >= start && current <= end;
  }
  // Handle wrap-around (e.g., 0.8 to 0.2)
  return current >= start || current <= end;
}
