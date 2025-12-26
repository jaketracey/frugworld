/**
 * MinimapUI - Displays player position and other players on a radar-style minimap
 * Shows the local player at center and tracks other human players in the world
 */

export interface MinimapConfig {
  /** Radius of the minimap in world units (meters) */
  viewRadius: number;
  /** Update rate in milliseconds */
  updateRateMs: number;
}

export interface PlayerMarker {
  entityId: number;
  name: string;
  x: number;
  y: number;
  isLocal: boolean;
}

const DEFAULT_CONFIG: MinimapConfig = {
  viewRadius: 200, // 200 meters radius
  updateRateMs: 100, // 10 updates per second
};

export class MinimapUI {
  private config: MinimapConfig;
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  // Player tracking
  private localPlayer: PlayerMarker | null = null;
  private otherPlayers: Map<number, PlayerMarker> = new Map();
  private localEntityId: number | null = null;

  // Canvas dimensions
  private canvasSize: number = 140;
  private centerOffset: number = 70;

  // Update timing
  private lastUpdate: number = 0;

  constructor(config: Partial<MinimapConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the minimap UI by creating the canvas inside the existing minimap container
   */
  initialize(): void {
    const minimapContent = document.querySelector('.minimap-content');
    if (!minimapContent) {
      console.warn('MinimapUI: Could not find .minimap-content element');
      return;
    }

    // Remove the placeholder player dot
    const placeholder = minimapContent.querySelector('.minimap-player');
    if (placeholder) {
      placeholder.remove();
    }

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvasSize;
    this.canvas.height = this.canvasSize;
    this.canvas.style.cssText = `
      width: 100%;
      height: 100%;
    `;

    minimapContent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.container = minimapContent as HTMLElement;

    // Initial render
    this.render();
  }

  /**
   * Set the local player's entity ID
   */
  setLocalPlayerId(entityId: number): void {
    this.localEntityId = entityId;
  }

  /**
   * Update local player position
   */
  updateLocalPlayer(x: number, y: number): void {
    this.localPlayer = {
      entityId: this.localEntityId ?? 0,
      name: 'You',
      x,
      y,
      isLocal: true,
    };
  }

  /**
   * Update or add a remote player
   */
  updatePlayer(entityId: number, name: string, x: number, y: number): void {
    // Skip if this is the local player
    if (entityId === this.localEntityId) {
      return;
    }

    this.otherPlayers.set(entityId, {
      entityId,
      name,
      x,
      y,
      isLocal: false,
    });
  }

  /**
   * Remove a player (disconnected)
   */
  removePlayer(entityId: number): void {
    this.otherPlayers.delete(entityId);
  }

  /**
   * Get the count of other players
   */
  getOtherPlayerCount(): number {
    return this.otherPlayers.size;
  }

  /**
   * Update and render the minimap (called from game loop)
   */
  update(): void {
    const now = performance.now();
    if (now - this.lastUpdate < this.config.updateRateMs) {
      return;
    }
    this.lastUpdate = now;
    this.render();
  }

  /**
   * Render the minimap
   */
  private render(): void {
    if (!this.ctx || !this.canvas) return;

    const ctx = this.ctx;
    const size = this.canvasSize;
    const center = this.centerOffset;

    // Clear canvas
    ctx.clearRect(0, 0, size, size);

    // Draw background with subtle radial gradient
    const bgGradient = ctx.createRadialGradient(center, center, 0, center, center, center);
    bgGradient.addColorStop(0, 'rgba(74, 158, 255, 0.08)');
    bgGradient.addColorStop(0.7, 'rgba(74, 158, 255, 0.03)');
    bgGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, size, size);

    // Draw range rings
    ctx.strokeStyle = 'rgba(74, 158, 255, 0.15)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(center, center, (center / 3) * i, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw cardinal direction lines
    ctx.strokeStyle = 'rgba(74, 158, 255, 0.1)';
    ctx.beginPath();
    ctx.moveTo(center, 0);
    ctx.lineTo(center, size);
    ctx.moveTo(0, center);
    ctx.lineTo(size, center);
    ctx.stroke();

    // Draw other players relative to local player
    if (this.localPlayer) {
      const localX = this.localPlayer.x;
      const localY = this.localPlayer.y;

      for (const player of this.otherPlayers.values()) {
        // Calculate relative position
        const dx = player.x - localX;
        const dy = player.y - localY;

        // Convert to minimap coordinates
        // Scale: viewRadius meters = center pixels
        const scale = center / this.config.viewRadius;
        let mapX = center + dx * scale;
        let mapY = center - dy * scale; // Invert Y for screen coords

        // Clamp to minimap bounds with some margin
        const margin = 8;
        const clampedDistance = Math.sqrt(
          Math.pow(mapX - center, 2) + Math.pow(mapY - center, 2)
        );

        if (clampedDistance > center - margin) {
          // Scale to edge of minimap
          const angle = Math.atan2(mapY - center, mapX - center);
          mapX = center + Math.cos(angle) * (center - margin);
          mapY = center + Math.sin(angle) * (center - margin);
        }

        // Draw player marker (green dot for other players)
        this.drawPlayerMarker(ctx, mapX, mapY, player.name, false);
      }
    }

    // Draw local player at center (always on top)
    this.drawPlayerMarker(ctx, center, center, 'You', true);

    // Draw north indicator
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', center, 12);
  }

  /**
   * Draw a player marker at the given position
   */
  private drawPlayerMarker(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    name: string,
    isLocal: boolean
  ): void {
    const markerSize = isLocal ? 6 : 5;

    if (isLocal) {
      // Local player: bright blue with glow
      ctx.shadowColor = 'rgba(74, 158, 255, 0.8)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#4a9eff';
    } else {
      // Other players: green with subtle glow
      ctx.shadowColor = 'rgba(74, 222, 128, 0.6)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = '#4ade80';
    }

    // Draw marker
    ctx.beginPath();
    ctx.arc(x, y, markerSize, 0, Math.PI * 2);
    ctx.fill();

    // Reset shadow for text
    ctx.shadowBlur = 0;

    // Draw name label for non-local players
    if (!isLocal && name) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(name, x, y - 10);
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.canvas && this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
    this.canvas = null;
    this.ctx = null;
    this.container = null;
  }
}
