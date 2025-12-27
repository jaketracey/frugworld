/**
 * Terrain Worker Module
 * Web Worker for off-thread terrain generation
 */

export {
  TerrainWorkerManager,
  type WorkerManagerConfig,
} from './TerrainWorkerManager';

export type {
  GenerateRequest,
  GenerateResponse,
  BatchGenerateRequest,
  BatchGenerateResponse,
  CancelRequest,
  ErrorResponse,
  StatusRequest,
  StatusResponse,
  WorkerRequest,
  WorkerResponse,
} from './types';
