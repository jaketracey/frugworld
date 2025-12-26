/**
 * ActionPlanner - GOAP action planner
 * Finds sequences of actions to achieve goals
 */

import type { Vec3 } from '@/types/protocol.ts';
import type { GoalInstance, GoalContext, GoalCondition } from './Goal.ts';
import { ActionType, ActionFactory, ACTION_DEFINITIONS } from './Action.ts';
import type { ActionInstance, ActionDefinition } from './Action.ts';
import type { Location, LocationType } from './WorldState.ts';

// ============================================================================
// Planner Types
// ============================================================================

export interface ActionPlan {
  /** Goal this plan achieves */
  goal: GoalInstance;
  /** Ordered list of actions to execute */
  actions: ActionInstance[];
  /** Total estimated cost */
  totalCost: number;
  /** Is the plan valid? */
  valid: boolean;
  /** Time plan was created */
  createdAt: number;
}

export interface PlannerConfig {
  /** Maximum planning depth */
  maxDepth: number;
  /** Maximum nodes to explore */
  maxNodes: number;
  /** Plan validity duration in ms */
  planValidityMs: number;
}

const DEFAULT_CONFIG: PlannerConfig = {
  maxDepth: 10,
  maxNodes: 100,
  planValidityMs: 10000, // 10 seconds
};

// ============================================================================
// Planner Node (for A* search)
// ============================================================================

interface PlannerNode {
  /** Current world state (simulated) */
  state: SimulatedState;
  /** Actions taken to reach this state */
  actions: ActionInstance[];
  /** Cost to reach this state */
  gCost: number;
  /** Estimated cost to goal */
  hCost: number;
  /** Total cost (g + h) */
  fCost: number;
  /** Parent node */
  parent: PlannerNode | null;
}

interface SimulatedState {
  position: Vec3;
  currentLocationId: string | null;
  isInShelter: boolean;
  isWorking: boolean;
  isSleeping: boolean;
  needs: {
    energy: number;
    hunger: number;
    social: number;
  };
}

// ============================================================================
// Action Planner
// ============================================================================

export class ActionPlanner {
  private config: PlannerConfig;
  private currentPlan: ActionPlan | null = null;
  private planIndex: number = 0;

  constructor(config: Partial<PlannerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create a plan to achieve a goal
   */
  plan(goal: GoalInstance, context: GoalContext): ActionPlan | null {
    // Check if goal is already satisfied
    if (goal.definition.isSatisfied(context)) {
      return {
        goal,
        actions: [],
        totalCost: 0,
        valid: true,
        createdAt: performance.now(),
      };
    }

    // Build initial state from context
    const initialState = this.buildSimulatedState(context);

    // Use simplified planning based on goal type
    const actions = this.buildActionSequence(goal, context, initialState);

    if (actions.length === 0) {
      return null;
    }

    const totalCost = actions.reduce((sum, a) => sum + a.definition.cost, 0);

    return {
      goal,
      actions,
      totalCost,
      valid: true,
      createdAt: performance.now(),
    };
  }

  /**
   * Build action sequence for a goal (simplified planning)
   */
  private buildActionSequence(
    goal: GoalInstance,
    context: GoalContext,
    _state: SimulatedState
  ): ActionInstance[] {
    const actions: ActionInstance[] = [];
    const targetState = goal.targetState;

    for (const condition of targetState.conditions) {
      const conditionActions = this.getActionsForCondition(condition, context);
      actions.push(...conditionActions);
    }

    return actions;
  }

  /**
   * Get actions needed to satisfy a condition
   */
  private getActionsForCondition(condition: GoalCondition, context: GoalContext): ActionInstance[] {
    const actions: ActionInstance[] = [];

    switch (condition.type) {
      case 'at_location': {
        const locationId = condition.params.locationId as string | undefined;
        const locationType = condition.params.locationType as LocationType | undefined;

        let targetLocation: Location | null = null;

        if (locationId) {
          targetLocation = context.worldState.locations.get(locationId) ?? null;
        } else if (locationType) {
          // Find nearest location of type
          targetLocation = this.findNearestLocation(context, locationType);
        }

        if (targetLocation) {
          const moveAction = ActionFactory.createAction(
            ActionType.MoveTo,
            targetLocation.position,
            targetLocation.id
          );
          if (moveAction) actions.push(moveAction);
        }
        break;
      }

      case 'is_sheltered': {
        if (!context.npcData.isInShelter) {
          // Find nearest shelter
          const shelter = this.findNearestShelter(context);
          if (shelter) {
            const moveAction = ActionFactory.createAction(
              ActionType.MoveTo,
              shelter.position,
              shelter.id
            );
            if (moveAction) actions.push(moveAction);

            const enterAction = ActionFactory.createAction(ActionType.EnterBuilding);
            if (enterAction) actions.push(enterAction);
          }
        }
        break;
      }

      case 'need_above': {
        const need = condition.params.need as string;
        const targetValue = condition.params.value as number;

        if (need === 'energy' && context.needs.energy < targetValue) {
          // Need to sleep - first go home
          if (context.npcData.homeLocationId && context.npcData.currentLocationId !== context.npcData.homeLocationId) {
            const home = context.worldState.locations.get(context.npcData.homeLocationId);
            if (home) {
              const moveAction = ActionFactory.createAction(ActionType.MoveTo, home.position, home.id);
              if (moveAction) actions.push(moveAction);
            }
          }
          const sleepAction = ActionFactory.createAction(ActionType.Sleep);
          if (sleepAction) actions.push(sleepAction);
        }

        if (need === 'hunger' && context.needs.hunger < targetValue) {
          const eatAction = ActionFactory.createAction(ActionType.Eat);
          if (eatAction) actions.push(eatAction);
        }

        if (need === 'social' && context.needs.social < targetValue) {
          const chatAction = ActionFactory.createAction(ActionType.Chat);
          if (chatAction) actions.push(chatAction);
        }
        break;
      }
    }

    return actions;
  }

  /**
   * Find nearest location of a given type
   */
  private findNearestLocation(context: GoalContext, type: LocationType): Location | null {
    let nearest: Location | null = null;
    let nearestDist = Infinity;

    for (const location of context.worldState.locations.values()) {
      if (location.type !== type) continue;

      const dx = context.position.x - location.position.x;
      const dy = context.position.y - location.position.y;
      const dz = context.position.z - location.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = location;
      }
    }

    return nearest;
  }

