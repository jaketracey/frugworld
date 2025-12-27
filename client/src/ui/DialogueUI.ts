/**
 * DialogueUI - NPC dialogue interface system
 * Implements Section 20B.6 and Section 7 of the architecture spec
 *
 * Features:
 * - Dialogue panel with NPC responses
 * - Player input field for utterances
 * - Intent-driven quick options
 * - Conversation history display
 * - LOD0-only interaction gating
 * - Fallback responses when AI service unavailable
 */

import type {
  DialogueRequest,
  DialogueResponse,
  NpcId,
  PlayerId,
} from '@/types/protocol.ts';
import { ClientMessageType, ServerMessageType } from '@/types/protocol.ts';

export interface DialogueUIConfig {
  /** Max conversation history to display */
  maxHistoryLength: number;
  /** Auto-close after inactivity (ms), 0 to disable */
  autoCloseMs: number;
  /** Typing indicator delay (ms) */
  typingIndicatorDelayMs: number;
  /** Animation duration (ms) */
  animationDurationMs: number;
  /** Timeout before using fallback response (ms) */
  responseTimeoutMs: number;
}

export interface ConversationEntry {
  speaker: 'player' | 'npc';
  text: string;
  timestamp: number;
  intentTags?: string[];
}

export interface DialogueState {
  isOpen: boolean;
  targetNpcId: NpcId | null;
  targetNpcName: string;
  isWaitingForResponse: boolean;
  history: ConversationEntry[];
}

const DEFAULT_CONFIG: DialogueUIConfig = {
  maxHistoryLength: 20,
  autoCloseMs: 60000,
  typingIndicatorDelayMs: 300,
  animationDurationMs: 300,
  responseTimeoutMs: 5000,
};

// Fallback NPC responses when AI service is unavailable
const FALLBACK_RESPONSES = {
  greeting: [
    "Hello there, traveler! What brings you to these parts?",
    "Well met! It's always nice to see a friendly face around here.",
    "Greetings! I hope you're enjoying your adventures!",
    "Oh, hi! I was just thinking about the weather...",
  ],
  question: [
    "Hmm, that's an interesting question! Let me think about it...",
    "You know, I've wondered about that myself.",
    "Great question! I wish I had a better answer for you.",
    "Ah, you're curious about that? How delightful!",
  ],
  default: [
    "That's fascinating! Tell me more!",
    "I see, I see... Very interesting indeed!",
    "Oh my! You don't say!",
    "Ha! That reminds me of something... what was it again?",
    "Hmm, I understand what you mean.",
    "Well, that's certainly one way to look at it!",
    "You have such interesting things to say!",
    "I appreciate you sharing that with me.",
  ],
  rude: [
    "Well, that's not very nice... but I forgive you!",
    "Oh dear, someone woke up on the wrong side of the hay bale!",
    "Let's keep things friendly, shall we?",
    "I'll pretend I didn't hear that. What else is on your mind?",
  ],
};

export type DialogueRequestCallback = (request: DialogueRequest) => void;
export type DialogueCloseCallback = () => void;

export class DialogueUI {
  private config: DialogueUIConfig;
  private state: DialogueState;
  private playerId: PlayerId = 0;

  // DOM elements
  private container: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private historyContainer: HTMLElement | null = null;
  private inputField: HTMLInputElement | null = null;
  private sendButton: HTMLElement | null = null;
  private closeButton: HTMLElement | null = null;
  private npcNameLabel: HTMLElement | null = null;
  private npcPortrait: HTMLImageElement | null = null;
  private typingIndicator: HTMLElement | null = null;
  private quickOptionsContainer: HTMLElement | null = null;

  // Callbacks
  private onDialogueRequest: DialogueRequestCallback | null = null;
  private onClose: DialogueCloseCallback | null = null;

  // Timers
  private autoCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private typingTimer: ReturnType<typeof setTimeout> | null = null;
  private responseTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  // Last player message for fallback context
  private lastPlayerMessage: string = '';

