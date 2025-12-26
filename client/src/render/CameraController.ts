/**
 * RTS-style camera controller with WASD panning and OrbitControls
 * User can pan with WASD, orbit with mouse, and zoom with scroll
 * Coordinate mapping: Game (X,Y,Z) -> Three.js (X,Z,Y) where Y is up
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface CameraConfig {
  minDistance: number;
  maxDistance: number;
  initialDistance: number;
  initialPolarAngle: number; // Vertical angle (0 = top, PI/2 = horizontal)
  minPolarAngle: number;
  maxPolarAngle: number;
  enableDamping: boolean;
  dampingFactor: number;
  rotateSpeed: number;
  zoomSpeed: number;
  panSpeed: number; // RTS pan speed in units per second
}

const DEFAULT_CONFIG: CameraConfig = {
  minDistance: 3,
  maxDistance: 50,
  initialDistance: 12,
  initialPolarAngle: Math.PI / 3, // 60 degrees from top
  minPolarAngle: 0.1, // Almost top-down
  maxPolarAngle: Math.PI / 2 - 0.1, // Almost horizontal
  enableDamping: true,
  dampingFactor: 0.1,
  rotateSpeed: 0.8,
  zoomSpeed: 1.2,
  panSpeed: 20, // 20 units per second
};

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private config: CameraConfig;

  // Camera target position (in game coords: X=right, Y=forward, Z=up)
  private targetX: number = 0;
  private targetY: number = 0;
  private targetZ: number = 0;

  // WASD pan state
  private keysPressed: Set<string> = new Set();

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    config: Partial<CameraConfig> = {}
  ) {
    this.camera = camera;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Create OrbitControls
    this.controls = new OrbitControls(camera, domElement);

    // Configure controls
    this.controls.enableDamping = this.config.enableDamping;
    this.controls.dampingFactor = this.config.dampingFactor;
    this.controls.rotateSpeed = this.config.rotateSpeed;
    this.controls.zoomSpeed = this.config.zoomSpeed;

    // Distance limits
    this.controls.minDistance = this.config.minDistance;
    this.controls.maxDistance = this.config.maxDistance;

    // Polar angle limits (vertical)
    this.controls.minPolarAngle = this.config.minPolarAngle;
    this.controls.maxPolarAngle = this.config.maxPolarAngle;

    // Disable mouse panning - we use WASD instead
    this.controls.enablePan = false;

    // Enable smooth zoom
    this.controls.enableZoom = true;

    // Set initial camera position
    this.setInitialPosition();

    // Setup WASD keyboard listeners
    this.setupKeyboardListeners();
  }

  /**
   * Setup keyboard listeners for WASD camera panning
   */
  private setupKeyboardListeners(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    // Ignore if typing in an input
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    const key = e.key.toLowerCase();
    if (this.isPanKey(key)) {
      this.keysPressed.add(key);
      e.preventDefault();
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keysPressed.delete(e.key.toLowerCase());
  };

  private handleBlur = (): void => {
    this.keysPressed.clear();
  };

  private isPanKey(key: string): boolean {
    return ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key);
  }

  /**
   * Calculate camera-relative pan direction from WASD input
   */
  private calculatePanVector(): { x: number; y: number } {
    let x = 0;
    let y = 0;

    // WASD and arrow keys for panning
    if (this.keysPressed.has('w') || this.keysPressed.has('arrowup')) {
      y += 1;
    }
    if (this.keysPressed.has('s') || this.keysPressed.has('arrowdown')) {
      y -= 1;
    }
    if (this.keysPressed.has('a') || this.keysPressed.has('arrowleft')) {
      x -= 1;
    }
    if (this.keysPressed.has('d') || this.keysPressed.has('arrowright')) {
      x += 1;
    }

    // Normalize diagonal movement
    const length = Math.sqrt(x * x + y * y);
    if (length > 1) {
      x /= length;
      y /= length;
    }

    return { x, y };
  }

  /**
   * Set initial camera position based on config
   */
  private setInitialPosition(): void {
    const distance = this.config.initialDistance;
    const polarAngle = this.config.initialPolarAngle;

    // Calculate position (spherical to cartesian)
    // In Three.js: Y is up
    const y = distance * Math.cos(polarAngle);
    const horizontalDist = distance * Math.sin(polarAngle);
    const z = horizontalDist; // Behind the target

    this.camera.position.set(0, y, z);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  /**
   * Set follow target position (in game coords: X=right, Y=forward, Z=up)
   */
  setFollowTarget(x: number, y: number, z: number): void {
    this.targetX = x;
    this.targetY = y;
    this.targetZ = z;

    // Convert game coords to Three.js coords
    // Game: X=right, Y=forward, Z=up
    // Three.js: X=right, Y=up, Z=forward (into screen)
    const threeX = x;
    const threeY = z; // Game Z -> Three.js Y (up)
    const threeZ = y; // Game Y -> Three.js Z (forward)

    // Update orbit target to follow the ball
    this.controls.target.set(threeX, threeY, threeZ);
  }

  /**
   * Instantly position camera at target
   */
  snapToTarget(): void {
    // Convert target to Three.js coords
    const threeX = this.targetX;
    const threeY = this.targetZ;
    const threeZ = this.targetY;

    // Set orbit target
    this.controls.target.set(threeX, threeY, threeZ);

    // Position camera behind and above target
    const distance = this.config.initialDistance;
    const polarAngle = this.config.initialPolarAngle;

    const camY = threeY + distance * Math.cos(polarAngle);
    const horizontalDist = distance * Math.sin(polarAngle);
    const camZ = threeZ + horizontalDist;

    this.camera.position.set(threeX, camY, camZ);
    this.controls.update();
  }

  /**
   * Update camera - must be called each frame
   */
  update(deltaMs: number = 16, _isPlayerMoving?: boolean): void {
    // Apply WASD panning
    const panInput = this.calculatePanVector();
    if (panInput.x !== 0 || panInput.y !== 0) {
      const deltaSeconds = deltaMs / 1000;
      const panAmount = this.config.panSpeed * deltaSeconds;

      // Get camera's horizontal forward and right vectors
      const forward = new THREE.Vector3();
      const right = new THREE.Vector3();

      // Camera look direction (projected onto XZ plane)
      this.camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();

      // Right vector is perpendicular to forward
      right.crossVectors(forward, new THREE.Vector3(0, 1, 0));

      // Move camera target based on pan input (camera-relative)
      // W/S moves forward/backward in camera direction
      // A/D moves left/right relative to camera
      const moveX = right.x * panInput.x + forward.x * panInput.y;
      const moveZ = right.z * panInput.x + forward.z * panInput.y;

      // Update target position (Three.js coords)
      this.controls.target.x += moveX * panAmount;
      this.controls.target.z += moveZ * panAmount;

      // Move camera by same amount to maintain distance
      this.camera.position.x += moveX * panAmount;
      this.camera.position.z += moveZ * panAmount;

      // Update internal game coords tracking
      this.targetX = this.controls.target.x;
      this.targetY = this.controls.target.z; // Three.js Z -> Game Y
      // targetZ (height) stays the same
    }

    // OrbitControls handles rotation and zoom
    this.controls.update();
  }

  /**
   * Get current camera yaw for movement direction
   * Returns the horizontal angle from camera to target
   */
  getYaw(): number {
    // Calculate direction from camera to target
    const dx = this.controls.target.x - this.camera.position.x;
    const dz = this.controls.target.z - this.camera.position.z;
    return Math.atan2(dx, -dz);
  }

  /**
   * Zoom camera in/out
   */
  zoom(delta: number): void {
    // OrbitControls handles zooming via scroll
    // This is for programmatic zoom
    const currentDist = this.camera.position.distanceTo(this.controls.target);
    const newDist = Math.max(
      this.config.minDistance,
      Math.min(this.config.maxDistance, currentDist + delta)
    );

    // Scale camera position
    const direction = new THREE.Vector3();
    direction.subVectors(this.camera.position, this.controls.target).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(direction, newDist);
  }

  /**
   * Get camera position
   */
  getPosition(): THREE.Vector3 {
    return this.camera.position.clone();
  }

  /**
   * Get camera look direction
   */
  getLookDirection(): THREE.Vector3 {
    const dir = new THREE.Vector3();
    dir.subVectors(this.controls.target, this.camera.position).normalize();
    return dir;
  }

  /**
   * Set camera field of view
   */
  setFOV(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Get current field of view
   */
  getFOV(): number {
    return this.camera.fov;
  }

  /**
   * Cleanup
   */
  destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    this.controls.dispose();
  }

  // Legacy methods for compatibility (no-ops or minimal implementation)
  rotate(_deltaYaw: number, _deltaPitch: number): void {
    // OrbitControls handles rotation via mouse drag
  }

  startManualOrbit(): void {
    // Not needed - OrbitControls always allows orbiting
  }

  stopManualOrbit(): void {
    // Not needed
  }

  orbitManual(_deltaYaw: number, _deltaPitch: number): void {
    // OrbitControls handles this
  }

  isInManualOrbit(): boolean {
    return false;
  }
}
