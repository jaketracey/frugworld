/**
 * Frugworld Client Entry Point
 * Main game loop with requestAnimationFrame render and fixed-step simulation
 *
 * Implements:
 * - Section 3.2: Runtime loops (client)
 * - Section 12: Client simulation, interpolation, reconciliation
 * - Section 18: Chunk streaming
 * - Section 20B: Frontend systems
 */

import {
  SpacetimeDBConnection,
  ConnectionState,
  type SpacetimeDBEvents,
  type Entity as EntityRow,
  type Transform as TransformRow,
  type Player as PlayerRow,
  type NpcState as NpcStateRow,
  type Chunk as ChunkRow,
  type NpcBlueprintRow,
} from '@/network/SpacetimeDBConnection.ts';
import { EntityManager } from '@/ecs/index.ts';
import { PlayerController } from '@/player/index.ts';
import {
  SceneManager,
  CameraController,
  NPCRenderer,
  ChunkRenderer,
  PlayerRenderer,
  DayNightCycle,
  WeatherSystem,
  SkyController,
} from '@/render/index.ts';
import { assetManager } from '@/assets/AssetManager.ts';
import type { WeatherInfo } from '@/render/index.ts';
import { VoiceChatService, AudioPlayer, MidiMusicPlayer, audioIntegration, musicManager, MusicToggle, type MusicMode } from '@/audio/index.ts';
import { ChunkStreamManager, ChunkDeltaHandler } from '@/chunks/index.ts';
import { DialogueUI, SettingsPanel, ThoughtBubbleUI, MinimapUI, FrugHUD, SelectionManager, SelectionBoxRenderer, RadialActionMenu, MultiplayerPanel, WorldMessageUI, type ThoughtGameContext, type RadialMenuAction, type PlayerInfo, type WorldMessageData } from '@/ui/index.ts';
import { NPCThoughtBubbleUI } from '@/ui/NPCThoughtBubbleUI.ts';
import { NPCClientBehavior } from '@/npc/NPCClientBehavior.ts';
import type {
  ChunkData,
  ChunkSubscribe,
  DialogueRequest,
  DialogueResponse,
  InputCommand,
  EntityData,
  TransformData,
  QuantizedTransform,
} from '@/types/protocol.ts';
import { ActionFlags, hasAction, EntityKind, ServerMessageType } from '@/types/protocol.ts';
import * as THREE from 'three';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  serverUrl: 'ws://localhost:3000',
  moduleName: 'frugworld',
  simTickRate: 60, // Hz
  debugOverlay: true,
  chunkLoadRadius: 4,      // 4 chunks = ~256m visibility (81 chunks total)
  chunkPrefetchRadius: 5,  // Prefetch slightly ahead (121 chunks total)
  thoughtsApiUrl: 'http://localhost:3002',
};

// ============================================================================
// Type Converters
// ============================================================================

/**
 * Convert SpacetimeDB EntityRow to game EntityData
 */
function entityRowToData(row: EntityRow): EntityData {
  return {
    entityId: Number(row.entityId),
    kind: row.kind as EntityKind,
    archetypeId: row.archetypeId,
    zoneId: Number(row.zoneId),
    chunkX: row.chunkX,
    chunkY: row.chunkY,
    alive: row.alive,
  };
}

/**
 * Convert SpacetimeDB TransformRow to game TransformData
 */
function transformRowToData(row: TransformRow): TransformData {
  const transform: QuantizedTransform = {
    x: row.x,
    y: row.y,
    z: row.z,
    yaw: row.yaw,
    vx: row.vx,
    vy: row.vy,
    vz: row.vz,
  };
  return {
    entityId: Number(row.entityId),
    transform,
    lastTick: Number(row.lastTick),
  };
}

/**
 * Convert SpacetimeDB ChunkRow to game ChunkData
 */
function chunkRowToData(row: ChunkRow): ChunkData {
  return {
    type: ServerMessageType.ChunkData,
    cx: row.cx,
    cy: row.cy,
    seed: Number(row.seed),
    biome: row.biome,
    poiBlob: row.poiBlob,
  };
}

// ============================================================================
// Game Client
// ============================================================================

class FrugworldClient {
  // Core systems
  private connection: SpacetimeDBConnection;
  private entityManager: EntityManager;
  private playerController: PlayerController;

  // Chunk management
  private chunkStreamManager: ChunkStreamManager;
  private chunkDeltaHandler: ChunkDeltaHandler;

  // UI systems
  private dialogueUI: DialogueUI;
  private settingsPanel: SettingsPanel;
  private thoughtBubbleUI: ThoughtBubbleUI;
  private npcThoughtBubbleUI: NPCThoughtBubbleUI;
  private minimapUI: MinimapUI;
  private frugHUD: FrugHUD;
  private multiplayerPanel: MultiplayerPanel;
  private worldMessageUI: WorldMessageUI;

  // NPC client-side behavior (wandering, reactions)
  private npcClientBehavior: NPCClientBehavior;

  // Rendering
  private sceneManager: SceneManager;
  private cameraController: CameraController;
  private npcRenderer: NPCRenderer;
  private chunkRenderer: ChunkRenderer;
  private playerRenderer: PlayerRenderer;
  private dayNightCycle: DayNightCycle;
  private skyController: SkyController;
  private weatherSystem: WeatherSystem;

  // RTS Click-to-move and selection
  private raycaster: THREE.Raycaster;
  private clickPlane: THREE.Plane; // Ground plane for click detection
  private selectionManager: SelectionManager;
  private selectionBoxRenderer: SelectionBoxRenderer;
  private radialActionMenu: RadialActionMenu;
  private selectedEntities: import('@/ecs/Entity.ts').Entity[] = [];

  // Voice chat
  private voiceChatService: VoiceChatService;

  // Frug's thought TTS audio player (cute/quirky voice)
  private thoughtAudioPlayer: AudioPlayer;

  // Background music MIDI player
  private midiPlayer: MidiMusicPlayer;

  // Generative audio UI toggle
  private musicToggle: MusicToggle | null = null;

  // Game loop timing
  private lastFrameTime: number = 0;
  private simAccumulator: number = 0;
  private simTickDuration: number = 1000 / CONFIG.simTickRate;

  // State
  private isRunning: boolean = false;
  private frameCount: number = 0;
  private fps: number = 0;
  private lastFpsUpdate: number = 0;

  // Input state for interaction
  private wasInteractPressed: boolean = false;

  // Nearest NPC tracking (for proximity effects)
  private nearestNpc: import('@/ecs/Entity.ts').Entity | null = null;

  // Player state tracking
  private localEntityId: bigint | null = null;
  private playerIdentity: string | null = null;
  private isInitialized: boolean = false;

  // NPC blueprint cache for dialogue (stores parsed name from blueprintJson)
  private npcNames: Map<bigint, string> = new Map();

  // Other human players tracking (entityId -> {name, x, y})
  private otherPlayers: Map<bigint, { name: string; entityId: bigint }> = new Map();

  // Active dialogue tracking
  private activeDialogueNpcId: number | null = null;

  // Music started flag (browsers require user interaction before audio)
  private musicStarted: boolean = false;

  // UI elements
  private debugOverlay: HTMLElement | null = null;
  private connectionStatus: HTMLElement | null = null;
  private loadingScreen: HTMLElement | null = null;
  private loadingStatus: HTMLElement | null = null;
  private minimapCoords: HTMLElement | null = null;
  private notificationsContainer: HTMLElement | null = null;

