/**
 * NPC Visual Configuration
 * Maps NPC types to 3D models and visual settings
 */

import { NPCType } from './NPCTypes.ts';

/**
 * Configuration for an NPC's visual appearance
 */
export interface NPCModelConfig {
  /** Name of the GLB model file (without extension) */
  modelName: string;
  /** Name of the billboard texture for LOD2 (without extension) */
  billboardTexture: string;
  /** Scale factor for the model */
  scale: number;
  /** Y offset to place model correctly on ground */
  yOffset: number;
  /** Optional tint color to differentiate from base model (hex) */
  tintColor?: number;
}

/**
 * Available base models (generated via AI)
 * These are the 8 core PS1-style character models
 */
export enum NPCModelGroup {
  VillagerMale = 'villager_male',
  VillagerFemale = 'villager_female',
  Merchant = 'merchant',
  Guard = 'guard',
  Farmer = 'farmer',
  Blacksmith = 'blacksmith',
  Priest = 'priest',
  Wanderer = 'wanderer',
}

/**
 * Default model configuration
 */
const DEFAULT_CONFIG: Omit<NPCModelConfig, 'modelName' | 'billboardTexture'> = {
  scale: 2.0,  // Seed3D models are ~1 unit tall, scale up for game world
  yOffset: 0,
};

/**
 * Visual configuration for each NPC type
 * Maps 18+ NPC types to 8 base models with color/scale variations
 */
export const NPC_VISUAL_CONFIGS: Map<NPCType, NPCModelConfig> = new Map([
  // Core villager types - use villager models
  [NPCType.Villager, {
    ...DEFAULT_CONFIG,
    modelName: NPCModelGroup.VillagerMale,
    billboardTexture: 'villager_male_billboard',
  }],

  // Farmer - uses dedicated farmer model
  [NPCType.Farmer, {
    ...DEFAULT_CONFIG,
    modelName: NPCModelGroup.Farmer,
    billboardTexture: 'farmer_billboard',
    tintColor: 0xD2B48C, // Tan tint for earthy look
  }],

  // Merchant - uses dedicated merchant model
  [NPCType.Merchant, {
    ...DEFAULT_CONFIG,
    modelName: NPCModelGroup.Merchant,
    billboardTexture: 'merchant_billboard',
    scale: 1.1, // Slightly larger
    tintColor: 0xFFD700, // Gold tint for wealthy look
  }],

  // Blacksmith - uses dedicated blacksmith model
  [NPCType.Blacksmith, {
    ...DEFAULT_CONFIG,
    modelName: NPCModelGroup.Blacksmith,
    billboardTexture: 'blacksmith_billboard',
    scale: 1.15, // Larger, muscular
    tintColor: 0x8B4513, // Dark brown (soot)
  }],

  // Guard - uses dedicated guard model
  [NPCType.Guard, {
    ...DEFAULT_CONFIG,
    modelName: NPCModelGroup.Guard,
    billboardTexture: 'guard_billboard',
    scale: 1.1,
    tintColor: 0xC0C0C0, // Silver armor
  }],

  // Innkeeper - uses merchant model with different tint
  [NPCType.Innkeeper, {
    ...DEFAULT_CONFIG,
    modelName: NPCModelGroup.Merchant,
    billboardTexture: 'merchant_billboard',
    scale: 1.05,
    tintColor: 0x8B0000, // Dark red apron
  }],

  // Priest - uses dedicated priest model
  [NPCType.Priest, {
    ...DEFAULT_CONFIG,
    modelName: NPCModelGroup.Priest,
    billboardTexture: 'priest_billboard',
    tintColor: 0xFFFFFF, // White robes
  }],

  // Healer - uses priest model with green tint
  [NPCType.Healer, {
    ...DEFAULT_CONFIG,
    modelName: NPCModelGroup.Priest,
    billboardTexture: 'priest_billboard',
    tintColor: 0x90EE90, // Light green (healing herbs)
  }],

  // Wanderer - uses dedicated wanderer model
  [NPCType.Wanderer, {
    ...DEFAULT_CONFIG,
    modelName: NPCModelGroup.Wanderer,
    billboardTexture: 'wanderer_billboard',
    tintColor: 0x8B4513, // Brown cloak
  }],

  // Hermit - uses wanderer model with darker tint
  [NPCType.Hermit, {
    ...DEFAULT_CONFIG,
    modelName: NPCModelGroup.Wanderer,
    billboardTexture: 'wanderer_billboard',
    scale: 0.95, // Slightly smaller, hunched
    tintColor: 0x556B2F, // Dark olive (forest colors)
  }],

  // Noble - uses villager female model with rich colors
  [NPCType.Noble, {
    ...DEFAULT_CONFIG,
    modelName: NPCModelGroup.VillagerFemale,
    billboardTexture: 'villager_female_billboard',
    scale: 1.05,
    tintColor: 0x800080, // Purple (royalty)
  }],

  // Beggar - uses wanderer model with grey tint
  [NPCType.Beggar, {
    ...DEFAULT_CONFIG,
    modelName: NPCModelGroup.Wanderer,
    billboardTexture: 'wanderer_billboard',
    scale: 0.9, // Smaller, frail
    tintColor: 0x696969, // Dim grey (rags)
  }],

  // Fisher - uses farmer model with blue tint
  [NPCType.Fisher, {
    ...DEFAULT_CONFIG,
    modelName: NPCModelGroup.Farmer,
    billboardTexture: 'farmer_billboard',
    tintColor: 0x4682B4, // Steel blue (water/fish)
  }],

  // Hunter - uses wanderer model with forest tint
  [NPCType.Hunter, {
    ...DEFAULT_CONFIG,
    modelName: NPCModelGroup.Wanderer,
    billboardTexture: 'wanderer_billboard',
    scale: 1.05,
    tintColor: 0x228B22, // Forest green
  }],

  // Miner - uses blacksmith model with grey tint
  [NPCType.Miner, {
    ...DEFAULT_CONFIG,
    modelName: NPCModelGroup.Blacksmith,
    billboardTexture: 'blacksmith_billboard',
    tintColor: 0x696969, // Dim grey (stone/coal dust)
  }],

  // Woodcutter - uses farmer model with brown tint
  [NPCType.Woodcutter, {
    ...DEFAULT_CONFIG,
    modelName: NPCModelGroup.Farmer,
    billboardTexture: 'farmer_billboard',
    scale: 1.1, // Muscular
    tintColor: 0x8B4513, // Saddle brown (wood)
  }],

  // Baker - uses villager female model with warm tint
  [NPCType.Baker, {
    ...DEFAULT_CONFIG,
    modelName: NPCModelGroup.VillagerFemale,
    billboardTexture: 'villager_female_billboard',
    tintColor: 0xDEB887, // Burlywood (flour/bread)
  }],

  // Brewer - uses merchant model with amber tint
  [NPCType.Brewer, {
    ...DEFAULT_CONFIG,
    modelName: NPCModelGroup.Merchant,
    billboardTexture: 'merchant_billboard',
    tintColor: 0xDAA520, // Goldenrod (beer)
  }],
]);

