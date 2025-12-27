/**
 * FrugHUD - Bottom center HUD with animated Frug character
 * Uses Motion One for smooth animations
 * Displays mood, health, energy, and other stats
 * Click the character to open the full stats panel
 */

import { animate, spring } from '@motionone/dom';
import {
  FrugState,
  FrugStateManager,
  getFrugStateManager,
  getMoodEmoji,
  getMoodColor,
  MoodType,
  calculateMood,
} from '../state/FrugState';
import { FrugStatsPanel } from './FrugStatsPanel';

export interface FrugHUDConfig {
  showMoodIndicator: boolean;
  showExtraStats: boolean;
}

const DEFAULT_CONFIG: FrugHUDConfig = {
  showMoodIndicator: true,
  showExtraStats: true,
};

export class FrugHUD {
  private config: FrugHUDConfig;
  private container: HTMLElement | null = null;
  private frugBody: HTMLElement | null = null;
  private frugCharacter: HTMLElement | null = null;
  private leftEye: HTMLElement | null = null;
  private rightEye: HTMLElement | null = null;
  private leftPupil: HTMLElement | null = null;
  private rightPupil: HTMLElement | null = null;
  private moodIndicator: HTMLElement | null = null;
  private mouthElement: HTMLElement | null = null;

  // Animation state
  private blinkTimer: number = 0;
  private nextBlinkTime: number = 2000 + Math.random() * 3000;
  private isBlinking: boolean = false;

  // Idle animation state
  private idleTimer: number = 0;
  private currentIdleAnimation: string = 'breathe';

  // Eye look direction (follows cursor)
  private eyeTargetX: number = 0;
  private eyeTargetY: number = 0;
  private mouseX: number = 0;
  private mouseY: number = 0;
  private boundMouseMove: ((e: MouseEvent) => void) | null = null;

  // Animation frame
  private animationFrame: number = 0;
  private lastTime: number = 0;

  // State manager
  private stateManager: FrugStateManager;
  private unsubscribe: (() => void) | null = null;

  // Stats panel
  private statsPanel: FrugStatsPanel;

  // Current mood for visual effects
  private currentMood: MoodType = 'content';

  constructor(config: Partial<FrugHUDConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stateManager = getFrugStateManager();
    this.statsPanel = new FrugStatsPanel();
  }

