/**
 * Frugworld Desktop - Public API
 *
 * This module exports the public API for the desktop application,
 * including the Tauri bridge and UI components.
 */

// Tauri Bridge - IPC communication with native backend
export {
  isTauri,
  getAiStatus,
  startAi,
  stopAi,
  restartAi,
  getModelStatus,
  downloadModel,
  cancelDownload,
  deleteModel,
  getConfig,
  setConfig,
  resetConfig,
  onDownloadProgress,
  onAiStatusChange,
  formatBytes,
  formatDuration,
  getPlatformInfo,
  type AiStatus,
  type ModelInfo,
  type ModelStatus,
  type AppConfig,
  type DownloadProgress,
  type TauriEventCallback,
} from './tauri-bridge';

// UI Components
export {
  ModelDownloader,
  createModelDownloader,
  AiStatusIndicator,
  createAiStatusIndicator,
  createAiStatusHudButton,
  type ModelDownloaderOptions,
  type AiStatusIndicatorOptions,
  type AiConnectionState,
} from './components';
