/**
 * RadialActionMenu - Circular menu UI with LLM-generated actions
 * Displays action buttons in a circle around a central voice command button
 */

export interface RadialMenuAction {
  id: string;
  label: string;
  icon: string; // Emoji or icon
  description: string;
  actionType: string;
  parameters?: Record<string, unknown>;
}

export interface RadialActionMenuConfig {
  /** Radius from center to action buttons (px) */
  radius: number;
  /** Size of action buttons (px) */
  actionButtonSize: number;
  /** Size of center voice button (px) */
  voiceButtonSize: number;
  /** Animation duration (ms) */
  animationDurationMs: number;
}

const DEFAULT_CONFIG: RadialActionMenuConfig = {
  radius: 140,
  actionButtonSize: 130,
  voiceButtonSize: 80,
  animationDurationMs: 200,
};

export type ActionSelectCallback = (action: RadialMenuAction) => void;
export type VoiceClickCallback = () => void;
export type VoiceConfirmCallback = (transcribedText: string) => void;
export type MenuCloseCallback = () => void;

export class RadialActionMenu {
  private config: RadialActionMenuConfig;
  private container: HTMLElement | null = null;
  private menuElement: HTMLElement | null = null;
  private voiceButton: HTMLElement | null = null;
  private voicePreview: HTMLElement | null = null;
  private actionButtons: HTMLElement[] = [];

  private isVisible: boolean = false;
  private isRecording: boolean = false;
  private currentActions: RadialMenuAction[] = [];
  private transcribedText: string = '';

  // Callbacks
  private onActionSelect: ActionSelectCallback | null = null;
  private onVoiceClick: VoiceClickCallback | null = null;
  private onVoiceConfirm: VoiceConfirmCallback | null = null;
  private onClose: MenuCloseCallback | null = null;

