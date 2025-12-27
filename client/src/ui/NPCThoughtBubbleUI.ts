/**
 * NPCThoughtBubbleUI - Displays thought bubbles above NPCs
 * Similar to ThoughtBubbleUI but manages multiple bubbles for NPCs
 */

import type { TerrainHeightProvider } from '@/terrain/index.ts';

// Height offset for NPCs to sit on terrain (matches NPCRenderer)
const NPC_HEIGHT_OFFSET = 1.0;

export interface NPCThoughtBubbleConfig {
  fadeDurationMs: number;
  verticalOffset: number;
  maxBubbles: number;
}

const DEFAULT_CONFIG: NPCThoughtBubbleConfig = {
  fadeDurationMs: 300,
  verticalOffset: 40,
  maxBubbles: 10,
};

interface BubbleData {
  element: HTMLElement;
  textElement: HTMLElement;
  visible: boolean;
}

type ProjectionCallback = (x: number, y: number, z: number) => { x: number; y: number; visible: boolean };

export class NPCThoughtBubbleUI {
  private config: NPCThoughtBubbleConfig;
  private container: HTMLElement | null = null;
  private bubbles: Map<number, BubbleData> = new Map();
  private projectToScreen: ProjectionCallback | null = null;
  private npcPositions: Map<number, { x: number; y: number; z: number }> = new Map();
  private terrainProvider: TerrainHeightProvider | null = null;

  constructor(config: Partial<NPCThoughtBubbleConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the UI
   */
  initialize(parent: HTMLElement): void {
    if (this.container) return;

    this.container = document.createElement('div');
    this.container.id = 'npc-thought-bubbles';
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 90;
    `;

    this.injectStyles();
    parent.appendChild(this.container);
  }

  /**
   * Set projection callback for world-to-screen coordinates
   */
  setProjectionCallback(callback: ProjectionCallback): void {
    this.projectToScreen = callback;
  }

  /**
   * Set terrain provider for ground height sampling
   * Ensures thought bubbles appear at correct height on terrain
   */
  setTerrainProvider(provider: TerrainHeightProvider): void {
    this.terrainProvider = provider;
  }

  /**
   * Update NPC position for bubble placement
   */
  updateNpcPosition(npcId: number, x: number, y: number, z: number): void {
    this.npcPositions.set(npcId, { x, y, z });
  }

  /**
   * Remove NPC position tracking
   */
  removeNpc(npcId: number): void {
    this.npcPositions.delete(npcId);
    this.hideThought(npcId);
    const bubble = this.bubbles.get(npcId);
    if (bubble) {
      bubble.element.remove();
      this.bubbles.delete(npcId);
    }
  }

  /**
   * Show a thought for an NPC
   */
  showThought(npcId: number, thought: string): void {
    if (!this.container) return;

    let bubble = this.bubbles.get(npcId);
    if (!bubble) {
      bubble = this.createBubble(npcId);
      this.bubbles.set(npcId, bubble);
    }

    bubble.textElement.textContent = thought;
    bubble.visible = true;
    bubble.element.style.display = 'block';

    // Trigger reflow for animation
    void bubble.element.offsetHeight;
    bubble.element.classList.add('visible');
  }

  /**
   * Hide a thought for an NPC
   */
  hideThought(npcId: number): void {
    const bubble = this.bubbles.get(npcId);
    if (!bubble) return;

    bubble.visible = false;
    bubble.element.classList.remove('visible');

    setTimeout(() => {
      if (!bubble.visible) {
        bubble.element.style.display = 'none';
      }
    }, this.config.fadeDurationMs);
  }

  /**
   * Update bubble positions - call every frame
   */
  update(): void {
    if (!this.projectToScreen) return;

    for (const [npcId, bubble] of this.bubbles) {
      if (!bubble.visible) continue;

      const pos = this.npcPositions.get(npcId);
      if (!pos) {
        bubble.element.style.display = 'none';
        continue;
      }

      // Calculate ground height same as NPCRenderer does
      let groundZ = pos.z;
      if (this.terrainProvider) {
        const terrainHeight = this.terrainProvider.getHeightAt(pos.x, pos.y);
        groundZ = Math.max(pos.z, terrainHeight + NPC_HEIGHT_OFFSET);
      }

      // Project NPC position to screen (add height offset for bubble above head)
      const projection = this.projectToScreen(
        pos.x,
        groundZ + 2.0, // Above NPC's head (on terrain-adjusted position)
        pos.y
      );

      if (projection.visible) {
        bubble.element.style.display = 'block';
        bubble.element.style.left = `${projection.x}px`;
        bubble.element.style.top = `${projection.y - this.config.verticalOffset}px`;
      } else {
        bubble.element.style.display = 'none';
      }
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    for (const bubble of this.bubbles.values()) {
      bubble.element.remove();
    }
    this.bubbles.clear();
    this.container?.remove();
    this.container = null;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createBubble(npcId: number): BubbleData {
    const element = document.createElement('div');
    element.className = 'npc-thought-bubble';
    element.style.cssText = `
      position: absolute;
      display: none;
      transform: translate(-50%, -100%);
      max-width: 200px;
      padding: 10px 14px;
      background: rgba(255, 255, 200, 0.95);
      border-radius: 14px;
      box-shadow: 0 3px 15px rgba(0, 0, 0, 0.2);
      font-family: 'Comic Sans MS', 'Chalkboard SE', cursive, sans-serif;
      font-size: 13px;
      line-height: 1.3;
      color: #444;
      opacity: 0;
      transition: opacity ${this.config.fadeDurationMs}ms ease-in-out;
    `;

    // Thought bubble tail
    const tail = document.createElement('div');
    tail.style.cssText = `
      position: absolute;
      bottom: -8px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 8px solid transparent;
      border-right: 8px solid transparent;
      border-top: 10px solid rgba(255, 255, 200, 0.95);
    `;
    element.appendChild(tail);

    // Thought circles
    const circles = document.createElement('div');
    circles.className = 'thought-circles';
    circles.style.cssText = `
      position: absolute;
      bottom: -20px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    `;
    [6, 4].forEach((size) => {
      const circle = document.createElement('div');
      circle.style.cssText = `
        width: ${size}px;
        height: ${size}px;
        background: rgba(255, 255, 200, 0.9);
        border-radius: 50%;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
      `;
      circles.appendChild(circle);
    });
    element.appendChild(circles);

    // Text element
    const textElement = document.createElement('div');
    textElement.className = 'npc-thought-text';
    element.appendChild(textElement);

    this.container?.appendChild(element);

    return { element, textElement, visible: false };
  }

  private injectStyles(): void {
    if (document.getElementById('npc-thought-styles')) return;

    const style = document.createElement('style');
    style.id = 'npc-thought-styles';
    style.textContent = `
      .npc-thought-bubble.visible {
        opacity: 1 !important;
        animation: npcThoughtFloat 2.5s ease-in-out infinite;
      }

      @keyframes npcThoughtFloat {
        0%, 100% { transform: translate(-50%, -100%) translateY(0); }
        50% { transform: translate(-50%, -100%) translateY(-4px); }
      }
    `;
    document.head.appendChild(style);
  }
}
