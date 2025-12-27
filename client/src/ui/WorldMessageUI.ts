/**
 * WorldMessageUI - Displays player chat messages as floating bubbles
 * Press Enter to open chat, Shift+Enter to yell
 */

import { animate, spring } from '@motionone/dom';

export interface WorldMessageUIConfig {
  maxMessages: number;
  messageDurationMs: number;
  yellDurationMs: number;
  animationDuration: number;
}

export interface WorldMessageData {
  messageId: bigint;
  senderId: bigint;
  senderName: string;
  message: string;
  isYell: boolean;
  posX: number;
  posY: number;
  posZ: number;
  tsMs: number;
}

export type SendMessageCallback = (message: string, isYell: boolean) => void;
export type ProjectionCallback = (x: number, y: number, z: number) => { x: number; y: number; visible: boolean };

const DEFAULT_CONFIG: WorldMessageUIConfig = {
  maxMessages: 20,
  messageDurationMs: 8000,
  yellDurationMs: 12000,
  animationDuration: 0.3,
};

interface ActiveMessage {
  data: WorldMessageData;
  element: HTMLElement;
  expiresAt: number;
}

export class WorldMessageUI {
  private config: WorldMessageUIConfig;
  private container: HTMLElement | null = null;
  private inputContainer: HTMLElement | null = null;
  private inputField: HTMLInputElement | null = null;
  private isInputOpen: boolean = false;
  private messages: Map<bigint, ActiveMessage> = new Map();
  private sendCallback: SendMessageCallback | null = null;
  private projectionCallback: ProjectionCallback | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private localPlayerId: bigint | null = null;