  initialize(parent: HTMLElement): void {
    // Initialize stats panel
    this.statsPanel.initialize();

    // Create container
    this.container = document.createElement('div');
    this.container.id = 'frug-hud';
    this.container.innerHTML = `
      <div class="frug-hud-content">
        <div class="frug-stat frug-health">
          <div class="frug-stat-bar">
            <div class="frug-stat-fill health" style="height: 100%"></div>
          </div>
          <div class="frug-stat-icon">❤️</div>
          <span class="frug-stat-value health-value">100</span>
        </div>

        <div class="frug-character-wrapper">
          <div class="frug-character" id="frug-character-btn" title="Click to view Frug's status">
            <div class="frug-mood-indicator" id="frug-mood-indicator">😌</div>
            <div class="frug-body" id="frug-body">
              <div class="frug-stripe"></div>
              <div class="frug-highlight"></div>
              <div class="frug-highlight-small"></div>
              <div class="frug-face">
                <div class="frug-eye frug-eye-left" id="frug-eye-left">
                  <div class="frug-pupil" id="frug-pupil-left"></div>
                </div>
                <div class="frug-eye frug-eye-right" id="frug-eye-right">
                  <div class="frug-pupil" id="frug-pupil-right"></div>
                </div>
                <div class="frug-mouth" id="frug-mouth"></div>
              </div>
            </div>
            <div class="frug-click-hint">Click me!</div>
          </div>
        </div>

        <div class="frug-stat frug-energy">
          <div class="frug-stat-icon">⚡</div>
          <div class="frug-stat-bar">
            <div class="frug-stat-fill energy" style="height: 80%"></div>
          </div>
          <span class="frug-stat-value energy-value">80</span>
        </div>
      </div>

      <div class="frug-extra-stats" id="frug-extra-stats">
        <div class="frug-mini-stat" id="frug-hunger-stat" title="Hunger">
          <span class="frug-mini-icon">🍖</span>
          <div class="frug-mini-bar">
            <div class="frug-mini-fill hunger" style="width: 75%"></div>
          </div>
        </div>
        <div class="frug-mini-stat" id="frug-happiness-stat" title="Happiness">
          <span class="frug-mini-icon">😊</span>
          <div class="frug-mini-bar">
            <div class="frug-mini-fill happiness" style="width: 70%"></div>
          </div>
        </div>
      </div>
    `;

    parent.appendChild(this.container);

    // Inject additional styles
    this.injectStyles();

    // Get element references
    this.frugBody = document.getElementById('frug-body');
    this.frugCharacter = document.getElementById('frug-character-btn');
    this.leftEye = document.getElementById('frug-eye-left');
    this.rightEye = document.getElementById('frug-eye-right');
    this.leftPupil = document.getElementById('frug-pupil-left');
    this.rightPupil = document.getElementById('frug-pupil-right');
    this.moodIndicator = document.getElementById('frug-mood-indicator');
    this.mouthElement = document.getElementById('frug-mouth');

    // Setup click handler for character
    this.setupClickHandler();

    // Subscribe to state changes
    this.unsubscribe = this.stateManager.subscribe((state) => {
      this.updateFromState(state);
    });

    // Start breathing animation
    this.startBreathingAnimation();

    // Setup cursor tracking for eyes
    this.setupCursorTracking();

    // Start animation loop for blinks and idle
    this.lastTime = performance.now();
    this.scheduleNextIdle();
    this.animationLoop();

    // Start automatic state updates
    this.stateManager.startAutoUpdate(10000);

    // Initial state update
    this.updateFromState(this.stateManager.getState());
  }

