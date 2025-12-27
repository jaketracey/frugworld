/**
 * Retro PS1/PS2 style terrain material
 * Creates a Crash Bandicoot-inspired aesthetic with simple textures and flat shading
 */

import * as THREE from 'three';
import { BiomeType, BIOME_NAMES } from '@/assets/AssetManager.ts';

// PS1-style color palette per biome (bright, saturated, limited palette)
export const RETRO_BIOME_COLORS: Record<BiomeType, {
  primary: number;    // Main ground color
  secondary: number;  // Darker accent
  highlight: number;  // Bright spots
}> = {
  [BiomeType.Grassland]: {
    primary: 0x5a8f3a,    // Classic Crash green
    secondary: 0x3d6928,  // Darker green patches
    highlight: 0x7cb85a,  // Lighter grass tips
  },
  [BiomeType.Desert]: {
    primary: 0xc4a35a,    // Sandy tan
    secondary: 0x8b7355,  // Rocky brown
    highlight: 0xdbc88a,  // Light sand
  },
  [BiomeType.Forest]: {
    primary: 0x2d5a1a,    // Deep forest green
    secondary: 0x1a3d0f,  // Very dark green
    highlight: 0x4a7a3a,  // Lighter patches
  },
  [BiomeType.Snow]: {
    primary: 0xe8e8f0,    // Off-white snow
    secondary: 0xc0c8d0,  // Blue-grey shadows
    highlight: 0xffffff,  // Pure white
  },
  [BiomeType.Swamp]: {
    primary: 0x4a5a3a,    // Murky green
    secondary: 0x3a4a2a,  // Darker mud
    highlight: 0x6a7a5a,  // Mossy highlights
  },
  [BiomeType.Mountain]: {
    primary: 0x7a7a7a,    // Grey rock
    secondary: 0x5a5a5a,  // Dark rock
    highlight: 0x9a9a9a,  // Light stone
  },
};

// Vertex shader - world-space UVs for seamless tiling across chunks
const vertexShader = `
  varying vec2 vWorldUV;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  uniform float uTextureScale;

  void main() {
    // Calculate world position for seamless UVs
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldUV = worldPos.xz * uTextureScale;

    // Pass normal for lighting
    vNormal = normalize(normalMatrix * normal);

    // View-space position for lighting calculations
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;

    gl_Position = projectionMatrix * mvPosition;
  }
`;

