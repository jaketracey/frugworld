/**
 * Input capture system for keyboard input
 * Mouse is handled by OrbitControls for camera
 */

import type { Vec2 } from '@/types/protocol.ts';
import { ActionFlags } from '@/types/protocol.ts';

export interface InputState {
  move: Vec2;
  actions: number;
  aimYaw: number;
  mouseX: number;
  mouseY: number;
}

export class InputCapture {
  private keysPressed: Set<string> = new Set();

  constructor(_element: HTMLElement) {
    this.setupListeners();
  }

  /**
   * Get current input state
   */
  getState(): InputState {
    return {
      move: this.calculateMoveVector(),
      actions: this.calculateActions(),
      aimYaw: 0,
      mouseX: 0,
      mouseY: 0,
    };
  }

  /**
   * Check if a specific key is pressed
   */
  isKeyPressed(key: string): boolean {
    return this.keysPressed.has(key.toLowerCase());
  }

  /**
   * Cleanup event listeners
   */
  destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupListeners(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    // Ignore if typing in an input
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    this.keysPressed.add(e.key.toLowerCase());

    // Prevent default for game keys
    if (this.isGameKey(e.key)) {
      e.preventDefault();
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keysPressed.delete(e.key.toLowerCase());
  };

  private handleBlur = (): void => {
    // Clear all keys when window loses focus
    this.keysPressed.clear();
  };

  private calculateMoveVector(): Vec2 {
    let x = 0;
    let y = 0;

    // WASD movement
    if (this.keysPressed.has('w') || this.keysPressed.has('arrowup')) {
      y += 1;
    }
    if (this.keysPressed.has('s') || this.keysPressed.has('arrowdown')) {
      y -= 1;
    }
    if (this.keysPressed.has('a') || this.keysPressed.has('arrowleft')) {
      x -= 1;
    }
    if (this.keysPressed.has('d') || this.keysPressed.has('arrowright')) {
      x += 1;
    }

    // Normalize diagonal movement
    const length = Math.sqrt(x * x + y * y);
    if (length > 1) {
      x /= length;
      y /= length;
    }

    return { x, y };
  }

  private calculateActions(): number {
    let actions = 0;

    if (this.keysPressed.has(' ')) {
      actions |= ActionFlags.JUMP;
    }
    if (this.keysPressed.has('e') || this.keysPressed.has('f')) {
      actions |= ActionFlags.INTERACT;
    }
    if (this.keysPressed.has('shift')) {
      actions |= ActionFlags.SPRINT;
    }
    if (this.keysPressed.has('control') || this.keysPressed.has('c')) {
      actions |= ActionFlags.CROUCH;
    }

    return actions;
  }

  private isGameKey(key: string): boolean {
    const gameKeys = [
      'w',
      'a',
      's',
      'd',
      ' ',
      'e',
      'f',
      'shift',
      'control',
      'c',
      'arrowup',
      'arrowdown',
      'arrowleft',
      'arrowright',
    ];
    return gameKeys.includes(key.toLowerCase());
  }
}