  constructor(config: Partial<RadialActionMenuConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the radial menu by creating DOM elements
   */
  initialize(parentElement: HTMLElement = document.body): void {
    if (this.container) return;

    this.createDOM(parentElement);
    this.injectStyles();
    this.setupEventListeners();
  }

  /**
   * Set callback for action button clicks
   */
  setActionSelectCallback(callback: ActionSelectCallback): void {
    this.onActionSelect = callback;
  }

  /**
   * Set callback for voice button click
   */
  setVoiceClickCallback(callback: VoiceClickCallback): void {
    this.onVoiceClick = callback;
  }

  /**
   * Set callback for voice command confirmation
   */
  setVoiceConfirmCallback(callback: VoiceConfirmCallback): void {
    this.onVoiceConfirm = callback;
  }

  /**
   * Set callback for menu close
   */
  setCloseCallback(callback: MenuCloseCallback): void {
    this.onClose = callback;
  }

  /**
   * Open the radial menu at a position with actions
   */
  open(x: number, y: number, actions: RadialMenuAction[]): void {
    if (!this.container || !this.menuElement) return;

    this.currentActions = actions;
    this.isVisible = true;

    // Clamp position to viewport
    const menuRadius = this.config.radius + this.config.actionButtonSize / 2 + 20;
    const adjustedX = Math.max(menuRadius, Math.min(window.innerWidth - menuRadius, x));
    const adjustedY = Math.max(menuRadius, Math.min(window.innerHeight - menuRadius, y));

    // Position menu
    this.menuElement.style.left = `${adjustedX}px`;
    this.menuElement.style.top = `${adjustedY}px`;

    // Create action buttons
    this.createActionButtons(actions, adjustedX, adjustedY);

    // Show menu
    this.container.classList.add('visible');
    this.menuElement.classList.add('open');

    // Animate buttons in with stagger
    this.animateButtonsIn();
  }

  /**
   * Close the radial menu
   */
  close(): void {
    if (!this.container || !this.menuElement) return;

    this.isVisible = false;
    this.isRecording = false;
    this.transcribedText = '';

    // Animate buttons out with reverse stagger
    this.animateButtonsOut();
    this.hideVoicePreview();

    // Wait for button animations, then hide container
    const totalAnimTime = this.actionButtons.length * 30 + 250;
    setTimeout(() => {
      this.menuElement?.classList.remove('open');
      this.container?.classList.remove('visible');
      this.clearActionButtons();
    }, totalAnimTime);

    this.onClose?.();
  }

  /**
   * Check if menu is currently open
   */
  isOpen(): boolean {
    return this.isVisible;
  }

  /**
   * Update voice recording state
   */
  setVoiceRecording(isRecording: boolean): void {
    this.isRecording = isRecording;

    if (this.voiceButton) {
      if (isRecording) {
        this.voiceButton.classList.add('recording');
      } else {
        this.voiceButton.classList.remove('recording');
      }
    }
  }

  /**
   * Show voice command preview for confirmation
   */
  showVoicePreview(text: string): void {
    this.transcribedText = text;

    if (!this.voicePreview) return;

    const textEl = this.voicePreview.querySelector('.voice-preview-text');
    if (textEl) {
      textEl.textContent = `"${text}"`;
    }

    this.voicePreview.classList.add('visible');
  }

  /**
   * Hide voice preview
   */
  hideVoicePreview(): void {
    this.voicePreview?.classList.remove('visible');
    this.transcribedText = '';
  }

  /**
   * Update actions (e.g., after voice command)
   */
  updateActions(actions: RadialMenuAction[]): void {
    if (!this.isVisible || !this.menuElement) return;

    const rect = this.menuElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    this.currentActions = actions;
    this.clearActionButtons();
    this.createActionButtons(actions, centerX, centerY);
    this.animateButtonsIn();
  }

  /**
   * Cleanup and destroy
   */
  destroy(): void {
    if (this.container?.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
    this.container = null;
    this.menuElement = null;
    this.voiceButton = null;
    this.voicePreview = null;
    this.actionButtons = [];
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createDOM(parent: HTMLElement): void {
    this.container = document.createElement('div');
    this.container.id = 'radial-menu-container';
    this.container.className = 'radial-menu-container';

    this.container.innerHTML = `
      <div class="radial-menu">
        <button class="radial-voice-button" type="button" aria-label="Voice command">
          <span class="voice-icon">🎤</span>
        </button>
        <div class="voice-preview">
          <div class="voice-preview-text"></div>
          <div class="voice-preview-buttons">
            <button class="voice-confirm" type="button">Confirm</button>
            <button class="voice-cancel" type="button">Cancel</button>
          </div>
        </div>
        <button class="radial-close-button" type="button" aria-label="Close menu">&times;</button>
      </div>
    `;

    this.menuElement = this.container.querySelector('.radial-menu');
    this.voiceButton = this.container.querySelector('.radial-voice-button');
    this.voicePreview = this.container.querySelector('.voice-preview');

    parent.appendChild(this.container);
  }

  private injectStyles(): void {
    if (document.getElementById('radial-menu-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'radial-menu-styles';
    styles.textContent = `
      .radial-menu-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 1100;
        opacity: 0;
        transition: opacity ${this.config.animationDurationMs}ms ease;
      }

      .radial-menu-container.visible {
        opacity: 1;
        pointer-events: auto;
      }

      .radial-menu {
        position: absolute;
        transform: translate(-50%, -50%);
      }

      .radial-menu.open .radial-voice-button {
        animation: voiceButtonEntrance 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      }

      @keyframes voiceButtonEntrance {
        0% {
          transform: translate(-50%, -50%) scale(0) rotate(-180deg);
          opacity: 0;
        }
        100% {
          transform: translate(-50%, -50%) scale(1) rotate(0deg);
          opacity: 1;
        }
      }

      .radial-voice-button {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%) scale(0);
        opacity: 0;
        width: ${this.config.voiceButtonSize}px;
        height: ${this.config.voiceButtonSize}px;
        border-radius: 50%;
        background: linear-gradient(135deg, #8b5cf6, #7c3aed);
        border: 2px solid rgba(139, 92, 246, 0.6);
        color: #fff;
        font-size: 28px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow:
          0 4px 20px rgba(139, 92, 246, 0.4),
          0 0 30px rgba(139, 92, 246, 0.2);
        transition:
          box-shadow 0.2s ease,
          background 0.2s ease,
          border-color 0.2s ease;
        z-index: 10;
      }

      .radial-voice-button:hover {
        transform: translate(-50%, -50%) scale(1.1) !important;
        box-shadow:
          0 6px 24px rgba(139, 92, 246, 0.5),
          0 0 40px rgba(139, 92, 246, 0.3);
      }

      .radial-voice-button:active {
        transform: translate(-50%, -50%) scale(0.95) !important;
      }

      .radial-voice-button.recording {
        animation: voicePulse 1s ease-in-out infinite !important;
        background: linear-gradient(135deg, #f87171, #ef4444);
        border-color: rgba(248, 113, 113, 0.6);
        box-shadow:
          0 4px 20px rgba(248, 113, 113, 0.4),
          0 0 30px rgba(248, 113, 113, 0.2);
      }

      @keyframes voicePulse {
        0%, 100% { transform: translate(-50%, -50%) scale(1); }
        50% { transform: translate(-50%, -50%) scale(1.15); }
      }

      .radial-close-button {
        position: absolute;
        top: -${this.config.radius + 30}px;
        left: 50%;
        transform: translateX(-50%);
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: rgba(248, 113, 113, 0.2);
        border: 1px solid rgba(248, 113, 113, 0.4);
        color: #f87171;
        font-size: 18px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
      }

      .radial-close-button:hover {
        background: rgba(248, 113, 113, 0.3);
        border-color: rgba(248, 113, 113, 0.6);
      }

      .radial-action-button {
        position: absolute;
        width: ${this.config.actionButtonSize}px;
        height: ${this.config.actionButtonSize}px;
        border-radius: 50%;
        background: linear-gradient(135deg, #2d1b4e 0%, #1a1033 100%);
        border: 3px solid #8b5cf6;
        color: #e2e8f0;
        font-size: 12px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        backdrop-filter: blur(8px);
        box-shadow:
          0 0 0 1px rgba(0, 0, 0, 0.3),
          0 0 30px rgba(139, 92, 246, 0.3),
          0 4px 20px rgba(0, 0, 0, 0.4);
        /* Start from center with scale 0 and rotated */
        transform: translate(-50%, -50%) scale(0) rotate(-180deg);
        opacity: 0;
        transition:
          transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1),
          opacity 0.3s ease,
          box-shadow 0.2s ease,
          background 0.2s ease,
          border-color 0.2s ease;
        padding: 8px;
        text-align: center;
        overflow: hidden;
      }

      .radial-action-button.visible {
        transform: translate(-50%, -50%) scale(1) rotate(0deg);
        opacity: 1;
      }

      .radial-action-button:hover {
        background: linear-gradient(135deg, #3d2b5e 0%, #2a1a43 100%);
        border-color: #a78bfa;
        box-shadow:
          0 0 0 1px rgba(0, 0, 0, 0.3),
          0 0 40px rgba(139, 92, 246, 0.5),
          0 4px 20px rgba(0, 0, 0, 0.4);
        transform: translate(-50%, -50%) scale(1.15) rotate(0deg);
      }

      .radial-action-button:active {
        transform: translate(-50%, -50%) scale(0.95) rotate(0deg);
        transition: transform 0.1s ease;
      }

      /* Closing animation */
      .radial-action-button.closing {
        transform: translate(-50%, -50%) scale(0) rotate(180deg) !important;
        opacity: 0 !important;
        transition:
          transform 0.25s cubic-bezier(0.55, 0, 1, 0.45),
          opacity 0.2s ease !important;
      }

      .radial-action-button .action-icon {
        font-size: 32px;
        line-height: 1;
      }

      .radial-action-button .action-label {
        font-size: 20px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }

      .voice-preview {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(135deg, #2d1b4e 0%, #1a1033 100%);
        border: 2px solid rgba(139, 92, 246, 0.5);
        border-radius: 12px;
        padding: 16px 20px;
        min-width: 220px;
        text-align: center;
        backdrop-filter: blur(12px);
        box-shadow:
          0 0 30px rgba(139, 92, 246, 0.3),
          0 8px 32px rgba(0, 0, 0, 0.5);
        opacity: 0;
        pointer-events: none;
        transition: all 0.2s ease;
        z-index: 20;
      }

      .voice-preview.visible {
        opacity: 1;
        pointer-events: auto;
      }

      .voice-preview-text {
        color: rgba(196, 181, 253, 0.9);
        font-style: italic;
        font-size: 14px;
        margin-bottom: 14px;
        line-height: 1.4;
      }

      .voice-preview-buttons {
        display: flex;
        gap: 10px;
        justify-content: center;
      }

      .voice-confirm,
      .voice-cancel {
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        border: 1px solid;
      }

      .voice-confirm {
        background: linear-gradient(135deg, #22c55e, #16a34a);
        border-color: rgba(34, 197, 94, 0.5);
        color: #fff;
      }

      .voice-confirm:hover {
        background: linear-gradient(135deg, #4ade80, #22c55e);
        box-shadow: 0 0 12px rgba(34, 197, 94, 0.4);
      }

      .voice-cancel {
        background: rgba(139, 92, 246, 0.2);
        border-color: rgba(139, 92, 246, 0.4);
        color: rgba(196, 181, 253, 0.8);
      }

      .voice-cancel:hover {
        background: rgba(139, 92, 246, 0.3);
        border-color: rgba(139, 92, 246, 0.6);
      }
    `;
    document.head.appendChild(styles);
  }

  private setupEventListeners(): void {
    // Voice button click
    this.voiceButton?.addEventListener('click', () => {
      if (!this.isRecording) {
        this.onVoiceClick?.();
      }
    });

    // Voice confirm
    const confirmBtn = this.voicePreview?.querySelector('.voice-confirm');
    confirmBtn?.addEventListener('click', () => {
      if (this.transcribedText) {
        this.onVoiceConfirm?.(this.transcribedText);
        this.hideVoicePreview();
      }
    });

    // Voice cancel
    const cancelBtn = this.voicePreview?.querySelector('.voice-cancel');
    cancelBtn?.addEventListener('click', () => {
      this.hideVoicePreview();
    });

    // Close button
    const closeBtn = this.container?.querySelector('.radial-close-button');
    closeBtn?.addEventListener('click', () => {
      this.close();
    });

    // Click outside to close
    this.container?.addEventListener('click', (e) => {
      if (e.target === this.container) {
        this.close();
      }
    });

    // Escape to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isVisible) {
        this.close();
      }
    });
  }

  private createActionButtons(actions: RadialMenuAction[], centerX: number, centerY: number): void {
    if (!this.menuElement) return;

    const angleStep = (2 * Math.PI) / Math.max(actions.length, 1);
    const startAngle = -Math.PI / 2; // Start from top

    actions.forEach((action, i) => {
      const angle = startAngle + i * angleStep;
      const x = Math.cos(angle) * this.config.radius;
      const y = Math.sin(angle) * this.config.radius;

      const button = document.createElement('button');
      button.className = 'radial-action-button';
      button.type = 'button';
      button.dataset.actionId = action.id;
      button.title = action.description;
      button.style.left = `calc(50% + ${x}px)`;
      button.style.top = `calc(50% + ${y}px)`;

      button.innerHTML = `
        <span class="action-icon">${action.icon}</span>
        <span class="action-label">${action.label}</span>
      `;

      button.addEventListener('click', () => {
        this.onActionSelect?.(action);
        this.close();
      });

      this.menuElement!.appendChild(button);
      this.actionButtons.push(button);
    });
  }

  private animateButtonsIn(): void {
    this.actionButtons.forEach((button, i) => {
      setTimeout(() => {
        button.classList.add('visible');
      }, i * 100 + 80); // Stagger by 100ms, delay first by 80ms for voice button
    });
  }

  private animateButtonsOut(): void {
    // Reverse order for closing animation
    const buttons = [...this.actionButtons].reverse();
    buttons.forEach((button, i) => {
      setTimeout(() => {
        button.classList.remove('visible');
        button.classList.add('closing');
      }, i * 50); // Faster stagger on close
    });
  }

  private clearActionButtons(): void {
    this.actionButtons.forEach((button) => button.remove());
    this.actionButtons = [];
  }
}
