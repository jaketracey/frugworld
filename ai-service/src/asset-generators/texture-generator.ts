/**
 * Texture Generator
 * Uses fal.ai to generate seamless textures for biomes and terrain
 */

import { fal, BIOMES, TIMES_OF_DAY, ASSET_DIRS, downloadFile, ensureDir, type BiomeKey, type TimeOfDayKey } from '../fal-client.js';
import * as path from 'path';

// Texture generation models
const TEXTURE_MODEL = 'fal-ai/flux-2-pro';
const FAST_MODEL = 'fal-ai/flux/schnell';

interface TextureResult {
  name: string;
  path: string;
  url: string;
}

/**
 * Generate a seamless tileable texture
 */
async function generateTexture(
  prompt: string,
  filename: string,
  outputDir: string,
  options: {
    size?: number;
    seamless?: boolean;
    fast?: boolean;
  } = {}
): Promise<TextureResult> {
  const { size = 1024, seamless = true, fast = false } = options;

  const seamlessPrompt = seamless
    ? `${prompt}, seamless tileable texture pattern, repeating pattern, no visible seams or borders`
    : prompt;

  const fullPrompt = `${seamlessPrompt}, high quality, detailed, game asset texture, top-down view, flat lighting for texture use`;

  console.log(`Generating texture: ${filename}...`);

  const result = await fal.subscribe(fast ? FAST_MODEL : TEXTURE_MODEL, {
    input: {
      prompt: fullPrompt,
      image_size: {
        width: size,
        height: size,
      },
      num_images: 1,
      enable_safety_checker: false,
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === 'IN_PROGRESS' && update.logs) {
        update.logs.map((log) => log.message).forEach(console.log);
      }
    },
  });

  const imageUrl = (result.data as { images: Array<{ url: string }> }).images[0].url;
  const outputPath = path.join(outputDir, `${filename}.png`);

  await downloadFile(imageUrl, outputPath);

  return {
    name: filename,
    path: outputPath,
    url: imageUrl,
  };
}

/**
 * Generate biome ground textures
 */
export async function generateBiomeTextures(biomes?: BiomeKey[]): Promise<TextureResult[]> {
  const biomesToGenerate = biomes || (Object.keys(BIOMES) as BiomeKey[]);
  const results: TextureResult[] = [];

  for (const biomeKey of biomesToGenerate) {
    const biome = BIOMES[biomeKey];

    // Main ground texture
    const groundPrompt = `${biome.name.toLowerCase()} terrain ground texture, ${biome.colors.join(' and ')} colors, natural ${biome.features.join(', ')}, game art style`;

    results.push(
      await generateTexture(groundPrompt, `${biomeKey}_ground`, ASSET_DIRS.textures.biomes)
    );

    // Detail texture (grass, sand, rocks, etc.)
    const detailPrompt = `close up ${biome.name.toLowerCase()} surface detail, ${biome.colors[0]} color dominant, small details like ${biome.features[0]}, game texture`;

    results.push(
      await generateTexture(detailPrompt, `${biomeKey}_detail`, ASSET_DIRS.textures.biomes)
    );

    // Normal map style texture for height variation
    const normalPrompt = `${biome.name.toLowerCase()} terrain heightmap grayscale, showing elevation variations, hills and valleys, white for high areas black for low`;

    results.push(
      await generateTexture(normalPrompt, `${biomeKey}_height`, ASSET_DIRS.textures.biomes, { seamless: true })
    );
  }

  return results;
}

/**
 * Generate terrain feature textures
 */
export async function generateTerrainTextures(): Promise<TextureResult[]> {
  const results: TextureResult[] = [];

  const terrainTypes = [
    { name: 'dirt_path', prompt: 'worn dirt path texture, brown earth, footprints and wheel tracks' },
    { name: 'stone_path', prompt: 'cobblestone path texture, grey and brown stones, medieval style' },
    { name: 'water_shallow', prompt: 'shallow clear water texture, ripples, blue-green color, visible sandy bottom' },
    { name: 'water_deep', prompt: 'deep water texture, dark blue, gentle waves, mysterious depths' },
    { name: 'mud', prompt: 'wet mud texture, dark brown, puddles, wet reflections' },
    { name: 'gravel', prompt: 'gravel ground texture, small grey and brown stones, natural' },
    { name: 'cliff_face', prompt: 'rocky cliff face texture, vertical rock striations, grey and brown stone layers' },
    { name: 'cave_floor', prompt: 'cave floor texture, dark stone, mineral deposits, ancient' },
  ];

  for (const terrain of terrainTypes) {
    results.push(
      await generateTexture(terrain.prompt, terrain.name, ASSET_DIRS.textures.terrain)
    );
  }

  return results;
}

/**
 * Generate skybox textures for different times of day
 */
