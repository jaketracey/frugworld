/**
 * Foliage Billboard Renderer
 * Renders scattered 2D billboard grass, plants, and flowers per chunk
 * Uses instanced meshes for performance
 */

import * as THREE from 'three';
import { BiomeType, BIOME_NAMES } from '@/assets/AssetManager.ts';

// Foliage density per biome (instances per chunk)
const FOLIAGE_DENSITY: Record<BiomeType, { grass: number; flowers: number }> = {
  [BiomeType.Grassland]: { grass: 80, flowers: 15 },
  [BiomeType.Desert]: { grass: 8, flowers: 0 },
  [BiomeType.Forest]: { grass: 100, flowers: 10 },
  [BiomeType.Snow]: { grass: 25, flowers: 0 },
  [BiomeType.Swamp]: { grass: 50, flowers: 5 },
  [BiomeType.Mountain]: { grass: 15, flowers: 3 },
};

// Foliage billboard sizes (width, height)
const FOLIAGE_SIZES = {
  grass: { width: 0.8, height: 1.2 },
  flower: { width: 0.5, height: 0.6 },
};

interface ChunkFoliage {
  cx: number;
  cy: number;
  grassMesh: THREE.InstancedMesh | null;
  flowerMesh: THREE.InstancedMesh | null;
}

