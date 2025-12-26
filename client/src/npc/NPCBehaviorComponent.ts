/**
 * NPCBehaviorComponent - ECS component integrating GOAP behavior system
 * Manages goals, actions, and decision-making for individual NPCs
 */

import type { Vec3, EntityId } from '@/types/protocol.ts';
import type { WorldStateSnapshot, Location, TimePeriod } from './WorldState.ts';
import { WorldState } from './WorldState.ts';
import { GoalFactory, GoalType } from './Goal.ts';
import type { GoalInstance, GoalContext, NPCSchedule } from './Goal.ts';
import { ActionPlanner } from './ActionPlanner.ts';
import type { ActionPlan } from './ActionPlanner.ts';
import { ActionRunner, ActionFactory, ActionType, ActionStatus } from './Action.ts';
import type { ActionInstance } from './Action.ts';
import { NPCNeedsManager } from './NPCNeeds.ts';
import type { NPCNeeds } from './NPCNeeds.ts';
import type { NPCType, NPCTypeDefinition } from './NPCTypes.ts';

// ============================================================================
// Component Configuration
// ============================================================================

export interface NPCBehaviorConfig {
  /** How often to re-evaluate goals (ms) */
  goalEvaluationIntervalMs: number;
  /** How often to update needs (ms) */
  needsUpdateIntervalMs: number;
  /** Movement speed (m/s) */
  movementSpeed: number;
  /** Whether to log debug info */
  debug: boolean;
}

const DEFAULT_CONFIG: NPCBehaviorConfig = {
  goalEvaluationIntervalMs: 1000,
  needsUpdateIntervalMs: 100,
  movementSpeed: 2.5,
  debug: false,
};

// ============================================================================
// Behavior State
// ============================================================================

export interface NPCBehaviorState {
  currentGoal: GoalInstance | null;
  currentPlan: ActionPlan | null;
  currentAction: ActionInstance | null;
  isInShelter: boolean;
  isWorking: boolean;
  isSleeping: boolean;
  currentLocationId: string | null;
  homeLocationId: string | null;
  workLocationId: string | null;
  schedule: NPCSchedule;
  lastGoalEvaluation: number;
  lastNeedsUpdate: number;
}

// ============================================================================
// NPCBehaviorComponent
// ============================================================================

export class NPCBehaviorComponent {
  private entityId: EntityId;
  private config: NPCBehaviorConfig;

  // Position (updated externally by transform component)
  private position: Vec3 = { x: 0, y: 0, z: 0 };
  private targetPosition: Vec3 | null = null;
  private moveDirection: Vec3 = { x: 0, y: 0, z: 0 };

  // Behavior systems
  private needsManager: NPCNeedsManager;
  private planner: ActionPlanner;
  private actionRunner: ActionRunner;

  // State
  private state: NPCBehaviorState;

  // NPC type for extensibility
  private npcType: NPCTypeDefinition | null = null;

  // World state reference
  private worldState: WorldState | null = null;

  // Callbacks
  private onGoalChanged: ((goal: GoalInstance | null) => void) | null = null;
  private onActionChanged: ((action: ActionInstance | null) => void) | null = null;
  private onStateChanged: ((state: NPCBehaviorState) => void) | null = null;

  constructor(entityId: EntityId, config: Partial<NPCBehaviorConfig> = {}) {
    this.entityId = entityId;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.needsManager = new NPCNeedsManager();
    this.planner = new ActionPlanner();
    this.actionRunner = new ActionRunner();

    this.state = {
      currentGoal: null,
      currentPlan: null,
      currentAction: null,
      isInShelter: false,
      isWorking: false,
      isSleeping: false,
      currentLocationId: null,
      homeLocationId: null,
      workLocationId: null,
      schedule: this.createDefaultSchedule(),
      lastGoalEvaluation: 0,
      lastNeedsUpdate: 0,
    };

    // Set up action completion callback
    this.actionRunner.setActionCompleteCallback((action, success) => {
      this.onActionComplete(action, success);
    });
  }

  // ============================================================================
  // Setup Methods
  // ============================================================================

  /**
   * Set the world state reference
   */
  setWorldState(worldState: WorldState): void {
    this.worldState = worldState;
  }

