/**
 * Asset Manager
 * Loads and manages game assets (textures, models)
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Biome IDs matching the server
export enum BiomeType {
  Grassland = 0,
  Desert = 1,
  Forest = 2,
  Snow = 3,
  Swamp = 4,
  Mountain = 5,
}

// Biome name mappings
export const BIOME_NAMES: Record<BiomeType, string> = {
  [BiomeType.Grassland]: 'grassland',
  [BiomeType.Desert]: 'desert',
  [BiomeType.Forest]: 'forest',
  [BiomeType.Snow]: 'snow',
  [BiomeType.Swamp]: 'swamp',
  [BiomeType.Mountain]: 'mountain',
};

// Time of day for skybox selection
export type TimeOfDay = 'dawn' | 'day' | 'sunset' | 'night';

// Asset paths
const ASSET_BASE = '/assets';
const TEXTURE_PATH = `${ASSET_BASE}/textures`;
const MODEL_PATH = `${ASSET_BASE}/models`;

interface BiomeTextures {
  ground: THREE.Texture;
  detail: THREE.Texture;
  height: THREE.Texture;
}

interface SkyboxTextures {
  sky: THREE.Texture;
  clouds: THREE.Texture;
  stars?: THREE.Texture;
}

export class AssetManager {
  private textureLoader: THREE.TextureLoader;
  private gltfLoader: GLTFLoader;

  // Texture caches
  private biomeTextures: Map<BiomeType, BiomeTextures> = new Map();
  private skyboxTextures: Map<TimeOfDay, SkyboxTextures> = new Map();
  private starsTexture: THREE.Texture | null = null;

  // Model cache
  private models: Map<string, THREE.Object3D> = new Map();

  // Loading state
  private loadingPromises: Map<string, Promise<unknown>> = new Map();

  constructor() {
    this.textureLoader = new THREE.TextureLoader();
    this.gltfLoader = new GLTFLoader();
  }

  /**
   * Preload all biome textures
   */
  async preloadBiomeTextures(): Promise<void> {
    const biomes = Object.values(BiomeType).filter((v) => typeof v === 'number') as BiomeType[];

    console.log('[AssetManager] Preloading textures for biomes:', biomes.map(b => BIOME_NAMES[b]));

    await Promise.all(
      biomes.map((biome) => this.loadBiomeTextures(biome))
    );

    console.log('[AssetManager] Biome textures loaded:', this.biomeTextures.size, 'biomes');
  }

  /**
   * Preload all skybox textures
   */
  async preloadSkyboxTextures(): Promise<void> {
    const times: TimeOfDay[] = ['dawn', 'sunset', 'night'];

    // Load stars texture (shared)
    this.starsTexture = await this.loadTexture(`${TEXTURE_PATH}/skyboxes/stars.png`);
    this.starsTexture.wrapS = THREE.RepeatWrapping;
    this.starsTexture.wrapT = THREE.RepeatWrapping;

    await Promise.all(
      times.map((time) => this.loadSkyboxTextures(time))
    );
  }

  /**
   * Load textures for a specific biome
   */
  async loadBiomeTextures(biome: BiomeType): Promise<BiomeTextures> {
    // Check cache
    const cached = this.biomeTextures.get(biome);
    if (cached) return cached;

    const biomeName = BIOME_NAMES[biome];
    const basePath = `${TEXTURE_PATH}/biomes/${biomeName}`;

    const [ground, detail, height] = await Promise.all([
      this.loadTexture(`${basePath}_ground.png`),
      this.loadTexture(`${basePath}_detail.png`),
      this.loadTexture(`${basePath}_height.png`),
    ]);

    // Configure textures for terrain use
    [ground, detail, height].forEach((tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 4;
    });

    const textures: BiomeTextures = { ground, detail, height };
    this.biomeTextures.set(biome, textures);

    return textures;
  }

  /**
   * Load skybox textures for a time of day
   */
  async loadSkyboxTextures(time: TimeOfDay): Promise<SkyboxTextures> {
    // Check cache
    const cached = this.skyboxTextures.get(time);
    if (cached) return cached;

    const basePath = `${TEXTURE_PATH}/skyboxes`;

    const [sky, clouds] = await Promise.all([
      this.loadTexture(`${basePath}/sky_${time}.png`),
      this.loadTexture(`${basePath}/clouds_${time}.png`),
    ]);

    // Configure textures
    sky.wrapS = THREE.ClampToEdgeWrapping;
    sky.wrapT = THREE.ClampToEdgeWrapping;

    clouds.wrapS = THREE.RepeatWrapping;
    clouds.wrapT = THREE.RepeatWrapping;

    const textures: SkyboxTextures = {
      sky,
      clouds,
      stars: this.starsTexture ?? undefined,
    };
    this.skyboxTextures.set(time, textures);

    return textures;
  }

  /**
   * Get biome textures (must be loaded first)
   */
  getBiomeTextures(biome: BiomeType): BiomeTextures | undefined {
    return this.biomeTextures.get(biome);
  }

  /**
   * Get skybox textures (must be loaded first)
   */
  getSkyboxTextures(time: TimeOfDay): SkyboxTextures | undefined {
    return this.skyboxTextures.get(time);
  }

  /**
   * Get stars texture
   */
  getStarsTexture(): THREE.Texture | null {
    return this.starsTexture;
  }

  /**
   * Load a 3D model
   */
  async loadModel(name: string, category: 'props' | 'npcs' | 'items' = 'items'): Promise<THREE.Object3D> {
    const cacheKey = `${category}/${name}`;

    // Check cache
    const cached = this.models.get(cacheKey);
    if (cached) return cached.clone();

    // Check if already loading
    const loadingPromise = this.loadingPromises.get(cacheKey);
    if (loadingPromise) {
      await loadingPromise;
      const model = this.models.get(cacheKey);
      return model ? model.clone() : new THREE.Object3D();
    }

    const modelPath = `${MODEL_PATH}/${category}/${name}.glb`;

    const promise = new Promise<THREE.Object3D>((resolve, reject) => {
      this.gltfLoader.load(
        modelPath,
        (gltf) => {
          const model = gltf.scene;
          model.name = name;

          // Enable shadows on all meshes
          model.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          this.models.set(cacheKey, model);
          this.loadingPromises.delete(cacheKey);
          resolve(model.clone());
        },
        undefined,
        (error) => {
          console.warn(`Failed to load model ${modelPath}:`, error);
          this.loadingPromises.delete(cacheKey);
          reject(error);
        }
      );
    });

    this.loadingPromises.set(cacheKey, promise);
    return promise;
  }

  /**
   * Create a material for a biome terrain
   */
  createBiomeMaterial(biome: BiomeType): THREE.MeshStandardMaterial {
    const textures = this.biomeTextures.get(biome);

    if (!textures) {
      // Fallback to colored material
      console.warn(`[AssetManager] No textures for biome ${biome} (${BIOME_NAMES[biome]}), using fallback color`);
      return new THREE.MeshStandardMaterial({
        color: this.getBiomeFallbackColor(biome),
        roughness: 0.9,
        metalness: 0,
      });
    }

    console.log(`[AssetManager] Creating textured material for biome ${BIOME_NAMES[biome]}`);
    return new THREE.MeshStandardMaterial({
      map: textures.ground,
      roughness: 0.9,
      metalness: 0,
    });
  }

  /**
   * Get fallback color for biome if textures not loaded
   */
  private getBiomeFallbackColor(biome: BiomeType): number {
    const colors: Record<BiomeType, number> = {
      [BiomeType.Grassland]: 0x4a7c4e,
      [BiomeType.Desert]: 0x8b4513,
      [BiomeType.Forest]: 0x228b22,
      [BiomeType.Snow]: 0xf5f5f5,
      [BiomeType.Swamp]: 0x2f4f4f,
      [BiomeType.Mountain]: 0x808080,
    };
    return colors[biome] ?? 0x808080;
  }

  /**
   * Load a texture with caching
   */
  private loadTexture(path: string): Promise<THREE.Texture> {
    const cacheKey = `texture:${path}`;

    // Check if already loading
    const loadingPromise = this.loadingPromises.get(cacheKey);
    if (loadingPromise) return loadingPromise as Promise<THREE.Texture>;

    const promise = new Promise<THREE.Texture>((resolve, reject) => {
      this.textureLoader.load(
        path,
        (texture) => {
          this.loadingPromises.delete(cacheKey);
          resolve(texture);
        },
        undefined,
        (error) => {
          console.warn(`Failed to load texture ${path}:`, error);
          this.loadingPromises.delete(cacheKey);
          // Return a 1x1 white texture as fallback
          const fallback = new THREE.DataTexture(
            new Uint8Array([255, 255, 255, 255]),
            1,
            1,
            THREE.RGBAFormat
          );
          fallback.needsUpdate = true;
          resolve(fallback);
        }
      );
    });

    this.loadingPromises.set(cacheKey, promise);
    return promise;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    // Dispose biome textures
    for (const textures of this.biomeTextures.values()) {
      textures.ground.dispose();
      textures.detail.dispose();
      textures.height.dispose();
    }
    this.biomeTextures.clear();

    // Dispose skybox textures
    for (const textures of this.skyboxTextures.values()) {
      textures.sky.dispose();
      textures.clouds.dispose();
    }
    this.skyboxTextures.clear();

    if (this.starsTexture) {
      this.starsTexture.dispose();
      this.starsTexture = null;
    }

    // Dispose models
    for (const model of this.models.values()) {
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.geometry.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            mesh.material.dispose();
          }
        }
      });
    }
    this.models.clear();
  }
}

// Singleton instance
export const assetManager = new AssetManager();
