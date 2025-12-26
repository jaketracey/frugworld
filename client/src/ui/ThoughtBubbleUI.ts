/**
 * ThoughtBubbleUI - Displays random LLM-generated thoughts above Frug
 *
 * Features:
 * - Floating speech bubble positioned above player in 3D space
 * - Fade in/out animations
 * - Random thought intervals (20-60 seconds)
 * - Context-aware thoughts based on game state
 */

export interface ThoughtBubbleConfig {
  /** Minimum time between thoughts (ms) */
  minIntervalMs: number;
  /** Maximum time between thoughts (ms) */
  maxIntervalMs: number;
  /** How long thought stays visible (ms) */
  displayDurationMs: number;
  /** Fade animation duration (ms) */
  fadeDurationMs: number;
  /** Offset above player head (in screen pixels) */
  verticalOffset: number;
}

/** Callback for speaking thoughts aloud via TTS */
export type SpeakThoughtCallback = (text: string) => Promise<void>;

export interface GameContext {
  playerX: number;
  playerY: number;
  playerZ: number;
  nearbyNpcCount: number;
  nearestNpcName: string | null;
  nearestNpcDistance: number | null;
  currentBiome: string;
  timeOfDay: string;
  isMoving: boolean;
  velocity: number;
  // Weather awareness
  weather?: string;
  isRaining?: boolean;
  isStormy?: boolean;
  isSnowing?: boolean;
}

export type ThoughtGeneratorCallback = (context: GameContext) => Promise<string>;
export type ProjectionCallback = (x: number, y: number, z: number) => { x: number; y: number; visible: boolean };

const DEFAULT_CONFIG: ThoughtBubbleConfig = {
  minIntervalMs: 20000,  // 20 seconds minimum
  maxIntervalMs: 45000,  // 45 seconds maximum
  displayDurationMs: 6000,  // Show for 6 seconds
  fadeDurationMs: 500,
  verticalOffset: 30,  // Pixels above player
};

export class ThoughtBubbleUI {
  private config: ThoughtBubbleConfig;
  private container: HTMLElement | null = null;
  private bubble: HTMLElement | null = null;
  private textElement: HTMLElement | null = null;

  // Callbacks
  private generateThought: ThoughtGeneratorCallback | null = null;
  private projectToScreen: ProjectionCallback | null = null;
  private speakThought: SpeakThoughtCallback | null = null;

  // State
  private isVisible: boolean = false;
  private currentThought: string = '';
  private lastContext: GameContext | null = null;

  // Timers
  private nextThoughtTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private isGenerating: boolean = false;

