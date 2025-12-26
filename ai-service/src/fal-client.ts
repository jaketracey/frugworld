/**
 * fal.ai Client Configuration and Utilities
 * Handles AI-powered asset generation for Frugworld
 */

import { fal } from '@fal-ai/client';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

// Configure fal.ai with API key
fal.config({
  credentials: process.env.FAL_KEY!,
});

export { fal };

// Project root path
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// Asset output directories (relative to project root)
export const ASSET_DIRS = {
  textures: {
    biomes: path.join(PROJECT_ROOT, 'client/public/assets/textures/biomes'),
    skyboxes: path.join(PROJECT_ROOT, 'client/public/assets/textures/skyboxes'),
    terrain: path.join(PROJECT_ROOT, 'client/public/assets/textures/terrain'),
    effects: path.join(PROJECT_ROOT, 'client/public/assets/textures/effects'),
  },
  models: {
    props: path.join(PROJECT_ROOT, 'client/public/assets/models/props'),
    npcs: path.join(PROJECT_ROOT, 'client/public/assets/models/npcs'),
    items: path.join(PROJECT_ROOT, 'client/public/assets/models/items'),
  },
} as const;

/**
 * Ensure directory exists
 */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Download a file from URL to disk
 */
export async function downloadFile(url: string, outputPath: string): Promise<void> {
  ensureDir(path.dirname(outputPath));

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  console.log(`Downloaded: ${outputPath}`);
}

/**
 * Game biome definitions
 */
export const BIOMES = {
  grassland: {
    id: 0,
    name: 'Grassland',
    colors: ['green', 'olive', 'lime'],
    features: ['rolling hills', 'wildflowers', 'scattered trees'],
  },
  desert: {
    id: 1,
    name: 'Desert',
    colors: ['tan', 'orange', 'brown'],
    features: ['sand dunes', 'cacti', 'dry riverbeds'],
  },
  forest: {
    id: 2,
    name: 'Forest',
    colors: ['dark green', 'brown', 'moss green'],
    features: ['dense trees', 'undergrowth', 'fallen logs'],
  },
  snow: {
    id: 3,
    name: 'Snow',
    colors: ['white', 'light blue', 'silver'],
    features: ['snowdrifts', 'ice patches', 'frozen lakes'],
  },
  swamp: {
    id: 4,
    name: 'Swamp',
    colors: ['murky green', 'brown', 'dark teal'],
    features: ['murky water', 'twisted trees', 'fog'],
  },
  mountain: {
    id: 5,
    name: 'Mountain',
    colors: ['grey', 'brown', 'white'],
    features: ['rocky outcrops', 'steep cliffs', 'alpine vegetation'],
  },
} as const;

/**
 * Time of day definitions for skyboxes
 */
export const TIMES_OF_DAY = {
  dawn: {
    time: 0.25,
    description: 'Early morning with soft pink and orange hues on the horizon',
    colors: ['pink', 'orange', 'pale blue'],
  },
  morning: {
    time: 0.35,
    description: 'Bright morning with clear blue sky and white clouds',
    colors: ['sky blue', 'white', 'gold'],
  },
  noon: {
    time: 0.5,
    description: 'Midday with intense sunlight and deep blue sky',
    colors: ['deep blue', 'white', 'yellow'],
  },
  afternoon: {
    time: 0.65,
    description: 'Warm afternoon with golden light',
    colors: ['warm blue', 'gold', 'cream'],
  },
  sunset: {
    time: 0.75,
    description: 'Dramatic sunset with red, orange, and purple streaks',
    colors: ['red', 'orange', 'purple', 'pink'],
  },
  dusk: {
    time: 0.85,
    description: 'Twilight with deep purple and blue gradients',
    colors: ['purple', 'deep blue', 'navy'],
  },
  night: {
    time: 0.0,
    description: 'Starry night sky with moon glow',
    colors: ['dark blue', 'black', 'silver'],
  },
  midnight: {
    time: 0.1,
    description: 'Deep night with milky way visible',
    colors: ['black', 'dark purple', 'starlight'],
  },
} as const;

/**
 * Prop categories for 3D model generation
 */
export const PROP_CATEGORIES = {
  nature: [
    'oak tree',
    'pine tree',
    'birch tree',
    'bush',
    'rock boulder',
    'fallen log',
    'mushroom cluster',
    'wildflower patch',
  ],
  desert: [
    'cactus saguaro',
    'desert rock formation',
    'tumbleweed',
    'dry bush',
    'bleached skull',
  ],
  snow: [
    'snow-covered pine tree',
    'ice crystal formation',
    'snowman',
    'frozen bush',
  ],
  swamp: [
    'gnarled dead tree',
    'swamp log',
    'lily pad cluster',
    'cattails',
  ],
  structures: [
    'wooden fence section',
    'stone wall section',
    'wooden crate',
    'barrel',
    'campfire',
    'tent',
    'well',
    'signpost',
  ],
  items: [
    'sword',
    'shield',
    'potion bottle',
    'treasure chest',
    'key',
    'lantern',
    'book',
    'coin pile',
  ],
} as const;

export type BiomeKey = keyof typeof BIOMES;
export type TimeOfDayKey = keyof typeof TIMES_OF_DAY;
export type PropCategory = keyof typeof PROP_CATEGORIES;
