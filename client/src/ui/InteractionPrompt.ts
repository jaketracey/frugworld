/**
 * InteractionPrompt - Shows interaction hints for NPCs
 * Displays for the closest NPC regardless of distance or LOD
 */

import type { Entity } from '@/ecs/Entity.ts';
import { EntityKind } from '@/types/protocol.ts';

export interface InteractionPromptConfig {
  /** Distance threshold for showing prompt */
  interactionDistance: number;
  /** Key to display for interaction */
  interactionKey: string;
  /** Vertical offset above entity */
  verticalOffset: number;
}

const DEFAULT_CONFIG: InteractionPromptConfig = {
  interactionDistance: Infinity, // No distance limit
  interactionKey: 'E',
  verticalOffset: 2.5,
};

export class InteractionPrompt {
  private config: InteractionPromptConfig;
  private container: HTMLElement | null = null;
  private promptElement: HTMLElement | null = null;
  private currentTarget: Entity | null = null;
  private isVisible: boolean = false;

  // Screen projection callback
  private projectToScreen: ((x: number, y: number, z: number) => { x: number; y: number; visible: boolean }) | null = null;

  constructor(config: Partial<InteractionPromptConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the interaction prompt UI
   */
  initialize(parentElement: HTMLElement = document.body): void {
    if (this.container) {
      return;
    }

    this.createDOM(parentElement);
    this.injectStyles();
  }

  /**
   * Set the projection function for converting 3D to screen coordinates
   */
  setProjectionCallback(
    callback: (x: number, y: number, z: number) => { x: number; y: number; visible: boolean }
  ): void {
    this.projectToScreen = callback;
  }

  /**
   * Find and update the interaction target based on player position
   */
  updateTarget(
    playerX: number,
    playerY: number,
    playerZ: number,
    entities: Iterable<Entity>
  ): Entity | null {
    let closestEntity: Entity | null = null;
    let closestDistance = this.config.interactionDistance;

    for (const entity of entities) {
      // Any NPC can be interacted with (no distance/LOD restriction)
      if (entity.kind !== EntityKind.Npc) continue;
      if (!entity.alive || entity.markedForRemoval) continue;

      const distance = entity.distanceTo(playerX, playerY, playerZ);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestEntity = entity;
      }
    }

    this.currentTarget = closestEntity;
    return closestEntity;
  }

  /**
   * Update prompt position and visibility
   */
  update(): void {
    if (!this.container || !this.promptElement) {
      return;
    }

    if (!this.currentTarget || !this.projectToScreen) {
      this.hide();
      return;
    }

    // Get entity position
    const transform = this.currentTarget.transform.getInterpolated();
    const screenPos = this.projectToScreen(
      transform.x,
      transform.y,
      transform.z + this.config.verticalOffset
    );

    if (!screenPos.visible) {
      this.hide();
      return;
    }

    // Update position
    this.promptElement.style.left = `${screenPos.x}px`;
    this.promptElement.style.top = `${screenPos.y}px`;

    this.show();
  }

  /**
   * Get current interaction target
   */
  getTarget(): Entity | null {
    return this.currentTarget;
  }

  /**
   * Check if an entity can be interacted with
   */
  canInteract(entity: Entity): boolean {
    return (
      entity.kind === EntityKind.Npc &&
      entity.alive &&
      !entity.markedForRemoval
    );
  }

  /**
   * Check if there's a valid interaction target
   */
  hasTarget(): boolean {
    return this.currentTarget !== null;
  }

  /**
   * Clear the current target
   */
  clearTarget(): void {
    this.currentTarget = null;
    this.hide();
  }

  /**
   * Cleanup and destroy
   */
  destroy(): void {
    if (this.container?.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
    this.container = null;
    this.promptElement = null;
    this.currentTarget = null;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createDOM(parent: HTMLElement): void {
    this.container = document.createElement('div');
    this.container.id = 'interaction-prompt-container';
    this.container.className = 'interaction-prompt-container';

    this.promptElement = document.createElement('div');
    this.promptElement.className = 'interaction-prompt';
    this.promptElement.innerHTML = `
      <span class="interaction-key">${this.config.interactionKey}</span>
      <span class="interaction-label">Talk</span>
    `;

    this.container.appendChild(this.promptElement);
    parent.appendChild(this.container);
  }

  private injectStyles(): void {
    if (document.getElementById('interaction-prompt-styles')) {
      return;
    }

    const styles = document.createElement('style');
    styles.id = 'interaction-prompt-styles';
    styles.textContent = `
      .interaction-prompt-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 500;
      }

      .interaction-prompt {
        position: absolute;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 16px;
        background: rgba(15, 20, 30, 0.95);
        border: 1px solid rgba(74, 158, 255, 0.4);
        border-radius: 12px;
        transform: translate(-50%, -50%);
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        opacity: 0;
        transition: opacity 0.2s ease;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4), 0 0 20px rgba(74, 158, 255, 0.15);
        backdrop-filter: blur(8px);
      }

      .interaction-prompt.visible {
        opacity: 1;
      }

      .interaction-key {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        background: linear-gradient(135deg, #4a9eff, #3b82f6);
        border-radius: 6px;
        color: #fff;
        font-size: 14px;
        font-weight: 700;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        box-shadow: 0 2px 8px rgba(74, 158, 255, 0.4);
      }

      .interaction-label {
        color: #e2e8f0;
        font-size: 14px;
        font-weight: 500;
        letter-spacing: 0.3px;
      }

      @keyframes promptFloat {
        0%, 100% {
          transform: translate(-50%, -50%) scale(1);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4), 0 0 20px rgba(74, 158, 255, 0.15);
        }
        50% {
          transform: translate(-50%, -52%) scale(1.02);
          box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5), 0 0 30px rgba(74, 158, 255, 0.25);
        }
      }

      .interaction-prompt.visible {
        animation: promptFloat 2.5s ease-in-out infinite;
      }
    `;
    document.head.appendChild(styles);
  }

  private show(): void {
    if (!this.isVisible && this.promptElement) {
      this.promptElement.classList.add('visible');
      this.isVisible = true;
    }
  }

  private hide(): void {
    if (this.isVisible && this.promptElement) {
      this.promptElement.classList.remove('visible');
      this.isVisible = false;
    }
  }
}
