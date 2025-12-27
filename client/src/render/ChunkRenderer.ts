/**
 * Chunk terrain rendering - PS1/PS2 Crash Bandicoot style
 * Handles chunk-based terrain mesh generation with precomputed heightmaps
 */

import * as THREE from 'three';
import type { ChunkData } from '@/types/protocol.ts';
import {
  CachedTerrainProvider,
  ProceduralTerrainProvider,
  HeightmapCacheManager,
  type TerrainHeightProvider,
  type HeightmapData,
  getInterpolatedHeight,
  CHUNK_SIZE,
} from '@/terrain/index.ts';
import { BiomeType } from '@/assets/AssetManager.ts';
import { retroMaterialManager, RETRO_BIOME_COLORS } from './RetroTerrainMaterial.ts';
import { FoliageRenderer } from './FoliageRenderer.ts';

export interface ChunkRenderConfig {
  chunkSize: number;      // World units per chunk (default 64m)
  resolution: number;     // Vertices per chunk edge (higher = smoother hills)
  heightScale: number;    // Vertical scale of terrain
  useFlatTerrain: boolean;   // Use flat terrain (no hills)
  useRetroStyle: boolean;    // Use PS1/PS2 retro materials
}

const DEFAULT_CONFIG: ChunkRenderConfig = {
  chunkSize: 64,
  resolution: 32,         // Higher resolution for rolling terrain (32x32)
  heightScale: 10,
  useFlatTerrain: false,  // Enable rolling hills by default
  useRetroStyle: true,    // Use retro PS1 style
};

export class ChunkRenderer {
  private scene: THREE.Scene;
  private config: ChunkRenderConfig;
  private chunks: Map<string, ChunkRenderData> = new Map();

  // Shared geometry template
  private baseGeometry: THREE.PlaneGeometry;

  // Ground plane for unloaded areas
  private groundPlane: THREE.Mesh;

  // Heightmap cache manager for precomputed terrain
  private cacheManager: HeightmapCacheManager;

  // Terrain height provider for physics collision (uses cache)
  private terrainProvider: CachedTerrainProvider;

  // Fallback procedural provider
  private proceduralProvider: ProceduralTerrainProvider;

  // Foliage billboard renderer
  private foliageRenderer: FoliageRenderer;

  // Track chunk seeds for preloading
  private chunkSeeds: Map<string, { seed: number; biome: number }> = new Map();

  constructor(
    scene: THREE.Scene,
    cacheManager?: HeightmapCacheManager,
    config: Partial<ChunkRenderConfig> = {}
  ) {
    this.scene = scene;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Use provided cache manager or create new one
    this.cacheManager = cacheManager ?? new HeightmapCacheManager({
      resolution: this.config.resolution,
      heightScale: this.config.heightScale,
    });

    // Create cached terrain provider that uses the cache manager
    this.terrainProvider = new CachedTerrainProvider(
      this.cacheManager,
      this.config.chunkSize
    );

    // Keep procedural provider for fallback
    this.proceduralProvider = new ProceduralTerrainProvider(
      this.config.chunkSize,
      this.config.heightScale
    );

    // Create base geometry (will be cloned and modified per chunk)
    // Higher resolution for smooth rolling hills (32x32)
    this.baseGeometry = new THREE.PlaneGeometry(
      this.config.chunkSize,
      this.config.chunkSize,
      this.config.resolution,
      this.config.resolution
    );

    // Create infinite ground plane (solid dark color beneath terrain)
    const groundGeometry = new THREE.PlaneGeometry(10000, 10000, 1, 1);

    // Simple solid color ground for the void beneath terrain
    const groundMaterial = new THREE.MeshBasicMaterial({
      color: 0x1a2a1a,  // Dark green-ish for void
      side: THREE.DoubleSide,
    });

    this.groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
    this.groundPlane.rotation.x = -Math.PI / 2; // Rotate to lie flat on XZ plane
    this.groundPlane.position.y = -1; // Below terrain minimum
    this.groundPlane.receiveShadow = true;
    this.scene.add(this.groundPlane);

    // Create foliage renderer for billboard grass/plants
    this.foliageRenderer = new FoliageRenderer(scene, this.config.chunkSize);
  }

