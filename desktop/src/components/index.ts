/**
 * Desktop UI Components
 *
 * Export all desktop-specific UI components for managing
 * AI service and model downloads.
 */

export {
  ModelDownloader,
  createModelDownloader,
  type ModelDownloaderOptions,
} from './ModelDownloader';

export {
  AiStatusIndicator,
  createAiStatusIndicator,
  createAiStatusHudButton,
  type AiStatusIndicatorOptions,
  type AiConnectionState,
} from './AiStatusIndicator';
