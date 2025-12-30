/**
 * Frugworld Desktop Entry Point
 *
 * This is the main entry point for the Tauri desktop application.
 * It initializes the desktop-specific features (AI service, model management)
 * and then loads the main game client.
 *
 * The desktop app adds:
 * - Local AI service management
 * - Model download and management UI
 * - Offline mode support
 * - Native window controls
 */

import {
  isTauri,
  getAiStatus,
  getModelStatus,
  getConfig,
  onAiStatusChange,
  type AiStatus,
  type ModelStatus,
} from './tauri-bridge';

import { createModelDownloader, ModelDownloader } from './components/ModelDownloader';
import { createAiStatusIndicator, AiStatusIndicator } from './components/AiStatusIndicator';

// ============================================================================
// Desktop App State
// ============================================================================

interface DesktopAppState {
  initialized: boolean;
  aiStatus: AiStatus | null;
  modelStatus: ModelStatus | null;
  setupComplete: boolean;
  firstRun: boolean;
}

const state: DesktopAppState = {
  initialized: false,
  aiStatus: null,
  modelStatus: null,
  setupComplete: false,
  firstRun: false,
};

// UI Components
let modelDownloader: ModelDownloader | null = null;
let aiStatusIndicator: AiStatusIndicator | null = null;

// ============================================================================
// UI Helpers
// ============================================================================

function updateLoadingStatus(message: string): void {
  const statusEl = document.getElementById('loading-status');
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function showLoadingScreen(): void {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    loadingScreen.classList.remove('hidden');
  }
}

function hideLoadingScreen(): void {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    loadingScreen.classList.add('hidden');
  }
}

function showSetupScreen(): void {
  const setupScreen = document.getElementById('desktop-setup');
  if (setupScreen) {
    setupScreen.classList.add('visible');
  }
  hideLoadingScreen();
}

function hideSetupScreen(): void {
  const setupScreen = document.getElementById('desktop-setup');
  if (setupScreen) {
    setupScreen.classList.remove('visible');
  }
}

function enableStartButton(): void {
  const startBtn = document.getElementById('start-game-btn') as HTMLButtonElement;
  if (startBtn) {
    startBtn.disabled = false;
  }
}

