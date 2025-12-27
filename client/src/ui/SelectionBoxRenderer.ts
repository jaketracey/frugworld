/**
 * SelectionBoxRenderer - Visual rectangle overlay during drag selection
 * Creates a Tron-styled selection box on the DOM
 */

export interface SelectionBoxRendererConfig {
  /** Animation duration in milliseconds */
  animationDurationMs: number;
}

const DEFAULT_CONFIG: SelectionBoxRendererConfig = {
  animationDurationMs: 150,
};

export class SelectionBoxRenderer {
  private config: SelectionBoxRendererConfig;
  private container: HTMLElement | null = null;
  private boxElement: HTMLElement | null = null;
  private isVisible: boolean = false;

  constructor(config: Partial<SelectionBoxRendererConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the renderer by creating DOM elements
   */
  initialize(parentElement: HTMLElement = document.body): void {
    if (this.container) return;

    this.createDOM(parentElement);
    this.injectStyles();
  }

  /**
   * Show the selection box
   */
  show(): void {
    if (!this.boxElement) return;
    this.isVisible = true;
    this.boxElement.style.display = 'block';
  }

  /**
   * Hide the selection box
   */
  hide(): void {
    if (!this.boxElement) return;
    this.isVisible = false;
    this.boxElement.style.display = 'none';
  }

  /**
   * Update the selection box position and size
   */
  update(startX: number, startY: number, endX: number, endY: number): void {
    if (!this.boxElement) return;

    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);

    this.boxElement.style.left = `${left}px`;
    this.boxElement.style.top = `${top}px`;
    this.boxElement.style.width = `${width}px`;
    this.boxElement.style.height = `${height}px`;
  }

  /**
   * Check if box is currently visible
   */
  getIsVisible(): boolean {
    return this.isVisible;
  }

  /**
   * Cleanup and destroy
   */
  destroy(): void {
    if (this.container?.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
    this.container = null;
    this.boxElement = null;
    this.isVisible = false;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createDOM(parent: HTMLElement): void {
    this.container = document.createElement('div');
    this.container.id = 'selection-box-container';

    this.boxElement = document.createElement('div');
    this.boxElement.className = 'selection-box';
    this.boxElement.style.display = 'none';

    this.container.appendChild(this.boxElement);
    parent.appendChild(this.container);
  }

  private injectStyles(): void {
    if (document.getElementById('selection-box-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'selection-box-styles';
    styles.textContent = `
      #selection-box-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 100;
      }

      .selection-box {
        position: fixed;
        border: 2px solid rgba(74, 158, 255, 0.8);
        background: rgba(74, 158, 255, 0.1);
        box-shadow:
          0 0 10px rgba(74, 158, 255, 0.3),
          inset 0 0 10px rgba(74, 158, 255, 0.1);
        pointer-events: none;
        z-index: 100;
        transition: opacity ${this.config.animationDurationMs}ms ease;
      }

      /* Corner accents for Tron style */
      .selection-box::before,
      .selection-box::after {
        content: '';
        position: absolute;
        width: 12px;
        height: 12px;
        border: 2px solid rgba(74, 158, 255, 1);
      }

      .selection-box::before {
        top: -2px;
        left: -2px;
        border-right: none;
        border-bottom: none;
      }

      .selection-box::after {
        bottom: -2px;
        right: -2px;
        border-left: none;
        border-top: none;
      }
    `;
    document.head.appendChild(styles);
  }
}
