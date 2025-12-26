/**
 * LOD-based NPC rendering (Section 20B.5)
 * LOD0: High fidelity mesh
 * LOD1: Simplified mesh
 * LOD2: Billboard sprite
 * LOD3: Not rendered
 */

import * as THREE from 'three';
import { LODTier } from '@/types/protocol.ts';
import type { Entity } from '@/ecs/Entity.ts';
import type { LODTransitionState } from '@/ecs/LODComponent.ts';

export interface NPCRenderConfig {
  lod0Geometry: THREE.BufferGeometry;
  lod1Geometry: THREE.BufferGeometry;
  billboardTexture: THREE.Texture | null;
  baseColor: number;
}

// Default geometries for NPCs
const DEFAULT_LOD0_GEOMETRY = new THREE.CapsuleGeometry(0.4, 1.2, 8, 16);
const DEFAULT_LOD1_GEOMETRY = new THREE.CapsuleGeometry(0.4, 1.2, 4, 8);
const DEFAULT_BILLBOARD_GEOMETRY = new THREE.PlaneGeometry(1, 2);

export class NPCRenderer {
  private scene: THREE.Scene;
  private renderObjects: Map<number, NPCRenderObject> = new Map();

  // Shared materials (instancing optimization)
  private lod0Material: THREE.MeshStandardMaterial;
  private lod1Material: THREE.MeshStandardMaterial;
  private billboardMaterial: THREE.SpriteMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Create shared materials
    this.lod0Material = new THREE.MeshStandardMaterial({
      color: 0x4a7c4e, // Green for NPCs
      roughness: 0.8,
      metalness: 0.1,
    });

    this.lod1Material = new THREE.MeshStandardMaterial({
      color: 0x4a7c4e,
      roughness: 0.9,
      metalness: 0.0,
    });

