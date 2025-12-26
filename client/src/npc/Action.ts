/**
 * Action - GOAP actions that NPCs can perform
 * Actions have preconditions and effects on world state
 */

import type { Vec3 } from '@/types/protocol.ts';
import type { GoalContext, GoalCondition } from './Goal.ts';
import type { LocationType, Location } from './WorldState.ts';

// ============================================================================
// Action Types
// ============================================================================

export enum ActionType {
  // Movement
  MoveTo = 'move_to',
  WanderAround = 'wander_around',
  FollowPath = 'follow_path',

  // Shelter/Building
  EnterBuilding = 'enter_building',
  ExitBuilding = 'exit_building',
  FindShelter = 'find_shelter',

  // Basic needs
  Sleep = 'sleep',
  WakeUp = 'wake_up',
  Eat = 'eat',
  Drink = 'drink',

  // Work
  StartWork = 'start_work',
  PerformWork = 'perform_work',
  StopWork = 'stop_work',

  // Social
  Greet = 'greet',
  Chat = 'chat',
  Wave = 'wave',

  // Idle
  Idle = 'idle',
  LookAround = 'look_around',
  Sit = 'sit',
  Stand = 'stand',
}

export enum ActionStatus {
  Pending = 'pending',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Interrupted = 'interrupted',
}

// ============================================================================
// Action Interfaces
// ============================================================================

export interface ActionPrecondition {
  type: 'at_location' | 'has_item' | 'need_above' | 'need_below' | 'is_near' | 'time_is' | 'weather_not' | 'is_indoors' | 'is_outdoors' | 'not_working' | 'custom';
  params: Record<string, unknown>;
  check: (context: GoalContext) => boolean;
}

export interface ActionEffect {
  type: 'set_location' | 'modify_need' | 'set_state' | 'set_position' | 'custom';
  params: Record<string, unknown>;
  apply: (context: GoalContext) => void;
}

export interface ActionDefinition {
  type: ActionType;
  /** Base cost of action (lower = preferred) */
  cost: number;
  /** Duration in milliseconds (0 = instant) */
  duration: number;
  /** Can this action be interrupted? */
  interruptible: boolean;
  /** Preconditions that must be true to execute */
  preconditions: ActionPrecondition[];
  /** Effects on world state after completion */
  effects: ActionEffect[];
  /** Dynamic cost calculation */
  calculateCost?: (context: GoalContext, target?: Vec3) => number;
  /** Check if action can be executed in current context */
  canExecute: (context: GoalContext) => boolean;
  /** Get target position for this action (if applicable) */
  getTargetPosition?: (context: GoalContext) => Vec3 | null;
}

export interface ActionInstance {
  definition: ActionDefinition;
  status: ActionStatus;
  startTime: number;
  elapsedTime: number;
  targetPosition: Vec3 | null;
  targetLocationId: string | null;
  progress: number; // 0-1
  metadata: Record<string, unknown>;
}

// ============================================================================
// Built-in Action Definitions
// ============================================================================

export const ACTION_DEFINITIONS: Map<ActionType, ActionDefinition> = new Map();

// MoveTo - move to a specific position
ACTION_DEFINITIONS.set(ActionType.MoveTo, {
  type: ActionType.MoveTo,
  cost: 1,
  duration: 0, // Dynamic based on distance
  interruptible: true,
  preconditions: [],
  effects: [
    {
      type: 'set_position',
      params: {},
      apply: () => {}, // Position updated by movement system
    },
  ],
  calculateCost: (context: GoalContext, target?: Vec3): number => {
    if (!target) return 100;
    const dx = target.x - context.position.x;
    const dy = target.y - context.position.y;
    const dz = target.z - context.position.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return 1 + distance * 0.1; // Cost increases with distance
  },
  canExecute: (): boolean => true,
  getTargetPosition: (_context: GoalContext): Vec3 | null => null, // Set externally
});

// FindShelter - locate and move to nearest shelter
ACTION_DEFINITIONS.set(ActionType.FindShelter, {
  type: ActionType.FindShelter,
  cost: 5,
  duration: 0, // Dynamic
  interruptible: true,
  preconditions: [
    {
      type: 'is_outdoors',
      params: {},
      check: (context: GoalContext): boolean => !context.npcData.isInShelter,
    },
  ],
  effects: [
    {
      type: 'set_state',
      params: { isInShelter: true },
      apply: () => {},
    },
  ],
  canExecute: (context: GoalContext): boolean => !context.npcData.isInShelter,
});

