/**
 * Render module exports
 */

export { SceneManager } from './SceneManager.ts';
export type { SceneConfig } from './SceneManager.ts';

export { CameraController } from './CameraController.ts';
export type { CameraConfig } from './CameraController.ts';

export { NPCRenderer } from './NPCRenderer.ts';
export type { NPCRenderConfig } from './NPCRenderer.ts';

export { ChunkRenderer } from './ChunkRenderer.ts';
export type { ChunkRenderConfig } from './ChunkRenderer.ts';

export { PlayerRenderer } from './PlayerRenderer.ts';

export { OtherPlayersRenderer } from './OtherPlayersRenderer.ts';

export { DayNightCycle } from './DayNightCycle.ts';
export type { DayNightConfig, TimeOfDay } from './DayNightCycle.ts';

export { WeatherSystem, WeatherState } from './WeatherSystem.ts';
export type { WeatherConfig, WeatherInfo, WeatherEventData } from './WeatherSystem.ts';

export {
  tronMaterialManager,
  createTronTerrainMaterial,
  TRON_BIOME_COLORS,
  TronMaterialManager,
} from './TronTerrainMaterial.ts';
export type { TronMaterialOptions } from './TronTerrainMaterial.ts';
