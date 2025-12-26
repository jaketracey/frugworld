/**
 * Weather System
 * Manages weather states, transitions, and visual effects
 * Integrates with the day/night cycle for time-based weather behavior
 */

import * as THREE from 'three';
import type { TimeOfDay } from './DayNightCycle.ts';

// ============================================================================
// Types and Enums
// ============================================================================

export enum WeatherState {
  Sunny = 'sunny',
  Cloudy = 'cloudy',
  Rainy = 'rainy',
  Stormy = 'stormy',
  Foggy = 'foggy',
  Snowy = 'snowy',
}

export interface WeatherConfig {
  transitionDurationMs: number;
  minWeatherDurationMs: number;
  maxWeatherDurationMs: number;
  autoTransition: boolean;
  initialState: WeatherState;
  rainParticleCount: number;
  snowParticleCount: number;
  rainHeight: number;
  rainRadius: number;
}

export interface WeatherEventData {
  previousState: WeatherState;
  newState: WeatherState;
  transitionProgress: number;
  timeOfDay: TimeOfDay;
}

export type WeatherEventListener = (event: WeatherEventData) => void;

export interface WeatherVisuals {
  visibility: number;
  ambientModifier: number;
  directionalModifier: number;
  fogNearModifier: number;
  fogFarModifier: number;
  skyTint: THREE.Color;
  hasPrecipitation: boolean;
  windStrength: number;
  windDirection: number;
}

export interface WeatherInfo {
  state: WeatherState;
  isRaining: boolean;
  isSnowing: boolean;
  isFoggy: boolean;
  isStormy: boolean;
  visibility: number;
  windStrength: number;
  windDirection: number;
}

const DEFAULT_CONFIG: WeatherConfig = {
  transitionDurationMs: 10000,
  minWeatherDurationMs: 60000,
  maxWeatherDurationMs: 300000,
  autoTransition: true,
  initialState: WeatherState.Sunny,
  rainParticleCount: 5000,
  snowParticleCount: 3000,
  rainHeight: 50,
  rainRadius: 40,
};

const WEATHER_VISUALS: Record<WeatherState, WeatherVisuals> = {
  [WeatherState.Sunny]: {
    visibility: 1.0,
    ambientModifier: 1.0,
    directionalModifier: 1.0,
    fogNearModifier: 1.0,
    fogFarModifier: 1.0,
    skyTint: new THREE.Color(0xffffff),
    hasPrecipitation: false,
    windStrength: 0.1,
    windDirection: 0,
  },
  [WeatherState.Cloudy]: {
    visibility: 0.9,
    ambientModifier: 0.7,
    directionalModifier: 0.5,
    fogNearModifier: 0.9,
    fogFarModifier: 0.85,
    skyTint: new THREE.Color(0xcccccc),
    hasPrecipitation: false,
    windStrength: 0.3,
    windDirection: Math.PI / 4,
  },
  [WeatherState.Rainy]: {
    visibility: 0.6,
    ambientModifier: 0.5,
    directionalModifier: 0.3,
    fogNearModifier: 0.6,
    fogFarModifier: 0.5,
    skyTint: new THREE.Color(0x8899aa),
    hasPrecipitation: true,
    windStrength: 0.5,
    windDirection: Math.PI / 3,
  },
  [WeatherState.Stormy]: {
    visibility: 0.4,
    ambientModifier: 0.3,
    directionalModifier: 0.1,
    fogNearModifier: 0.4,
    fogFarModifier: 0.3,
    skyTint: new THREE.Color(0x445566),
    hasPrecipitation: true,
    windStrength: 0.9,
    windDirection: Math.PI / 2,
  },
  [WeatherState.Foggy]: {
    visibility: 0.3,
    ambientModifier: 0.6,
    directionalModifier: 0.2,
    fogNearModifier: 0.2,
    fogFarModifier: 0.15,
    skyTint: new THREE.Color(0xaabbcc),
    hasPrecipitation: false,
    windStrength: 0.05,
    windDirection: 0,
  },
  [WeatherState.Snowy]: {
    visibility: 0.5,
    ambientModifier: 0.8,
    directionalModifier: 0.4,
    fogNearModifier: 0.5,
    fogFarModifier: 0.4,
    skyTint: new THREE.Color(0xddeeff),
    hasPrecipitation: true,
    windStrength: 0.4,
    windDirection: -Math.PI / 4,
  },
};

