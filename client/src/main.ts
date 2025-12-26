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
} from '@/render/index.ts';
import { assetManager } from '@/assets/AssetManager.ts';
import type { WeatherInfo } from '@/render/index.ts';
import { VoiceChatService, AudioPlayer } from '@/audio/index.ts';
import { ChunkStreamManager, ChunkDeltaHandler } from '@/chunks/index.ts';
import { DialogueUI, InteractionPrompt, SettingsPanel, ThoughtBubbleUI, MinimapUI, type ThoughtGameContext } from '@/ui/index.ts';
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
  chunkLoadRadius: 3,
  chunkPrefetchRadius: 5,
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
  private interactionPrompt: InteractionPrompt;
  private settingsPanel: SettingsPanel;
  private thoughtBubbleUI: ThoughtBubbleUI;
  private npcThoughtBubbleUI: NPCThoughtBubbleUI;
  private minimapUI: MinimapUI;

  // NPC client-side behavior (wandering, reactions)
  private npcClientBehavior: NPCClientBehavior;

  // Rendering
  private sceneManager: SceneManager;
  private cameraController: CameraController;
  private npcRenderer: NPCRenderer;
  private chunkRenderer: ChunkRenderer;
  private playerRenderer: PlayerRenderer;
  private dayNightCycle: DayNightCycle;
  private weatherSystem: WeatherSystem;

  // RTS Click-to-move
  private raycaster: THREE.Raycaster;
  private clickPlane: THREE.Plane; // Ground plane for click detection

  // Voice chat
  private voiceChatService: VoiceChatService;

  // Frug's thought TTS audio player (cute/quirky voice)
  private thoughtAudioPlayer: AudioPlayer;

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

    // Initialize day/night cycle
    this.dayNightCycle = new DayNightCycle(this.sceneManager.scene, {
      dayDurationSeconds: 600, // 10 minute full day cycle
      startTime: 0.35, // Start at morning
    });
    this.dayNightCycle.setLights(
      this.sceneManager.ambientLight,
      this.sceneManager.directionalLight
    );

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
    });

    this.interactionPrompt = new InteractionPrompt();
    this.interactionPrompt.initialize(container);
    this.interactionPrompt.setProjectionCallback((x, y, z) => {
      return this.projectToScreen(x, y, z);
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
      // Apply post-processing settings
      this.sceneManager.setPostProcessingConfig({
        enabled: settings.postProcessingEnabled,
        bloomEnabled: settings.bloomEnabled,
        bloomStrength: settings.bloomIntensity / 100, // Convert from 0-100 to 0-1
        vignetteEnabled: settings.vignetteEnabled,
      });
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

    // Initialize Frug's thought TTS with a cute/quirky voice
    // Using "Fin" voice (D38z5RcWu1voky8WS1ja) - young and playful
    const FRUG_VOICE_ID = 'D38z5RcWu1voky8WS1ja';
    const initialVolume = this.settingsPanel.getSettings().soundVolume / 100;
    this.thoughtAudioPlayer = new AudioPlayer({
      volume: initialVolume,
      onPlayStart: () => console.log('[ThoughtTTS] Frug speaking...'),
      onPlayEnd: () => console.log('[ThoughtTTS] Frug done speaking'),
      onError: (err) => console.warn('[ThoughtTTS] Error:', err),
    });
    this.thoughtBubbleUI.setSpeakCallback(async (text) => {
      try {
        console.log('[ThoughtTTS] Requesting TTS for:', text);
        const response = await fetch(`${CONFIG.thoughtsApiUrl}/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voiceId: FRUG_VOICE_ID }),
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

    // Add click listener for RTS controls
    this.sceneManager.getCanvas().addEventListener('click', this.handleCanvasClick);

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
      onEntityUpdate: (entity) => this.onEntityUpdate(entity),
      onEntityDelete: (entity) => this.onEntityDelete(entity),
      onTransformUpdate: (transform) => this.onTransformUpdate(transform),
      onPlayerUpdate: (player) => this.onPlayerUpdate(player),
      onPlayerDelete: (player) => this.onPlayerDelete(player),
      onNpcStateUpdate: (npcState) => this.onNpcStateUpdate(npcState),
      onChunkUpdate: (chunk) => this.onChunkUpdate(chunk),
      onActiveDialogueUpdate: (dialogue) => this.onActiveDialogueUpdate(dialogue),
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
    this.weatherSystem.destroy();
    this.sceneManager.destroy();
    this.dialogueUI.destroy();
    this.interactionPrompt.destroy();
    this.settingsPanel.destroy();
    this.thoughtBubbleUI.destroy();
    this.npcThoughtBubbleUI.destroy();
    this.minimapUI.destroy();
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
  // RTS Click-to-Move
  // ============================================================================

  /**
   * Handle canvas click for RTS movement
   */
  private handleCanvasClick = (event: MouseEvent): void => {
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
      console.log(`Clicked on NPC ${npcHit.entityId}, moving to it`);
      // Get NPC position in game coords
      const entity = this.entityManager.get(npcHit.entityId);
      if (entity) {
        const transform = entity.transform.getInterpolated();
        this.playerController.setMoveTarget(transform.x, transform.y, npcHit.entityId);
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
    this.dialogueUI.open(npcId, npcName);

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

    // Update weather system
    this.weatherSystem.setTimeOfDay(this.dayNightCycle.getTimePhase());
    this.weatherSystem.setPlayerPosition(playerPos.x, playerPos.z, playerPos.y); // Note: Three.js Y is up
    this.weatherSystem.update(deltaMs);

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
            break;
          }
        }
      }
    }

    // Render the minimap
    this.minimapUI.update();
  }

  private updateInteractionSystem(playerPos: { x: number; y: number; z: number }, deltaMs: number, isPlayerMoving: boolean): void {
    // Update interaction target
    this.interactionPrompt.updateTarget(
      playerPos.x,
      playerPos.y,
      playerPos.z,
      this.entityManager.getAll()
    );
    this.interactionPrompt.update();

    // Check for interaction input (E key or interact action)
    const target = this.interactionPrompt.getTarget();

    // Update player glow effect based on NPC proximity
    if (target) {
      // Calculate distance to NPC
      const transform = target.transform.getInterpolated();
      const dx = transform.x - playerPos.x;
      const dy = transform.y - playerPos.y;
      const dz = transform.z - playerPos.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Interaction distance is 3 meters (from InteractionPrompt config)
      // Intensity is 1 at distance 0, 0 at interaction distance threshold
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

    if (target && !this.dialogueUI.isOpen()) {
      // Check if player pressed interact (we'd need to track input state)
      // For now, the UI will handle this through mouse click on the prompt
    }
  }

  /**
   * Handle interaction with current target
   * Called when player presses interact key
   */
  handleInteraction(): void {
    const target = this.interactionPrompt.getTarget();
    if (target && target.lod.canDialogue()) {
      // Get NPC name from cached names or default
      const npcName = this.npcNames.get(BigInt(target.id)) ?? `NPC ${target.id}`;
      this.dialogueUI.open(target.id, npcName);
    }
  }

  /**
   * Update thought bubble with current game context
   */
  private updateThoughtBubble(
    playerPos: { x: number; y: number; z: number },
    playerVel: { vx: number; vy: number; vz: number }
  ): void {
    // Get interaction target for NPC proximity info
    const target = this.interactionPrompt.getTarget();
    let nearestNpcName: string | null = null;
    let nearestNpcDistance: number | null = null;

    if (target) {
      const transform = target.transform.getInterpolated();
      const dx = transform.x - playerPos.x;
      const dy = transform.y - playerPos.y;
      const dz = transform.z - playerPos.z;
      nearestNpcDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      nearestNpcName = this.npcNames.get(BigInt(target.id)) ?? `NPC ${target.id}`;
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
      this.connectionStatus.textContent =
        state.charAt(0).toUpperCase() + state.slice(1);
    }

    // Update loading status and notifications based on state
    switch (state) {
      case ConnectionState.Connecting:
        this.setLoadingStatus('Connecting to server...');
        break;
      case ConnectionState.Connected:
        this.setLoadingStatus('Loading world data...');
        this.showNotification('Connected to server', 'success');
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
        this.showNotification('Welcome to Frugworld!', 'info', 4000);
      }
    } else {
      // This is another player - track them for minimap display
      const entityId = player.entityId;
      const isNew = !this.otherPlayers.has(entityId);

      this.otherPlayers.set(entityId, {
        name: player.name,
        entityId,
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

  private onChunkUpdate(chunk: ChunkRow): void {
    const chunkData = chunkRowToData(chunk);
    this.chunkRenderer.loadChunk(chunkData);
    this.chunkStreamManager.onChunkReceived(chunkData.cx, chunkData.cy);

    // Apply any deltas if present
    if (chunkData.poiBlob) {
      const deltas = this.chunkDeltaHandler.parseDeltas(chunkData.poiBlob);
      const key = `${chunkData.cx},${chunkData.cy}`;
      this.chunkDeltaHandler.applyDeltas(key, deltas, chunkData);
    }
  }

  // Track last processed line count per dialogue to avoid duplicate responses
  private lastDialogueLineCount = new Map<bigint, number>();

  private onActiveDialogueUpdate(dialogue: { playerId: bigint; npcId: bigint; lineCount: number; context: Uint8Array }): void {
    // Only process if this is our dialogue
    if (this.localEntityId === null || dialogue.playerId !== this.localEntityId) {
      return;
    }

    // Only process if line count increased (new message)
    const lastLineCount = this.lastDialogueLineCount.get(dialogue.playerId) || 0;
    if (dialogue.lineCount <= lastLineCount) {
      return;
    }
    this.lastDialogueLineCount.set(dialogue.playerId, dialogue.lineCount);

    // Parse the context to get recent lines
    try {
      const contextStr = new TextDecoder().decode(dialogue.context);
      const context = JSON.parse(contextStr) as {
        recent_lines?: Array<{ speaker: string; text: string; ts_ms: number }>;
      };

      const recentLines = context.recent_lines || [];
      if (recentLines.length === 0) {
        return;
      }

      // Check if the last message is from the NPC
      const lastLine = recentLines[recentLines.length - 1];
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

        console.log(`NPC response received: "${lastLine.text}"`);
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

// Start client when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const client = new FrugworldClient();
  client.start();

  // Expose to console for debugging
  (window as unknown as { client: FrugworldClient }).client = client;
});
