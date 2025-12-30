/**
 * Tauri IPC Bridge
 *
 * Provides a unified interface for communicating with the Tauri backend.
 * Falls back to HTTP API calls when running in browser mode (non-Tauri).
 *
 * This module detects the runtime environment and routes commands appropriately:
 * - In Tauri: Uses Tauri's IPC invoke() for native communication
 * - In Browser: Falls back to HTTP REST API calls to the ai-service
 */

// Type definitions for AI service status and configuration
export interface AiStatus {
  running: boolean;
  ready: boolean;
  error: string | null;
  pid: number | null;
  uptime: number | null; // seconds since start
}

export interface ModelInfo {
  name: string;
  displayName: string;
  size: number; // bytes
  downloaded: boolean;
  downloadProgress: number; // 0-100
  path: string | null;
  provider: 'ollama' | 'piper' | 'comfyui';
  required: boolean;
}

export interface ModelStatus {
  models: ModelInfo[];
  totalSize: number;
  downloadedSize: number;
  ready: boolean;
}

export interface AppConfig {
  aiService: {
    host: string;
    port: number;
    autoStart: boolean;
  };
  models: {
    llmProvider: 'ollama' | 'local';
    llmModel: string;
    ttsEnabled: boolean;
    ttsVoice: string;
    imageGenEnabled: boolean;
  };
  game: {
    serverUrl: string;
    moduleName: string;
  };
}

export interface DownloadProgress {
  modelName: string;
  bytesDownloaded: number;
  totalBytes: number;
  speed: number; // bytes per second
  eta: number; // seconds remaining
}

// Event types for Tauri event listeners
export type TauriEventCallback<T> = (payload: T) => void;

// Check if running inside Tauri
let _isTauri: boolean | null = null;

/**
 * Detect if the app is running inside a Tauri environment
 */
export function isTauri(): boolean {
  if (_isTauri !== null) {
    return _isTauri;
  }

  // Check for Tauri's window.__TAURI__ global
  _isTauri =
    typeof window !== 'undefined' &&
    '__TAURI__' in window &&
    window.__TAURI__ !== undefined;

  return _isTauri;
}

/**
 * Get the Tauri invoke function if available
 */
async function getTauriInvoke(): Promise<typeof import('@tauri-apps/api').invoke | null> {
  if (!isTauri()) {
    return null;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke;
  } catch {
    console.warn('Failed to load Tauri API');
    return null;
  }
}

/**
 * Get Tauri event listener functions
 */
async function getTauriEvents(): Promise<{
  listen: typeof import('@tauri-apps/api/event').listen;
  once: typeof import('@tauri-apps/api/event').once;
} | null> {
  if (!isTauri()) {
    return null;
  }

  try {
    const { listen, once } = await import('@tauri-apps/api/event');
    return { listen, once };
  } catch {
    console.warn('Failed to load Tauri event API');
    return null;
  }
}

// Default HTTP fallback configuration
const HTTP_CONFIG = {
  aiServiceUrl: 'http://localhost:3002',
  timeout: 30000,
};

/**
 * Make an HTTP request with timeout
 */
