/**
 * SettingsPanel - Game settings and options UI
 * A fun, child-friendly Sims-inspired settings menu with bouncy animations
 */

import { animate, stagger } from '@motionone/dom';

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
  graphicsQuality: 'low' | 'medium' | 'high';
  fov: number;
  // Post-processing effects
  postProcessingEnabled: boolean;
  bloomEnabled: boolean;
  bloomIntensity: number;
  vignetteEnabled: boolean;
}

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
  graphicsQuality: 'high',
  fov: 75,
  // Post-processing defaults
  postProcessingEnabled: true,
  bloomEnabled: true,
  bloomIntensity: 40,
  vignetteEnabled: true,
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
   * Open the settings panel with bouncy animation
   */
  open(): void {
    if (!this.container || !this.panel || this.isOpen) return;

    this.isOpen = true;
    this.container.classList.add('visible');

    // Animate overlay
    animate(this.overlay!, { opacity: [0, 1] }, { duration: 0.3 });

    // Bouncy panel entrance
    animate(
      this.panel!,
      {
        transform: [
          'scale(0.3) rotate(-5deg)',
          'scale(1.1) rotate(2deg)',
          'scale(0.95) rotate(-1deg)',
          'scale(1) rotate(0deg)',
        ],
        opacity: [0, 1, 1, 1],
      },
      {
        duration: 0.6,
        easing: [0.68, -0.55, 0.27, 1.55],
      }
    );

    // Stagger animate sections
    const sections = this.panel!.querySelectorAll('.settings-section');
    animate(
      sections,
      { opacity: [0, 1], transform: ['translateY(30px)', 'translateY(0)'] },
      { delay: stagger(0.1), duration: 0.4 }
    );

    // Animate title with bounce
    const title = this.panel!.querySelector('.settings-title');
    if (title) {
      animate(
        title,
        { transform: ['scale(0)', 'scale(1.2)', 'scale(0.9)', 'scale(1.05)', 'scale(1)'] },
        { duration: 0.8, delay: 0.1 }
      );
    }
  }

  /**
   * Close the settings panel with fun animation
   */
  close(): void {
    if (!this.container || !this.panel || !this.isOpen) return;

    this.isOpen = false;

    // Animate out
    animate(
      this.panel!,
      {
        transform: ['scale(1) rotate(0deg)', 'scale(1.05) rotate(3deg)', 'scale(0.3) rotate(-10deg)'],
        opacity: [1, 1, 0],
      },
      { duration: 0.35 }
    );

    animate(this.overlay!, { opacity: [1, 0] }, { duration: 0.3 }).finished.then(() => {
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
                <span class="toggle-label">Show Controls</span>
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
         FrugWorld Settings - Sims-Style Fun UI
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
        background: radial-gradient(circle at center, rgba(120, 200, 255, 0.15) 0%, rgba(30, 60, 100, 0.85) 100%);
        backdrop-filter: blur(8px);
      }

      .settings-panel {
        position: relative;
        width: 520px;
        max-width: 92vw;
        max-height: 88vh;
        background: linear-gradient(180deg, #4FC3F7 0%, #29B6F6 15%, #03A9F4 100%);
        border: 6px solid #FFF176;
        border-radius: 40px;
        box-shadow:
          0 0 0 4px #FFB74D,
          0 20px 60px rgba(0, 0, 0, 0.4),
          inset 0 2px 0 rgba(255, 255, 255, 0.4),
          inset 0 -4px 0 rgba(0, 0, 0, 0.1);
        font-family: 'Fredoka', 'Comic Sans MS', cursive;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        transform-origin: center;
      }

      /* Header */
      .settings-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px 28px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.3) 0%, transparent 100%);
        border-bottom: 4px solid rgba(255, 255, 255, 0.3);
        position: relative;
      }

      .settings-header-deco {
        position: absolute;
        top: 8px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 8px;
      }

      .deco-star {
        color: #FFF176;
        font-size: 16px;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        animation: starTwinkle 2s ease-in-out infinite;
      }

      .deco-star:nth-child(2) {
        animation-delay: 0.3s;
        font-size: 20px;
      }

      .deco-star:nth-child(3) {
        animation-delay: 0.6s;
      }

      @keyframes starTwinkle {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.6; transform: scale(0.8); }
      }

      .settings-title {
        font-family: 'Bubblegum Sans', 'Fredoka', cursive;
        font-size: 42px;
        font-weight: 700;
        color: #FFF;
        margin: 0;
        text-shadow:
          3px 3px 0 #FF7043,
          -1px -1px 0 #FF7043,
          1px -1px 0 #FF7043,
          -1px 1px 0 #FF7043,
          0 4px 8px rgba(0, 0, 0, 0.3);
        letter-spacing: 2px;
      }

      .settings-close {
        background: linear-gradient(180deg, #FF7043 0%, #E64A19 100%);
        border: 4px solid #FFAB91;
        border-radius: 50%;
        color: #FFF;
        width: 52px;
        height: 52px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow:
          0 4px 12px rgba(0, 0, 0, 0.3),
          inset 0 2px 0 rgba(255, 255, 255, 0.3);
        transition: transform 0.15s ease;
      }

      .settings-close:hover {
        transform: scale(1.1) rotate(90deg);
      }

      .settings-close:active {
        transform: scale(0.95) rotate(90deg);
      }

      .close-icon {
        font-size: 24px;
        font-weight: bold;
        text-shadow: 0 2px 2px rgba(0, 0, 0, 0.2);
      }

      /* Content */
      .settings-content {
        flex: 1;
        overflow-y: auto;
        padding: 24px 28px;
      }

      .settings-section {
        margin-bottom: 24px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 24px;
        padding: 20px;
        border: 3px solid rgba(255, 255, 255, 0.4);
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .settings-section:last-child {
        margin-bottom: 0;
      }

      .settings-section-title {
        font-family: 'Bubblegum Sans', 'Fredoka', cursive;
        font-size: 26px;
        font-weight: 600;
        color: #FFF;
        margin: 0 0 16px 0;
        text-shadow: 2px 2px 0 rgba(0, 0, 0, 0.2);
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .section-icon {
        font-size: 28px;
        filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.2));
      }

      .settings-group {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      /* Toggle Switch - Fun Pill Style */
      .settings-toggle {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 14px 18px;
        background: linear-gradient(180deg, #81D4FA 0%, #4FC3F7 100%);
        border: 3px solid rgba(255, 255, 255, 0.5);
        border-radius: 20px;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
      }

      .settings-toggle:hover {
        transform: translateY(-2px) scale(1.02);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
      }

      .toggle-label {
        font-size: 18px;
        font-weight: 500;
        color: #FFF;
        text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.15);
      }

      .settings-toggle input {
        display: none;
      }

      .toggle-switch {
        width: 60px;
        height: 32px;
        background: linear-gradient(180deg, #90A4AE 0%, #78909C 100%);
        border-radius: 16px;
        position: relative;
        transition: all 0.3s cubic-bezier(0.68, -0.55, 0.27, 1.55);
        box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.3);
        border: 2px solid rgba(255, 255, 255, 0.3);
      }

      .toggle-knob {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 24px;
        height: 24px;
        background: linear-gradient(180deg, #FFF 0%, #E0E0E0 100%);
        border-radius: 50%;
        transition: all 0.3s cubic-bezier(0.68, -0.55, 0.27, 1.55);
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
      }

      .settings-toggle input:checked + .toggle-switch {
        background: linear-gradient(180deg, #66BB6A 0%, #43A047 100%);
      }

      .settings-toggle input:checked + .toggle-switch .toggle-knob {
        left: 30px;
        background: linear-gradient(180deg, #FFF 0%, #C8E6C9 100%);
        box-shadow: 0 0 12px rgba(102, 187, 106, 0.6), 0 2px 6px rgba(0, 0, 0, 0.3);
      }

      /* Slider - Chunky Fun Style */
      .settings-slider {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 14px 18px;
        background: linear-gradient(180deg, #81D4FA 0%, #4FC3F7 100%);
        border: 3px solid rgba(255, 255, 255, 0.5);
        border-radius: 20px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
      }

      .slider-label {
        font-size: 18px;
        font-weight: 500;
        color: #FFF;
        text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.15);
      }

      .slider-container {
        display: flex;
        align-items: center;
        gap: 14px;
      }

      .settings-slider input[type="range"] {
        flex: 1;
        height: 14px;
        -webkit-appearance: none;
        appearance: none;
        background: linear-gradient(180deg, #B3E5FC 0%, #81D4FA 100%);
        border-radius: 7px;
        outline: none;
        border: 2px solid rgba(255, 255, 255, 0.5);
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.15);
      }

      .settings-slider input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 32px;
        height: 32px;
        background: linear-gradient(180deg, #FFD54F 0%, #FFB300 100%);
        border-radius: 50%;
        cursor: pointer;
        border: 4px solid #FFF;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        transition: all 0.2s ease;
      }

      .settings-slider input[type="range"]::-webkit-slider-thumb:hover {
        transform: scale(1.15);
        box-shadow: 0 0 16px rgba(255, 193, 7, 0.5), 0 4px 12px rgba(0, 0, 0, 0.3);
      }

      .settings-slider input[type="range"]::-moz-range-thumb {
        width: 28px;
        height: 28px;
        background: linear-gradient(180deg, #FFD54F 0%, #FFB300 100%);
        border-radius: 50%;
        cursor: pointer;
        border: 4px solid #FFF;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }

      .slider-value {
        min-width: 55px;
        font-size: 18px;
        font-weight: 600;
        color: #FFF;
        text-align: center;
        background: rgba(255, 255, 255, 0.25);
        padding: 6px 12px;
        border-radius: 12px;
        text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.15);
      }

      /* Select - Bubble Style */
      .settings-select {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 14px 18px;
        background: linear-gradient(180deg, #81D4FA 0%, #4FC3F7 100%);
        border: 3px solid rgba(255, 255, 255, 0.5);
        border-radius: 20px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
      }

      .select-label {
        font-size: 18px;
        font-weight: 500;
        color: #FFF;
        text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.15);
      }

      .select-wrapper {
        position: relative;
        display: flex;
        align-items: center;
      }

      .settings-select select {
        padding: 10px 40px 10px 16px;
        background: linear-gradient(180deg, #B3E5FC 0%, #81D4FA 100%);
        border: 3px solid rgba(255, 255, 255, 0.6);
        border-radius: 16px;
        color: #01579B;
        font-size: 17px;
        font-family: 'Fredoka', cursive;
        font-weight: 600;
        cursor: pointer;
        outline: none;
        appearance: none;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
        transition: all 0.2s ease;
      }

      .settings-select select:hover {
        transform: scale(1.03);
      }

      .select-arrow {
        position: absolute;
        right: 14px;
        color: #01579B;
        font-size: 12px;
        pointer-events: none;
      }

      /* Footer */
      .settings-footer {
        display: flex;
        justify-content: space-between;
        padding: 20px 28px;
        background: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.1) 100%);
        border-top: 4px solid rgba(255, 255, 255, 0.2);
        gap: 16px;
      }

      .settings-btn {
        flex: 1;
        padding: 16px 24px;
        border-radius: 20px;
        font-family: 'Bubblegum Sans', 'Fredoka', cursive;
        font-size: 22px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        transition: all 0.2s ease;
        border: 4px solid;
        text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.2);
      }

      .btn-icon {
        font-size: 24px;
      }

      .settings-btn.reset {
        background: linear-gradient(180deg, #FFAB91 0%, #FF7043 100%);
        border-color: #FFCCBC;
        color: #FFF;
        box-shadow: 0 4px 12px rgba(255, 112, 67, 0.3);
      }

      .settings-btn.reset:hover {
        transform: translateY(-3px) scale(1.03);
        box-shadow: 0 8px 20px rgba(255, 112, 67, 0.4);
      }

      .settings-btn.reset:active {
        transform: translateY(0) scale(0.98);
      }

      .settings-btn.apply {
        background: linear-gradient(180deg, #81C784 0%, #4CAF50 100%);
        border-color: #A5D6A7;
        color: #FFF;
        box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
      }

      .settings-btn.apply:hover {
        transform: translateY(-3px) scale(1.03);
        box-shadow: 0 8px 20px rgba(76, 175, 80, 0.4);
      }

      .settings-btn.apply:active {
        transform: translateY(0) scale(0.98);
      }

      /* Fun hover bounce for all interactive elements */
      .settings-toggle:active,
      .settings-slider:active,
      .settings-select:active {
        transform: scale(0.98);
      }

      /* Scrollbar - Chunky Colorful */
      .settings-content::-webkit-scrollbar {
        width: 14px;
      }

      .settings-content::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 7px;
        margin: 8px;
      }

      .settings-content::-webkit-scrollbar-thumb {
        background: linear-gradient(180deg, #FFD54F 0%, #FFB300 100%);
        border-radius: 7px;
        border: 2px solid rgba(255, 255, 255, 0.5);
      }

      .settings-content::-webkit-scrollbar-thumb:hover {
        background: linear-gradient(180deg, #FFE082 0%, #FFD54F 100%);
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
    const controlsHint = document.getElementById('controls-hint');

    if (debugOverlay) debugOverlay.style.display = this.settings.showDebug ? 'block' : 'none';
    if (minimap) minimap.style.display = this.settings.showMinimap ? 'block' : 'none';
    if (crosshair) crosshair.style.display = this.settings.showCrosshair ? 'block' : 'none';
    if (controlsHint)
      controlsHint.style.display = this.settings.showControlHints ? 'flex' : 'none';

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