const TRANSITION_WEIGHTS: Record<WeatherState, Record<WeatherState, number>> = {
  [WeatherState.Sunny]: {
    [WeatherState.Sunny]: 0,
    [WeatherState.Cloudy]: 0.6,
    [WeatherState.Rainy]: 0.1,
    [WeatherState.Stormy]: 0.0,
    [WeatherState.Foggy]: 0.2,
    [WeatherState.Snowy]: 0.1,
  },
  [WeatherState.Cloudy]: {
    [WeatherState.Sunny]: 0.3,
    [WeatherState.Cloudy]: 0,
    [WeatherState.Rainy]: 0.4,
    [WeatherState.Stormy]: 0.1,
    [WeatherState.Foggy]: 0.1,
    [WeatherState.Snowy]: 0.1,
  },
  [WeatherState.Rainy]: {
    [WeatherState.Sunny]: 0.1,
    [WeatherState.Cloudy]: 0.4,
    [WeatherState.Rainy]: 0,
    [WeatherState.Stormy]: 0.3,
    [WeatherState.Foggy]: 0.1,
    [WeatherState.Snowy]: 0.1,
  },
  [WeatherState.Stormy]: {
    [WeatherState.Sunny]: 0.0,
    [WeatherState.Cloudy]: 0.2,
    [WeatherState.Rainy]: 0.6,
    [WeatherState.Stormy]: 0,
    [WeatherState.Foggy]: 0.1,
    [WeatherState.Snowy]: 0.1,
  },
  [WeatherState.Foggy]: {
    [WeatherState.Sunny]: 0.4,
    [WeatherState.Cloudy]: 0.3,
    [WeatherState.Rainy]: 0.2,
    [WeatherState.Stormy]: 0.0,
    [WeatherState.Foggy]: 0,
    [WeatherState.Snowy]: 0.1,
  },
  [WeatherState.Snowy]: {
    [WeatherState.Sunny]: 0.2,
    [WeatherState.Cloudy]: 0.4,
    [WeatherState.Rainy]: 0.1,
    [WeatherState.Stormy]: 0.1,
    [WeatherState.Foggy]: 0.2,
    [WeatherState.Snowy]: 0,
  },
};

export class WeatherSystem {
  private config: WeatherConfig;
  private scene: THREE.Scene;
  private currentState: WeatherState;
  private previousState: WeatherState;
  private transitionProgress: number = 1.0;
  private stateTimeRemaining: number = 0;
  private currentTimeOfDay: TimeOfDay = 'day';
  private eventListeners: Map<string, Set<WeatherEventListener>> = new Map();
  private rainParticles: THREE.Points | null = null;
  private snowParticles: THREE.Points | null = null;
  private rainMaterial: THREE.ShaderMaterial | null = null;
  private snowMaterial: THREE.ShaderMaterial | null = null;
  private lightningLight: THREE.PointLight | null = null;
  private lightningTimer: number = 0;
  private lightningActive: boolean = false;
  private nextLightningTime: number = 0;
  private playerPosition: THREE.Vector3 = new THREE.Vector3();
  private baseFogNear: number = 50;
  private baseFogFar: number = 300;
  private ambientLight: THREE.AmbientLight | null = null;
  private directionalLight: THREE.DirectionalLight | null = null;
  private baseAmbientIntensity: number = 0.4;
  private baseDirectionalIntensity: number = 0.8;

  constructor(scene: THREE.Scene, config: Partial<WeatherConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.scene = scene;
    this.currentState = this.config.initialState;
    this.previousState = this.config.initialState;
    this.eventListeners.set('weatherChange', new Set());
    this.eventListeners.set('transitionStart', new Set());
    this.eventListeners.set('transitionEnd', new Set());
    this.eventListeners.set('lightning', new Set());
    this.stateTimeRemaining = this.getRandomWeatherDuration();
    this.createRainSystem();
    this.createSnowSystem();
    this.createLightningSystem();
    this.updateVisuals();
  }

  setLights(ambient: THREE.AmbientLight, directional: THREE.DirectionalLight): void {
    this.ambientLight = ambient;
    this.directionalLight = directional;
    this.baseAmbientIntensity = ambient.intensity;
    this.baseDirectionalIntensity = directional.intensity;
  }

  setBaseFog(near: number, far: number): void {
    this.baseFogNear = near;
    this.baseFogFar = far;
  }

