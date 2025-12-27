/**
 * Procedural Sky Controller
 * Uses Three.js Sky addon with Rayleigh/Mie atmospheric scattering
 * Optimized for integrated GPUs (Intel UHD / Apple M1)
 */

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export interface SkyConfig {
  /** Haziness of the atmosphere (default: 2) */
  turbidity: number;
  /** Blue sky intensity from Rayleigh scattering (default: 1) */
  rayleigh: number;
  /** Sun glow intensity (default: 0.005) */
  mieCoefficient: number;
  /** Sun glow directional falloff (default: 0.7) */
  mieDirectionalG: number;
  /** Sky dome scale (default: 450000) */
  skyScale: number;
}

const DEFAULT_SKY_CONFIG: SkyConfig = {
  turbidity: 2,
  rayleigh: 1,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.7,
  skyScale: 450000,
};

export class SkyController {
  private sky: Sky;
  private scene: THREE.Scene;
  private config: SkyConfig;
  private sunDirection: THREE.Vector3;

  // Performance: only update when sun position changes significantly
  private lastElevation: number = -999;
  private lastAzimuth: number = -999;
  private updateThreshold: number = 0.01; // radians

  constructor(scene: THREE.Scene, config: Partial<SkyConfig> = {}) {
    this.scene = scene;
    this.config = { ...DEFAULT_SKY_CONFIG, ...config };
    this.sunDirection = new THREE.Vector3();

    // Create sky dome
    this.sky = new Sky();
    this.sky.scale.setScalar(this.config.skyScale);

    // Set atmospheric parameters
    const uniforms = this.sky.material.uniforms;
    uniforms['turbidity'].value = this.config.turbidity;
    uniforms['rayleigh'].value = this.config.rayleigh;
    uniforms['mieCoefficient'].value = this.config.mieCoefficient;
    uniforms['mieDirectionalG'].value = this.config.mieDirectionalG;

    // Add to scene
    this.scene.add(this.sky);

    // Initialize with noon sun position
    this.setSunPosition(Math.PI / 4, 0);
  }

  /**
   * Set sun position using spherical coordinates
   * @param elevation - Angle above horizon (0 = horizon, PI/2 = zenith)
   * @param azimuth - Horizontal angle (0 = north, PI/2 = east)
   */
  setSunPosition(elevation: number, azimuth: number): void {
    // Performance: skip if position hasn't changed significantly
    if (
      Math.abs(elevation - this.lastElevation) < this.updateThreshold &&
      Math.abs(azimuth - this.lastAzimuth) < this.updateThreshold
    ) {
      return;
    }

    this.lastElevation = elevation;
    this.lastAzimuth = azimuth;

    // Convert spherical to Cartesian
    const phi = Math.PI / 2 - elevation;
    const theta = azimuth;

    this.sunDirection.setFromSphericalCoords(1, phi, theta);

    // Update sky shader uniform
    this.sky.material.uniforms['sunPosition'].value.copy(this.sunDirection);
  }

  /**
   * Update sky based on time of day (0-1, where 0 = midnight, 0.5 = noon)
   */
  update(timeOfDay: number): void {
    // Convert time to sun angle
    // At time 0 (midnight): sun is below horizon (elevation = -PI/2)
    // At time 0.25 (6am): sun is at horizon (elevation = 0)
    // At time 0.5 (noon): sun is at zenith (elevation = PI/2)
    // At time 0.75 (6pm): sun is at horizon (elevation = 0)

    const sunAngle = timeOfDay * Math.PI * 2 - Math.PI / 2;
    const elevation = Math.sin(sunAngle) * (Math.PI / 2);

    // Slight azimuth variation for more natural sun path
    const azimuth = timeOfDay * Math.PI * 0.1;

    this.setSunPosition(elevation, azimuth);

    // Adjust atmosphere based on time
    this.updateAtmosphere(timeOfDay, elevation);
  }

  /**
   * Get current sun direction vector (for shadow alignment)
   */
  getSunDirection(): THREE.Vector3 {
    return this.sunDirection.clone();
  }

  /**
   * Adjust atmospheric parameters based on time of day
   */
  private updateAtmosphere(timeOfDay: number, elevation: number): void {
    const uniforms = this.sky.material.uniforms;

    // During sunrise/sunset, increase turbidity and Mie scattering for warm glow
    const isNearHorizon = Math.abs(elevation) < Math.PI / 8;

    if (isNearHorizon) {
      // Golden hour settings
      uniforms['turbidity'].value = 4;
      uniforms['rayleigh'].value = 0.5;
      uniforms['mieCoefficient'].value = 0.02;
    } else if (elevation < 0) {
      // Night settings
      uniforms['turbidity'].value = 1;
      uniforms['rayleigh'].value = 0.1;
      uniforms['mieCoefficient'].value = 0.001;
    } else {
      // Day settings
      uniforms['turbidity'].value = this.config.turbidity;
      uniforms['rayleigh'].value = this.config.rayleigh;
      uniforms['mieCoefficient'].value = this.config.mieCoefficient;
    }
  }

  /**
   * Update configuration at runtime
   */
  setConfig(config: Partial<SkyConfig>): void {
    this.config = { ...this.config, ...config };

    const uniforms = this.sky.material.uniforms;
    uniforms['turbidity'].value = this.config.turbidity;
    uniforms['rayleigh'].value = this.config.rayleigh;
    uniforms['mieCoefficient'].value = this.config.mieCoefficient;
    uniforms['mieDirectionalG'].value = this.config.mieDirectionalG;
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.scene.remove(this.sky);
    this.sky.geometry.dispose();
    (this.sky.material as THREE.ShaderMaterial).dispose();
  }
}
