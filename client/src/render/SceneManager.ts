/**
 * Three.js scene setup and management
 */

import * as THREE from 'three';
import { PostProcessing, PostProcessingConfig } from './PostProcessing';

export interface SceneConfig {
  backgroundColor: number;
  ambientLightColor: number;
  ambientLightIntensity: number;
  directionalLightColor: number;
  directionalLightIntensity: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  enableShadows: boolean;
}

// PS1/PS2 Crash Bandicoot style - bright outdoor environment
const DEFAULT_CONFIG: SceneConfig = {
  backgroundColor: 0x87CEEB, // Light blue sky
  ambientLightColor: 0xffffff, // White ambient for flat PS1 look
  ambientLightIntensity: 0.6,  // Brighter ambient
  directionalLightColor: 0xffffcc, // Warm sunlight
  directionalLightIntensity: 0.8,  // Strong directional light
  fogColor: 0xaaccff, // Light blue fog for depth
  fogNear: 200,  // Start fog further out
  fogFar: 800,   // Extended view distance to match chunk load radius
  enableShadows: true, // Enable shadows for depth
};

export class SceneManager {
  public readonly scene: THREE.Scene;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly postProcessing: PostProcessing;

  private config: SceneConfig;
  private container: HTMLElement;

  // Lights exposed for day/night cycle
  public readonly ambientLight: THREE.AmbientLight;
  public readonly directionalLight: THREE.DirectionalLight;

  constructor(container: HTMLElement, config: Partial<SceneConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.container = container;

    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.config.backgroundColor);
    this.scene.fog = new THREE.Fog(
      this.config.fogColor,
      this.config.fogNear,
      this.config.fogFar
    );

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    if (this.config.enableShadows) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    container.appendChild(this.renderer.domElement);

    // Create camera
    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    this.camera.position.set(0, 10, 20);

    // Setup lighting
    this.ambientLight = new THREE.AmbientLight(
      this.config.ambientLightColor,
      this.config.ambientLightIntensity
    );
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(
      this.config.directionalLightColor,
      this.config.directionalLightIntensity
    );
    this.directionalLight.position.set(50, 100, 50);

    if (this.config.enableShadows) {
      this.directionalLight.castShadow = true;
      this.directionalLight.shadow.mapSize.width = 2048;
      this.directionalLight.shadow.mapSize.height = 2048;
      this.directionalLight.shadow.camera.near = 0.5;
      this.directionalLight.shadow.camera.far = 500;
      this.directionalLight.shadow.camera.left = -100;
      this.directionalLight.shadow.camera.right = 100;
      this.directionalLight.shadow.camera.top = 100;
      this.directionalLight.shadow.camera.bottom = -100;
    }

    // Add light target for shadow frustum following
    this.directionalLight.target = new THREE.Object3D();
    this.scene.add(this.directionalLight);
    this.scene.add(this.directionalLight.target);

    // Setup post-processing pipeline
    this.postProcessing = new PostProcessing(
      this.renderer,
      this.scene,
      this.camera
    );

    // Setup resize handler
    window.addEventListener('resize', this.handleResize);
  }

  /**
   * Render the scene with post-processing effects
   */
  render(deltaTime: number = 0.016): void {
    this.postProcessing.render(deltaTime);
  }

  /**
   * Get canvas element
   */
  getCanvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /**
   * Add object to scene
   */
  add(object: THREE.Object3D): void {
    this.scene.add(object);
  }

  /**
   * Remove object from scene
   */
  remove(object: THREE.Object3D): void {
    this.scene.remove(object);
  }

  /**
   * Update directional light position (for sun simulation)
   */
  setSunPosition(x: number, y: number, z: number): void {
    this.directionalLight.position.set(x, y, z);
  }

  /**
   * Set fog parameters
   */
  setFog(near: number, far: number): void {
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = near;
      this.scene.fog.far = far;
    }
  }

  /**
   * Update shadow frustum to follow player position
   * This ensures shadows are always visible near the player regardless of world position
   * @param playerX - Player X position in world coordinates
   * @param playerZ - Player Z position in world coordinates
   * @param sunDirection - Normalized sun direction vector
   */
  updateShadowTarget(playerX: number, playerZ: number, sunDirection: THREE.Vector3): void {
    if (!this.directionalLight.castShadow) return;

    // Position light target at player location
    this.directionalLight.target.position.set(playerX, 0, playerZ);
    this.directionalLight.target.updateMatrixWorld();

    // Position light along sun direction from target
    // Distance of 150 units ensures good shadow coverage
    this.directionalLight.position.set(
      playerX + sunDirection.x * 150,
      sunDirection.y * 150,
      playerZ + sunDirection.z * 150
    );
  }

  /**
   * Set shadow quality for performance tuning
   * @param quality - Shadow quality level
   */
  setShadowQuality(quality: 'off' | 'low' | 'medium' | 'high'): void {
    const sizes: Record<string, number> = {
      off: 0,
      low: 512,
      medium: 1024,
      high: 2048,
    };

    if (quality === 'off') {
      this.renderer.shadowMap.enabled = false;
      this.directionalLight.castShadow = false;
    } else {
      this.renderer.shadowMap.enabled = true;
      this.directionalLight.castShadow = true;
      this.directionalLight.shadow.mapSize.width = sizes[quality];
      this.directionalLight.shadow.mapSize.height = sizes[quality];
      // Force shadow map regeneration
      this.directionalLight.shadow.map?.dispose();
      this.directionalLight.shadow.map = null;
    }
  }

  /**
   * Configure post-processing effects
   */
  setPostProcessingConfig(config: Partial<PostProcessingConfig>): void {
    this.postProcessing.setConfig(config);
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    window.removeEventListener('resize', this.handleResize);
    this.postProcessing.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private handleResize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.postProcessing.resize(width, height);
  };
}
