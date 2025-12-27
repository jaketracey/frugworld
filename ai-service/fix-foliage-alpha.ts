/**
 * Fix foliage textures by converting white backgrounds to transparent
 * The textures were saved as JPEGs with PNG extension, so they have no alpha channel
 */

import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FOLIAGE_DIR = path.join(__dirname, '../client/public/assets/textures/foliage');

// Threshold for considering a pixel "white" (0-255)
const WHITE_THRESHOLD = 240;

async function fixFoliageAlpha(filePath: string): Promise<void> {
  const filename = path.basename(filePath);
  console.log(`Processing: ${filename}`);

  // Read the image
  const image = sharp(filePath);
  const metadata = await image.metadata();
  const { width, height } = metadata;

  if (!width || !height) {
    console.error(`  Failed to get dimensions for ${filename}`);
    return;
  }

  // Get raw pixel data
  const { data, info } = await image
    .ensureAlpha() // Add alpha channel if not present
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);
  const channels = info.channels;

  // Convert white/near-white pixels to transparent
  let transparentCount = 0;
  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];

    // Check if pixel is white or near-white
    if (r >= WHITE_THRESHOLD && g >= WHITE_THRESHOLD && b >= WHITE_THRESHOLD) {
      // Make transparent
      pixels[i + 3] = 0;
      transparentCount++;
    }
  }

  console.log(`  Made ${transparentCount} pixels transparent (${((transparentCount / (width * height)) * 100).toFixed(1)}%)`);

  // Write back as PNG with alpha
  await sharp(Buffer.from(pixels), {
    raw: {
      width: info.width,
      height: info.height,
      channels: channels as 4,
    },
  })
    .png()
    .toFile(filePath + '.tmp');

  // Replace original with fixed version
  fs.renameSync(filePath + '.tmp', filePath);
  console.log(`  Saved: ${filename}`);
}

async function main() {
  console.log('Fixing foliage texture alpha channels...\n');

  // Get all PNG files in the foliage directory
  const files = fs.readdirSync(FOLIAGE_DIR).filter(f => f.endsWith('.png'));

  for (const file of files) {
    const filePath = path.join(FOLIAGE_DIR, file);
    try {
      await fixFoliageAlpha(filePath);
    } catch (error) {
      console.error(`  Error processing ${file}:`, error);
    }
  }

  console.log('\nDone! All foliage textures now have proper alpha channels.');
}

main().catch(console.error);