export async function generateSkyboxTextures(times?: TimeOfDayKey[]): Promise<TextureResult[]> {
  const timesToGenerate = times || (Object.keys(TIMES_OF_DAY) as TimeOfDayKey[]);
  const results: TextureResult[] = [];

  for (const timeKey of timesToGenerate) {
    const timeOfDay = TIMES_OF_DAY[timeKey];

    // Generate panoramic sky
    const skyPrompt = `panoramic sky photograph, ${timeOfDay.description}, ${timeOfDay.colors.join(' and ')} colors, volumetric clouds, atmospheric, fantasy game art, 360 degree view`;

    results.push(
      await generateTexture(skyPrompt, `sky_${timeKey}`, ASSET_DIRS.textures.skyboxes, {
        size: 2048,
        seamless: false,
      })
    );

    // Cloud layer (for cloud dome)
    const cloudPrompt = `cloud layer from above, ${timeOfDay.colors[0]} tinted, wispy clouds, game skybox texture, alpha channel, ${timeKey === 'night' || timeKey === 'midnight' ? 'sparse clouds' : 'fluffy clouds'}`;

    results.push(
      await generateTexture(cloudPrompt, `clouds_${timeKey}`, ASSET_DIRS.textures.skyboxes, {
        size: 1024,
        seamless: true,
      })
    );
  }

  // Generate star field texture (for night)
  const starsPrompt = 'star field texture, thousands of stars, milky way, deep space, dark background, realistic stars different sizes, night sky photography';

  results.push(
    await generateTexture(starsPrompt, 'stars', ASSET_DIRS.textures.skyboxes, {
      size: 2048,
      seamless: true,
    })
  );

  return results;
}

/**
 * Generate effect textures (particles, overlays, etc.)
 */
export async function generateEffectTextures(): Promise<TextureResult[]> {
  const results: TextureResult[] = [];

  const effects = [
    { name: 'dust_particle', prompt: 'dust particle sprite, soft glow, beige color, transparent background, game particle effect' },
    { name: 'smoke_puff', prompt: 'smoke puff sprite, grey wispy smoke, transparent background, game particle' },
    { name: 'magic_sparkle', prompt: 'magic sparkle sprite, golden glitter, star shape, glowing, transparent background' },
    { name: 'water_splash', prompt: 'water splash sprite, blue water droplets, transparent background, game effect' },
    { name: 'fire_particle', prompt: 'fire flame sprite, orange and red flames, glowing embers, transparent background' },
    { name: 'fog_overlay', prompt: 'fog mist texture, white semi-transparent fog, atmospheric haze, soft edges' },
    { name: 'rain_drops', prompt: 'rain drops texture, falling raindrops, blue-white streaks, transparent background' },
    { name: 'snow_flakes', prompt: 'snowflake particles, white crystalline snow, various sizes, transparent background' },
  ];

  for (const effect of effects) {
    results.push(
      await generateTexture(effect.prompt, effect.name, ASSET_DIRS.textures.effects, {
        size: 512,
        seamless: false,
      })
    );
  }

  return results;
}

/**
 * Generate Tron-style neon grid textures for each biome
 * Creates futuristic cyberpunk terrain textures
 */
export async function generateTronTextures(biomes?: BiomeKey[]): Promise<TextureResult[]> {
  const biomesToGenerate = biomes || (Object.keys(BIOMES) as BiomeKey[]);
  const results: TextureResult[] = [];

  // Tron color schemes per biome
  const tronColors: Record<BiomeKey, { primary: string; accent: string }> = {
    grassland: { primary: 'cyan', accent: 'electric blue' },
    desert: { primary: 'orange', accent: 'amber' },
    forest: { primary: 'neon green', accent: 'lime' },
    snow: { primary: 'white', accent: 'ice blue' },
    swamp: { primary: 'magenta', accent: 'purple' },
    mountain: { primary: 'yellow', accent: 'gold' },
  };

  for (const biomeKey of biomesToGenerate) {
    const colors = tronColors[biomeKey];

    // Main Tron grid texture
    const gridPrompt = `Tron Legacy style neon grid texture, ${colors.primary} glowing lines on pure black background, geometric hexagonal circuit pattern, cyberpunk aesthetic, futuristic digital landscape, light cycle arena floor, glowing edges, high contrast, ${colors.accent} accent highlights, seamless tileable pattern, dark sci-fi game texture`;

    results.push(
      await generateTexture(gridPrompt, `tron_${biomeKey}_grid`, ASSET_DIRS.textures.biomes, {
        size: 1024,
        seamless: true,
      })
    );

    // Detail/circuit pattern
    const circuitPrompt = `intricate circuit board pattern, ${colors.primary} neon traces on black, Tron style digital pathways, microchip aesthetic, glowing data streams, cyberpunk technology texture, seamless tile, dark background with bright ${colors.accent} glow`;

    results.push(
      await generateTexture(circuitPrompt, `tron_${biomeKey}_circuit`, ASSET_DIRS.textures.biomes, {
        size: 512,
        seamless: true,
      })
    );
  }

  return results;
}

/**
 * Generate all textures
 */
export async function generateAllTextures(): Promise<{
  biomes: TextureResult[];
  terrain: TextureResult[];
  skyboxes: TextureResult[];
  effects: TextureResult[];
}> {
  console.log('Starting texture generation...\n');

  // Ensure output directories exist
  Object.values(ASSET_DIRS.textures).forEach((dir) => ensureDir(dir));

  const biomes = await generateBiomeTextures();
  console.log(`\nGenerated ${biomes.length} biome textures\n`);

  const terrain = await generateTerrainTextures();
  console.log(`\nGenerated ${terrain.length} terrain textures\n`);

  const skyboxes = await generateSkyboxTextures();
  console.log(`\nGenerated ${skyboxes.length} skybox textures\n`);

  const effects = await generateEffectTextures();
  console.log(`\nGenerated ${effects.length} effect textures\n`);

  return { biomes, terrain, skyboxes, effects };
}