  constructor(config: Partial<DialogueUIConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = {
      isOpen: false,
      targetNpcId: null,
      targetNpcName: '',
      isWaitingForResponse: false,
      history: [],
    };
  }

  /**
   * Initialize the dialogue UI by creating DOM elements
   */
  initialize(parentElement: HTMLElement = document.body): void {
    if (this.container) {
      return; // Already initialized
    }

    this.createDOM(parentElement);
    this.setupEventListeners();
  }

  /**
   * Set player ID for dialogue requests
   */
  setPlayerId(id: PlayerId): void {
    this.playerId = id;
  }

  /**
   * Set callback for sending dialogue requests
   */
  setDialogueRequestCallback(callback: DialogueRequestCallback): void {
    this.onDialogueRequest = callback;
  }

  /**
   * Set callback for when dialogue is closed
   */
  setCloseCallback(callback: DialogueCloseCallback): void {
    this.onClose = callback;
  }

  /**
   * Open dialogue with an NPC
   */
  open(npcId: NpcId, npcName: string = 'Unknown', portraitUrl?: string): void {
    if (!this.container || !this.panel) {
      console.warn('DialogueUI not initialized');
      return;
    }

    this.state.isOpen = true;
    this.state.targetNpcId = npcId;
    this.state.targetNpcName = npcName;
    this.state.history = [];
    this.state.isWaitingForResponse = false;

    // Update UI
    if (this.npcNameLabel) {
      this.npcNameLabel.textContent = npcName;
    }

    // Set portrait if provided, otherwise show loading state
    if (portraitUrl) {
      this.setPortrait(portraitUrl);
    } else {
      this.setPortraitLoading();
    }

    this.clearHistory();
    this.hideTypingIndicator();
    this.clearQuickOptions();

    // Show panel
    this.container.classList.add('visible');
    this.panel.classList.add('open');

    // Focus input
    setTimeout(() => {
      this.inputField?.focus();
    }, this.config.animationDurationMs);

    // Start auto-close timer
    this.resetAutoCloseTimer();
  }

  /**
   * Set the NPC portrait image
   */
  setPortrait(url: string): void {
    if (this.npcPortrait) {
      this.npcPortrait.src = url;
      this.npcPortrait.style.display = 'block';
      this.npcPortrait.classList.remove('loading');
    }
  }

  /**
   * Show portrait loading state
   */
  setPortraitLoading(): void {
    if (this.npcPortrait) {
      this.npcPortrait.style.display = 'block';
      this.npcPortrait.classList.add('loading');
      // Use transparent 1x1 pixel to avoid broken image icon
      this.npcPortrait.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    }
  }

  /**
   * Hide the portrait
   */
  hidePortrait(): void {
    if (this.npcPortrait) {
      this.npcPortrait.style.display = 'none';
      this.npcPortrait.classList.remove('loading');
    }
  }

  /**
   * Close the dialogue
   */
  close(): void {
    if (!this.container || !this.panel) {
      return;
    }

    this.state.isOpen = false;
    this.state.targetNpcId = null;

    // Hide panel
    this.panel.classList.remove('open');
    setTimeout(() => {
      this.container?.classList.remove('visible');
      this.hidePortrait(); // Clear portrait when closed
    }, this.config.animationDurationMs);

    // Clear timers
    this.clearAutoCloseTimer();
    this.clearTypingTimer();

    // Notify
    this.onClose?.();
  }

  /**
   * Check if dialogue is currently open
   */
  isOpen(): boolean {
    return this.state.isOpen;
  }

  /**
   * Get current target NPC ID
   */
  getTargetNpcId(): NpcId | null {
    return this.state.targetNpcId;
  }

  /**
   * Handle dialogue response from server
   */
  handleResponse(response: DialogueResponse): void {
    if (response.npcId !== this.state.targetNpcId) {
      return;
    }

    // Clear the fallback timeout since we got a real response
    this.clearResponseTimeout();

    this.state.isWaitingForResponse = false;
    this.hideTypingIndicator();

    // Add NPC response to history
    this.addToHistory('npc', response.text, response.intentTags);

    // Show intent-driven quick options
    if (response.intentTags.length > 0) {
      this.showQuickOptions(response.intentTags);
    }

    // Reset auto-close timer
    this.resetAutoCloseTimer();
  }

