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
 */

import type {
  DialogueRequest,
  DialogueResponse,
  NpcId,
  PlayerId,
} from '@/types/protocol.ts';
import { ClientMessageType } from '@/types/protocol.ts';

export interface DialogueUIConfig {
  /** Max conversation history to display */
  maxHistoryLength: number;
  /** Auto-close after inactivity (ms), 0 to disable */
  autoCloseMs: number;
  /** Typing indicator delay (ms) */
  typingIndicatorDelayMs: number;
  /** Animation duration (ms) */
  animationDurationMs: number;
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
  autoCloseMs: 30000,
  typingIndicatorDelayMs: 500,
  animationDurationMs: 200,
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
  private typingIndicator: HTMLElement | null = null;
  private quickOptionsContainer: HTMLElement | null = null;

  // Callbacks
  private onDialogueRequest: DialogueRequestCallback | null = null;
  private onClose: DialogueCloseCallback | null = null;

  // Timers
  private autoCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private typingTimer: ReturnType<typeof setTimeout> | null = null;

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
  open(npcId: NpcId, npcName: string = 'Unknown'): void {
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

    // Add to history
    this.addToHistory('player', text);

    // Clear input
    if (this.inputField) {
      this.inputField.value = '';
    }

    // Show typing indicator
    this.state.isWaitingForResponse = true;
    this.showTypingIndicator();

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
          <span class="npc-name">Unknown</span>
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

    const styles = document.createElement('style');
    styles.id = 'dialogue-ui-styles';
    styles.textContent = `
      .dialogue-container {
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1000;
        pointer-events: none;
        opacity: 0;
        transition: opacity ${this.config.animationDurationMs}ms ease;
      }

      .dialogue-container.visible {
        opacity: 1;
        pointer-events: auto;
      }

      .dialogue-panel {
        width: 560px;
        max-width: 90vw;
        background: rgba(15, 20, 30, 0.95);
        border: 1px solid rgba(80, 120, 180, 0.3);
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 1px rgba(255, 255, 255, 0.1) inset;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        transform: translateY(20px);
        transition: transform ${this.config.animationDurationMs}ms ease;
        backdrop-filter: blur(12px);
      }

      .dialogue-panel.open {
        transform: translateY(0);
      }

      .dialogue-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 14px 18px;
        border-bottom: 1px solid rgba(80, 120, 180, 0.2);
        background: rgba(0, 0, 0, 0.2);
        border-radius: 16px 16px 0 0;
      }

      .npc-name {
        font-size: 15px;
        font-weight: 600;
        color: #4a9eff;
        text-shadow: 0 0 20px rgba(74, 158, 255, 0.4);
        letter-spacing: 0.5px;
      }

      .dialogue-close {
        background: rgba(248, 113, 113, 0.1);
        border: 1px solid rgba(248, 113, 113, 0.2);
        border-radius: 8px;
        color: #94a3b8;
        font-size: 18px;
        width: 32px;
        height: 32px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }

      .dialogue-close:hover {
        background: rgba(248, 113, 113, 0.2);
        border-color: rgba(248, 113, 113, 0.4);
        color: #f87171;
      }

      .dialogue-history {
        max-height: 220px;
        overflow-y: auto;
        padding: 16px 18px;
      }

      .dialogue-entry {
        margin-bottom: 14px;
        animation: dialogueFadeIn 0.25s ease;
      }

      .dialogue-entry.player {
        text-align: right;
      }

      .dialogue-entry.npc {
        text-align: left;
      }

      .dialogue-bubble {
        display: inline-block;
        max-width: 85%;
        padding: 10px 14px;
        border-radius: 14px;
        font-size: 14px;
        line-height: 1.5;
      }

      .dialogue-entry.player .dialogue-bubble {
        background: linear-gradient(135deg, #4a9eff, #3b82f6);
        color: #fff;
        border-bottom-right-radius: 4px;
        box-shadow: 0 2px 12px rgba(74, 158, 255, 0.3);
      }

      .dialogue-entry.npc .dialogue-bubble {
        background: rgba(40, 50, 70, 0.9);
        color: #e2e8f0;
        border: 1px solid rgba(80, 120, 180, 0.2);
        border-bottom-left-radius: 4px;
      }

      .dialogue-typing {
        padding: 10px 18px;
        color: #64748b;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .typing-dots {
        display: flex;
        gap: 4px;
      }

      .typing-dots span {
        width: 7px;
        height: 7px;
        background: #4a9eff;
        border-radius: 50%;
        animation: typingDot 1.2s ease-in-out infinite;
      }

      .typing-dots span:nth-child(2) {
        animation-delay: 0.15s;
      }

      .typing-dots span:nth-child(3) {
        animation-delay: 0.3s;
      }

      @keyframes typingDot {
        0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
        30% { opacity: 1; transform: scale(1); }
      }

      .dialogue-quick-options {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 0 18px 12px;
      }

      .quick-option {
        padding: 8px 14px;
        background: rgba(74, 158, 255, 0.1);
        border: 1px solid rgba(74, 158, 255, 0.25);
        border-radius: 20px;
        color: #94a3b8;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }

      .quick-option:hover {
        background: rgba(74, 158, 255, 0.2);
        border-color: rgba(74, 158, 255, 0.4);
        color: #4a9eff;
        box-shadow: 0 0 12px rgba(74, 158, 255, 0.2);
      }

      .dialogue-input-area {
        display: flex;
        gap: 10px;
        padding: 14px 18px;
        border-top: 1px solid rgba(80, 120, 180, 0.2);
        background: rgba(0, 0, 0, 0.15);
        border-radius: 0 0 16px 16px;
      }

      .dialogue-input {
        flex: 1;
        padding: 12px 16px;
        background: rgba(25, 35, 50, 0.8);
        border: 1px solid rgba(80, 120, 180, 0.25);
        border-radius: 10px;
        color: #e2e8f0;
        font-size: 14px;
        font-family: inherit;
        outline: none;
        transition: all 0.2s;
      }

      .dialogue-input:focus {
        border-color: rgba(74, 158, 255, 0.5);
        box-shadow: 0 0 0 3px rgba(74, 158, 255, 0.1);
      }

      .dialogue-input::placeholder {
        color: #64748b;
      }

      .dialogue-send {
        padding: 12px 24px;
        background: linear-gradient(135deg, #4a9eff, #3b82f6);
        border: none;
        border-radius: 10px;
        color: #fff;
        font-size: 14px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.2s;
        box-shadow: 0 2px 12px rgba(74, 158, 255, 0.3);
      }

      .dialogue-send:hover {
        background: linear-gradient(135deg, #60a5fa, #4a9eff);
        box-shadow: 0 4px 16px rgba(74, 158, 255, 0.4);
        transform: translateY(-1px);
      }

      .dialogue-send:active {
        transform: translateY(0) scale(0.98);
      }

      .dialogue-send:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        box-shadow: none;
      }

      @keyframes dialogueFadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      /* Scrollbar styling */
      .dialogue-history::-webkit-scrollbar {
        width: 6px;
      }

      .dialogue-history::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.2);
        border-radius: 3px;
      }

      .dialogue-history::-webkit-scrollbar-thumb {
        background: rgba(74, 158, 255, 0.3);
        border-radius: 3px;
      }

      .dialogue-history::-webkit-scrollbar-thumb:hover {
        background: rgba(74, 158, 255, 0.5);
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

    // Enter key to send
    this.inputField?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = this.inputField?.value ?? '';
        this.sendMessage(text);
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