  /**
   * Set NPC type definition
   */
  setNPCType(typeDefinition: NPCTypeDefinition): void {
    this.npcType = typeDefinition;

    // Apply type-specific modifications
    if (typeDefinition.scheduleModifier) {
      this.state.schedule = typeDefinition.scheduleModifier(this.state.schedule);
    }

    if (typeDefinition.initialNeeds) {
      for (const [need, value] of Object.entries(typeDefinition.initialNeeds)) {
        this.needsManager.setNeed(need as keyof NPCNeeds, value);
      }
    }
  }

  /**
   * Set home location
   */
  setHomeLocation(locationId: string): void {
    this.state.homeLocationId = locationId;
  }

  /**
   * Set work location
   */
  setWorkLocation(locationId: string): void {
    this.state.workLocationId = locationId;
  }

  /**
   * Set custom schedule
   */
  setSchedule(schedule: Partial<NPCSchedule>): void {
    this.state.schedule = { ...this.state.schedule, ...schedule };
  }

  /**
   * Set position (called by transform component)
   */
  setPosition(x: number, y: number, z: number): void {
    this.position.x = x;
    this.position.y = y;
    this.position.z = z;
  }

  // ============================================================================
  // Callbacks
  // ============================================================================

  setGoalChangedCallback(callback: (goal: GoalInstance | null) => void): void {
    this.onGoalChanged = callback;
  }

  setActionChangedCallback(callback: (action: ActionInstance | null) => void): void {
    this.onActionChanged = callback;
  }

  setStateChangedCallback(callback: (state: NPCBehaviorState) => void): void {
    this.onStateChanged = callback;
  }

  // ============================================================================
  // Update Loop
  // ============================================================================

  /**
   * Main update method - called every frame
   */
  update(deltaMs: number): void {
    if (!this.worldState) return;

    const now = performance.now();

    // Update needs
    if (now - this.state.lastNeedsUpdate >= this.config.needsUpdateIntervalMs) {
      this.updateNeeds(deltaMs);
      this.state.lastNeedsUpdate = now;
    }

    // Update current location
    this.updateCurrentLocation();

    // Evaluate goals periodically
    if (now - this.state.lastGoalEvaluation >= this.config.goalEvaluationIntervalMs) {
      this.evaluateGoals();
      this.state.lastGoalEvaluation = now;
    }

    // Execute current action
    this.executeCurrentAction(deltaMs);

    // Update movement
    this.updateMovement(deltaMs);
  }

  /**
   * Update NPC needs
   */
  private updateNeeds(deltaMs: number): void {
    // Update state on needs manager
    this.needsManager.setSleeping(this.state.isSleeping);
    this.needsManager.setInShelter(this.state.isInShelter);

    // Apply weather effects if outdoors
    if (!this.state.isInShelter && this.worldState) {
      const weather = this.worldState.getWeather();
      this.needsManager.applyWeatherEffects(true, weather.temperature, weather.type);
    }

    // Update needs over time
    this.needsManager.update(deltaMs);
  }

  /**
   * Update current location based on position
   */
  private updateCurrentLocation(): void {
    if (!this.worldState) return;

    const location = this.worldState.getLocationAt(this.position);
    const newLocationId = location?.id ?? null;

    if (newLocationId !== this.state.currentLocationId) {
      this.state.currentLocationId = newLocationId;
      this.state.isInShelter = location?.providesShelter ?? false;

      this.onStateChanged?.(this.state);
    }
  }

  /**
   * Evaluate and select goals
   */
  private evaluateGoals(): void {
    if (!this.worldState) return;

    const context = this.buildGoalContext();

    // Check if current goal is still valid and highest priority
    if (this.state.currentGoal) {
      // Check if satisfied
      if (this.state.currentGoal.definition.isSatisfied(context)) {
        this.clearCurrentGoal();
      }
      // Check if still valid
      else if (!this.state.currentGoal.definition.isValid(context)) {
        this.clearCurrentGoal();
      }
    }

    // Get highest priority goal
    const newGoal = GoalFactory.getHighestPriorityGoal(context);

    // Check if we should switch goals
    if (newGoal) {
      const shouldSwitch = this.shouldSwitchGoal(newGoal, context);
      if (shouldSwitch) {
        this.setCurrentGoal(newGoal);
      }
    }

    // If we have a goal but no plan, create one
    if (this.state.currentGoal && !this.state.currentPlan) {
      this.createPlan();
    }
  }