  /**
   * Find nearest shelter
   */
  private findNearestShelter(context: GoalContext): Location | null {
    let nearest: Location | null = null;
    let nearestDist = Infinity;

    for (const location of context.worldState.locations.values()) {
      if (!location.providesShelter) continue;

      const dx = context.position.x - location.position.x;
      const dy = context.position.y - location.position.y;
      const dz = context.position.z - location.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = location;
      }
    }

    return nearest;
  }

  /**
   * Build simulated state from context
   */
  private buildSimulatedState(context: GoalContext): SimulatedState {
    return {
      position: { ...context.position },
      currentLocationId: context.npcData.currentLocationId,
      isInShelter: context.npcData.isInShelter,
      isWorking: context.npcData.isWorking,
      isSleeping: context.npcData.isSleeping,
      needs: {
        energy: context.needs.energy,
        hunger: context.needs.hunger,
        social: context.needs.social,
      },
    };
  }

  /**
   * Get current plan
   */
  getCurrentPlan(): ActionPlan | null {
    return this.currentPlan;
  }

  /**
   * Set current plan
   */
  setCurrentPlan(plan: ActionPlan | null): void {
    this.currentPlan = plan;
    this.planIndex = 0;
  }

  /**
   * Get next action from plan
   */
  getNextAction(): ActionInstance | null {
    if (!this.currentPlan || this.planIndex >= this.currentPlan.actions.length) {
      return null;
    }
    return this.currentPlan.actions[this.planIndex];
  }

  /**
   * Advance to next action in plan
   */
  advancePlan(): void {
    this.planIndex++;
  }

  /**
   * Check if plan is complete
   */
  isPlanComplete(): boolean {
    return !this.currentPlan || this.planIndex >= this.currentPlan.actions.length;
  }

  /**
   * Check if plan is still valid
   */
  isPlanValid(context: GoalContext): boolean {
    if (!this.currentPlan) return false;

    // Check time validity
    const age = performance.now() - this.currentPlan.createdAt;
    if (age > this.config.planValidityMs) return false;

    // Check if goal is still valid
    if (!this.currentPlan.goal.definition.isValid(context)) return false;

    // Check if goal is already satisfied
    if (this.currentPlan.goal.definition.isSatisfied(context)) return false;

    return true;
  }

  /**
   * Invalidate current plan
   */
  invalidatePlan(): void {
    this.currentPlan = null;
    this.planIndex = 0;
  }
}
