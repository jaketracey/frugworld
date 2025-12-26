#!/usr/bin/env node
/**
 * Generate Tron-style grid textures using fal.ai
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Dynamic import fal after env is loaded
const { fal } = await import('@fal-ai/client');

// Configure fal client
fal.config({
  credentials: process.env.FAL_KEY,
});

const TEXTURE_MODEL = 'fal-ai/flux-2-pro';
const OUTPUT_DIR = path.resolve(__dirname, '../client/public/assets/textures/biomes');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Download file helper
async function downloadFile(url, outputPath) {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(buffer));
  console.log(`  Saved: ${outputPath}`);
}

// Generate a single texture
async function generateTexture(prompt, filename) {
  const fullPrompt = `${prompt}, seamless tileable texture pattern, repeating pattern, no visible seams or borders, high quality, detailed, game asset texture`;

  console.log(`\nGenerating: ${filename}...`);
  console.log(`  Prompt: ${fullPrompt.substring(0, 100)}...`);

  const result = await fal.subscribe(TEXTURE_MODEL, {
    input: {
      prompt: fullPrompt,
      image_size: { width: 1024, height: 1024 },
      num_images: 1,
      enable_safety_checker: false,
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === 'IN_PROGRESS' && update.logs) {
        update.logs.map((log) => log.message).forEach((msg) => console.log(`  ${msg}`));
      }
    },
  });

  const imageUrl = result.data.images[0].url;
  const outputPath = path.join(OUTPUT_DIR, `${filename}.png`);
  await downloadFile(imageUrl, outputPath);

  return outputPath;
}

// Tron color schemes per biome
const tronBiomes = {
  grassland: { primary: 'cyan', accent: 'electric blue', glow: 'neon cyan' },
  desert: { primary: 'orange', accent: 'amber', glow: 'neon orange' },
  forest: { primary: 'neon green', accent: 'lime', glow: 'bright green' },
  snow: { primary: 'white', accent: 'ice blue', glow: 'pale blue' },
  swamp: { primary: 'magenta', accent: 'purple', glow: 'neon pink' },
  mountain: { primary: 'yellow', accent: 'gold', glow: 'neon yellow' },
};

async function main() {
  console.log('='.repeat(60));
  console.log('  Tron Texture Generator');
  console.log('  Using fal.ai FLUX-2-Pro');
  console.log('='.repeat(60));

  if (!process.env.FAL_KEY) {
    console.error('ERROR: FAL_KEY not set in .env file');
    process.exit(1);
  }

  const results = [];

  for (const [biome, colors] of Object.entries(tronBiomes)) {
    // Main grid texture
    const gridPrompt = `Tron Legacy movie style glowing neon grid floor, ${colors.primary} luminous lines on pure black void background, geometric hexagonal circuit pattern with data streams, cyberpunk digital arena floor, light cycle racing track, intense ${colors.glow} edge glow, high contrast, ${colors.accent} accent pulse lines, futuristic sci-fi game environment, dark atmospheric`;

    results.push(await generateTexture(gridPrompt, `tron_${biome}_grid`));

    // Circuit detail texture
    const circuitPrompt = `intricate microchip circuit board pattern, ${colors.primary} neon traces on black background, Tron style digital pathways and data conduits, glowing ${colors.glow} streams, cyberpunk technology aesthetic, futuristic computer chip texture, dark background with bright ${colors.accent} highlights`;

    results.push(await generateTexture(circuitPrompt, `tron_${biome}_circuit`));
  }

  console.log('\n' + '='.repeat(60));
  console.log(`  Generated ${results.length} Tron textures`);
  console.log(`  Output: ${OUTPUT_DIR}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
