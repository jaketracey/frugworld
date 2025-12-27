/**
 * LOD-based NPC rendering with PS1-style 3D models
 * LOD0: Full 3D model
 * LOD1: Simplified 3D model (or same as LOD0)
 * LOD2: Billboard sprite
 * LOD3: Not rendered
 */

import * as THREE from 'three';
import { LODTier } from '@/types/protocol.ts';
import type { Entity } from '@/ecs/Entity.ts';
import type { LODTransitionState } from '@/ecs/LODComponent.ts';
import type { NPCType } from '@/npc/NPCTypes.ts';
import { npcModelManager } from './NPCModelManager.ts';
import { archetypeIdToNPCType } from '@/npc/NPCVisualConfig.ts';
import type { TerrainHeightProvider } from '@/terrain/index.ts';

export interface NPCRenderConfig {
  baseColor: number;
}

// Fallback geometries for NPCs (used when models fail to load)
const FALLBACK_LOD0_GEOMETRY = new THREE.CapsuleGeometry(0.4, 1.2, 8, 16);
const FALLBACK_LOD1_GEOMETRY = new THREE.CapsuleGeometry(0.4, 1.2, 4, 8);

// Height offset for NPCs to sit on terrain (bottom of model to ground)
const NPC_HEIGHT_OFFSET = 1.0;

export class NPCRenderer {
  private scene: THREE.Scene;
  private renderObjects: Map<number, NPCRenderObject> = new Map();

  // Terrain provider for ground collision
  private terrainProvider: TerrainHeightProvider | null = null;

