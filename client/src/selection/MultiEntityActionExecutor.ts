/**
 * MultiEntityActionExecutor - Execute actions on multiple selected entities
 * Handles hidden success rolls and visual feedback
 */

import type { Entity } from '@/ecs/Entity.ts';
import type { RadialMenuAction } from '@/ui/RadialActionMenu.ts';

export interface ActionExecution {
  entityId: number;
  action: RadialMenuAction;
  successRoll: number; // Hidden 0-100
  succeeded: boolean;
  outcomeMessage?: string;
}

export interface MultiEntityActionExecutorConfig {
  /** Base success chance (0-100) */
  baseSuccessChance: number;
  /** Delay between revealing each entity's outcome (ms) */
  feedbackDelayMs: number;
  /** Duration to show feedback indicators (ms) */
  indicatorDurationMs: number;
}

const DEFAULT_CONFIG: MultiEntityActionExecutorConfig = {
  baseSuccessChance: 70,
  feedbackDelayMs: 300,
  indicatorDurationMs: 1500,
};

export type ExecutionCompleteCallback = (executions: ActionExecution[]) => void;
export type FeedbackCallback = (entityId: number, succeeded: boolean, message?: string) => void;

export class MultiEntityActionExecutor {
  private config: MultiEntityActionExecutorConfig;
  private container: HTMLElement | null = null;
  private activeIndicators: Map<number, HTMLElement> = new Map();

  private onExecutionComplete: ExecutionCompleteCallback | null = null;
  private onFeedback: FeedbackCallback | null = null;

  constructor(config: Partial<MultiEntityActionExecutorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the executor
   */
  initialize(parentElement: HTMLElement = document.body): void {
    if (this.container) return;

    this.container = document.createElement('div');
    this.container.id = 'action-feedback-container';
    this.container.className = 'action-feedback-container';

    this.injectStyles();
    parentElement.appendChild(this.container);
  }

  /**
   * Set callback for when all executions complete
   */
  setExecutionCompleteCallback(callback: ExecutionCompleteCallback): void {
    this.onExecutionComplete = callback;
  }

  /**
   * Set callback for individual feedback events
   */
  setFeedbackCallback(callback: FeedbackCallback): void {
    this.onFeedback = callback;
  }

  /**
   * Execute an action on multiple entities
   */
  async executeOnSelection(
    entities: Entity[],
    action: RadialMenuAction,
    getScreenPosition: (entity: Entity) => { x: number; y: number } | null
  ): Promise<ActionExecution[]> {
    const executions: ActionExecution[] = [];

    // Calculate success for each entity
    for (const entity of entities) {
      const success = this.calculateSuccess(action, entity);
      const roll = Math.floor(Math.random() * 100);

      executions.push({
        entityId: entity.id,
        action,
        successRoll: roll,
        succeeded: success,
        outcomeMessage: success ? 'Success!' : 'Failed',
      });
    }

    // Reveal outcomes with staggered timing
    await this.revealOutcomes(executions, getScreenPosition, entities);

    // Notify completion
    this.onExecutionComplete?.(executions);

    return executions;
  }

  /**
   * Cleanup and destroy
   */
  destroy(): void {
    // Clear all active indicators
    for (const indicator of this.activeIndicators.values()) {
      indicator.remove();
    }
    this.activeIndicators.clear();

    if (this.container?.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
    this.container = null;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Calculate success based on action and entity state
   */
  private calculateSuccess(action: RadialMenuAction, entity: Entity): boolean {
    const baseChance = this.config.baseSuccessChance;
    const modifier = (action.parameters?.successModifier as number) ?? 0;

    // Could add more factors based on entity state, distance, relationships, etc.
    const adjustedChance = Math.max(0, Math.min(100, baseChance + modifier));
    const roll = Math.random() * 100;

    return roll <= adjustedChance;
  }

  /**
   * Reveal outcomes with staggered visual feedback
   */
  private async revealOutcomes(
    executions: ActionExecution[],
    getScreenPosition: (entity: Entity) => { x: number; y: number } | null,
    entities: Entity[]
  ): Promise<void> {
    for (let i = 0; i < executions.length; i++) {
      const exec = executions[i];
      const entity = entities.find(e => e.id === exec.entityId);

      if (entity) {
        const screenPos = getScreenPosition(entity);
        if (screenPos) {
          this.showFeedbackIndicator(exec.entityId, screenPos.x, screenPos.y, exec.succeeded);
        }
      }

      // Notify callback
      this.onFeedback?.(exec.entityId, exec.succeeded, exec.outcomeMessage);

      // Wait before showing next
      if (i < executions.length - 1) {
        await this.sleep(this.config.feedbackDelayMs);
      }
    }
  }

  /**
   * Show a visual indicator for action outcome
   */
  private showFeedbackIndicator(
    entityId: number,
    x: number,
    y: number,
    succeeded: boolean
  ): void {
    if (!this.container) return;

    // Remove existing indicator for this entity
    const existing = this.activeIndicators.get(entityId);
    if (existing) {
      existing.remove();
    }

    // Create new indicator
    const indicator = document.createElement('div');
    indicator.className = `action-result-indicator ${succeeded ? 'success' : 'failure'}`;
    indicator.textContent = succeeded ? '✓' : '✗';
    indicator.style.left = `${x}px`;
    indicator.style.top = `${y}px`;

    this.container.appendChild(indicator);
    this.activeIndicators.set(entityId, indicator);

    // Trigger animation
    requestAnimationFrame(() => {
      indicator.classList.add('animate');
    });

    // Remove after duration
    setTimeout(() => {
      indicator.classList.add('fade-out');
      setTimeout(() => {
        indicator.remove();
        this.activeIndicators.delete(entityId);
      }, 300);
    }, this.config.indicatorDurationMs);
  }

  private injectStyles(): void {
    if (document.getElementById('action-feedback-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'action-feedback-styles';
    styles.textContent = `
      .action-feedback-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 1200;
      }

      .action-result-indicator {
        position: absolute;
        transform: translate(-50%, -100%);
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 16px;
        font-weight: bold;
        opacity: 0;
        transition: all 0.3s ease;
        pointer-events: none;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
      }

      .action-result-indicator.success {
        background: linear-gradient(135deg, #22c55e, #16a34a);
        color: white;
        box-shadow: 0 2px 12px rgba(34, 197, 94, 0.5);
      }

      .action-result-indicator.failure {
        background: linear-gradient(135deg, #ef4444, #dc2626);
        color: white;
        box-shadow: 0 2px 12px rgba(239, 68, 68, 0.5);
      }

      .action-result-indicator.animate {
        opacity: 1;
        transform: translate(-50%, -120%);
      }

      .action-result-indicator.fade-out {
        opacity: 0;
        transform: translate(-50%, -150%);
      }
    `;
    document.head.appendChild(styles);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
