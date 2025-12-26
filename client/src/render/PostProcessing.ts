/**
 * Post-processing effects pipeline for AAA-quality visuals
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// Custom shader for color grading, vignette, and film effects
const ColorGradingShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    // Vignette
    uVignetteIntensity: { value: 0.35 },
    uVignetteRadius: { value: 0.75 },
    // Color grading
    uSaturation: { value: 1.1 },
    uContrast: { value: 1.05 },
    uBrightness: { value: 0.0 },
    uGamma: { value: 1.0 },
    // Color tint (for mood)
    uTintColor: { value: new THREE.Vector3(1.0, 0.98, 0.95) },
    uTintIntensity: { value: 0.1 },
    // Film grain
    uGrainIntensity: { value: 0.03 },
    // Chromatic aberration
    uChromaticAberration: { value: 0.002 },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;

    // Vignette
    uniform float uVignetteIntensity;
    uniform float uVignetteRadius;

    // Color grading
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uBrightness;
    uniform float uGamma;
    uniform vec3 uTintColor;
    uniform float uTintIntensity;

    // Film effects
    uniform float uGrainIntensity;
    uniform float uChromaticAberration;

    varying vec2 vUv;

    // Pseudo-random noise function
    float random(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }

    // Convert RGB to HSL
    vec3 rgb2hsl(vec3 color) {
      float maxC = max(max(color.r, color.g), color.b);
      float minC = min(min(color.r, color.g), color.b);
      float l = (maxC + minC) / 2.0;

      if (maxC == minC) {
        return vec3(0.0, 0.0, l);
      }

      float d = maxC - minC;
      float s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);

      float h;
      if (maxC == color.r) {
        h = (color.g - color.b) / d + (color.g < color.b ? 6.0 : 0.0);
      } else if (maxC == color.g) {
        h = (color.b - color.r) / d + 2.0;
      } else {
        h = (color.r - color.g) / d + 4.0;
      }
      h /= 6.0;

      return vec3(h, s, l);
    }

    // Convert HSL to RGB
    float hue2rgb(float p, float q, float t) {
      if (t < 0.0) t += 1.0;
      if (t > 1.0) t -= 1.0;
      if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
      if (t < 1.0/2.0) return q;
      if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
      return p;
    }

    vec3 hsl2rgb(vec3 hsl) {
      if (hsl.y == 0.0) {
        return vec3(hsl.z);
      }

      float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
      float p = 2.0 * hsl.z - q;

      return vec3(
        hue2rgb(p, q, hsl.x + 1.0/3.0),
        hue2rgb(p, q, hsl.x),
        hue2rgb(p, q, hsl.x - 1.0/3.0)
      );
    }

    void main() {
      vec2 uv = vUv;

      // Chromatic aberration
      vec2 direction = uv - vec2(0.5);
      float dist = length(direction);
      vec2 offset = direction * dist * uChromaticAberration;

      float r = texture2D(tDiffuse, uv + offset).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - offset).b;

      vec3 color = vec3(r, g, b);

      // Saturation adjustment
      vec3 hsl = rgb2hsl(color);
      hsl.y *= uSaturation;
      hsl.y = clamp(hsl.y, 0.0, 1.0);
      color = hsl2rgb(hsl);

      // Contrast and brightness
      color = (color - 0.5) * uContrast + 0.5 + uBrightness;

      // Gamma correction
      color = pow(color, vec3(1.0 / uGamma));

      // Color tint
      color = mix(color, color * uTintColor, uTintIntensity);

      // Vignette
      float vignetteDistance = distance(uv, vec2(0.5));
      float vignette = smoothstep(uVignetteRadius, uVignetteRadius - 0.45, vignetteDistance);
      vignette = mix(1.0, vignette, uVignetteIntensity);
      color *= vignette;

      // Film grain (subtle, animated)
      float grain = random(uv * uTime) * 2.0 - 1.0;
      color += grain * uGrainIntensity;

      // Clamp output
      color = clamp(color, 0.0, 1.0);

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

export interface PostProcessingConfig {
  enabled: boolean;
  // Bloom
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  // Color grading
  saturation: number;
  contrast: number;
  brightness: number;
  gamma: number;
  // Vignette
  vignetteEnabled: boolean;
  vignetteIntensity: number;
  // Film effects
  grainEnabled: boolean;
  grainIntensity: number;
  chromaticAberrationEnabled: boolean;
  chromaticAberration: number;
  // Anti-aliasing
  smaaEnabled: boolean;
}

const DEFAULT_CONFIG: PostProcessingConfig = {
  enabled: true,
  // Bloom - subtle glow on bright areas
  bloomEnabled: true,
  bloomStrength: 0.4,
  bloomRadius: 0.5,
  bloomThreshold: 0.8,
  // Color grading - bright and vibrant
  saturation: 1.2,
  contrast: 1.15,
  brightness: 0.05,
  gamma: 0.95,
  // Vignette - disabled
  vignetteEnabled: false,
  vignetteIntensity: 0,
  // Film effects - disabled for clean look
  grainEnabled: false,
  grainIntensity: 0,
  chromaticAberrationEnabled: false,
  chromaticAberration: 0,
  // Anti-aliasing
  smaaEnabled: true,
};

export class PostProcessing {
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloomPass: UnrealBloomPass;
  private colorGradingPass: ShaderPass;
  private smaaPass: SMAAPass;
  private outputPass: OutputPass;

  private config: PostProcessingConfig;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private time: number = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    config: Partial<PostProcessingConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const size = renderer.getSize(new THREE.Vector2());

    // Create effect composer
    this.composer = new EffectComposer(renderer);

    // Render pass - renders the scene
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // Bloom pass - adds glow to bright areas
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      this.config.bloomStrength,
      this.config.bloomRadius,
      this.config.bloomThreshold
    );
    this.bloomPass.enabled = this.config.bloomEnabled;
    this.composer.addPass(this.bloomPass);

    // SMAA pass - high quality anti-aliasing
    this.smaaPass = new SMAAPass(size.x, size.y);
    this.smaaPass.enabled = this.config.smaaEnabled;
    this.composer.addPass(this.smaaPass);

    // Color grading pass - vignette, saturation, contrast, grain
    this.colorGradingPass = new ShaderPass(ColorGradingShader);
    this.updateColorGradingUniforms();
    this.composer.addPass(this.colorGradingPass);

    // Output pass - final tone mapping
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  /**
   * Render the scene with post-processing effects
   */
  render(deltaTime: number = 0.016): void {
    if (!this.config.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // Update time for animated effects
    this.time += deltaTime;
    this.colorGradingPass.uniforms.uTime.value = this.time * 1000;

    this.composer.render(deltaTime);
  }

  /**
   * Handle window resize
   */
  resize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.bloomPass.resolution.set(width, height);
    this.smaaPass.setSize(width, height);
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<PostProcessingConfig>): void {
    this.config = { ...this.config, ...config };

    // Update bloom
    this.bloomPass.enabled = this.config.bloomEnabled;
    this.bloomPass.strength = this.config.bloomStrength;
    this.bloomPass.radius = this.config.bloomRadius;
    this.bloomPass.threshold = this.config.bloomThreshold;

    // Update SMAA
    this.smaaPass.enabled = this.config.smaaEnabled;

    // Update color grading
    this.updateColorGradingUniforms();
  }

  /**
   * Get current configuration
   */
  getConfig(): PostProcessingConfig {
    return { ...this.config };
  }

  /**
   * Enable/disable all post-processing
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Check if post-processing is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Set bloom parameters
   */
  setBloom(strength: number, radius: number, threshold: number): void {
    this.bloomPass.strength = strength;
    this.bloomPass.radius = radius;
    this.bloomPass.threshold = threshold;
    this.config.bloomStrength = strength;
    this.config.bloomRadius = radius;
    this.config.bloomThreshold = threshold;
  }

  /**
   * Update camera reference (if camera changes)
   */
  updateCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.renderPass.camera = camera;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.composer.dispose();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private updateColorGradingUniforms(): void {
    const uniforms = this.colorGradingPass.uniforms;

    // Vignette
    uniforms.uVignetteIntensity.value = this.config.vignetteEnabled
      ? this.config.vignetteIntensity
      : 0;

    // Color grading
    uniforms.uSaturation.value = this.config.saturation;
    uniforms.uContrast.value = this.config.contrast;
    uniforms.uBrightness.value = this.config.brightness;
    uniforms.uGamma.value = this.config.gamma;

    // Film grain
    uniforms.uGrainIntensity.value = this.config.grainEnabled
      ? this.config.grainIntensity
      : 0;

    // Chromatic aberration
    uniforms.uChromaticAberration.value = this.config.chromaticAberrationEnabled
      ? this.config.chromaticAberration
      : 0;
  }
}
