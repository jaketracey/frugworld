/**
 * ECS module exports
 */

export { Entity } from './Entity.ts';
export type { EntityComponents } from './Entity.ts';

export { EntityManager } from './EntityManager.ts';
export type {
  EntitySpawnCallback,
  EntityDespawnCallback,
} from './EntityManager.ts';

export { TransformComponent } from './TransformComponent.ts';
export type {
  TransformSnapshot,
  InterpolatedTransform,
} from './TransformComponent.ts';

export { LODComponent } from './LODComponent.ts';
export type { LODConfig, LODTransitionState } from './LODComponent.ts';
