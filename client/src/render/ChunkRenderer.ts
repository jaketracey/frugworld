/**
 * Chunk terrain rendering - Tron-style neon grid world
 * Handles chunk-based terrain mesh generation with smooth rolling hills
 */

import * as THREE from 'three';
import type { ChunkData } from '@/types/protocol.ts';
import { ProceduralTerrainProvider, type TerrainHeightProvider } from '@/terrain/index.ts';
import { BiomeType } from '@/assets/AssetManager.ts';
import { tronMaterialManager, createTronTerrainMaterial } from './TronTerrainMaterial.ts';

export interface ChunkRenderConfig {
  chunkSize: number;   // World units per chunk (default 64m)
  resolution: number;  // Vertices per chunk edge (higher = smoother hills)
  heightScale: number; // Vertical scale of terrain
  useTronStyle: boolean; // Use Tron neon grid (always true now)
}

const DEFAULT_CONFIG: ChunkRenderConfig = {
  chunkSize: 64,
  resolution: 64,      // High resolution for smooth curves
  heightScale: 10,
  useTronStyle: true,
};

export class ChunkRenderer {
  private scene: THREE.Scene;
  private config: ChunkRenderConfig;
  private chunks: Map<string, ChunkRenderData> = new Map();

  // Shared geometry template
  private baseGeometry: THREE.PlaneGeometry;

  // Ground plane for unloaded areas (Tron grid floor)
  private groundPlane: THREE.Mesh;

  // Terrain height provider for physics collision
  private terrainProvider: ProceduralTerrainProvider;

  constructor(scene: THREE.Scene, config: Partial<ChunkRenderConfig> = {}) {
    this.scene = scene;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Create terrain height provider that matches our procedural generation
    this.terrainProvider = new ProceduralTerrainProvider(
      this.config.chunkSize,
      this.config.heightScale
    );

    // Create base geometry (will be cloned and modified per chunk)
    // High resolution for smooth rolling hills
    this.baseGeometry = new THREE.PlaneGeometry(
      this.config.chunkSize,
      this.config.chunkSize,
      this.config.resolution,
      this.config.resolution
    );

    // Create infinite ground plane with Tron grid (base layer below terrain)
    const groundGeometry = new THREE.PlaneGeometry(10000, 10000, 1, 1);

    // Create Tron-style ground material for the void beneath terrain
    const groundMaterial = tronMaterialManager.createMaterial({
      biome: BiomeType.Grassland,
      gridScale: 0.25,        // Larger grid for base layer
      glowIntensity: 0.4,     // Dimmer for background
    });

    this.groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
    this.groundPlane.rotation.x = -Math.PI / 2; // Rotate to lie flat on XZ plane
    this.groundPlane.position.y = -0.5; // Just below terrain minimum (0)
    this.groundPlane.receiveShadow = false; // No shadows on Tron grid
    this.scene.add(this.groundPlane);
  }