  /**
   * Check if we should switch to a new goal
   */
  private shouldSwitchGoal(newGoal: GoalInstance, context: GoalContext): boolean {
    if (!this.state.currentGoal) return true;

    // New goal has significantly higher priority
    const priorityDiff = newGoal.priority - this.state.currentGoal.priority;
    if (priorityDiff > 20) return true;

    // Current goal is satisfied
    if (this.state.currentGoal.definition.isSatisfied(context)) return true;

    // Current goal is no longer valid
    if (!this.state.currentGoal.definition.isValid(context)) return true;

    // New goal can interrupt current
    if (newGoal.priority > this.state.currentGoal.definition.interruptThreshold) {
      return true;
    }

    return false;
  }

  /**
   * Set current goal and invalidate existing plan
   */
  private setCurrentGoal(goal: GoalInstance): void {
    this.state.currentGoal = goal;
    this.planner.invalidatePlan();
    this.state.currentPlan = null;

    if (this.config.debug) {
      console.log(`[NPC ${this.entityId}] New goal: ${goal.definition.type} (priority: ${goal.priority})`);
    }

    this.onGoalChanged?.(goal);
    this.onStateChanged?.(this.state);
  }

  /**
   * Clear current goal
   */
  private clearCurrentGoal(): void {
    this.state.currentGoal = null;
    this.planner.invalidatePlan();
    this.state.currentPlan = null;

    this.onGoalChanged?.(null);
    this.onStateChanged?.(this.state);
  }

  /**
   * Create a plan for current goal
   */
  private createPlan(): void {
    if (!this.state.currentGoal || !this.worldState) return;

    const context = this.buildGoalContext();
    const plan = this.planner.plan(this.state.currentGoal, context);

    if (plan && plan.valid) {
      this.state.currentPlan = plan;
      this.planner.setCurrentPlan(plan);

      if (this.config.debug) {
        console.log(`[NPC ${this.entityId}] Plan created: ${plan.actions.length} actions`);
      }
    }
  }

  /**
   * Execute current action from plan
   */
  private executeCurrentAction(deltaMs: number): void {
    if (!this.worldState) return;

    const context = this.buildGoalContext();

    // Check if current action is complete
    if (!this.actionRunner.isRunning()) {
      // Get next action from plan
      const nextAction = this.planner.getNextAction();

      if (nextAction) {
        // Start the action
        const started = this.actionRunner.startAction(nextAction);
        if (started) {
          this.state.currentAction = nextAction;
          this.onActionChanged?.(nextAction);

          // Handle movement actions
          if (nextAction.definition.type === ActionType.MoveTo && nextAction.targetPosition) {
            this.targetPosition = nextAction.targetPosition;
          }

          if (this.config.debug) {
            console.log(`[NPC ${this.entityId}] Starting action: ${nextAction.definition.type}`);
          }
        }
      } else if (this.planner.isPlanComplete()) {
        // Plan complete, clear it
        this.state.currentPlan = null;
        this.planner.setCurrentPlan(null);
      }
    }

    // Update running action
    this.actionRunner.update(deltaMs, context);
  }

  /**
   * Handle action completion
   */
  private onActionComplete(action: ActionInstance, success: boolean): void {
    if (this.config.debug) {
      console.log(`[NPC ${this.entityId}] Action complete: ${action.definition.type} (success: ${success})`);
    }

    // Apply action effects
    if (success) {
      this.applyActionEffects(action);
    }

    // Advance plan
    this.planner.advancePlan();

    // Clear movement target
    if (action.definition.type === ActionType.MoveTo) {
      this.targetPosition = null;
    }

    this.state.currentAction = null;
    this.onActionChanged?.(null);
  }