  constructor(config: Partial<ThoughtBubbleConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the thought bubble UI
   */
  initialize(parentElement: HTMLElement = document.body): void {
    if (this.container) return;

    this.createDOM(parentElement);

    // Show first thought after a short delay (3-5 seconds)
    setTimeout(() => {
      this.triggerThought();
    }, 3000 + Math.random() * 2000);
  }

  /**
   * Set the callback for generating thoughts via LLM
   */
  setThoughtGenerator(callback: ThoughtGeneratorCallback): void {
    this.generateThought = callback;
  }

  /**
   * Set the callback for projecting 3D coordinates to screen
   */
  setProjectionCallback(callback: ProjectionCallback): void {
    this.projectToScreen = callback;
  }

  /**
   * Set the callback for speaking thoughts aloud via TTS
   */
  setSpeakCallback(callback: SpeakThoughtCallback): void {
    this.speakThought = callback;
  }

  /**
   * Update game context (call each frame)
   */
  updateContext(context: GameContext): void {
    this.lastContext = context;
  }

  /**
   * Update bubble position (call each frame)
   */
  update(): void {
    if (!this.isVisible || !this.bubble || !this.lastContext || !this.projectToScreen) {
      return;
    }

    // Project player position to screen
    // Game coords (x, y, z) -> Three.js coords (x, z, y) where Y is up
    // Add height offset for bubble to appear above player's head (ball radius ~0.6)
    const projection = this.projectToScreen(
      this.lastContext.playerX,
      this.lastContext.playerZ + 1.2,  // Three.js Y = game Z (up) + offset
      this.lastContext.playerY         // Three.js Z = game Y (forward)
    );

    if (projection.visible) {
      this.bubble.style.display = 'block';
      this.bubble.style.left = `${projection.x}px`;
      this.bubble.style.top = `${projection.y - this.config.verticalOffset}px`;
    } else {
      this.bubble.style.display = 'none';
    }
  }

  /**
   * Force show a specific thought (for testing or events)
   */
  showThought(thought: string): void {
    this.currentThought = thought;
    this.displayThought();
  }

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.nextThoughtTimer) {
      clearTimeout(this.nextThoughtTimer);
    }
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
    }
    if (this.container) {
      this.container.remove();
    }
    this.container = null;
    this.bubble = null;
    this.textElement = null;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createDOM(parent: HTMLElement): void {
    // Container
    this.container = document.createElement('div');
    this.container.id = 'thought-bubble-container';
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 100;
    `;

    // Bubble
    this.bubble = document.createElement('div');
    this.bubble.className = 'thought-bubble';
    this.bubble.style.cssText = `
      position: absolute;
      display: none;
      transform: translate(-50%, -100%);
      max-width: 280px;
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.95);
      border-radius: 16px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      font-family: 'Comic Sans MS', 'Chalkboard SE', cursive, sans-serif;
      font-size: 14px;
      line-height: 1.4;
      color: #333;
      opacity: 0;
      transition: opacity ${this.config.fadeDurationMs}ms ease-in-out;
    `;

    // Add thought bubble tail (pointing down)
    const tail = document.createElement('div');
    tail.style.cssText = `
      position: absolute;
      bottom: -10px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 10px solid transparent;
      border-right: 10px solid transparent;
      border-top: 12px solid rgba(255, 255, 255, 0.95);
    `;
    this.bubble.appendChild(tail);

    // Add thought circles (comic book style)
    const circleContainer = document.createElement('div');
    circleContainer.style.cssText = `
      position: absolute;
      bottom: -25px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
    `;

    [8, 5, 3].forEach(size => {
      const circle = document.createElement('div');
      circle.style.cssText = `
        width: ${size}px;
        height: ${size}px;
        background: rgba(255, 255, 255, 0.9);
        border-radius: 50%;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      `;
      circleContainer.appendChild(circle);
    });
    this.bubble.appendChild(circleContainer);

    // Text element
    this.textElement = document.createElement('div');
    this.textElement.className = 'thought-text';
    this.bubble.appendChild(this.textElement);

    // Add CSS animation for subtle floating effect
    const style = document.createElement('style');
    style.textContent = `
      @keyframes thoughtFloat {
        0%, 100% { transform: translate(-50%, -100%) translateY(0); }
        50% { transform: translate(-50%, -100%) translateY(-5px); }
      }
      .thought-bubble.visible {
        opacity: 1 !important;
        animation: thoughtFloat 3s ease-in-out infinite;
      }
    `;
    document.head.appendChild(style);

    this.container.appendChild(this.bubble);
    parent.appendChild(this.container);
  }

  private scheduleNextThought(): void {
    if (this.nextThoughtTimer) {
      clearTimeout(this.nextThoughtTimer);
    }

    const delay = this.config.minIntervalMs +
      Math.random() * (this.config.maxIntervalMs - this.config.minIntervalMs);

    this.nextThoughtTimer = setTimeout(() => {
      this.triggerThought();
    }, delay);
  }

  private async triggerThought(): Promise<void> {
    if (this.isGenerating) {
      this.scheduleNextThought();
      return;
    }

    // If no context yet, use a default and try anyway
    if (!this.generateThought) {
      console.log('[ThoughtBubble] No thought generator set');
      this.scheduleNextThought();
      return;
    }

    this.isGenerating = true;

    try {
      const context = this.lastContext ?? {
        playerX: 0, playerY: 0, playerZ: 0,
        nearbyNpcCount: 0, nearestNpcName: null, nearestNpcDistance: null,
        currentBiome: 'grassland', timeOfDay: 'day',
        isMoving: false, velocity: 0,
      };

      console.log('[ThoughtBubble] Generating thought...');
      const thought = await this.generateThought(context);
      if (thought && thought.trim()) {
        this.currentThought = thought;
        console.log('[ThoughtBubble] Displaying:', thought);
        this.displayThought();
      }
    } catch (err) {
      console.error('[ThoughtBubble] Failed to generate thought:', err);
    } finally {
      this.isGenerating = false;
      this.scheduleNextThought();
    }
  }

  private displayThought(): void {
    if (!this.bubble || !this.textElement) return;

    this.textElement.textContent = this.currentThought;
    this.isVisible = true;

    // Speak the thought aloud if TTS is enabled
    if (this.speakThought) {
      this.speakThought(this.currentThought).catch((err) => {
        console.warn('[ThoughtBubble] TTS failed:', err);
      });
    }

    // Position the bubble immediately if we have context
    if (this.lastContext && this.projectToScreen) {
      const projection = this.projectToScreen(
        this.lastContext.playerX,
        this.lastContext.playerZ + 1.2,
        this.lastContext.playerY
      );
      if (projection.visible) {
        this.bubble.style.left = `${projection.x}px`;
        this.bubble.style.top = `${projection.y - this.config.verticalOffset}px`;
      }
    } else {
      // Fallback: center at top of screen
      this.bubble.style.left = '50%';
      this.bubble.style.top = '100px';
    }

    // Show with fade in
    this.bubble.style.display = 'block';
    requestAnimationFrame(() => {
      if (this.bubble) {
        this.bubble.classList.add('visible');
      }
    });

    // Schedule hide
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
    }

    this.hideTimer = setTimeout(() => {
      this.hideThought();
    }, this.config.displayDurationMs);
  }

  private hideThought(): void {
    if (!this.bubble) return;

    this.bubble.classList.remove('visible');

    // After fade out, hide completely
    setTimeout(() => {
      if (this.bubble) {
        this.bubble.style.display = 'none';
      }
      this.isVisible = false;
    }, this.config.fadeDurationMs);
  }
}
