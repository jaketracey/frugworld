/**
 * AI Status Indicator Component
 *
 * A vanilla TypeScript UI component that displays the current status
 * of the AI service and provides controls to start/stop/restart it.
 *
 * This component integrates with the Frugworld HUD style and provides
 * real-time feedback on the AI service connection state.
 */

import {
  getAiStatus,
  startAi,
  stopAi,
  restartAi,
  onAiStatusChange,
  isTauri,
  formatDuration,
  type AiStatus,
} from '../tauri-bridge';

export type AiConnectionState = 'connected' | 'disconnected' | 'connecting' | 'error';

export interface AiStatusIndicatorOptions {
  container: HTMLElement;
  compact?: boolean;
  onStatusChange?: (status: AiStatus) => void;
}

export class AiStatusIndicator {
  private container: HTMLElement;
  private compact: boolean;
  private onStatusChange?: (status: AiStatus) => void;
  private status: AiStatus | null = null;
  private unsubscribeStatus: (() => void) | null = null;
  private element: HTMLElement | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;

  constructor(options: AiStatusIndicatorOptions) {
    this.container = options.container;
    this.compact = options.compact ?? false;
    this.onStatusChange = options.onStatusChange;
  }

  /**
   * Initialize the component and start monitoring
   */
  async mount(): Promise<void> {
    this.element = this.createContainer();
    this.container.appendChild(this.element);

    // Subscribe to status changes
    this.unsubscribeStatus = await onAiStatusChange((status) => {
      this.status = status;
      this.render();
      if (this.onStatusChange) {
        this.onStatusChange(status);
      }
    });

    // Initial status fetch
    await this.refreshStatus();
  }