  /**
   * Initialize the cache manager (should be called before loading chunks)
   */
  async initialize(): Promise<void> {
    await this.cacheManager.initialize();
  }

  /**
   * Get the heightmap cache manager
   */
  getCacheManager(): HeightmapCacheManager {
    return this.cacheManager;
  }

  /**
   * Generate chunk key from coordinates
   */
  static chunkKey(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  /**
   * Load or update a chunk
   * Triggers async heightmap generation if not cached
   */
  loadChunk(data: ChunkData): void {
    const key = ChunkRenderer.chunkKey(data.cx, data.cy);

    // Check if already loaded
    if (this.chunks.has(key)) {
      return;
    }

    // Store seed for preloading
    this.chunkSeeds.set(key, { seed: data.seed, biome: data.biome });

    // Register with procedural provider as fallback
    this.proceduralProvider.setChunkSeed(data.cx, data.cy, data.seed);

    // Trigger async heightmap generation (don't await)
    this.cacheManager.getHeightmap(data.cx, data.cy, data.seed, data.biome).catch((err) => {
      console.warn(`[ChunkRenderer] Heightmap generation failed for ${key}:`, err);
    });

    // Create mesh (may use procedural if cache not ready yet)
    const mesh = this.createChunkMesh(data);
    this.scene.add(mesh);

    // Spawn foliage billboards for this chunk
    const biomeType = data.biome as BiomeType;
    this.foliageRenderer.spawnFoliageForChunk(data.cx, data.cy, biomeType, data.seed);

    this.chunks.set(key, {
      cx: data.cx,
      cy: data.cy,
      mesh,
      biome: data.biome,
      seed: data.seed,
    });
  }

  /**
   * Load chunk with async heightmap (waits for generation)
   */
  async loadChunkAsync(data: ChunkData): Promise<void> {
    const key = ChunkRenderer.chunkKey(data.cx, data.cy);

    if (this.chunks.has(key)) return;

    // Store seed
    this.chunkSeeds.set(key, { seed: data.seed, biome: data.biome });

    // Wait for heightmap to be ready
    const heightmap = await this.cacheManager.getHeightmap(
      data.cx, data.cy, data.seed, data.biome
    );

    // Create mesh with cached heightmap
    const mesh = this.createChunkMeshWithHeightmap(data, heightmap);
    this.scene.add(mesh);

    const biomeType = data.biome as BiomeType;
    this.foliageRenderer.spawnFoliageForChunk(data.cx, data.cy, biomeType, data.seed);

    this.chunks.set(key, {
      cx: data.cx,
      cy: data.cy,
      mesh,
      biome: data.biome,
      seed: data.seed,
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

      // Remove foliage for this chunk
      this.foliageRenderer.removeFoliageForChunk(cx, cy);

      // Remove from procedural provider
      this.proceduralProvider.removeChunkSeed(cx, cy);

      // Remove from seed tracking
      this.chunkSeeds.delete(key);

      // Unload from cache manager (optional, for memory management)
      this.cacheManager.unload(cx, cy);
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
    this.foliageRenderer.clear();
    this.proceduralProvider.clear();
    this.chunkSeeds.clear();
  }

  /**
   * Get chunk seeds for preloading
   */
  getChunkSeeds(): Map<string, { seed: number; biome: number }> {
    return this.chunkSeeds;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createChunkMesh(data: ChunkData): THREE.Mesh {
    // Clone base geometry
    const geometry = this.baseGeometry.clone();

    // Try to get cached heightmap
    const heightmap = this.cacheManager.getHeightmapSync(data.cx, data.cy);

    // Apply height map only if not using flat terrain
    if (!this.config.useFlatTerrain) {
      if (heightmap) {
        this.applyHeightMapFromCache(geometry, data.cx, data.cy, heightmap);
      } else {
        this.applyHeightMap(geometry, data.cx, data.cy);
      }
    }

    // Rotate to XZ plane (Three.js: Y is up)
    geometry.rotateX(-Math.PI / 2);

    // Create PS1-style retro material for this biome
    const biomeType = data.biome as BiomeType;
    const material = retroMaterialManager.createShaderMaterial({
      biome: biomeType,
      textureScale: 1.0,  // Texture repeats per world unit (higher = more tiling)
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
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
   * Create chunk mesh with precomputed heightmap
   */
  private createChunkMeshWithHeightmap(data: ChunkData, heightmap: HeightmapData): THREE.Mesh {
    const geometry = this.baseGeometry.clone();

    if (!this.config.useFlatTerrain) {
      this.applyHeightMapFromCache(geometry, data.cx, data.cy, heightmap);
    }

    geometry.rotateX(-Math.PI / 2);

    const biomeType = data.biome as BiomeType;
    const material = retroMaterialManager.createShaderMaterial({
      biome: biomeType,
      textureScale: 1.0,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;

    const halfChunk = this.config.chunkSize / 2;
    const worldX = data.cx * this.config.chunkSize + halfChunk;
    const worldY = data.cy * this.config.chunkSize + halfChunk;
    mesh.position.set(worldX, 0, worldY);

    mesh.name = `chunk_${data.cx}_${data.cy}`;

    return mesh;
  }

  /**
   * Apply smooth rolling hills height map using procedural provider (fallback)
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

      // Get height from procedural provider (fallback)
      const height = this.proceduralProvider.getHeightAt(worldX, worldY);

      positions.setZ(i, height);
    }

    geometry.computeVertexNormals();
    positions.needsUpdate = true;
  }

  /**
   * Apply height map from cached heightmap data
   * Uses bilinear interpolation for smooth results
   */
  private applyHeightMapFromCache(
    geometry: THREE.PlaneGeometry,
    cx: number,
    cy: number,
    heightmap: HeightmapData
  ): void {
    const positions = geometry.attributes.position;
    const count = positions.count;
    const halfChunk = this.config.chunkSize / 2;

    for (let i = 0; i < count; i++) {
      // Get local geometry position (geometry is centered at origin)
      const localX = positions.getX(i);
      const localY = positions.getY(i);

      // Convert to local chunk space (0 to chunkSize)
      const chunkLocalX = localX + halfChunk;
      const chunkLocalY = localY + halfChunk;

      // Get height from cached heightmap with interpolation
      const height = getInterpolatedHeight(heightmap, chunkLocalX, chunkLocalY, this.config.chunkSize);

      positions.setZ(i, height);
    }

    geometry.computeVertexNormals();
    positions.needsUpdate = true;
  }

  /**
   * Update terrain and foliage (call each frame)
   */
  update(_deltaTime: number, camera?: THREE.Camera): void {
    // Update foliage billboards to face camera
    if (camera) {
      this.foliageRenderer.update(camera);
    }
  }

  /**
   * Preload terrain and foliage textures for all biomes
   */
  async preloadTextures(): Promise<void> {
    await Promise.all([
      retroMaterialManager.preloadTextures(),
      this.foliageRenderer.preloadTextures(),
    ]);
    console.log('[ChunkRenderer] PS1-style terrain and foliage textures loaded');
  }

  /**
   * Refresh chunk materials (for biome changes)
   */
  refreshChunkMaterials(): void {
    for (const [_key, chunk] of this.chunks) {
      const biomeType = chunk.biome as BiomeType;
      const oldMaterial = chunk.mesh.material as THREE.Material;
      retroMaterialManager.remove(oldMaterial);
      oldMaterial.dispose();

      const newMaterial = retroMaterialManager.createShaderMaterial({
        biome: biomeType,
        textureScale: 1.0,
      });
      chunk.mesh.material = newMaterial;
    }
    console.log(`[ChunkRenderer] Refreshed retro materials for ${this.chunks.size} chunks`);
  }
}

interface ChunkRenderData {
  cx: number;
  cy: number;
  mesh: THREE.Mesh;
  biome: number;
  seed?: number;
}