  /**
   * Generate chunk key from coordinates
   */
  static chunkKey(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  /**
   * Load or update a chunk
   */
  loadChunk(data: ChunkData): void {
    const key = ChunkRenderer.chunkKey(data.cx, data.cy);

    // Check if already loaded
    if (this.chunks.has(key)) {
      return;
    }

    // Register chunk seed with terrain provider for physics
    this.terrainProvider.setChunkSeed(data.cx, data.cy, data.seed);

    const mesh = this.createChunkMesh(data);
    this.scene.add(mesh);

    this.chunks.set(key, {
      cx: data.cx,
      cy: data.cy,
      mesh,
      biome: data.biome,
    });
  }

  /**
   * Unload a chunk
   */
  unloadChunk(cx: number, cy: number): void {
    const key = ChunkRenderer.chunkKey(cx, cy);
    const chunk = this.chunks.get(key);

    if (chunk) {
      this.scene.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      (chunk.mesh.material as THREE.Material).dispose();
      this.chunks.delete(key);

      // Remove from terrain provider
      this.terrainProvider.removeChunkSeed(cx, cy);
    }
  }

  /**
   * Check if chunk is loaded
   */
  isChunkLoaded(cx: number, cy: number): boolean {
    return this.chunks.has(ChunkRenderer.chunkKey(cx, cy));
  }

  /**
   * Get loaded chunk count
   */
  getLoadedCount(): number {
    return this.chunks.size;
  }

  /**
   * Get the terrain height provider for physics collision
   */
  getTerrainProvider(): TerrainHeightProvider {
    return this.terrainProvider;
  }

  /**
   * Clear all chunks
   */
  clear(): void {
    for (const [_key, chunk] of this.chunks) {
      this.scene.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      (chunk.mesh.material as THREE.Material).dispose();
    }
    this.chunks.clear();
    this.terrainProvider.clear();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createChunkMesh(data: ChunkData): THREE.Mesh {
    // Clone base geometry
    const geometry = this.baseGeometry.clone();

    // Apply smooth rolling hill height map using terrain provider
    this.applyHeightMap(geometry, data.cx, data.cy);

    // Rotate to XZ plane (Three.js: Y is up)
    geometry.rotateX(-Math.PI / 2);

    // Create Tron-style material for this biome
    const biomeType = data.biome as BiomeType;
    const material = tronMaterialManager.createMaterial({
      biome: biomeType,
      gridScale: 0.5,
      glowIntensity: 1.0,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = false; // Tron style doesn't use traditional shadows
    mesh.castShadow = false;

    // Position chunk in world
    const halfChunk = this.config.chunkSize / 2;
    const worldX = data.cx * this.config.chunkSize + halfChunk;
    const worldY = data.cy * this.config.chunkSize + halfChunk;
    mesh.position.set(worldX, 0, worldY);

    mesh.name = `chunk_${data.cx}_${data.cy}`;

    return mesh;
  }

  /**
   * Apply smooth rolling hills height map using terrain provider
   * This ensures visual mesh matches physics collision exactly
   */
  private applyHeightMap(geometry: THREE.PlaneGeometry, cx: number, cy: number): void {
    const positions = geometry.attributes.position;
    const count = positions.count;
    const halfChunk = this.config.chunkSize / 2;

    // Calculate world offset for this chunk
    const worldOffsetX = cx * this.config.chunkSize + halfChunk;
    const worldOffsetY = cy * this.config.chunkSize + halfChunk;

    for (let i = 0; i < count; i++) {
      // Get local geometry position
      const localX = positions.getX(i);
      const localY = positions.getY(i);

      // Convert to world coordinates
      const worldX = worldOffsetX + localX;
      const worldY = worldOffsetY + localY;

      // Get height from terrain provider (ensures physics/visuals match)
      const height = this.terrainProvider.getHeightAt(worldX, worldY);

      positions.setZ(i, height);
    }

    geometry.computeVertexNormals();
    positions.needsUpdate = true;
  }

  /**
   * Update all Tron materials (call each frame for animation)
   */
  update(deltaTime: number): void {
    tronMaterialManager.update(deltaTime);
  }

  /**
   * Preload - no textures needed for Tron style
   */
  async preloadTextures(): Promise<void> {
    // Tron style uses procedural shaders, no textures to preload
    console.log('[ChunkRenderer] Tron-style terrain initialized');
  }

  /**
   * Refresh chunk materials (for biome changes)
   */
  refreshChunkMaterials(): void {
    for (const [_key, chunk] of this.chunks) {
      const biomeType = chunk.biome as BiomeType;
      const oldMaterial = chunk.mesh.material as THREE.ShaderMaterial;
      tronMaterialManager.remove(oldMaterial);
      oldMaterial.dispose();

      const newMaterial = tronMaterialManager.createMaterial({
        biome: biomeType,
        gridScale: 0.5,
        glowIntensity: 1.0,
      });
      chunk.mesh.material = newMaterial;
    }
    console.log(`[ChunkRenderer] Refreshed Tron materials for ${this.chunks.size} chunks`);
  }
}

interface ChunkRenderData {
  cx: number;
  cy: number;
  mesh: THREE.Mesh;
  biome: number;
}