/**
 * Simple seeded random number generator
 */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export class FoliageRenderer {
  private scene: THREE.Scene;
  private chunkFoliage: Map<string, ChunkFoliage> = new Map();
  private textureLoader: THREE.TextureLoader;

  // Cached textures per biome
  private grassTextures: Map<BiomeType, THREE.Texture> = new Map();
  private flowerTextures: THREE.Texture[] = [];

  // Shared geometries
  private billboardGeometry: THREE.PlaneGeometry;

  // Chunk configuration
  private chunkSize: number;

  constructor(scene: THREE.Scene, chunkSize: number = 64) {
    this.scene = scene;
    this.chunkSize = chunkSize;
    this.textureLoader = new THREE.TextureLoader();

    // Create shared billboard geometry
    this.billboardGeometry = new THREE.PlaneGeometry(1, 1);
  }

  /**
   * Preload all foliage textures
   */
  async preloadTextures(): Promise<void> {
    console.log('[FoliageRenderer] Preloading foliage textures...');

    const biomes = Object.values(BiomeType).filter((v) => typeof v === 'number') as BiomeType[];

    // Load grass textures for each biome
    await Promise.all(
      biomes.map((biome) => this.loadGrassTexture(biome))
    );

    // Load flower textures
    await this.loadFlowerTextures();

    console.log('[FoliageRenderer] Foliage textures loaded');
  }

  /**
   * Spawn foliage for a chunk
   */
  spawnFoliageForChunk(cx: number, cy: number, biome: BiomeType, seed: number): void {
    const key = this.chunkKey(cx, cy);

    // Don't spawn if already exists
    if (this.chunkFoliage.has(key)) {
      return;
    }

    const density = FOLIAGE_DENSITY[biome];
    // Guard against unknown biome types
    if (!density) {
      return;
    }

    const random = seededRandom(seed);

    // Calculate world offset for this chunk
    const worldOffsetX = cx * this.chunkSize;
    const worldOffsetZ = cy * this.chunkSize;

    // Create grass instances
    const grassMesh = this.createFoliageInstances(
      biome,
      'grass',
      density.grass,
      worldOffsetX,
      worldOffsetZ,
      random
    );

    // Create flower instances
    const flowerMesh = density.flowers > 0
      ? this.createFlowerInstances(density.flowers, worldOffsetX, worldOffsetZ, random)
      : null;

    // Add to scene
    if (grassMesh) this.scene.add(grassMesh);
    if (flowerMesh) this.scene.add(flowerMesh);

    this.chunkFoliage.set(key, {
      cx,
      cy,
      grassMesh,
      flowerMesh,
    });
  }

  /**
   * Remove foliage for a chunk
   */
  removeFoliageForChunk(cx: number, cy: number): void {
    const key = this.chunkKey(cx, cy);
    const foliage = this.chunkFoliage.get(key);

    if (foliage) {
      if (foliage.grassMesh) {
        this.scene.remove(foliage.grassMesh);
        foliage.grassMesh.geometry.dispose();
        (foliage.grassMesh.material as THREE.Material).dispose();
      }
      if (foliage.flowerMesh) {
        this.scene.remove(foliage.flowerMesh);
        foliage.flowerMesh.geometry.dispose();
        (foliage.flowerMesh.material as THREE.Material).dispose();
      }
      this.chunkFoliage.delete(key);
    }
  }

  /**
   * Update billboard rotations to face camera
   */
  update(camera: THREE.Camera): void {
    // Get camera's Y rotation (yaw) for billboarding
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    const yaw = Math.atan2(cameraDirection.x, cameraDirection.z);

    // Update all foliage to face camera (Y-axis only billboarding)
    for (const foliage of this.chunkFoliage.values()) {
      if (foliage.grassMesh) {
        foliage.grassMesh.rotation.y = yaw + Math.PI;
      }
      if (foliage.flowerMesh) {
        foliage.flowerMesh.rotation.y = yaw + Math.PI;
      }
    }
  }

  /**
   * Clear all foliage
   */
  clear(): void {
    for (const [key] of this.chunkFoliage) {
      const [cx, cy] = key.split(',').map(Number);
      this.removeFoliageForChunk(cx, cy);
    }
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.clear();
    this.billboardGeometry.dispose();

    for (const texture of this.grassTextures.values()) {
      texture.dispose();
    }
    this.grassTextures.clear();

    for (const texture of this.flowerTextures) {
      texture.dispose();
    }
    this.flowerTextures = [];
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private chunkKey(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  private async loadGrassTexture(biome: BiomeType): Promise<void> {
    const biomeName = BIOME_NAMES[biome];
    const texturePath = `/assets/textures/foliage/${biomeName}_grass.png`;

    return new Promise((resolve) => {
      this.textureLoader.load(
        texturePath,
        (texture) => {
          texture.magFilter = THREE.NearestFilter; // PS1 pixelated look
          texture.minFilter = THREE.NearestMipmapLinearFilter;
          this.grassTextures.set(biome, texture);
          resolve();
        },
        undefined,
        () => {
          // Create fallback green texture
          console.warn(`[FoliageRenderer] Failed to load grass texture for ${biomeName}`);
          const fallback = this.createFallbackTexture(0x5a8f3a);
          this.grassTextures.set(biome, fallback);
          resolve();
        }
      );
    });
  }

  private async loadFlowerTextures(): Promise<void> {
    const flowerNames = ['flower_red', 'flower_yellow', 'flower_purple'];

    await Promise.all(
      flowerNames.map((name) =>
        new Promise<void>((resolve) => {
          this.textureLoader.load(
            `/assets/textures/foliage/${name}.png`,
            (texture) => {
              texture.magFilter = THREE.NearestFilter;
              texture.minFilter = THREE.NearestMipmapLinearFilter;
              this.flowerTextures.push(texture);
              resolve();
            },
            undefined,
            () => {
              // Create fallback colored texture
              const colors = { flower_red: 0xff4444, flower_yellow: 0xffff44, flower_purple: 0xaa44ff };
              const fallback = this.createFallbackTexture(colors[name as keyof typeof colors] || 0xff00ff);
              this.flowerTextures.push(fallback);
              resolve();
            }
          );
        })
      )
    );
  }

  private createFallbackTexture(color: number): THREE.DataTexture {
    const c = new THREE.Color(color);
    // Create a simple 4x4 texture with alpha
    const size = 4;
    const data = new Uint8Array(size * size * 4);

    for (let i = 0; i < size * size; i++) {
      const stride = i * 4;
      // Center pixels are opaque, edges are transparent
      const x = i % size;
      const y = Math.floor(i / size);
      const isCenter = x > 0 && x < size - 1 && y > 0 && y < size - 1;

      data[stride] = Math.floor(c.r * 255);
      data[stride + 1] = Math.floor(c.g * 255);
      data[stride + 2] = Math.floor(c.b * 255);
      data[stride + 3] = isCenter ? 255 : 0;
    }

    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return texture;
  }

  private createFoliageInstances(
    biome: BiomeType,
    type: 'grass' | 'flower',
    count: number,
    worldOffsetX: number,
    worldOffsetZ: number,
    random: () => number
  ): THREE.InstancedMesh | null {
    if (count === 0) return null;

    const texture = this.grassTextures.get(biome);
    if (!texture) return null;

    const size = FOLIAGE_SIZES[type];
    const geometry = this.billboardGeometry.clone();
    geometry.scale(size.width, size.height, 1);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = true;

    // Position each instance randomly within the chunk
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();

    for (let i = 0; i < count; i++) {
      // Random position within chunk
      const x = worldOffsetX + random() * this.chunkSize;
      const z = worldOffsetZ + random() * this.chunkSize;
      const y = size.height / 2; // Half height above ground

      position.set(x, y, z);

      // Slight random scale variation
      const scaleVar = 0.7 + random() * 0.6;
      scale.set(scaleVar, scaleVar, scaleVar);

      // No rotation initially (handled in update for billboarding)
      quaternion.identity();

      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = `foliage_${type}_${worldOffsetX}_${worldOffsetZ}`;

    return mesh;
  }

  private createFlowerInstances(
    count: number,
    worldOffsetX: number,
    worldOffsetZ: number,
    random: () => number
  ): THREE.InstancedMesh | null {
    if (count === 0 || this.flowerTextures.length === 0) return null;

    // Pick a random flower texture
    const textureIndex = Math.floor(random() * this.flowerTextures.length);
    const texture = this.flowerTextures[textureIndex];

    const size = FOLIAGE_SIZES.flower;
    const geometry = this.billboardGeometry.clone();
    geometry.scale(size.width, size.height, 1);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = true;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();

    for (let i = 0; i < count; i++) {
      const x = worldOffsetX + random() * this.chunkSize;
      const z = worldOffsetZ + random() * this.chunkSize;
      const y = size.height / 2;

      position.set(x, y, z);

      const scaleVar = 0.6 + random() * 0.8;
      scale.set(scaleVar, scaleVar, scaleVar);

      quaternion.identity();

      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = `foliage_flower_${worldOffsetX}_${worldOffsetZ}`;

    return mesh;
  }
}
