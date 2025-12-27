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

export { FrugHUD } from './FrugHUD.ts';
export type { FrugHUDConfig } from './FrugHUD.ts';

export { FrugStatsPanel } from './FrugStatsPanel.ts';
export type { FrugStatsPanelConfig } from './FrugStatsPanel.ts';

export { SelectionManager } from './SelectionManager.ts';
export type { SelectionManagerConfig, SelectionBox } from './SelectionManager.ts';

export { SelectionBoxRenderer } from './SelectionBoxRenderer.ts';
export type { SelectionBoxRendererConfig } from './SelectionBoxRenderer.ts';

export { RadialActionMenu } from './RadialActionMenu.ts';
export type {
  RadialActionMenuConfig,
  RadialMenuAction,
  ActionSelectCallback,
  VoiceClickCallback,
  VoiceConfirmCallback,
} from './RadialActionMenu.ts';

export { MultiplayerPanel } from './MultiplayerPanel.ts';
export type {
  MultiplayerPanelConfig,
  PlayerInfo,
} from './MultiplayerPanel.ts';

export { WorldMessageUI } from './WorldMessageUI.ts';
export type {
  WorldMessageUIConfig,
  WorldMessageData,
  SendMessageCallback,
} from './WorldMessageUI.ts';
