/**
 * Heightmap Module
 * Precomputed terrain heightmap system with caching
 */

// Data types
export {
  HEIGHTMAP_VERSION,
  CHUNK_SIZE,
  HEIGHTMAP_RESOLUTION,
  SAMPLES_PER_EDGE,
  TOTAL_SAMPLES,
  DEFAULT_GENERATION_CONFIG,
  createEmptyHeightmap,
  calculateHeightmapSize,
  getHeightSample,
  getNormalSample,
  getInterpolatedHeight,
  getInterpolatedNormal,
  type HeightmapData,
  type HeightmapCompact,
  type HeightmapMetadata,
  type HeightmapGenerationConfig,
} from './HeightmapData';

// Serialization
export {
  serializeHeightmap,
  serializeCompact,
  deserializeHeightmap,
  deserializeCompact,
  generateNormalsFromHeights,
  validateHeightmap,
} from './HeightmapSerializer';

// Generation
export {
  ROLLING_HILLS_STYLE,
  DRAMATIC_HILLS_STYLE,
  GENTLE_PLAINS_STYLE,
  generateHeightAt,
  generateHeightmap,
  generateHeightmapWithBiome,
  generateHeightsOnly,
  generateHeightmapBatch,
  type TerrainStyle,
} from './HeightmapGenerator';

// Caching
export {
  HeightmapMemoryCache,
  type MemoryCacheConfig,
} from './HeightmapCache';

export {
  HeightmapStorage,
  type StorageConfig,
} from './HeightmapStorage';

export {
  HeightmapCacheManager,
  type CacheManagerConfig,
  type LoadState,
} from './HeightmapCacheManager';