  /**
   * Send a player message
   */
  sendMessage(text: string): void {
    if (!text.trim() || this.state.isWaitingForResponse) {
      return;
    }

    if (this.state.targetNpcId === null) {
      return;
    }

    // Store for fallback context
    this.lastPlayerMessage = text;

    // Add to history
    this.addToHistory('player', text);

    // Clear input and maintain focus
    if (this.inputField) {
      this.inputField.value = '';
      this.inputField.focus();
    }

    // Show typing indicator
    this.state.isWaitingForResponse = true;
    this.showTypingIndicator();

    // Start fallback timeout in case LLM response never arrives
    this.startResponseTimeout();

    // Send request to server
    const request: DialogueRequest = {
      type: ClientMessageType.DialogueRequest,
      playerId: this.playerId,
      npcId: this.state.targetNpcId,
      utterance: text,
    };
    this.onDialogueRequest?.(request);

    // Reset auto-close timer
    this.resetAutoCloseTimer();
  }

  /**
   * Generate a fallback response based on player input
   */
  private generateFallbackResponse(): string {
    const input = this.lastPlayerMessage.toLowerCase();

    // Check for rude words
    const rudeWords = ['fuck', 'shit', 'damn', 'hate', 'stupid', 'idiot', 'dumb'];
    if (rudeWords.some(word => input.includes(word))) {
      const responses = FALLBACK_RESPONSES.rude;
      return responses[Math.floor(Math.random() * responses.length)] ?? responses[0]!;
    }

    // Check for greetings
    const greetings = ['hello', 'hi', 'hey', 'greetings', 'howdy', 'sup', 'yo'];
    if (greetings.some(g => input.includes(g))) {
      const responses = FALLBACK_RESPONSES.greeting;
      return responses[Math.floor(Math.random() * responses.length)] ?? responses[0]!;
    }

    // Check for questions
    if (input.includes('?') || input.startsWith('what') || input.startsWith('how') ||
        input.startsWith('why') || input.startsWith('where') || input.startsWith('who')) {
      const responses = FALLBACK_RESPONSES.question;
      return responses[Math.floor(Math.random() * responses.length)] ?? responses[0]!;
    }

    // Default response
    const responses = FALLBACK_RESPONSES.default;
    return responses[Math.floor(Math.random() * responses.length)] ?? responses[0]!;
  }

  /**
   * Start timeout for fallback response
   */
  private startResponseTimeout(): void {
    this.clearResponseTimeout();
    this.responseTimeoutTimer = setTimeout(() => {
      if (this.state.isWaitingForResponse && this.state.targetNpcId !== null) {
        console.log('[DialogueUI] Response timeout, using fallback');
        const fallbackText = this.generateFallbackResponse();
        this.handleResponse({
          type: ServerMessageType.DialogueResponse,
          npcId: this.state.targetNpcId,
          text: fallbackText,
          intentTags: ['small_talk'],
          optionalActions: [],
          serverEventsEmitted: [],
        });
      }
    }, this.config.responseTimeoutMs);
  }

  /**
   * Clear response timeout
   */
  private clearResponseTimeout(): void {
    if (this.responseTimeoutTimer) {
      clearTimeout(this.responseTimeoutTimer);
      this.responseTimeoutTimer = null;
    }
  }

  /**
   * Get dialogue state
   */
  getState(): Readonly<DialogueState> {
    return { ...this.state };
  }

