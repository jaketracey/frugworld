import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

import { generateModel } from './src/asset-generators/model-generator.js';
import { ASSET_DIRS } from './src/fal-client.js';

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

async function main() {
  console.log('Generating villager_male model...');
  
  try {
    const result = await generateModel(
      `medieval peasant villager man, simple brown tunic, friendly round face, ${PS1_CHARACTER_STYLE}`,
      'villager_male',
      ASSET_DIRS.models.npcs
    );
    console.log('Generated:', result.glbPath);
  } catch (error) {
    console.error('Failed:', error);
    process.exit(1);
  }
}

main();
