/**
 * 3D Model Generator
 * Uses fal.ai to generate 3D models for game props, items, and NPCs
 */

import { fal, PROP_CATEGORIES, ASSET_DIRS, downloadFile, ensureDir, type PropCategory } from '../fal-client.js';
import * as path from 'path';

// 3D generation models on fal.ai
const IMAGE_TO_3D_MODEL = 'fal-ai/bytedance/seed3d/image-to-3d';
const TEXT_TO_IMAGE_MODEL = 'fal-ai/flux-2-pro';
const FAST_IMAGE_MODEL = 'fal-ai/flux/schnell';

interface ModelResult {
  name: string;
  glbPath: string;
  thumbnailPath?: string;
  glbUrl: string;
}

interface ImageResult {
  url: string;
}

/**
 * Generate a reference image for 3D generation
 */
async function generateReferenceImage(
  prompt: string,
  fast: boolean = false
): Promise<string> {
  const fullPrompt = `${prompt}, 3D game asset, low poly style, clean design, solid background, isometric view, studio lighting, single object centered, game-ready asset`;

  console.log(`Generating reference image...`);

  const result = await fal.subscribe(fast ? FAST_IMAGE_MODEL : TEXT_TO_IMAGE_MODEL, {
    input: {
      prompt: fullPrompt,
      image_size: {
        width: 1024,
        height: 1024,
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

  return (result.data as { images: ImageResult[] }).images[0].url;
}

/**
 * Convert an image to a 3D model using Seed3D
 * Note: Seed3D returns a ZIP containing the GLB and textures
 */
async function imageToModel(
  imageUrl: string,
  filename: string,
  outputDir: string
): Promise<ModelResult> {
  console.log(`Converting to 3D model: ${filename}...`);

  const result = await fal.subscribe(IMAGE_TO_3D_MODEL, {
    input: {
      image_url: imageUrl,
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === 'IN_PROGRESS' && update.logs) {
        update.logs.map((log) => log.message).forEach(console.log);
      }
    },
  });

  // The Seed3D model returns a ZIP file containing GLB and textures
  const data = result.data as { model: { url: string; file_name: string } };
  const modelUrl = data.model.url;

  // Download as ZIP first
  const zipPath = path.join(outputDir, `${filename}.zip`);
  await downloadFile(modelUrl, zipPath);

  // Extract the GLB from the ZIP
  const glbPath = path.join(outputDir, `${filename}.glb`);
  await extractGlbFromZip(zipPath, glbPath);

  // Clean up ZIP
  const fs = await import('fs/promises');
  await fs.unlink(zipPath);

  // Also save the reference image as thumbnail
  const thumbnailPath = path.join(outputDir, `${filename}_thumb.png`);
  await downloadFile(imageUrl, thumbnailPath);

  return {
    name: filename,
    glbPath,
    thumbnailPath,
    glbUrl: modelUrl,
  };
}

/**
 * Extract GLB file from Seed3D ZIP archive
 * Seed3D outputs: rgb/mesh_textured.glb (with embedded texture)
 */
async function extractGlbFromZip(zipPath: string, outputPath: string): Promise<void> {
  const { execSync } = await import('child_process');
  const fs = await import('fs/promises');
  const os = await import('os');

  // Create temp directory for extraction
  const tempDir = path.join(os.tmpdir(), `seed3d_${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  try {
    // Extract ZIP
    execSync(`unzip -o "${zipPath}" -d "${tempDir}"`, { stdio: 'pipe' });

    // Find the RGB GLB (preferred) or PBR GLB
    const rgbGlb = path.join(tempDir, 'rgb', 'mesh_textured.glb');
    const pbrGlb = path.join(tempDir, 'pbr', 'mesh_textured_pbr.glb');

    let sourceGlb: string;
    try {
      await fs.access(rgbGlb);
      sourceGlb = rgbGlb;
    } catch {
      sourceGlb = pbrGlb;
    }

    // Copy to output
    await fs.copyFile(sourceGlb, outputPath);
    console.log(`Extracted: ${outputPath}`);
  } finally {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Generate a complete 3D model from text description
 */
export async function generateModel(
  description: string,
  filename: string,
  outputDir: string,
  options: { fast?: boolean } = {}
): Promise<ModelResult> {
  ensureDir(outputDir);

  // First generate a reference image
  const imageUrl = await generateReferenceImage(description, options.fast);

  // Then convert to 3D
  return imageToModel(imageUrl, filename, outputDir);
}

/**
 * Generate prop models for a category
 */
export async function generatePropModels(
  category: PropCategory,
  fast: boolean = false
): Promise<ModelResult[]> {
  const props = PROP_CATEGORIES[category];
  const results: ModelResult[] = [];

  for (const prop of props) {
    const filename = prop.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

    try {
      const result = await generateModel(prop, filename, ASSET_DIRS.models.props, { fast });
      results.push(result);
      console.log(`Generated model: ${filename}`);
    } catch (error) {
      console.error(`Failed to generate ${filename}:`, error);
    }
  }

  return results;
}

/**
 * Generate all prop models
 */
export async function generateAllPropModels(fast: boolean = false): Promise<Record<PropCategory, ModelResult[]>> {
  const results: Record<string, ModelResult[]> = {};

  for (const category of Object.keys(PROP_CATEGORIES) as PropCategory[]) {
    console.log(`\nGenerating ${category} props...`);
    results[category] = await generatePropModels(category, fast);
  }

  return results as Record<PropCategory, ModelResult[]>;
}

// PS1/PS2 Crash Bandicoot style suffix for character models
const PS1_CHARACTER_STYLE = `
  PlayStation 1 style, low poly character model,
  under 300 polygons, chunky proportions,
  large head, stubby limbs, bright saturated colors,
  Crash Bandicoot character design,
  N64 era graphics, chibi proportions,
  simple geometry, cartoonish features,
  exaggerated eyes and hands, T-pose,
  game-ready character asset
`;

/**
 * Generate NPC character models (original style)
 */
export async function generateNPCModels(): Promise<ModelResult[]> {
  const npcs = [
    { name: 'villager_male', description: 'medieval villager man, simple clothing, friendly, fantasy rpg character' },
    { name: 'villager_female', description: 'medieval villager woman, simple dress, friendly, fantasy rpg character' },
    { name: 'merchant', description: 'traveling merchant, cart and goods, colorful clothing, fantasy rpg' },
    { name: 'guard', description: 'town guard soldier, armor and spear, standing alert, fantasy rpg' },
    { name: 'blacksmith', description: 'blacksmith with hammer and apron, muscular, fantasy rpg character' },
    { name: 'wizard', description: 'elderly wizard with staff and robes, mystical, fantasy rpg mage' },
    { name: 'farmer', description: 'farmer with pitchfork, straw hat, overalls, fantasy rpg character' },
    { name: 'innkeeper', description: 'friendly innkeeper, apron, holding mug, fantasy rpg character' },
  ];

  const results: ModelResult[] = [];

  for (const npc of npcs) {
    try {
      const result = await generateModel(npc.description, npc.name, ASSET_DIRS.models.npcs);
      results.push(result);
      console.log(`Generated NPC: ${npc.name}`);
    } catch (error) {
      console.error(`Failed to generate ${npc.name}:`, error);
    }
  }

  return results;
}

/**
 * Generate PS1/PS2 Crash Bandicoot style NPC character models
 * Core set of 8 unique low-poly characters
 */
export async function generatePS1NPCModels(): Promise<ModelResult[]> {
  const npcs = [
    {
      name: 'villager_male',
      description: `medieval peasant villager man, simple brown tunic, friendly round face, ${PS1_CHARACTER_STYLE}`,
    },
    {
      name: 'villager_female',
      description: `medieval peasant villager woman, simple green dress with apron, kind smiling face, ${PS1_CHARACTER_STYLE}`,
    },
    {
      name: 'merchant',
      description: `rotund traveling merchant, colorful purple vest, big smile, coin pouch on belt, ${PS1_CHARACTER_STYLE}`,
    },
    {
      name: 'guard',
      description: `town guard soldier, silver helmet and chainmail armor, holding spear, stern expression, ${PS1_CHARACTER_STYLE}`,
    },
    {
      name: 'farmer',
      description: `farmer character, straw hat, blue overalls, holding pitchfork, weathered friendly face, ${PS1_CHARACTER_STYLE}`,
    },
    {
      name: 'blacksmith',
      description: `burly blacksmith, brown leather apron, muscular arms, soot on face, holding hammer, ${PS1_CHARACTER_STYLE}`,
    },
    {
      name: 'priest',
      description: `elderly priest or monk, white robes with hood, gentle wise expression, wooden staff, ${PS1_CHARACTER_STYLE}`,
    },
    {
      name: 'wanderer',
      description: `mysterious wanderer traveler, tattered brown cloak, walking stick, weathered face, ${PS1_CHARACTER_STYLE}`,
    },
  ];

  const results: ModelResult[] = [];

  console.log('Generating PS1-style NPC models...');

  for (const npc of npcs) {
    try {
      const result = await generateModel(npc.description, npc.name, ASSET_DIRS.models.npcs);
      results.push(result);
      console.log(`Generated PS1 NPC: ${npc.name}`);
    } catch (error) {
      console.error(`Failed to generate ${npc.name}:`, error);
    }
  }

  console.log(`Generated ${results.length} PS1-style NPC models`);
  return results;
}

/**
 * Generate item models (weapons, tools, collectibles)
 */
export async function generateItemModels(): Promise<ModelResult[]> {
  const items = [
    { name: 'sword_iron', description: 'iron sword, simple medieval blade, fantasy weapon' },
    { name: 'sword_magic', description: 'glowing magical sword, blue aura, enchanted fantasy weapon' },
    { name: 'shield_wooden', description: 'round wooden shield, leather straps, medieval' },
    { name: 'shield_iron', description: 'iron kite shield, heraldic design, medieval' },
    { name: 'axe', description: 'woodcutting axe, wooden handle, steel head' },
    { name: 'pickaxe', description: 'mining pickaxe, wooden handle, iron head' },
    { name: 'bow', description: 'hunting bow, wooden longbow, leather grip' },
    { name: 'staff_wooden', description: 'wooden walking staff, gnarled wood, fantasy' },
    { name: 'staff_magic', description: 'wizard staff with crystal orb, glowing, magical' },
    { name: 'potion_health', description: 'health potion bottle, red liquid, glass flask, fantasy' },
    { name: 'potion_mana', description: 'mana potion bottle, blue liquid, glass flask, fantasy' },
    { name: 'potion_stamina', description: 'stamina potion bottle, green liquid, glass flask' },
    { name: 'coin_gold', description: 'pile of gold coins, treasure, shiny, fantasy game' },
    { name: 'gem_ruby', description: 'cut ruby gemstone, red crystal, treasure' },
    { name: 'gem_sapphire', description: 'cut sapphire gemstone, blue crystal, treasure' },
    { name: 'gem_emerald', description: 'cut emerald gemstone, green crystal, treasure' },
    { name: 'key_brass', description: 'old brass key, ornate, medieval fantasy' },
    { name: 'scroll', description: 'rolled up parchment scroll, ribbon tied, fantasy' },
    { name: 'book_spell', description: 'magical spell book, leather bound, glowing runes' },
    { name: 'lantern', description: 'oil lantern, brass and glass, medieval' },
    { name: 'torch', description: 'wooden torch with flame, burning, medieval' },
    { name: 'backpack', description: 'leather backpack, travel bag, adventurer gear' },
  ];

  const results: ModelResult[] = [];

  for (const item of items) {
    try {
      const result = await generateModel(item.description, item.name, ASSET_DIRS.models.items);
      results.push(result);
      console.log(`Generated item: ${item.name}`);
    } catch (error) {
      console.error(`Failed to generate ${item.name}:`, error);
    }
  }

  return results;
}

/**
 * Generate building/structure models
 */
export async function generateStructureModels(): Promise<ModelResult[]> {
  const structures = [
    { name: 'house_small', description: 'small medieval cottage, thatched roof, wooden walls, fantasy rpg' },
    { name: 'house_medium', description: 'medium medieval house, two story, timber frame, fantasy village' },
    { name: 'tavern', description: 'medieval tavern building, sign hanging, warm lights, fantasy rpg' },
    { name: 'blacksmith_shop', description: 'blacksmith forge building, chimney smoke, anvil outside' },
    { name: 'market_stall', description: 'market vendor stall, wooden booth, fabric awning' },
    { name: 'well', description: 'stone water well, rope and bucket, medieval village' },
    { name: 'fountain', description: 'stone fountain, water feature, town square, medieval' },
    { name: 'bridge_wooden', description: 'small wooden bridge, planks and rails, over stream' },
    { name: 'bridge_stone', description: 'stone arch bridge, medieval construction, sturdy' },
    { name: 'tower_guard', description: 'stone guard tower, lookout post, medieval fortress' },
    { name: 'gate_wooden', description: 'wooden gate archway, village entrance, medieval' },
    { name: 'fence_wooden', description: 'wooden fence section, farm style, simple posts' },
    { name: 'wall_stone', description: 'stone wall section, defensive, medieval fortress' },
    { name: 'windmill', description: 'wooden windmill, spinning blades, medieval farm' },
    { name: 'barn', description: 'large red barn, hay bales, farm building' },
    { name: 'tent_camp', description: 'camping tent, canvas fabric, adventurer camp' },
    { name: 'campfire', description: 'campfire with logs, burning flames, camp setup' },
  ];

  const results: ModelResult[] = [];

  for (const structure of structures) {
    try {
      const result = await generateModel(structure.description, structure.name, ASSET_DIRS.models.props);
      results.push(result);
      console.log(`Generated structure: ${structure.name}`);
    } catch (error) {
      console.error(`Failed to generate ${structure.name}:`, error);
    }
  }

  return results;
}

/**
 * Generate all 3D models
 */
export async function generateAllModels(): Promise<{
  props: Record<PropCategory, ModelResult[]>;
  npcs: ModelResult[];
  items: ModelResult[];
  structures: ModelResult[];
}> {
  console.log('Starting 3D model generation...\n');

  // Ensure output directories exist
  Object.values(ASSET_DIRS.models).forEach((dir) => ensureDir(dir));

  const props = await generateAllPropModels();
  console.log(`\nGenerated prop models\n`);

  const npcs = await generateNPCModels();
  console.log(`\nGenerated ${npcs.length} NPC models\n`);

  const items = await generateItemModels();
  console.log(`\nGenerated ${items.length} item models\n`);

  const structures = await generateStructureModels();
  console.log(`\nGenerated ${structures.length} structure models\n`);

  return { props, npcs, items, structures };
}