  // Shared fallback materials (used when models fail to load)
  private fallbackMaterial: THREE.MeshStandardMaterial;
  private fallbackBillboardMaterial: THREE.SpriteMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Create fallback materials (PS1 style)
    this.fallbackMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a7c4e, // Green for NPCs
      roughness: 0.9,
      metalness: 0.0,
      flatShading: true,
    });

    this.fallbackBillboardMaterial = new THREE.SpriteMaterial({
      color: 0x4a7c4e,
      sizeAttenuation: true,
    });
  }

  /**
   * Preload all NPC models
   */
  async preloadModels(): Promise<void> {
    await npcModelManager.preloadAll();
    console.log('[NPCRenderer] NPC models preloaded');
  }

  /**
   * Set terrain provider for ground collision
   * NPCs will be positioned on top of terrain
   */
  setTerrainProvider(provider: TerrainHeightProvider): void {
    this.terrainProvider = provider;
  }

  /**
   * Create or update render object for an entity
   */
  updateEntity(entity: Entity): void {
    const transitionState = entity.lod.getTransitionState();
    let renderObj = this.renderObjects.get(entity.id);

    if (!renderObj) {
      // Create new render object with proper NPC type from archetype
      const npcType = archetypeIdToNPCType(entity.archetypeId);
      renderObj = this.createRenderObject(entity.id, npcType);
      this.renderObjects.set(entity.id, renderObj);
    }

    // Update LOD representation with crossfade
    this.updateLODRepresentationWithCrossfade(renderObj, transitionState);

    // Update transform - map game coords to Three.js (swap Y and Z)
    // Game: X=right, Y=forward, Z=up
    // Three.js: X=right, Y=up, Z=forward
    const t = entity.transform.getInterpolated();

    // Sample terrain height and position NPC on top of terrain
    // This ensures NPCs don't clip into rolling hills
    let groundZ = t.z;
    if (this.terrainProvider) {
      const terrainHeight = this.terrainProvider.getHeightAt(t.x, t.y);
      groundZ = Math.max(t.z, terrainHeight + NPC_HEIGHT_OFFSET);
    }

    renderObj.group.position.set(t.x, groundZ, t.y); // Y/Z swapped, model handles own offset
    // Adjust yaw for coordinate system: game uses atan2(dy,dx) where 0°=+X, 90°=+Y(forward)
    // Three.js rotation.y: 0°=+Z(forward), 90°=-X. Subtract π/2 to align.
    renderObj.group.rotation.y = t.yaw - Math.PI / 2;
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

  private createRenderObject(entityId: number, npcType: NPCType): NPCRenderObject {
    const group = new THREE.Group();
    group.name = `npc_${entityId}`;

    // Get model from manager (or fallback to capsule)
    const model = npcModelManager.cloneForEntity(npcType);
    model.visible = false;
    model.name = 'lod0';
    group.add(model);

    // For LOD1, use the same model (or could use a simplified version)
    // Currently we reuse the same model for both LOD0 and LOD1
    const lod1Model = npcModelManager.cloneForEntity(npcType);
    lod1Model.visible = false;
    lod1Model.name = 'lod1';
    group.add(lod1Model);

    // Create LOD2 billboard with character texture
    const billboardTexture = npcModelManager.getBillboardTexture(npcType);
    const billboardMaterial = billboardTexture
      ? new THREE.SpriteMaterial({
          map: billboardTexture,
          sizeAttenuation: true,
          transparent: true,
        })
      : this.fallbackBillboardMaterial.clone();

    const billboard = new THREE.Sprite(billboardMaterial);
    billboard.scale.set(1, 2, 1);
    billboard.visible = false;
    billboard.name = 'lod2';
    group.add(billboard);

    this.scene.add(group);

    return {
      entityId,
      group,
      lod0Mesh: model as THREE.Mesh,
      lod1Mesh: lod1Model as THREE.Mesh,
      billboard,
      currentLOD: LODTier.LOD3_Offline,
      npcType,
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
    this.applyMeshAlpha(obj.lod0Mesh, alpha);
    this.applyMeshAlpha(obj.lod1Mesh, alpha);
    this.applySpriteAlpha(obj.billboard, alpha);

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

    // Performance optimization: Only LOD0 (closest NPCs) cast shadows
    // This significantly reduces shadow map rendering cost on integrated GPUs
    const shouldCastShadow = currentLOD === LODTier.LOD0_Interactive;
    this.setMeshCastShadow(obj.lod0Mesh, shouldCastShadow);
    this.setMeshCastShadow(obj.lod1Mesh, false); // LOD1 never casts shadows

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
   * Apply alpha to a mesh or Object3D material
   * Materials are cloned on-demand when opacity < 1 to allow per-NPC transitions
   * while sharing materials for fully opaque NPCs
   */
  private applyMeshAlpha(obj: THREE.Object3D, alpha: number): void {
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        let material = mesh.material as THREE.MeshStandardMaterial;

        if (alpha < 1) {
          // Clone material if it's shared (hasn't been cloned for this mesh yet)
          // We mark cloned materials with a custom property
          if (!(material as THREE.MeshStandardMaterial & { _isClonedForOpacity?: boolean })._isClonedForOpacity) {
            const clonedMaterial = material.clone() as THREE.MeshStandardMaterial & { _isClonedForOpacity?: boolean };
            clonedMaterial._isClonedForOpacity = true;
            mesh.material = clonedMaterial;
            material = clonedMaterial;
          }
          material.opacity = alpha;
          material.transparent = true;
        } else {
          material.opacity = 1;
          material.transparent = false;
        }
      }
    });
  }

  /**
   * Apply alpha to a sprite material
   */
  private applySpriteAlpha(sprite: THREE.Sprite, alpha: number): void {
    const material = sprite.material as THREE.SpriteMaterial;
    material.opacity = alpha;
  }

  /**
   * Set castShadow for all meshes in an Object3D
   * Used for LOD-based shadow optimization
   */
  private setMeshCastShadow(obj: THREE.Object3D, castShadow: boolean): void {
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        (child as THREE.Mesh).castShadow = castShadow;
      }
    });
  }

  private disposeRenderObject(obj: NPCRenderObject): void {
    // Dispose cloned materials from loaded models
    obj.lod0Mesh.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    });

    obj.lod1Mesh.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    });

    (obj.billboard.material as THREE.Material).dispose();
  }
}

interface NPCRenderObject {
  entityId: number;
  group: THREE.Group;
  lod0Mesh: THREE.Mesh | THREE.Object3D;
  lod1Mesh: THREE.Mesh | THREE.Object3D;
  billboard: THREE.Sprite;
  currentLOD: LODTier;
  npcType?: NPCType;
}
