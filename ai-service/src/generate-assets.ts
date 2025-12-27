#!/usr/bin/env node
/**
 * Asset Generation Script
 * Generates all game assets using fal.ai
 *
 * Usage:
 *   npm run generate:assets              # Generate all assets
 *   npm run generate:assets -- --textures # Textures only
 *   npm run generate:assets -- --models   # 3D models only
 *   npm run generate:assets -- --fast     # Use fast model (lower quality)
 *   npm run generate:assets -- --biome grassland  # Specific biome
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
import {
  generateAllTextures,
  generateBiomeTextures,
  generateSkyboxTextures,
  generateTerrainTextures,
  generateEffectTextures,
  generateTronTextures,
  generateFoliageBillboards,
  generateAllModels,
  generatePropModels,
  generateNPCModels,
  generatePS1NPCModels,
  generateItemModels,
  generateStructureModels,
} from './asset-generators/index.js';
import { BIOMES, TIMES_OF_DAY, PROP_CATEGORIES, type BiomeKey, type TimeOfDayKey, type PropCategory } from './fal-client.js';

// Parse command line arguments
const args = process.argv.slice(2);

interface GenerationOptions {
  textures: boolean;
  models: boolean;
  fast: boolean;
  ps1Style: boolean;
  biome?: BiomeKey;
  time?: TimeOfDayKey;
  propCategory?: PropCategory;
  texturesOnly?: 'biomes' | 'skyboxes' | 'terrain' | 'effects' | 'tron' | 'foliage';
  modelsOnly?: 'props' | 'npcs' | 'items' | 'structures';
}

function parseArgs(): GenerationOptions {
  const options: GenerationOptions = {
    textures: false,
    models: false,
    fast: false,
    ps1Style: true, // Default to PS1 style for NPCs
  };

  // If no specific type is specified, generate everything
  if (!args.includes('--textures') && !args.includes('--models')) {
    options.textures = true;
    options.models = true;
  } else {
    options.textures = args.includes('--textures');
    options.models = args.includes('--models');
  }

  options.fast = args.includes('--fast');

  // Check for specific filters
  const biomeIdx = args.indexOf('--biome');
  if (biomeIdx !== -1 && args[biomeIdx + 1]) {
    const biome = args[biomeIdx + 1] as BiomeKey;
    if (biome in BIOMES) {
      options.biome = biome;
    }
  }

  const timeIdx = args.indexOf('--time');
  if (timeIdx !== -1 && args[timeIdx + 1]) {
    const time = args[timeIdx + 1] as TimeOfDayKey;
    if (time in TIMES_OF_DAY) {
      options.time = time;
    }
  }

  const propIdx = args.indexOf('--props');
  if (propIdx !== -1 && args[propIdx + 1]) {
    const category = args[propIdx + 1] as PropCategory;
    if (category in PROP_CATEGORIES) {
      options.propCategory = category;
    }
  }

  // Specific texture types
  if (args.includes('--biomes-only')) options.texturesOnly = 'biomes';
  if (args.includes('--skyboxes-only')) options.texturesOnly = 'skyboxes';
  if (args.includes('--terrain-only')) options.texturesOnly = 'terrain';
  if (args.includes('--effects-only')) options.texturesOnly = 'effects';
  if (args.includes('--tron')) options.texturesOnly = 'tron';
  if (args.includes('--foliage')) options.texturesOnly = 'foliage';

  // Specific model types
  if (args.includes('--props-only')) options.modelsOnly = 'props';
  if (args.includes('--npcs-only')) options.modelsOnly = 'npcs';
  if (args.includes('--items-only')) options.modelsOnly = 'items';
  if (args.includes('--structures-only')) options.modelsOnly = 'structures';

  return options;
}

async function main() {
  console.log('='.repeat(60));
  console.log('  Frugworld Asset Generator');
  console.log('  Using fal.ai for AI-powered asset generation');
  console.log('='.repeat(60));
  console.log();

  // Check for FAL_KEY
  if (!process.env.FAL_KEY) {
    console.error('ERROR: FAL_KEY environment variable is not set');
    console.error('Please set FAL_KEY in your .env file');
    process.exit(1);
  }

  const options = parseArgs();

  console.log('Generation options:');
  console.log(`  Textures: ${options.textures}`);
  console.log(`  Models: ${options.models}`);
  console.log(`  Fast mode: ${options.fast}`);
  if (options.biome) console.log(`  Biome filter: ${options.biome}`);
  if (options.time) console.log(`  Time filter: ${options.time}`);
  if (options.propCategory) console.log(`  Prop category: ${options.propCategory}`);
  console.log();

  const startTime = Date.now();
  const results: Record<string, unknown> = {};

  try {
    // Generate textures
    if (options.textures) {
      console.log('\n' + '='.repeat(40));
      console.log('  Generating Textures');
      console.log('='.repeat(40) + '\n');

      if (options.texturesOnly) {
        // Generate only specific texture type
        switch (options.texturesOnly) {
          case 'biomes':
            results.biomes = await generateBiomeTextures(options.biome ? [options.biome] : undefined);
            break;
          case 'skyboxes':
            results.skyboxes = await generateSkyboxTextures(options.time ? [options.time] : undefined);
            break;
          case 'terrain':
            results.terrain = await generateTerrainTextures();
            break;
          case 'effects':
            results.effects = await generateEffectTextures();
            break;
          case 'tron':
            results.tron = await generateTronTextures(options.biome ? [options.biome] : undefined);
            break;
          case 'foliage':
            results.foliage = await generateFoliageBillboards(options.biome ? [options.biome] : undefined);
            break;
        }
      } else if (options.biome) {
        // Generate specific biome
        results.biomes = await generateBiomeTextures([options.biome]);
      } else if (options.time) {
        // Generate specific time of day skybox
        results.skyboxes = await generateSkyboxTextures([options.time]);
      } else {
        // Generate all textures
        results.textures = await generateAllTextures();
      }
    }

    // Generate 3D models
    if (options.models) {
      console.log('\n' + '='.repeat(40));
      console.log('  Generating 3D Models');
      console.log('='.repeat(40) + '\n');

      if (options.modelsOnly) {
        // Generate only specific model type
        switch (options.modelsOnly) {
          case 'props':
            if (options.propCategory) {
              results.props = await generatePropModels(options.propCategory, options.fast);
            } else {
              // Generate all prop categories
              for (const category of Object.keys(PROP_CATEGORIES) as PropCategory[]) {
                results[`props_${category}`] = await generatePropModels(category, options.fast);
              }
            }
            break;
          case 'npcs':
            // Use PS1 style by default for Crash Bandicoot aesthetic
            results.npcs = options.ps1Style ? await generatePS1NPCModels() : await generateNPCModels();
            break;
          case 'items':
            results.items = await generateItemModels();
            break;
          case 'structures':
            results.structures = await generateStructureModels();
            break;
        }
      } else if (options.propCategory) {
        // Generate specific prop category
        results.props = await generatePropModels(options.propCategory, options.fast);
      } else {
        // Generate all models
        results.models = await generateAllModels();
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n' + '='.repeat(60));
    console.log('  Generation Complete!');
    console.log(`  Time elapsed: ${elapsed}s`);
    console.log('='.repeat(60));

    // Summary
    console.log('\nGenerated assets:');
    for (const [key, value] of Object.entries(results)) {
      if (Array.isArray(value)) {
        console.log(`  ${key}: ${value.length} items`);
      } else if (typeof value === 'object' && value !== null) {
        const count = Object.values(value).reduce((acc: number, v) => {
          return acc + (Array.isArray(v) ? v.length : 0);
        }, 0);
        console.log(`  ${key}: ${count} items`);
      }
    }

    console.log('\nAssets saved to: client/public/assets/');

  } catch (error) {
    console.error('\nGeneration failed:', error);
    process.exit(1);
  }
}

// Show help if requested
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Frugworld Asset Generator

Usage:
  npm run generate:assets [options]

Options:
  --textures          Generate textures only
  --models            Generate 3D models only
  --fast              Use faster (lower quality) generation

Texture filters:
  --biome <name>      Generate specific biome (grassland, desert, forest, snow, swamp, mountain)
  --time <name>       Generate specific time of day skybox (dawn, morning, noon, afternoon, sunset, dusk, night, midnight)
  --biomes-only       Generate only biome textures
  --skyboxes-only     Generate only skybox textures
  --terrain-only      Generate only terrain textures
  --effects-only      Generate only effect textures
  --foliage           Generate foliage billboard sprites (grass, flowers)

Model filters:
  --props <category>  Generate props for category (nature, desert, snow, swamp, structures, items)
  --props-only        Generate only prop models
  --npcs-only         Generate only NPC models
  --items-only        Generate only item models
  --structures-only   Generate only structure models

Examples:
  npm run generate:assets                        # Generate everything
  npm run generate:assets -- --textures          # Textures only
  npm run generate:assets -- --biome grassland   # Grassland biome only
  npm run generate:assets -- --time sunset       # Sunset skybox only
  npm run generate:assets -- --props nature      # Nature props only
  npm run generate:assets -- --fast --models     # Fast 3D models
  npm run generate:assets -- --foliage           # Foliage billboard sprites
`);
  process.exit(0);
}

main().catch(console.error);
