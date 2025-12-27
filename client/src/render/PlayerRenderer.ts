/**
 * Player rendering - "Frug" ball character like Super Monkey Ball
 */

import * as THREE from 'three';

export const BALL_RADIUS = 0.6;

export class PlayerRenderer {
  private scene: THREE.Scene;
  private group: THREE.Group;
  private ballMesh: THREE.Mesh;
  private stripeMesh: THREE.Mesh;
  private eyeGroup: THREE.Group;
  private camera: THREE.Camera | null = null;
  private canvas: HTMLCanvasElement | null = null;

  // Rolling animation state
  private rollAngleX: number = 0;
  private rollAngleY: number = 0;
  private lastX: number = 0;
  private lastY: number = 0;

  // NPC proximity glow effect
  private glowMesh: THREE.Mesh | null = null;
  private glowMaterial: THREE.MeshBasicMaterial | null = null;
  private npcProximityIntensity: number = 0; // 0 = no NPC nearby, 1 = very close
  private glowPulsePhase: number = 0;

  // Mouse tracking for eye following
  private mouseX: number = 0;
  private mouseY: number = 0;
  private mouseHandler: ((e: MouseEvent) => void) | null = null;

  // Base pupil positions (relative to eye centers)
  private leftPupilBasePos = new THREE.Vector3(-0.2, BALL_RADIUS * 0.95, 0.18);
  private rightPupilBasePos = new THREE.Vector3(0.2, BALL_RADIUS * 0.95, 0.18);
  private leftEyeCenter = new THREE.Vector3(-0.2, BALL_RADIUS * 0.85, 0.15);
  private rightEyeCenter = new THREE.Vector3(0.2, BALL_RADIUS * 0.85, 0.15);

  // Eye references for blinking
  private leftEye: THREE.Mesh;
  private rightEye: THREE.Mesh;
  private leftPupil: THREE.Mesh;
  private rightPupil: THREE.Mesh;

  // Blink animation state
  private blinkTimer: number = 0;
  private nextBlinkTime: number = 1000 + Math.random() * 2000; // 1-3 seconds
  private blinkProgress: number = 0; // 0 = not blinking, 0-1 during blink
  private isBlinking: boolean = false;

  // Idle animation state
  private idleTime: number = 0;
  private idleState: 'normal' | 'balloon' | 'pancake' | 'spring' | 'wobble' | 'spin' = 'normal';
  private idleStateTime: number = 0;
  private idleTransitionProgress: number = 0;
  private spinAngle: number = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Create player group (for position)
    this.group = new THREE.Group();
    this.group.name = 'frug_ball';

    // Create main ball sphere
    const ballGeometry = new THREE.SphereGeometry(BALL_RADIUS, 32, 24);
    const ballMaterial = new THREE.MeshStandardMaterial({
      color: 0x44bb66, // Frog green
      roughness: 0.3,
      metalness: 0.1,
    });
    this.ballMesh = new THREE.Mesh(ballGeometry, ballMaterial);
    // Ball center is at group origin - BALL_RADIUS offset is applied in group position
    this.ballMesh.position.set(0, 0, 0);
    this.ballMesh.castShadow = true;
    this.ballMesh.receiveShadow = true;
    this.group.add(this.ballMesh);

    // Add stripe/band around the ball for visual roll feedback
    const stripeGeometry = new THREE.TorusGeometry(BALL_RADIUS * 0.85, 0.05, 8, 32);
    const stripeMaterial = new THREE.MeshStandardMaterial({
      color: 0x227744,
      roughness: 0.5,
    });
    this.stripeMesh = new THREE.Mesh(stripeGeometry, stripeMaterial);
    this.stripeMesh.rotation.x = Math.PI / 2;
    this.ballMesh.add(this.stripeMesh);

    // Add cute eyes to make it a character
    this.eyeGroup = new THREE.Group();

    // Left eye
    const eyeGeometry = new THREE.SphereGeometry(0.12, 16, 12);
    const eyeWhiteMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const eyePupilMaterial = new THREE.MeshStandardMaterial({ color: 0x111111 });

