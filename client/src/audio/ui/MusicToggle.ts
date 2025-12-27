/**
 * MusicToggle - Audio control panel for Frugworld
 * A compact UI component for controlling music playback, mode selection, and volume
 * Styled to match the FrugWorld dark purple/gold theme
 */

export type MusicMode = 'legacy' | 'generative';

export interface MusicToggleConfig {
  /** Callback when music mode changes between legacy and generative */
  onModeChange: (mode: MusicMode) => void;
  /** Callback when volume changes (0-100) */
  onVolumeChange: (volume: number) => void;
  /** Callback when music is enabled/disabled */
  onEnabledChange: (enabled: boolean) => void;
  /** Callback when density changes for generative mode (0-100) */
  onDensityChange?: (density: number) => void;
  /** Initial music mode */
  initialMode?: MusicMode;
  /** Initial volume (0-100) */
  initialVolume?: number;
  /** Initial enabled state */
  initialEnabled?: boolean;
  /** Initial density for generative mode (0-100) */
  initialDensity?: number;
  /** Position of the toggle panel */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Whether to show the density slider (only visible in generative mode) */
  showDensityControl?: boolean;
}

const DEFAULT_CONFIG: Partial<MusicToggleConfig> = {
  initialMode: 'legacy',
  initialVolume: 60,
  initialEnabled: true,
  initialDensity: 50,
  position: 'bottom-right',
  showDensityControl: true,
};

export class MusicToggle {
  private container: HTMLDivElement | null = null;
  private config: MusicToggleConfig;
  private isVisible: boolean = true;
  private styleElement: HTMLStyleElement | null = null;

  // Current state
  private mode: MusicMode;
  private volume: number;
  private enabled: boolean;
  private density: number;

  // DOM element references
  private enabledToggle: HTMLInputElement | null = null;
  private modeButtons: { legacy: HTMLButtonElement | null; generative: HTMLButtonElement | null } = {
    legacy: null,
    generative: null,
  };
  private volumeSlider: HTMLInputElement | null = null;
  private volumeValue: HTMLSpanElement | null = null;
  private densityContainer: HTMLElement | null = null;
  private densitySlider: HTMLInputElement | null = null;
  private densityValue: HTMLSpanElement | null = null;

  constructor(config: MusicToggleConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.mode = this.config.initialMode || 'legacy';
    this.volume = this.config.initialVolume ?? 60;
    this.enabled = this.config.initialEnabled ?? true;
    this.density = this.config.initialDensity ?? 50;
  }

  /**
   * Mount the component to a parent element
   */
  mount(parent: HTMLElement): void {
    if (this.container) {
      return; // Already mounted
    }

    this.injectStyles();
    this.createDOM();
    this.setupEventListeners();

    if (this.container) {
      parent.appendChild(this.container);
    }

    // Update initial visibility of density control
    this.updateDensityVisibility();
  }

  /**
   * Unmount the component from the DOM
   */
  unmount(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
    this.container = null;

    // Remove styles
    if (this.styleElement && this.styleElement.parentElement) {
      this.styleElement.parentElement.removeChild(this.styleElement);
    }
    this.styleElement = null;
  }

  /**
   * Set the music mode (legacy or generative)
   */
  setMode(mode: MusicMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.updateModeButtons();
    this.updateDensityVisibility();
  }