  setPlayerPosition(x: number, y: number, z: number): void {
    this.playerPosition.set(x, y, z);
    if (this.rainParticles) {
      this.rainParticles.position.x = x;
      this.rainParticles.position.z = z;
    }
    if (this.snowParticles) {
      this.snowParticles.position.x = x;
      this.snowParticles.position.z = z;
    }
  }

  setTimeOfDay(timeOfDay: TimeOfDay): void {
    this.currentTimeOfDay = timeOfDay;
  }

  getCurrentState(): WeatherState {
    return this.currentState;
  }

  getTransitionProgress(): number {
    return this.transitionProgress;
  }

  isTransitioning(): boolean {
    return this.transitionProgress < 1.0;
  }

  getCurrentVisuals(): WeatherVisuals {
    if (this.transitionProgress >= 1.0) {
      return { ...WEATHER_VISUALS[this.currentState] };
    }
    const prev = WEATHER_VISUALS[this.previousState];
    const curr = WEATHER_VISUALS[this.currentState];
    const t = this.easeInOutCubic(this.transitionProgress);
    return {
      visibility: this.lerp(prev.visibility, curr.visibility, t),
      ambientModifier: this.lerp(prev.ambientModifier, curr.ambientModifier, t),
      directionalModifier: this.lerp(prev.directionalModifier, curr.directionalModifier, t),
      fogNearModifier: this.lerp(prev.fogNearModifier, curr.fogNearModifier, t),
      fogFarModifier: this.lerp(prev.fogFarModifier, curr.fogFarModifier, t),
      skyTint: prev.skyTint.clone().lerp(curr.skyTint, t),
      hasPrecipitation: t > 0.5 ? curr.hasPrecipitation : prev.hasPrecipitation,
      windStrength: this.lerp(prev.windStrength, curr.windStrength, t),
      windDirection: this.lerpAngle(prev.windDirection, curr.windDirection, t),
    };
  }

  setWeather(state: WeatherState): void {
    if (state === this.currentState && this.transitionProgress >= 1.0) return;
    this.previousState = this.currentState;
    this.currentState = state;
    this.transitionProgress = 0;
    this.stateTimeRemaining = this.getRandomWeatherDuration();
    this.emitEvent('transitionStart', {
      previousState: this.previousState,
      newState: this.currentState,
      transitionProgress: 0,
      timeOfDay: this.currentTimeOfDay,
    });
  }

  setWeatherInstant(state: WeatherState): void {
    this.previousState = state;
    this.currentState = state;
    this.transitionProgress = 1.0;
    this.stateTimeRemaining = this.getRandomWeatherDuration();
    this.updateVisuals();
    this.emitEvent('weatherChange', {
      previousState: state,
      newState: state,
      transitionProgress: 1.0,
      timeOfDay: this.currentTimeOfDay,
    });
  }

  on(event: 'weatherChange' | 'transitionStart' | 'transitionEnd' | 'lightning', callback: WeatherEventListener): void {
    this.eventListeners.get(event)?.add(callback);
  }

  off(event: 'weatherChange' | 'transitionStart' | 'transitionEnd' | 'lightning', callback: WeatherEventListener): void {
    this.eventListeners.get(event)?.delete(callback);
  }

  getWeatherInfo(): WeatherInfo {
    const visuals = this.getCurrentVisuals();
    return {
      state: this.currentState,
      isRaining: this.currentState === WeatherState.Rainy || this.currentState === WeatherState.Stormy,
      isSnowing: this.currentState === WeatherState.Snowy,
      isFoggy: this.currentState === WeatherState.Foggy,
      isStormy: this.currentState === WeatherState.Stormy,
      visibility: visuals.visibility,
      windStrength: visuals.windStrength,
      windDirection: visuals.windDirection,
    };
  }

  update(deltaMs: number): void {
    if (this.transitionProgress < 1.0) {
      this.transitionProgress += deltaMs / this.config.transitionDurationMs;
      if (this.transitionProgress >= 1.0) {
        this.transitionProgress = 1.0;
        this.emitEvent('transitionEnd', {
          previousState: this.previousState,
          newState: this.currentState,
          transitionProgress: 1.0,
          timeOfDay: this.currentTimeOfDay,
        });
        this.emitEvent('weatherChange', {
          previousState: this.previousState,
          newState: this.currentState,
          transitionProgress: 1.0,
          timeOfDay: this.currentTimeOfDay,
        });
      }
    }
    if (this.config.autoTransition && this.transitionProgress >= 1.0) {
      this.stateTimeRemaining -= deltaMs;
      if (this.stateTimeRemaining <= 0) {
        this.transitionToNextWeather();
      }
    }
    this.updateRain(deltaMs);
    this.updateSnow(deltaMs);
    this.updateLightning(deltaMs);
    this.updateVisuals();
  }

