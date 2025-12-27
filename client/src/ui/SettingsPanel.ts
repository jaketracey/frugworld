/**
 * SettingsPanel - Game settings and options UI
 * A fun, child-friendly Sims-inspired settings menu with bouncy animations
 */

import { animate, stagger, spring } from '@motionone/dom';

export interface SettingsConfig {
  animationDurationMs: number;
}

export interface GameSettings {
  showDebug: boolean;
  showMinimap: boolean;
  showCrosshair: boolean;
  showControlHints: boolean;
  soundVolume: number;
  musicVolume: number;
  npcMusicVolume: number; // Volume for dialogue/NPC music
  graphicsQuality: 'low' | 'medium' | 'high';
  shadowQuality: 'off' | 'low' | 'medium' | 'high';
  fov: number;
  // Post-processing effects
  postProcessingEnabled: boolean;
  bloomEnabled: boolean;
  bloomIntensity: number;
  vignetteEnabled: boolean;
  // Voice settings
  frugVoiceEnabled: boolean;
  frugVoice: string; // ElevenLabs voice ID
  frugVoiceFrequency: number; // 0-100, how often Frug speaks
}

// Available voice options for Frug
export const FRUG_VOICE_OPTIONS = [
  { id: 'D38z5RcWu1voky8WS1ja', name: 'Fin (Playful)' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam (Friendly)' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella (Sweet)' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni (Warm)' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli (Cute)' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh (Energetic)' },
] as const;

const DEFAULT_CONFIG: SettingsConfig = {
  animationDurationMs: 400,
};

const DEFAULT_SETTINGS: GameSettings = {
  showDebug: true,
  showMinimap: true,
  showCrosshair: true,
  showControlHints: true,
  soundVolume: 80,
  musicVolume: 60,
  npcMusicVolume: 80,
  graphicsQuality: 'high',
  shadowQuality: 'medium',
  fov: 75,
  // Post-processing defaults
  postProcessingEnabled: true,
  bloomEnabled: true,
  bloomIntensity: 40,
  vignetteEnabled: true,
  // Voice defaults
  frugVoiceEnabled: true,
  frugVoice: 'D38z5RcWu1voky8WS1ja', // Fin (Playful)
  frugVoiceFrequency: 25, // 25% of the time
};

export type SettingsChangeCallback = (settings: GameSettings) => void;

export class SettingsPanel {
  private config: SettingsConfig;
  private settings: GameSettings;
  private isOpen: boolean = false;

  // DOM elements
  private container: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;

  // Callbacks
  private onChange: SettingsChangeCallback | null = null;

  constructor(config: Partial<SettingsConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.settings = { ...DEFAULT_SETTINGS };

    // Load settings from localStorage
    this.loadSettings();
  }

  /**
   * Initialize the settings panel UI
   */
  initialize(parentElement: HTMLElement = document.body): void {
    if (this.container) {
      return;
    }

    this.loadFonts();
    this.createDOM(parentElement);
    this.injectStyles();
    this.setupEventListeners();
    this.applySettings();
  }

  /**
   * Load fun Google Fonts
   */
  private loadFonts(): void {
    if (document.getElementById('settings-fonts')) return;

    const link = document.createElement('link');
    link.id = 'settings-fonts';
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Bubblegum+Sans&display=swap';
    document.head.appendChild(link);
  }

  /**
   * Set callback for settings changes
   */
  setOnChange(callback: SettingsChangeCallback): void {
    this.onChange = callback;
  }

  /**
   * Open the settings panel with spring animation
   */
  open(): void {
    if (!this.container || !this.panel || this.isOpen) return;

    this.isOpen = true;
    this.container.classList.add('visible');

    // Animate overlay
    animate(this.overlay!, { opacity: [0, 1] }, { duration: 0.3 });

    // Spring panel entrance (matching FrugStatsPanel style)
    animate(
      this.panel!,
      {
        opacity: [0, 1],
        scale: [0.9, 1],
      },
      {
        duration: 0.4,
        easing: spring({ stiffness: 300, damping: 20 }),
      }
    );

    // Stagger animate sections
    const sections = this.panel!.querySelectorAll('.settings-section');
    animate(
      sections,
      { opacity: [0, 1], transform: ['translateY(20px)', 'translateY(0)'] },
      { delay: stagger(0.08), duration: 0.3 }
    );
  }

  /**
   * Close the settings panel with smooth animation
   */
  close(): void {
    if (!this.container || !this.panel || !this.isOpen) return;

    this.isOpen = false;

    // Animate out (matching FrugStatsPanel style)
    animate(
      this.panel!,
      {
        opacity: [1, 0],
        scale: [1, 0.95],
      },
      { duration: 0.2, easing: 'ease-out' }
    );

    animate(this.overlay!, { opacity: [1, 0] }, { duration: 0.2 }).finished.then(() => {
      this.container?.classList.remove('visible');
    });

    // Save settings
    this.saveSettings();
  }

  /**
   * Toggle the settings panel
   */
  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Check if panel is open
   */
  getIsOpen(): boolean {
    return this.isOpen;
  }

  /**
   * Get current settings
   */
  getSettings(): Readonly<GameSettings> {
    return { ...this.settings };
  }

  /**
   * Cleanup and destroy
   */
  destroy(): void {
    if (this.container?.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
    this.container = null;
    this.panel = null;
    this.overlay = null;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createDOM(parent: HTMLElement): void {
    this.container = document.createElement('div');
    this.container.id = 'settings-container';
    this.container.className = 'settings-container';
    this.container.innerHTML = `
      <div class="settings-overlay"></div>
      <div class="settings-panel">
        <div class="settings-header">
          <div class="settings-header-deco">
            <span class="deco-star">&#9733;</span>
            <span class="deco-star">&#9733;</span>
            <span class="deco-star">&#9733;</span>
          </div>
          <h2 class="settings-title">Settings</h2>
          <button class="settings-close" type="button" aria-label="Close settings">
            <span class="close-icon">&#10005;</span>
          </button>
        </div>
        <div class="settings-content">
          <div class="settings-section">
            <h3 class="settings-section-title">
              <span class="section-icon">&#128065;</span>
              Display
            </h3>
            <div class="settings-group">
              <label class="settings-toggle">
                <span class="toggle-label">Show Debug Info</span>
                <input type="checkbox" id="setting-debug" ${this.settings.showDebug ? 'checked' : ''}>
                <span class="toggle-switch">
                  <span class="toggle-knob"></span>
                </span>
              </label>
              <label class="settings-toggle">
                <span class="toggle-label">Show Minimap</span>
                <input type="checkbox" id="setting-minimap" ${this.settings.showMinimap ? 'checked' : ''}>
                <span class="toggle-switch">
                  <span class="toggle-knob"></span>
                </span>
              </label>
              <label class="settings-toggle">
                <span class="toggle-label">Show Cursor</span>
                <input type="checkbox" id="setting-crosshair" ${this.settings.showCrosshair ? 'checked' : ''}>
                <span class="toggle-switch">
                  <span class="toggle-knob"></span>
                </span>
              </label>
              <label class="settings-toggle">
                <span class="toggle-label">Show New World Button</span>
                <input type="checkbox" id="setting-controls" ${this.settings.showControlHints ? 'checked' : ''}>
                <span class="toggle-switch">
                  <span class="toggle-knob"></span>
                </span>
              </label>
            </div>
          </div>

          <div class="settings-section">
            <h3 class="settings-section-title">
              <span class="section-icon">&#127925;</span>
              Audio
            </h3>
            <div class="settings-group">
              <label class="settings-slider">
                <span class="slider-label">Sound Effects</span>
                <div class="slider-container">
                  <input type="range" id="setting-sound" min="0" max="100" value="${this.settings.soundVolume}">
                  <span class="slider-value">${this.settings.soundVolume}%</span>
                </div>
              </label>
              <label class="settings-slider">
                <span class="slider-label">Music</span>
                <div class="slider-container">
                  <input type="range" id="setting-music" min="0" max="100" value="${this.settings.musicVolume}">
                  <span class="slider-value">${this.settings.musicVolume}%</span>
                </div>
              </label>
              <label class="settings-slider">
                <span class="slider-label">NPC Music</span>
                <div class="slider-container">
                  <input type="range" id="setting-npc-music" min="0" max="100" value="${this.settings.npcMusicVolume}">
                  <span class="slider-value">${this.settings.npcMusicVolume}%</span>
                </div>
              </label>
            </div>
          </div>

          <div class="settings-section">
            <h3 class="settings-section-title">
              <span class="section-icon">&#128172;</span>
              Frug's Voice
            </h3>
            <div class="settings-group">
              <label class="settings-toggle">
                <span class="toggle-label">Voice Enabled</span>
                <input type="checkbox" id="setting-voice-enabled" ${this.settings.frugVoiceEnabled ? 'checked' : ''}>
                <span class="toggle-switch">
                  <span class="toggle-knob"></span>
                </span>
              </label>
              <label class="settings-select">
                <span class="select-label">Voice Style</span>
                <div class="select-wrapper">
                  <select id="setting-voice-style">
                    ${FRUG_VOICE_OPTIONS.map(v => `<option value="${v.id}" ${this.settings.frugVoice === v.id ? 'selected' : ''}>${v.name}</option>`).join('')}
                  </select>
                  <span class="select-arrow">&#9660;</span>
                </div>
              </label>
              <label class="settings-slider">
                <span class="slider-label">How Often Frug Speaks</span>
                <div class="slider-container">
                  <input type="range" id="setting-voice-frequency" min="0" max="100" value="${this.settings.frugVoiceFrequency}">
                  <span class="slider-value">${this.settings.frugVoiceFrequency}%</span>
                </div>
              </label>
            </div>
          </div>

          <div class="settings-section">
            <h3 class="settings-section-title">
              <span class="section-icon">&#127912;</span>
              Graphics
            </h3>
            <div class="settings-group">
              <label class="settings-select">
                <span class="select-label">Quality</span>
                <div class="select-wrapper">
                  <select id="setting-quality">
                    <option value="low" ${this.settings.graphicsQuality === 'low' ? 'selected' : ''}>Low</option>
                    <option value="medium" ${this.settings.graphicsQuality === 'medium' ? 'selected' : ''}>Medium</option>
                    <option value="high" ${this.settings.graphicsQuality === 'high' ? 'selected' : ''}>High</option>
                  </select>
                  <span class="select-arrow">&#9660;</span>
                </div>
              </label>
              <label class="settings-select">
                <span class="select-label">Shadows</span>
                <div class="select-wrapper">
                  <select id="setting-shadow-quality">
                    <option value="off" ${this.settings.shadowQuality === 'off' ? 'selected' : ''}>Off</option>
                    <option value="low" ${this.settings.shadowQuality === 'low' ? 'selected' : ''}>Low</option>
                    <option value="medium" ${this.settings.shadowQuality === 'medium' ? 'selected' : ''}>Medium</option>
                    <option value="high" ${this.settings.shadowQuality === 'high' ? 'selected' : ''}>High</option>
                  </select>
                  <span class="select-arrow">&#9660;</span>
                </div>
              </label>
              <label class="settings-slider">
                <span class="slider-label">Field of View</span>
                <div class="slider-container">
                  <input type="range" id="setting-fov" min="60" max="110" value="${this.settings.fov}">
                  <span class="slider-value">${this.settings.fov}°</span>
                </div>
              </label>
            </div>
          </div>

          <div class="settings-section">
            <h3 class="settings-section-title">
              <span class="section-icon">&#10024;</span>
              Effects
            </h3>
            <div class="settings-group">
              <label class="settings-toggle">
                <span class="toggle-label">Enable Effects</span>
                <input type="checkbox" id="setting-postprocessing" ${this.settings.postProcessingEnabled ? 'checked' : ''}>
                <span class="toggle-switch">
                  <span class="toggle-knob"></span>
                </span>
              </label>
              <label class="settings-toggle">
                <span class="toggle-label">Bloom (Glow)</span>
                <input type="checkbox" id="setting-bloom" ${this.settings.bloomEnabled ? 'checked' : ''}>
                <span class="toggle-switch">
                  <span class="toggle-knob"></span>
                </span>
              </label>
              <label class="settings-slider">
                <span class="slider-label">Bloom Intensity</span>
                <div class="slider-container">
                  <input type="range" id="setting-bloom-intensity" min="0" max="100" value="${this.settings.bloomIntensity}">
                  <span class="slider-value">${this.settings.bloomIntensity}%</span>
                </div>
              </label>
              <label class="settings-toggle">
                <span class="toggle-label">Vignette</span>
                <input type="checkbox" id="setting-vignette" ${this.settings.vignetteEnabled ? 'checked' : ''}>
                <span class="toggle-switch">
                  <span class="toggle-knob"></span>
                </span>
              </label>
            </div>
          </div>
        </div>
        <div class="settings-footer">
          <button class="settings-btn reset" type="button">
            <span class="btn-icon">&#8635;</span>
            Reset
          </button>
          <button class="settings-btn apply" type="button">
            <span class="btn-icon">&#10003;</span>
            Let's Go!
          </button>
        </div>
      </div>
    `;

    this.panel = this.container.querySelector('.settings-panel');
    this.overlay = this.container.querySelector('.settings-overlay');
    parent.appendChild(this.container);
  }

  private injectStyles(): void {
    if (document.getElementById('settings-panel-styles')) {
      return;
    }

    const styles = document.createElement('style');
    styles.id = 'settings-panel-styles';
    styles.textContent = `
      /* ========================================
         FrugWorld Settings - Matching Frug Status Style
         ======================================== */

      .settings-container {
        position: fixed;
        inset: 0;
        z-index: 2000;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        opacity: 0;
      }

      .settings-container.visible {
        opacity: 1;
        pointer-events: auto;
      }

      .settings-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(4px);
      }

      .settings-panel {
        position: relative;
        width: min(90vw, 520px);
        max-height: min(88vh, 750px);
        background: linear-gradient(135deg, #2d1b4e 0%, #1a1033 100%);
        border: 3px solid var(--color-purple, #8b5cf6);
        border-radius: 24px;
        overflow: hidden;
        box-shadow:
          0 0 0 1px rgba(0, 0, 0, 0.3),
          0 0 60px rgba(139, 92, 246, 0.4),
          0 20px 60px rgba(0, 0, 0, 0.6);
        font-family: 'Fredoka', sans-serif;
        display: flex;
        flex-direction: column;
        transform-origin: center;
      }

      /* Header */
      .settings-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        background: linear-gradient(90deg, rgba(139, 92, 246, 0.3) 0%, rgba(236, 72, 153, 0.2) 100%);
        border-bottom: 2px solid rgba(139, 92, 246, 0.4);
        position: relative;
      }

      .settings-header::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
      }

      .settings-header-deco {
        position: absolute;
        top: -2px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 8px;
      }

      .deco-star {
        color: var(--color-gold, #fbbf24);
        font-size: 14px;
        text-shadow: 0 0 10px rgba(251, 191, 36, 0.5);
        animation: starTwinkle 2s ease-in-out infinite;
      }

      .deco-star:nth-child(2) {
        animation-delay: 0.3s;
        font-size: 18px;
      }

      .deco-star:nth-child(3) {
        animation-delay: 0.6s;
      }

      @keyframes starTwinkle {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.6; transform: scale(0.8); }
      }

      .settings-title {
        font-family: 'Fredoka', sans-serif;
        font-size: 24px;
        font-weight: 600;
        color: var(--color-gold, #fbbf24);
        margin: 0;
        text-shadow: 0 0 15px rgba(251, 191, 36, 0.5);
        letter-spacing: 1px;
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .settings-title::before {
        content: '⚙️';
        font-size: 22px;
      }

      .settings-close {
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

      .settings-close:hover {
        transform: scale(1.1) rotate(90deg);
        box-shadow: 0 4px 15px rgba(239, 68, 68, 0.5);
      }

      .settings-close:active {
        transform: scale(0.95) rotate(90deg);
      }

      .close-icon {
        font-size: 16px;
        font-weight: bold;
      }

      /* Content */
      .settings-content {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        max-height: calc(88vh - 140px);
      }

      .settings-section {
        margin-bottom: 16px;
        background: rgba(139, 92, 246, 0.1);
        border-radius: 16px;
        padding: 16px;
        border: 1px solid rgba(139, 92, 246, 0.2);
      }

      .settings-section:last-child {
        margin-bottom: 0;
      }

      .settings-section-title {
        font-family: 'Fredoka', sans-serif;
        font-size: 14px;
        font-weight: 600;
        color: var(--color-gold, #fbbf24);
        margin: 0 0 12px 0;
        text-transform: uppercase;
        letter-spacing: 1px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .settings-section-title::after {
        content: '';
        flex: 1;
        height: 1px;
        background: linear-gradient(90deg, rgba(251, 191, 36, 0.3) 0%, transparent 100%);
      }

      .section-icon {
        font-size: 18px;
        filter: drop-shadow(0 0 4px currentColor);
      }

      .settings-group {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      /* Toggle Switch */
      .settings-toggle {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 14px;
        background: rgba(0, 0, 0, 0.2);
        border: 1px solid rgba(139, 92, 246, 0.15);
        border-radius: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .settings-toggle:hover {
        background: rgba(139, 92, 246, 0.1);
        border-color: rgba(139, 92, 246, 0.3);
        transform: translateY(-1px);
      }

      .toggle-label {
        font-family: 'Nunito', sans-serif;
        font-size: 14px;
        font-weight: 500;
        color: rgba(196, 181, 253, 0.9);
      }

      .settings-toggle input {
        display: none;
      }

      .toggle-switch {
        width: 48px;
        height: 26px;
        background: rgba(100, 100, 120, 0.5);
        border-radius: 13px;
        position: relative;
        transition: all 0.3s cubic-bezier(0.68, -0.55, 0.27, 1.55);
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
        border: 1px solid rgba(139, 92, 246, 0.2);
      }

      .toggle-knob {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 20px;
        height: 20px;
        background: linear-gradient(180deg, #e2e8f0 0%, #cbd5e1 100%);
        border-radius: 50%;
        transition: all 0.3s cubic-bezier(0.68, -0.55, 0.27, 1.55);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .settings-toggle input:checked + .toggle-switch {
        background: linear-gradient(180deg, #8b5cf6 0%, #7c3aed 100%);
        border-color: rgba(167, 139, 250, 0.5);
      }

      .settings-toggle input:checked + .toggle-switch .toggle-knob {
        left: 24px;
        background: linear-gradient(180deg, #fbbf24 0%, #f59e0b 100%);
        box-shadow: 0 0 10px rgba(251, 191, 36, 0.5), 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      /* Slider */
      .settings-slider {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px 14px;
        background: rgba(0, 0, 0, 0.2);
        border: 1px solid rgba(139, 92, 246, 0.15);
        border-radius: 12px;
      }

      .slider-label {
        font-family: 'Nunito', sans-serif;
        font-size: 14px;
        font-weight: 500;
        color: rgba(196, 181, 253, 0.9);
      }

      .slider-container {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .settings-slider input[type="range"] {
        flex: 1;
        height: 8px;
        -webkit-appearance: none;
        appearance: none;
        background: rgba(0, 0, 0, 0.4);
        border-radius: 4px;
        outline: none;
      }

      .settings-slider input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 20px;
        height: 20px;
        background: linear-gradient(180deg, #fbbf24 0%, #f59e0b 100%);
        border-radius: 50%;
        cursor: pointer;
        border: 2px solid rgba(255, 255, 255, 0.3);
        box-shadow: 0 0 10px rgba(251, 191, 36, 0.4), 0 2px 6px rgba(0, 0, 0, 0.3);
        transition: all 0.2s ease;
      }

      .settings-slider input[type="range"]::-webkit-slider-thumb:hover {
        transform: scale(1.15);
        box-shadow: 0 0 15px rgba(251, 191, 36, 0.6), 0 2px 6px rgba(0, 0, 0, 0.3);
      }

      .settings-slider input[type="range"]::-moz-range-thumb {
        width: 18px;
        height: 18px;
        background: linear-gradient(180deg, #fbbf24 0%, #f59e0b 100%);
        border-radius: 50%;
        cursor: pointer;
        border: 2px solid rgba(255, 255, 255, 0.3);
        box-shadow: 0 0 10px rgba(251, 191, 36, 0.4), 0 2px 6px rgba(0, 0, 0, 0.3);
      }

      .slider-value {
        min-width: 48px;
        font-family: 'Nunito', sans-serif;
        font-size: 13px;
        font-weight: 700;
        color: var(--color-text, #e2e8f0);
        text-align: center;
        background: rgba(139, 92, 246, 0.2);
        padding: 4px 8px;
        border-radius: 8px;
        border: 1px solid rgba(139, 92, 246, 0.2);
      }

      /* Select */
      .settings-select {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 14px;
        background: rgba(0, 0, 0, 0.2);
        border: 1px solid rgba(139, 92, 246, 0.15);
        border-radius: 12px;
      }

      .select-label {
        font-family: 'Nunito', sans-serif;
        font-size: 14px;
        font-weight: 500;
        color: rgba(196, 181, 253, 0.9);
      }

      .select-wrapper {
        position: relative;
        display: flex;
        align-items: center;
      }

      .settings-select select {
        padding: 8px 32px 8px 12px;
        background: rgba(139, 92, 246, 0.2);
        border: 1px solid rgba(139, 92, 246, 0.3);
        border-radius: 10px;
        color: var(--color-text, #e2e8f0);
        font-size: 13px;
        font-family: 'Nunito', sans-serif;
        font-weight: 600;
        cursor: pointer;
        outline: none;
        appearance: none;
        transition: all 0.2s ease;
      }

      .settings-select select:hover {
        background: rgba(139, 92, 246, 0.3);
        border-color: rgba(139, 92, 246, 0.5);
      }

      .settings-select select:focus {
        border-color: var(--color-gold, #fbbf24);
        box-shadow: 0 0 10px rgba(251, 191, 36, 0.3);
      }

      .select-arrow {
        position: absolute;
        right: 10px;
        color: rgba(196, 181, 253, 0.7);
        font-size: 10px;
        pointer-events: none;
      }

      /* Footer */
      .settings-footer {
        display: flex;
        justify-content: space-between;
        padding: 16px 20px;
        background: linear-gradient(0deg, rgba(26, 16, 51, 0.95) 0%, rgba(26, 16, 51, 0.8) 100%);
        border-top: 2px solid rgba(139, 92, 246, 0.3);
        gap: 12px;
      }

      .settings-btn {
        flex: 1;
        padding: 12px 20px;
        border-radius: 12px;
        font-family: 'Fredoka', sans-serif;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: all 0.2s ease;
        border: 2px solid;
      }

      .btn-icon {
        font-size: 18px;
      }

      .settings-btn.reset {
        background: linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(220, 38, 38, 0.3) 100%);
        border-color: rgba(248, 113, 113, 0.4);
        color: #fca5a5;
      }

      .settings-btn.reset:hover {
        background: linear-gradient(135deg, rgba(239, 68, 68, 0.3) 0%, rgba(220, 38, 38, 0.4) 100%);
        border-color: rgba(248, 113, 113, 0.6);
        transform: translateY(-2px);
        box-shadow: 0 4px 15px rgba(239, 68, 68, 0.3);
      }

      .settings-btn.reset:active {
        transform: translateY(0) scale(0.98);
      }

      .settings-btn.apply {
        background: linear-gradient(135deg, rgba(139, 92, 246, 0.3) 0%, rgba(124, 58, 237, 0.4) 100%);
        border-color: rgba(167, 139, 250, 0.5);
        color: var(--color-gold, #fbbf24);
      }

      .settings-btn.apply:hover {
        background: linear-gradient(135deg, rgba(139, 92, 246, 0.4) 0%, rgba(124, 58, 237, 0.5) 100%);
        border-color: var(--color-gold, #fbbf24);
        transform: translateY(-2px);
        box-shadow: 0 4px 15px rgba(139, 92, 246, 0.4), 0 0 20px rgba(251, 191, 36, 0.2);
      }

      .settings-btn.apply:active {
        transform: translateY(0) scale(0.98);
      }

      /* Hover effects */
      .settings-toggle:active,
      .settings-slider:active,
      .settings-select:active {
        transform: scale(0.99);
      }

      /* Scrollbar */
      .settings-content::-webkit-scrollbar {
        width: 8px;
      }

      .settings-content::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.2);
        border-radius: 4px;
        margin: 4px;
      }

      .settings-content::-webkit-scrollbar-thumb {
        background: linear-gradient(180deg, #8b5cf6 0%, #7c3aed 100%);
        border-radius: 4px;
      }

      .settings-content::-webkit-scrollbar-thumb:hover {
        background: linear-gradient(180deg, #a78bfa 0%, #8b5cf6 100%);
      }
    `;
    document.head.appendChild(styles);
  }

  private setupEventListeners(): void {
    if (!this.container) return;

    // Close button with bounce
    const closeBtn = this.container.querySelector('.settings-close');
    closeBtn?.addEventListener('click', () => {
      animate(
        closeBtn,
        { transform: ['scale(1)', 'scale(0.8)', 'scale(1.1)', 'scale(1)'] },
        { duration: 0.2 }
      );
      setTimeout(() => this.close(), 100);
    });

    // Overlay click to close
    this.overlay?.addEventListener('click', () => this.close());

    // Apply button with celebration
    const applyBtn = this.container.querySelector('.settings-btn.apply');
    applyBtn?.addEventListener('click', () => {
      animate(
        applyBtn,
        { transform: ['scale(1)', 'scale(1.15)', 'scale(0.95)', 'scale(1)'] },
        { duration: 0.3 }
      );
      this.applySettings();
      setTimeout(() => this.close(), 200);
    });

    // Reset button with shake
    const resetBtn = this.container.querySelector('.settings-btn.reset');
    resetBtn?.addEventListener('click', () => {
      animate(
        resetBtn,
        {
          transform: [
            'rotate(0deg)',
            'rotate(-10deg)',
            'rotate(10deg)',
            'rotate(-5deg)',
            'rotate(5deg)',
            'rotate(0deg)',
          ],
        },
        { duration: 0.4 }
      );
      this.settings = { ...DEFAULT_SETTINGS };
      this.updateFormValues();
      this.applySettings();
    });

    // Toggle switches with bounce animation
    const toggles = this.container.querySelectorAll('.settings-toggle');
    toggles.forEach((toggle) => {
      toggle.addEventListener('click', () => {
        const knob = toggle.querySelector('.toggle-knob');
        if (knob) {
          animate(
            knob,
            { transform: ['scale(1)', 'scale(1.3)', 'scale(0.9)', 'scale(1)'] },
            { duration: 0.3 }
          );
        }
      });
    });

    const toggleDebug = this.container.querySelector('#setting-debug') as HTMLInputElement;
    toggleDebug?.addEventListener('change', () => {
      this.settings.showDebug = toggleDebug.checked;
    });

    const toggleMinimap = this.container.querySelector('#setting-minimap') as HTMLInputElement;
    toggleMinimap?.addEventListener('change', () => {
      this.settings.showMinimap = toggleMinimap.checked;
    });

    const toggleCrosshair = this.container.querySelector(
      '#setting-crosshair'
    ) as HTMLInputElement;
    toggleCrosshair?.addEventListener('change', () => {
      this.settings.showCrosshair = toggleCrosshair.checked;
    });

    const toggleControls = this.container.querySelector('#setting-controls') as HTMLInputElement;
    toggleControls?.addEventListener('change', () => {
      this.settings.showControlHints = toggleControls.checked;
    });

    // Sliders with value pop animation
    const soundSlider = this.container.querySelector('#setting-sound') as HTMLInputElement;
    const soundValue = soundSlider?.parentElement?.querySelector('.slider-value');
    soundSlider?.addEventListener('input', () => {
      this.settings.soundVolume = parseInt(soundSlider.value);
      if (soundValue) {
        soundValue.textContent = `${soundSlider.value}%`;
        animate(soundValue, { transform: ['scale(1)', 'scale(1.15)', 'scale(1)'] }, { duration: 0.15 });
      }
    });

    const musicSlider = this.container.querySelector('#setting-music') as HTMLInputElement;
    const musicValue = musicSlider?.parentElement?.querySelector('.slider-value');
    musicSlider?.addEventListener('input', () => {
      this.settings.musicVolume = parseInt(musicSlider.value);
      if (musicValue) {
        musicValue.textContent = `${musicSlider.value}%`;
        animate(musicValue, { transform: ['scale(1)', 'scale(1.15)', 'scale(1)'] }, { duration: 0.15 });
      }
    });

    const npcMusicSlider = this.container.querySelector('#setting-npc-music') as HTMLInputElement;
    const npcMusicValue = npcMusicSlider?.parentElement?.querySelector('.slider-value');
    npcMusicSlider?.addEventListener('input', () => {
      this.settings.npcMusicVolume = parseInt(npcMusicSlider.value);
      if (npcMusicValue) {
        npcMusicValue.textContent = `${npcMusicSlider.value}%`;
        animate(npcMusicValue, { transform: ['scale(1)', 'scale(1.15)', 'scale(1)'] }, { duration: 0.15 });
      }
    });

    const fovSlider = this.container.querySelector('#setting-fov') as HTMLInputElement;
    const fovValue = fovSlider?.parentElement?.querySelector('.slider-value');
    fovSlider?.addEventListener('input', () => {
      this.settings.fov = parseInt(fovSlider.value);
      if (fovValue) {
        fovValue.textContent = `${fovSlider.value}°`;
        animate(fovValue, { transform: ['scale(1)', 'scale(1.15)', 'scale(1)'] }, { duration: 0.15 });
      }
    });

    // Quality select with bounce
    const qualitySelect = this.container.querySelector('#setting-quality') as HTMLSelectElement;
    qualitySelect?.addEventListener('change', () => {
      this.settings.graphicsQuality = qualitySelect.value as 'low' | 'medium' | 'high';
      animate(qualitySelect, { transform: ['scale(1)', 'scale(1.05)', 'scale(1)'] }, { duration: 0.2 });
    });

    // Shadow quality select with bounce
    const shadowQualitySelect = this.container.querySelector('#setting-shadow-quality') as HTMLSelectElement;
    shadowQualitySelect?.addEventListener('change', () => {
      this.settings.shadowQuality = shadowQualitySelect.value as 'off' | 'low' | 'medium' | 'high';
      animate(shadowQualitySelect, { transform: ['scale(1)', 'scale(1.05)', 'scale(1)'] }, { duration: 0.2 });
    });

    // Post-processing toggles
    const togglePostProcessing = this.container.querySelector(
      '#setting-postprocessing'
    ) as HTMLInputElement;
    togglePostProcessing?.addEventListener('change', () => {
      this.settings.postProcessingEnabled = togglePostProcessing.checked;
    });

    const toggleBloom = this.container.querySelector('#setting-bloom') as HTMLInputElement;
    toggleBloom?.addEventListener('change', () => {
      this.settings.bloomEnabled = toggleBloom.checked;
    });

    const bloomIntensitySlider = this.container.querySelector(
      '#setting-bloom-intensity'
    ) as HTMLInputElement;
    const bloomIntensityValue =
      bloomIntensitySlider?.parentElement?.querySelector('.slider-value');
    bloomIntensitySlider?.addEventListener('input', () => {
      this.settings.bloomIntensity = parseInt(bloomIntensitySlider.value);
      if (bloomIntensityValue) {
        bloomIntensityValue.textContent = `${bloomIntensitySlider.value}%`;
        animate(
          bloomIntensityValue,
          { transform: ['scale(1)', 'scale(1.15)', 'scale(1)'] },
          { duration: 0.15 }
        );
      }
    });

    const toggleVignette = this.container.querySelector('#setting-vignette') as HTMLInputElement;
    toggleVignette?.addEventListener('change', () => {
      this.settings.vignetteEnabled = toggleVignette.checked;
    });

    // Voice settings
    const toggleVoiceEnabled = this.container.querySelector('#setting-voice-enabled') as HTMLInputElement;
    toggleVoiceEnabled?.addEventListener('change', () => {
      this.settings.frugVoiceEnabled = toggleVoiceEnabled.checked;
    });

    const voiceStyleSelect = this.container.querySelector('#setting-voice-style') as HTMLSelectElement;
    voiceStyleSelect?.addEventListener('change', () => {
      this.settings.frugVoice = voiceStyleSelect.value;
      animate(voiceStyleSelect, { transform: ['scale(1)', 'scale(1.05)', 'scale(1)'] }, { duration: 0.2 });
    });

    const voiceFrequencySlider = this.container.querySelector('#setting-voice-frequency') as HTMLInputElement;
    const voiceFrequencyValue = voiceFrequencySlider?.parentElement?.querySelector('.slider-value');
    voiceFrequencySlider?.addEventListener('input', () => {
      this.settings.frugVoiceFrequency = parseInt(voiceFrequencySlider.value);
      if (voiceFrequencyValue) {
        voiceFrequencyValue.textContent = `${voiceFrequencySlider.value}%`;
        animate(voiceFrequencyValue, { transform: ['scale(1)', 'scale(1.15)', 'scale(1)'] }, { duration: 0.15 });
      }
    });

    // Escape to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
  }

  private updateFormValues(): void {
    if (!this.container) return;

    (this.container.querySelector('#setting-debug') as HTMLInputElement).checked =
      this.settings.showDebug;
    (this.container.querySelector('#setting-minimap') as HTMLInputElement).checked =
      this.settings.showMinimap;
    (this.container.querySelector('#setting-crosshair') as HTMLInputElement).checked =
      this.settings.showCrosshair;
    (this.container.querySelector('#setting-controls') as HTMLInputElement).checked =
      this.settings.showControlHints;

    const soundSlider = this.container.querySelector('#setting-sound') as HTMLInputElement;
    soundSlider.value = String(this.settings.soundVolume);
    const soundValue = soundSlider.parentElement?.querySelector('.slider-value');
    if (soundValue) soundValue.textContent = `${this.settings.soundVolume}%`;

    const musicSlider = this.container.querySelector('#setting-music') as HTMLInputElement;
    musicSlider.value = String(this.settings.musicVolume);
    const musicValue = musicSlider.parentElement?.querySelector('.slider-value');
    if (musicValue) musicValue.textContent = `${this.settings.musicVolume}%`;

    const npcMusicSlider = this.container.querySelector('#setting-npc-music') as HTMLInputElement;
    npcMusicSlider.value = String(this.settings.npcMusicVolume);
    const npcMusicValue = npcMusicSlider.parentElement?.querySelector('.slider-value');
    if (npcMusicValue) npcMusicValue.textContent = `${this.settings.npcMusicVolume}%`;

    const fovSlider = this.container.querySelector('#setting-fov') as HTMLInputElement;
    fovSlider.value = String(this.settings.fov);
    const fovValue = fovSlider.parentElement?.querySelector('.slider-value');
    if (fovValue) fovValue.textContent = `${this.settings.fov}°`;

    (this.container.querySelector('#setting-quality') as HTMLSelectElement).value =
      this.settings.graphicsQuality;

    // Post-processing
    (this.container.querySelector('#setting-postprocessing') as HTMLInputElement).checked =
      this.settings.postProcessingEnabled;
    (this.container.querySelector('#setting-bloom') as HTMLInputElement).checked =
      this.settings.bloomEnabled;

    const bloomIntensitySlider = this.container.querySelector(
      '#setting-bloom-intensity'
    ) as HTMLInputElement;
    bloomIntensitySlider.value = String(this.settings.bloomIntensity);
    const bloomIntensityValue =
      bloomIntensitySlider.parentElement?.querySelector('.slider-value');
    if (bloomIntensityValue)
      bloomIntensityValue.textContent = `${this.settings.bloomIntensity}%`;

    (this.container.querySelector('#setting-vignette') as HTMLInputElement).checked =
      this.settings.vignetteEnabled;

    // Voice settings
    (this.container.querySelector('#setting-voice-enabled') as HTMLInputElement).checked =
      this.settings.frugVoiceEnabled;
    (this.container.querySelector('#setting-voice-style') as HTMLSelectElement).value =
      this.settings.frugVoice;

    const voiceFrequencySlider = this.container.querySelector('#setting-voice-frequency') as HTMLInputElement;
    voiceFrequencySlider.value = String(this.settings.frugVoiceFrequency);
    const voiceFrequencyValue = voiceFrequencySlider.parentElement?.querySelector('.slider-value');
    if (voiceFrequencyValue) voiceFrequencyValue.textContent = `${this.settings.frugVoiceFrequency}%`;

    // Animate all elements to show they've been reset
    const allControls = this.container.querySelectorAll(
      '.settings-toggle, .settings-slider, .settings-select'
    );
    animate(
      allControls,
      { transform: ['scale(1)', 'scale(1.03)', 'scale(1)'] },
      { delay: stagger(0.05), duration: 0.2 }
    );
  }

  private applySettings(): void {
    // Apply UI visibility settings
    const debugOverlay = document.getElementById('debug-overlay');
    const minimap = document.getElementById('minimap-container');
    const crosshair = document.getElementById('custom-cursor');
    const regenerateSeedBtn = document.getElementById('regenerate-seed-btn');

    if (debugOverlay) debugOverlay.style.display = this.settings.showDebug ? 'block' : 'none';
    if (minimap) minimap.style.display = this.settings.showMinimap ? 'block' : 'none';
    if (crosshair) crosshair.style.display = this.settings.showCrosshair ? 'block' : 'none';
    if (regenerateSeedBtn)
      regenerateSeedBtn.style.display = this.settings.showControlHints ? 'flex' : 'none';

    // Notify listeners
    this.onChange?.(this.settings);
  }

  private saveSettings(): void {
    try {
      localStorage.setItem('frugworld-settings', JSON.stringify(this.settings));
    } catch {
      console.warn('Failed to save settings to localStorage');
    }
  }

  private loadSettings(): void {
    try {
      const saved = localStorage.getItem('frugworld-settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        this.settings = { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch {
      console.warn('Failed to load settings from localStorage');
    }
  }
}
