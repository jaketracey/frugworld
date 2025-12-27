/**
 * NPC Model Manager
 * Handles loading, caching, and cloning of NPC character models
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { NPCType } from '@/npc/NPCTypes.ts';
import {
  getVisualConfig,
  getUniqueModelNames,
  NPCModelConfig,
} from '@/npc/NPCVisualConfig.ts';

interface LoadedModel {
  scene: THREE.Object3D;
  billboard: THREE.Texture;
  config: NPCModelConfig;
}

/**
 * Manages loading and caching of NPC GLB models
 */
export class NPCModelManager {
  private gltfLoader: GLTFLoader;
  private textureLoader: THREE.TextureLoader;

  // Model cache by model name
  private modelCache: Map<string, THREE.Object3D> = new Map();

  // Billboard texture cache by texture name
  private billboardCache: Map<string, THREE.Texture> = new Map();

  // Loading promises to prevent duplicate loads
  private loadingPromises: Map<string, Promise<THREE.Object3D>> = new Map();
  private billboardLoadingPromises: Map<string, Promise<THREE.Texture>> = new Map();

  // Track which models we've already warned about to reduce spam
  private warnedModels: Set<string> = new Set();

  // Fallback capsule geometry and material
  private fallbackGeometry: THREE.CapsuleGeometry;
  private fallbackMaterial: THREE.MeshStandardMaterial;