  private injectStyles(): void {
    const styleId = 'frug-hud-extra-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Character wrapper for click area */
      .frug-character-wrapper {
        position: relative;
      }

      /* Make character clickable */
      .frug-character {
        cursor: pointer;
        transition: transform 0.2s ease;
        pointer-events: auto;
        position: relative;
      }

      .frug-character:hover {
        transform: scale(1.05);
      }

      .frug-character:active {
        transform: scale(0.98);
      }

      /* Click hint */
      .frug-click-hint {
        position: absolute;
        bottom: -20px;
        left: 50%;
        transform: translateX(-50%);
        font-family: 'Nunito', sans-serif;
        font-size: 10px;
        color: rgba(196, 181, 253, 0.6);
        white-space: nowrap;
        opacity: 0;
        transition: opacity 0.2s;
        pointer-events: none;
      }

      .frug-character:hover .frug-click-hint {
        opacity: 1;
      }

      /* Mood indicator badge - scaled for 1.5x character */
      .frug-mood-indicator {
        position: absolute;
        top: 0px;
        right: 20px;
        font-size: 36px;
        z-index: 10;
        filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.4));
        animation: moodBounce 2s ease-in-out infinite;
        transition: all 0.3s ease;
      }

      @keyframes moodBounce {
        0%, 100% { transform: translateY(0) scale(1); }
        50% { transform: translateY(-4px) scale(1.08); }
      }

      /* Mouth for expressions - scaled 1.5x */
      .frug-mouth {
        position: absolute;
        bottom: 28%;
        left: 50%;
        transform: translateX(-50%);
        width: 30px;
        height: 15px;
        transition: all 0.3s ease;
      }

      /* Happy mouth (smile) */
      .frug-mouth.happy {
        border-bottom: 4px solid #2d7d4a;
        border-radius: 0 0 50% 50%;
        height: 12px;
      }

      /* Sad mouth (frown) */
      .frug-mouth.sad {
        border-top: 4px solid #2d7d4a;
        border-radius: 50% 50% 0 0;
        height: 9px;
        margin-top: 6px;
      }

      /* Neutral mouth */
      .frug-mouth.neutral {
        border-bottom: 3px solid #2d7d4a;
        height: 0;
        width: 18px;
      }

      /* Excited mouth (open smile) */
      .frug-mouth.excited {
        background: #1a4d30;
        border-radius: 50%;
        width: 24px;
        height: 18px;
      }

      /* Tired mouth (slightly open) */
      .frug-mouth.tired {
        border-bottom: 3px solid #2d7d4a;
        border-radius: 0 0 40% 40%;
        height: 6px;
        width: 21px;
      }

      /* Anxious mouth (wavy) */
      .frug-mouth.anxious {
        border-bottom: 3px solid #2d7d4a;
        width: 24px;
        height: 0;
        border-radius: 20%;
      }

      /* Extra stats bar below character */
      .frug-extra-stats {
        display: flex;
        gap: 16px;
        margin-top: 8px;
        padding: 10px 18px;
        background: linear-gradient(135deg, #2d1b4e 0%, #1a1033 100%);
        border-radius: 16px;
        border: 2px solid var(--color-purple, #8b5cf6);
        backdrop-filter: blur(8px);
        box-shadow:
          0 0 20px rgba(139, 92, 246, 0.2),
          0 4px 15px rgba(0, 0, 0, 0.4);
      }

      .frug-mini-stat {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: help;
      }

      .frug-mini-icon {
        font-size: 16px;
        filter: drop-shadow(0 0 4px currentColor);
      }

      .frug-mini-bar {
        width: 60px;
        height: 8px;
        background: rgba(0, 0, 0, 0.5);
        border-radius: 4px;
        overflow: hidden;
        border: 1px solid rgba(139, 92, 246, 0.3);
      }

      .frug-mini-fill {
        height: 100%;
        border-radius: 3px;
        transition: width 0.5s ease, background 0.3s ease;
      }

      .frug-mini-fill.hunger {
        background: linear-gradient(90deg, #f59e0b, #fbbf24);
        box-shadow: 0 0 8px rgba(251, 191, 36, 0.5);
      }

      .frug-mini-fill.happiness {
        background: linear-gradient(90deg, #8b5cf6, #a78bfa);
        box-shadow: 0 0 8px rgba(139, 92, 246, 0.5);
      }

      /* Mood-based body glow effects */
      .frug-body.mood-happy {
        box-shadow:
          inset -8px -8px 20px rgba(0, 0, 0, 0.2),
          inset 8px 8px 20px rgba(255, 255, 255, 0.1),
          0 8px 24px rgba(0, 0, 0, 0.3),
          0 0 30px rgba(74, 222, 128, 0.3);
      }

      .frug-body.mood-sad {
        box-shadow:
          inset -8px -8px 20px rgba(0, 0, 0, 0.2),
          inset 8px 8px 20px rgba(255, 255, 255, 0.1),
          0 8px 24px rgba(0, 0, 0, 0.3),
          0 0 20px rgba(96, 165, 250, 0.3);
        filter: saturate(0.8);
      }

      .frug-body.mood-excited {
        box-shadow:
          inset -8px -8px 20px rgba(0, 0, 0, 0.2),
          inset 8px 8px 20px rgba(255, 255, 255, 0.1),
          0 8px 24px rgba(0, 0, 0, 0.3),
          0 0 40px rgba(244, 114, 182, 0.4);
        animation: excitedPulse 0.5s ease-in-out infinite;
      }

      @keyframes excitedPulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.02); }
      }

      .frug-body.mood-tired {
        box-shadow:
          inset -8px -8px 20px rgba(0, 0, 0, 0.2),
          inset 8px 8px 20px rgba(255, 255, 255, 0.1),
          0 8px 24px rgba(0, 0, 0, 0.3);
        filter: brightness(0.9) saturate(0.8);
      }

      .frug-body.mood-hungry {
        box-shadow:
          inset -8px -8px 20px rgba(0, 0, 0, 0.2),
          inset 8px 8px 20px rgba(255, 255, 255, 0.1),
          0 8px 24px rgba(0, 0, 0, 0.3),
          0 0 20px rgba(251, 146, 60, 0.3);
      }

      .frug-body.mood-anxious {
        animation: anxiousShake 0.3s ease-in-out infinite;
      }

      @keyframes anxiousShake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-1px); }
        75% { transform: translateX(1px); }
      }

      /* Eye variations for moods */
      .frug-eye.sleepy {
        transform: scaleY(0.5);
      }

      .frug-eye.wide {
        transform: scale(1.2);
      }

      .frug-pupil.hearts::after {
        content: '❤️';
        font-size: 8px;
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
      }
    `;
    document.head.appendChild(style);
  }

  private setupClickHandler(): void {
    if (!this.frugCharacter) return;

    this.frugCharacter.addEventListener('click', () => {
      const state = this.stateManager.getState();
      this.statsPanel.show(state);

      // Play a happy reaction when clicked
      this.react('happy');
    });
  }

  private setupCursorTracking(): void {
    this.boundMouseMove = (e: MouseEvent) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    };
    document.addEventListener('mousemove', this.boundMouseMove);
  }

  private updateFromState(state: FrugState): void {
    // Update health
    this.setHealth(state.physical.health, state.physical.maxHealth);

    // Update energy
    this.setEnergy(state.physical.energy, state.physical.maxEnergy);

    // Update extra stats
    this.updateExtraStats(state);

    // Update mood visuals
    this.updateMoodVisuals(state.mood);

    // Update stats panel if open
    if (this.statsPanel.isOpen()) {
      this.statsPanel.update(state);
    }
  }

  private updateExtraStats(state: FrugState): void {
    if (!this.container) return;

    // Update hunger bar (gold theme)
    const hungerFill = this.container.querySelector('.frug-mini-fill.hunger') as HTMLElement;
    if (hungerFill) {
      hungerFill.style.width = `${state.physical.hunger}%`;
      // Color based on level
      if (state.physical.hunger < 30) {
        // Critical - red warning
        hungerFill.style.background = 'linear-gradient(90deg, #dc2626, #ef4444)';
        hungerFill.style.boxShadow = '0 0 10px rgba(220, 38, 38, 0.6)';
      } else if (state.physical.hunger < 60) {
        // Low - dim gold
        hungerFill.style.background = 'linear-gradient(90deg, #d97706, #f59e0b)';
        hungerFill.style.boxShadow = '0 0 8px rgba(217, 119, 6, 0.5)';
      } else {
        // Normal - bright gold
        hungerFill.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
        hungerFill.style.boxShadow = '0 0 8px rgba(251, 191, 36, 0.5)';
      }
    }

    // Update happiness bar (purple theme)
    const happinessFill = this.container.querySelector('.frug-mini-fill.happiness') as HTMLElement;
    if (happinessFill) {
      happinessFill.style.width = `${state.emotional.happiness}%`;
      // Color based on level
      if (state.emotional.happiness < 30) {
        // Low - desaturated purple
        happinessFill.style.background = 'linear-gradient(90deg, #6366f1, #818cf8)';
        happinessFill.style.boxShadow = '0 0 8px rgba(99, 102, 241, 0.5)';
      } else if (state.emotional.happiness < 60) {
        // Medium - standard purple
        happinessFill.style.background = 'linear-gradient(90deg, #7c3aed, #8b5cf6)';
        happinessFill.style.boxShadow = '0 0 8px rgba(124, 58, 237, 0.5)';
      } else {
        // High - bright purple
        happinessFill.style.background = 'linear-gradient(90deg, #8b5cf6, #a78bfa)';
        happinessFill.style.boxShadow = '0 0 8px rgba(139, 92, 246, 0.5)';
      }
    }
  }

  private updateMoodVisuals(mood: MoodType): void {
    if (this.currentMood === mood) return;
    this.currentMood = mood;

    // Update mood indicator emoji
    if (this.moodIndicator) {
      const emoji = getMoodEmoji(mood);
      this.moodIndicator.textContent = emoji;

      // Animate the mood change
      animate(this.moodIndicator, {
        scale: [1, 1.3, 1],
        rotate: [0, -10, 10, 0],
      }, { duration: 0.5 });
    }

    // Update body glow based on mood
    if (this.frugBody) {
      // Remove all mood classes
      this.frugBody.classList.remove(
        'mood-happy', 'mood-sad', 'mood-excited',
        'mood-tired', 'mood-hungry', 'mood-anxious'
      );

      // Add appropriate mood class
      switch (mood) {
        case 'ecstatic':
        case 'happy':
        case 'loved':
          this.frugBody.classList.add('mood-happy');
          break;
        case 'sad':
          this.frugBody.classList.add('mood-sad');
          break;
        case 'excited':
        case 'curious':
          this.frugBody.classList.add('mood-excited');
          break;
        case 'tired':
        case 'sleepy':
          this.frugBody.classList.add('mood-tired');
          break;
        case 'hungry':
          this.frugBody.classList.add('mood-hungry');
          break;
        case 'anxious':
        case 'scared':
          this.frugBody.classList.add('mood-anxious');
          break;
      }
    }

    // Update mouth expression
    if (this.mouthElement) {
      this.mouthElement.classList.remove('happy', 'sad', 'neutral', 'excited', 'tired', 'anxious');

      switch (mood) {
        case 'ecstatic':
        case 'happy':
        case 'loved':
          this.mouthElement.classList.add('happy');
          break;
        case 'sad':
        case 'sick':
          this.mouthElement.classList.add('sad');
          break;
        case 'excited':
          this.mouthElement.classList.add('excited');
          break;
        case 'tired':
        case 'sleepy':
          this.mouthElement.classList.add('tired');
          break;
        case 'anxious':
        case 'scared':
          this.mouthElement.classList.add('anxious');
          break;
        default:
          this.mouthElement.classList.add('neutral');
      }
    }

    // Update eye appearance based on mood
    if (this.leftEye && this.rightEye) {
      this.leftEye.classList.remove('sleepy', 'wide');
      this.rightEye.classList.remove('sleepy', 'wide');

      if (mood === 'tired' || mood === 'sleepy') {
        this.leftEye.classList.add('sleepy');
        this.rightEye.classList.add('sleepy');
      } else if (mood === 'excited' || mood === 'scared' || mood === 'anxious') {
        this.leftEye.classList.add('wide');
        this.rightEye.classList.add('wide');
      }
    }
  }

  private startBreathingAnimation(): void {
    if (!this.frugBody) return;

    // Subtle breathing animation using Motion One
    animate(
      this.frugBody,
      {
        scale: [1, 1.03, 1],
      },
      {
        duration: 3,
        repeat: Infinity,
        easing: 'ease-in-out'
      }
    );
  }

  private animationLoop = (): void => {
    const now = performance.now();
    const deltaMs = now - this.lastTime;
    this.lastTime = now;

    this.updateBlink(deltaMs);
    this.updateEyeLook(deltaMs);
    this.updateIdle(deltaMs);

    this.animationFrame = requestAnimationFrame(this.animationLoop);
  };

  private updateBlink(deltaMs: number): void {
    if (this.isBlinking) return;

    this.blinkTimer += deltaMs;

    // Sleepy mood = more frequent blinking
    const blinkModifier = this.currentMood === 'sleepy' || this.currentMood === 'tired' ? 0.5 : 1;

    if (this.blinkTimer >= this.nextBlinkTime * blinkModifier) {
      this.doBlink();
      this.blinkTimer = 0;

      // Sometimes double blink
      if (Math.random() < 0.25) {
        this.nextBlinkTime = 180;
      } else {
        this.nextBlinkTime = 2000 + Math.random() * 4000;
      }
    }
  }

  private doBlink(): void {
    if (!this.leftEye || !this.rightEye || this.isBlinking) return;

    this.isBlinking = true;

    // Blink animation with Motion One
    const blinkKeyframes = { scaleY: [1, 0.1, 1] };

    animate(this.leftEye, blinkKeyframes, { duration: 0.15, easing: [0.4, 0, 0.2, 1] });
    animate(this.rightEye, blinkKeyframes, { duration: 0.15, easing: [0.4, 0, 0.2, 1] }).finished.then(() => {
      this.isBlinking = false;
    });
  }

  private updateEyeLook(_deltaMs: number): void {
    if (!this.leftEye || !this.leftPupil || !this.rightPupil) return;

    // Get the center position of the Frug's face
    const eyeRect = this.leftEye.getBoundingClientRect();
    const faceCenterX = eyeRect.left + eyeRect.width / 2 + 15; // Offset to center between eyes
    const faceCenterY = eyeRect.top + eyeRect.height / 2;

    // Calculate direction from face center to cursor
    const dx = this.mouseX - faceCenterX;
    const dy = this.mouseY - faceCenterY;

    // Calculate distance for intensity scaling
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxDistance = 400; // Distance at which eyes are at max offset

    // Normalize and scale the offset (max 6px horizontal, 4px vertical)
    const intensity = Math.min(distance / maxDistance, 1);
    const angle = Math.atan2(dy, dx);

    const targetX = Math.cos(angle) * intensity * 6;
    const targetY = Math.sin(angle) * intensity * 4;

    // Smooth interpolation toward target
    this.eyeTargetX += (targetX - this.eyeTargetX) * 0.15;
    this.eyeTargetY += (targetY - this.eyeTargetY) * 0.15;

    // Apply to pupils directly (no animation for smoother tracking)
    const transform = `translate(${this.eyeTargetX}px, ${this.eyeTargetY}px)`;
    this.leftPupil.style.transform = transform;
    this.rightPupil.style.transform = transform;
  }

  private updateIdle(deltaMs: number): void {
    this.idleTimer += deltaMs;
  }

  private scheduleNextIdle(): void {
    // Excited mood = more frequent idle animations
    const delayModifier = this.currentMood === 'excited' ? 0.5 : 1;
    const delay = (4000 + Math.random() * 6000) * delayModifier;

    setTimeout(() => {
      this.playRandomIdleAnimation();
      this.scheduleNextIdle();
    }, delay);
  }

  private playRandomIdleAnimation(): void {
    if (!this.frugBody) return;

    const animations = ['bounce', 'squash', 'tilt', 'wiggle', 'jump'];
    const animation = animations[Math.floor(Math.random() * animations.length)];
    this.currentIdleAnimation = animation;

    switch (animation) {
      case 'bounce':
        animate(
          this.frugBody,
          {
            y: [0, -20, 0, -10, 0],
            scaleY: [1, 1.1, 0.9, 1.05, 1],
            scaleX: [1, 0.95, 1.05, 0.98, 1]
          },
          { duration: 0.6, easing: 'ease-out' }
        );
        break;

      case 'squash':
        animate(
          this.frugBody,
          {
            scaleY: [1, 0.7, 1.15, 1],
            scaleX: [1, 1.2, 0.9, 1]
          },
          { duration: 0.5, easing: spring({ stiffness: 400, damping: 15 }) }
        );
        break;

      case 'tilt':
        animate(
          this.frugBody,
          {
            rotate: [0, -15, 15, -8, 5, 0]
          },
          { duration: 0.8, easing: 'ease-in-out' }
        );
        break;

      case 'wiggle':
        animate(
          this.frugBody,
          {
            x: [0, -5, 5, -5, 5, -3, 3, 0],
            rotate: [0, -3, 3, -3, 3, -1, 1, 0]
          },
          { duration: 0.5, easing: 'ease-out' }
        );
        break;

      case 'jump':
        animate(
          this.frugBody,
          {
            y: [0, 5, -35, -35, 0, 5, 0],
            scaleY: [1, 0.8, 1.15, 1.1, 0.85, 1.05, 1],
            scaleX: [1, 1.15, 0.9, 0.92, 1.1, 0.98, 1]
          },
          { duration: 0.7, easing: 'ease-out' }
        );
        break;
    }
  }

  /**
   * Get the state manager for external access
   */
  getStateManager(): FrugStateManager {
    return this.stateManager;
  }

  /**
   * Update health value with animation
   */
  setHealth(value: number, max: number = 100): void {
    if (this.container) {
      const fill = this.container.querySelector('.frug-stat-fill.health') as HTMLElement;
      const valueEl = this.container.querySelector('.health-value');

      if (fill) {
        const percent = (value / max) * 100;
        animate(fill, { height: `${percent}%` }, { duration: 0.5, easing: 'ease-out' });

        // Color based on health level (purple theme)
        if (percent < 30) {
          // Critical - warning red/orange
          fill.style.background = 'linear-gradient(to top, #dc2626, #ef4444)';
          fill.style.boxShadow = '0 0 15px rgba(220, 38, 38, 0.7)';
        } else if (percent < 60) {
          // Low - gold warning
          fill.style.background = 'linear-gradient(to top, #f59e0b, #fbbf24)';
          fill.style.boxShadow = '0 0 12px rgba(251, 191, 36, 0.6)';
        } else {
          // Normal - purple theme
          fill.style.background = 'linear-gradient(to top, #8b5cf6, #a78bfa)';
          fill.style.boxShadow = '0 0 12px rgba(139, 92, 246, 0.6)';
        }
      }
      if (valueEl) {
        valueEl.textContent = String(Math.round(value));
      }
    }
  }

  /**
   * Update energy value with animation
   */
  setEnergy(value: number, max: number = 100): void {
    if (this.container) {
      const fill = this.container.querySelector('.frug-stat-fill.energy') as HTMLElement;
      const valueEl = this.container.querySelector('.energy-value');

      if (fill) {
        animate(fill, { height: `${(value / max) * 100}%` }, { duration: 0.5, easing: 'ease-out' });
      }
      if (valueEl) {
        valueEl.textContent = String(Math.round(value));
      }
    }
  }

  /**
   * Trigger a reaction animation (for events like taking damage, etc)
   */
  react(type: 'hurt' | 'happy' | 'surprised'): void {
    if (!this.frugBody) return;

    switch (type) {
      case 'hurt':
        animate(
          this.frugBody,
          {
            x: [-5, 5, -5, 5, 0],
            filter: ['brightness(1)', 'brightness(1.5)', 'brightness(1)']
          },
          { duration: 0.3 }
        );
        // Also update state
        this.stateManager.addExperience({
          type: 'negative',
          description: 'Got hurt',
          intensity: 5,
          decayRate: 0.5,
        });
        break;

      case 'happy':
        animate(
          this.frugBody,
          {
            y: [0, -15, 0, -10, 0],
            scale: [1, 1.1, 1]
          },
          { duration: 0.4 }
        );
        this.stateManager.addExperience({
          type: 'positive',
          description: 'Felt happy',
          intensity: 3,
          decayRate: 0.3,
        });
        break;

      case 'surprised':
        animate(
          this.frugBody,
          {
            scale: [1, 1.2, 0.95, 1]
          },
          { duration: 0.3 }
        );
        // Wide eyes
        if (this.leftEye && this.rightEye) {
          animate(this.leftEye, { scale: [1, 1.3, 1] }, { duration: 0.4 });
          animate(this.rightEye, { scale: [1, 1.3, 1] }, { duration: 0.4 });
        }
        break;
    }
  }

  /**
   * Open the stats panel
   */
  openStatsPanel(): void {
    const state = this.stateManager.getState();
    this.statsPanel.show(state);
  }

  /**
   * Close the stats panel
   */
  closeStatsPanel(): void {
    this.statsPanel.hide();
  }

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }

    if (this.unsubscribe) {
      this.unsubscribe();
    }

    // Remove cursor tracking listener
    if (this.boundMouseMove) {
      document.removeEventListener('mousemove', this.boundMouseMove);
    }

    this.stateManager.stopAutoUpdate();
    this.statsPanel.destroy();

    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }

    const styleEl = document.getElementById('frug-hud-extra-styles');
    styleEl?.remove();
  }
}
