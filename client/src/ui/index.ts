/**
 * UI system exports
 */

export { DialogueUI } from './DialogueUI.ts';
export type {
  DialogueUIConfig,
  DialogueState,
  ConversationEntry,
  DialogueRequestCallback,
  DialogueCloseCallback,
} from './DialogueUI.ts';

export { InteractionPrompt } from './InteractionPrompt.ts';
export type { InteractionPromptConfig } from './InteractionPrompt.ts';

export { SettingsPanel } from './SettingsPanel.ts';
export type {
  SettingsConfig,
  GameSettings,
  SettingsChangeCallback,
} from './SettingsPanel.ts';

export { ThoughtBubbleUI } from './ThoughtBubbleUI.ts';
export type {
  ThoughtBubbleConfig,
  GameContext as ThoughtGameContext,
  ThoughtGeneratorCallback,
} from './ThoughtBubbleUI.ts';

export { MinimapUI } from './MinimapUI.ts';
export type {
  MinimapConfig,
  PlayerMarker,
} from './MinimapUI.ts';
