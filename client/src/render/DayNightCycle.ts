/**
 * Day/Night Cycle System
 * Manages time progression, celestial bodies (sun, moon, stars), clouds, and sky colors
 */

import * as THREE from 'three';

export interface DayNightConfig {
  /** Duration of a full day in real seconds (default: 600 = 10 minutes) */
  dayDurationSeconds: number;
  /** Starting time of day (0-1, where 0 = midnight, 0.5 = noon) */
  startTime: number;
  /** Sun distance from world center */
  sunDistance: number;
  /** Moon distance from world center */
  moonDistance: number;
  /** Star field radius */
  starFieldRadius: number;
  /** Number of stars */
  starCount: number;
  /** Number of clouds */
  cloudCount: number;
  /** Cloud layer height */
  cloudHeight: number;
  /** Cloud spread radius */
  cloudRadius: number;
}

const DEFAULT_CONFIG: DayNightConfig = {
  dayDurationSeconds: 600, // 10 minute day cycle
  startTime: 0.35, // Start at morning
  sunDistance: 400,
  moonDistance: 380,
  starFieldRadius: 500,
  starCount: 1500,
  cloudCount: 25,
  cloudHeight: 80,
  cloudRadius: 200,
};

// Sky colors at different times of day
const SKY_COLORS = {
  midnight: new THREE.Color(0x0a0a1a),
  dawn: new THREE.Color(0xff6b4a),
  sunrise: new THREE.Color(0xffa366),
  day: new THREE.Color(0x87ceeb),
  sunset: new THREE.Color(0xff7744),
  dusk: new THREE.Color(0x4a3b6b),
};

// Fog colors at different times
const FOG_COLORS = {
  night: new THREE.Color(0x0a0a1a),
  dawn: new THREE.Color(0x664433),
  day: new THREE.Color(0x87ceeb),
  dusk: new THREE.Color(0x332244),
};

// Ambient light colors and intensities
const AMBIENT_LIGHT = {
  night: { color: new THREE.Color(0x1a1a3a), intensity: 0.15 },
  dawn: { color: new THREE.Color(0xffa080), intensity: 0.4 },
  day: { color: new THREE.Color(0xffffff), intensity: 0.5 },
  dusk: { color: new THREE.Color(0x8060a0), intensity: 0.3 },
};

// Sun light colors and intensities
const SUN_LIGHT = {
  night: { color: new THREE.Color(0x3344aa), intensity: 0.05 }, // Moonlight
  dawn: { color: new THREE.Color(0xffaa77), intensity: 0.6 },
  day: { color: new THREE.Color(0xffffff), intensity: 1.0 },
  dusk: { color: new THREE.Color(0xff8855), intensity: 0.5 },
};

export type TimeOfDay = 'night' | 'dawn' | 'day' | 'dusk';

export class DayNightCycle {
  private config: DayNightConfig;
  private scene: THREE.Scene;

  // Time tracking
  private timeOfDay: number; // 0-1, 0 = midnight, 0.5 = noon
  private isPaused: boolean = false;

  // Celestial objects
  private sun: THREE.Mesh;
  private sunGlow: THREE.Mesh;
  private moon: THREE.Mesh;
  private moonGlow: THREE.Mesh;
  private stars: THREE.Points;
  private starsContainer: THREE.Object3D;

  // Clouds
  private clouds: THREE.Group;
  private cloudMeshes: THREE.Mesh[] = [];

  // Light references (from SceneManager)
  private ambientLight: THREE.AmbientLight | null = null;
  private directionalLight: THREE.DirectionalLight | null = null;

  // Horizon glow
  private horizonGlow: THREE.Mesh;

  constructor(scene: THREE.Scene, config: Partial<DayNightConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.scene = scene;
    this.timeOfDay = this.config.startTime;

    // Create celestial objects
    this.sun = this.createSun();
    this.sunGlow = this.createSunGlow();
    this.moon = this.createMoon();
    this.moonGlow = this.createMoonGlow();
    this.starsContainer = new THREE.Object3D();
    this.stars = this.createStars();
    this.starsContainer.add(this.stars);
    this.clouds = this.createClouds();
    this.horizonGlow = this.createHorizonGlow();

    // Add to scene
    this.scene.add(this.sun);
    this.scene.add(this.sunGlow);
    this.scene.add(this.moon);
    this.scene.add(this.moonGlow);
    this.scene.add(this.starsContainer);
    this.scene.add(this.clouds);
    this.scene.add(this.horizonGlow);

    // Initial update
    this.updateCelestialPositions();
    this.updateSkyColors();
  }