    this.leftEye = new THREE.Mesh(eyeGeometry, eyeWhiteMaterial);
    this.leftEye.position.set(-0.2, BALL_RADIUS * 0.85, 0.15);
    this.leftEye.scale.set(1, 1, 0.6);
    this.eyeGroup.add(this.leftEye);

    this.leftPupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 12, 8),
      eyePupilMaterial
    );
    this.leftPupil.position.set(-0.2, BALL_RADIUS * 0.95, 0.18);
    this.eyeGroup.add(this.leftPupil);

    // Right eye
    this.rightEye = new THREE.Mesh(eyeGeometry.clone(), eyeWhiteMaterial.clone());
    this.rightEye.position.set(0.2, BALL_RADIUS * 0.85, 0.15);
    this.rightEye.scale.set(1, 1, 0.6);
    this.eyeGroup.add(this.rightEye);

    this.rightPupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 12, 8),
      eyePupilMaterial.clone()
    );
    this.rightPupil.position.set(0.2, BALL_RADIUS * 0.95, 0.18);
    this.eyeGroup.add(this.rightPupil);

    // Add eyes to ballMesh so they roll with the ball
    // Pupils will be offset to follow the cursor
    this.ballMesh.add(this.eyeGroup);

    // Add a subtle static glow/highlight
    const staticGlowGeometry = new THREE.SphereGeometry(BALL_RADIUS * 0.3, 16, 12);
    const staticGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0xaaffbb,
      transparent: true,
      opacity: 0.3,
    });
    const staticGlow = new THREE.Mesh(staticGlowGeometry, staticGlowMaterial);
    staticGlow.position.set(-0.2, 0.3, 0.2);
    this.ballMesh.add(staticGlow);

    // Add NPC proximity glow sphere (larger, surrounds the ball)
    const proximityGlowGeometry = new THREE.SphereGeometry(BALL_RADIUS * 1.3, 32, 24);
    this.glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x66ffaa, // Cyan-green glow
      transparent: true,
      opacity: 0,
      side: THREE.BackSide, // Render inside so it appears as outer glow
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.glowMesh = new THREE.Mesh(proximityGlowGeometry, this.glowMaterial);
    this.glowMesh.position.set(0, 0, 0); // Centered on ball (group position includes offset)
    this.group.add(this.glowMesh);

    this.scene.add(this.group);
  }

  /**
   * Update player visual position with rolling animation
   * Note: Game coords (x,y,z) map to Three.js (x, z, y) because Three.js uses Y-up
   * Physics z already includes ball radius offset, so we use it directly
   */
  update(x: number, y: number, z: number, yaw: number): void {
    // Calculate movement delta for rolling
    const dx = x - this.lastX;
    const dy = y - this.lastY;

    // Roll based on movement (rotation around axis perpendicular to movement)
    // For a ball of radius r moving distance d, it rotates d/r radians
    const rollSpeed = 1.0 / BALL_RADIUS;
    this.rollAngleX += dy * rollSpeed;
    this.rollAngleY -= dx * rollSpeed;

    // Apply position - map game coords to Three.js (swap Y and Z)
    // Game: X=right, Y=forward, Z=up
    // Three.js: X=right, Y=up, Z=forward
    // Physics z already includes ball radius, so use directly
    this.group.position.set(x, z, y);

    // Apply rolling rotation to the ball mesh
    // Create rotation from roll angles
    const euler = new THREE.Euler(this.rollAngleX, 0, this.rollAngleY, 'XYZ');
    this.ballMesh.rotation.copy(euler);

    // Store for next frame
    this.lastX = x;
    this.lastY = y;
  }

  /**
   * Update with velocity for smoother animation
   * Note: Game coords (x,y,z) map to Three.js (x, z, y) because Three.js uses Y-up
   * Physics z already includes ball radius offset, so we use it directly
   */
  updateWithVelocity(x: number, y: number, z: number, vx: number, vy: number): void {
    // Apply position - map game coords to Three.js (swap Y and Z)
    // Game: X=right, Y=forward, Z=up
    // Three.js: X=right, Y=up, Z=forward
    // Physics z already includes ball radius, so use directly
    this.group.position.set(x, z, y);

    // Calculate realistic roll based on velocity
    // For a rolling ball: angular velocity = linear velocity / radius
    // But we need to scale down since velocity is high and we're accumulating per frame
    // At 60fps with velocity in m/s, we want rotation per frame
    const deltaTime = 1 / 60; // Approximate frame time
    const angularVelocityX = vy / BALL_RADIUS; // radians per second
    const angularVelocityY = -vx / BALL_RADIUS;

    // Apply rotation with frame time scaling
    this.rollAngleX += angularVelocityX * deltaTime;
    this.rollAngleY += angularVelocityY * deltaTime;

    // Keep angles in reasonable range to prevent floating point issues
    const TWO_PI = Math.PI * 2;
    this.rollAngleX = this.rollAngleX % TWO_PI;
    this.rollAngleY = this.rollAngleY % TWO_PI;

    // Apply rolling rotation
    const euler = new THREE.Euler(this.rollAngleX, 0, this.rollAngleY, 'XYZ');
    this.ballMesh.rotation.copy(euler);
  }

  /**
   * Set NPC proximity intensity for glow effect
   * @param intensity 0 = no NPC nearby, 1 = very close (at interaction range)
   */
  setNpcProximity(intensity: number): void {
    this.npcProximityIntensity = Math.max(0, Math.min(1, intensity));
  }

  /**
   * Update the proximity glow effect animation
   * Should be called each frame with delta time
   * @param deltaMs time since last frame in milliseconds
   */
  updateGlow(deltaMs: number): void {
    if (!this.glowMaterial || !this.glowMesh) return;

    // Update pulse phase (2-3 Hz pulsing when near NPC)
    const pulseSpeed = 0.008; // Radians per ms (~2.5 Hz at 2*PI cycle)
    this.glowPulsePhase += deltaMs * pulseSpeed;
    if (this.glowPulsePhase > Math.PI * 2) {
      this.glowPulsePhase -= Math.PI * 2;
    }

    // Calculate pulse factor (oscillates between 0.5 and 1.0)
    const pulseFactor = 0.75 + 0.25 * Math.sin(this.glowPulsePhase);

    // Apply intensity with pulse
    const finalIntensity = this.npcProximityIntensity * pulseFactor;

    // Update glow opacity (max 0.5 for subtle effect)
    this.glowMaterial.opacity = finalIntensity * 0.5;

    // Scale the glow mesh slightly with pulse for breathing effect
    const scaleBase = 1.0 + this.npcProximityIntensity * 0.15;
    const scalePulse = 1.0 + pulseFactor * 0.1 * this.npcProximityIntensity;
    const finalScale = scaleBase * scalePulse;
    this.glowMesh.scale.setScalar(finalScale);

    // Shift color from green to cyan as intensity increases
    // Green (0x66ffaa) -> Cyan (0x66ffff)
    const blueComponent = Math.floor(0xaa + (0xff - 0xaa) * this.npcProximityIntensity);
    this.glowMaterial.color.setHex(0x66ff00 + blueComponent);
  }

  /**
   * Update blink animation
   * Eyes close and open in a cute, frequent pattern
   */
  private updateBlink(deltaMs: number): void {
    this.blinkTimer += deltaMs;

    if (!this.isBlinking) {
      // Check if it's time to blink
      if (this.blinkTimer >= this.nextBlinkTime) {
        this.isBlinking = true;
        this.blinkProgress = 0;
        this.blinkTimer = 0;
      }
    } else {
      // Animate the blink (150ms total: 60ms close, 30ms hold, 60ms open)
      const blinkDuration = 150;
      this.blinkProgress += deltaMs / blinkDuration;

      if (this.blinkProgress >= 1) {
        // Blink complete
        this.isBlinking = false;
        this.blinkProgress = 0;
        // Schedule next blink (1-3 seconds for frequent cute blinks)
        this.nextBlinkTime = 1000 + Math.random() * 2000;
      }
    }

    // Calculate eye scale based on blink progress
    let eyeScaleY = 1.0;
    if (this.isBlinking) {
      // Smooth blink curve: fast close, brief hold, fast open
      if (this.blinkProgress < 0.4) {
        // Closing (0 to 0.4)
        eyeScaleY = 1.0 - (this.blinkProgress / 0.4) * 0.9;
      } else if (this.blinkProgress < 0.6) {
        // Holding closed (0.4 to 0.6)
        eyeScaleY = 0.1;
      } else {
        // Opening (0.6 to 1.0)
        eyeScaleY = 0.1 + ((this.blinkProgress - 0.6) / 0.4) * 0.9;
      }
    }

    // Apply to eyes (they have base scale of (1, 1, 0.6))
    this.leftEye.scale.y = eyeScaleY;
    this.rightEye.scale.y = eyeScaleY;
    // Pupils scale with eyes
    this.leftPupil.scale.y = eyeScaleY;
    this.rightPupil.scale.y = eyeScaleY;
  }

  /**
   * Update idle animations - silly shape transformations when not moving
   */
  private updateIdle(deltaMs: number, isMoving: boolean): void {
    const idleThreshold = 6000; // 6 seconds before first idle animation
    const stateDuration = 3500; // 3.5 seconds per idle state
    const transitionDuration = 500; // 0.5 second smooth transitions

    if (isMoving) {
      // Reset to normal when moving
      this.idleTime = 0;
      if (this.idleState !== 'normal') {
        this.idleState = 'normal';
        this.idleTransitionProgress = 0;
      }
      // Smoothly return to normal scale
      this.ballMesh.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
      this.spinAngle = 0;
      return;
    }

    this.idleTime += deltaMs;
    this.idleStateTime += deltaMs;

    // Don't start idle animations until threshold
    if (this.idleTime < idleThreshold) {
      return;
    }

    // Progress through states
    if (this.idleStateTime >= stateDuration) {
      this.idleStateTime = 0;
      this.idleTransitionProgress = 0;
      // Cycle to next state
      const states: Array<typeof this.idleState> = ['balloon', 'pancake', 'spring', 'wobble', 'spin'];
      const currentIndex = states.indexOf(this.idleState);
      this.idleState = states[(currentIndex + 1) % states.length];
    }

    // Update transition progress
    this.idleTransitionProgress = Math.min(1, this.idleStateTime / transitionDuration);
    const t = this.easeInOutCubic(this.idleTransitionProgress);

    // Calculate target scale based on state
    let targetScale = new THREE.Vector3(1, 1, 1);
    const time = this.idleStateTime / 1000; // Time in seconds for oscillations

    switch (this.idleState) {
      case 'balloon':
        // Inflate with gentle wobble
        const inflate = 1.3 + Math.sin(time * 3) * 0.05;
        targetScale.set(inflate, inflate, inflate);
        break;

      case 'pancake':
        // Squash flat
        targetScale.set(1.4, 0.5, 1.4);
        break;

      case 'spring':
        // Stretch tall with bounce
        const bounce = Math.sin(time * 6) * 0.15;
        targetScale.set(0.7, 1.5 + bounce, 0.7);
        break;

      case 'wobble':
        // Jelly-like oscillation
        const wobbleX = 1 + Math.sin(time * 4) * 0.2;
        const wobbleY = 1 + Math.sin(time * 4 + Math.PI / 2) * 0.2;
        const wobbleZ = 1 + Math.sin(time * 4 + Math.PI) * 0.2;
        targetScale.set(wobbleX, wobbleY, wobbleZ);
        break;

      case 'spin':
        // Fast spin that slows down
        const spinSpeed = Math.max(0, 15 - time * 4); // Slows from 15 to ~1 rad/s
        this.spinAngle += spinSpeed * (deltaMs / 1000);
        // Apply extra Y rotation for spin (preserving roll rotation)
        targetScale.set(1, 1, 1);
        break;
    }

    // Smoothly interpolate scale
    this.ballMesh.scale.lerp(targetScale, t * 0.15);

    // Apply spin rotation if in spin state
    if (this.idleState === 'spin') {
      // Add spin to existing roll rotation
      const euler = new THREE.Euler(
        this.rollAngleX,
        this.spinAngle,
        this.rollAngleY,
        'XYZ'
      );
      this.ballMesh.rotation.copy(euler);
    }
  }

  /**
   * Easing function for smooth transitions
   */
  private easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /**
   * Update all character animations
   * @param deltaMs time since last frame in milliseconds
   * @param isMoving whether the character is currently moving
   */
  updateAnimations(deltaMs: number, isMoving: boolean): void {
    this.updateBlink(deltaMs);
    this.updateIdle(deltaMs, isMoving);
    this.updateEyeFacing();
  }

  /**
   * Set camera and canvas reference for cursor-following behavior
   */
  setCamera(camera: THREE.Camera, canvas?: HTMLCanvasElement): void {
    this.camera = camera;

    // Set up mouse tracking if canvas provided
    if (canvas && !this.canvas) {
      this.canvas = canvas;
      this.mouseHandler = (e: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        // Normalize to -1 to 1
        this.mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      };
      canvas.addEventListener('mousemove', this.mouseHandler);
    }
  }

  /**
   * Update pupils to follow the cursor
   * Eyes roll with the ball, but pupils subtly shift toward cursor
   */
  private updateEyeFacing(): void {
    if (!this.camera || !this.canvas) return;

    // Create a raycaster from mouse position
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(this.mouseX, this.mouseY), this.camera);

    // Find where the ray intersects a plane at Frug's height
    const frugWorldPos = new THREE.Vector3();
    this.group.getWorldPosition(frugWorldPos);

    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -frugWorldPos.y);
    const cursorWorldPos = new THREE.Vector3();
    raycaster.ray.intersectPlane(groundPlane, cursorWorldPos);

    if (!cursorWorldPos) return;

    // Get direction from Frug to cursor in world space
    const dirToCursor = new THREE.Vector3()
      .subVectors(cursorWorldPos, frugWorldPos)
      .normalize();

    // Convert to local space of the ball (accounting for ball rotation)
    const localDir = dirToCursor.clone();
    const ballWorldQuat = new THREE.Quaternion();
    this.ballMesh.getWorldQuaternion(ballWorldQuat);
    localDir.applyQuaternion(ballWorldQuat.invert());

    // Calculate pupil offset (max 0.04 units from center of eye)
    const maxOffset = 0.04;
    const offsetX = localDir.x * maxOffset;
    const offsetY = localDir.y * maxOffset * 0.5; // Less vertical movement
    const offsetZ = Math.max(0, localDir.z * maxOffset * 0.3); // Slight forward when looking at camera

    // Apply offset to left pupil
    this.leftPupil.position.set(
      this.leftPupilBasePos.x + offsetX,
      this.leftPupilBasePos.y + offsetY,
      this.leftPupilBasePos.z + offsetZ
    );

    // Apply offset to right pupil
    this.rightPupil.position.set(
      this.rightPupilBasePos.x + offsetX,
      this.rightPupilBasePos.y + offsetY,
      this.rightPupilBasePos.z + offsetZ
    );
  }

  /**
   * Get player group for camera targeting
   */
  getGroup(): THREE.Group {
    return this.group;
  }

  /**
   * Get ball radius for physics
   */
  getRadius(): number {
    return BALL_RADIUS;
  }

  /**
   * Set visibility (for first-person mode)
   */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /**
   * Cleanup
   */
  destroy(): void {
    // Remove mouse listener
    if (this.canvas && this.mouseHandler) {
      this.canvas.removeEventListener('mousemove', this.mouseHandler);
    }

    this.scene.remove(this.group);
    this.ballMesh.geometry.dispose();
    (this.ballMesh.material as THREE.Material).dispose();
    this.stripeMesh.geometry.dispose();
    (this.stripeMesh.material as THREE.Material).dispose();
    if (this.glowMesh) {
      this.glowMesh.geometry.dispose();
      this.glowMaterial?.dispose();
    }
  }
}