  /**
   * Cleanup and destroy the UI
   */
  destroy(): void {
    this.clearAutoCloseTimer();
    this.clearTypingTimer();
    this.clearResponseTimeout();

    if (this.container?.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }

    this.container = null;
    this.panel = null;
    this.historyContainer = null;
    this.inputField = null;
    this.sendButton = null;
    this.closeButton = null;
    this.npcNameLabel = null;
    this.typingIndicator = null;
    this.quickOptionsContainer = null;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createDOM(parent: HTMLElement): void {
    // Create container
    this.container = document.createElement('div');
    this.container.id = 'dialogue-container';
    this.container.className = 'dialogue-container';
    this.container.innerHTML = `
      <div class="dialogue-panel">
        <div class="dialogue-header">
          <div class="npc-identity">
            <img class="npc-portrait" src="" alt="" style="display: none;" />
            <span class="npc-name">Unknown</span>
          </div>
          <button class="dialogue-close" type="button" aria-label="Close dialogue">&times;</button>
        </div>
        <div class="dialogue-history"></div>
        <div class="dialogue-typing" style="display: none;">
          <span class="typing-dots">
            <span></span><span></span><span></span>
          </span>
          <span class="typing-text">is typing...</span>
        </div>
        <div class="dialogue-quick-options"></div>
        <div class="dialogue-input-area">
          <input type="text" class="dialogue-input" placeholder="Say something..." maxlength="500" />
          <button class="dialogue-send" type="button">Send</button>
        </div>
      </div>
    `;

    // Get references
    this.panel = this.container.querySelector('.dialogue-panel');
    this.historyContainer = this.container.querySelector('.dialogue-history');
    this.inputField = this.container.querySelector('.dialogue-input');
    this.sendButton = this.container.querySelector('.dialogue-send');
    this.closeButton = this.container.querySelector('.dialogue-close');
    this.npcNameLabel = this.container.querySelector('.npc-name');
    this.npcPortrait = this.container.querySelector('.npc-portrait');
    this.typingIndicator = this.container.querySelector('.dialogue-typing');
    this.quickOptionsContainer = this.container.querySelector('.dialogue-quick-options');

    // Add styles
    this.injectStyles();

    // Append to parent
    parent.appendChild(this.container);
  }

  private injectStyles(): void {
    if (document.getElementById('dialogue-ui-styles')) {
      return;
    }

    // Add Google Fonts for game-like typography
    const fontLink = document.createElement('link');
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Fredoka:wght@400;500;600&display=swap';
    fontLink.rel = 'stylesheet';
    document.head.appendChild(fontLink);

    const styles = document.createElement('style');
    styles.id = 'dialogue-ui-styles';
    styles.textContent = `
      .dialogue-container {
        position: fixed;
        bottom: 40px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1000;
        pointer-events: none;
        opacity: 0;
        transition: all ${this.config.animationDurationMs}ms cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      .dialogue-container.visible {
        opacity: 1;
        pointer-events: auto;
      }

      .dialogue-panel {
        width: 680px;
        max-width: 95vw;
        background: linear-gradient(180deg, #2d1b4e 0%, #1a1033 100%);
        border: 4px solid #8b5cf6;
        border-radius: 28px;
        box-shadow:
          0 0 0 2px #1a1033,
          0 0 40px rgba(139, 92, 246, 0.4),
          0 20px 60px rgba(0, 0, 0, 0.6),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
        font-family: 'Nunito', 'Segoe UI', sans-serif;
        transform: translateY(40px) scale(0.9);
        transition: all ${this.config.animationDurationMs}ms cubic-bezier(0.34, 1.56, 0.64, 1);
        overflow: hidden;
      }

      .dialogue-panel.open {
        transform: translateY(0) scale(1);
      }

      .dialogue-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 18px 24px;
        background: linear-gradient(90deg, rgba(139, 92, 246, 0.3) 0%, rgba(236, 72, 153, 0.2) 100%);
        border-bottom: 3px solid rgba(139, 92, 246, 0.5);
        position: relative;
      }

      .dialogue-header::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
      }

      .npc-identity {
        display: flex;
        align-items: center;
        gap: 14px;
      }

      .npc-portrait {
        width: 50px;
        height: 50px;
        border-radius: 12px;
        border: 3px solid #8b5cf6;
        box-shadow:
          0 0 12px rgba(139, 92, 246, 0.5),
          0 4px 8px rgba(0, 0, 0, 0.3);
        object-fit: cover;
        background: linear-gradient(135deg, #3b2d5a 0%, #1a1033 100%);
      }

      .npc-portrait.loading {
        animation: portraitPulse 1.5s ease-in-out infinite;
      }

      @keyframes portraitPulse {
        0%, 100% { opacity: 0.6; }
        50% { opacity: 1; }
      }

      .npc-name {
        font-family: 'Fredoka', 'Nunito', sans-serif;
        font-size: 22px;
        font-weight: 600;
        color: #fbbf24;
        text-shadow:
          0 0 20px rgba(251, 191, 36, 0.6),
          0 2px 4px rgba(0, 0, 0, 0.4);
        letter-spacing: 0.5px;
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .npc-name::before {
        content: '💬';
        font-size: 24px;
      }

      .dialogue-close {
        background: linear-gradient(135deg, #ef4444, #dc2626);
        border: 3px solid #fca5a5;
        border-radius: 14px;
        color: white;
        font-size: 22px;
        font-weight: 700;
        width: 44px;
        height: 44px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
      }

      .dialogue-close:hover {
        transform: scale(1.1) rotate(90deg);
        box-shadow: 0 6px 20px rgba(239, 68, 68, 0.6);
      }

      .dialogue-close:active {
        transform: scale(0.95);
      }

      .dialogue-history {
        max-height: 320px;
        min-height: 120px;
        overflow-y: auto;
        padding: 20px 24px;
        background: rgba(0, 0, 0, 0.2);
      }

      .dialogue-entry {
        margin-bottom: 16px;
        animation: dialogueBounceIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      .dialogue-entry.player {
        text-align: right;
      }

      .dialogue-entry.npc {
        text-align: left;
      }

      .dialogue-bubble {
        display: inline-block;
        max-width: 80%;
        padding: 14px 20px;
        border-radius: 20px;
        font-size: 17px;
        font-weight: 500;
        line-height: 1.5;
        position: relative;
      }

      .dialogue-entry.player .dialogue-bubble {
        background: linear-gradient(135deg, #3b82f6, #2563eb);
        color: #fff;
        border-bottom-right-radius: 6px;
        box-shadow:
          0 4px 16px rgba(59, 130, 246, 0.4),
          inset 0 1px 0 rgba(255, 255, 255, 0.2);
        border: 2px solid #60a5fa;
      }

      .dialogue-entry.player .dialogue-bubble::before {
        content: '🎮';
        position: absolute;
        right: -32px;
        bottom: 4px;
        font-size: 20px;
      }

      .dialogue-entry.npc .dialogue-bubble {
        background: linear-gradient(135deg, #7c3aed, #6d28d9);
        color: #fff;
        border-bottom-left-radius: 6px;
        box-shadow:
          0 4px 16px rgba(124, 58, 237, 0.4),
          inset 0 1px 0 rgba(255, 255, 255, 0.2);
        border: 2px solid #a78bfa;
      }

      .dialogue-entry.npc .dialogue-bubble::before {
        content: '🧙';
        position: absolute;
        left: -32px;
        bottom: 4px;
        font-size: 20px;
      }

      .dialogue-typing {
        padding: 16px 24px;
        color: #c4b5fd;
        font-size: 16px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 12px;
        background: rgba(139, 92, 246, 0.1);
      }

      .typing-dots {
        display: flex;
        gap: 6px;
      }

      .typing-dots span {
        width: 12px;
        height: 12px;
        background: linear-gradient(135deg, #fbbf24, #f59e0b);
        border-radius: 50%;
        animation: typingBounce 1s ease-in-out infinite;
        box-shadow: 0 2px 8px rgba(251, 191, 36, 0.4);
      }

      .typing-dots span:nth-child(2) {
        animation-delay: 0.15s;
      }

      .typing-dots span:nth-child(3) {
        animation-delay: 0.3s;
      }

      @keyframes typingBounce {
        0%, 60%, 100% {
          transform: translateY(0) scale(0.8);
          opacity: 0.5;
        }
        30% {
          transform: translateY(-8px) scale(1);
          opacity: 1;
        }
      }

      .dialogue-quick-options {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        padding: 12px 24px 16px;
      }

      .quick-option {
        padding: 10px 18px;
        background: linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(245, 158, 11, 0.2));
        border: 2px solid rgba(251, 191, 36, 0.5);
        border-radius: 24px;
        color: #fbbf24;
        font-family: 'Nunito', sans-serif;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .quick-option:hover {
        background: linear-gradient(135deg, #fbbf24, #f59e0b);
        border-color: #fcd34d;
        color: #1a1033;
        transform: translateY(-2px) scale(1.05);
        box-shadow: 0 6px 20px rgba(251, 191, 36, 0.4);
      }

      .quick-option:active {
        transform: scale(0.95);
      }

      .dialogue-input-area {
        display: flex;
        gap: 12px;
        padding: 20px 24px;
        background: linear-gradient(180deg, rgba(0, 0, 0, 0.3) 0%, rgba(0, 0, 0, 0.5) 100%);
        border-top: 3px solid rgba(139, 92, 246, 0.3);
      }

      .dialogue-input {
        flex: 1;
        padding: 16px 22px;
        background: rgba(255, 255, 255, 0.05);
        border: 3px solid rgba(139, 92, 246, 0.4);
        border-radius: 18px;
        color: #fff;
        font-family: 'Nunito', sans-serif;
        font-size: 17px;
        font-weight: 500;
        outline: none;
        transition: all 0.2s ease;
      }

      .dialogue-input:focus {
        border-color: #a78bfa;
        background: rgba(139, 92, 246, 0.1);
        box-shadow: 0 0 0 4px rgba(139, 92, 246, 0.2);
      }

      .dialogue-input::placeholder {
        color: rgba(196, 181, 253, 0.5);
        font-weight: 400;
      }

      .dialogue-send {
        padding: 16px 32px;
        background: linear-gradient(135deg, #22c55e, #16a34a);
        border: 3px solid #86efac;
        border-radius: 18px;
        color: #fff;
        font-family: 'Fredoka', 'Nunito', sans-serif;
        font-size: 18px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 4px 16px rgba(34, 197, 94, 0.4);
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      }

      .dialogue-send:hover {
        transform: translateY(-3px) scale(1.05);
        box-shadow: 0 8px 28px rgba(34, 197, 94, 0.5);
        background: linear-gradient(135deg, #4ade80, #22c55e);
      }

      .dialogue-send:active {
        transform: translateY(0) scale(0.95);
      }

      .dialogue-send:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
      }

      @keyframes dialogueBounceIn {
        0% {
          opacity: 0;
          transform: translateY(20px) scale(0.8);
        }
        50% {
          transform: translateY(-5px) scale(1.02);
        }
        100% {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      /* Fun scrollbar */
      .dialogue-history::-webkit-scrollbar {
        width: 10px;
      }

      .dialogue-history::-webkit-scrollbar-track {
        background: rgba(139, 92, 246, 0.1);
        border-radius: 5px;
      }

      .dialogue-history::-webkit-scrollbar-thumb {
        background: linear-gradient(180deg, #8b5cf6, #6d28d9);
        border-radius: 5px;
        border: 2px solid rgba(0, 0, 0, 0.2);
      }

      .dialogue-history::-webkit-scrollbar-thumb:hover {
        background: linear-gradient(180deg, #a78bfa, #8b5cf6);
      }

      /* Empty state */
      .dialogue-history:empty::before {
        content: '👋 Start chatting!';
        display: block;
        text-align: center;
        color: rgba(196, 181, 253, 0.5);
        font-size: 18px;
        font-weight: 600;
        padding: 40px;
      }
    `;
    document.head.appendChild(styles);
  }

  private setupEventListeners(): void {
    // Send button click
    this.sendButton?.addEventListener('click', () => {
      const text = this.inputField?.value ?? '';
      this.sendMessage(text);
    });

    // Enter key to send - use direct handler on input field
    if (this.inputField) {
      this.inputField.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          const text = this.inputField?.value ?? '';
          this.sendMessage(text);
        }
      });
    } else {
      console.error('[DialogueUI] inputField not found during setup!');
    }

    // Also listen on panel for Enter key as backup
    this.panel?.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && this.state.isOpen) {
        e.preventDefault();
        e.stopPropagation();
        const text = this.inputField?.value ?? '';
        if (text.trim()) {
          this.sendMessage(text);
        }
      }
    });

    // Close button
    this.closeButton?.addEventListener('click', () => {
      this.close();
    });

    // Escape key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.state.isOpen) {
        this.close();
      }
    });
  }

  private addToHistory(
    speaker: 'player' | 'npc',
    text: string,
    intentTags?: string[]
  ): void {
    const entry: ConversationEntry = {
      speaker,
      text,
      timestamp: Date.now(),
      intentTags,
    };

    this.state.history.push(entry);

    // Trim history if too long
    if (this.state.history.length > this.config.maxHistoryLength) {
      this.state.history.shift();
    }

    // Render new entry
    this.renderHistoryEntry(entry);
  }

  private renderHistoryEntry(entry: ConversationEntry): void {
    if (!this.historyContainer) return;

    const entryEl = document.createElement('div');
    entryEl.className = `dialogue-entry ${entry.speaker}`;

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'dialogue-bubble';
    bubbleEl.textContent = entry.text;

    entryEl.appendChild(bubbleEl);
    this.historyContainer.appendChild(entryEl);

    // Scroll to bottom
    this.historyContainer.scrollTop = this.historyContainer.scrollHeight;
  }

  private clearHistory(): void {
    if (this.historyContainer) {
      this.historyContainer.innerHTML = '';
    }
    this.state.history = [];
  }

  private showTypingIndicator(): void {
    if (this.typingIndicator) {
      this.typingTimer = setTimeout(() => {
        if (this.typingIndicator) {
          this.typingIndicator.style.display = 'flex';
        }
      }, this.config.typingIndicatorDelayMs);
    }
  }

  private hideTypingIndicator(): void {
    this.clearTypingTimer();
    if (this.typingIndicator) {
      this.typingIndicator.style.display = 'none';
    }
  }

  private showQuickOptions(intentTags: string[]): void {
    if (!this.quickOptionsContainer) return;

    this.clearQuickOptions();

    // Map intent tags to quick response options
    const optionMap: Record<string, string> = {
      offer_trade: 'Trade',
      ask_question: 'Tell me more',
      give_hint: 'Thanks for the tip',
      greeting: 'Hello',
      farewell: 'Goodbye',
      help_request: 'How can I help?',
      quest_offer: 'I accept',
      quest_decline: 'Not interested',
    };

    for (const tag of intentTags) {
      const label = optionMap[tag];
      if (label) {
        const button = document.createElement('button');
        button.className = 'quick-option';
        button.textContent = label;
        button.type = 'button';
        button.addEventListener('click', () => {
          this.sendMessage(label);
          this.clearQuickOptions();
        });
        this.quickOptionsContainer.appendChild(button);
      }
    }
  }

  private clearQuickOptions(): void {
    if (this.quickOptionsContainer) {
      this.quickOptionsContainer.innerHTML = '';
    }
  }

  private resetAutoCloseTimer(): void {
    this.clearAutoCloseTimer();

    if (this.config.autoCloseMs > 0) {
      this.autoCloseTimer = setTimeout(() => {
        if (this.state.isOpen) {
          this.close();
        }
      }, this.config.autoCloseMs);
    }
  }

  private clearAutoCloseTimer(): void {
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
  }

  private clearTypingTimer(): void {
    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
  }
}
