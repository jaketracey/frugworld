/**
 * MinimapUI - Displays player position and other players on a radar-style minimap
 * Shows the local player at center and tracks other human players in the world
 * Features expandable view with legend and additional details
 * Supports resizing via edge handles and dragging via header
 */

import { animate, spring } from '@motionone/dom';

export interface MinimapConfig {
  /** Radius of the minimap in world units (meters) */
  viewRadius: number;
  /** Radius when expanded */
  expandedViewRadius: number;
  /** Update rate in milliseconds */
  updateRateMs: number;
  /** Minimum width of the minimap */
  minWidth: number;
  /** Minimum height of the minimap */
  minHeight: number;
  /** Maximum width of the minimap */
  maxWidth: number;
  /** Maximum height of the minimap */
  maxHeight: number;
}

export interface PlayerMarker {
  entityId: number;
  name: string;
  x: number;
  y: number;
  isLocal: boolean;
}

export interface NpcMarker {
  entityId: number;
  name: string;
  x: number;
  y: number;
}

export interface PoiMarker {
  id: string;
  name: string;
  type: 'village' | 'dungeon' | 'landmark' | 'shop' | 'quest';
  x: number;
  y: number;
}

const DEFAULT_CONFIG: MinimapConfig = {
  viewRadius: 200, // 200 meters radius
  expandedViewRadius: 500, // 500 meters when expanded
  updateRateMs: 100, // 10 updates per second
  minWidth: 180,
  minHeight: 180,
  maxWidth: 500,
  maxHeight: 600,
};

type ResizeDirection = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | null;

// New game-style colors
const COLORS = {
  player: '#fbbf24',
  playerGlow: 'rgba(251, 191, 36, 0.6)',
  otherPlayer: '#4ade80',
  otherPlayerGlow: 'rgba(74, 222, 128, 0.5)',
  npc: '#a78bfa',
  npcGlow: 'rgba(167, 139, 250, 0.5)',
  poi: '#f472b6',
  poiGlow: 'rgba(244, 114, 182, 0.5)',
  ring: 'rgba(139, 92, 246, 0.2)',
  cardinal: 'rgba(139, 92, 246, 0.15)',
  bgGradientInner: 'rgba(139, 92, 246, 0.12)',
  bgGradientOuter: 'rgba(139, 92, 246, 0.02)',
  text: 'rgba(196, 181, 253, 0.8)',
  northIndicator: '#fbbf24',
};

export class MinimapUI {
  private config: MinimapConfig;
  private container: HTMLElement | null = null;
  private minimapContainer: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private headerElement: HTMLElement | null = null;

  // Player tracking
  private localPlayer: PlayerMarker | null = null;
  private otherPlayers: Map<number, PlayerMarker> = new Map();
  private npcs: Map<number, NpcMarker> = new Map();
  private pois: Map<string, PoiMarker> = new Map();
  private localEntityId: number | null = null;

  // Canvas dimensions
  private canvasSize: number = 200;
  private expandedCanvasSize: number = 420;
  private centerOffset: number = 100;

  // State
  private isExpanded: boolean = false;

  // Update timing
  private lastUpdate: number = 0;

  // Resize state
  private isResizing: boolean = false;
  private resizeDirection: ResizeDirection = null;
  private resizeStartX: number = 0;
  private resizeStartY: number = 0;
  private resizeStartWidth: number = 0;
  private resizeStartHeight: number = 0;
  private resizeStartTop: number = 0;
  private resizeStartRight: number = 0;
  private currentWidth: number = 240;
  private currentHeight: number = 240;

  // Drag state
  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private dragStartTop: number = 0;
  private dragStartRight: number = 0;
  private currentTop: number = 10;
  private currentRight: number = 20;

  // Resize handles
  private resizeHandles: HTMLElement[] = [];

  // Bound event handlers for cleanup
  private boundMouseMove: (e: MouseEvent) => void;
  private boundMouseUp: (e: MouseEvent) => void;