  constructor(config: Partial<WorldMessageUIConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  initialize(parent: HTMLElement = document.body): void {
    // Create container for floating messages
    this.container = document.createElement('div');
    this.container.className = 'world-messages-container';
    parent.appendChild(this.container);

    // Create input container
    this.inputContainer = document.createElement('div');
    this.inputContainer.className = 'world-message-input-container';
    this.inputContainer.innerHTML = `
      <div class="world-message-input-wrapper">
        <input type="text" class="world-message-input" placeholder="Press Enter to chat, Shift+Enter to yell..." maxlength="256" />
        <div class="world-message-hint">
          <span class="hint-enter">Enter</span> = Send
          <span class="hint-shift">Shift+Enter</span> = Yell!
        </div>
      </div>
    `;
    parent.appendChild(this.inputContainer);

    this.inputField = this.inputContainer.querySelector('.world-message-input');

    // Setup input handlers
    this.inputField?.addEventListener('keydown', (e) => this.handleInputKeydown(e));
    this.inputField?.addEventListener('blur', () => this.closeInput());

    // Global keyboard handler for Enter to open chat
    this.keydownHandler = (e: KeyboardEvent) => {
      // Don't open if already typing somewhere
      const activeEl = document.activeElement;
      const isTyping = activeEl instanceof HTMLInputElement ||
                       activeEl instanceof HTMLTextAreaElement;

      if (e.key === 'Enter' && !isTyping && !this.isInputOpen) {
        e.preventDefault();
        this.openInput();
      }
    };
    document.addEventListener('keydown', this.keydownHandler);

    this.injectStyles();
  }

  private injectStyles(): void {
    const styleId = 'world-message-ui-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Container for all floating messages */
      .world-messages-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 500;
        overflow: hidden;
      }

      /* Individual floating message */
      .world-message {
        position: absolute;
        pointer-events: none;
        transform: translate(-50%, -100%);
        max-width: 300px;
        text-align: center;
      }

      .world-message-bubble {
        display: inline-block;
        padding: 8px 14px;
        border-radius: 16px;
        font-family: 'Nunito', sans-serif;
        font-size: 14px;
        font-weight: 500;
        word-wrap: break-word;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
      }

      /* Normal message style */
      .world-message.normal .world-message-bubble {
        background: rgba(255, 255, 255, 0.95);
        color: #1a1a2e;
        border: 2px solid rgba(139, 92, 246, 0.3);
      }

      /* Yell message style */
      .world-message.yell .world-message-bubble {
        background: linear-gradient(135deg, #ff6b35 0%, #f7931e 100%);
        color: white;
        border: 2px solid #ffcc00;
        font-size: 18px;
        font-weight: 700;
        text-transform: uppercase;
        animation: yell-shake 0.1s ease-in-out 3;
        box-shadow: 0 0 20px rgba(255, 107, 53, 0.5);
      }

      @keyframes yell-shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-3px); }
        75% { transform: translateX(3px); }
      }

      /* Sender name */
      .world-message-sender {
        font-size: 11px;
        margin-bottom: 2px;
        opacity: 0.7;
      }

      .world-message.yell .world-message-sender {
        opacity: 1;
        color: #fff;
      }

      /* Speech bubble tail */
      .world-message-tail {
        width: 0;
        height: 0;
        margin: 0 auto;
        border-left: 8px solid transparent;
        border-right: 8px solid transparent;
        border-top: 10px solid rgba(255, 255, 255, 0.95);
      }

      .world-message.yell .world-message-tail {
        border-top-color: #f7931e;
      }

      /* Input container */
      .world-message-input-container {
        display: none;
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1000;
      }

      .world-message-input-container.visible {
        display: block;
      }

      .world-message-input-wrapper {
        background: linear-gradient(135deg, #2d1b4e 0%, #1a1033 100%);
        border: 2px solid var(--color-purple, #8b5cf6);
        border-radius: 16px;
        padding: 12px 16px;
        box-shadow: 0 0 30px rgba(139, 92, 246, 0.4);
      }

      .world-message-input {
        width: 400px;
        max-width: 80vw;
        padding: 10px 14px;
        border: none;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.1);
        color: var(--color-text, #e2e8f0);
        font-family: 'Nunito', sans-serif;
        font-size: 14px;
        outline: none;
        transition: all 0.2s;
      }

      .world-message-input:focus {
        background: rgba(255, 255, 255, 0.15);
        box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.4);
      }

      .world-message-input::placeholder {
        color: rgba(196, 181, 253, 0.5);
      }

      .world-message-hint {
        display: flex;
        justify-content: center;
        gap: 20px;
        margin-top: 8px;
        font-family: 'Nunito', sans-serif;
        font-size: 11px;
        color: rgba(196, 181, 253, 0.6);
      }

      .world-message-hint span {
        background: rgba(139, 92, 246, 0.2);
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid rgba(139, 92, 246, 0.3);
        font-family: monospace;
      }

      .hint-shift {
        background: rgba(255, 107, 53, 0.2) !important;
        border-color: rgba(255, 107, 53, 0.4) !important;
        color: #ff6b35 !important;
      }
    `;
    document.head.appendChild(style);
  }

  setLocalPlayerId(id: bigint): void {
    this.localPlayerId = id;
  }

  setSendCallback(callback: SendMessageCallback): void {
    this.sendCallback = callback;
  }

  setProjectionCallback(callback: ProjectionCallback): void {
    this.projectionCallback = callback;
  }

  openInput(): void {
    if (!this.inputContainer || !this.inputField) return;

    this.isInputOpen = true;
    this.inputContainer.classList.add('visible');
    this.inputField.value = '';
    this.inputField.focus();

    animate(
      this.inputContainer.querySelector('.world-message-input-wrapper')!,
      {
        opacity: [0, 1],
        transform: ['translateY(20px)', 'translateY(0)'],
      },
      {
        duration: this.config.animationDuration,
        easing: spring({ stiffness: 400, damping: 25 }),
      }
    );
  }

  closeInput(): void {
    if (!this.inputContainer) return;

    this.isInputOpen = false;
    this.inputContainer.classList.remove('visible');
  }

  private handleInputKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.closeInput();
      return;
    }

    if (e.key === 'Enter' && this.inputField) {
      e.preventDefault();
      const message = this.inputField.value.trim();
      if (message && this.sendCallback) {
        const isYell = e.shiftKey;
        this.sendCallback(message, isYell);
      }
      this.closeInput();
    }
  }

  addMessage(data: WorldMessageData): void {
    if (!this.container) return;

    // Remove if already exists (update)
    if (this.messages.has(data.messageId)) {
      this.removeMessage(data.messageId);
    }

    // Create message element
    const element = document.createElement('div');
    element.className = `world-message ${data.isYell ? 'yell' : 'normal'}`;
    element.innerHTML = `
      <div class="world-message-bubble">
        <div class="world-message-sender">${this.escapeHtml(data.senderName)}</div>
        <div class="world-message-text">${data.isYell ? '! ' : ''}${this.escapeHtml(data.message)}${data.isYell ? ' !' : ''}</div>
      </div>
      <div class="world-message-tail"></div>
    `;

    this.container.appendChild(element);

    // Animate in
    animate(
      element,
      {
        opacity: [0, 1],
        transform: ['translate(-50%, -100%) scale(0.8)', 'translate(-50%, -100%) scale(1)'],
      },
      {
        duration: this.config.animationDuration,
        easing: spring({ stiffness: 300, damping: 20 }),
      }
    );

    const duration = data.isYell ? this.config.yellDurationMs : this.config.messageDurationMs;

    this.messages.set(data.messageId, {
      data,
      element,
      expiresAt: Date.now() + duration,
    });

    // Enforce max messages
    if (this.messages.size > this.config.maxMessages) {
      const oldest = Array.from(this.messages.entries())
        .sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
      if (oldest) {
        this.removeMessage(oldest[0]);
      }
    }
  }

  removeMessage(messageId: bigint): void {
    const msg = this.messages.get(messageId);
    if (msg) {
      animate(
        msg.element,
        { opacity: [1, 0] },
        { duration: 0.3 }
      ).finished.then(() => {
        msg.element.remove();
      });
      this.messages.delete(messageId);
    }
  }

  update(): void {
    if (!this.projectionCallback) return;

    const now = Date.now();

    for (const [messageId, msg] of this.messages) {
      // Check expiration
      if (now >= msg.expiresAt) {
        this.removeMessage(messageId);
        continue;
      }

      // Update position based on 3D projection
      // Convert from mm to meters
      const x = msg.data.posX / 1000;
      const y = msg.data.posY / 1000;
      const z = msg.data.posZ / 1000 + 2.5; // Offset above head

      const projection = this.projectionCallback(x, z, y); // Swap y/z for Three.js

      if (projection.visible) {
        msg.element.style.left = `${projection.x}px`;
        msg.element.style.top = `${projection.y}px`;
        msg.element.style.display = 'block';
      } else {
        msg.element.style.display = 'none';
      }
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  isOpen(): boolean {
    return this.isInputOpen;
  }

  destroy(): void {
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }

    if (this.container) {
      this.container.remove();
      this.container = null;
    }

    if (this.inputContainer) {
      this.inputContainer.remove();
      this.inputContainer = null;
    }

    this.messages.clear();

    const styleEl = document.getElementById('world-message-ui-styles');
    styleEl?.remove();
  }
}