// EnterBuilding
ACTION_DEFINITIONS.set(ActionType.EnterBuilding, {
  type: ActionType.EnterBuilding,
  cost: 2,
  duration: 1000,
  interruptible: false,
  preconditions: [
    {
      type: 'is_near',
      params: { distance: 3 },
      check: (): boolean => true, // Checked dynamically
    },
  ],
  effects: [
    {
      type: 'set_state',
      params: { isInShelter: true },
      apply: () => {},
    },
  ],
  canExecute: (): boolean => true,
});

// Sleep
ACTION_DEFINITIONS.set(ActionType.Sleep, {
  type: ActionType.Sleep,
  cost: 1,
  duration: 0, // Until energy restored or interrupted
  interruptible: true,
  preconditions: [
    {
      type: 'at_location',
      params: { locationType: 'home' },
      check: (context: GoalContext): boolean => {
        return context.npcData.currentLocationId === context.npcData.homeLocationId;
      },
    },
    {
      type: 'need_below',
      params: { need: 'energy', value: 80 },
      check: (context: GoalContext): boolean => context.needs.energy < 80,
    },
  ],
  effects: [
    {
      type: 'modify_need',
      params: { need: 'energy', value: 100 },
      apply: () => {},
    },
  ],
  canExecute: (context: GoalContext): boolean => {
    return context.npcData.currentLocationId === context.npcData.homeLocationId &&
      context.needs.energy < 80;
  },
});

// Eat
ACTION_DEFINITIONS.set(ActionType.Eat, {
  type: ActionType.Eat,
  cost: 2,
  duration: 5000, // 5 seconds
  interruptible: true,
  preconditions: [
    {
      type: 'need_below',
      params: { need: 'hunger', value: 80 },
      check: (context: GoalContext): boolean => context.needs.hunger < 80,
    },
  ],
  effects: [
    {
      type: 'modify_need',
      params: { need: 'hunger', delta: 40 },
      apply: () => {},
    },
  ],
  canExecute: (context: GoalContext): boolean => context.needs.hunger < 80,
});

// StartWork
ACTION_DEFINITIONS.set(ActionType.StartWork, {
  type: ActionType.StartWork,
  cost: 3,
  duration: 2000,
  interruptible: false,
  preconditions: [
    {
      type: 'at_location',
      params: { locationType: 'workplace' },
      check: (context: GoalContext): boolean => {
        return context.npcData.currentLocationId === context.npcData.workLocationId;
      },
    },
    {
      type: 'not_working',
      params: {},
      check: (context: GoalContext): boolean => !context.npcData.isWorking,
    },
  ],
  effects: [
    {
      type: 'set_state',
      params: { isWorking: true },
      apply: () => {},
    },
  ],
  canExecute: (context: GoalContext): boolean => {
    return context.npcData.currentLocationId === context.npcData.workLocationId &&
      !context.npcData.isWorking;
  },
});

// PerformWork
ACTION_DEFINITIONS.set(ActionType.PerformWork, {
  type: ActionType.PerformWork,
  cost: 1,
  duration: 60000, // 1 minute work cycle
  interruptible: true,
  preconditions: [
    {
      type: 'custom',
      params: {},
      check: (context: GoalContext): boolean => context.npcData.isWorking,
    },
  ],
  effects: [
    {
      type: 'modify_need',
      params: { need: 'energy', delta: -5 },
      apply: () => {},
    },
  ],
  canExecute: (context: GoalContext): boolean => context.npcData.isWorking,
});

// Chat (social interaction)
ACTION_DEFINITIONS.set(ActionType.Chat, {
  type: ActionType.Chat,
  cost: 2,
  duration: 10000, // 10 seconds
  interruptible: true,
  preconditions: [],
  effects: [
    {
      type: 'modify_need',
      params: { need: 'social', delta: 20 },
      apply: () => {},
    },
  ],
  canExecute: (context: GoalContext): boolean => context.needs.social < 90,
});

// WanderAround
ACTION_DEFINITIONS.set(ActionType.WanderAround, {
  type: ActionType.WanderAround,
  cost: 1,
  duration: 5000,
  interruptible: true,
  preconditions: [
    {
      type: 'weather_not',
      params: { weatherTypes: ['stormy'] },
      check: (context: GoalContext): boolean => !context.worldState.isOutdoorsDangerous,
    },
  ],
  effects: [
    {
      type: 'modify_need',
      params: { need: 'fun', delta: 5 },
      apply: () => {},
    },
  ],
  canExecute: (context: GoalContext): boolean => !context.worldState.isOutdoorsDangerous,
});

// Idle
ACTION_DEFINITIONS.set(ActionType.Idle, {
  type: ActionType.Idle,
  cost: 0,
  duration: 2000,
  interruptible: true,
  preconditions: [],
  effects: [],
  canExecute: (): boolean => true,
});