  destroy(): void {
    if (this.rainParticles) {
      this.scene.remove(this.rainParticles);
      this.rainParticles.geometry.dispose();
      this.rainMaterial?.dispose();
    }
    if (this.snowParticles) {
      this.scene.remove(this.snowParticles);
      this.snowParticles.geometry.dispose();
      this.snowMaterial?.dispose();
    }
    if (this.lightningLight) {
      this.scene.remove(this.lightningLight);
    }
    this.eventListeners.forEach((listeners) => listeners.clear());
  }

  private createRainSystem(): void {
    const count = this.config.rainParticleCount;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * this.config.rainRadius;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.random() * this.config.rainHeight;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rainMaterial = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, opacity: { value: 0 }, windStrength: { value: 0 }, windDirection: { value: 0 } },
      vertexShader: `
        uniform float time; uniform float windStrength; uniform float windDirection;
        varying float vAlpha;
        void main() {
          vec3 pos = position;
          float windX = cos(windDirection) * windStrength * 5.0;
          float windZ = sin(windDirection) * windStrength * 5.0;
          float cycle = mod(time + position.y * 0.1, 1.0);
          pos.y = position.y - cycle * 50.0;
          pos.x += windX * cycle; pos.z += windZ * cycle;
          if (pos.y < 0.0) pos.y += 50.0;
          vAlpha = 1.0 - (pos.y / 50.0);
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = 2.0 * (100.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: `
        uniform float opacity; varying float vAlpha;
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float alpha = (1.0 - dist * 2.0) * vAlpha * opacity;
          gl_FragColor = vec4(0.7, 0.8, 0.9, alpha);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.rainParticles = new THREE.Points(geometry, this.rainMaterial);
    this.rainParticles.visible = false;
    this.scene.add(this.rainParticles);
  }

  private createSnowSystem(): void {
    const count = this.config.snowParticleCount;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * this.config.rainRadius;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.random() * this.config.rainHeight;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      sizes[i] = 1 + Math.random() * 2;
      phases[i] = Math.random() * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
    this.snowMaterial = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, opacity: { value: 0 }, windStrength: { value: 0 }, windDirection: { value: 0 } },
      vertexShader: `
        attribute float size; attribute float phase;
        uniform float time; uniform float windStrength; uniform float windDirection;
        varying float vAlpha;
        void main() {
          vec3 pos = position;
          float windX = cos(windDirection) * windStrength * 3.0;
          float windZ = sin(windDirection) * windStrength * 3.0;
          float cycle = mod(time * 0.3 + position.y * 0.05, 1.0);
          pos.y = position.y - cycle * 50.0;
          float wobble = sin(time * 2.0 + phase) * 2.0;
          pos.x += windX * cycle + wobble;
          pos.z += windZ * cycle + cos(time * 1.5 + phase) * 1.5;
          if (pos.y < 0.0) pos.y += 50.0;
          vAlpha = 0.8;
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = size * (150.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: `
        uniform float opacity; varying float vAlpha;
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float alpha = (1.0 - dist * 2.0) * vAlpha * opacity;
          gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.snowParticles = new THREE.Points(geometry, this.snowMaterial);
    this.snowParticles.visible = false;
    this.scene.add(this.snowParticles);
  }

  private createLightningSystem(): void {
    this.lightningLight = new THREE.PointLight(0xffffff, 0, 500);
    this.lightningLight.position.set(0, 100, 0);
    this.scene.add(this.lightningLight);
  }

  private updateRain(deltaMs: number): void {
    if (!this.rainParticles || !this.rainMaterial) return;
    const visuals = this.getCurrentVisuals();
    const shouldShowRain = (this.currentState === WeatherState.Rainy || this.currentState === WeatherState.Stormy) && this.transitionProgress > 0.3;
    const targetOpacity = shouldShowRain ? (this.currentState === WeatherState.Stormy ? 0.8 : 0.5) : 0;
    this.rainMaterial.uniforms.opacity.value = this.lerp(this.rainMaterial.uniforms.opacity.value, targetOpacity, deltaMs * 0.003);
    this.rainParticles.visible = this.rainMaterial.uniforms.opacity.value > 0.01;
    this.rainMaterial.uniforms.time.value += deltaMs * 0.001;
    this.rainMaterial.uniforms.windStrength.value = visuals.windStrength;
    this.rainMaterial.uniforms.windDirection.value = visuals.windDirection;
  }

  private updateSnow(deltaMs: number): void {
    if (!this.snowParticles || !this.snowMaterial) return;
    const visuals = this.getCurrentVisuals();
    const shouldShowSnow = this.currentState === WeatherState.Snowy && this.transitionProgress > 0.3;
    const targetOpacity = shouldShowSnow ? 0.7 : 0;
    this.snowMaterial.uniforms.opacity.value = this.lerp(this.snowMaterial.uniforms.opacity.value, targetOpacity, deltaMs * 0.003);
    this.snowParticles.visible = this.snowMaterial.uniforms.opacity.value > 0.01;
    this.snowMaterial.uniforms.time.value += deltaMs * 0.001;
    this.snowMaterial.uniforms.windStrength.value = visuals.windStrength;
    this.snowMaterial.uniforms.windDirection.value = visuals.windDirection;
  }

  private updateLightning(deltaMs: number): void {
    if (!this.lightningLight) return;
    const isStormy = this.currentState === WeatherState.Stormy && this.transitionProgress > 0.5;
    if (isStormy) {
      this.lightningTimer += deltaMs;
      if (!this.lightningActive && this.lightningTimer >= this.nextLightningTime) {
        this.lightningActive = true;
        this.lightningLight.intensity = 2 + Math.random() * 3;
        this.lightningLight.position.set(
          this.playerPosition.x + (Math.random() - 0.5) * 200,
          100 + Math.random() * 50,
          this.playerPosition.z + (Math.random() - 0.5) * 200
        );
        this.emitEvent('lightning', { previousState: this.previousState, newState: this.currentState, transitionProgress: this.transitionProgress, timeOfDay: this.currentTimeOfDay });
      }
      if (this.lightningActive) {
        this.lightningLight.intensity *= 0.9;
        if (this.lightningLight.intensity < 0.1) {
          this.lightningActive = false;
          this.lightningTimer = 0;
          this.lightningLight.intensity = 0;
          this.nextLightningTime = 3000 + Math.random() * 7000;
        }
      }
    } else {
      this.lightningLight.intensity = 0;
      this.lightningActive = false;
    }
  }

  private updateVisuals(): void {
    const visuals = this.getCurrentVisuals();
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = this.baseFogNear * visuals.fogNearModifier;
      this.scene.fog.far = this.baseFogFar * visuals.fogFarModifier;
    }
    if (this.ambientLight) this.ambientLight.intensity = this.baseAmbientIntensity * visuals.ambientModifier;
    if (this.directionalLight) this.directionalLight.intensity = this.baseDirectionalIntensity * visuals.directionalModifier;
  }

  private transitionToNextWeather(): void {
    this.setWeather(this.selectNextWeather());
  }

  private selectNextWeather(): WeatherState {
    const weights = TRANSITION_WEIGHTS[this.currentState];
    const states = Object.keys(weights) as WeatherState[];
    const validStates = states.filter((s) => weights[s] > 0);
    const modifiedWeights: Record<string, number> = {};
    for (const state of validStates) {
      let weight = weights[state];
      if (state === WeatherState.Foggy && this.currentTimeOfDay === 'dawn') weight *= 2;
      if (state === WeatherState.Stormy && this.currentTimeOfDay === 'night') weight *= 0.5;
      modifiedWeights[state] = weight;
    }
    const totalWeight = Object.values(modifiedWeights).reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;
    for (const state of validStates) {
      random -= modifiedWeights[state];
      if (random <= 0) return state;
    }
    return validStates[0] ?? WeatherState.Sunny;
  }

  private getRandomWeatherDuration(): number {
    return this.config.minWeatherDurationMs + Math.random() * (this.config.maxWeatherDurationMs - this.config.minWeatherDurationMs);
  }

  private emitEvent(event: string, data: WeatherEventData): void {
    this.eventListeners.get(event)?.forEach((callback) => callback(data));
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private lerpAngle(a: number, b: number, t: number): number {
    while (b - a > Math.PI) b -= Math.PI * 2;
    while (b - a < -Math.PI) b += Math.PI * 2;
    return a + (b - a) * t;
  }

  private easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
}