  constructor() {
    this.gltfLoader = new GLTFLoader();
    this.textureLoader = new THREE.TextureLoader();

    // Create fallback capsule (for when models fail to load)
    this.fallbackGeometry = new THREE.CapsuleGeometry(0.4, 1.2, 4, 8);
    this.fallbackMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a7c4e,
      roughness: 0.8,
      metalness: 0.1,
      flatShading: true, // PS1 style
    });
  }

  /**
   * Preload all unique NPC models
   */
  async preloadAll(): Promise<void> {
    const modelNames = getUniqueModelNames();

    console.log(`[NPCModelManager] Preloading ${modelNames.length} NPC models...`);

    await Promise.all(
      modelNames.map((name) => this.loadModel(name))
    );

    // Also preload billboard textures
    const billboardNames = new Set<string>();
    for (const type of Object.values(NPCType)) {
      const config = getVisualConfig(type as NPCType);
      billboardNames.add(config.billboardTexture);
    }

    await Promise.all(
      Array.from(billboardNames).map((name) => this.loadBillboardTexture(name))
    );

    console.log(`[NPCModelManager] Preloaded ${this.modelCache.size} models, ${this.billboardCache.size} billboards`);
  }

  /**
   * Load a single model by name
   */
  async loadModel(modelName: string): Promise<THREE.Object3D> {
    // Check cache
    if (this.modelCache.has(modelName)) {
      return this.modelCache.get(modelName)!;
    }

    // Check if already loading
    if (this.loadingPromises.has(modelName)) {
      return this.loadingPromises.get(modelName)!;
    }

    const promise = this.loadModelInternal(modelName);
    this.loadingPromises.set(modelName, promise);

    try {
      const model = await promise;
      this.modelCache.set(modelName, model);
      return model;
    } finally {
      this.loadingPromises.delete(modelName);
    }
  }

  /**
   * Load a billboard texture
   */
  async loadBillboardTexture(textureName: string): Promise<THREE.Texture> {
    // Check cache
    if (this.billboardCache.has(textureName)) {
      return this.billboardCache.get(textureName)!;
    }

    // Check if already loading
    if (this.billboardLoadingPromises.has(textureName)) {
      return this.billboardLoadingPromises.get(textureName)!;
    }

    const promise = this.loadBillboardInternal(textureName);
    this.billboardLoadingPromises.set(textureName, promise);

    try {
      const texture = await promise;
      this.billboardCache.set(textureName, texture);
      return texture;
    } finally {
      this.billboardLoadingPromises.delete(textureName);
    }
  }

  /**
   * Clone a model for a specific NPC entity
   */
  cloneForEntity(npcType: NPCType): THREE.Object3D {
    const config = getVisualConfig(npcType);
    const cachedModel = this.modelCache.get(config.modelName);

    if (!cachedModel) {
      // Return fallback capsule - only warn once per model to reduce spam
      if (!this.warnedModels.has(config.modelName)) {
        console.warn(`[NPCModelManager] Model ${config.modelName} not loaded, using fallback capsule`);
        this.warnedModels.add(config.modelName);
      }
      return this.createFallbackMesh(config);
    }

    // Clone the model
    const clone = cachedModel.clone();

    // Apply scale
    clone.scale.setScalar(config.scale);

    // Apply Y offset
    clone.position.y = config.yOffset;

    // NOTE: Tint colors disabled - AI-generated models have their own textures
    // Tinting multiplies colors which makes textured models look wrong
    // if (config.tintColor !== undefined) {
    //   this.applyTintColor(clone, config.tintColor);
    // }

    // Setup shadow casting - flatShading is already set during model loading
    // Material cloning is done lazily only when opacity changes are needed
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });

    return clone;
  }

  /**
   * Get billboard texture for an NPC type
   */
  getBillboardTexture(npcType: NPCType): THREE.Texture | null {
    const config = getVisualConfig(npcType);
    return this.billboardCache.get(config.billboardTexture) ?? null;
  }

  /**
   * Get configuration for an NPC type
   */
  getConfig(npcType: NPCType): NPCModelConfig {
    return getVisualConfig(npcType);
  }

  /**
   * Check if all models are loaded
   */
  isFullyLoaded(): boolean {
    const modelNames = getUniqueModelNames();
    return modelNames.every((name) => this.modelCache.has(name));
  }

  /**
   * Dispose all cached models and textures
   */
  dispose(): void {
    // Dispose models
    for (const model of this.modelCache.values()) {
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
    this.modelCache.clear();

    // Dispose textures
    for (const texture of this.billboardCache.values()) {
      texture.dispose();
    }
    this.billboardCache.clear();

    // Dispose fallback
    this.fallbackGeometry.dispose();
    this.fallbackMaterial.dispose();

    // Clear warned set
    this.warnedModels.clear();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private loadModelInternal(modelName: string): Promise<THREE.Object3D> {
    return new Promise((resolve) => {
      const modelPath = `/assets/models/npcs/${modelName}.glb`;

      this.gltfLoader.load(
        modelPath,
        (gltf) => {
          const model = gltf.scene;
          model.name = modelName;

          // Calculate bounding box for debugging
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          console.log(`[NPCModelManager] Model ${modelName} size: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`);

          // Apply PS1 style to all meshes
          model.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;

              // Handle array of materials
              const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

              materials.forEach((mat, i) => {
                if (mat instanceof THREE.MeshStandardMaterial) {
                  // Log material details for debugging
                  console.log(`[NPCModelManager] ${modelName}: material color=${mat.color.getHexString()}, map=${!!mat.map}, emissive=${mat.emissive.getHexString()}`);

                  // Ensure material is visible - if no texture and color is black, set a default color
                  if (!mat.map && mat.color.getHex() === 0x000000) {
                    mat.color.setHex(0x8a8a8a); // Light grey fallback
                  }

                  // If there's a texture, make sure color doesn't darken it
                  if (mat.map) {
                    mat.color.setHex(0xffffff); // White so texture shows correctly
                  }

                  mat.flatShading = true;
                  mat.roughness = 0.9;
                  mat.metalness = 0.0;
                  mat.needsUpdate = true;
                } else {
                  // Replace non-standard materials with a visible one
                  console.log(`[NPCModelManager] ${modelName}: replacing material type ${mat.type}`);
                  const newMat = new THREE.MeshStandardMaterial({
                    color: 0x7a9a7a, // Default greenish color
                    roughness: 0.9,
                    metalness: 0.0,
                    flatShading: true,
                  });
                  if (Array.isArray(mesh.material)) {
                    mesh.material[i] = newMat;
                  } else {
                    mesh.material = newMat;
                  }
                }
              });

              mesh.castShadow = true;
              mesh.receiveShadow = true;
            }
          });

          console.log(`[NPCModelManager] Loaded model: ${modelName}`);
          resolve(model);
        },
        undefined,
        (error) => {
          console.warn(`[NPCModelManager] Failed to load model ${modelPath}:`, error);
          // Return a basic fallback model
          resolve(this.createBaseFallbackMesh());
        }
      );
    });
  }

  private loadBillboardInternal(textureName: string): Promise<THREE.Texture> {
    return new Promise((resolve) => {
      const texturePath = `/assets/textures/npcs/billboards/${textureName}.png`;

      this.textureLoader.load(
        texturePath,
        (texture) => {
          texture.magFilter = THREE.NearestFilter; // PS1 pixelated look
          texture.minFilter = THREE.NearestMipmapLinearFilter;
          console.log(`[NPCModelManager] Loaded billboard: ${textureName}`);
          resolve(texture);
        },
        undefined,
        () => {
          console.warn(`[NPCModelManager] Failed to load billboard ${texturePath}, using fallback`);
          resolve(this.createFallbackBillboard());
        }
      );
    });
  }

  private createFallbackMesh(config: NPCModelConfig): THREE.Mesh {
    const mesh = new THREE.Mesh(
      this.fallbackGeometry.clone(),
      this.fallbackMaterial.clone()
    );
    mesh.scale.setScalar(config.scale);
    mesh.position.y = config.yOffset + 0.8; // Center capsule

    if (config.tintColor !== undefined) {
      (mesh.material as THREE.MeshStandardMaterial).color.set(config.tintColor);
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private createBaseFallbackMesh(): THREE.Object3D {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      this.fallbackGeometry.clone(),
      this.fallbackMaterial.clone()
    );
    mesh.position.y = 0.8; // Center capsule
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return group;
  }

  private createFallbackBillboard(): THREE.Texture {
    // Create a simple colored texture
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size * 2;
    const ctx = canvas.getContext('2d')!;

    // Simple humanoid silhouette
    ctx.fillStyle = '#4a7c4e';
    // Head
    ctx.beginPath();
    ctx.arc(size / 2, size / 4, size / 4, 0, Math.PI * 2);
    ctx.fill();
    // Body
    ctx.fillRect(size / 4, size / 2, size / 2, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    return texture;
  }

  private applyTintColor(model: THREE.Object3D, color: number): void {
    const tintColor = new THREE.Color(color);

    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.material instanceof THREE.MeshStandardMaterial) {
          // Multiply existing color with tint
          mesh.material.color.multiply(tintColor);
        }
      }
    });
  }
}

// Singleton instance
export const npcModelManager = new NPCModelManager();