  constructor(config: Partial<MinimapConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.boundMouseMove = this.handleMouseMove.bind(this);
    this.boundMouseUp = this.handleMouseUp.bind(this);
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

    // Get references to container and overlay
    this.minimapContainer = document.getElementById('minimap-container');
    this.overlay = document.getElementById('minimap-overlay');
    this.headerElement = this.minimapContainer?.querySelector('.minimap-header') as HTMLElement;

    // Remove the placeholder player dot and expand hint for canvas rendering
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
      height: calc(100% - 20px);
      position: absolute;
      top: 0;
      left: 0;
    `;

    minimapContent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.container = minimapContent as HTMLElement;

    // Create resize handles
    this.createResizeHandles();

    // Setup click handlers for expand/collapse
    this.setupClickHandlers();

    // Setup resize and drag handlers
    this.setupResizeHandlers();
    this.setupDragHandler();

    // Initial render
    this.render();
  }

  /**
   * Create resize handles around the minimap edges
   */
  private createResizeHandles(): void {
    if (!this.minimapContainer) return;

    const directions: ResizeDirection[] = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];

    directions.forEach((dir) => {
      const handle = document.createElement('div');
      handle.className = `minimap-resize-handle minimap-resize-${dir}`;
      handle.dataset.direction = dir ?? '';
      this.minimapContainer!.appendChild(handle);
      this.resizeHandles.push(handle);
    });

    // Inject styles for resize handles
    this.injectResizeStyles();
  }

  /**
   * Inject CSS styles for resize handles
   */
  private injectResizeStyles(): void {
    const styleId = 'minimap-resize-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .minimap-resize-handle {
        position: absolute;
        z-index: 20;
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      #minimap-container:hover .minimap-resize-handle,
      #minimap-container.resizing .minimap-resize-handle {
        opacity: 1;
      }

      #minimap-container.expanded .minimap-resize-handle {
        display: none;
      }

      /* Edge handles */
      .minimap-resize-n, .minimap-resize-s {
        left: 20px;
        right: 20px;
        height: 8px;
        cursor: ns-resize;
      }

      .minimap-resize-e, .minimap-resize-w {
        top: 20px;
        bottom: 20px;
        width: 8px;
        cursor: ew-resize;
      }

      .minimap-resize-n { top: -4px; }
      .minimap-resize-s { bottom: -4px; }
      .minimap-resize-e { right: -4px; }
      .minimap-resize-w { left: -4px; }

      /* Corner handles */
      .minimap-resize-ne, .minimap-resize-nw,
      .minimap-resize-se, .minimap-resize-sw {
        width: 16px;
        height: 16px;
      }

      .minimap-resize-nw { top: -6px; left: -6px; cursor: nwse-resize; }
      .minimap-resize-ne { top: -6px; right: -6px; cursor: nesw-resize; }
      .minimap-resize-sw { bottom: -6px; left: -6px; cursor: nesw-resize; }
      .minimap-resize-se { bottom: -6px; right: -6px; cursor: nwse-resize; }

      /* Visual indicator on hover */
      .minimap-resize-handle:hover {
        background: rgba(139, 92, 246, 0.3);
        border-radius: 4px;
      }

      /* Corner visual indicators */
      .minimap-resize-nw:hover, .minimap-resize-ne:hover,
      .minimap-resize-sw:hover, .minimap-resize-se:hover {
        background: rgba(251, 191, 36, 0.4);
      }

      /* Draggable header cursor */
      #minimap-container:not(.expanded) .minimap-header {
        cursor: grab;
      }

      #minimap-container:not(.expanded) .minimap-header:active {
        cursor: grabbing;
      }

      #minimap-container.dragging .minimap-header {
        cursor: grabbing;
      }

      #minimap-container.resizing,
      #minimap-container.dragging {
        transition: none !important;
      }

      #minimap-container.resizing:hover,
      #minimap-container.dragging:hover {
        transform: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Setup resize event handlers
   */
  private setupResizeHandlers(): void {
    this.resizeHandles.forEach((handle) => {
      handle.addEventListener('mousedown', (e) => {
        if (this.isExpanded) return;
        e.preventDefault();
        e.stopPropagation();

        this.isResizing = true;
        this.resizeDirection = handle.dataset.direction as ResizeDirection;
        this.resizeStartX = e.clientX;
        this.resizeStartY = e.clientY;
        this.resizeStartWidth = this.currentWidth;
        this.resizeStartHeight = this.currentHeight;
        this.resizeStartTop = this.currentTop;
        this.resizeStartRight = this.currentRight;

        this.minimapContainer?.classList.add('resizing');
        document.addEventListener('mousemove', this.boundMouseMove);
        document.addEventListener('mouseup', this.boundMouseUp);
      });
    });
  }

  /**
   * Setup drag handler for the header
   */
  private setupDragHandler(): void {
    if (!this.headerElement) return;

    this.headerElement.addEventListener('mousedown', (e) => {
      if (this.isExpanded) return;
      // Don't start drag if clicking on close button or coords
      if ((e.target as HTMLElement).closest('.minimap-close, .minimap-coords')) return;

      e.preventDefault();

      this.isDragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragStartTop = this.currentTop;
      this.dragStartRight = this.currentRight;

      this.minimapContainer?.classList.add('dragging');
      document.addEventListener('mousemove', this.boundMouseMove);
      document.addEventListener('mouseup', this.boundMouseUp);
    });
  }

  /**
   * Handle mouse move for resize and drag operations
   */
  private handleMouseMove(e: MouseEvent): void {
    if (this.isResizing) {
      this.handleResize(e);
    } else if (this.isDragging) {
      this.handleDrag(e);
    }
  }

  /**
   * Handle resize mouse movement
   */
  private handleResize(e: MouseEvent): void {
    if (!this.minimapContainer || !this.resizeDirection) return;

    const deltaX = e.clientX - this.resizeStartX;
    const deltaY = e.clientY - this.resizeStartY;

    let newWidth = this.resizeStartWidth;
    let newHeight = this.resizeStartHeight;
    let newTop = this.resizeStartTop;
    let newRight = this.resizeStartRight;

    // Calculate new dimensions based on resize direction
    if (this.resizeDirection.includes('e')) {
      newWidth = this.resizeStartWidth - deltaX;
      newRight = this.resizeStartRight + deltaX;
    }
    if (this.resizeDirection.includes('w')) {
      newWidth = this.resizeStartWidth + deltaX;
    }
    if (this.resizeDirection.includes('s')) {
      newHeight = this.resizeStartHeight + deltaY;
    }
    if (this.resizeDirection.includes('n')) {
      newHeight = this.resizeStartHeight - deltaY;
      newTop = this.resizeStartTop + deltaY;
    }

    // Clamp to min/max
    newWidth = Math.max(this.config.minWidth, Math.min(this.config.maxWidth, newWidth));
    newHeight = Math.max(this.config.minHeight, Math.min(this.config.maxHeight, newHeight));

    // Adjust position if we hit the constraints
    if (this.resizeDirection.includes('n')) {
      newTop = this.resizeStartTop + (this.resizeStartHeight - newHeight);
    }
    if (this.resizeDirection.includes('e')) {
      newRight = this.resizeStartRight - (newWidth - this.resizeStartWidth);
    }

    // Ensure we don't go off-screen
    newTop = Math.max(0, newTop);
    newRight = Math.max(0, newRight);

    // Apply dimensions
    this.currentWidth = newWidth;
    this.currentHeight = newHeight;
    this.currentTop = newTop;
    this.currentRight = newRight;

    this.minimapContainer.style.width = `${newWidth}px`;
    this.minimapContainer.style.height = `${newHeight}px`;
    this.minimapContainer.style.top = `${newTop}px`;
    this.minimapContainer.style.right = `${newRight}px`;

    // Update canvas size proportionally
    this.updateCanvasSize();
  }

  /**
   * Handle drag mouse movement
   */
  private handleDrag(e: MouseEvent): void {
    if (!this.minimapContainer) return;

    const deltaX = e.clientX - this.dragStartX;
    const deltaY = e.clientY - this.dragStartY;

    let newTop = this.dragStartTop + deltaY;
    let newRight = this.dragStartRight - deltaX;

    // Keep within viewport bounds
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    newTop = Math.max(0, Math.min(viewportHeight - this.currentHeight, newTop));
    newRight = Math.max(0, Math.min(viewportWidth - this.currentWidth, newRight));

    this.currentTop = newTop;
    this.currentRight = newRight;

    this.minimapContainer.style.top = `${newTop}px`;
    this.minimapContainer.style.right = `${newRight}px`;
  }

  /**
   * Handle mouse up to end resize/drag operations
   */
  private handleMouseUp(): void {
    if (this.isResizing || this.isDragging) {
      // Animate to final position/size with spring
      if (this.minimapContainer) {
        animate(
          this.minimapContainer,
          { scale: [1.02, 1] },
          { duration: 0.3, easing: spring({ stiffness: 400, damping: 25 }) }
        );
      }
    }

    this.isResizing = false;
    this.isDragging = false;
    this.resizeDirection = null;

    this.minimapContainer?.classList.remove('resizing', 'dragging');
    document.removeEventListener('mousemove', this.boundMouseMove);
    document.removeEventListener('mouseup', this.boundMouseUp);
  }

  /**
   * Update canvas size based on current minimap dimensions
   */
  private updateCanvasSize(): void {
    if (!this.canvas) return;

    // Scale canvas to match container while maintaining quality
    const size = Math.min(this.currentWidth, this.currentHeight - 45); // Account for header
    this.canvasSize = Math.max(150, size);
    this.canvas.width = this.canvasSize;
    this.canvas.height = this.canvasSize;
    this.centerOffset = this.canvasSize / 2;

    this.render();
  }

  /**
   * Setup click handlers for expand/collapse functionality
   */
  private setupClickHandlers(): void {
    // Track if we moved during mousedown (to prevent expand on drag)
    let didMove = false;
    let startX = 0;
    let startY = 0;

    this.container?.addEventListener('mousedown', (e) => {
      didMove = false;
      startX = e.clientX;
      startY = e.clientY;
    });

    this.container?.addEventListener('mousemove', (e) => {
      if (Math.abs(e.clientX - startX) > 5 || Math.abs(e.clientY - startY) > 5) {
        didMove = true;
      }
    });

    // Click on minimap content to expand
    this.container?.addEventListener('click', (e) => {
      // Don't expand if we were dragging
      if (didMove) return;
      // Don't expand if clicking on close button
      if ((e.target as HTMLElement).classList.contains('minimap-close')) {
        return;
      }
      if (!this.isExpanded) {
        this.expand();
      }
    });

    // Close button
    const closeBtn = document.getElementById('minimap-close');
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.collapse();
    });

    // Click overlay to collapse
    this.overlay?.addEventListener('click', () => {
      this.collapse();
    });

    // Escape key to collapse
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isExpanded) {
        this.collapse();
      }
    });
  }

  /**
   * Expand the minimap to full view
   */
  expand(): void {
    if (this.isExpanded || !this.minimapContainer) return;
    this.isExpanded = true;

    // Clear inline position styles so CSS .expanded can take over for centering
    this.minimapContainer.style.top = '';
    this.minimapContainer.style.right = '';
    this.minimapContainer.style.left = '';
    this.minimapContainer.style.width = '';
    this.minimapContainer.style.height = '';
    this.minimapContainer.style.transform = '';

    this.minimapContainer.classList.add('expanded');
    this.overlay?.classList.add('visible');

    // Animate expansion with spring (use opacity only to avoid conflicting with CSS transform)
    animate(
      this.minimapContainer,
      {
        opacity: [0.8, 1],
      },
      {
        duration: 0.4,
        easing: spring({ stiffness: 300, damping: 20 }),
      }
    );

    // Calculate expanded canvas size based on viewport
    const maxWidth = Math.min(window.innerWidth * 0.9, 800);
    const maxHeight = Math.min(window.innerHeight * 0.85, 700);
    // Account for header (~45px) and legend (~100px when expanded)
    const availableHeight = maxHeight - 145;
    this.expandedCanvasSize = Math.min(maxWidth - 20, availableHeight);

    // Resize canvas for expanded view
    if (this.canvas) {
      this.canvas.width = this.expandedCanvasSize;
      this.canvas.height = this.expandedCanvasSize;
      this.centerOffset = this.expandedCanvasSize / 2;
    }

    this.render();
  }

  /**
   * Collapse the minimap back to mini view
   */
  collapse(): void {
    if (!this.isExpanded || !this.minimapContainer) return;
    this.isExpanded = false;

    // Animate collapse with spring
    animate(
      this.minimapContainer,
      {
        scale: [1.05, 1],
      },
      {
        duration: 0.3,
        easing: spring({ stiffness: 400, damping: 25 }),
      }
    );

    this.minimapContainer.classList.remove('expanded');
    this.overlay?.classList.remove('visible');

    // Restore custom position and size (reset left since expanded uses left: 50%)
    this.minimapContainer.style.left = 'auto';
    this.minimapContainer.style.width = `${this.currentWidth}px`;
    this.minimapContainer.style.height = `${this.currentHeight}px`;
    this.minimapContainer.style.top = `${this.currentTop}px`;
    this.minimapContainer.style.right = `${this.currentRight}px`;

    // Resize canvas back to normal
    if (this.canvas) {
      const size = Math.min(this.currentWidth, this.currentHeight - 45);
      this.canvasSize = Math.max(150, size);
      this.canvas.width = this.canvasSize;
      this.canvas.height = this.canvasSize;
      this.centerOffset = this.canvasSize / 2;
    }

    this.render();
  }

  /**
   * Check if minimap is currently expanded
   */
  getIsExpanded(): boolean {
    return this.isExpanded;
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
   * Update or add an NPC
   */
  updateNpc(entityId: number, name: string, x: number, y: number): void {
    this.npcs.set(entityId, { entityId, name, x, y });
  }

  /**
   * Remove an NPC
   */
  removeNpc(entityId: number): void {
    this.npcs.delete(entityId);
  }

  /**
   * Update or add a POI
   */
  updatePoi(id: string, name: string, type: PoiMarker['type'], x: number, y: number): void {
    this.pois.set(id, { id, name, type, x, y });
  }

  /**
   * Remove a POI
   */
  removePoi(id: string): void {
    this.pois.delete(id);
  }

  /**
   * Get the count of other players
   */
  getOtherPlayerCount(): number {
    return this.otherPlayers.size;
  }

  /**
   * Get the count of visible NPCs
   */
  getNpcCount(): number {
    return this.npcs.size;
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
    const size = this.isExpanded ? this.expandedCanvasSize : this.canvasSize;
    const center = this.centerOffset;
    const viewRadius = this.isExpanded ? this.config.expandedViewRadius : this.config.viewRadius;

    // Clear canvas
    ctx.clearRect(0, 0, size, size);

    // Draw background with subtle radial gradient (purple theme)
    const bgGradient = ctx.createRadialGradient(center, center, 0, center, center, center);
    bgGradient.addColorStop(0, COLORS.bgGradientInner);
    bgGradient.addColorStop(0.7, COLORS.bgGradientOuter);
    bgGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, size, size);

    // Draw range rings (more rings when expanded)
    ctx.strokeStyle = COLORS.ring;
    ctx.lineWidth = this.isExpanded ? 1.5 : 1;
    const ringCount = this.isExpanded ? 5 : 3;
    for (let i = 1; i <= ringCount; i++) {
      ctx.beginPath();
      ctx.arc(center, center, (center / ringCount) * i, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw cardinal direction lines
    ctx.strokeStyle = COLORS.cardinal;
    ctx.lineWidth = this.isExpanded ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(center, 0);
    ctx.lineTo(center, size);
    ctx.moveTo(0, center);
    ctx.lineTo(size, center);
    ctx.stroke();

    // Draw diagonal lines when expanded
    if (this.isExpanded) {
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.08)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(size, size);
      ctx.moveTo(size, 0);
      ctx.lineTo(0, size);
      ctx.stroke();
    }

    // Calculate scale for coordinate conversion
    const scale = center / viewRadius;

    // Draw entities relative to local player
    if (this.localPlayer) {
      const localX = this.localPlayer.x;
      const localY = this.localPlayer.y;

      // Draw POIs first (background layer)
      for (const poi of this.pois.values()) {
        const pos = this.worldToMinimap(poi.x - localX, poi.y - localY, scale, center);
        if (pos) {
          this.drawPoiMarker(ctx, pos.x, pos.y, poi.name, poi.type);
        }
      }

      // Draw NPCs
      for (const npc of this.npcs.values()) {
        const pos = this.worldToMinimap(npc.x - localX, npc.y - localY, scale, center);
        if (pos) {
          this.drawNpcMarker(ctx, pos.x, pos.y, npc.name);
        }
      }

      // Draw other players
      for (const player of this.otherPlayers.values()) {
        const pos = this.worldToMinimap(player.x - localX, player.y - localY, scale, center);
        if (pos) {
          this.drawPlayerMarker(ctx, pos.x, pos.y, player.name, false);
        }
      }
    }

    // Draw local player at center (always on top)
    this.drawPlayerMarker(ctx, center, center, 'You', true);

    // Draw north indicator
    ctx.fillStyle = COLORS.northIndicator;
    ctx.font = this.isExpanded ? 'bold 14px Fredoka, sans-serif' : 'bold 11px Fredoka, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(251, 191, 36, 0.5)';
    ctx.shadowBlur = 8;
    ctx.fillText('N', center, this.isExpanded ? 18 : 14);
    ctx.shadowBlur = 0;

    // Draw compass directions when expanded
    if (this.isExpanded) {
      ctx.fillStyle = COLORS.text;
      ctx.font = '12px Nunito, sans-serif';
      ctx.fillText('S', center, size - 8);
      ctx.fillText('W', 12, center + 4);
      ctx.fillText('E', size - 12, center + 4);
    }
  }

  /**
   * Convert world coordinates to minimap coordinates
   */
  private worldToMinimap(
    dx: number,
    dy: number,
    scale: number,
    center: number
  ): { x: number; y: number } | null {
    let mapX = center + dx * scale;
    let mapY = center - dy * scale; // Invert Y for screen coords

    // Clamp to minimap bounds with some margin
    const margin = this.isExpanded ? 12 : 8;
    const distance = Math.sqrt(Math.pow(mapX - center, 2) + Math.pow(mapY - center, 2));

    if (distance > center - margin) {
      // Scale to edge of minimap
      const angle = Math.atan2(mapY - center, mapX - center);
      mapX = center + Math.cos(angle) * (center - margin);
      mapY = center + Math.sin(angle) * (center - margin);
    }

    return { x: mapX, y: mapY };
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
    const markerSize = isLocal ? (this.isExpanded ? 10 : 7) : (this.isExpanded ? 7 : 5);

    if (isLocal) {
      // Local player: golden with glow
      ctx.shadowColor = COLORS.playerGlow;
      ctx.shadowBlur = this.isExpanded ? 15 : 10;

      // Draw outer ring
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, markerSize + 2, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = COLORS.player;
    } else {
      // Other players: green with subtle glow
      ctx.shadowColor = COLORS.otherPlayerGlow;
      ctx.shadowBlur = this.isExpanded ? 10 : 6;
      ctx.fillStyle = COLORS.otherPlayer;
    }

    // Draw marker
    ctx.beginPath();
    ctx.arc(x, y, markerSize, 0, Math.PI * 2);
    ctx.fill();

    // Reset shadow for text
    ctx.shadowBlur = 0;

    // Draw name label (always when expanded, only for non-local when not expanded)
    if (this.isExpanded || !isLocal) {
      if (name && (this.isExpanded || !isLocal)) {
        ctx.fillStyle = COLORS.text;
        ctx.font = this.isExpanded ? '11px Nunito, sans-serif' : '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(name, x, y - markerSize - 4);
      }
    }
  }

  /**
   * Draw an NPC marker at the given position
   */
  private drawNpcMarker(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    name: string
  ): void {
    const markerSize = this.isExpanded ? 6 : 4;

    ctx.shadowColor = COLORS.npcGlow;
    ctx.shadowBlur = this.isExpanded ? 8 : 5;
    ctx.fillStyle = COLORS.npc;

    // Draw diamond shape for NPCs
    ctx.beginPath();
    ctx.moveTo(x, y - markerSize);
    ctx.lineTo(x + markerSize, y);
    ctx.lineTo(x, y + markerSize);
    ctx.lineTo(x - markerSize, y);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;

    // Draw name when expanded
    if (this.isExpanded && name) {
      ctx.fillStyle = COLORS.text;
      ctx.font = '10px Nunito, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(name, x, y - markerSize - 4);
    }
  }

  /**
   * Draw a POI marker at the given position
   */
  private drawPoiMarker(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    name: string,
    type: PoiMarker['type']
  ): void {
    const markerSize = this.isExpanded ? 8 : 5;

    ctx.shadowColor = COLORS.poiGlow;
    ctx.shadowBlur = this.isExpanded ? 10 : 6;
    ctx.fillStyle = COLORS.poi;

    // Draw star shape for POIs
    const spikes = 4;
    const outerRadius = markerSize;
    const innerRadius = markerSize / 2;

    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i * Math.PI) / spikes - Math.PI / 2;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;

    // Draw name and icon when expanded
    if (this.isExpanded && name) {
      const icon = this.getPoiIcon(type);
      ctx.fillStyle = COLORS.text;
      ctx.font = '10px Nunito, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${icon} ${name}`, x, y - markerSize - 4);
    }
  }

  /**
   * Get emoji icon for POI type
   */
  private getPoiIcon(type: PoiMarker['type']): string {
    switch (type) {
      case 'village': return '🏘️';
      case 'dungeon': return '⚔️';
      case 'landmark': return '🗿';
      case 'shop': return '🛒';
      case 'quest': return '❗';
      default: return '📍';
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Remove event listeners
    document.removeEventListener('mousemove', this.boundMouseMove);
    document.removeEventListener('mouseup', this.boundMouseUp);

    // Remove resize handles
    this.resizeHandles.forEach((handle) => {
      handle.remove();
    });
    this.resizeHandles = [];

    // Remove injected styles
    const styleElement = document.getElementById('minimap-resize-styles');
    styleElement?.remove();

    if (this.canvas && this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
    this.canvas = null;
    this.ctx = null;
    this.container = null;
    this.headerElement = null;
    this.minimapContainer = null;
  }
}