async function httpRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_CONFIG.timeout);

  try {
    const response = await fetch(`${HTTP_CONFIG.aiServiceUrl}${endpoint}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// AI Service Commands
// ============================================================================

/**
 * Get the current status of the AI service
 */
export async function getAiStatus(): Promise<AiStatus> {
  const invoke = await getTauriInvoke();

  if (invoke) {
    return invoke<AiStatus>('get_ai_status');
  }

  // HTTP fallback
  try {
    const response = await httpRequest<{ status: string; ready: boolean }>('/health');
    return {
      running: true,
      ready: response.ready,
      error: null,
      pid: null,
      uptime: null,
    };
  } catch (error) {
    return {
      running: false,
      ready: false,
      error: error instanceof Error ? error.message : 'Connection failed',
      pid: null,
      uptime: null,
    };
  }
}

/**
 * Start the AI service
 */
export async function startAi(): Promise<void> {
  const invoke = await getTauriInvoke();

  if (invoke) {
    await invoke('start_ai');
    return;
  }

  // In browser mode, we cannot start the AI service
  // It should already be running externally
  console.warn(
    'Cannot start AI service in browser mode. Please start it manually.'
  );
}

/**
 * Stop the AI service
 */
export async function stopAi(): Promise<void> {
  const invoke = await getTauriInvoke();

  if (invoke) {
    await invoke('stop_ai');
    return;
  }

  // In browser mode, we cannot stop the AI service
  console.warn(
    'Cannot stop AI service in browser mode. Please stop it manually.'
  );
}

/**
 * Restart the AI service
 */
export async function restartAi(): Promise<void> {
  const invoke = await getTauriInvoke();

  if (invoke) {
    await invoke('restart_ai');
    return;
  }

  console.warn(
    'Cannot restart AI service in browser mode. Please restart it manually.'
  );
}

// ============================================================================
// Model Management Commands
// ============================================================================

/**
 * Get the status of all AI models (downloaded, size, etc.)
 */
export async function getModelStatus(): Promise<ModelStatus> {
  const invoke = await getTauriInvoke();

  if (invoke) {
    return invoke<ModelStatus>('get_model_status');
  }

  // HTTP fallback - check which models are available
  try {
    const response = await httpRequest<{ models: ModelInfo[] }>('/api/models');
    const models = response.models || [];
    const downloadedSize = models
      .filter((m) => m.downloaded)
      .reduce((sum, m) => sum + m.size, 0);
    const totalSize = models.reduce((sum, m) => sum + m.size, 0);

    return {
      models,
      totalSize,
      downloadedSize,
      ready: models.filter((m) => m.required).every((m) => m.downloaded),
    };
  } catch {
    // Return empty status if service is not available
    return {
      models: [],
      totalSize: 0,
      downloadedSize: 0,
      ready: false,
    };
  }
}

/**
 * Start downloading a model
 */
export async function downloadModel(modelName: string): Promise<void> {
  const invoke = await getTauriInvoke();

  if (invoke) {
    await invoke('download_model', { modelName });
    return;
  }

  // HTTP fallback
  await httpRequest('/api/models/download', {
    method: 'POST',
    body: JSON.stringify({ model: modelName }),
  });
}

/**
 * Cancel an ongoing model download
 */
export async function cancelDownload(modelName: string): Promise<void> {
  const invoke = await getTauriInvoke();

  if (invoke) {
    await invoke('cancel_download', { modelName });
    return;
  }

  // HTTP fallback
  await httpRequest('/api/models/cancel', {
    method: 'POST',
    body: JSON.stringify({ model: modelName }),
  });
}

/**
 * Delete a downloaded model
 */
export async function deleteModel(modelName: string): Promise<void> {
  const invoke = await getTauriInvoke();

  if (invoke) {
    await invoke('delete_model', { modelName });
    return;
  }

  // HTTP fallback
  await httpRequest(`/api/models/${encodeURIComponent(modelName)}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// Configuration Commands
// ============================================================================

/**
 * Get the current application configuration
 */
export async function getConfig(): Promise<AppConfig> {
  const invoke = await getTauriInvoke();

  if (invoke) {
    return invoke<AppConfig>('get_config');
  }

  // Return default config in browser mode
  return {
    aiService: {
      host: 'localhost',
      port: 3002,
      autoStart: true,
    },
    models: {
      llmProvider: 'ollama',
      llmModel: 'llama3.2:3b',
      ttsEnabled: true,
      ttsVoice: 'en_US-lessac-medium',
      imageGenEnabled: false,
    },
    game: {
      serverUrl: 'ws://localhost:3000',
      moduleName: 'frugworld',
    },
  };
}

/**
 * Update the application configuration
 */
export async function setConfig(config: Partial<AppConfig>): Promise<void> {
  const invoke = await getTauriInvoke();

  if (invoke) {
    await invoke('set_config', { config });
    return;
  }

  // In browser mode, config is not persistent
  console.warn('Configuration changes are not persistent in browser mode.');
}

/**
 * Reset configuration to defaults
 */
export async function resetConfig(): Promise<void> {
  const invoke = await getTauriInvoke();

  if (invoke) {
    await invoke('reset_config');
    return;
  }

  console.warn('Cannot reset configuration in browser mode.');
}

// ============================================================================
// Event Listeners
// ============================================================================

/**
 * Subscribe to download progress events
 */
export async function onDownloadProgress(
  callback: TauriEventCallback<DownloadProgress>
): Promise<() => void> {
  const events = await getTauriEvents();

  if (events) {
    const unlisten = await events.listen<DownloadProgress>(
      'download-progress',
      (event) => callback(event.payload)
    );
    return unlisten;
  }

  // In browser mode, we poll for progress
  let polling = true;
  const poll = async () => {
    while (polling) {
      try {
        const status = await getModelStatus();
        for (const model of status.models) {
          if (model.downloadProgress > 0 && model.downloadProgress < 100) {
            callback({
              modelName: model.name,
              bytesDownloaded: (model.downloadProgress / 100) * model.size,
              totalBytes: model.size,
              speed: 0,
              eta: 0,
            });
          }
        }
      } catch {
        // Ignore errors during polling
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  };

  poll();

  return () => {
    polling = false;
  };
}

/**
 * Subscribe to AI service status changes
 */
export async function onAiStatusChange(
  callback: TauriEventCallback<AiStatus>
): Promise<() => void> {
  const events = await getTauriEvents();

  if (events) {
    const unlisten = await events.listen<AiStatus>('ai-status-change', (event) =>
      callback(event.payload)
    );
    return unlisten;
  }

  // In browser mode, we poll for status
  let polling = true;
  let lastStatus: AiStatus | null = null;

  const poll = async () => {
    while (polling) {
      try {
        const status = await getAiStatus();
        if (
          !lastStatus ||
          status.running !== lastStatus.running ||
          status.ready !== lastStatus.ready
        ) {
          lastStatus = status;
          callback(status);
        }
      } catch {
        // Ignore errors during polling
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  };

  poll();

  return () => {
    polling = false;
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

/**
 * Format seconds to human-readable duration
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/**
 * Get platform-specific information
 * Uses navigator.platform for basic platform detection
 */
export function getPlatformInfo(): {
  platform: string;
  arch: string;
  isTauri: boolean;
} {
  // Use navigator for platform detection (works in both Tauri and browser)
  const platform = navigator.platform || 'unknown';

  // Try to detect architecture from userAgent
  const userAgent = navigator.userAgent || '';
  let arch = 'unknown';
  if (userAgent.includes('arm64') || userAgent.includes('aarch64')) {
    arch = 'arm64';
  } else if (userAgent.includes('x86_64') || userAgent.includes('x64') || userAgent.includes('Win64')) {
    arch = 'x86_64';
  } else if (userAgent.includes('x86') || userAgent.includes('i686')) {
    arch = 'x86';
  }

  return {
    platform,
    arch,
    isTauri: isTauri(),
  };
}