// Fragment shader - simple textured with PS1-style lighting
const fragmentShader = `
  uniform sampler2D uTexture;
  uniform vec3 uColor;
  uniform float uBrightness;

  varying vec2 vWorldUV;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    // Sample texture with world-space UVs
    vec4 texColor = texture2D(uTexture, vWorldUV);

    // Simple directional light (sun from above-front)
    vec3 lightDir = normalize(vec3(0.3, 1.0, 0.2));
    float diffuse = max(dot(vNormal, lightDir), 0.0);

    // PS1-style flat lighting (no smooth gradients)
    float lightIntensity = 0.4 + diffuse * 0.6;

    // Apply color tint and lighting
    vec3 finalColor = texColor.rgb * uColor * lightIntensity * uBrightness;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

export interface RetroMaterialOptions {
  biome?: BiomeType;
  texture?: THREE.Texture;
  textureScale?: number;  // How many times texture repeats per world unit
  brightness?: number;
}

/**
 * Create a PS1-style terrain shader material with world-space UVs
 */
export function createRetroTerrainShaderMaterial(options: RetroMaterialOptions = {}): THREE.ShaderMaterial {
  const biome = options.biome ?? BiomeType.Grassland;
  // Validate biome exists in color map, fallback to Grassland if not
  const colors = RETRO_BIOME_COLORS[biome] ?? RETRO_BIOME_COLORS[BiomeType.Grassland];

  // Create a default texture if none provided (solid color)
  const texture = options.texture ?? createFallbackTexture(colors.primary);

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTexture: { value: texture },
      uColor: { value: new THREE.Color(1, 1, 1) }, // Neutral, texture provides color
      uTextureScale: { value: options.textureScale ?? 1.0 },
      uBrightness: { value: options.brightness ?? 1.0 },
    },
    side: THREE.FrontSide,
  });

  return material;
}

/**
 * Create a simple MeshStandardMaterial for terrain (non-shader fallback)
 * Uses flat shading for PS1-style look
 */
export function createRetroTerrainMaterial(
  biome: BiomeType,
  texture?: THREE.Texture
): THREE.MeshStandardMaterial {
  // Validate biome exists in color map, fallback to Grassland if not
  const colors = RETRO_BIOME_COLORS[biome] ?? RETRO_BIOME_COLORS[BiomeType.Grassland];

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color: texture ? 0xffffff : colors.primary,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,  // PS1-style faceted look
  });

  return material;
}

/**
 * Create a fallback solid-color texture with subtle variation
 * Uses 16x16 pixels for better visual quality when texture fails to load
 */
function createFallbackTexture(color: number): THREE.DataTexture {
  const size = 16;
  const c = new THREE.Color(color);
  const data = new Uint8Array(size * size * 4);

  // Base color values
  const baseR = Math.floor(c.r * 255);
  const baseG = Math.floor(c.g * 255);
  const baseB = Math.floor(c.b * 255);

  // Create subtle color variation for a more natural look
  for (let i = 0; i < size * size; i++) {
    // Simple pseudo-random variation (-10 to +10)
    const variation = ((i * 7 + (i % 5) * 13) % 21) - 10;
    const idx = i * 4;

    data[idx] = Math.max(0, Math.min(255, baseR + variation));
    data[idx + 1] = Math.max(0, Math.min(255, baseG + variation));
    data[idx + 2] = Math.max(0, Math.min(255, baseB + variation));
    data[idx + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter; // PS1-style pixelated
  texture.minFilter = THREE.LinearMipmapLinearFilter;

  return texture;
}

/**
 * Manager for retro terrain materials
 * Handles texture caching and material creation
 */
export class RetroMaterialManager {
  private materials: Set<THREE.Material> = new Set();
  private textureCache: Map<BiomeType, THREE.Texture> = new Map();
  private textureLoader: THREE.TextureLoader;

  constructor() {
    this.textureLoader = new THREE.TextureLoader();
  }

  /**
   * Preload PS1-style textures for all biomes
   */
  async preloadTextures(): Promise<void> {
    const biomes = Object.values(BiomeType).filter((v) => typeof v === 'number') as BiomeType[];

    console.log('[RetroMaterialManager] Preloading PS1-style textures...');

    await Promise.all(
      biomes.map((biome) => this.loadBiomeTexture(biome))
    );

    console.log('[RetroMaterialManager] Textures loaded:', this.textureCache.size, 'biomes');
  }

  /**
   * Load texture for a specific biome
   */
  async loadBiomeTexture(biome: BiomeType): Promise<THREE.Texture> {
    // Check cache
    const cached = this.textureCache.get(biome);
    if (cached) return cached;

    const biomeName = BIOME_NAMES[biome];
    const texturePath = `/assets/textures/biomes/${biomeName}_ground.png`;

    return new Promise((resolve) => {
      this.textureLoader.load(
        texturePath,
        (texture) => {
          // Configure for seamless tiling
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.NearestFilter; // PS1-style pixelated look
          texture.anisotropy = 4;

          this.textureCache.set(biome, texture);
          resolve(texture);
        },
        undefined,
        () => {
          // Fallback to solid color texture
          console.warn(`[RetroMaterialManager] Failed to load texture for ${biomeName}, using fallback`);
          const fallback = createFallbackTexture(RETRO_BIOME_COLORS[biome].primary);
          this.textureCache.set(biome, fallback);
          resolve(fallback);
        }
      );
    });
  }

  /**
   * Create a material for a biome
   */
  createMaterial(options: RetroMaterialOptions = {}): THREE.MeshStandardMaterial {
    const biome = options.biome ?? BiomeType.Grassland;
    const texture = options.texture ?? this.textureCache.get(biome);

    const material = createRetroTerrainMaterial(biome, texture);
    this.materials.add(material);

    return material;
  }

  /**
   * Create shader-based material (for world-space UV tiling)
   */
  createShaderMaterial(options: RetroMaterialOptions = {}): THREE.ShaderMaterial {
    const biome = options.biome ?? BiomeType.Grassland;

    // Use cached texture if available
    if (!options.texture) {
      options.texture = this.textureCache.get(biome);
    }

    const material = createRetroTerrainShaderMaterial(options);
    this.materials.add(material);

    return material;
  }

  /**
   * Get cached texture for a biome
   */
  getTexture(biome: BiomeType): THREE.Texture | undefined {
    return this.textureCache.get(biome);
  }

  /**
   * Remove a material from tracking
   */
  remove(material: THREE.Material): void {
    this.materials.delete(material);
  }

  /**
   * Dispose all materials and textures
   */
  dispose(): void {
    for (const material of this.materials) {
      material.dispose();
    }
    this.materials.clear();

    for (const texture of this.textureCache.values()) {
      texture.dispose();
    }
    this.textureCache.clear();
  }
}

// Singleton instance
export const retroMaterialManager = new RetroMaterialManager();