  /**
   * Set light references from SceneManager
   */
  setLights(ambient: THREE.AmbientLight, directional: THREE.DirectionalLight): void {
    this.ambientLight = ambient;
    this.directionalLight = directional;
  }

  /**
   * Create the sun mesh
   */
  private createSun(): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(15, 32, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffdd44,
      transparent: true,
    });
    const sun = new THREE.Mesh(geometry, material);
    sun.renderOrder = 1000;
    return sun;
  }

  /**
   * Create sun glow effect
   */
  private createSunGlow(): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(25, 32, 32);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        sunColor: { value: new THREE.Color(0xffaa44) },
        intensity: { value: 1.0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 sunColor;
        uniform float intensity;
        varying vec3 vNormal;
        void main() {
          float glow = pow(0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
          gl_FragColor = vec4(sunColor, glow * intensity * 0.6);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    return new THREE.Mesh(geometry, material);
  }

  /**
   * Create the moon mesh
   */
  private createMoon(): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(10, 32, 32);

    // Create moon texture with craters
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Base moon color
    ctx.fillStyle = '#e8e8e0';
    ctx.fillRect(0, 0, 256, 256);

    // Add crater-like features
    ctx.fillStyle = '#c8c8c0';
    for (let i = 0; i < 20; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const r = Math.random() * 20 + 5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#d8d8d0';
    for (let i = 0; i < 15; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const r = Math.random() * 10 + 3;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
    });

    return new THREE.Mesh(geometry, material);
  }

  /**
   * Create moon glow effect
   */
  private createMoonGlow(): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(15, 32, 32);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        moonColor: { value: new THREE.Color(0x8899bb) },
        intensity: { value: 0.5 },
      },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 moonColor;
        uniform float intensity;
        varying vec3 vNormal;
        void main() {
          float glow = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
          gl_FragColor = vec4(moonColor, glow * intensity * 0.4);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    return new THREE.Mesh(geometry, material);
  }

  /**
   * Create star field
   */
  private createStars(): THREE.Points {
    const positions: number[] = [];
    const colors: number[] = [];
    const sizes: number[] = [];

    for (let i = 0; i < this.config.starCount; i++) {
      // Distribute stars on a sphere, but only in upper hemisphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.7 + 0.3); // Upper hemisphere bias

      const x = this.config.starFieldRadius * Math.sin(phi) * Math.cos(theta);
      const y = this.config.starFieldRadius * Math.cos(phi);
      const z = this.config.starFieldRadius * Math.sin(phi) * Math.sin(theta);

      positions.push(x, y, z);

      // Slight color variation (white to blue-white)
      const colorVariation = Math.random() * 0.3;
      colors.push(1.0, 1.0 - colorVariation * 0.5, 1.0 - colorVariation);

      // Size variation
      sizes.push(Math.random() * 2 + 0.5);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        opacity: { value: 1.0 },
        time: { value: 0.0 },
      },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vSize;
        uniform float time;
        void main() {
          vColor = color;
          vSize = size;
          // Subtle twinkle
          float twinkle = sin(time * 2.0 + position.x * 0.1 + position.z * 0.1) * 0.3 + 0.7;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * twinkle * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float opacity;
        varying vec3 vColor;
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
          gl_FragColor = vec4(vColor, alpha * opacity);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    return new THREE.Points(geometry, material);
  }

  /**
   * Create cloud layer
   */
  private createClouds(): THREE.Group {
    const group = new THREE.Group();

    for (let i = 0; i < this.config.cloudCount; i++) {
      const cloud = this.createCloud();

      // Random position in a ring around the player
      const angle = Math.random() * Math.PI * 2;
      const distance = 50 + Math.random() * this.config.cloudRadius;

      cloud.position.x = Math.cos(angle) * distance;
      cloud.position.y = this.config.cloudHeight + (Math.random() - 0.5) * 20;
      cloud.position.z = Math.sin(angle) * distance;

      // Random rotation and scale
      cloud.rotation.y = Math.random() * Math.PI * 2;
      const scale = 0.8 + Math.random() * 0.8;
      cloud.scale.setScalar(scale);

      // Store velocity for animation
      cloud.userData.velocity = {
        x: (Math.random() - 0.5) * 0.5,
        z: (Math.random() - 0.5) * 0.5,
      };
      cloud.userData.originalY = cloud.position.y;
      cloud.userData.bobPhase = Math.random() * Math.PI * 2;

      this.cloudMeshes.push(cloud);
      group.add(cloud);
    }

    return group;
  }

  /**
   * Create a single cloud
   */
  private createCloud(): THREE.Mesh {
    // Create cloud from multiple spheres
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      roughness: 1.0,
      metalness: 0.0,
    });

    // Main body
    const sizes = [
      { x: 0, y: 0, z: 0, r: 8 },
      { x: -6, y: -2, z: 0, r: 6 },
      { x: 6, y: -1, z: 0, r: 7 },
      { x: -3, y: 2, z: 3, r: 5 },
      { x: 4, y: 1, z: -2, r: 5 },
      { x: -8, y: 0, z: 2, r: 4 },
      { x: 10, y: 0, z: 1, r: 4 },
    ];

    const merged = new THREE.BufferGeometry();
    const geometries: THREE.SphereGeometry[] = [];
    const matrices: THREE.Matrix4[] = [];

    for (const s of sizes) {
      const geo = new THREE.SphereGeometry(s.r, 8, 8);
      const matrix = new THREE.Matrix4();
      matrix.setPosition(s.x, s.y, s.z);
      geometries.push(geo);
      matrices.push(matrix);
    }

    // Merge geometries
    let totalVertices = 0;
    let totalIndices = 0;
    for (const geo of geometries) {
      totalVertices += geo.attributes.position.count;
      totalIndices += geo.index?.count ?? 0;
    }

    const positions = new Float32Array(totalVertices * 3);
    const normals = new Float32Array(totalVertices * 3);
    const indices: number[] = [];

    let vertexOffset = 0;
    let indexOffset = 0;

    for (let i = 0; i < geometries.length; i++) {
      const geo = geometries[i];
      const matrix = matrices[i];
      const pos = geo.attributes.position;
      const norm = geo.attributes.normal;

      for (let j = 0; j < pos.count; j++) {
        const v = new THREE.Vector3(pos.getX(j), pos.getY(j), pos.getZ(j));
        v.applyMatrix4(matrix);
        positions[(vertexOffset + j) * 3] = v.x;
        positions[(vertexOffset + j) * 3 + 1] = v.y;
        positions[(vertexOffset + j) * 3 + 2] = v.z;

        const n = new THREE.Vector3(norm.getX(j), norm.getY(j), norm.getZ(j));
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
        n.applyMatrix3(normalMatrix);
        normals[(vertexOffset + j) * 3] = n.x;
        normals[(vertexOffset + j) * 3 + 1] = n.y;
        normals[(vertexOffset + j) * 3 + 2] = n.z;
      }

      if (geo.index) {
        for (let j = 0; j < geo.index.count; j++) {
          indices.push(geo.index.getX(j) + vertexOffset);
        }
      }

      vertexOffset += pos.count;
    }

    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    merged.setIndex(indices);

    return new THREE.Mesh(merged, material);
  }

  /**
   * Create horizon glow for sunrise/sunset
   */
  private createHorizonGlow(): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(2000, 200);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0xff6644) },
        bottomColor: { value: new THREE.Color(0xffaa66) },
        opacity: { value: 0.0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float opacity;
        varying vec2 vUv;
        void main() {
          vec3 color = mix(bottomColor, topColor, vUv.y);
          float alpha = (1.0 - vUv.y) * opacity;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = 0;
    return mesh;
  }

  /**
   * Update celestial body positions based on time
   */
  private updateCelestialPositions(): void {
    // Sun angle (0 = horizon east, 0.25 = noon, 0.5 = horizon west)
    const sunAngle = this.timeOfDay * Math.PI * 2 - Math.PI / 2;

    this.sun.position.x = Math.cos(sunAngle) * this.config.sunDistance;
    this.sun.position.y = Math.sin(sunAngle) * this.config.sunDistance;
    this.sun.position.z = 0;

    this.sunGlow.position.copy(this.sun.position);

    // Moon is opposite the sun
    const moonAngle = sunAngle + Math.PI;
    this.moon.position.x = Math.cos(moonAngle) * this.config.moonDistance;
    this.moon.position.y = Math.sin(moonAngle) * this.config.moonDistance;
    this.moon.position.z = 30; // Slight offset

    this.moonGlow.position.copy(this.moon.position);

    // Update directional light to match sun
    if (this.directionalLight) {
      // When sun is below horizon, use moon as light source
      if (this.sun.position.y > 0) {
        this.directionalLight.position.copy(this.sun.position);
      } else {
        this.directionalLight.position.copy(this.moon.position);
      }
    }

    // Rotate stars slowly
    this.starsContainer.rotation.y += 0.00002;
  }

  /**
   * Get current phase of day
   */
  getTimePhase(): TimeOfDay {
    const t = this.timeOfDay;

    // Night: 0.0-0.2 and 0.8-1.0
    // Dawn: 0.2-0.3
    // Day: 0.3-0.7
    // Dusk: 0.7-0.8

    if (t < 0.2 || t >= 0.85) return 'night';
    if (t < 0.3) return 'dawn';
    if (t < 0.75) return 'day';
    return 'dusk';
  }

  /**
   * Update sky and lighting colors based on time
   */
  private updateSkyColors(): void {
    const t = this.timeOfDay;

    // Calculate blended sky color
    let skyColor: THREE.Color;
    let fogColor: THREE.Color;
    let ambientSettings: { color: THREE.Color; intensity: number };
    let sunSettings: { color: THREE.Color; intensity: number };
    let starOpacity: number;
    let horizonOpacity: number;

    if (t < 0.2) {
      // Night (midnight to before dawn)
      const blend = t / 0.2;
      skyColor = SKY_COLORS.midnight.clone();
      fogColor = FOG_COLORS.night.clone();
      ambientSettings = AMBIENT_LIGHT.night;
      sunSettings = SUN_LIGHT.night;
      starOpacity = 1.0;
      horizonOpacity = 0;
    } else if (t < 0.25) {
      // Pre-dawn (first light)
      const blend = (t - 0.2) / 0.05;
      skyColor = SKY_COLORS.midnight.clone().lerp(SKY_COLORS.dawn, blend);
      fogColor = FOG_COLORS.night.clone().lerp(FOG_COLORS.dawn, blend);
      ambientSettings = this.lerpLightSettings(AMBIENT_LIGHT.night, AMBIENT_LIGHT.dawn, blend);
      sunSettings = this.lerpLightSettings(SUN_LIGHT.night, SUN_LIGHT.dawn, blend);
      starOpacity = 1.0 - blend;
      horizonOpacity = blend * 0.8;
    } else if (t < 0.35) {
      // Dawn to sunrise
      const blend = (t - 0.25) / 0.1;
      skyColor = SKY_COLORS.dawn.clone().lerp(SKY_COLORS.sunrise, blend);
      fogColor = FOG_COLORS.dawn.clone().lerp(FOG_COLORS.day, blend);
      ambientSettings = this.lerpLightSettings(AMBIENT_LIGHT.dawn, AMBIENT_LIGHT.day, blend);
      sunSettings = this.lerpLightSettings(SUN_LIGHT.dawn, SUN_LIGHT.day, blend);
      starOpacity = 0;
      horizonOpacity = (1.0 - blend) * 0.6;
    } else if (t < 0.4) {
      // Sunrise to day
      const blend = (t - 0.35) / 0.05;
      skyColor = SKY_COLORS.sunrise.clone().lerp(SKY_COLORS.day, blend);
      fogColor = FOG_COLORS.day.clone();
      ambientSettings = AMBIENT_LIGHT.day;
      sunSettings = SUN_LIGHT.day;
      starOpacity = 0;
      horizonOpacity = 0;
    } else if (t < 0.7) {
      // Full day
      skyColor = SKY_COLORS.day.clone();
      fogColor = FOG_COLORS.day.clone();
      ambientSettings = AMBIENT_LIGHT.day;
      sunSettings = SUN_LIGHT.day;
      starOpacity = 0;
      horizonOpacity = 0;
    } else if (t < 0.75) {
      // Day to sunset
      const blend = (t - 0.7) / 0.05;
      skyColor = SKY_COLORS.day.clone().lerp(SKY_COLORS.sunset, blend);
      fogColor = FOG_COLORS.day.clone().lerp(FOG_COLORS.dusk, blend);
      ambientSettings = this.lerpLightSettings(AMBIENT_LIGHT.day, AMBIENT_LIGHT.dusk, blend);
      sunSettings = this.lerpLightSettings(SUN_LIGHT.day, SUN_LIGHT.dusk, blend);
      starOpacity = 0;
      horizonOpacity = blend * 0.8;
    } else if (t < 0.85) {
      // Sunset to dusk
      const blend = (t - 0.75) / 0.1;
      skyColor = SKY_COLORS.sunset.clone().lerp(SKY_COLORS.dusk, blend);
      fogColor = FOG_COLORS.dusk.clone().lerp(FOG_COLORS.night, blend);
      ambientSettings = this.lerpLightSettings(AMBIENT_LIGHT.dusk, AMBIENT_LIGHT.night, blend);
      sunSettings = this.lerpLightSettings(SUN_LIGHT.dusk, SUN_LIGHT.night, blend);
      starOpacity = blend * 0.5;
      horizonOpacity = (1.0 - blend) * 0.6;
    } else {
      // Night (after dusk)
      const blend = (t - 0.85) / 0.15;
      skyColor = SKY_COLORS.dusk.clone().lerp(SKY_COLORS.midnight, blend);
      fogColor = FOG_COLORS.night.clone();
      ambientSettings = AMBIENT_LIGHT.night;
      sunSettings = SUN_LIGHT.night;
      starOpacity = 0.5 + blend * 0.5;
      horizonOpacity = 0;
    }

    // Apply sky color
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(skyColor);
    } else {
      this.scene.background = skyColor;
    }

    // Apply fog color
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(fogColor);
    }

    // Apply lighting
    if (this.ambientLight) {
      this.ambientLight.color.copy(ambientSettings.color);
      this.ambientLight.intensity = ambientSettings.intensity;
    }

    if (this.directionalLight) {
      this.directionalLight.color.copy(sunSettings.color);
      this.directionalLight.intensity = sunSettings.intensity;
    }

    // Apply star opacity
    const starMaterial = this.stars.material as THREE.ShaderMaterial;
    starMaterial.uniforms.opacity.value = starOpacity;

    // Apply horizon glow
    const horizonMaterial = this.horizonGlow.material as THREE.ShaderMaterial;
    horizonMaterial.uniforms.opacity.value = horizonOpacity;

    // Update sun visibility
    this.sun.visible = this.sun.position.y > -20;
    this.sunGlow.visible = this.sun.position.y > -30;

    // Update moon visibility
    this.moon.visible = this.moon.position.y > -20;
    this.moonGlow.visible = this.moon.position.y > -30;

    // Update cloud colors based on lighting
    const cloudColor = new THREE.Color().lerpColors(
      new THREE.Color(0x666688), // Night clouds
      new THREE.Color(0xffffff), // Day clouds
      this.getTimePhase() === 'night' ? 0.0 : this.getTimePhase() === 'dusk' || this.getTimePhase() === 'dawn' ? 0.5 : 1.0
    );

    // Apply sunset/sunrise tint to clouds
    if (this.getTimePhase() === 'dawn') {
      cloudColor.lerp(new THREE.Color(0xffccaa), 0.4);
    } else if (this.getTimePhase() === 'dusk') {
      cloudColor.lerp(new THREE.Color(0xff8866), 0.4);
    }

    for (const cloud of this.cloudMeshes) {
      const material = cloud.material as THREE.MeshStandardMaterial;
      material.color.copy(cloudColor);
      material.opacity = this.getTimePhase() === 'night' ? 0.6 : 0.9;
    }
  }

  /**
   * Lerp between light settings
   */
  private lerpLightSettings(
    a: { color: THREE.Color; intensity: number },
    b: { color: THREE.Color; intensity: number },
    t: number
  ): { color: THREE.Color; intensity: number } {
    return {
      color: a.color.clone().lerp(b.color, t),
      intensity: a.intensity + (b.intensity - a.intensity) * t,
    };
  }

  /**
   * Update cloud animations
   */
  private updateClouds(deltaMs: number): void {
    const deltaS = deltaMs / 1000;

    for (const cloud of this.cloudMeshes) {
      // Slow drift
      cloud.position.x += cloud.userData.velocity.x * deltaS;
      cloud.position.z += cloud.userData.velocity.z * deltaS;

      // Gentle bobbing
      cloud.userData.bobPhase += deltaS * 0.3;
      cloud.position.y =
        cloud.userData.originalY + Math.sin(cloud.userData.bobPhase) * 2;

      // Wrap around when too far
      const dist = Math.sqrt(
        cloud.position.x * cloud.position.x + cloud.position.z * cloud.position.z
      );
      if (dist > this.config.cloudRadius + 50) {
        // Reset to opposite side
        const angle = Math.atan2(cloud.position.z, cloud.position.x);
        cloud.position.x = -Math.cos(angle) * (this.config.cloudRadius - 20);
        cloud.position.z = -Math.sin(angle) * (this.config.cloudRadius - 20);
      }
    }
  }

  /**
   * Update the day/night cycle
   */
  update(deltaMs: number): void {
    if (this.isPaused) return;

    // Advance time
    const dayDurationMs = this.config.dayDurationSeconds * 1000;
    this.timeOfDay += deltaMs / dayDurationMs;
    if (this.timeOfDay >= 1.0) {
      this.timeOfDay -= 1.0;
    }

    // Update star twinkle
    const starMaterial = this.stars.material as THREE.ShaderMaterial;
    starMaterial.uniforms.time.value += deltaMs / 1000;

    // Update positions and colors
    this.updateCelestialPositions();
    this.updateSkyColors();
    this.updateClouds(deltaMs);
  }

  /**
   * Center celestial objects on player position
   */
  setPlayerPosition(x: number, _y: number, z: number): void {
    // Move sky sphere with player so it's always surrounding them
    this.starsContainer.position.x = x;
    this.starsContainer.position.z = z;

    // Move clouds with player
    this.clouds.position.x = x;
    this.clouds.position.z = z;

    // Update horizon glow position
    this.horizonGlow.position.x = x;
    this.horizonGlow.position.z = z;
  }

  /**
   * Get current time of day (0-1)
   */
  getTime(): number {
    return this.timeOfDay;
  }

  /**
   * Get sun direction vector for sky shader and shadow alignment
   * Returns normalized vector pointing toward sun position
   */
  getSunDirection(): THREE.Vector3 {
    const sunAngle = this.timeOfDay * Math.PI * 2 - Math.PI / 2;
    return new THREE.Vector3(
      Math.cos(sunAngle),
      Math.sin(sunAngle),
      0.15 // Slight z-offset for better shadow angles
    ).normalize();
  }

  /**
   * Set time of day (0-1, where 0 = midnight, 0.5 = noon)
   */
  setTime(time: number): void {
    this.timeOfDay = Math.max(0, Math.min(1, time));
    this.updateCelestialPositions();
    this.updateSkyColors();
  }

  /**
   * Pause time progression
   */
  pause(): void {
    this.isPaused = true;
  }

  /**
   * Resume time progression
   */
  resume(): void {
    this.isPaused = false;
  }

  /**
   * Toggle pause state
   */
  togglePause(): boolean {
    this.isPaused = !this.isPaused;
    return this.isPaused;
  }

  /**
   * Set day duration in real seconds
   */
  setDayDuration(seconds: number): void {
    this.config.dayDurationSeconds = Math.max(60, seconds);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.scene.remove(this.sun);
    this.scene.remove(this.sunGlow);
    this.scene.remove(this.moon);
    this.scene.remove(this.moonGlow);
    this.scene.remove(this.starsContainer);
    this.scene.remove(this.clouds);
    this.scene.remove(this.horizonGlow);

    // Dispose geometries and materials
    this.sun.geometry.dispose();
    (this.sun.material as THREE.Material).dispose();
    this.sunGlow.geometry.dispose();
    (this.sunGlow.material as THREE.Material).dispose();
    this.moon.geometry.dispose();
    (this.moon.material as THREE.Material).dispose();
    this.moonGlow.geometry.dispose();
    (this.moonGlow.material as THREE.Material).dispose();
    this.stars.geometry.dispose();
    (this.stars.material as THREE.Material).dispose();

    for (const cloud of this.cloudMeshes) {
      cloud.geometry.dispose();
      (cloud.material as THREE.Material).dispose();
    }

    this.horizonGlow.geometry.dispose();
    (this.horizonGlow.material as THREE.Material).dispose();
  }
}