  constructor() {
    const container = document.getElementById('app');
    if (!container) {
      throw new Error('App container not found');
    }

    // Initialize rendering
    this.sceneManager = new SceneManager(container);
    this.cameraController = new CameraController(
      this.sceneManager.camera,
      this.sceneManager.getCanvas()
    );
    this.npcRenderer = new NPCRenderer(this.sceneManager.scene);
    this.chunkRenderer = new ChunkRenderer(this.sceneManager.scene);
    this.playerRenderer = new PlayerRenderer(this.sceneManager.scene);
    this.playerRenderer.setCamera(this.sceneManager.camera, this.sceneManager.getCanvas());

    // Connect terrain provider to NPC renderer so NPCs sit on terrain
    this.npcRenderer.setTerrainProvider(this.chunkRenderer.getTerrainProvider());

    // Initialize day/night cycle
    this.dayNightCycle = new DayNightCycle(this.sceneManager.scene, {
      dayDurationSeconds: 600, // 10 minute full day cycle
      startTime: 0.35, // Start at morning
    });
    this.dayNightCycle.setLights(
      this.sceneManager.ambientLight,
      this.sceneManager.directionalLight
    );

    // Initialize procedural sky shader
    this.skyController = new SkyController(this.sceneManager.scene);

    // Initialize weather system
    this.weatherSystem = new WeatherSystem(this.sceneManager.scene, {
      transitionDurationMs: 15000,
      minWeatherDurationMs: 120000, // 2 minutes minimum
      maxWeatherDurationMs: 300000, // 5 minutes maximum
      autoTransition: true,
    });
    this.weatherSystem.setLights(
      this.sceneManager.ambientLight,
      this.sceneManager.directionalLight
    );
    // Subscribe to weather changes for NPC/Frug awareness
    this.weatherSystem.on('weatherChange', (event) => {
      console.log(`Weather changed: ${event.previousState} -> ${event.newState}`);
      this.onWeatherChange(event.newState);
    });
    this.weatherSystem.on('lightning', () => {
      // Could trigger Frug flinch animation or NPC shelter-seeking
      console.log('Lightning strike!');
    });

    // Initialize chunk management
    this.chunkStreamManager = new ChunkStreamManager({
      loadRadius: CONFIG.chunkLoadRadius,
      prefetchRadius: CONFIG.chunkPrefetchRadius,
    });
    this.chunkDeltaHandler = new ChunkDeltaHandler();

    // Setup chunk callbacks
    this.chunkStreamManager.setSubscribeCallback((msg) => this.sendChunkSubscribe(msg));
    this.chunkStreamManager.setChunkLoadCallback((cx, cy) => {
      console.log(`Chunk loaded: (${cx}, ${cy})`);
    });
    this.chunkStreamManager.setChunkUnloadCallback((cx, cy) => {
      this.chunkRenderer.unloadChunk(cx, cy);
      this.chunkDeltaHandler.clearChunk(`${cx},${cy}`);
    });

    // Initialize UI systems
    this.dialogueUI = new DialogueUI();
    this.dialogueUI.initialize(container);
    this.dialogueUI.setDialogueRequestCallback((req) => this.sendDialogueRequest(req));
    this.dialogueUI.setCloseCallback(() => {
      console.log('[Dialogue] UI closed, clearing dialogue state');
      this.clearActiveDialogue();
      // Switch back to main theme music
      if (this.midiPlayer && this.musicStarted) {
        const currentMusicVolume = this.settingsPanel.getSettings().musicVolume / 100;
        this.midiPlayer.switchTrack('/music/theme.mid', currentMusicVolume).catch(err => {
          console.warn('[Music] Failed to switch back to theme:', err);
        });
      }
    });

    // Initialize settings panel
    this.settingsPanel = new SettingsPanel();
    this.settingsPanel.initialize(document.body);
    this.settingsPanel.setOnChange((settings) => {
      console.log('Settings changed:', settings);
      // Apply FOV to camera
      this.cameraController.setFOV(settings.fov);
      // Apply sound volume to thought TTS audio player
      if (this.thoughtAudioPlayer) {
        this.thoughtAudioPlayer.setVolume(settings.soundVolume / 100);
      }
      // Apply sound volume to NPC voice chat
      if (this.voiceChatService) {
        this.voiceChatService.setVolume(settings.soundVolume / 100);
      }
      // Apply music volume to MIDI player
      if (this.midiPlayer) {
        this.midiPlayer.setVolume(settings.musicVolume / 100);
      }
      // Apply voice settings to thought bubble
      if (this.thoughtBubbleUI) {
        // Convert frequency percentage to probability (0-1)
        const speakProbability = settings.frugVoiceEnabled ? settings.frugVoiceFrequency / 100 : 0;
        this.thoughtBubbleUI.setSpeakProbability(speakProbability);
      }
      // Apply post-processing settings
      this.sceneManager.setPostProcessingConfig({
        enabled: settings.postProcessingEnabled,
        bloomEnabled: settings.bloomEnabled,
        bloomStrength: settings.bloomIntensity / 100, // Convert from 0-100 to 0-1
        vignetteEnabled: settings.vignetteEnabled,
      });
      // Apply shadow quality setting
      this.sceneManager.setShadowQuality(settings.shadowQuality);
    });

    // Initialize thought bubble UI for Frug's random thoughts
    this.thoughtBubbleUI = new ThoughtBubbleUI();
    this.thoughtBubbleUI.initialize(container);
    this.thoughtBubbleUI.setProjectionCallback((x, y, z) => {
      return this.projectToScreen(x, y, z);
    });
    this.thoughtBubbleUI.setThoughtGenerator(async (context) => {
      return this.fetchThought(context);
    });

    // Initialize NPC thought bubble UI
    this.npcThoughtBubbleUI = new NPCThoughtBubbleUI();
    this.npcThoughtBubbleUI.initialize(container);
    this.npcThoughtBubbleUI.setProjectionCallback((x, y, z) => {
      return this.projectToScreen(x, y, z);
    });
    // Connect terrain provider so thought bubbles match NPC terrain positions
    this.npcThoughtBubbleUI.setTerrainProvider(this.chunkRenderer.getTerrainProvider());

    // Initialize NPC client-side behavior (wandering, reactions)
    this.npcClientBehavior = new NPCClientBehavior();
    this.npcClientBehavior.setOnThoughtChanged((npcId, thought) => {
      if (thought) {
        this.npcThoughtBubbleUI.showThought(npcId, thought);
      } else {
        this.npcThoughtBubbleUI.hideThought(npcId);
      }
    });

    // Initialize minimap for showing player positions
    this.minimapUI = new MinimapUI({ viewRadius: 200 });
    this.minimapUI.initialize();

    // Initialize Frug HUD (bottom center with animated character)
    this.frugHUD = new FrugHUD();
    this.frugHUD.initialize(document.body);

    // Initialize Multiplayer Panel (Tab key to toggle)
    this.multiplayerPanel = new MultiplayerPanel();
    this.multiplayerPanel.initialize();

    // Initialize World Message UI (Enter to chat, Shift+Enter to yell)
    this.worldMessageUI = new WorldMessageUI();
    this.worldMessageUI.initialize(container);
    this.worldMessageUI.setProjectionCallback((x, y, z) => {
      return this.projectToScreen(x, y, z);
    });
    this.worldMessageUI.setSendCallback((message, isYell) => {
      if (isYell) {
        this.connection.yellMessage(message);
      } else {
        this.connection.sendMessage(message);
      }
    });

    // Initialize Frug's thought TTS with customizable voice
    const initialSettings = this.settingsPanel.getSettings();
    const initialVolume = initialSettings.soundVolume / 100;
    this.thoughtAudioPlayer = new AudioPlayer({
      volume: initialVolume,
      onPlayStart: () => console.log('[ThoughtTTS] Frug speaking...'),
      onPlayEnd: () => console.log('[ThoughtTTS] Frug done speaking'),
      onError: (err) => console.warn('[ThoughtTTS] Error:', err),
    });

    // Set initial speak probability from settings
    const initialSpeakProbability = initialSettings.frugVoiceEnabled
      ? initialSettings.frugVoiceFrequency / 100
      : 0;
    this.thoughtBubbleUI.setSpeakProbability(initialSpeakProbability);

    // Apply initial shadow quality setting
    this.sceneManager.setShadowQuality(initialSettings.shadowQuality);

    this.thoughtBubbleUI.setSpeakCallback(async (text) => {
      try {
        // Get current voice setting
        const settings = this.settingsPanel.getSettings();
        const voiceId = settings.frugVoice;

        console.log('[ThoughtTTS] Requesting TTS for:', text, 'voice:', voiceId);
        const response = await fetch(`${CONFIG.thoughtsApiUrl}/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voiceId }),
        });
        if (!response.ok) {
          const errorText = await response.text();
          console.error('[ThoughtTTS] TTS request failed:', response.status, errorText);
          return;
        }
        const audioBlob = await response.blob();
        console.log('[ThoughtTTS] Got audio blob, size:', audioBlob.size);
        this.thoughtAudioPlayer.playBlob(audioBlob);
      } catch (err) {
        console.warn('[ThoughtTTS] Failed to speak thought:', err);
      }
    });

    // Initialize background music MIDI player
    const initialMusicVolume = this.settingsPanel.getSettings().musicVolume / 100;
    this.midiPlayer = new MidiMusicPlayer({
      volume: initialMusicVolume,
      loop: true,
      onPlayStart: () => console.log('[MidiPlayer] Music started'),
      onPlayEnd: () => console.log('[MidiPlayer] Music ended'),
      onError: (err) => console.warn('[MidiPlayer] Error:', err),
    });
    // Load and play theme music (user should place a .mid file in public/music/)
    this.midiPlayer.loadUrl('/music/theme.mid').then(() => {
      console.log('[MidiPlayer] Theme music loaded, will play on first interaction');
    }).catch(() => {
      console.log('[MidiPlayer] No theme.mid found in /music/ - add one to enable music');
    });

    // Initialize generative audio music toggle UI
    this.musicToggle = new MusicToggle({
      onModeChange: (mode: MusicMode) => {
        console.log(`[Audio] Music mode changed to: ${mode}`);
        musicManager.setMode(mode);
      },
      onVolumeChange: (volume: number) => {
        musicManager.setVolume(volume / 100);
        // Also update legacy player for consistency
        this.midiPlayer.setVolume(volume / 100);
      },
      onEnabledChange: (enabled: boolean) => {
        if (enabled) {
          musicManager.start();
        } else {
          musicManager.stop();
        }
      },
      onDensityChange: (density: number) => {
        // Density only affects generative mode
        console.log(`[Audio] Density changed to: ${density}%`);
      },
      initialMode: 'legacy',
      initialVolume: this.settingsPanel.getSettings().musicVolume,
      initialEnabled: true,
      initialDensity: 50,
      position: 'bottom-left',
      showDensityControl: true,
    });
    this.musicToggle.mount(container);

    // Initialize ECS
    this.entityManager = new EntityManager();
    this.entityManager.setSpawnCallback((entity) => {
      // NPC entities get rendered and registered for wandering
      if (entity.kind === EntityKind.Npc) {
        this.npcRenderer.updateEntity(entity);

        // Register NPC for client-side wandering behavior
        const transform = entity.transform.getInterpolated();
        const npcName = this.npcNames.get(BigInt(entity.id)) ?? `NPC ${entity.id}`;
        this.npcClientBehavior.registerNpc(entity.id, transform.x, transform.y, npcName);
      }
    });
    this.entityManager.setDespawnCallback((entity) => {
      if (entity.kind === EntityKind.Npc) {
        this.npcRenderer.removeEntity(entity.id);
        this.npcClientBehavior.unregisterNpc(entity.id);
        this.npcThoughtBubbleUI.removeNpc(entity.id);
      }
    });

    // Initialize player controller
    this.playerController = new PlayerController(
      this.sceneManager.getCanvas(),
      {
        simTickRate: CONFIG.simTickRate,
      }
    );
    this.playerController.setSendInputCallback((cmd) => this.sendInput(cmd));

    // Connect terrain height provider to player physics
    this.playerController.setTerrainProvider(
      this.chunkRenderer.getTerrainProvider()
    );

    // Set up callback for when player reaches an NPC
    this.playerController.setOnReachNpc((npcId) => this.onPlayerReachNpc(npcId));

    // Initialize raycaster for click-to-move
    this.raycaster = new THREE.Raycaster();
    this.clickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Y-up plane at y=0

    // Initialize selection system for multi-entity selection
    this.selectionManager = new SelectionManager();
    this.selectionBoxRenderer = new SelectionBoxRenderer();
    this.selectionBoxRenderer.initialize(container);

    // Initialize radial action menu
    this.radialActionMenu = new RadialActionMenu();
    this.radialActionMenu.initialize(container);
    this.radialActionMenu.setActionSelectCallback((action) => this.onRadialActionSelect(action));
    this.radialActionMenu.setVoiceClickCallback(() => this.onRadialVoiceClick());
    this.radialActionMenu.setVoiceConfirmCallback((text) => this.onRadialVoiceConfirm(text));
    this.radialActionMenu.setCloseCallback(() => this.onRadialMenuClose());

    // Add mouse listeners for RTS controls and selection
    const canvas = this.sceneManager.getCanvas();
    canvas.addEventListener('mousedown', this.handleMouseDown);
    canvas.addEventListener('mousemove', this.handleMouseMove);
    canvas.addEventListener('mouseup', this.handleMouseUp);

    // Initialize voice chat service
    this.voiceChatService = new VoiceChatService({
      aiServiceUrl: CONFIG.thoughtsApiUrl,
      pushToTalkKey: 'v',
      onTranscription: (text) => this.handleVoiceTranscription(text),
      onRecordingStart: () => console.log('[VoiceChat] Recording...'),
      onRecordingStop: () => console.log('[VoiceChat] Processing...'),
      onSpeakingStart: () => console.log('[VoiceChat] NPC speaking...'),
      onSpeakingStop: () => console.log('[VoiceChat] NPC done speaking'),
    });

    // Initialize SpacetimeDB connection
    const connectionEvents: SpacetimeDBEvents = {
      onStateChange: (state) => this.onConnectionStateChange(state),
      onConnect: (identity) => this.onConnect(identity),
      onError: (err) => console.error('Connection error:', err),
      onEntityUpdate: (entity) => {
        this.onEntityUpdate(entity);
        // Forward to audio integration for generative music
        audioIntegration.onEntityUpdate(entity);
      },
      onEntityDelete: (entity) => {
        this.onEntityDelete(entity);
        audioIntegration.onEntityDelete(entity);
      },
      onTransformUpdate: (transform) => this.onTransformUpdate(transform),
      onPlayerUpdate: (player) => this.onPlayerUpdate(player),
      onPlayerDelete: (player) => this.onPlayerDelete(player),
      onNpcStateUpdate: (npcState) => {
        this.onNpcStateUpdate(npcState);
        // Forward to audio integration for generative music
        audioIntegration.onNpcStateUpdate(npcState);
      },
      onChunkUpdate: (chunk) => this.onChunkUpdate(chunk),
      onNpcBlueprintUpdate: (blueprint) => {
        this.onNpcBlueprintUpdate(blueprint);
        // Forward to audio integration for personality-based music
        audioIntegration.onNpcBlueprintUpdate(blueprint);
      },
      onActiveDialogueUpdate: (dialogue) => this.onActiveDialogueUpdate(dialogue),
      onWorldMessageUpdate: (message) => this.onWorldMessageUpdate(message),
      onWorldMessageDelete: (message) => this.onWorldMessageDelete(message),
      onNpcPerception: (perception) => this.onNpcPerception(perception),
    };

    this.connection = new SpacetimeDBConnection(
      { uri: CONFIG.serverUrl, moduleName: CONFIG.moduleName },
      connectionEvents
    );

    // Get UI elements
    this.debugOverlay = document.getElementById('debug-overlay');
    this.connectionStatus = document.getElementById('connection-status');
    this.loadingScreen = document.getElementById('loading-screen');
    this.loadingStatus = this.loadingScreen?.querySelector('.loading-status') ?? null;
    this.minimapCoords = document.getElementById('minimap-coords');
    this.notificationsContainer = document.getElementById('notifications');

    // Update loading status
    this.setLoadingStatus('Connecting to server...');

    // Wire up settings button
    const settingsBtn = document.getElementById('settings-btn');
    settingsBtn?.addEventListener('click', () => {
      this.settingsPanel.toggle();
    });

    // Wire up new world button
    const newWorldBtn = document.getElementById('regenerate-seed-btn');
    newWorldBtn?.addEventListener('click', () => {
      if (confirm('Generate a new world region? You will be teleported to unexplored terrain with different NPCs and landscapes.')) {
        this.connection.newWorldSeed();
        this.showNotification('Teleporting to new world region...', 'success');
      }
    });

    // Escape key toggles settings panel (or closes other UI first)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // Close other UI first if open
        if (this.dialogueUI.isOpen()) {
          this.dialogueUI.close();
          return;
        }
        if (this.radialActionMenu.isOpen()) {
          this.radialActionMenu.close();
          return;
        }
        if (this.minimapUI.getIsExpanded()) {
          return; // MinimapUI handles its own Escape
        }
        this.settingsPanel.toggle();
      }
    });
  }

  /**
   * Update loading screen status text
   */
  private setLoadingStatus(text: string): void {
    if (this.loadingStatus) {
      this.loadingStatus.textContent = text;
    }
  }

  /**
   * Hide the loading screen with a fade animation
   */
  private hideLoadingScreen(): void {
    if (this.loadingScreen) {
      this.loadingScreen.classList.add('hidden');
    }
  }

  /**
   * Show the welcome message with slide-up animation and Frug status
   */
  private showWelcomeMessage(): void {
    // Create container
    const container = document.createElement('div');
    container.id = 'welcome-container';

    // Create welcome text
    const welcomeEl = document.createElement('div');
    welcomeEl.id = 'welcome-message';
    welcomeEl.textContent = 'Welcome to Frugworld!';

    // Create status text (will be populated by API)
    const statusEl = document.createElement('div');
    statusEl.id = 'frug-status';
    statusEl.textContent = '';

    container.appendChild(welcomeEl);
    container.appendChild(statusEl);
    document.body.appendChild(container);

    // Fetch Frug intro from AI service
    fetch(`${CONFIG.thoughtsApiUrl}/frug-intro`)
      .then(res => res.json())
      .then(data => {
        statusEl.textContent = data.intro || '';
      })
      .catch(() => {
        statusEl.textContent = 'Frug woke up feeling adventurous.';
      });

    // Remove after animation completes (5s animation)
    setTimeout(() => {
      container.remove();
    }, 5000);
  }

  /**
   * Show a notification toast
   */
  showNotification(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info', durationMs: number = 3000): void {
    if (!this.notificationsContainer) return;

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    this.notificationsContainer.appendChild(notification);

    // Remove after duration
    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transform = 'translateY(-10px)';
      notification.style.transition = 'all 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, durationMs);
  }

  /**
   * Start the game
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    this.lastFrameTime = performance.now();
    this.lastFpsUpdate = this.lastFrameTime;

    // Preload AI-generated textures for biomes
    this.setLoadingStatus('Loading textures...');
    try {
      await this.chunkRenderer.preloadTextures();
      console.log('Biome textures loaded');
    } catch (err) {
      console.warn('Failed to load some biome textures:', err);
    }

    // Preload NPC 3D models
    this.setLoadingStatus('Loading NPC models...');
    try {
      await this.npcRenderer.preloadModels();
      console.log('NPC models loaded');
    } catch (err) {
      console.warn('Failed to load some NPC models:', err);
    }

    // Connect to server
    this.setLoadingStatus('Connecting to server...');
    this.connection.connect();

    // Start game loop
    requestAnimationFrame((t) => this.gameLoop(t));

    console.log('Frugworld client started');
  }

  /**
   * Stop the game
   */
  stop(): void {
    this.isRunning = false;
    this.connection.disconnect();
    this.playerController.destroy();
    this.cameraController.destroy();
    this.dayNightCycle.destroy();
    this.skyController.dispose();
    this.weatherSystem.destroy();
    this.sceneManager.destroy();
    this.dialogueUI.destroy();
    this.settingsPanel.destroy();
    this.thoughtBubbleUI.destroy();
    this.npcThoughtBubbleUI.destroy();
    this.minimapUI.destroy();
    this.frugHUD.destroy();
    this.multiplayerPanel.destroy();
    this.worldMessageUI.destroy();
    this.voiceChatService.destroy();
    this.sceneManager.getCanvas().removeEventListener('click', this.handleCanvasClick);
    assetManager.dispose();
  }

  /**
   * Handle weather state changes - notify NPCs and Frug
   */
  private onWeatherChange(newState: string): void {
    const weatherInfo = this.weatherSystem.getWeatherInfo();

    // Notify Frug (player) via thought bubble context
    // The thought generator will pick up the weather state

    // Log for debugging - in production this would update NPC behavior
    if (weatherInfo.isStormy) {
      this.showNotification('A storm is approaching!', 'warning');
    } else if (weatherInfo.isRaining) {
      this.showNotification('It has started to rain', 'info');
    } else if (weatherInfo.isSnowing) {
      this.showNotification('Snow is falling', 'info');
    }
  }

  /**
   * Get current weather info for external systems
   */
  getWeatherInfo(): WeatherInfo {
    return this.weatherSystem.getWeatherInfo();
  }

  // ============================================================================
  // RTS Click-to-Move and Selection
  // ============================================================================

  /**
   * Handle mouse down - start potential selection
   */
  private handleMouseDown = (event: MouseEvent): void => {
    // Don't process if dialogue or radial menu is open
    if (this.dialogueUI.isOpen() || this.radialActionMenu.isOpen()) {
      return;
    }

    // Only left mouse button
    if (event.button !== 0) return;

    this.selectionManager.onMouseDown(event);
    this.selectionBoxRenderer.show();
  };

  /**
   * Handle mouse move - update selection box
   */
  private handleMouseMove = (event: MouseEvent): void => {
    if (!this.selectionManager.isSelecting()) return;

    this.selectionManager.onMouseMove(event);

    // Update selection box visual if dragging
    if (this.selectionManager.isDrag()) {
      const box = this.selectionManager.getSelectionBox();
      this.selectionBoxRenderer.update(box.startX, box.startY, box.endX, box.endY);
    }
  };

  /**
   * Handle mouse up - finalize selection or process click
   */
  private handleMouseUp = async (event: MouseEvent): Promise<void> => {
    this.selectionBoxRenderer.hide();

    // Only left mouse button
    if (event.button !== 0) return;

    const wasDrag = this.selectionManager.onMouseUp(event);

    if (wasDrag) {
      // Box selection completed - find entities in bounds
      const selected = this.selectionManager.findEntitiesInBounds(
        this.entityManager.getAll(),
        this.sceneManager.camera,
        this.sceneManager.getCanvas()
      );

      if (selected.length > 0) {
        console.log(`Selected ${selected.length} NPCs:`, selected.map(e => e.id));
        this.selectedEntities = selected;

        // Generate actions and open radial menu
        const actions = await this.generateActionsForSelection(selected);
        this.radialActionMenu.open(event.clientX, event.clientY, actions);
      }
    } else {
      // Regular click - use existing click-to-move logic
      this.handleCanvasClick(event);
    }
  };

  /**
   * Handle canvas click for RTS movement
   */
  private handleCanvasClick = (event: MouseEvent): void => {
    // Start music on first user interaction (browser autoplay policy)
    if (!this.musicStarted && this.midiPlayer.getIsLoaded()) {
      this.midiPlayer.play();
      this.musicStarted = true;

      // Initialize generative audio system (requires user gesture)
      audioIntegration.init().then(() => {
        console.log('[Audio] Generative audio system initialized');
        // Set time of day for key modulation (getTime returns 0-1, convert to 0-24)
        audioIntegration.setTimeOfDay(this.dayNightCycle.getTime() * 24);
      }).catch((err) => {
        console.warn('[Audio] Failed to initialize generative audio:', err);
      });
    }

    // Don't process clicks if dialogue is open
    if (this.dialogueUI.isOpen()) {
      return;
    }

    const canvas = this.sceneManager.getCanvas();
    const rect = canvas.getBoundingClientRect();

    // Convert to normalized device coordinates (-1 to +1)
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    // Set up raycaster from camera
    this.raycaster.setFromCamera(mouse, this.sceneManager.camera);

    // First, try to find an NPC
    const npcHit = this.findClickedNpc();
    if (npcHit) {
      console.log(`Clicked on NPC ${npcHit.entityId}, opening radial menu`);
      // Get the entity and open radial menu
      const entity = this.entityManager.get(npcHit.entityId);
      if (entity) {
        this.selectedEntities = [entity];
        // Generate actions and open radial menu at click position
        this.generateActionsForSelection([entity]).then(actions => {
          this.radialActionMenu.open(event.clientX, event.clientY, actions);
        });
      }
      return;
    }

    // Otherwise, click on ground
    const groundPoint = this.findGroundClickPoint();
    if (groundPoint) {
      console.log(`Clicked on ground at (${groundPoint.x.toFixed(1)}, ${groundPoint.y.toFixed(1)})`);
      this.playerController.setMoveTarget(groundPoint.x, groundPoint.y);
    }
  };

  /**
   * Find clicked NPC using raycaster
   */
  private findClickedNpc(): { entityId: number } | null {
    // Get all objects in scene
    const intersects = this.raycaster.intersectObjects(
      this.sceneManager.scene.children,
      true // recursive
    );

    for (const hit of intersects) {
      // Walk up to find NPC group
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        if (obj.name.startsWith('npc_')) {
          const entityId = parseInt(obj.name.replace('npc_', ''), 10);
          if (!isNaN(entityId)) {
            return { entityId };
          }
        }
        obj = obj.parent;
      }
    }

    return null;
  }

  /**
   * Find ground click point using raycaster
   */
  private findGroundClickPoint(): { x: number; y: number } | null {
    // Intersect with ground plane at approximate terrain height
    const playerPos = this.playerController.getDisplayPosition();

    // Create a plane at the player's Z height (which is Y in Three.js)
    const planeHeight = playerPos.z;
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeHeight);

    const intersection = new THREE.Vector3();
    const ray = this.raycaster.ray;

    if (ray.intersectPlane(groundPlane, intersection)) {
      // Convert Three.js coords to game coords
      // Three.js: X=right, Y=up, Z=forward
      // Game: X=right, Y=forward, Z=up
      return {
        x: intersection.x,
        y: intersection.z, // Three.js Z -> Game Y
      };
    }

    return null;
  }

  /**
   * Called when player reaches an NPC after click-to-move
   */
  private onPlayerReachNpc(npcId: number): void {
    console.log(`Reached NPC ${npcId}, opening dialogue`);
    const npcName = this.npcNames.get(BigInt(npcId)) ?? `NPC ${npcId}`;
    this.openDialogueWithPortrait(npcId, npcName);

    // Stop NPC from wandering while in dialogue
    this.npcClientBehavior.engageNpc(npcId);

    // Initialize voice chat on first dialogue
    if (!this.voiceChatService.getIsEnabled()) {
      this.voiceChatService.initialize().then((success) => {
        if (success) {
          this.showNotification('Voice chat ready! Hold V to talk', 'info');
        }
      });
    }
  }

  /**
   * Open dialogue with portrait fetching
   */
  private openDialogueWithPortrait(npcId: number, npcName: string): void {
    // Open dialogue immediately with loading portrait
    this.dialogueUI.open(npcId, npcName);

    // Switch to dialogue music (quieter, more intimate)
    if (this.midiPlayer && this.musicStarted) {
      const dialogueVolume = this.settingsPanel.getSettings().npcMusicVolume / 100;
      this.midiPlayer.switchTrack('/music/chominciamento.mid', dialogueVolume).catch(err => {
        console.warn('[Music] Failed to switch to dialogue music:', err);
      });
    }

    // Fetch portrait in background
    this.fetchNpcPortrait(npcId, npcName).then(portraitUrl => {
      if (portraitUrl && this.dialogueUI.getTargetNpcId() === npcId) {
        this.dialogueUI.setPortrait(portraitUrl);
      }
    }).catch(err => {
      console.warn(`[Portrait] Failed to fetch portrait for NPC ${npcId}:`, err);
    });
  }

  /**
   * Fetch NPC portrait from AI service
   */
  private async fetchNpcPortrait(npcId: number, npcName: string): Promise<string | null> {
    try {
      const response = await fetch(`${CONFIG.thoughtsApiUrl}/portrait`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          npc_id: npcId.toString(),
          name: npcName,
        }),
      });

      if (!response.ok) {
        console.warn(`[Portrait] Failed to fetch portrait: ${response.statusText}`);
        return null;
      }

      const data = await response.json() as { portrait_url: string; cached: boolean };
      console.log(`[Portrait] Got portrait for NPC ${npcId} (cached: ${data.cached})`);
      return data.portrait_url;
    } catch (error) {
      console.error('[Portrait] Error fetching portrait:', error);
      return null;
    }
  }

  // ============================================================================
  // Radial Action Menu
  // ============================================================================

  /**
   * Generate actions for the selected entities
   * TODO: Replace with actual LLM API call
   */
  private async generateActionsForSelection(entities: import('@/ecs/Entity.ts').Entity[]): Promise<RadialMenuAction[]> {
    // Get NPC context for LLM
    const npcContext = entities.map(entity => {
      const name = this.npcNames.get(BigInt(entity.id)) ?? `NPC ${entity.id}`;
      const transform = entity.transform.getInterpolated();
      const playerPos = this.playerController.getDisplayPosition();
      const distance = Math.sqrt(
        Math.pow(transform.x - playerPos.x, 2) +
        Math.pow(transform.y - playerPos.y, 2)
      );
      return { id: entity.id, name, distance: Math.round(distance) };
    });

    console.log('[RadialMenu] Generating actions for:', npcContext);

    // TODO: Call LLM endpoint when implemented
    // For now, return placeholder actions based on context
    const groupLabel = entities.length === 1
      ? npcContext[0].name
      : `${entities.length} NPCs`;

    const placeholderActions: RadialMenuAction[] = [
      {
        id: 'gather',
        label: 'Gather',
        icon: '🤝',
        description: `Bring ${groupLabel} together`,
        actionType: 'gather',
        parameters: { targetIds: entities.map(e => e.id) },
      },
      {
        id: 'follow',
        label: 'Follow Me',
        icon: '🚶',
        description: `Have ${groupLabel} follow you`,
        actionType: 'follow',
        parameters: { targetIds: entities.map(e => e.id) },
      },
      {
        id: 'disperse',
        label: 'Disperse',
        icon: '💨',
        description: `Send ${groupLabel} away`,
        actionType: 'disperse',
        parameters: { targetIds: entities.map(e => e.id) },
      },
      {
        id: 'greet',
        label: 'Wave',
        icon: '👋',
        description: `Wave at ${groupLabel}`,
        actionType: 'greet',
        parameters: { targetIds: entities.map(e => e.id) },
      },
    ];

    // Add a chat option as primary action if only one NPC is selected
    if (entities.length === 1) {
      placeholderActions.unshift({
        id: 'chat',
        label: 'Chat',
        icon: '💬',
        description: `Start a conversation with ${npcContext[0].name}`,
        actionType: 'chat',
        parameters: { targetId: entities[0].id },
      });
    }

    return placeholderActions;
  }

  /**
   * Handle action selection from radial menu
   */
  private onRadialActionSelect(action: RadialMenuAction): void {
    console.log('[RadialMenu] Action selected:', action);
    this.showNotification(`${action.icon} ${action.label}`, 'info');

    if (action.actionType === 'chat' && action.parameters?.targetId) {
      // Walk to NPC and open dialogue when reached
      const npcId = action.parameters.targetId as number;
      const entity = this.entityManager.get(npcId);
      if (entity) {
        const transform = entity.transform.getInterpolated();
        this.playerController.setMoveTarget(transform.x, transform.y, npcId);
      }
    } else if (action.actionType === 'greet' && action.parameters?.targetIds) {
      // Perform wave/greet gesture toward selected NPCs
      const targetIds = action.parameters.targetIds as number[];
      const targetNpcIds = targetIds.map((id) => BigInt(id));
      this.connection.performGesture('wave', targetNpcIds);
    }

    this.selectedEntities = [];
  }

  /**
   * Handle voice button click in radial menu
   */
  private onRadialVoiceClick(): void {
    console.log('[RadialMenu] Voice button clicked, starting recording...');

    // Initialize voice chat if not already
    if (!this.voiceChatService.getIsEnabled()) {
      this.voiceChatService.initialize().then((success) => {
        if (success) {
          this.startRadialVoiceRecording();
        } else {
          this.showNotification('Failed to initialize microphone', 'error');
        }
      });
    } else {
      this.startRadialVoiceRecording();
    }
  }

  /**
   * Start recording for radial menu voice command
   */
  private startRadialVoiceRecording(): void {
    this.radialActionMenu.setVoiceRecording(true);

    // Override the transcription callback temporarily for radial menu
    const originalCallback = this.voiceChatService.getOnTranscription();

    this.voiceChatService.setOnTranscription((text) => {
      console.log('[RadialMenu] Voice transcription:', text);
      this.radialActionMenu.setVoiceRecording(false);
      this.radialActionMenu.showVoicePreview(text);

      // Restore original callback
      if (originalCallback) {
        this.voiceChatService.setOnTranscription(originalCallback);
      }
    });

    // Start recording
    this.voiceChatService.startRecording();
  }

  /**
   * Handle voice command confirmation in radial menu
   */
  private async onRadialVoiceConfirm(transcribedText: string): Promise<void> {
    console.log('[RadialMenu] Voice command confirmed:', transcribedText);
    this.showNotification(`Command: "${transcribedText}"`, 'info');

    // TODO: Call LLM endpoint with voice command to get new actions
    // For now, just generate placeholder actions again
    const newActions = await this.generateActionsForSelection(this.selectedEntities);
    this.radialActionMenu.updateActions(newActions);
  }

  /**
   * Handle radial menu close
   */
  private onRadialMenuClose(): void {
    console.log('[RadialMenu] Menu closed');
    this.selectedEntities = [];
    this.selectionManager.clearSelection();
  }

  /**
   * Update move target position when following an NPC
   * This ensures the player tracks the NPC's current position, not where it was when clicked
   */
  private updateNpcMoveTarget(): void {
    const npcId = this.playerController.getMoveTargetNpcId();
    if (npcId === null) return;

    const entity = this.entityManager.get(npcId);
    if (!entity) {
      // NPC no longer exists, clear target
      this.playerController.clearMoveTarget();
      return;
    }

    // Update target to NPC's current position
    const transform = entity.transform.getInterpolated();
    this.playerController.setMoveTarget(transform.x, transform.y, npcId);
  }

  /**
   * Update NPC client-side behavior (wandering, thoughts)
   */
  private updateNpcBehavior(deltaMs: number, playerPos: { x: number; y: number; z: number }): void {
    // Collect NPC positions and LOD tiers
    const npcPositions = new Map<number, { x: number; y: number; z: number }>();
    const npcLods = new Map<number, number>();
    for (const entity of this.entityManager.getAll()) {
      if (entity.kind === EntityKind.Npc && !entity.markedForRemoval) {
        const transform = entity.transform.getInterpolated();
        npcPositions.set(entity.id, { x: transform.x, y: transform.y, z: transform.z });
        npcLods.set(entity.id, entity.lod.getLOD());

        // Update thought bubble position tracking
        this.npcThoughtBubbleUI.updateNpcPosition(entity.id, transform.x, transform.y, transform.z);
      }
    }

    // Update NPC behavior and get movement vectors (thoughts only for LOD 0/1)
    const movements = this.npcClientBehavior.update(deltaMs, npcPositions, playerPos, npcLods);

    // Apply movement to NPC visual positions (client-side only)
    for (const [npcId, movement] of movements) {
      const entity = this.entityManager.get(npcId);
      if (entity && entity.kind === EntityKind.Npc) {
        // Apply small wandering offset to the entity's visual position
        // This is purely cosmetic - doesn't affect server state
        entity.transform.applyWanderOffset(movement.dx, movement.dy);
      }
    }
  }

  /**
   * Handle voice transcription from push-to-talk
   */
  private handleVoiceTranscription(text: string): void {
    // Only process if dialogue is open
    if (!this.dialogueUI.isOpen() || !this.activeDialogueNpcId) {
      console.log('[VoiceChat] Ignoring transcription - no active dialogue');
      return;
    }

    console.log(`[VoiceChat] Sending transcribed text: "${text}"`);

    // Send the transcribed text as dialogue
    this.sendDialogueRequest({
      type: 'dialogue_request',
      playerId: this.localEntityId ? Number(this.localEntityId) : 0,
      npcId: this.activeDialogueNpcId,
      utterance: text,
    } as DialogueRequest);
  }

  // ============================================================================
  // Game Loop
  // ============================================================================

  private gameLoop(timestamp: number): void {
    if (!this.isRunning) return;

    const deltaMs = timestamp - this.lastFrameTime;
    this.lastFrameTime = timestamp;

    // Update FPS counter
    this.frameCount++;
    if (timestamp - this.lastFpsUpdate >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsUpdate = timestamp;
    }

    // Fixed-step simulation for player prediction
    this.simAccumulator += deltaMs;
    while (this.simAccumulator >= this.simTickDuration) {
      this.simulationTick();
      this.simAccumulator -= this.simTickDuration;
    }

    // Variable-step updates
    this.update(deltaMs, timestamp);

    // Render with post-processing
    this.render(deltaMs / 1000);

    // Update debug overlay
    if (CONFIG.debugOverlay) {
      this.updateDebugOverlay();
    }

    // Schedule next frame
    requestAnimationFrame((t) => this.gameLoop(t));
  }

  private simulationTick(): void {
    // Player controller handles its own fixed-step simulation
    // This is where additional physics simulation would go
  }

  private update(deltaMs: number, renderTime: number): void {
    // Update player controller (RTS click-to-move, no camera-relative input)
    this.playerController.update(deltaMs);

    // Update move target if following an NPC (track their current position)
    this.updateNpcMoveTarget();

    // Update entity interpolation
    this.entityManager.update(deltaMs, renderTime);

    // Update player position and velocity for ball rendering
    const playerPos = this.playerController.getDisplayPosition();
    const playerVel = this.playerController.getVelocity();

    // Check if player is moving (for camera return behavior)
    const speed = Math.sqrt(playerVel.vx * playerVel.vx + playerVel.vy * playerVel.vy);
    const isPlayerMoving = speed > 0.5; // Threshold to avoid jitter

    // Update LOD for entities based on player distance
    // This ensures entities have the correct LOD before rendering
    this.entityManager.updateLODsFromPlayerPosition(playerPos.x, playerPos.y);

    // Use velocity-based update for proper ball rolling animation
    this.playerRenderer.updateWithVelocity(
      playerPos.x,
      playerPos.y,
      playerPos.z,
      playerVel.vx,
      playerVel.vy
    );

    // Update camera - RTS style: WASD pans, doesn't follow player
    // Camera position is controlled by WASD in CameraController
    this.cameraController.update(deltaMs, isPlayerMoving);

    // Update chunk streaming based on player position
    this.chunkStreamManager.updatePlayerPosition(playerPos.x, playerPos.y);

    // Update day/night cycle
    this.dayNightCycle.update(deltaMs);
    this.dayNightCycle.setPlayerPosition(playerPos.x, playerPos.y, playerPos.z);

    // Update procedural sky and shadows
    const sunDirection = this.dayNightCycle.getSunDirection();
    this.skyController.update(this.dayNightCycle.getTime());
    this.sceneManager.updateShadowTarget(playerPos.x, playerPos.z, sunDirection);

    // Update weather system
    this.weatherSystem.setTimeOfDay(this.dayNightCycle.getTimePhase());
    this.weatherSystem.setPlayerPosition(playerPos.x, playerPos.z, playerPos.y); // Note: Three.js Y is up
    this.weatherSystem.update(deltaMs);

    // Update generative audio time-of-day for key modulation (getTime returns 0-1, convert to 0-24)
    if (this.musicStarted) {
      audioIntegration.setTimeOfDay(this.dayNightCycle.getTime() * 24);
    }

    // Update NPC client behavior (wandering, thoughts) and rendering
    this.updateNpcBehavior(deltaMs, playerPos);

    // Update NPC rendering
    for (const entity of this.entityManager.getAll()) {
      if (entity.kind === EntityKind.Npc && !entity.markedForRemoval) {
        this.npcRenderer.updateEntity(entity);
      }
    }

    // Update NPC thought bubble positions
    this.npcThoughtBubbleUI.update();

    // Update interaction prompt and player glow effect
    this.updateInteractionSystem(playerPos, deltaMs, isPlayerMoving);

    // Update thought bubble with game context
    this.updateThoughtBubble(playerPos, playerVel);

    // Update minimap with player positions
    this.updateMinimap(playerPos);
  }

  /**
   * Update minimap with local and other player positions
   */
  private updateMinimap(playerPos: { x: number; y: number; z: number }): void {
    // Update local player position
    this.minimapUI.updateLocalPlayer(playerPos.x, playerPos.y);

    // Update multiplayer panel with local player position for distance calculations
    this.multiplayerPanel.setLocalPlayerPosition(playerPos.x, playerPos.y);

    // Update other player positions from their transforms
    const conn = this.connection.getConnection();
    if (conn) {
      for (const [entityId, playerInfo] of this.otherPlayers) {
        // Find the transform for this player
        for (const transform of conn.db.transform.iter()) {
          if (transform.entityId === entityId) {
            // Convert from millimeters to meters
            const x = transform.x / 1000;
            const y = transform.y / 1000;
            this.minimapUI.updatePlayer(Number(entityId), playerInfo.name, x, y);
            // Update multiplayer panel with player position for distance display
            this.multiplayerPanel.updatePlayerPosition(entityId, x, y);
            break;
          }
        }
      }
    }

    // Render the minimap
    this.minimapUI.update();

    // Update world message positions
    this.worldMessageUI.update();
  }

  private updateInteractionSystem(playerPos: { x: number; y: number; z: number }, deltaMs: number, isPlayerMoving: boolean): void {
    // Find nearest NPC for proximity effects
    this.nearestNpc = this.findNearestNpc(playerPos);

    // Update player glow effect based on NPC proximity
    if (this.nearestNpc) {
      // Calculate distance to NPC
      const transform = this.nearestNpc.transform.getInterpolated();
      const dx = transform.x - playerPos.x;
      const dy = transform.y - playerPos.y;
      const dz = transform.z - playerPos.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Glow intensity based on proximity (3 meter range)
      const interactionDistance = 3.0;
      const intensity = Math.max(0, 1 - distance / interactionDistance);
      this.playerRenderer.setNpcProximity(intensity);
    } else {
      this.playerRenderer.setNpcProximity(0);
    }

    // Update glow animation
    this.playerRenderer.updateGlow(deltaMs);

    // Update character animations (blinking, idle transformations)
    this.playerRenderer.updateAnimations(deltaMs, isPlayerMoving);
  }

  /**
   * Find the nearest NPC entity to the player
   */
  private findNearestNpc(playerPos: { x: number; y: number; z: number }): import('@/ecs/Entity.ts').Entity | null {
    let closest: import('@/ecs/Entity.ts').Entity | null = null;
    let closestDistance = Infinity;

    for (const entity of this.entityManager.getAll()) {
      if (entity.kind !== EntityKind.Npc) continue;
      if (!entity.alive || entity.markedForRemoval) continue;

      const distance = entity.distanceTo(playerPos.x, playerPos.y, playerPos.z);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = entity;
      }
    }

    return closest;
  }

  /**
   * Handle interaction with current target
   * Called when player presses interact key
   */
  handleInteraction(): void {
    if (this.nearestNpc && this.nearestNpc.lod.canDialogue()) {
      // Get NPC name from cached names or default
      const npcName = this.npcNames.get(BigInt(this.nearestNpc.id)) ?? `NPC ${this.nearestNpc.id}`;
      this.openDialogueWithPortrait(this.nearestNpc.id, npcName);
    }
  }

  /**
   * Update thought bubble with current game context
   */
  private updateThoughtBubble(
    playerPos: { x: number; y: number; z: number },
    playerVel: { vx: number; vy: number; vz: number }
  ): void {
    // Get nearest NPC for proximity info
    let nearestNpcName: string | null = null;
    let nearestNpcDistance: number | null = null;

    if (this.nearestNpc) {
      const transform = this.nearestNpc.transform.getInterpolated();
      const dx = transform.x - playerPos.x;
      const dy = transform.y - playerPos.y;
      const dz = transform.z - playerPos.z;
      nearestNpcDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      nearestNpcName = this.npcNames.get(BigInt(this.nearestNpc.id)) ?? `NPC ${this.nearestNpc.id}`;
    }

    // Count nearby NPCs (within render distance)
    let nearbyNpcCount = 0;
    for (const entity of this.entityManager.getAll()) {
      if (entity.kind === EntityKind.Npc && !entity.markedForRemoval) {
        const transform = entity.transform.getInterpolated();
        const dx = transform.x - playerPos.x;
        const dy = transform.y - playerPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 50) {
          nearbyNpcCount++;
        }
      }
    }

    // Calculate velocity magnitude
    const velocity = Math.sqrt(playerVel.vx * playerVel.vx + playerVel.vy * playerVel.vy);

    // Get weather info for context
    const weatherInfo = this.weatherSystem.getWeatherInfo();

    // Build context
    const context: ThoughtGameContext = {
      playerX: playerPos.x,
      playerY: playerPos.y,
      playerZ: playerPos.z,
      nearbyNpcCount,
      nearestNpcName,
      nearestNpcDistance,
      currentBiome: 'grassland', // Could be fetched from chunk data
      timeOfDay: this.dayNightCycle.getTimePhase(),
      isMoving: velocity > 0.5,
      velocity,
      // Weather awareness for Frug's thoughts
      weather: weatherInfo.state,
      isRaining: weatherInfo.isRaining,
      isStormy: weatherInfo.isStormy,
      isSnowing: weatherInfo.isSnowing,
    };

    // Update thought bubble
    this.thoughtBubbleUI.updateContext(context);
    this.thoughtBubbleUI.update();
  }

  /**
   * Fetch a thought from the AI service
   */
  private async fetchThought(context: ThoughtGameContext): Promise<string> {
    try {
      const response = await fetch(`${CONFIG.thoughtsApiUrl}/thought`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as { thought: string };
      return data.thought;
    } catch (err) {
      console.warn('Failed to fetch thought:', err);
      // Return a fallback thought
      const fallbacks = [
        "Hmm...",
        "I wonder...",
        "Rolling along...",
        "What's that over there?",
      ] as const;
      return fallbacks[Math.floor(Math.random() * fallbacks.length)] ?? "Hmm...";
    }
  }

  private render(deltaTime: number): void {
    this.sceneManager.render(deltaTime);
  }

  // ============================================================================
  // Projection Helper
  // ============================================================================

  private projectToScreen(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const camera = this.sceneManager.camera;
    const canvas = this.sceneManager.getCanvas();

    // Create a vector at world position
    const vector = new THREE.Vector3(x, y, z);

    // Project to normalized device coordinates
    vector.project(camera);

    // Check if in front of camera
    const visible = vector.z < 1;

    // Convert to screen coordinates
    const screenX = (vector.x * 0.5 + 0.5) * canvas.clientWidth;
    const screenY = (-vector.y * 0.5 + 0.5) * canvas.clientHeight;

    return { x: screenX, y: screenY, visible };
  }

  // ============================================================================
  // SpacetimeDB Event Handlers
  // ============================================================================

  private onConnectionStateChange(state: ConnectionState): void {
    console.log('Connection state:', state);

    if (this.connectionStatus) {
      this.connectionStatus.className = state;
      const statusText = state.charAt(0).toUpperCase() + state.slice(1);
      // Update the tooltip text
      const tooltip = this.connectionStatus.querySelector('.status-tooltip');
      if (tooltip) {
        tooltip.textContent = statusText;
      }
    }

    // Update loading status and notifications based on state
    switch (state) {
      case ConnectionState.Connecting:
        this.setLoadingStatus('Connecting to server...');
        break;
      case ConnectionState.Connected:
        this.setLoadingStatus('Loading world data...');
        this.chunkStreamManager.reset();
        break;
      case ConnectionState.Disconnected:
        this.showNotification('Disconnected from server', 'error');
        this.isInitialized = false;
        break;
    }
  }

  private onConnect(identity: string): void {
    console.log('Connected with identity:', identity);
    this.playerIdentity = identity;
    this.setLoadingStatus('Joining world...');

    // Call playerConnect reducer to join the game
    try {
      this.connection.playerConnect('Player');
    } catch (err) {
      console.error('Failed to connect player:', err);
      this.showNotification('Failed to join game', 'error');
    }
  }

  private onEntityUpdate(entity: EntityRow): void {
    const entityData = entityRowToData(entity);

    // Debug: Log first few NPC entities being spawned
    if (entityData.kind === EntityKind.Npc && entityData.entityId < 10) {
      console.log(`NPC entity update: id=${entityData.entityId}, alive=${entity.alive}, chunk=(${entityData.chunkX}, ${entityData.chunkY})`);
    }

    if (!entity.alive) {
      // Entity died - mark as dead but don't despawn yet
      // The entity may still need to render death animation
      const existingEntity = this.entityManager.get(entityData.entityId);
      if (existingEntity) {
        existingEntity.alive = false;
      }
    } else {
      // Spawn or update entity
      this.entityManager.spawn(entityData);
    }
  }

  private onEntityDelete(entity: EntityRow): void {
    const entityId = Number(entity.entityId);
    this.entityManager.despawn(entityId);
  }

  private onTransformUpdate(transform: TransformRow): void {
    const transformData = transformRowToData(transform);

    // Debug: Check if we're getting transforms for known entities
    const entity = this.entityManager.get(transformData.entityId);
    if (entity && entity.kind === EntityKind.Npc && transformData.entityId < 10) {
      console.log(`NPC transform update: id=${transformData.entityId}, pos=(${transformData.transform.x}, ${transformData.transform.y}, ${transformData.transform.z})`);
    }

    // Check if this is our player entity for reconciliation
    if (this.localEntityId !== null && BigInt(transformData.entityId) === this.localEntityId) {
      // Get the player's last acknowledged input seq from the player table
      const conn = this.connection.getConnection();
      if (conn && this.playerIdentity) {
        // Find our player in the table by iterating
        for (const player of conn.db.player.iter()) {
          if (player.identity.toHexString() === this.playerIdentity) {
            this.playerController.onServerAck(
              player.lastInputSeq,
              transformData.transform
            );
            break;
          }
        }
      }
    }

    // Update entity transform
    this.entityManager.updateTransforms([transformData]);
  }

  private onPlayerUpdate(player: PlayerRow): void {
    console.log('Player update:', player);

    // Check if this is our player by comparing identity
    // The identity might be an Identity object with toHexString method
    const playerIdentityHex = typeof player.identity === 'object' && player.identity !== null && 'toHexString' in player.identity
      ? (player.identity as { toHexString(): string }).toHexString()
      : String(player.identity);

    if (playerIdentityHex === this.playerIdentity) {
      const entityId = player.entityId;
      this.localEntityId = entityId;

      // Initialize player controller with entity ID
      this.playerController.setPlayerId(Number(entityId));
      this.entityManager.setLocalPlayerId(Number(entityId));

      // Initialize minimap with local player ID
      this.minimapUI.setLocalPlayerId(Number(entityId));

      // Initialize multiplayer panel with local player
      this.multiplayerPanel.setLocalPlayerId(entityId);
      this.multiplayerPanel.updatePlayer({
        entityId,
        name: player.name,
        connectedAt: Number(player.connectedTsMs),
      });

      // Initialize chunk streaming and dialogue UI with player ID
      this.chunkStreamManager.setPlayerId(Number(entityId));
      this.dialogueUI.setPlayerId(Number(entityId));

      // Get initial transform from the transform table by iterating
      const conn = this.connection.getConnection();
      console.log(`Looking for player transform, entityId=${entityId}`);
      if (conn) {
        let foundTransform = false;
        for (const transform of conn.db.transform.iter()) {
          if (transform.entityId === entityId) {
            foundTransform = true;
            const transformData = transformRowToData(transform as TransformRow);
            console.log(`Found player transform: pos=(${transformData.transform.x}, ${transformData.transform.y}, ${transformData.transform.z})`);
            this.playerController.initFromServer(transformData.transform);

            // Snap camera to initial position
            const pos = this.playerController.getDisplayPosition();
            console.log(`Player display position after init: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`);
            this.cameraController.setFollowTarget(pos.x, pos.y, pos.z);
            this.cameraController.snapToTarget();
            break;
          }
        }
        if (!foundTransform) {
          console.warn(`Player transform not found in transform table for entityId=${entityId}`);
        }
      }

      // Mark as initialized and hide loading screen
      if (!this.isInitialized) {
        this.isInitialized = true;
        this.hideLoadingScreen();
        this.showWelcomeMessage();
      }
    } else {
      // This is another player - track them for minimap display
      const entityId = player.entityId;
      const isNew = !this.otherPlayers.has(entityId);

      this.otherPlayers.set(entityId, {
        name: player.name,
        entityId,
      });

      // Update multiplayer panel with other player info
      this.multiplayerPanel.updatePlayer({
        entityId,
        name: player.name,
        connectedAt: Number(player.connectedTsMs),
      });

      // Show notification when a new player joins
      if (isNew && this.isInitialized) {
        this.showNotification(`${player.name} joined the world!`, 'info', 3000);
        console.log(`[Multiplayer] Player ${player.name} (entity ${entityId}) joined`);
      }
    }
  }

  /**
   * Handle player deletion (disconnect)
   */
  private onPlayerDelete(player: PlayerRow): void {
    const entityId = player.entityId;

    // Remove from other players tracking
    if (this.otherPlayers.has(entityId)) {
      const playerInfo = this.otherPlayers.get(entityId);
      this.otherPlayers.delete(entityId);
      this.minimapUI.removePlayer(Number(entityId));
      this.multiplayerPanel.removePlayer(entityId);

      if (this.isInitialized && playerInfo) {
        this.showNotification(`${playerInfo.name} left the world`, 'info', 3000);
        console.log(`[Multiplayer] Player ${playerInfo.name} (entity ${entityId}) disconnected`);
      }
    }
  }

  private onNpcStateUpdate(npcState: NpcStateRow): void {
    // Update NPC state in entity manager if needed
    // This could be used for behavior state, animation, etc.
    const entityId = Number(npcState.npcId);
    const entity = this.entityManager.get(entityId);
    if (entity) {
      // Could update LOD or other state based on NPC state
    }
  }

  private onWorldMessageUpdate(message: {
    messageId: bigint;
    senderId: bigint;
    senderName: string;
    message: string;
    isYell: boolean;
    chunkX: number;
    chunkY: number;
    posX: number;
    posY: number;
    posZ: number;
    tsMs: bigint;
    expiresTsMs: bigint;
  }): void {
    // Add message to the world message UI
    this.worldMessageUI.addMessage({
      messageId: message.messageId,
      senderId: message.senderId,
      senderName: message.senderName,
      message: message.message,
      isYell: message.isYell,
      posX: message.posX,
      posY: message.posY,
      posZ: message.posZ,
      tsMs: Number(message.tsMs),
    });

    // If this is a yell from another player, show NPC reactions
    if (message.isYell && message.senderId !== this.localEntityId) {
      this.triggerNpcYellReactions(message);
    }
  }

  private onWorldMessageDelete(message: { messageId: bigint }): void {
    this.worldMessageUI.removeMessage(message.messageId);
  }

  /**
   * Handle NPC perception events (reactions to player gestures)
   */
  private onNpcPerception(perception: {
    perceptionId: bigint;
    npcId: bigint;
    thought: string;
    sourceEntityId: bigint;
    perceptionType: string;
    createdTsMs: bigint;
    expiresTsMs: bigint;
  }): void {
    console.log('[NpcPerception] NPC reacting:', perception);

    // Get the NPC entity ID as a number
    const npcId = Number(perception.npcId);

    // Check if this NPC exists in our entity manager
    const entity = this.entityManager.get(npcId);
    if (!entity) {
      console.log('[NpcPerception] NPC not found in entity manager:', npcId);
      return;
    }

    // Show the thought in the NPC's thought bubble
    this.npcThoughtBubbleUI.showThought(npcId, perception.thought);

    // Make the NPC stop and look toward the player who performed the gesture
    const sourceId = Number(perception.sourceEntityId);
    const sourceEntity = this.entityManager.get(sourceId);
    if (sourceEntity) {
      const sourceTransform = sourceEntity.transform.getInterpolated();
      // Use onYellHeard to make NPC stop and look toward source
      this.npcClientBehavior.onYellHeard(npcId, sourceTransform.x, sourceTransform.y);
    }
  }

  /**
   * Trigger NPC thought reactions when someone yells nearby
   */
  private triggerNpcYellReactions(message: {
    posX: number;
    posY: number;
    posZ: number;
    senderName: string;
  }): void {
    // Find NPCs near the yell and show startled thoughts
    const yellPos = {
      x: message.posX / 1000, // Convert mm to meters
      y: message.posY / 1000,
      z: message.posZ / 1000,
    };

    const yellRadius = 50; // 50 meters
    const startledThoughts = [
      '!',
      'What was that?!',
      'Who\'s yelling?!',
      '*startled*',
      'So loud!',
      `${message.senderName}?!`,
    ];

    for (const entity of this.entityManager.getAll()) {
      if (entity.kind !== 1) continue; // Only NPCs (kind 1)

      const npcPos = entity.transform.getInterpolated();

      const dx = npcPos.x - yellPos.x;
      const dy = npcPos.y - yellPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= yellRadius) {
        // Show startled thought for this NPC
        const thought = startledThoughts[Math.floor(Math.random() * startledThoughts.length)];
        this.npcThoughtBubbleUI.showThought(entity.id, thought);

        // Also trigger the NPC client behavior to pause/look
        this.npcClientBehavior.onYellHeard(entity.id, yellPos.x, yellPos.y);
      }
    }
  }

  private onChunkUpdate(chunk: ChunkRow): void {
    const chunkData = chunkRowToData(chunk);
    this.chunkRenderer.loadChunk(chunkData);
    this.chunkStreamManager.onChunkReceived(chunkData.cx, chunkData.cy);
  }

  /**
   * Handle NPC blueprint updates - extract and cache NPC names
   */
  private onNpcBlueprintUpdate(blueprint: NpcBlueprintRow): void {
    try {
      // Parse the blueprint JSON to get the NPC's name
      if (blueprint.blueprintJson && blueprint.blueprintJson.length > 2) {
        const jsonStr = new TextDecoder().decode(blueprint.blueprintJson);
        const parsed = JSON.parse(jsonStr) as {
          identity?: { name?: string; role?: string };
        };

        const name = parsed.identity?.name;
        if (name) {
          this.npcNames.set(blueprint.npcId, name);
          console.log(`[NpcBlueprint] Cached name for NPC ${blueprint.npcId}: "${name}"`);
        }
      }
    } catch (e) {
      console.warn(`[NpcBlueprint] Failed to parse blueprint for NPC ${blueprint.npcId}:`, e);
    }
  }

  // Track last processed line count per dialogue to avoid duplicate responses
  private lastDialogueLineCount = new Map<bigint, number>();

  private onActiveDialogueUpdate(dialogue: { playerId: bigint; npcId: bigint; lineCount: number; context: Uint8Array }): void {
    console.log(`[DialogueUpdate] Received: playerId=${dialogue.playerId}, npcId=${dialogue.npcId}, lineCount=${dialogue.lineCount}`);
    console.log(`[DialogueUpdate] localEntityId=${this.localEntityId}`);

    // Only process if this is our dialogue
    if (this.localEntityId === null || dialogue.playerId !== this.localEntityId) {
      console.log(`[DialogueUpdate] Skipping - not our dialogue (local=${this.localEntityId}, dialogue=${dialogue.playerId})`);
      return;
    }

    // Reset tracking when a new dialogue starts (lineCount resets to 0)
    const lastLineCount = this.lastDialogueLineCount.get(dialogue.playerId) || 0;
    if (dialogue.lineCount === 0) {
      console.log(`[DialogueUpdate] New dialogue started, resetting line count tracking`);
      this.lastDialogueLineCount.set(dialogue.playerId, 0);
      return; // Initial dialogue insert, no messages yet
    }

    // Only process if line count increased (new message)
    console.log(`[DialogueUpdate] lastLineCount=${lastLineCount}, new lineCount=${dialogue.lineCount}`);
    if (dialogue.lineCount <= lastLineCount) {
      console.log(`[DialogueUpdate] Skipping - lineCount not increased`);
      return;
    }
    this.lastDialogueLineCount.set(dialogue.playerId, dialogue.lineCount);

    // Parse the context to get recent lines
    try {
      const contextStr = new TextDecoder().decode(dialogue.context);
      console.log(`[DialogueUpdate] Context parsed, length=${contextStr.length}`);
      const context = JSON.parse(contextStr) as {
        recent_lines?: Array<{ speaker: string; text: string; ts_ms: number }>;
      };

      const recentLines = context.recent_lines || [];
      console.log(`[DialogueUpdate] recentLines count=${recentLines.length}`);
      if (recentLines.length === 0) {
        return;
      }

      // Check if the last message is from the NPC
      const lastLine = recentLines[recentLines.length - 1];
      console.log(`[DialogueUpdate] lastLine speaker=${lastLine?.speaker}, text="${lastLine?.text?.substring(0, 50)}..."`);
      if (lastLine && lastLine.speaker === 'npc') {
        // Build and send the response to DialogueUI
        const response: DialogueResponse = {
          type: ServerMessageType.DialogueResponse,
          npcId: Number(dialogue.npcId),
          text: lastLine.text,
          intentTags: [],
          optionalActions: [],
          serverEventsEmitted: [],
        };

        console.log(`[DialogueUpdate] NPC response - sending to DialogueUI, npcId=${response.npcId}, targetNpcId=${this.dialogueUI.getTargetNpcId()}`);
        this.dialogueUI.handleResponse(response);

        // Play TTS for NPC response (auto-play)
        if (this.voiceChatService.getIsEnabled()) {
          this.voiceChatService.speakNpcDialogue(lastLine.text).catch((err) => {
            console.warn('[VoiceChat] TTS failed:', err);
          });
        }
      }
    } catch (error) {
      console.error('Failed to parse dialogue context:', error);
    }
  }

  // ============================================================================
  // Input & Communication
  // ============================================================================

  private sendInput(command: InputCommand): void {
    // Submit input via SpacetimeDB reducer
    // Convert normalized move values (-1 to 1) to i16 range
    const moveXScaled = Math.round(command.move.x * 32767);
    const moveYScaled = Math.round(command.move.y * 32767);

    // Convert predicted position from meters to millimeters for server
    const predictedXMm = Math.round(command.predictedPosition.x * 1000);
    const predictedYMm = Math.round(command.predictedPosition.y * 1000);
    const predictedZMm = Math.round(command.predictedPosition.z * 1000);

    try {
      this.connection.submitInput(
        command.inputSeq,
        BigInt(command.clientTimeMs),
        moveXScaled,
        moveYScaled,
        command.actions,
        command.aimYaw ?? 0,
        predictedXMm,
        predictedYMm,
        predictedZMm
      );
    } catch (err) {
      console.error('Failed to submit input:', err);
    }

    // Check for interaction key press
    if (hasAction(command.actions, ActionFlags.INTERACT)) {
      if (!this.wasInteractPressed) {
        this.handleInteraction();
        this.wasInteractPressed = true;
      }
    } else {
      this.wasInteractPressed = false;
    }
  }

  private sendChunkSubscribe(message: ChunkSubscribe): void {
    if (this.localEntityId === null) {
      console.warn('Cannot subscribe to chunks: no local player entity');
      return;
    }
    try {
      this.connection.subscribeChunks(this.localEntityId, message.chunks);
    } catch (err) {
      console.error('Failed to subscribe to chunks:', err);
    }
  }

  private sendDialogueRequest(request: DialogueRequest): void {
    console.log('[Dialogue] sendDialogueRequest:', request);
    console.log('[Dialogue] Current activeDialogueNpcId:', this.activeDialogueNpcId);

    try {
      // Check if we need to start a new dialogue first
      if (this.activeDialogueNpcId === null || this.activeDialogueNpcId !== request.npcId) {
        // Start new dialogue with NPC
        console.log(`[Dialogue] Calling startDialogue: npcId=${request.npcId}`);
        this.connection.startDialogue(BigInt(request.npcId));
        this.activeDialogueNpcId = request.npcId;

        // If there's also an utterance, send it after a short delay
        // to allow the dialogue session to be established on the server
        if (request.utterance) {
          console.log(`[Dialogue] Will send utterance after delay...`);
          setTimeout(() => {
            console.log(`[Dialogue] Calling dialogueSay: "${request.utterance}"`);
            this.connection.dialogueSay(request.utterance!);
          }, 200);
        }
      } else if (request.utterance) {
        // Continue existing dialogue with a message
        console.log(`[Dialogue] Calling dialogueSay: "${request.utterance}"`);
        this.connection.dialogueSay(request.utterance);
      }
      console.log('[Dialogue] Reducer call completed');
    } catch (err) {
      console.error('[Dialogue] Failed to send dialogue:', err);
    }
  }

  /**
   * Clear the active dialogue state when dialogue closes
   */
  private clearActiveDialogue(): void {
    console.log('[Dialogue] Clearing active dialogue');

    // Resume NPC wandering when dialogue ends
    if (this.activeDialogueNpcId !== null) {
      this.npcClientBehavior.disengageNpc(this.activeDialogueNpcId);
    }

    this.activeDialogueNpcId = null;
    this.connection.endDialogue();
  }

  // ============================================================================
  // Debug
  // ============================================================================

  private updateDebugOverlay(): void {
    if (!this.debugOverlay) return;

    const playerPos = this.playerController.getDisplayPosition();
    const playerVel = this.playerController.getVelocity();
    const entityStats = this.entityManager.getStats();
    const chunkStats = this.chunkStreamManager.getStats();
    const inputStats = this.playerController.getInputStats();

    // Get terrain height at player position for debug
    const terrainProvider = this.chunkRenderer.getTerrainProvider();
    const terrainSample = terrainProvider.getSampleAt(playerPos.x, playerPos.y);
    const terrainHeight = terrainSample.height;

    // Update minimap coordinates
    if (this.minimapCoords) {
      this.minimapCoords.textContent = `${Math.floor(playerPos.x)}, ${Math.floor(playerPos.z)}`;
    }

    // Calculate speed for display
    const speed = Math.sqrt(playerVel.vx * playerVel.vx + playerVel.vy * playerVel.vy);

    // Build styled debug overlay
    this.debugOverlay.innerHTML = `
      <div class="debug-title">Debug Info</div>
      <div class="debug-row">
        <span class="debug-label">FPS</span>
        <span class="debug-value ${this.fps >= 55 ? 'highlight' : ''}">${this.fps}</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">State</span>
        <span class="debug-value">${this.connection.getState()}</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Entities</span>
        <span class="debug-value">${entityStats.total}</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">LOD 0/1/2</span>
        <span class="debug-value">${entityStats.byLOD[0]}/${entityStats.byLOD[1]}/${entityStats.byLOD[2]}</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Chunks</span>
        <span class="debug-value">${chunkStats.loaded} / ${chunkStats.pending} pending</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Position</span>
        <span class="debug-value highlight">${playerPos.x.toFixed(1)}, ${playerPos.y.toFixed(1)}, ${playerPos.z.toFixed(1)}</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Terrain</span>
        <span class="debug-value">${terrainHeight.toFixed(2)} (slope: ${terrainSample.slopeX.toFixed(2)}, ${terrainSample.slopeY.toFixed(2)})</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Speed</span>
        <span class="debug-value">${speed.toFixed(1)} m/s</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Chunk</span>
        <span class="debug-value">${chunkStats.playerChunk.cx}, ${chunkStats.playerChunk.cy}</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Pending</span>
        <span class="debug-value">${inputStats.pendingCount}</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Dialogue</span>
        <span class="debug-value">${this.dialogueUI.isOpen() ? 'Open' : 'Closed'}</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Time</span>
        <span class="debug-value">${this.dayNightCycle.getTimePhase()} (${(this.dayNightCycle.getTime() * 24).toFixed(1)}h)</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Weather</span>
        <span class="debug-value">${this.weatherSystem.getCurrentState()}${this.weatherSystem.isTransitioning() ? ' (transitioning)' : ''}</span>
      </div>
    `;
  }
}

// ============================================================================
// Bootstrap
// ============================================================================

/**
 * Check URL parameters for view mode
 * ?view=3d (default) - Three.js 3D client
 * ?view=graph - WASM graph visualization (coming soon)
 */
function getViewMode(): 'threejs' | 'graph' {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  return view === 'graph' ? 'graph' : 'threejs';
}

/**
 * Load a script dynamically and return a promise
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

// Declare the global wasm_bindgen module type
declare global {
  interface Window {
    frugworld_graph: {
      run_graph_app: (canvasId: string, spacetimeUrl: string) => Promise<void>;
    };
  }
}

/**
 * Data structures for WASM bridge (simplified from SpacetimeDB types)
 */
interface BridgeEntityData {
  entityId: number;
  kind: number;
  archetypeId: number;
  zoneId: number;
  chunkX: number;
  chunkY: number;
  alive: boolean;
}

interface BridgeTransformData {
  entityId: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  lastTick: number;
}

interface BridgeNpcBlueprintData {
  npcId: number;
  name: string;
  archetypeId: number;
  extraversion: number;
  agreeableness: number;
  lifeStage: number;
}

interface BridgeNpcStateData {
  npcId: number;
  lodState: number;
  shortIntent: string | null;
  midGoal: string | null;
  longGoal: string | null;
  needsSummary: string | null;
  memorySummary: string | null;
}

interface BridgeRelationshipData {
  id: number;
  npcAId: number;
  npcBId: number;
  affinityAToB: number;
  affinityBToA: number;
  trustAToB: number;
  trustBToA: number;
  interactionCount: number;
  relationshipType: number;
  flags: number;
}

interface BridgePlayerData {
  identity: string;
  entityId: number;
  name: string;
  lastInputSeq: number;
}

interface BridgeWorldMessageData {
  messageId: number;
  senderId: number;
  senderName: string;
  message: string;
  isYell: boolean;
  chunkX: number;
  chunkY: number;
  posX: number;
  posY: number;
  posZ: number;
  tsMs: number;
}

interface BridgeInputData {
  inputSeq: number;
  clientTimeMs: number;
  moveX: number;
  moveY: number;
  actions: number;
  aimYaw: number;
  predictedX: number;
  predictedY: number;
  predictedZ: number;
}

type BridgeChangeCallback<T> = (action: 'insert' | 'update' | 'delete', data: T) => void;

/**
 * Bridge interface for WASM graph client to call SpacetimeDB reducers
 */
interface FrugworldBridge {
  // === CONNECTION ===
  isConnected: () => boolean;
  getConnectionState: () => 'disconnected' | 'connecting' | 'connected';
  getIdentity: () => string | null;
  getLocalEntityId: () => number | null;

  // === BULK DATA FETCHERS (initial load) ===
  getEntities: () => BridgeEntityData[];
  getTransforms: () => BridgeTransformData[];
  getNpcBlueprints: () => BridgeNpcBlueprintData[];
  getNpcStates: () => BridgeNpcStateData[];
  getNpcNpcRelationships: () => BridgeRelationshipData[];
  getPlayers: () => BridgePlayerData[];
  getWorldMessages: () => BridgeWorldMessageData[];

  // === TABLE CHANGE CALLBACKS ===
  onEntityChange: (cb: BridgeChangeCallback<BridgeEntityData>) => void;
  onTransformChange: (cb: BridgeChangeCallback<BridgeTransformData>) => void;
  onNpcStateChange: (cb: BridgeChangeCallback<BridgeNpcStateData>) => void;
  onNpcBlueprintChange: (cb: BridgeChangeCallback<BridgeNpcBlueprintData>) => void;
  onRelationshipChange: (cb: BridgeChangeCallback<BridgeRelationshipData>) => void;
  onPlayerChange: (cb: BridgeChangeCallback<BridgePlayerData>) => void;
  onWorldMessageChange: (cb: BridgeChangeCallback<BridgeWorldMessageData>) => void;

  // === REDUCERS ===
  playerConnect: (name: string) => void;
  submitInput: (input: BridgeInputData) => void;
  startDialogue: (npcId: number | bigint) => void;
  dialogueSay: (text: string) => void;
  endDialogue: () => void;
  sendMessage: (text: string) => void;
  yellMessage: (text: string) => void;
  performGesture: (gestureType: string, targetNpcIds: number[]) => void;
  subscribeChunks: (entityId: number, chunkCxs: number[], chunkCys: number[]) => void;

  // === DIALOGUE CALLBACKS (existing) ===
  _dialogueCallbacks: Array<(line: { speaker: string; text: string; timestamp: number }) => void>;
  onDialogueLine: (callback: (line: { speaker: string; text: string; timestamp: number }) => void) => void;
  _emitDialogueLine: (line: { speaker: string; text: string; timestamp: number }) => void;

  // === INTERNAL CALLBACK STORAGE ===
  _callbacks: Map<string, Array<(action: string, data: unknown) => void>>;
  _emit: (event: string, action: 'insert' | 'update' | 'delete', data: unknown) => void;
}

declare global {
  interface Window {
    frugworldBridge?: FrugworldBridge;
  }
}

/**
 * Initialize the graph visualization client (WASM)
 * Uses wgpu + egui for GPU-accelerated 2D graph visualization
 */
async function initGraphClient(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) {
    console.error('App container not found');
    return;
  }

  // Create SpacetimeDB connection for graph client
  console.log('[GraphClient] Creating SpacetimeDB connection...');
  const graphConnection = new SpacetimeDBConnection(
    { uri: CONFIG.serverUrl, moduleName: CONFIG.moduleName },
    {
      onConnect: (identity) => {
        console.log('[GraphClient] Connected to SpacetimeDB:', identity);
        // Call playerConnect so we can interact with NPCs
        graphConnection.playerConnect('GraphViewer');
      },
      onStateChange: (state) => {
        console.log('[GraphClient] Connection state:', state);
      },
      onActiveDialogueUpdate: (dialogue) => {
        console.log('[GraphClient] Dialogue update:', dialogue);
        // Parse context to get the latest line and emit to WASM
        try {
          const contextStr = new TextDecoder().decode(dialogue.context);
          const context = JSON.parse(contextStr);
          const recentLines = context.recent_lines || [];
          if (recentLines.length > 0) {
            const lastLine = recentLines[recentLines.length - 1];
            window.frugworldBridge?._emitDialogueLine({
              speaker: lastLine.speaker,
              text: lastLine.text,
              timestamp: lastLine.ts_ms || Date.now(),
            });
          }
        } catch (e) {
          console.error('[GraphClient] Failed to parse dialogue context:', e);
        }
      },
    }
  );

  // Helper functions to convert SpacetimeDB types to bridge types
  const convertEntity = (e: EntityRow): BridgeEntityData => ({
    entityId: Number(e.entityId),
    kind: e.kind,
    archetypeId: e.archetypeId,
    zoneId: Number(e.zoneId),
    chunkX: e.chunkX,
    chunkY: e.chunkY,
    alive: e.alive,
  });

  const convertTransform = (t: TransformRow): BridgeTransformData => ({
    entityId: Number(t.entityId),
    x: t.x,
    y: t.y,
    z: t.z,
    yaw: t.yaw,
    vx: t.vx,
    vy: t.vy,
    vz: t.vz,
    lastTick: Number(t.lastTick),
  });

  const convertNpcBlueprint = (bp: NpcBlueprintRow): BridgeNpcBlueprintData => {
    try {
      const jsonStr = new TextDecoder().decode(bp.blueprintJson);
      const data = JSON.parse(jsonStr);
      return {
        npcId: Number(bp.npcId),
        name: data?.identity?.name ?? `NPC ${bp.npcId}`,
        archetypeId: data?.archetype_id ?? 0,
        extraversion: data?.personality?.extraversion ?? 50,
        agreeableness: data?.personality?.agreeableness ?? 50,
        lifeStage: data?.life_stage ?? 0,
      };
    } catch {
      return {
        npcId: Number(bp.npcId),
        name: `NPC ${bp.npcId}`,
        archetypeId: 0,
        extraversion: 50,
        agreeableness: 50,
        lifeStage: 0,
      };
    }
  };

  const convertNpcState = (s: NpcStateRow): BridgeNpcStateData => {
    const decoder = new TextDecoder();
    return {
      npcId: Number(s.npcId),
      lodState: s.lodState,
      shortIntent: s.shortIntent?.length > 0 ? decoder.decode(s.shortIntent) : null,
      midGoal: s.midGoal?.length > 0 ? decoder.decode(s.midGoal) : null,
      longGoal: s.longGoal?.length > 0 ? decoder.decode(s.longGoal) : null,
      needsSummary: s.needs?.length > 0 ? decoder.decode(s.needs) : null,
      memorySummary: s.memorySummary?.length > 0 ? decoder.decode(s.memorySummary) : null,
    };
  };

  // Type alias for NpcNpcRelationship row
  interface NpcNpcRelationshipRow {
    id: bigint;
    npcAId: bigint;
    npcBId: bigint;
    affinityAToB: number;
    affinityBToA: number;
    trustAToB: number;
    trustBToA: number;
    interactionCount: number;
    lastInteractionTick: bigint;
    relationshipType: number;
    flags: number;
    sharedKnowledge: Uint8Array;
  }

  const convertRelationship = (r: NpcNpcRelationshipRow): BridgeRelationshipData => ({
    id: Number(r.id),
    npcAId: Number(r.npcAId),
    npcBId: Number(r.npcBId),
    affinityAToB: r.affinityAToB,
    affinityBToA: r.affinityBToA,
    trustAToB: r.trustAToB,
    trustBToA: r.trustBToA,
    interactionCount: r.interactionCount,
    relationshipType: r.relationshipType,
    flags: r.flags,
  });

  // Type alias for Player row
  interface PlayerRow {
    identity: unknown;
    entityId: bigint;
    name: string;
    lastInputSeq: number;
  }

  const convertPlayer = (p: PlayerRow): BridgePlayerData => ({
    identity: String(p.identity),
    entityId: Number(p.entityId),
    name: p.name,
    lastInputSeq: p.lastInputSeq,
  });

  // Type alias for WorldMessage row
  interface WorldMessageRow {
    messageId: bigint;
    senderId: bigint;
    senderName: string;
    message: string;
    isYell: boolean;
    chunkX: number;
    chunkY: number;
    posX: number;
    posY: number;
    posZ: number;
    tsMs: bigint;
  }

  const convertWorldMessage = (m: WorldMessageRow): BridgeWorldMessageData => ({
    messageId: Number(m.messageId),
    senderId: Number(m.senderId),
    senderName: m.senderName,
    message: m.message,
    isYell: m.isYell,
    chunkX: m.chunkX,
    chunkY: m.chunkY,
    posX: m.posX,
    posY: m.posY,
    posZ: m.posZ,
    tsMs: Number(m.tsMs),
  });

  // Track local player entity ID
  let localEntityId: number | null = null;

  // Setup bridge BEFORE loading WASM so it's available when WASM initializes
  window.frugworldBridge = {
    // === CONNECTION ===
    isConnected: () => {
      const connected = graphConnection.getState() === ConnectionState.Connected;
      return connected;
    },
    getConnectionState: () => {
      const state = graphConnection.getState();
      switch (state) {
        case ConnectionState.Connected: return 'connected';
        case ConnectionState.Connecting: return 'connecting';
        default: return 'disconnected';
      }
    },
    getIdentity: () => graphConnection.getIdentity(),
    getLocalEntityId: () => localEntityId,

    // === BULK DATA FETCHERS ===
    getEntities: () => {
      const conn = graphConnection.getConnection();
      if (!conn) return [];
      const entities: BridgeEntityData[] = [];
      for (const e of conn.db.entity.iter()) {
        entities.push(convertEntity(e as EntityRow));
      }
      return entities;
    },
    getTransforms: () => {
      const conn = graphConnection.getConnection();
      if (!conn) return [];
      const transforms: BridgeTransformData[] = [];
      for (const t of conn.db.transform.iter()) {
        transforms.push(convertTransform(t as TransformRow));
      }
      return transforms;
    },
    getNpcBlueprints: () => {
      const conn = graphConnection.getConnection();
      if (!conn) return [];
      const blueprints: BridgeNpcBlueprintData[] = [];
      for (const bp of conn.db.npcBlueprint.iter()) {
        blueprints.push(convertNpcBlueprint(bp as NpcBlueprintRow));
      }
      return blueprints;
    },
    getNpcStates: () => {
      const conn = graphConnection.getConnection();
      if (!conn) return [];
      const states: BridgeNpcStateData[] = [];
      for (const s of conn.db.npcState.iter()) {
        states.push(convertNpcState(s as NpcStateRow));
      }
      return states;
    },
    getNpcNpcRelationships: () => {
      const conn = graphConnection.getConnection();
      if (!conn) return [];
      const relationships: BridgeRelationshipData[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = conn.db as any;
      if (db.npcNpcRelationship) {
        for (const r of db.npcNpcRelationship.iter()) {
          relationships.push(convertRelationship(r as NpcNpcRelationshipRow));
        }
      }
      return relationships;
    },
    getPlayers: () => {
      const conn = graphConnection.getConnection();
      if (!conn) return [];
      const players: BridgePlayerData[] = [];
      for (const p of conn.db.player.iter()) {
        players.push(convertPlayer(p as PlayerRow));
      }
      return players;
    },
    getWorldMessages: () => {
      const conn = graphConnection.getConnection();
      if (!conn) return [];
      const messages: BridgeWorldMessageData[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = conn.db as any;
      if (db.worldMessage) {
        for (const m of db.worldMessage.iter()) {
          messages.push(convertWorldMessage(m as WorldMessageRow));
        }
      }
      return messages;
    },

    // === TABLE CHANGE CALLBACKS ===
    onEntityChange: (cb) => {
      const callbacks = window.frugworldBridge?._callbacks;
      if (!callbacks?.has('entity')) callbacks?.set('entity', []);
      callbacks?.get('entity')?.push(cb as (action: string, data: unknown) => void);
    },
    onTransformChange: (cb) => {
      const callbacks = window.frugworldBridge?._callbacks;
      if (!callbacks?.has('transform')) callbacks?.set('transform', []);
      callbacks?.get('transform')?.push(cb as (action: string, data: unknown) => void);
    },
    onNpcStateChange: (cb) => {
      const callbacks = window.frugworldBridge?._callbacks;
      if (!callbacks?.has('npcState')) callbacks?.set('npcState', []);
      callbacks?.get('npcState')?.push(cb as (action: string, data: unknown) => void);
    },
    onNpcBlueprintChange: (cb) => {
      const callbacks = window.frugworldBridge?._callbacks;
      if (!callbacks?.has('npcBlueprint')) callbacks?.set('npcBlueprint', []);
      callbacks?.get('npcBlueprint')?.push(cb as (action: string, data: unknown) => void);
    },
    onRelationshipChange: (cb) => {
      const callbacks = window.frugworldBridge?._callbacks;
      if (!callbacks?.has('relationship')) callbacks?.set('relationship', []);
      callbacks?.get('relationship')?.push(cb as (action: string, data: unknown) => void);
    },
    onPlayerChange: (cb) => {
      const callbacks = window.frugworldBridge?._callbacks;
      if (!callbacks?.has('player')) callbacks?.set('player', []);
      callbacks?.get('player')?.push(cb as (action: string, data: unknown) => void);
    },
    onWorldMessageChange: (cb) => {
      const callbacks = window.frugworldBridge?._callbacks;
      if (!callbacks?.has('worldMessage')) callbacks?.set('worldMessage', []);
      callbacks?.get('worldMessage')?.push(cb as (action: string, data: unknown) => void);
    },

    // === REDUCERS ===
    playerConnect: (name: string) => {
      console.log('[Bridge] playerConnect called:', name);
      graphConnection.playerConnect(name);
    },
    submitInput: (input: BridgeInputData) => {
      graphConnection.submitInput(
        input.inputSeq,
        BigInt(input.clientTimeMs),
        input.moveX,
        input.moveY,
        input.actions,
        input.aimYaw,
        input.predictedX,
        input.predictedY,
        input.predictedZ
      );
    },
    startDialogue: (npcId: number | bigint) => {
      const npcIdBigInt = typeof npcId === 'bigint' ? npcId : BigInt(npcId);
      console.log('[Bridge] startDialogue called:', npcId);
      graphConnection.startDialogue(npcIdBigInt);
    },
    dialogueSay: (text: string) => {
      console.log('[Bridge] dialogueSay called:', text);
      graphConnection.dialogueSay(text);
    },
    endDialogue: () => {
      console.log('[Bridge] endDialogue called');
      graphConnection.endDialogue();
    },
    sendMessage: (text: string) => {
      console.log('[Bridge] sendMessage called:', text);
      graphConnection.sendMessage(text);
    },
    yellMessage: (text: string) => {
      console.log('[Bridge] yellMessage called:', text);
      graphConnection.yellMessage(text);
    },
    performGesture: (gestureType: string, targetNpcIds: number[]) => {
      console.log('[Bridge] performGesture called:', gestureType, targetNpcIds);
      graphConnection.performGesture(gestureType, targetNpcIds.map(id => BigInt(id)));
    },
    subscribeChunks: (entityId: number, chunkCxs: number[], chunkCys: number[]) => {
      console.log('[Bridge] subscribeChunks called:', entityId, chunkCxs.length, 'chunks');
      // Convert parallel arrays to array of objects
      const chunks = chunkCxs.map((cx, i) => ({ cx, cy: chunkCys[i] }));
      graphConnection.subscribeChunks(BigInt(entityId), chunks);
    },

    // === DIALOGUE CALLBACKS (existing) ===
    _dialogueCallbacks: [],
    onDialogueLine: (callback) => {
      console.log('[Bridge] onDialogueLine callback registered');
      window.frugworldBridge?._dialogueCallbacks.push(callback);
    },
    _emitDialogueLine: (line) => {
      console.log('[Bridge] Emitting dialogue line:', line);
      window.frugworldBridge?._dialogueCallbacks.forEach(cb => cb(line));
    },

    // === INTERNAL CALLBACK STORAGE ===
    _callbacks: new Map(),
    _emit: (event: string, action: 'insert' | 'update' | 'delete', data: unknown) => {
      window.frugworldBridge?._callbacks.get(event)?.forEach(cb => cb(action, data));
    },
  };

  // Wire up SpacetimeDB table callbacks to bridge emitters
  const conn = graphConnection.getConnection();
  if (conn) {
    wireUpBridgeCallbacks(conn, graphConnection);
  }

  // Also wire up callbacks when connection is established
  graphConnection.onConnectCallback = () => {
    const c = graphConnection.getConnection();
    if (c) {
      wireUpBridgeCallbacks(c, graphConnection);
    }
  };

  function wireUpBridgeCallbacks(c: ReturnType<typeof graphConnection.getConnection>, gConn: SpacetimeDBConnection) {
    if (!c) return;

    // Track player entity ID
    c.db.player.onInsert((_ctx, player) => {
      const identity = gConn.getIdentity();
      if (player && String((player as PlayerRow).identity) === identity) {
        localEntityId = Number((player as PlayerRow).entityId);
        console.log('[Bridge] Local player entity ID:', localEntityId);
      }
      window.frugworldBridge?._emit('player', 'insert', convertPlayer(player as PlayerRow));
    });
    c.db.player.onUpdate((_ctx, _old, player) => {
      window.frugworldBridge?._emit('player', 'update', convertPlayer(player as PlayerRow));
    });
    c.db.player.onDelete((_ctx, player) => {
      window.frugworldBridge?._emit('player', 'delete', convertPlayer(player as PlayerRow));
    });

    c.db.entity.onInsert((_ctx, entity) => {
      window.frugworldBridge?._emit('entity', 'insert', convertEntity(entity as EntityRow));
    });
    c.db.entity.onUpdate((_ctx, _old, entity) => {
      window.frugworldBridge?._emit('entity', 'update', convertEntity(entity as EntityRow));
    });
    c.db.entity.onDelete((_ctx, entity) => {
      window.frugworldBridge?._emit('entity', 'delete', convertEntity(entity as EntityRow));
    });

    c.db.transform.onInsert((_ctx, transform) => {
      window.frugworldBridge?._emit('transform', 'insert', convertTransform(transform as TransformRow));
    });
    c.db.transform.onUpdate((_ctx, _old, transform) => {
      window.frugworldBridge?._emit('transform', 'update', convertTransform(transform as TransformRow));
    });

    c.db.npcState.onInsert((_ctx, state) => {
      window.frugworldBridge?._emit('npcState', 'insert', convertNpcState(state as NpcStateRow));
    });
    c.db.npcState.onUpdate((_ctx, _old, state) => {
      window.frugworldBridge?._emit('npcState', 'update', convertNpcState(state as NpcStateRow));
    });

    c.db.npcBlueprint.onInsert((_ctx, bp) => {
      window.frugworldBridge?._emit('npcBlueprint', 'insert', convertNpcBlueprint(bp as NpcBlueprintRow));
    });
    c.db.npcBlueprint.onUpdate((_ctx, _old, bp) => {
      window.frugworldBridge?._emit('npcBlueprint', 'update', convertNpcBlueprint(bp as NpcBlueprintRow));
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = c.db as any;

    // NPC-NPC Relationships
    if (db.npcNpcRelationship) {
      db.npcNpcRelationship.onInsert((_ctx: unknown, rel: unknown) => {
        window.frugworldBridge?._emit('relationship', 'insert', convertRelationship(rel as NpcNpcRelationshipRow));
      });
      db.npcNpcRelationship.onUpdate((_ctx: unknown, _old: unknown, rel: unknown) => {
        window.frugworldBridge?._emit('relationship', 'update', convertRelationship(rel as NpcNpcRelationshipRow));
      });
      db.npcNpcRelationship.onDelete((_ctx: unknown, rel: unknown) => {
        window.frugworldBridge?._emit('relationship', 'delete', convertRelationship(rel as NpcNpcRelationshipRow));
      });
    }

    // World Messages
    if (db.worldMessage) {
      db.worldMessage.onInsert((_ctx: unknown, msg: unknown) => {
        window.frugworldBridge?._emit('worldMessage', 'insert', convertWorldMessage(msg as WorldMessageRow));
      });
      db.worldMessage.onUpdate((_ctx: unknown, _old: unknown, msg: unknown) => {
        window.frugworldBridge?._emit('worldMessage', 'update', convertWorldMessage(msg as WorldMessageRow));
      });
      db.worldMessage.onDelete((_ctx: unknown, msg: unknown) => {
        window.frugworldBridge?._emit('worldMessage', 'delete', convertWorldMessage(msg as WorldMessageRow));
      });
    }
  }

  // Start connection
  await graphConnection.connect();
  console.log('[GraphClient] SpacetimeDB connection initiated');

  // Hide Three.js UI elements that would cover the graph canvas
  const elementsToHide = [
    'loading-screen',
    'hud-top',
    'minimap-container',
    'minimap-overlay',
    'minimap-controls',
    'frug-hud',
    'custom-cursor',
    'debug-overlay',
    'notifications',
    'regenerate-seed-btn',
  ];

  for (const id of elementsToHide) {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = 'none';
    }
  }

  // Also hide vignette overlay
  const vignette = document.querySelector('.vignette');
  if (vignette) {
    (vignette as HTMLElement).style.display = 'none';
  }

  // Create canvas for WASM rendering
  container.innerHTML = `
    <canvas id="graph-canvas" style="width: 100%; height: 100vh; display: block;"></canvas>
    <div id="graph-loading" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-family: monospace; text-align: center;">
      <h2>Loading Graph View...</h2>
      <p>Initializing WebGPU/WebGL2</p>
    </div>
  `;

  try {
    // Load and initialize the WASM module via inline script
    // wasm-pack generates a module that auto-initializes on load
    const initScript = document.createElement('script');
    initScript.type = 'module';
    initScript.textContent = `
      import init, { run_graph_app } from '/graph-wasm/frugworld_graph.js';

      async function startGraphApp() {
        try {
          await init();
          document.getElementById('graph-loading').style.display = 'none';
          await run_graph_app('graph-canvas', 'ws://localhost:3000');
        } catch (err) {
          console.error('Graph WASM error:', err);
          document.getElementById('graph-loading').innerHTML = \`
            <h2 style="color: #f66;">Failed to load Graph View</h2>
            <p>\${err.message || 'Unknown error'}</p>
            <p style="margin-top: 20px;">
              <a href="?view=3d" style="color: #6cf;">Switch to 3D View</a>
            </p>
          \`;
        }
      }

      startGraphApp();
    `;
    document.head.appendChild(initScript);
  } catch (err) {
    console.error('Failed to initialize graph client:', err);

    const loadingEl = document.getElementById('graph-loading');
    if (loadingEl) {
      loadingEl.innerHTML = `
        <h2 style="color: #f66;">Failed to load Graph View</h2>
        <p>${err instanceof Error ? err.message : 'Unknown error'}</p>
        <p style="margin-top: 20px;">
          <a href="?view=3d" style="color: #6cf;">Switch to 3D View</a>
        </p>
      `;
    }
  }
}

// Start client when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  const viewMode = getViewMode();

  if (viewMode === 'graph') {
    await initGraphClient();
    return;
  }

  // Default: Three.js 3D client
  const client = new FrugworldClient();
  client.start();

  // Expose to console for debugging
  (window as unknown as { client: FrugworldClient }).client = client;
});
