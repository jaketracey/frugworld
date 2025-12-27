/**
 * MultiplayerPanel - Displays connected players and their stats
 * Toggle with Tab key
 */

import { animate, spring } from '@motionone/dom';

export interface MultiplayerPanelConfig {
  animationDuration: number;
  maxPlayersDisplayed: number;
}

export interface PlayerInfo {
  entityId: bigint;
  name: string;
  connectedAt: number;
  seeds?: number;
  level?: number;
  distance?: number;
}

const DEFAULT_CONFIG: MultiplayerPanelConfig = {
  animationDuration: 0.3,
  maxPlayersDisplayed: 20,
};

export class MultiplayerPanel {
  private config: MultiplayerPanelConfig;
  private container: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private isVisible: boolean = false;
  private players: Map<bigint, PlayerInfo> = new Map();
  private localPlayerId: bigint | null = null;
  private localPlayerPosition: { x: number; y: number } | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(config: Partial<MultiplayerPanelConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  initialize(): void {
    // Create overlay
    this.overlay = document.createElement('div');
    this.overlay.className = 'multiplayer-panel-overlay';
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.hide();
      }
    });
    document.body.appendChild(this.overlay);

    // Create container
    this.container = document.createElement('div');
    this.container.id = 'multiplayer-panel';
    this.container.className = 'multiplayer-panel';
    this.overlay.appendChild(this.container);

    // Keyboard handler for Tab toggle and Escape close
    this.keydownHandler = (e: KeyboardEvent) => {
      // Don't toggle if user is typing in an input
      const activeEl = document.activeElement;
      const isTyping = activeEl instanceof HTMLInputElement ||
                       activeEl instanceof HTMLTextAreaElement;

      if (e.key === 'Tab' && !isTyping) {
        e.preventDefault();
        this.toggle();
      } else if (e.key === 'Escape' && this.isVisible) {
        this.hide();
      }
    };
    document.addEventListener('keydown', this.keydownHandler);

    this.injectStyles();
  }

  private injectStyles(): void {
    const styleId = 'multiplayer-panel-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Overlay */
      .multiplayer-panel-overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(2px);
        z-index: 900;
        justify-content: flex-end;
        align-items: flex-start;
        padding: 20px;
      }

      .multiplayer-panel-overlay.visible {
        display: flex;
      }

      /* Panel Container */
      .multiplayer-panel {
        display: none;
        width: 320px;
        max-height: calc(100vh - 40px);
        background: linear-gradient(135deg, #2d1b4e 0%, #1a1033 100%);
        border: 2px solid var(--color-purple, #8b5cf6);
        border-radius: 16px;
        overflow: hidden;
        box-shadow:
          0 0 0 1px rgba(0, 0, 0, 0.3),
          0 0 40px rgba(139, 92, 246, 0.3),
          0 10px 40px rgba(0, 0, 0, 0.5);
        z-index: 901;
      }

      .multiplayer-panel.visible {
        display: flex;
        flex-direction: column;
      }

      /* Header */
      .mp-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        background: linear-gradient(90deg, rgba(139, 92, 246, 0.3) 0%, rgba(59, 130, 246, 0.2) 100%);
        border-bottom: 2px solid rgba(139, 92, 246, 0.3);
      }

      .mp-title {
        font-family: 'Fredoka', sans-serif;
        font-size: 16px;
        font-weight: 600;
        color: var(--color-gold, #fbbf24);
        text-shadow: 0 0 10px rgba(251, 191, 36, 0.4);
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .mp-player-count {
        font-family: 'Nunito', sans-serif;
        font-size: 12px;
        color: rgba(196, 181, 253, 0.8);
        background: rgba(139, 92, 246, 0.2);
        padding: 4px 10px;
        border-radius: 12px;
        border: 1px solid rgba(139, 92, 246, 0.3);
      }

      .mp-close {
        width: 28px;
        height: 28px;
        background: linear-gradient(135deg, #ef4444, #dc2626);
        border: 2px solid #fca5a5;
        border-radius: 8px;
        color: white;
        font-size: 16px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }

      .mp-close:hover {
        transform: scale(1.1) rotate(90deg);
        box-shadow: 0 4px 15px rgba(239, 68, 68, 0.4);
      }

      /* Content Area */
      .mp-content {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
      }

      /* Player List */
      .mp-player-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      /* Player Card */
      .mp-player-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 12px;
        border: 1px solid rgba(139, 92, 246, 0.15);
        transition: all 0.2s;
      }

      .mp-player-card:hover {
        background: rgba(139, 92, 246, 0.1);
        border-color: rgba(139, 92, 246, 0.3);
        transform: translateX(4px);
      }

      .mp-player-card.is-you {
        border-color: rgba(251, 191, 36, 0.4);
        background: rgba(251, 191, 36, 0.1);
      }

      .mp-player-avatar {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        flex-shrink: 0;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }

      .mp-player-info {
        flex: 1;
        min-width: 0;
      }

      .mp-player-name {
        font-family: 'Fredoka', sans-serif;
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text, #e2e8f0);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .mp-player-name .you-badge {
        font-size: 10px;
        color: var(--color-gold, #fbbf24);
        background: rgba(251, 191, 36, 0.2);
        padding: 2px 6px;
        border-radius: 6px;
      }

      .mp-player-stats {
        display: flex;
        gap: 12px;
        margin-top: 4px;
      }

      .mp-player-stat {
        display: flex;
        align-items: center;
        gap: 4px;
        font-family: 'Nunito', sans-serif;
        font-size: 11px;
        color: rgba(196, 181, 253, 0.7);
      }

      .mp-player-stat-icon {
        font-size: 12px;
      }

      .mp-player-stat-value {
        color: var(--color-text, #e2e8f0);
        font-weight: 600;
      }

      /* Empty State */
      .mp-empty-state {
        text-align: center;
        padding: 40px 20px;
        color: rgba(196, 181, 253, 0.5);
        font-size: 14px;
      }

      .mp-empty-state-icon {
        font-size: 48px;
        margin-bottom: 12px;
        opacity: 0.5;
      }

      /* Footer hint */
      .mp-footer {
        padding: 10px 16px;
        background: rgba(0, 0, 0, 0.2);
        border-top: 1px solid rgba(139, 92, 246, 0.2);
        text-align: center;
      }

      .mp-footer-hint {
        font-family: 'Nunito', sans-serif;
        font-size: 11px;
        color: rgba(196, 181, 253, 0.5);
      }

      .mp-footer-hint kbd {
        background: rgba(139, 92, 246, 0.2);
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid rgba(139, 92, 246, 0.3);
        font-family: monospace;
      }
    `;
    document.head.appendChild(style);
  }

  setLocalPlayerId(id: bigint): void {
    this.localPlayerId = id;
    if (this.isVisible) {
      this.render();
    }
  }

  setLocalPlayerPosition(x: number, y: number): void {
    this.localPlayerPosition = { x, y };
  }

  updatePlayer(info: PlayerInfo): void {
    this.players.set(info.entityId, info);
    if (this.isVisible) {
      this.render();
    }
  }

  removePlayer(entityId: bigint): void {
    this.players.delete(entityId);
    if (this.isVisible) {
      this.render();
    }
  }

  updatePlayerPosition(entityId: bigint, x: number, y: number): void {
    const player = this.players.get(entityId);
    if (player && this.localPlayerPosition) {
      const dx = x - this.localPlayerPosition.x;
      const dy = y - this.localPlayerPosition.y;
      player.distance = Math.sqrt(dx * dx + dy * dy);
    }
  }

  updatePlayerStats(entityId: bigint, seeds?: number, level?: number): void {
    const player = this.players.get(entityId);
    if (player) {
      if (seeds !== undefined) player.seeds = seeds;
      if (level !== undefined) player.level = level;
      if (this.isVisible) {
        this.render();
      }
    }
  }

  toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    if (!this.container || !this.overlay) return;

    this.isVisible = true;
    this.render();

    this.overlay.classList.add('visible');
    this.container.classList.add('visible');

    animate(
      this.container,
      {
        opacity: [0, 1],
        transform: ['translateX(20px)', 'translateX(0)'],
      },
      {
        duration: this.config.animationDuration,
        easing: spring({ stiffness: 400, damping: 25 }),
      }
    );
  }

  hide(): void {
    if (!this.container || !this.overlay || !this.isVisible) return;

    this.isVisible = false;

    animate(
      this.container,
      {
        opacity: [1, 0],
        transform: ['translateX(0)', 'translateX(20px)'],
      },
      {
        duration: 0.2,
        easing: 'ease-out',
      }
    ).finished.then(() => {
      this.overlay?.classList.remove('visible');
      this.container?.classList.remove('visible');
    });
  }

  isOpen(): boolean {
    return this.isVisible;
  }

  private render(): void {
    if (!this.container) return;

    const playerCount = this.players.size;
    const playersArray = Array.from(this.players.values())
      .slice(0, this.config.maxPlayersDisplayed)
      .sort((a, b) => {
        // Local player first, then by distance
        if (a.entityId === this.localPlayerId) return -1;
        if (b.entityId === this.localPlayerId) return 1;
        return (a.distance ?? Infinity) - (b.distance ?? Infinity);
      });

    this.container.innerHTML = `
      <div class="mp-header">
        <div class="mp-title">
          <span>Players Online</span>
          <span class="mp-player-count">${playerCount}</span>
        </div>
        <button class="mp-close" id="mp-close">×</button>
      </div>
      <div class="mp-content">
        ${playerCount > 0 ? `
          <div class="mp-player-list">
            ${playersArray.map(player => this.renderPlayerCard(player)).join('')}
          </div>
        ` : `
          <div class="mp-empty-state">
            <div class="mp-empty-state-icon">👥</div>
            <div>No other players online</div>
          </div>
        `}
      </div>
      <div class="mp-footer">
        <div class="mp-footer-hint">Press <kbd>Tab</kbd> to close</div>
      </div>
    `;

    // Setup close button
    const closeBtn = this.container.querySelector('#mp-close');
    closeBtn?.addEventListener('click', () => this.hide());
  }

  private renderPlayerCard(player: PlayerInfo): string {
    const isYou = player.entityId === this.localPlayerId;
    const avatarColor = this.getAvatarColor(player.entityId);
    const connectedTime = this.formatConnectedTime(player.connectedAt);

    return `
      <div class="mp-player-card ${isYou ? 'is-you' : ''}">
        <div class="mp-player-avatar" style="background: ${avatarColor};">
          🐸
        </div>
        <div class="mp-player-info">
          <div class="mp-player-name">
            ${this.escapeHtml(player.name)}
            ${isYou ? '<span class="you-badge">YOU</span>' : ''}
          </div>
          <div class="mp-player-stats">
            ${player.seeds !== undefined ? `
              <div class="mp-player-stat">
                <span class="mp-player-stat-icon">🌱</span>
                <span class="mp-player-stat-value">${player.seeds}</span>
              </div>
            ` : ''}
            ${player.level !== undefined ? `
              <div class="mp-player-stat">
                <span class="mp-player-stat-icon">⭐</span>
                <span class="mp-player-stat-value">Lv.${player.level}</span>
              </div>
            ` : ''}
            ${!isYou && player.distance !== undefined ? `
              <div class="mp-player-stat">
                <span class="mp-player-stat-icon">📍</span>
                <span class="mp-player-stat-value">${Math.round(player.distance)}m</span>
              </div>
            ` : ''}
            <div class="mp-player-stat">
              <span class="mp-player-stat-icon">⏱️</span>
              <span class="mp-player-stat-value">${connectedTime}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private getAvatarColor(entityId: bigint): string {
    // Generate consistent color from entity ID
    const hue = Number(entityId % BigInt(360));
    return `linear-gradient(135deg, hsl(${hue}, 70%, 45%) 0%, hsl(${hue}, 60%, 35%) 100%)`;
  }

  private formatConnectedTime(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just joined';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  destroy(): void {
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }

    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    this.container = null;
    this.players.clear();

    const styleEl = document.getElementById('multiplayer-panel-styles');
    styleEl?.remove();
  }
}
