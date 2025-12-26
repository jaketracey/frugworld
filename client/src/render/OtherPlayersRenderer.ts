/**
 * OtherPlayersRenderer - Renders other human players in the world
 * Shows simplified ball characters with name labels above them
 */

import * as THREE from 'three';

const OTHER_PLAYER_RADIUS = 0.5;

interface OtherPlayerMesh {
  group: THREE.Group;
  ballMesh: THREE.Mesh;
  nameLabelSprite: THREE.Sprite;
  name: string;
}

export class OtherPlayersRenderer {
  private scene: THREE.Scene;
  private players: Map<number, OtherPlayerMesh> = new Map();

  // Shared materials for efficiency
  private ballMaterial: THREE.MeshStandardMaterial;
  private labelCanvas: HTMLCanvasElement;
  private labelContext: CanvasRenderingContext2D;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Create shared ball material (blue-green to differentiate from local player's green)
    this.ballMaterial = new THREE.MeshStandardMaterial({
      color: 0x4488cc, // Blue-ish
      roughness: 0.4,
      metalness: 0.1,
    });

    // Create reusable canvas for name labels
    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.width = 256;
    this.labelCanvas.height = 64;
    this.labelContext = this.labelCanvas.getContext('2d')!;
  }

  /**
   * Add or update a player at the given position
   */
  updatePlayer(entityId: number, name: string, x: number, y: number, z: number): void {
    let playerMesh = this.players.get(entityId);

    if (!playerMesh) {
      // Create new player mesh
      playerMesh = this.createPlayerMesh(name);
      this.players.set(entityId, playerMesh);
      this.scene.add(playerMesh.group);
    }

    // Update name if changed
    if (playerMesh.name !== name) {
      this.updateNameLabel(playerMesh, name);
    }

    // Update position - map game coords to Three.js (swap Y and Z)
    // Add ball radius to z for ground offset
    playerMesh.group.position.set(x, z + OTHER_PLAYER_RADIUS, y);
  }

  /**
   * Remove a player
   */
  removePlayer(entityId: number): void {
    const playerMesh = this.players.get(entityId);
    if (playerMesh) {
      this.scene.remove(playerMesh.group);
      playerMesh.ballMesh.geometry.dispose();
      playerMesh.nameLabelSprite.material.dispose();
      (playerMesh.nameLabelSprite.material as THREE.SpriteMaterial).map?.dispose();
      this.players.delete(entityId);
    }
  }

  /**
   * Create a new player mesh with name label
   */
  private createPlayerMesh(name: string): OtherPlayerMesh {
    const group = new THREE.Group();
    group.name = `other_player_${name}`;

    // Create ball
    const ballGeometry = new THREE.SphereGeometry(OTHER_PLAYER_RADIUS, 24, 16);
    const ballMesh = new THREE.Mesh(ballGeometry, this.ballMaterial);
    ballMesh.castShadow = true;
    ballMesh.receiveShadow = true;
    group.add(ballMesh);

    // Add a stripe for visual interest
    const stripeGeometry = new THREE.TorusGeometry(OTHER_PLAYER_RADIUS * 0.8, 0.04, 8, 24);
    const stripeMaterial = new THREE.MeshStandardMaterial({
      color: 0x336699,
      roughness: 0.5,
    });
    const stripeMesh = new THREE.Mesh(stripeGeometry, stripeMaterial);
    stripeMesh.rotation.x = Math.PI / 2;
    ballMesh.add(stripeMesh);

    // Add simple eyes
    const eyeGeometry = new THREE.SphereGeometry(0.08, 12, 8);
    const eyeWhiteMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eyePupilGeometry = new THREE.SphereGeometry(0.04, 8, 6);
    const eyePupilMaterial = new THREE.MeshBasicMaterial({ color: 0x111111 });

    // Left eye
    const leftEye = new THREE.Mesh(eyeGeometry, eyeWhiteMaterial);
    leftEye.position.set(-0.15, OTHER_PLAYER_RADIUS * 0.7, 0.15);
    leftEye.scale.set(1, 1, 0.6);
    ballMesh.add(leftEye);

    const leftPupil = new THREE.Mesh(eyePupilGeometry, eyePupilMaterial);
    leftPupil.position.set(-0.15, OTHER_PLAYER_RADIUS * 0.8, 0.18);
    ballMesh.add(leftPupil);

    // Right eye
    const rightEye = new THREE.Mesh(eyeGeometry.clone(), eyeWhiteMaterial.clone());
    rightEye.position.set(0.15, OTHER_PLAYER_RADIUS * 0.7, 0.15);
    rightEye.scale.set(1, 1, 0.6);
    ballMesh.add(rightEye);

    const rightPupil = new THREE.Mesh(eyePupilGeometry.clone(), eyePupilMaterial.clone());
    rightPupil.position.set(0.15, OTHER_PLAYER_RADIUS * 0.8, 0.18);
    ballMesh.add(rightPupil);

    // Create name label sprite
    const nameLabelSprite = this.createNameLabelSprite(name);
    nameLabelSprite.position.set(0, OTHER_PLAYER_RADIUS + 0.8, 0);
    group.add(nameLabelSprite);

    return {
      group,
      ballMesh,
      nameLabelSprite,
      name,
    };
  }

  /**
   * Create a sprite with the player's name
   */
  private createNameLabelSprite(name: string): THREE.Sprite {
    // Draw name on canvas
    const ctx = this.labelContext;
    ctx.clearRect(0, 0, this.labelCanvas.width, this.labelCanvas.height);

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    const textWidth = ctx.measureText(name).width;
    const bgWidth = Math.min(textWidth + 20, this.labelCanvas.width);
    const bgX = (this.labelCanvas.width - bgWidth) / 2;
    ctx.roundRect(bgX, 15, bgWidth, 34, 8);
    ctx.fill();

    // Text
    ctx.font = 'bold 24px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#4ade80'; // Green matching minimap
    ctx.fillText(name, this.labelCanvas.width / 2, 32);

    // Create texture and sprite
    const texture = new THREE.CanvasTexture(this.labelCanvas);
    texture.needsUpdate = true;

    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(2, 0.5, 1); // Aspect ratio of canvas

    return sprite;
  }

  /**
   * Update the name label for a player
   */
  private updateNameLabel(playerMesh: OtherPlayerMesh, name: string): void {
    playerMesh.name = name;

    // Dispose old sprite resources
    playerMesh.nameLabelSprite.material.dispose();
    (playerMesh.nameLabelSprite.material as THREE.SpriteMaterial).map?.dispose();

    // Create new sprite
    const newSprite = this.createNameLabelSprite(name);
    newSprite.position.copy(playerMesh.nameLabelSprite.position);

    // Replace in group
    playerMesh.group.remove(playerMesh.nameLabelSprite);
    playerMesh.group.add(newSprite);
    playerMesh.nameLabelSprite = newSprite;
  }

  /**
   * Get number of players being rendered
   */
  getPlayerCount(): number {
    return this.players.size;
  }

  /**
   * Cleanup all resources
   */
  destroy(): void {
    for (const [entityId] of this.players) {
      this.removePlayer(entityId);
    }
    this.ballMaterial.dispose();
  }
}