    this.billboardMaterial = new THREE.SpriteMaterial({
      color: 0x4a7c4e,
      sizeAttenuation: true,
    });
  }

  /**
   * Create or update render object for an entity
   */
  updateEntity(entity: Entity): void {
    const transitionState = entity.lod.getTransitionState();
    let renderObj = this.renderObjects.get(entity.id);

    if (!renderObj) {
      // Create new render object
      renderObj = this.createRenderObject(entity.id);
      this.renderObjects.set(entity.id, renderObj);
    }

    // Update LOD representation with crossfade
    this.updateLODRepresentationWithCrossfade(renderObj, transitionState);

    // Update transform - map game coords to Three.js (swap Y and Z)
    // Game: X=right, Y=forward, Z=up
    // Three.js: X=right, Y=up, Z=forward
    const t = entity.transform.getInterpolated();
    renderObj.group.position.set(t.x, t.z + 0.8, t.y); // Y/Z swapped, offset for capsule center
    renderObj.group.rotation.y = t.yaw; // Rotation around Y axis (up) in Three.js
  }

  /**
   * Remove entity render object
   */
  removeEntity(entityId: number): void {
    const renderObj = this.renderObjects.get(entityId);
    if (renderObj) {
      this.scene.remove(renderObj.group);
      this.disposeRenderObject(renderObj);
      this.renderObjects.delete(entityId);
    }
  }

  /**
   * Clear all render objects
   */
  clear(): void {
    for (const [id, obj] of this.renderObjects) {
      this.scene.remove(obj.group);
      this.disposeRenderObject(obj);
    }
    this.renderObjects.clear();
  }

  /**
   * Get render statistics
   */
  getStats(): {
    total: number;
    byLOD: Record<number, number>;
  } {
    const stats = {
      total: this.renderObjects.size,
      byLOD: { 0: 0, 1: 0, 2: 0, 3: 0 } as Record<number, number>,
    };

    for (const obj of this.renderObjects.values()) {
      stats.byLOD[obj.currentLOD]++;
    }

    return stats;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createRenderObject(entityId: number): NPCRenderObject {
    const group = new THREE.Group();
    group.name = `npc_${entityId}`;

    // Create LOD0 mesh (high detail)
    const lod0Mesh = new THREE.Mesh(
      DEFAULT_LOD0_GEOMETRY,
      this.lod0Material.clone()
    );
    lod0Mesh.castShadow = true;
    lod0Mesh.receiveShadow = true;
    lod0Mesh.visible = false;
    lod0Mesh.name = 'lod0';
    group.add(lod0Mesh);

    // Create LOD1 mesh (simplified)
    const lod1Mesh = new THREE.Mesh(
      DEFAULT_LOD1_GEOMETRY,
      this.lod1Material.clone()
    );
    lod1Mesh.castShadow = true;
    lod1Mesh.visible = false;
    lod1Mesh.name = 'lod1';
    group.add(lod1Mesh);

    // Create LOD2 billboard
    const billboard = new THREE.Sprite(this.billboardMaterial.clone());
    billboard.scale.set(1, 2, 1);
    billboard.visible = false;
    billboard.name = 'lod2';
    group.add(billboard);

    this.scene.add(group);

    return {
      entityId,
      group,
      lod0Mesh,
      lod1Mesh,
      billboard,
      currentLOD: LODTier.LOD3_Offline,
    };
  }

  private updateLODRepresentation(
    obj: NPCRenderObject,
    lod: LODTier,
    alpha: number
  ): void {
    // Update visibility based on LOD
    obj.lod0Mesh.visible = lod === LODTier.LOD0_Interactive && alpha > 0.01;
    obj.lod1Mesh.visible = lod === LODTier.LOD1_Nearby && alpha > 0.01;
    obj.billboard.visible = lod === LODTier.LOD2_Far && alpha > 0.01;

    // Update opacity for fade transitions
    if (alpha < 1) {
      (obj.lod0Mesh.material as THREE.MeshStandardMaterial).opacity = alpha;
      (obj.lod0Mesh.material as THREE.MeshStandardMaterial).transparent =
        true;
      (obj.lod1Mesh.material as THREE.MeshStandardMaterial).opacity = alpha;
      (obj.lod1Mesh.material as THREE.MeshStandardMaterial).transparent =
        true;
      (obj.billboard.material as THREE.SpriteMaterial).opacity = alpha;
    } else {
      (obj.lod0Mesh.material as THREE.MeshStandardMaterial).opacity = 1;
      (obj.lod0Mesh.material as THREE.MeshStandardMaterial).transparent =
        false;
      (obj.lod1Mesh.material as THREE.MeshStandardMaterial).opacity = 1;
      (obj.lod1Mesh.material as THREE.MeshStandardMaterial).transparent =
        false;
      (obj.billboard.material as THREE.SpriteMaterial).opacity = 1;
    }

    obj.currentLOD = lod;
  }

  /**
   * Update LOD with crossfade transition between meshes
   * Per Section 4 and Section 22: "LOD transitions occur without visible popping"
   */
  private updateLODRepresentationWithCrossfade(
    obj: NPCRenderObject,
    state: LODTransitionState
  ): void {
    const { currentLOD, previousLOD, currentAlpha, previousAlpha, isTransitioning } = state;

    // During transition, show both current and previous LOD with crossfade
    if (isTransitioning && previousLOD !== LODTier.LOD3_Offline) {
      // Previous LOD mesh (fading out)
      this.setMeshVisibilityAndAlpha(obj, previousLOD, previousAlpha, true);
      // Current LOD mesh (fading in)
      this.setMeshVisibilityAndAlpha(obj, currentLOD, currentAlpha, false);
    } else {
      // No transition, show only current LOD
      obj.lod0Mesh.visible = currentLOD === LODTier.LOD0_Interactive && currentAlpha > 0.01;
      obj.lod1Mesh.visible = currentLOD === LODTier.LOD1_Nearby && currentAlpha > 0.01;
      obj.billboard.visible = currentLOD === LODTier.LOD2_Far && currentAlpha > 0.01;

      // Apply alpha
      this.applyMeshAlpha(obj.lod0Mesh, currentAlpha);
      this.applyMeshAlpha(obj.lod1Mesh, currentAlpha);
      this.applySpriteAlpha(obj.billboard, currentAlpha);
    }

    obj.currentLOD = currentLOD;
  }

  /**
   * Set visibility and alpha for a specific LOD level during crossfade
   */
  private setMeshVisibilityAndAlpha(
    obj: NPCRenderObject,
    lod: LODTier,
    alpha: number,
    isPrevious: boolean
  ): void {
    const visible = alpha > 0.01;

    switch (lod) {
      case LODTier.LOD0_Interactive:
        obj.lod0Mesh.visible = visible;
        this.applyMeshAlpha(obj.lod0Mesh, alpha);
        if (!isPrevious) {
          // Only hide non-active LODs for current, not previous
          if (obj.lod1Mesh.visible && !this.isLODInTransition(obj, LODTier.LOD1_Nearby)) {
            obj.lod1Mesh.visible = false;
          }
          if (obj.billboard.visible && !this.isLODInTransition(obj, LODTier.LOD2_Far)) {
            obj.billboard.visible = false;
          }
        }
        break;
      case LODTier.LOD1_Nearby:
        obj.lod1Mesh.visible = visible;
        this.applyMeshAlpha(obj.lod1Mesh, alpha);
        if (!isPrevious) {
          if (obj.lod0Mesh.visible && !this.isLODInTransition(obj, LODTier.LOD0_Interactive)) {
            obj.lod0Mesh.visible = false;
          }
          if (obj.billboard.visible && !this.isLODInTransition(obj, LODTier.LOD2_Far)) {
            obj.billboard.visible = false;
          }
        }
        break;
      case LODTier.LOD2_Far:
        obj.billboard.visible = visible;
        this.applySpriteAlpha(obj.billboard, alpha);
        if (!isPrevious) {
          if (obj.lod0Mesh.visible && !this.isLODInTransition(obj, LODTier.LOD0_Interactive)) {
            obj.lod0Mesh.visible = false;
          }
          if (obj.lod1Mesh.visible && !this.isLODInTransition(obj, LODTier.LOD1_Nearby)) {
            obj.lod1Mesh.visible = false;
          }
        }
        break;
      case LODTier.LOD3_Offline:
        // No rendering for offline
        break;
    }
  }

  /**
   * Check if a LOD is part of the current transition
   */
  private isLODInTransition(obj: NPCRenderObject, lod: LODTier): boolean {
    // This is a simplified check - in practice we track this in LODComponent
    return false;
  }

  /**
   * Apply alpha to a mesh material
   */
  private applyMeshAlpha(mesh: THREE.Mesh, alpha: number): void {
    const material = mesh.material as THREE.MeshStandardMaterial;
    if (alpha < 1) {
      material.opacity = alpha;
      material.transparent = true;
    } else {
      material.opacity = 1;
      material.transparent = false;
    }
  }

  /**
   * Apply alpha to a sprite material
   */
  private applySpriteAlpha(sprite: THREE.Sprite, alpha: number): void {
    const material = sprite.material as THREE.SpriteMaterial;
    material.opacity = alpha;
  }

  private disposeRenderObject(obj: NPCRenderObject): void {
    // Dispose cloned materials
    (obj.lod0Mesh.material as THREE.Material).dispose();
    (obj.lod1Mesh.material as THREE.Material).dispose();
    (obj.billboard.material as THREE.Material).dispose();
  }
}

interface NPCRenderObject {
  entityId: number;
  group: THREE.Group;
  lod0Mesh: THREE.Mesh;
  lod1Mesh: THREE.Mesh;
  billboard: THREE.Sprite;
  currentLOD: LODTier;
}