function disableStartButton(): void {
  const startBtn = document.getElementById('start-game-btn') as HTMLButtonElement;
  if (startBtn) {
    startBtn.disabled = true;
  }
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Check if this is the first run (no models downloaded)
 */
async function checkFirstRun(): Promise<boolean> {
  try {
    const modelStatus = await getModelStatus();
    state.modelStatus = modelStatus;

    // First run if no required models are downloaded
    const requiredModels = modelStatus.models.filter((m) => m.required);
    return requiredModels.length > 0 && !modelStatus.ready;
  } catch {
    // If we can't check, assume first run in Tauri mode
    return isTauri();
  }
}

/**
 * Initialize the AI status monitoring
 */
async function initAiStatus(): Promise<void> {
  try {
    state.aiStatus = await getAiStatus();

    // Subscribe to status changes
    await onAiStatusChange((status) => {
      state.aiStatus = status;
      updateSetupState();
    });
  } catch (error) {
    console.warn('Failed to get AI status:', error);
    state.aiStatus = {
      running: false,
      ready: false,
      error: 'Failed to connect to AI service',
      pid: null,
      uptime: null,
    };
  }
}

/**
 * Update the setup screen state based on current status
 */
function updateSetupState(): void {
  const aiReady = state.aiStatus?.ready ?? false;
  const modelsReady = state.modelStatus?.ready ?? false;

  if (aiReady && modelsReady) {
    enableStartButton();
  } else {
    disableStartButton();
  }
}

/**
 * Mount the setup screen UI components
 */
function mountSetupComponents(): void {
  // Mount AI Status Indicator
  const aiStatusContainer = document.getElementById('ai-status-container');
  if (aiStatusContainer) {
    aiStatusIndicator = createAiStatusIndicator({
      container: aiStatusContainer,
      onStatusChange: (status) => {
        state.aiStatus = status;
        updateSetupState();
      },
    });
  }

  // Mount Model Downloader
  const modelContainer = document.getElementById('model-downloader-container');
  if (modelContainer) {
    modelDownloader = createModelDownloader({
      container: modelContainer,
      onReady: () => {
        state.modelStatus = { ...state.modelStatus!, ready: true };
        updateSetupState();
      },
      onError: (error) => {
        console.error('Model downloader error:', error);
      },
    });
  }
}

/**
 * Cleanup setup screen components
 */
function unmountSetupComponents(): void {
  if (modelDownloader) {
    modelDownloader.unmount();
    modelDownloader = null;
  }
  if (aiStatusIndicator) {
    aiStatusIndicator.unmount();
    aiStatusIndicator = null;
  }
}

/**
 * Start the main game client
 *
 * The game client is loaded via a script tag from the pre-built client assets.
 * In development, this loads from the client dev server.
 * In production, it loads from the bundled client assets.
 */
async function startGame(): Promise<void> {
  hideSetupScreen();
  showLoadingScreen();
  updateLoadingStatus('Starting game...');

  // Cleanup setup components
  unmountSetupComponents();

  // Store that setup is complete
  state.setupComplete = true;

  try {
    updateLoadingStatus('Loading game client...');

    // Get config for server connection
    const config = await getConfig();

    // Set up global config that the game client can access
    (window as unknown as Record<string, unknown>).__FRUGWORLD_CONFIG__ = {
      serverUrl: config.game.serverUrl,
      moduleName: config.game.moduleName,
      aiServiceUrl: `http://${config.aiService.host}:${config.aiService.port}`,
      isTauri: isTauri(),
    };

    updateLoadingStatus('Initializing world...');

    // Load the game client via dynamic script injection
    // In production, the client is pre-built and bundled at /game/main.js
    // In development, we load from the client dev server
    const isDev = import.meta.env.DEV;
    const clientUrl = isDev
      ? 'http://localhost:5173/src/main.ts' // Client dev server (port 5173)
      : '/game/main.js'; // Pre-built client bundle

    await loadScript(clientUrl);

    // Hide loading screen after a short delay to ensure rendering is ready
    setTimeout(() => {
      hideLoadingScreen();
    }, 500);
  } catch (error) {
    console.error('Failed to start game:', error);
    updateLoadingStatus('Failed to start game. Please restart.');
  }
}

/**
 * Dynamically load a script
 */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Skip setup and start in online mode
 */
function skipSetup(): void {
  state.setupComplete = true;
  startGame();
}

// ============================================================================
// Event Handlers
// ============================================================================

function setupEventHandlers(): void {
  // Start game button
  const startBtn = document.getElementById('start-game-btn');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      startGame();
    });
  }

  // Skip setup button
  const skipBtn = document.getElementById('skip-setup-btn');
  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      skipSetup();
    });
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  console.log('Frugworld Desktop starting...');
  console.log('Running in Tauri:', isTauri());

  updateLoadingStatus('Checking system...');

  // Initialize AI status monitoring
  await initAiStatus();

  // Check if this is the first run
  state.firstRun = await checkFirstRun();

  if (isTauri() && state.firstRun) {
    // Show setup screen for first run
    updateLoadingStatus('Preparing setup...');
    showSetupScreen();
    mountSetupComponents();
    setupEventHandlers();
    updateSetupState();
  } else if (isTauri() && !state.aiStatus?.ready) {
    // AI not ready but not first run - show setup to start AI
    updateLoadingStatus('AI service offline...');
    showSetupScreen();
    mountSetupComponents();
    setupEventHandlers();
    updateSetupState();
  } else {
    // Either browser mode or Tauri with everything ready
    // Start the game directly
    await startGame();
  }

  state.initialized = true;
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}

// Export for potential external access
export { state as desktopState, isTauri };