// LookAround
ACTION_DEFINITIONS.set(ActionType.LookAround, {
  type: ActionType.LookAround,
  cost: 0,
  duration: 3000,
  interruptible: true,
  preconditions: [],
  effects: [],
  canExecute: (): boolean => true,
});

// ============================================================================
// Action Factory
// ============================================================================

export class ActionFactory {
  /**
   * Create an action instance
   */
  static createAction(type: ActionType, targetPosition?: Vec3, targetLocationId?: string): ActionInstance | null {
    const definition = ACTION_DEFINITIONS.get(type);
    if (!definition) return null;

    return {
      definition,
      status: ActionStatus.Pending,
      startTime: 0,
      elapsedTime: 0,
      targetPosition: targetPosition ?? null,
      targetLocationId: targetLocationId ?? null,
      progress: 0,
      metadata: {},
    };
  }

  /**
   * Get all actions that can satisfy a goal condition
   */
  static getActionsForCondition(condition: GoalCondition, context: GoalContext): ActionType[] {
    const matchingActions: ActionType[] = [];

    switch (condition.type) {
      case 'at_location':
        matchingActions.push(ActionType.MoveTo);
        break;
      case 'is_sheltered':
        matchingActions.push(ActionType.FindShelter, ActionType.EnterBuilding);
        break;
      case 'need_above':
        const need = condition.params.need as string;
        if (need === 'energy') matchingActions.push(ActionType.Sleep);
        if (need === 'hunger') matchingActions.push(ActionType.Eat);
        if (need === 'social') matchingActions.push(ActionType.Chat, ActionType.Greet);
        break;
    }

    // Filter by what can actually execute
    return matchingActions.filter((type) => {
      const def = ACTION_DEFINITIONS.get(type);
      return def && def.canExecute(context);
    });
  }

  /**
   * Calculate distance between two positions
   */
  static getDistance(from: Vec3, to: Vec3): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}

// ============================================================================
// Action Runner
// ============================================================================

export class ActionRunner {
  private currentAction: ActionInstance | null = null;
  private onActionComplete: ((action: ActionInstance, success: boolean) => void) | null = null;

  setActionCompleteCallback(callback: (action: ActionInstance, success: boolean) => void): void {
    this.onActionComplete = callback;
  }

  getCurrentAction(): ActionInstance | null {
    return this.currentAction;
  }

  isRunning(): boolean {
    return this.currentAction !== null && this.currentAction.status === ActionStatus.Running;
  }

  /**
   * Start executing an action
   */
  startAction(action: ActionInstance): boolean {
    if (this.currentAction && this.currentAction.status === ActionStatus.Running) {
      if (!this.currentAction.definition.interruptible) {
        return false; // Cannot interrupt current action
      }
      this.interruptAction();
    }

    this.currentAction = action;
    this.currentAction.status = ActionStatus.Running;
    this.currentAction.startTime = performance.now();
    return true;
  }

  /**
   * Update current action
   */
  update(deltaMs: number, context: GoalContext): void {
    if (!this.currentAction || this.currentAction.status !== ActionStatus.Running) {
      return;
    }

    this.currentAction.elapsedTime += deltaMs;

    // Check if action has duration and is complete
    if (this.currentAction.definition.duration > 0) {
      this.currentAction.progress = Math.min(
        1,
        this.currentAction.elapsedTime / this.currentAction.definition.duration
      );

      if (this.currentAction.progress >= 1) {
        this.completeAction(true);
        return;
      }
    }

    // For movement actions, check if at target
    if (this.currentAction.definition.type === ActionType.MoveTo && this.currentAction.targetPosition) {
      const distance = ActionFactory.getDistance(context.position, this.currentAction.targetPosition);
      if (distance < 0.5) { // Within 0.5 meters
        this.completeAction(true);
      }
    }
  }

  /**
   * Interrupt current action
   */
  interruptAction(): void {
    if (this.currentAction) {
      this.currentAction.status = ActionStatus.Interrupted;
      this.onActionComplete?.(this.currentAction, false);
      this.currentAction = null;
    }
  }

  /**
   * Complete current action
   */
  private completeAction(success: boolean): void {
    if (this.currentAction) {
      this.currentAction.status = success ? ActionStatus.Completed : ActionStatus.Failed;
      this.currentAction.progress = 1;
      this.onActionComplete?.(this.currentAction, success);
      this.currentAction = null;
    }
  }

  /**
   * Fail current action
   */
  failAction(): void {
    this.completeAction(false);
  }
}