  /**
   * Apply effects of completed action
   */
  private applyActionEffects(action: ActionInstance): void {
    switch (action.definition.type) {
      case ActionType.EnterBuilding:
        this.state.isInShelter = true;
        break;
      case ActionType.ExitBuilding:
        this.state.isInShelter = false;
        break;
      case ActionType.Sleep:
        this.needsManager.setNeed('energy', 100);
        this.state.isSleeping = false;
        break;
      case ActionType.Eat:
        this.needsManager.modifyNeed('hunger', 40);
        break;
      case ActionType.Chat:
        this.needsManager.modifyNeed('social', 20);
        break;
      case ActionType.StartWork:
        this.state.isWorking = true;
        break;
      case ActionType.StopWork:
        this.state.isWorking = false;
        break;
    }

    this.onStateChanged?.(this.state);
  }

  /**
   * Update movement towards target
   */
  private updateMovement(deltaMs: number): void {
    if (!this.targetPosition) {
      this.moveDirection = { x: 0, y: 0, z: 0 };
      return;
    }

    const dx = this.targetPosition.x - this.position.x;
    const dy = this.targetPosition.y - this.position.y;
    const dz = this.targetPosition.z - this.position.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (distance < 0.5) {
      // Arrived at target
      this.targetPosition = null;
      this.moveDirection = { x: 0, y: 0, z: 0 };
      return;
    }

    // Calculate movement direction
    const moveSpeed = this.config.movementSpeed * (deltaMs / 1000);
    const moveAmount = Math.min(distance, moveSpeed);

    this.moveDirection = {
      x: (dx / distance) * moveAmount,
      y: (dy / distance) * moveAmount,
      z: (dz / distance) * moveAmount,
    };
  }

  // ============================================================================
  // Public Getters
  // ============================================================================

  /**
   * Get movement direction for this frame
   */
  getMoveDirection(): Vec3 {
    return this.moveDirection;
  }

  /**
   * Get current state
   */
  getState(): Readonly<NPCBehaviorState> {
    return this.state;
  }

  /**
   * Get current needs
   */
  getNeeds(): NPCNeeds {
    return this.needsManager.getNeeds();
  }

  /**
   * Get current goal
   */
  getCurrentGoal(): GoalInstance | null {
    return this.state.currentGoal;
  }

  /**
   * Get current action
   */
  getCurrentAction(): ActionInstance | null {
    return this.state.currentAction;
  }

  /**
   * Check if NPC is moving
   */
  isMoving(): boolean {
    return this.targetPosition !== null;
  }

  /**
   * Get target position
   */
  getTargetPosition(): Vec3 | null {
    return this.targetPosition;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Build goal context from current state
   */
  private buildGoalContext(): GoalContext {
    return {
      position: { ...this.position },
      needs: this.needsManager.getNeeds(),
      worldState: this.worldState!.getSnapshot(),
      npcData: {
        homeLocationId: this.state.homeLocationId,
        workLocationId: this.state.workLocationId,
        currentLocationId: this.state.currentLocationId,
        isInShelter: this.state.isInShelter,
        isSleeping: this.state.isSleeping,
        isWorking: this.state.isWorking,
        schedule: this.state.schedule,
      },
    };
  }

  /**
   * Create default schedule
   */
  private createDefaultSchedule(): NPCSchedule {
    return {
      workStart: 0.35, // 8:24 AM (game time 0.35 = morning)
      workEnd: 0.65, // 3:36 PM
      sleepStart: 0.85, // 8:24 PM
      sleepEnd: 0.25, // 6:00 AM
      daysOff: [0, 6], // Sunday, Saturday
    };
  }

  /**
   * Force immediate goal re-evaluation
   */
  forceGoalEvaluation(): void {
    this.state.lastGoalEvaluation = 0;
  }

  /**
   * Interrupt current action
   */
  interruptCurrentAction(): void {
    this.actionRunner.interruptAction();
  }

  /**
   * Serialize behavior state for persistence
   */
  serialize(): object {
    return {
      needs: this.needsManager.serialize(),
      state: {
        isInShelter: this.state.isInShelter,
        isWorking: this.state.isWorking,
        isSleeping: this.state.isSleeping,
        currentLocationId: this.state.currentLocationId,
        homeLocationId: this.state.homeLocationId,
        workLocationId: this.state.workLocationId,
        schedule: this.state.schedule,
      },
    };
  }

  /**
   * Deserialize behavior state from persistence
   */
  deserialize(data: { needs: NPCNeeds; state: Partial<NPCBehaviorState> }): void {
    this.needsManager.deserialize(data.needs);
    Object.assign(this.state, data.state);
  }
}