/**
 * Get visual configuration for an NPC type
 * Falls back to default villager if type not found
 */
export function getVisualConfig(npcType: NPCType): NPCModelConfig {
  const config = NPC_VISUAL_CONFIGS.get(npcType);
  if (config) {
    return config;
  }

  // Default fallback to villager male
  return {
    modelName: NPCModelGroup.VillagerMale,
    billboardTexture: 'villager_male_billboard',
    scale: 1.0,
    yOffset: 0,
  };
}

/**
 * Get all unique model names used
 */
export function getUniqueModelNames(): string[] {
  const names = new Set<string>();
  for (const config of NPC_VISUAL_CONFIGS.values()) {
    names.add(config.modelName);
  }
  return Array.from(names);
}

/**
 * Map archetype ID (from server) to NPCType
 * The server sends an integer archetype_id, this maps it to our NPCType enum
 */
export function archetypeIdToNPCType(archetypeId: number): NPCType {
  const mapping: Record<number, NPCType> = {
    0: NPCType.Villager,
    1: NPCType.Farmer,
    2: NPCType.Merchant,
    3: NPCType.Blacksmith,
    4: NPCType.Guard,
    5: NPCType.Innkeeper,
    6: NPCType.Priest,
    7: NPCType.Healer,
    8: NPCType.Wanderer,
    9: NPCType.Hermit,
    10: NPCType.Noble,
    11: NPCType.Beggar,
    12: NPCType.Fisher,
    13: NPCType.Hunter,
    14: NPCType.Miner,
    15: NPCType.Woodcutter,
    16: NPCType.Baker,
    17: NPCType.Brewer,
  };

  return mapping[archetypeId] ?? NPCType.Villager;
}