  /**
   * Set the volume level (0-100)
   */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(100, volume));
    if (this.volumeSlider) {
      this.volumeSlider.value = String(this.volume);
    }
    if (this.volumeValue) {
      this.volumeValue.textContent = `${this.volume}%`;
    }
  }

  /**
   * Set the enabled state
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.enabledToggle) {
      this.enabledToggle.checked = enabled;
    }
    this.updateEnabledState();
  }

  /**
   * Set the density level for generative mode (0-100)
   */
  setDensity(density: number): void {
    this.density = Math.max(0, Math.min(100, density));
    if (this.densitySlider) {
      this.densitySlider.value = String(this.density);
    }
    if (this.densityValue) {
      this.densityValue.textContent = `${this.density}%`;
    }
  }

  /**
   * Show the component
   */
  show(): void {
    if (this.container && !this.isVisible) {
      this.container.classList.remove('music-toggle-hidden');
      this.container.classList.add('music-toggle-visible');
      this.isVisible = true;
    }
  }

  /**
   * Hide the component
   */
  hide(): void {
    if (this.container && this.isVisible) {
      this.container.classList.remove('music-toggle-visible');
      this.container.classList.add('music-toggle-hidden');
      this.isVisible = false;
    }
  }

  /**
   * Check if the component is visible
   */
  getIsVisible(): boolean {
    return this.isVisible;
  }

  /**
   * Get current mode
   */
  getMode(): MusicMode {
    return this.mode;
  }

  /**
   * Get current volume
   */
  getVolume(): number {
    return this.volume;
  }

  /**
   * Get current enabled state
   */
  getEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get current density
   */
  getDensity(): number {
    return this.density;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createDOM(): void {
    this.container = document.createElement('div');
    this.container.className = `music-toggle-container music-toggle-${this.config.position} music-toggle-visible`;

    this.container.innerHTML = `
      <div class="music-toggle-panel">
        <div class="music-toggle-header">
          <div class="music-toggle-title">
            <span class="music-toggle-icon">&#127925;</span>
            Music
          </div>
          <label class="music-toggle-switch">
            <input type="checkbox" id="music-enabled-toggle" ${this.enabled ? 'checked' : ''}>
            <span class="music-toggle-slider">
              <span class="music-toggle-knob"></span>
            </span>
          </label>
        </div>

        <div class="music-toggle-body">
          <div class="music-toggle-mode">
            <div class="music-mode-tabs">
              <button class="music-mode-btn ${this.mode === 'legacy' ? 'active' : ''}" data-mode="legacy">
                <span class="mode-icon">&#127926;</span>
                Legacy
              </button>
              <button class="music-mode-btn ${this.mode === 'generative' ? 'active' : ''}" data-mode="generative">
                <span class="mode-icon">&#10024;</span>
                Generative
              </button>
            </div>
          </div>

          <div class="music-toggle-slider-group">
            <label class="music-slider-label">
              <span class="slider-text">Volume</span>
              <span class="slider-value" id="music-volume-value">${this.volume}%</span>
            </label>
            <input
              type="range"
              class="music-range-slider"
              id="music-volume-slider"
              min="0"
              max="100"
              value="${this.volume}"
            >
          </div>

          <div class="music-toggle-slider-group music-density-control ${this.mode === 'generative' ? '' : 'hidden'}">
            <label class="music-slider-label">
              <span class="slider-text">Density</span>
              <span class="slider-value" id="music-density-value">${this.density}%</span>
            </label>
            <input
              type="range"
              class="music-range-slider density"
              id="music-density-slider"
              min="0"
              max="100"
              value="${this.density}"
            >
          </div>
        </div>
      </div>
    `;

    // Get element references
    this.enabledToggle = this.container.querySelector('#music-enabled-toggle');
    this.modeButtons.legacy = this.container.querySelector('[data-mode="legacy"]');
    this.modeButtons.generative = this.container.querySelector('[data-mode="generative"]');
    this.volumeSlider = this.container.querySelector('#music-volume-slider');
    this.volumeValue = this.container.querySelector('#music-volume-value');
    this.densityContainer = this.container.querySelector('.music-density-control');
    this.densitySlider = this.container.querySelector('#music-density-slider');
    this.densityValue = this.container.querySelector('#music-density-value');

    // Apply initial enabled state styling
    this.updateEnabledState();
  }

  private injectStyles(): void {
    const styleId = 'music-toggle-styles';
    if (document.getElementById(styleId)) {
      this.styleElement = document.getElementById(styleId) as HTMLStyleElement;
      return;
    }

    this.styleElement = document.createElement('style');
    this.styleElement.id = styleId;
    this.styleElement.textContent = `
      /* ========================================
         Music Toggle - FrugWorld Theme
         ======================================== */

      .music-toggle-container {
        position: fixed;
        z-index: 1000;
        font-family: 'Fredoka', 'Nunito', sans-serif;
        transition: opacity 0.3s ease, transform 0.3s ease;
        pointer-events: auto;
      }

      /* Positioning */
      .music-toggle-top-left {
        top: 20px;
        left: 20px;
      }

      .music-toggle-top-right {
        top: 20px;
        right: 20px;
      }

      .music-toggle-bottom-left {
        bottom: 20px;
        left: 20px;
      }

      .music-toggle-bottom-right {
        bottom: 20px;
        right: 20px;
      }

      /* Visibility states */
      .music-toggle-visible {
        opacity: 1;
        transform: translateY(0);
      }

      .music-toggle-hidden {
        opacity: 0;
        transform: translateY(10px);
        pointer-events: none;
      }

      /* Main panel */
      .music-toggle-panel {
        min-width: 220px;
        background: linear-gradient(135deg, #2d1b4e 0%, #1a1033 100%);
        border: 2px solid var(--color-purple, #8b5cf6);
        border-radius: 16px;
        overflow: hidden;
        box-shadow:
          0 0 0 1px rgba(0, 0, 0, 0.3),
          0 0 30px rgba(139, 92, 246, 0.3),
          0 10px 40px rgba(0, 0, 0, 0.5);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }

      .music-toggle-panel:hover {
        transform: translateY(-2px);
        box-shadow:
          0 0 0 1px rgba(0, 0, 0, 0.3),
          0 0 40px rgba(139, 92, 246, 0.4),
          0 15px 50px rgba(0, 0, 0, 0.5);
      }

      /* Header */
      .music-toggle-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        background: linear-gradient(90deg, rgba(139, 92, 246, 0.25) 0%, rgba(236, 72, 153, 0.15) 100%);
        border-bottom: 1px solid rgba(139, 92, 246, 0.3);
      }

      .music-toggle-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 16px;
        font-weight: 600;
        color: var(--color-gold, #fbbf24);
        text-shadow: 0 0 10px rgba(251, 191, 36, 0.4);
      }

      .music-toggle-icon {
        font-size: 18px;
        filter: drop-shadow(0 0 4px currentColor);
      }

      /* Enable/Disable Toggle Switch */
      .music-toggle-switch {
        position: relative;
        display: inline-block;
        cursor: pointer;
      }

      .music-toggle-switch input {
        display: none;
      }

      .music-toggle-slider {
        display: block;
        width: 44px;
        height: 24px;
        background: rgba(100, 100, 120, 0.5);
        border-radius: 12px;
        position: relative;
        transition: all 0.3s cubic-bezier(0.68, -0.55, 0.27, 1.55);
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
        border: 1px solid rgba(139, 92, 246, 0.2);
      }

      .music-toggle-knob {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 18px;
        height: 18px;
        background: linear-gradient(180deg, #e2e8f0 0%, #cbd5e1 100%);
        border-radius: 50%;
        transition: all 0.3s cubic-bezier(0.68, -0.55, 0.27, 1.55);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .music-toggle-switch input:checked + .music-toggle-slider {
        background: linear-gradient(180deg, #8b5cf6 0%, #7c3aed 100%);
        border-color: rgba(167, 139, 250, 0.5);
      }

      .music-toggle-switch input:checked + .music-toggle-slider .music-toggle-knob {
        left: 22px;
        background: linear-gradient(180deg, #fbbf24 0%, #f59e0b 100%);
        box-shadow: 0 0 10px rgba(251, 191, 36, 0.5), 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      /* Body */
      .music-toggle-body {
        padding: 14px 16px 16px;
        transition: opacity 0.3s ease;
      }

      .music-toggle-body.disabled {
        opacity: 0.5;
        pointer-events: none;
      }

      /* Mode Tabs */
      .music-toggle-mode {
        margin-bottom: 14px;
      }

      .music-mode-tabs {
        display: flex;
        gap: 8px;
        background: rgba(0, 0, 0, 0.3);
        padding: 4px;
        border-radius: 10px;
        border: 1px solid rgba(139, 92, 246, 0.2);
      }

      .music-mode-btn {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 12px;
        background: transparent;
        border: none;
        border-radius: 8px;
        color: rgba(196, 181, 253, 0.7);
        font-family: inherit;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .music-mode-btn:hover {
        color: rgba(196, 181, 253, 0.9);
        background: rgba(139, 92, 246, 0.1);
      }

      .music-mode-btn.active {
        background: linear-gradient(135deg, rgba(139, 92, 246, 0.4) 0%, rgba(124, 58, 237, 0.5) 100%);
        color: var(--color-gold, #fbbf24);
        box-shadow: 0 0 10px rgba(139, 92, 246, 0.3);
        border: 1px solid rgba(139, 92, 246, 0.4);
      }

      .mode-icon {
        font-size: 14px;
      }

      /* Slider Groups */
      .music-toggle-slider-group {
        margin-bottom: 12px;
        transition: all 0.3s ease;
      }

      .music-toggle-slider-group:last-child {
        margin-bottom: 0;
      }

      .music-toggle-slider-group.hidden {
        opacity: 0;
        max-height: 0;
        margin-bottom: 0;
        overflow: hidden;
        pointer-events: none;
      }

      .music-slider-label {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }

      .slider-text {
        font-size: 13px;
        font-weight: 500;
        color: rgba(196, 181, 253, 0.9);
      }

      .slider-value {
        font-size: 12px;
        font-weight: 700;
        color: var(--color-text, #e2e8f0);
        background: rgba(139, 92, 246, 0.2);
        padding: 3px 8px;
        border-radius: 6px;
        border: 1px solid rgba(139, 92, 246, 0.2);
        min-width: 42px;
        text-align: center;
      }

      /* Range Slider */
      .music-range-slider {
        width: 100%;
        height: 8px;
        -webkit-appearance: none;
        appearance: none;
        background: rgba(0, 0, 0, 0.4);
        border-radius: 4px;
        outline: none;
        cursor: pointer;
      }

      .music-range-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 18px;
        height: 18px;
        background: linear-gradient(180deg, #fbbf24 0%, #f59e0b 100%);
        border-radius: 50%;
        cursor: pointer;
        border: 2px solid rgba(255, 255, 255, 0.3);
        box-shadow: 0 0 10px rgba(251, 191, 36, 0.4), 0 2px 6px rgba(0, 0, 0, 0.3);
        transition: all 0.2s ease;
      }

      .music-range-slider::-webkit-slider-thumb:hover {
        transform: scale(1.15);
        box-shadow: 0 0 15px rgba(251, 191, 36, 0.6), 0 2px 6px rgba(0, 0, 0, 0.3);
      }

      .music-range-slider::-moz-range-thumb {
        width: 16px;
        height: 16px;
        background: linear-gradient(180deg, #fbbf24 0%, #f59e0b 100%);
        border-radius: 50%;
        cursor: pointer;
        border: 2px solid rgba(255, 255, 255, 0.3);
        box-shadow: 0 0 10px rgba(251, 191, 36, 0.4), 0 2px 6px rgba(0, 0, 0, 0.3);
      }

      /* Density slider uses purple/pink theme */
      .music-range-slider.density::-webkit-slider-thumb {
        background: linear-gradient(180deg, #a78bfa 0%, #8b5cf6 100%);
        box-shadow: 0 0 10px rgba(139, 92, 246, 0.4), 0 2px 6px rgba(0, 0, 0, 0.3);
      }

      .music-range-slider.density::-webkit-slider-thumb:hover {
        box-shadow: 0 0 15px rgba(139, 92, 246, 0.6), 0 2px 6px rgba(0, 0, 0, 0.3);
      }

      .music-range-slider.density::-moz-range-thumb {
        background: linear-gradient(180deg, #a78bfa 0%, #8b5cf6 100%);
        box-shadow: 0 0 10px rgba(139, 92, 246, 0.4), 0 2px 6px rgba(0, 0, 0, 0.3);
      }

      /* Slider track fill effect (webkit only) */
      .music-range-slider::-webkit-slider-runnable-track {
        height: 8px;
        border-radius: 4px;
        background: linear-gradient(90deg,
          rgba(139, 92, 246, 0.6) 0%,
          rgba(139, 92, 246, 0.2) 100%
        );
      }
    `;
    document.head.appendChild(this.styleElement);
  }

  private setupEventListeners(): void {
    if (!this.container) return;

    // Enabled toggle
    if (this.enabledToggle) {
      this.enabledToggle.addEventListener('change', () => {
        this.enabled = this.enabledToggle!.checked;
        this.updateEnabledState();
        this.config.onEnabledChange(this.enabled);
      });
    }

    // Mode buttons
    if (this.modeButtons.legacy) {
      this.modeButtons.legacy.addEventListener('click', () => {
        if (this.mode !== 'legacy') {
          this.mode = 'legacy';
          this.updateModeButtons();
          this.updateDensityVisibility();
          this.config.onModeChange('legacy');
        }
      });
    }

    if (this.modeButtons.generative) {
      this.modeButtons.generative.addEventListener('click', () => {
        if (this.mode !== 'generative') {
          this.mode = 'generative';
          this.updateModeButtons();
          this.updateDensityVisibility();
          this.config.onModeChange('generative');
        }
      });
    }

    // Volume slider
    if (this.volumeSlider) {
      this.volumeSlider.addEventListener('input', () => {
        this.volume = parseInt(this.volumeSlider!.value, 10);
        if (this.volumeValue) {
          this.volumeValue.textContent = `${this.volume}%`;
        }
        this.config.onVolumeChange(this.volume);
      });
    }

    // Density slider
    if (this.densitySlider && this.config.onDensityChange) {
      this.densitySlider.addEventListener('input', () => {
        this.density = parseInt(this.densitySlider!.value, 10);
        if (this.densityValue) {
          this.densityValue.textContent = `${this.density}%`;
        }
        this.config.onDensityChange?.(this.density);
      });
    }
  }

  private updateModeButtons(): void {
    if (this.modeButtons.legacy) {
      this.modeButtons.legacy.classList.toggle('active', this.mode === 'legacy');
    }
    if (this.modeButtons.generative) {
      this.modeButtons.generative.classList.toggle('active', this.mode === 'generative');
    }
  }

  private updateDensityVisibility(): void {
    if (!this.densityContainer || !this.config.showDensityControl) return;

    if (this.mode === 'generative') {
      this.densityContainer.classList.remove('hidden');
    } else {
      this.densityContainer.classList.add('hidden');
    }
  }

  private updateEnabledState(): void {
    if (!this.container) return;

    const body = this.container.querySelector('.music-toggle-body');
    if (body) {
      if (this.enabled) {
        body.classList.remove('disabled');
      } else {
        body.classList.add('disabled');
      }
    }
  }
}