  /**
   * Clean up resources
   */
  unmount(): void {
    if (this.unsubscribeStatus) {
      this.unsubscribeStatus();
      this.unsubscribeStatus = null;
    }

    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
      this.element = null;
    }
  }

  /**
   * Get the current connection state
   */
  getConnectionState(): AiConnectionState {
    if (!this.status) return 'connecting';
    if (this.status.error) return 'error';
    if (!this.status.running) return 'disconnected';
    if (!this.status.ready) return 'connecting';
    return 'connected';
  }

  /**
   * Refresh status from the backend
   */
  async refreshStatus(): Promise<void> {
    try {
      this.status = await getAiStatus();
      this.reconnectAttempts = 0;
      this.render();

      if (this.onStatusChange) {
        this.onStatusChange(this.status);
      }
    } catch (error) {
      this.reconnectAttempts++;
      this.status = {
        running: false,
        ready: false,
        error: error instanceof Error ? error.message : 'Connection failed',
        pid: null,
        uptime: null,
      };
      this.render();
    }
  }

  /**
   * Handle start button click
   */
  private async handleStart(): Promise<void> {
    try {
      this.setButtonsLoading(true);
      await startAi();
      await this.waitForReady();
    } catch (error) {
      console.error('Failed to start AI service:', error);
    } finally {
      this.setButtonsLoading(false);
    }
  }

  /**
   * Handle stop button click
   */
  private async handleStop(): Promise<void> {
    try {
      this.setButtonsLoading(true);
      await stopAi();
      await this.refreshStatus();
    } catch (error) {
      console.error('Failed to stop AI service:', error);
    } finally {
      this.setButtonsLoading(false);
    }
  }

  /**
   * Handle restart button click
   */
  private async handleRestart(): Promise<void> {
    try {
      this.setButtonsLoading(true);
      await restartAi();
      await this.waitForReady();
    } catch (error) {
      console.error('Failed to restart AI service:', error);
    } finally {
      this.setButtonsLoading(false);
    }
  }

  /**
   * Wait for the AI service to become ready
   */
  private async waitForReady(timeout = 30000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      await this.refreshStatus();

      if (this.status?.ready) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error('Timeout waiting for AI service to become ready');
  }

  /**
   * Set loading state for action buttons
   */
  private setButtonsLoading(loading: boolean): void {
    if (!this.element) return;

    const buttons = this.element.querySelectorAll('.ai-status-btn');
    buttons.forEach((btn) => {
      (btn as HTMLButtonElement).disabled = loading;
    });
  }

  /**
   * Create the main container element
   */
  private createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = `ai-status-indicator ${this.compact ? 'compact' : ''}`;
    container.innerHTML = `
      <style>
        .ai-status-indicator {
          font-family: 'Nunito', sans-serif;
          color: #e2e8f0;
        }

        .ai-status-indicator.compact {
          display: inline-flex;
          align-items: center;
        }

        .ai-status-indicator:not(.compact) {
          background: linear-gradient(135deg, #2d1b4e 0%, #1a1033 100%);
          border: 3px solid var(--color-purple, #8b5cf6);
          border-radius: 16px;
          padding: 16px;
          box-shadow: 0 0 30px rgba(139, 92, 246, 0.3), 0 10px 40px rgba(0, 0, 0, 0.5);
        }

        .ai-status-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }

        .ai-status-title {
          font-family: 'Fredoka', sans-serif;
          font-size: 16px;
          font-weight: 600;
          color: #fbbf24;
          text-shadow: 0 0 10px rgba(251, 191, 36, 0.5);
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .ai-status-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
        }

        .ai-status-badge.connected {
          background: rgba(74, 222, 128, 0.2);
          color: #4ade80;
          border: 1px solid rgba(74, 222, 128, 0.4);
        }

        .ai-status-badge.disconnected {
          background: rgba(248, 113, 113, 0.2);
          color: #f87171;
          border: 1px solid rgba(248, 113, 113, 0.4);
        }

        .ai-status-badge.connecting {
          background: rgba(251, 191, 36, 0.2);
          color: #fbbf24;
          border: 1px solid rgba(251, 191, 36, 0.4);
        }

        .ai-status-badge.error {
          background: rgba(248, 113, 113, 0.2);
          color: #f87171;
          border: 1px solid rgba(248, 113, 113, 0.4);
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          animation: pulse 2s ease-in-out infinite;
        }

        .status-dot.connected {
          background: #4ade80;
          box-shadow: 0 0 8px rgba(74, 222, 128, 0.6);
        }

        .status-dot.disconnected {
          background: #f87171;
          box-shadow: 0 0 8px rgba(248, 113, 113, 0.6);
          animation: none;
        }

        .status-dot.connecting {
          background: #fbbf24;
          box-shadow: 0 0 8px rgba(251, 191, 36, 0.6);
        }

        .status-dot.error {
          background: #f87171;
          box-shadow: 0 0 8px rgba(248, 113, 113, 0.6);
          animation: none;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(0.9); }
        }

        .ai-status-details {
          font-size: 12px;
          color: rgba(196, 181, 253, 0.7);
          margin-bottom: 12px;
        }

        .ai-status-detail-row {
          display: flex;
          justify-content: space-between;
          padding: 4px 0;
        }

        .ai-status-detail-label {
          color: rgba(196, 181, 253, 0.5);
        }

        .ai-status-detail-value {
          color: rgba(196, 181, 253, 0.9);
        }

        .ai-status-error {
          background: rgba(248, 113, 113, 0.1);
          border: 1px solid rgba(248, 113, 113, 0.3);
          border-radius: 8px;
          padding: 10px;
          margin-bottom: 12px;
          font-size: 12px;
          color: #f87171;
        }

        .ai-status-actions {
          display: flex;
          gap: 8px;
        }

        .ai-status-btn {
          padding: 8px 16px;
          border-radius: 10px;
          font-family: 'Nunito', sans-serif;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          border: 2px solid transparent;
          flex: 1;
        }

        .ai-status-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .ai-status-btn-start {
          background: linear-gradient(135deg, #22c55e, #16a34a);
          color: white;
          border-color: #4ade80;
        }

        .ai-status-btn-start:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(34, 197, 94, 0.4);
        }

        .ai-status-btn-stop {
          background: linear-gradient(135deg, #ef4444, #dc2626);
          color: white;
          border-color: #f87171;
        }

        .ai-status-btn-stop:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
        }

        .ai-status-btn-restart {
          background: linear-gradient(135deg, #8b5cf6, #7c3aed);
          color: white;
          border-color: #a78bfa;
        }

        .ai-status-btn-restart:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
        }

        .ai-status-hint {
          margin-top: 10px;
          font-size: 11px;
          color: rgba(196, 181, 253, 0.5);
          text-align: center;
          font-style: italic;
        }

        /* Compact mode styles */
        .ai-status-indicator.compact .ai-status-badge {
          padding: 6px 12px;
          border-radius: 14px;
        }

        .ai-status-indicator.compact .status-dot {
          width: 10px;
          height: 10px;
        }

        /* HUD icon button style for compact mode */
        .ai-status-hud-btn {
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #2d1b4e 0%, #1a1033 100%);
          border: 3px solid var(--color-purple, #8b5cf6);
          border-radius: 16px;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          box-shadow: 0 0 20px rgba(139, 92, 246, 0.3), 0 4px 15px rgba(0, 0, 0, 0.4);
          position: relative;
        }

        .ai-status-hud-btn:hover {
          transform: scale(1.1) translateY(-2px);
          box-shadow: 0 0 30px rgba(139, 92, 246, 0.5), 0 8px 25px rgba(0, 0, 0, 0.5);
          border-color: #a78bfa;
        }

        .ai-status-hud-btn .status-icon {
          font-size: 22px;
        }

        .ai-status-hud-btn .status-tooltip {
          display: none;
          position: absolute;
          bottom: -28px;
          left: 50%;
          transform: translateX(-50%);
          font-family: 'Nunito', sans-serif;
          font-size: 11px;
          font-weight: 600;
          white-space: nowrap;
          background: rgba(26, 16, 51, 0.9);
          padding: 4px 8px;
          border-radius: 6px;
          border: 1px solid rgba(139, 92, 246, 0.3);
        }

        .ai-status-hud-btn:hover .status-tooltip {
          display: block;
        }

        .ai-status-hud-btn.connected {
          border-color: #4ade80;
          box-shadow: 0 0 20px rgba(74, 222, 128, 0.4), 0 4px 15px rgba(0, 0, 0, 0.4);
        }

        .ai-status-hud-btn.connected .status-tooltip {
          color: #4ade80;
        }

        .ai-status-hud-btn.disconnected {
          border-color: #f87171;
          box-shadow: 0 0 20px rgba(248, 113, 113, 0.4), 0 4px 15px rgba(0, 0, 0, 0.4);
        }

        .ai-status-hud-btn.disconnected .status-tooltip {
          color: #f87171;
        }

        .ai-status-hud-btn.connecting {
          border-color: #fbbf24;
          box-shadow: 0 0 20px rgba(251, 191, 36, 0.4), 0 4px 15px rgba(0, 0, 0, 0.4);
          animation: connectingPulse 1.5s ease-in-out infinite;
        }

        .ai-status-hud-btn.connecting .status-tooltip {
          color: #fbbf24;
        }

        @keyframes connectingPulse {
          0%, 100% { box-shadow: 0 0 20px rgba(251, 191, 36, 0.4), 0 4px 15px rgba(0, 0, 0, 0.4); }
          50% { box-shadow: 0 0 35px rgba(251, 191, 36, 0.6), 0 4px 15px rgba(0, 0, 0, 0.4); }
        }
      </style>
      <div class="ai-status-content"></div>
    `;
    return container;
  }

  /**
   * Render the component
   */
  private render(): void {
    if (!this.element) return;

    const content = this.element.querySelector('.ai-status-content');
    if (!content) return;

    const state = this.getConnectionState();
    const canControl = isTauri();

    if (this.compact) {
      content.innerHTML = this.renderCompact(state);
    } else {
      content.innerHTML = this.renderFull(state, canControl);
    }

    // Attach event listeners
    this.attachEventListeners();
  }

  /**
   * Render compact mode (HUD button style)
   */
  private renderCompact(state: AiConnectionState): string {
    const icons: Record<AiConnectionState, string> = {
      connected: '🟢',
      disconnected: '🔴',
      connecting: '🟡',
      error: '🔴',
    };

    const labels: Record<AiConnectionState, string> = {
      connected: 'AI Connected',
      disconnected: 'AI Offline',
      connecting: 'Connecting...',
      error: 'AI Error',
    };

    return `
      <div class="ai-status-hud-btn ${state}">
        <span class="status-icon">${icons[state]}</span>
        <span class="status-tooltip">${labels[state]}</span>
      </div>
    `;
  }

  /**
   * Render full mode (panel style)
   */
  private renderFull(state: AiConnectionState, canControl: boolean): string {
    const labels: Record<AiConnectionState, string> = {
      connected: 'Connected',
      disconnected: 'Offline',
      connecting: 'Connecting',
      error: 'Error',
    };

    const detailsHtml = this.status
      ? `
        <div class="ai-status-details">
          ${
            this.status.pid
              ? `
            <div class="ai-status-detail-row">
              <span class="ai-status-detail-label">Process ID</span>
              <span class="ai-status-detail-value">${this.status.pid}</span>
            </div>
          `
              : ''
          }
          ${
            this.status.uptime !== null
              ? `
            <div class="ai-status-detail-row">
              <span class="ai-status-detail-label">Uptime</span>
              <span class="ai-status-detail-value">${formatDuration(this.status.uptime)}</span>
            </div>
          `
              : ''
          }
          <div class="ai-status-detail-row">
            <span class="ai-status-detail-label">Status</span>
            <span class="ai-status-detail-value">${this.status.ready ? 'Ready' : 'Starting...'}</span>
          </div>
        </div>
      `
      : '';

    const errorHtml =
      this.status?.error
        ? `
      <div class="ai-status-error">
        ${this.status.error}
      </div>
    `
        : '';

    const actionsHtml = canControl
      ? `
      <div class="ai-status-actions">
        ${
          state === 'disconnected' || state === 'error'
            ? `
          <button class="ai-status-btn ai-status-btn-start" data-action="start">
            Start AI
          </button>
        `
            : state === 'connected'
              ? `
          <button class="ai-status-btn ai-status-btn-stop" data-action="stop">
            Stop
          </button>
          <button class="ai-status-btn ai-status-btn-restart" data-action="restart">
            Restart
          </button>
        `
              : `
          <button class="ai-status-btn ai-status-btn-restart" disabled>
            Starting...
          </button>
        `
        }
      </div>
    `
      : `
      <div class="ai-status-hint">
        ${state === 'disconnected' ? 'Start the AI service manually to enable AI features.' : ''}
      </div>
    `;

    return `
      <div class="ai-status-header">
        <div class="ai-status-title">AI Service</div>
        <div class="ai-status-badge ${state}">
          <span class="status-dot ${state}"></span>
          ${labels[state]}
        </div>
      </div>
      ${detailsHtml}
      ${errorHtml}
      ${actionsHtml}
    `;
  }

  /**
   * Attach click event listeners to action buttons
   */
  private attachEventListeners(): void {
    if (!this.element) return;

    const buttons = this.element.querySelectorAll('.ai-status-btn[data-action]');
    buttons.forEach((button) => {
      const btn = button as HTMLButtonElement;
      const action = btn.dataset.action;

      if (!action) return;

      btn.addEventListener('click', async () => {
        switch (action) {
          case 'start':
            await this.handleStart();
            break;
          case 'stop':
            await this.handleStop();
            break;
          case 'restart':
            await this.handleRestart();
            break;
        }
      });
    });

    // Click handler for compact HUD button to show details
    const hudBtn = this.element.querySelector('.ai-status-hud-btn');
    if (hudBtn) {
      hudBtn.addEventListener('click', () => {
        // Could emit an event to show a detailed panel
        console.log('AI Status clicked, current state:', this.getConnectionState());
      });
    }
  }
}

/**
 * Factory function to create and mount an AiStatusIndicator
 */
export function createAiStatusIndicator(options: AiStatusIndicatorOptions): AiStatusIndicator {
  const indicator = new AiStatusIndicator(options);
  indicator.mount();
  return indicator;
}

/**
 * Create a compact HUD-style AI status button
 */
export function createAiStatusHudButton(container: HTMLElement): AiStatusIndicator {
  return createAiStatusIndicator({
    container,
    compact: true,
  });
}
