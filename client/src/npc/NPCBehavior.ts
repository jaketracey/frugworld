/**
 * NPC Goal-Directed Behavior System
 * Implements GOAP-style goal planning for NPC decision making
 */

import type { WeatherInfo } from '../render/WeatherSystem.ts';
import type { TimeOfDay } from '../render/DayNightCycle.ts';

// ============================================================================
// Types
// ============================================================================

export interface NPCPosition {
  x: number;
  y: number;
  z: number;
}

export interface WorldContext {
  timeOfDay: TimeOfDay;
  timeNormalized: number; // 0-1
  weather: WeatherInfo;
  isNight: boolean;
  needsShelter: boolean;
}

export enum GoalType {
  Idle = 'idle',
  Work = 'work',
  Eat = 'eat',
  Sleep = 'sleep',
  Socialize = 'socialize',
  SeekShelter = 'seek_shelter',
  GoHome = 'go_home',
  Patrol = 'patrol',
  Trade = 'trade',
  Worship = 'worship',
  Relax = 'relax',
}

export interface Goal {
  type: GoalType;
  priority: number;
  targetPOI?: string;
  targetPosition?: NPCPosition;
  duration?: number;
  interruptible: boolean;
}

export interface NPCNeeds {
  energy: number;      // 0-100, affects sleep priority
  hunger: number;      // 0-100, affects eat priority
  social: number;      // 0-100, affects socialize priority
  comfort: number;     // 0-100, affected by weather
}

export interface NPCScheduleEntry {
  startTime: number;   // 0-1 day cycle
  endTime: number;
  goalType: GoalType;
  targetPOI?: string;
  priority: number;
}

export interface NPCBehaviorConfig {
  homeId?: string;
  workplaceId?: string;
  schedule: NPCScheduleEntry[];
  personalityTraits: string[];
  occupation?: string;
}

// ============================================================================
// Goal Priority Calculators
// ============================================================================

function calculateSleepPriority(needs: NPCNeeds, context: WorldContext): number {
  let priority = (100 - needs.energy) * 0.8;
  if (context.isNight) priority += 30;
  if (needs.energy < 20) priority += 40;
  return Math.min(100, priority);
}

function calculateEatPriority(needs: NPCNeeds): number {
  let priority = (100 - needs.hunger) * 0.7;
  if (needs.hunger < 20) priority += 50;
  return Math.min(100, priority);
}

function calculateShelterPriority(context: WorldContext, needs: NPCNeeds): number {
  if (!context.needsShelter && !context.weather.isStormy) return 0;
  let priority = 60;
  if (context.weather.isStormy) priority = 90;
  if (needs.comfort < 30) priority += 20;
  return Math.min(100, priority);
}

function calculateSocializePriority(needs: NPCNeeds, context: WorldContext): number {
  if (context.isNight || context.needsShelter) return 0;
  let priority = (100 - needs.social) * 0.5;
  if (context.timeOfDay === 'day') priority += 10;
  return Math.min(100, priority);
}

// ============================================================================
// NPC Behavior Controller
// ============================================================================

export class NPCBehaviorController {
  private config: NPCBehaviorConfig;
  private needs: NPCNeeds;
  private currentGoal: Goal | null = null;
  private goalQueue: Goal[] = [];
  private position: NPCPosition = { x: 0, y: 0, z: 0 };

  constructor(config: NPCBehaviorConfig) {
    this.config = config;
    this.needs = { energy: 80, hunger: 70, social: 60, comfort: 80 };
  }

  setPosition(x: number, y: number, z: number): void {
    this.position = { x, y, z };
  }

  getPosition(): NPCPosition {
    return { ...this.position };
  }

  getCurrentGoal(): Goal | null {
    return this.currentGoal;
  }

  getNeeds(): NPCNeeds {
    return { ...this.needs };
  }

  updateNeeds(deltaMs: number): void {
    const decayRate = deltaMs / 60000; // per minute
    this.needs.energy = Math.max(0, this.needs.energy - decayRate * 0.5);
    this.needs.hunger = Math.max(0, this.needs.hunger - decayRate * 0.3);
    this.needs.social = Math.max(0, this.needs.social - decayRate * 0.2);
  }

  applyWeatherEffect(weather: WeatherInfo): void {
    if (weather.isRaining || weather.isStormy) {
      this.needs.comfort = Math.max(0, this.needs.comfort - 0.1);
    }
    if (weather.isStormy) {
      this.needs.comfort = Math.max(0, this.needs.comfort - 0.2);
    }
  }

  evaluateGoals(context: WorldContext): Goal[] {
    const goals: Goal[] = [];

    // Check scheduled activities
    const scheduledGoal = this.getScheduledGoal(context.timeNormalized);
    if (scheduledGoal) {
      goals.push(scheduledGoal);
    }

    // Survival needs
    if (context.needsShelter) {
      goals.push({
        type: GoalType.SeekShelter,
        priority: calculateShelterPriority(context, this.needs),
        interruptible: false,
      });
    }

    // Basic needs
    goals.push({
      type: GoalType.Sleep,
      priority: calculateSleepPriority(this.needs, context),
      targetPOI: this.config.homeId,
      interruptible: true,
    });

    goals.push({
      type: GoalType.Eat,
      priority: calculateEatPriority(this.needs),
      interruptible: true,
    });

    // Social needs
    goals.push({
      type: GoalType.Socialize,
      priority: calculateSocializePriority(this.needs, context),
      interruptible: true,
    });

    // Work (if has workplace and daytime)
    if (this.config.workplaceId && context.timeOfDay === 'day') {
      goals.push({
        type: GoalType.Work,
        priority: 50,
        targetPOI: this.config.workplaceId,
        interruptible: true,
      });
    }

    // Default idle
    goals.push({
      type: GoalType.Idle,
      priority: 10,
      interruptible: true,
    });

    return goals.sort((a, b) => b.priority - a.priority);
  }

  selectBestGoal(context: WorldContext): Goal {
    const goals = this.evaluateGoals(context);

    // If current goal is not interruptible and still valid, keep it
    if (this.currentGoal && !this.currentGoal.interruptible) {
      return this.currentGoal;
    }

    // Select highest priority goal
    const bestGoal = goals[0];

    // Only switch if significantly better
    if (this.currentGoal && bestGoal.priority < this.currentGoal.priority + 20) {
      return this.currentGoal;
    }

    return bestGoal;
  }

  update(deltaMs: number, context: WorldContext): Goal {
    this.updateNeeds(deltaMs);
    this.applyWeatherEffect(context.weather);

    const newGoal = this.selectBestGoal(context);

    if (newGoal.type !== this.currentGoal?.type) {
      this.currentGoal = newGoal;
    }

    return this.currentGoal!;
  }

  fulfillNeed(need: keyof NPCNeeds, amount: number): void {
    this.needs[need] = Math.min(100, this.needs[need] + amount);
  }

  private getScheduledGoal(timeNormalized: number): Goal | null {
    for (const entry of this.config.schedule) {
      const inRange = entry.startTime <= entry.endTime
        ? timeNormalized >= entry.startTime && timeNormalized <= entry.endTime
        : timeNormalized >= entry.startTime || timeNormalized <= entry.endTime;

      if (inRange) {
        return {
          type: entry.goalType,
          priority: entry.priority,
          targetPOI: entry.targetPOI,
          interruptible: entry.priority < 80,
        };
      }
    }
    return null;
  }
}
