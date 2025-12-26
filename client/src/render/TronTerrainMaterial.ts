/**
 * Tron-style terrain material with glowing neon grid
 * Creates a futuristic cyberpunk aesthetic with different colors per biome
 */

import * as THREE from 'three';
import { BiomeType } from '@/assets/AssetManager.ts';

// Tron color palette for each biome zone
export const TRON_BIOME_COLORS: Record<BiomeType, { primary: number; secondary: number; glow: number }> = {
  [BiomeType.Grassland]: {
    primary: 0x00ffff,   // Cyan grid lines
    secondary: 0x001a1a, // Dark cyan background
    glow: 0x00ffff,
  },
  [BiomeType.Desert]: {
    primary: 0xff6600,   // Orange grid
    secondary: 0x1a0a00, // Dark orange background
    glow: 0xff8800,
  },
  [BiomeType.Forest]: {
    primary: 0x00ff00,   // Green grid
    secondary: 0x001a00, // Dark green background
    glow: 0x00ff44,
  },
  [BiomeType.Snow]: {
    primary: 0xffffff,   // White grid
    secondary: 0x0a0a1a, // Dark blue-ish background
    glow: 0xaaddff,
  },
  [BiomeType.Swamp]: {
    primary: 0xff00ff,   // Magenta grid
    secondary: 0x1a001a, // Dark magenta background
    glow: 0xff44ff,
  },
  [BiomeType.Mountain]: {
    primary: 0xffff00,   // Yellow grid
    secondary: 0x1a1a00, // Dark yellow background
    glow: 0xffff44,
  },
};

// Vertex shader - passes world position and UV to fragment shader
const vertexShader = `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying float vHeight;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);

    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vHeight = position.z; // Height in local space (before rotation)

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

// Fragment shader - creates the Tron grid effect
const fragmentShader = `
  uniform vec3 uPrimaryColor;
  uniform vec3 uSecondaryColor;
  uniform vec3 uGlowColor;
  uniform float uTime;
  uniform float uGridScale;
  uniform float uLineWidth;
  uniform float uGlowIntensity;
  uniform float uPulseSpeed;
  uniform float uHeightGlow;

  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying float vHeight;

  // Create smooth grid lines
  float grid(vec2 pos, float scale, float lineWidth) {
    vec2 grid = abs(fract(pos * scale - 0.5) - 0.5) / fwidth(pos * scale);
    float line = min(grid.x, grid.y);
    return 1.0 - min(line, 1.0);
  }

  // Hexagonal grid pattern (optional, for variation)
  float hexGrid(vec2 pos, float scale) {
    vec2 p = pos * scale;
    vec2 h = vec2(1.0, sqrt(3.0));
    vec2 a = mod(p, h) - h * 0.5;
    vec2 b = mod(p + h * 0.5, h) - h * 0.5;
    return min(length(a), length(b));
  }

  void main() {
    // World-space grid for seamless tiling across chunks
    vec2 gridPos = vWorldPosition.xz;

    // Multi-scale grid for depth
    float gridLarge = grid(gridPos, uGridScale * 0.25, uLineWidth * 2.0);
    float gridMedium = grid(gridPos, uGridScale, uLineWidth);
    float gridSmall = grid(gridPos, uGridScale * 4.0, uLineWidth * 0.5);

    // Combine grids with different intensities
    float gridPattern = gridLarge * 0.6 + gridMedium * 1.0 + gridSmall * 0.3;
    gridPattern = clamp(gridPattern, 0.0, 1.0);

    // Pulse effect based on distance from origin
    float dist = length(vWorldPosition.xz);
    float pulse = sin(dist * 0.1 - uTime * uPulseSpeed) * 0.5 + 0.5;

    // Height-based glow (higher areas glow more)
    float heightFactor = clamp(vHeight * uHeightGlow + 0.5, 0.0, 1.0);

    // Edge glow based on view angle
    float edgeFactor = 1.0 - abs(dot(vNormal, vec3(0.0, 1.0, 0.0)));
    edgeFactor = pow(edgeFactor, 2.0);

    // Combine all effects
    vec3 baseColor = uSecondaryColor;
    vec3 lineColor = mix(uPrimaryColor, uGlowColor, pulse * 0.3);

    // Add subtle ambient glow to the whole surface
    vec3 ambientGlow = uGlowColor * 0.05 * (1.0 + heightFactor * 0.5);

    // Final color mixing
    vec3 finalColor = mix(baseColor + ambientGlow, lineColor, gridPattern * uGlowIntensity);

    // Add edge highlighting
    finalColor += uGlowColor * edgeFactor * 0.3;

    // Add height-based brightness
    finalColor *= (0.8 + heightFactor * 0.4);

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

export interface TronMaterialOptions {
  biome?: BiomeType;
  gridScale?: number;
  lineWidth?: number;
  glowIntensity?: number;
  pulseSpeed?: number;
  heightGlow?: number;
}

/**
 * Create a Tron-style terrain material
 */
export function createTronTerrainMaterial(options: TronMaterialOptions = {}): THREE.ShaderMaterial {
  const biome = options.biome ?? BiomeType.Grassland;
  const colors = TRON_BIOME_COLORS[biome];

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uPrimaryColor: { value: new THREE.Color(colors.primary) },
      uSecondaryColor: { value: new THREE.Color(colors.secondary) },
      uGlowColor: { value: new THREE.Color(colors.glow) },
      uTime: { value: 0 },
      uGridScale: { value: options.gridScale ?? 0.5 },      // Grid lines per unit
      uLineWidth: { value: options.lineWidth ?? 0.02 },     // Line thickness
      uGlowIntensity: { value: options.glowIntensity ?? 1.0 },
      uPulseSpeed: { value: options.pulseSpeed ?? 0.5 },
      uHeightGlow: { value: options.heightGlow ?? 0.1 },
    },
    side: THREE.DoubleSide,
  });

  return material;
}

/**
 * Update time uniform for animated effects
 */
export function updateTronMaterialTime(material: THREE.ShaderMaterial, time: number): void {
  if (material.uniforms.uTime) {
    material.uniforms.uTime.value = time;
  }
}

/**
 * Manager for Tron materials - handles animation updates
 */
export class TronMaterialManager {
  private materials: Set<THREE.ShaderMaterial> = new Set();
  private time: number = 0;

  /**
   * Create and track a new Tron material
   */
  createMaterial(options: TronMaterialOptions = {}): THREE.ShaderMaterial {
    const material = createTronTerrainMaterial(options);
    this.materials.add(material);
    return material;
  }

  /**
   * Update all tracked materials (call each frame)
   */
  update(deltaTime: number): void {
    this.time += deltaTime;
    for (const material of this.materials) {
      updateTronMaterialTime(material, this.time);
    }
  }

  /**
   * Remove a material from tracking
   */
  remove(material: THREE.ShaderMaterial): void {
    this.materials.delete(material);
  }

  /**
   * Dispose all materials
   */
  dispose(): void {
    for (const material of this.materials) {
      material.dispose();
    }
    this.materials.clear();
  }
}

// Singleton instance
export const tronMaterialManager = new TronMaterialManager();
