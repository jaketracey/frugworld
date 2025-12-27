/**
 * FrugStatsPanel - Displays detailed Frug stats in a popup panel
 * Styled consistently with the expanded minimap/world map
 */

import { animate, spring } from '@motionone/dom';
import {
  FrugState,
  getMoodEmoji,
  getMoodDisplayName,
  getMoodColor,
  getStatColor,
  getStatIcon,
  MoodType,
} from '../state/FrugState';

export interface FrugStatsPanelConfig {
  animationDuration: number;
}

const DEFAULT_CONFIG: FrugStatsPanelConfig = {
  animationDuration: 0.4,
};

export class FrugStatsPanel {
  private config: FrugStatsPanelConfig;
  private container: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private isVisible: boolean = false;
  private currentState: FrugState | null = null;

  constructor(config: Partial<FrugStatsPanelConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  initialize(): void {
    // Create overlay (also acts as centering container)
    this.overlay = document.createElement('div');
    this.overlay.className = 'frug-stats-overlay';
    this.overlay.addEventListener('click', (e) => {
      // Only close if clicking the overlay itself, not the panel
      if (e.target === this.overlay) {
        this.hide();
      }
    });
    document.body.appendChild(this.overlay);

    // Create container inside overlay for proper centering
    this.container = document.createElement('div');
    this.container.id = 'frug-stats-panel';
    this.container.className = 'frug-stats-panel';
    this.overlay.appendChild(this.container);

    // Close on escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isVisible) {
        this.hide();
      }
    });

    this.injectStyles();
  }

  private injectStyles(): void {
    const styleId = 'frug-stats-panel-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Overlay - acts as centering container */
      .frug-stats-overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(4px);
        z-index: 1000;
        justify-content: center;
        align-items: center;
      }

      .frug-stats-overlay.visible {
        display: flex;
      }

      /* Panel Container - centered by parent flexbox */
      .frug-stats-panel {
        display: none;
        width: min(90vw, 480px);
        max-height: min(85vh, 700px);
        background: linear-gradient(135deg, #2d1b4e 0%, #1a1033 100%);
        border: 3px solid var(--color-purple, #8b5cf6);
        border-radius: 24px;
        overflow: hidden;
        box-shadow:
          0 0 0 1px rgba(0, 0, 0, 0.3),
          0 0 60px rgba(139, 92, 246, 0.4),
          0 20px 60px rgba(0, 0, 0, 0.6);
        z-index: 1001;
      }

      .frug-stats-panel.visible {
        display: flex;
        flex-direction: column;
      }

      /* Header */
      .frug-stats-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        background: linear-gradient(90deg, rgba(139, 92, 246, 0.3) 0%, rgba(236, 72, 153, 0.2) 100%);
        border-bottom: 2px solid rgba(139, 92, 246, 0.4);
        position: relative;
      }

      .frug-stats-header::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
      }

      .frug-stats-title {
        font-family: 'Fredoka', sans-serif;
        font-size: 20px;
        font-weight: 600;
        color: var(--color-gold, #fbbf24);
        text-shadow: 0 0 15px rgba(251, 191, 36, 0.5);
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .frug-stats-close {
        width: 32px;
        height: 32px;
        background: linear-gradient(135deg, #ef4444, #dc2626);
        border: 2px solid #fca5a5;
        border-radius: 10px;
        color: white;
        font-size: 18px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }

      .frug-stats-close:hover {
        transform: scale(1.1) rotate(90deg);
        box-shadow: 0 4px 15px rgba(239, 68, 68, 0.5);
      }

      /* Content Area */
      .frug-stats-content {
        padding: 20px;
        overflow-y: auto;
        max-height: calc(85vh - 120px);
      }

      /* Mood Section */
      .frug-mood-section {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 20px;
        padding: 20px;
        margin-bottom: 20px;
        background: rgba(139, 92, 246, 0.1);
        border-radius: 16px;
        border: 1px solid rgba(139, 92, 246, 0.2);
      }

      .frug-mood-avatar {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        background: radial-gradient(circle at 30% 30%, #6cd97e 0%, #44bb66 50%, #2d9450 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 36px;
        box-shadow:
          inset -4px -4px 10px rgba(0, 0, 0, 0.2),
          inset 4px 4px 10px rgba(255, 255, 255, 0.1),
          0 4px 20px rgba(0, 0, 0, 0.3);
        border: 2px solid #228844;
        position: relative;
      }

      .frug-mood-avatar::after {
        content: attr(data-mood-emoji);
        position: absolute;
        bottom: -5px;
        right: -5px;
        font-size: 24px;
        background: rgba(26, 16, 51, 0.9);
        border-radius: 50%;
        padding: 4px;
        border: 2px solid;
      }

      .frug-mood-info {
        text-align: center;
      }

      .frug-mood-label {
        font-family: 'Nunito', sans-serif;
        font-size: 12px;
        color: rgba(196, 181, 253, 0.6);
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 4px;
      }

      .frug-mood-name {
        font-family: 'Fredoka', sans-serif;
        font-size: 28px;
        font-weight: 600;
        text-shadow: 0 0 20px currentColor;
      }

      .frug-mood-emoji {
        font-size: 32px;
        margin-top: 4px;
      }

      /* Stats Sections */
      .frug-stats-section {
        margin-bottom: 16px;
      }

      .frug-stats-section-title {
        font-family: 'Fredoka', sans-serif;
        font-size: 14px;
        font-weight: 600;
        color: var(--color-gold, #fbbf24);
        margin-bottom: 12px;
        text-transform: uppercase;
        letter-spacing: 1px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .frug-stats-section-title::after {
        content: '';
        flex: 1;
        height: 1px;
        background: linear-gradient(90deg, rgba(251, 191, 36, 0.3) 0%, transparent 100%);
      }

      .frug-stats-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
      }

      @media (max-width: 400px) {
        .frug-stats-grid {
          grid-template-columns: 1fr;
        }
      }

      /* Individual Stat Bar */
      .frug-stat-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 12px;
        border: 1px solid rgba(139, 92, 246, 0.15);
        transition: all 0.2s;
      }

      .frug-stat-item:hover {
        background: rgba(139, 92, 246, 0.1);
        border-color: rgba(139, 92, 246, 0.3);
      }

      .frug-stat-icon {
        font-size: 20px;
        width: 28px;
        text-align: center;
        flex-shrink: 0;
      }

      .frug-stat-details {
        flex: 1;
        min-width: 0;
      }

      .frug-stat-name {
        font-family: 'Nunito', sans-serif;
        font-size: 11px;
        color: rgba(196, 181, 253, 0.7);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 4px;
      }

      .frug-stat-bar-container {
        width: 100%;
        height: 8px;
        background: rgba(0, 0, 0, 0.4);
        border-radius: 4px;
        overflow: hidden;
      }

      .frug-stat-bar-fill {
        height: 100%;
        border-radius: 4px;
        transition: width 0.5s ease, background 0.3s ease;
        box-shadow: 0 0 8px currentColor;
      }

      .frug-stat-value {
        font-family: 'Nunito', sans-serif;
        font-size: 12px;
        font-weight: 700;
        color: var(--color-text, #e2e8f0);
        min-width: 36px;
        text-align: right;
      }

      /* Personality Section */
      .frug-personality-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }

      @media (max-width: 400px) {
        .frug-personality-grid {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      .frug-personality-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 12px 8px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 12px;
        border: 1px solid rgba(139, 92, 246, 0.15);
        text-align: center;
      }

      .frug-personality-icon {
        font-size: 24px;
        margin-bottom: 6px;
      }

      .frug-personality-name {
        font-family: 'Nunito', sans-serif;
        font-size: 10px;
        color: rgba(196, 181, 253, 0.6);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 4px;
      }

      .frug-personality-value {
        font-family: 'Fredoka', sans-serif;
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text, #e2e8f0);
      }

      /* Info Section */
      .frug-info-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
      }

      .frug-info-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 10px;
      }

      .frug-info-icon {
        font-size: 18px;
      }

      .frug-info-details {
        flex: 1;
      }

      .frug-info-label {
        font-family: 'Nunito', sans-serif;
        font-size: 10px;
        color: rgba(196, 181, 253, 0.5);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .frug-info-value {
        font-family: 'Nunito', sans-serif;
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text, #e2e8f0);
      }

      /* Recent Experiences */
      .frug-experiences-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 120px;
        overflow-y: auto;
      }

      .frug-experience-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 8px;
        font-size: 12px;
      }

      .frug-experience-item.positive {
        border-left: 3px solid #4ade80;
      }

      .frug-experience-item.negative {
        border-left: 3px solid #ef4444;
      }

      .frug-experience-item.neutral {
        border-left: 3px solid #94a3b8;
      }

      .frug-experience-text {
        flex: 1;
        color: rgba(196, 181, 253, 0.8);
      }

      .frug-experience-time {
        font-size: 10px;
        color: rgba(196, 181, 253, 0.5);
      }

      /* Empty state */
      .frug-empty-state {
        text-align: center;
        padding: 20px;
        color: rgba(196, 181, 253, 0.5);
        font-size: 13px;
      }
    `;
    document.head.appendChild(style);
  }

  show(state: FrugState): void {
    if (!this.container || !this.overlay) return;

    this.currentState = state;
    this.isVisible = true;

    // Render content
    this.render();

    // Show overlay and panel
    this.overlay.classList.add('visible');
    this.container.classList.add('visible');

    // Animate in
    animate(
      this.container,
      {
        opacity: [0, 1],
        scale: [0.9, 1],
      },
      {
        duration: this.config.animationDuration,
        easing: spring({ stiffness: 300, damping: 20 }),
      }
    );
  }

  hide(): void {
    if (!this.container || !this.overlay || !this.isVisible) return;

    this.isVisible = false;

    // Animate out
    animate(
      this.container,
      {
        opacity: [1, 0],
        scale: [1, 0.95],
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

  update(state: FrugState): void {
    if (!this.isVisible) return;
    this.currentState = state;
    this.render();
  }

  private render(): void {
    if (!this.container || !this.currentState) return;

    const state = this.currentState;
    const moodColor = getMoodColor(state.mood);
    const moodEmoji = getMoodEmoji(state.mood);
    const moodName = getMoodDisplayName(state.mood);

    this.container.innerHTML = `
      <div class="frug-stats-header">
        <div class="frug-stats-title">
          <span>Frug Status</span>
        </div>
        <button class="frug-stats-close" id="frug-stats-close">×</button>
      </div>
      <div class="frug-stats-content">
        <!-- Mood Section -->
        <div class="frug-mood-section">
          <div class="frug-mood-avatar" data-mood-emoji="${moodEmoji}" style="border-color: ${moodColor}40;">
            <div style="font-size: 32px;">🟢</div>
          </div>
          <div class="frug-mood-info">
            <div class="frug-mood-label">Current Mood</div>
            <div class="frug-mood-name" style="color: ${moodColor};">${moodName}</div>
            <div class="frug-mood-emoji">${moodEmoji}</div>
          </div>
        </div>

        <!-- Physical Stats -->
        <div class="frug-stats-section">
          <div class="frug-stats-section-title">
            <span>💪 Physical</span>
          </div>
          <div class="frug-stats-grid">
            ${this.renderStatBar('health', 'Health', state.physical.health, state.physical.maxHealth)}
            ${this.renderStatBar('energy', 'Energy', state.physical.energy, state.physical.maxEnergy)}
            ${this.renderStatBar('hunger', 'Hunger', state.physical.hunger, 100)}
            ${this.renderStatBar('thirst', 'Thirst', state.physical.thirst, 100)}
            ${this.renderStatBar('fatigue', 'Rest', state.physical.fatigue, 100)}
            ${this.renderStatBar('cleanliness', 'Cleanliness', state.physical.cleanliness, 100)}
          </div>
        </div>

        <!-- Emotional Stats -->
        <div class="frug-stats-section">
          <div class="frug-stats-section-title">
            <span>💭 Emotional</span>
          </div>
          <div class="frug-stats-grid">
            ${this.renderStatBar('happiness', 'Happiness', state.emotional.happiness, 100)}
            ${this.renderStatBar('stress', 'Stress', 100 - state.emotional.stress, 100, true)}
            ${this.renderStatBar('comfort', 'Comfort', state.emotional.comfort, 100)}
            ${this.renderStatBar('excitement', 'Excitement', state.emotional.excitement, 100)}
            ${this.renderStatBar('curiosity', 'Curiosity', state.emotional.curiosity, 100)}
            ${this.renderStatBar('confidence', 'Confidence', state.emotional.confidence, 100)}
          </div>
        </div>

        <!-- Social Stats -->
        <div class="frug-stats-section">
          <div class="frug-stats-section-title">
            <span>🤝 Social</span>
          </div>
          <div class="frug-stats-grid">
            ${this.renderStatBar('loneliness', 'Social', 100 - state.social.loneliness, 100, true)}
            ${this.renderStatBar('friendshipLevel', 'Friendship', state.social.friendshipLevel, 100)}
            ${this.renderStatBar('reputation', 'Reputation', state.social.reputation, 100)}
            ${this.renderStatBar('charisma', 'Charisma', state.social.charisma, 100)}
          </div>
        </div>

        <!-- Personality -->
        <div class="frug-stats-section">
          <div class="frug-stats-section-title">
            <span>🧠 Personality</span>
          </div>
          <div class="frug-personality-grid">
            ${this.renderPersonalityTrait('introversion', state.personality.introversion, '🏠', '👥')}
            ${this.renderPersonalityTrait('optimism', state.personality.optimism, '😟', '😄')}
            ${this.renderPersonalityTrait('adventurousness', state.personality.adventurousness, '🛡️', '🗺️')}
            ${this.renderPersonalityTrait('empathy', state.personality.empathy, '🧊', '💗')}
            ${this.renderPersonalityTrait('patience', state.personality.patience, '⚡', '🧘')}
            ${this.renderPersonalityTrait('creativity', state.personality.creativity, '📐', '🎨')}
          </div>
        </div>

        <!-- Life Stats -->
        <div class="frug-stats-section">
          <div class="frug-stats-section-title">
            <span>📊 Life Stats</span>
          </div>
          <div class="frug-info-grid">
            <div class="frug-info-item">
              <span class="frug-info-icon">📅</span>
              <div class="frug-info-details">
                <div class="frug-info-label">Age</div>
                <div class="frug-info-value">${Math.floor(state.age)} days</div>
              </div>
            </div>
            <div class="frug-info-item">
              <span class="frug-info-icon">👣</span>
              <div class="frug-info-details">
                <div class="frug-info-label">Distance</div>
                <div class="frug-info-value">${Math.floor(state.totalDistanceTraveled)}m</div>
              </div>
            </div>
            <div class="frug-info-item">
              <span class="frug-info-icon">💬</span>
              <div class="frug-info-details">
                <div class="frug-info-label">Conversations</div>
                <div class="frug-info-value">${state.totalNpcInteractions}</div>
              </div>
            </div>
            <div class="frug-info-item">
              <span class="frug-info-icon">🌍</span>
              <div class="frug-info-details">
                <div class="frug-info-label">Current Biome</div>
                <div class="frug-info-value">${this.capitalize(state.environment.currentBiome)}</div>
              </div>
            </div>
            ${state.favoriteNpc ? `
            <div class="frug-info-item">
              <span class="frug-info-icon">💜</span>
              <div class="frug-info-details">
                <div class="frug-info-label">Best Friend</div>
                <div class="frug-info-value">${state.favoriteNpc}</div>
              </div>
            </div>
            ` : ''}
            <div class="frug-info-item">
              <span class="frug-info-icon">${this.getWeatherIcon(state.environment.currentWeather)}</span>
              <div class="frug-info-details">
                <div class="frug-info-label">Weather</div>
                <div class="frug-info-value">${this.capitalize(state.environment.currentWeather)}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Recent Experiences -->
        <div class="frug-stats-section">
          <div class="frug-stats-section-title">
            <span>📝 Recent Experiences</span>
          </div>
          ${state.recentExperiences.length > 0 ? `
          <div class="frug-experiences-list">
            ${state.recentExperiences.slice(-5).reverse().map(exp => `
              <div class="frug-experience-item ${exp.type}">
                <span class="frug-experience-text">${exp.description}</span>
                <span class="frug-experience-time">${this.formatTimeAgo(exp.timestamp)}</span>
              </div>
            `).join('')}
          </div>
          ` : `
          <div class="frug-empty-state">No recent experiences yet. Go explore!</div>
          `}
        </div>
      </div>
    `;

    // Setup close button
    const closeBtn = this.container.querySelector('#frug-stats-close');
    closeBtn?.addEventListener('click', () => this.hide());
  }

  private renderStatBar(
    id: string,
    name: string,
    value: number,
    max: number,
    inverse: boolean = false
  ): string {
    const percent = Math.round((value / max) * 100);
    const displayValue = inverse ? 100 - percent : percent;
    const color = getStatColor(percent);
    const icon = getStatIcon(id);

    return `
      <div class="frug-stat-item">
        <span class="frug-stat-icon">${icon}</span>
        <div class="frug-stat-details">
          <div class="frug-stat-name">${name}</div>
          <div class="frug-stat-bar-container">
            <div class="frug-stat-bar-fill" style="width: ${percent}%; background: ${color}; color: ${color};"></div>
          </div>
        </div>
        <span class="frug-stat-value">${displayValue}%</span>
      </div>
    `;
  }

  private renderPersonalityTrait(
    name: string,
    value: number,
    lowEmoji: string,
    highEmoji: string
  ): string {
    const displayName = this.formatTraitName(name);
    const emoji = value > 50 ? highEmoji : lowEmoji;
    const traitLabel = this.getTraitLabel(name, value);

    return `
      <div class="frug-personality-item">
        <span class="frug-personality-icon">${emoji}</span>
        <div class="frug-personality-name">${displayName}</div>
        <div class="frug-personality-value">${traitLabel}</div>
      </div>
    `;
  }

  private formatTraitName(name: string): string {
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  private getTraitLabel(trait: string, value: number): string {
    const labels: Record<string, [string, string]> = {
      introversion: ['Extrovert', 'Introvert'],
      optimism: ['Pessimist', 'Optimist'],
      adventurousness: ['Cautious', 'Adventurous'],
      empathy: ['Detached', 'Empathetic'],
      patience: ['Impatient', 'Patient'],
      creativity: ['Practical', 'Creative'],
    };

    const [low, high] = labels[trait] || ['Low', 'High'];
    if (value < 30) return low;
    if (value > 70) return high;
    return 'Balanced';
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  private getWeatherIcon(weather: string): string {
    const icons: Record<string, string> = {
      clear: '☀️',
      sunny: '☀️',
      cloudy: '☁️',
      rainy: '🌧️',
      stormy: '⛈️',
      snowy: '❄️',
      foggy: '🌫️',
    };
    return icons[weather.toLowerCase()] || '🌤️';
  }

  private formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  destroy(): void {
    // Container is a child of overlay, so removing overlay removes both
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    this.container = null;

    const styleEl = document.getElementById('frug-stats-panel-styles');
    styleEl?.remove();
  }
}
