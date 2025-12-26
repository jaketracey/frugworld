/**
 * BackstoryParser - Extracts POI relevance from NPC backstories and traits
 *
 * Parses NPC blueprint data (backstory, occupation, personality traits) to determine
 * which types of POIs are relevant to each NPC for goal-directed behavior.
 */

import type { NpcBlueprint } from '@/network/SpacetimeDBAdapter.ts';
import {
  POIType,
  POICategory,
  OCCUPATION_TO_POI_TYPES,
  TRAIT_TO_SOCIAL_POIS,
  type POIPosition,
} from './POITypes.ts';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of parsing an NPC's backstory for POI relevance
 */
export interface BackstoryPOIResult {
  /** NPC ID */
  npcId: number;

  /** Occupation-related POI types (workplace candidates) */
  workplacePOIs: POIType[];

  /** Personality-based social spot preferences */
  socialPOIs: POIType[];

  /** Any POI types mentioned directly in backstory */
  mentionedPOIs: POIType[];

  /** POI categories the NPC might be interested in */
  relevantCategories: POICategory[];

  /** Extracted keywords for matching */
  keywords: string[];

  /** Confidence score (0-1) for the extraction */
  confidence: number;
}

/**
 * Keyword patterns for detecting POI references in text
 */
interface POIKeywordPattern {
  type: POIType;
  keywords: string[];
  contextKeywords?: string[];  // Additional context to improve matching
}

// ============================================================================
// Keyword Patterns
// ============================================================================

/**
 * Patterns for detecting POI types mentioned in backstory text
 */
const POI_KEYWORD_PATTERNS: POIKeywordPattern[] = [
  // Residential
  { type: POIType.Home, keywords: ['home', 'house', 'cottage', 'hut', 'dwelling', 'residence'] },
  { type: POIType.Farmhouse, keywords: ['farmhouse', 'homestead'] },

  // Commercial
  { type: POIType.Shop, keywords: ['shop', 'store', 'boutique', 'emporium'] },
  { type: POIType.Market, keywords: ['market', 'bazaar', 'marketplace', 'stall'] },
  { type: POIType.Inn, keywords: ['inn', 'lodging', 'hostel'] },
  { type: POIType.Tavern, keywords: ['tavern', 'pub', 'bar', 'alehouse', 'drinking'] },
  { type: POIType.Restaurant, keywords: ['restaurant', 'eatery', 'diner'] },
  { type: POIType.Bank, keywords: ['bank', 'treasury', 'vault'] },

  // Industrial
  { type: POIType.Forge, keywords: ['forge', 'smithy', 'anvil', 'blacksmith'] },
  { type: POIType.Workshop, keywords: ['workshop', 'workbench', 'studio'] },
  { type: POIType.Mill, keywords: ['mill', 'windmill', 'watermill', 'grindstone'] },
  { type: POIType.Farm, keywords: ['farm', 'field', 'crop', 'harvest', 'plow'] },
  { type: POIType.Mine, keywords: ['mine', 'quarry', 'tunnel', 'ore', 'mining'] },
  { type: POIType.Warehouse, keywords: ['warehouse', 'storehouse', 'depot'] },

  // Social
  { type: POIType.Plaza, keywords: ['plaza', 'square', 'courtyard'] },
  { type: POIType.Park, keywords: ['park', 'green', 'common'] },
  { type: POIType.Garden, keywords: ['garden', 'orchard', 'greenhouse'] },
  { type: POIType.Fountain, keywords: ['fountain', 'well'] },
  { type: POIType.Bench, keywords: ['bench', 'seat'] },

  // Religious
  { type: POIType.Temple, keywords: ['temple', 'church', 'cathedral', 'sanctuary'] },
  { type: POIType.Shrine, keywords: ['shrine', 'altar', 'holy'] },
  { type: POIType.Cemetery, keywords: ['cemetery', 'graveyard', 'crypt', 'tomb'] },

  // Government
  { type: POIType.TownHall, keywords: ['town hall', 'city hall', 'council', 'court'] },
  { type: POIType.GuardPost, keywords: ['guard post', 'watchtower', 'barracks', 'garrison'] },
  { type: POIType.Prison, keywords: ['prison', 'jail', 'dungeon', 'cell'] },

  // Nature
  { type: POIType.Lake, keywords: ['lake', 'pond', 'pool'] },
  { type: POIType.River, keywords: ['river', 'stream', 'creek', 'brook'] },
  { type: POIType.Forest, keywords: ['forest', 'woods', 'grove', 'timber'] },
  { type: POIType.Cave, keywords: ['cave', 'cavern', 'grotto'] },
  { type: POIType.ViewPoint, keywords: ['hilltop', 'overlook', 'vista', 'cliff'] },

  // Utility
  { type: POIType.Well, keywords: ['well', 'spring'] },
  { type: POIType.Dock, keywords: ['dock', 'pier', 'harbor', 'port', 'wharf'] },
  { type: POIType.Stable, keywords: ['stable', 'barn', 'paddock'] },
  { type: POIType.Gate, keywords: ['gate', 'entrance', 'archway'] },
  { type: POIType.Bridge, keywords: ['bridge', 'crossing'] },
];

/**
 * Occupation keyword aliases for better matching
 */
const OCCUPATION_ALIASES: Record<string, string[]> = {
  blacksmith: ['smith', 'metalsmith', 'ironworker', 'armorer'],
  merchant: ['seller', 'dealer', 'vendor', 'salesman', 'trades'],
  farmer: ['peasant', 'tiller', 'grower', 'cultivator'],
  innkeeper: ['hotelier', 'host', 'proprietor'],
  priest: ['cleric', 'minister', 'chaplain', 'monk', 'brother', 'sister'],
  guard: ['soldier', 'watchman', 'sentry', 'protector'],
  fisherman: ['fisher', 'angler'],
  baker: ['pastry', 'bread'],
  tailor: ['seamstress', 'clothier', 'weaver'],
  miner: ['digger', 'prospector'],
  woodcutter: ['lumberjack', 'logger', 'woodsman'],
};

/**
 * Trait aliases for personality matching
 */
const TRAIT_ALIASES: Record<string, string[]> = {
  social: ['sociable', 'gregarious', 'convivial', 'outgoing'],
  friendly: ['amiable', 'affable', 'warm', 'welcoming'],
  introvert: ['introverted', 'reserved', 'reclusive', 'solitary'],
  shy: ['timid', 'bashful', 'withdrawn'],
  quiet: ['silent', 'peaceful', 'tranquil', 'serene'],
  devout: ['pious', 'religious', 'faithful', 'spiritual'],
  naturelover: ['nature-loving', 'outdoorsy', 'wild'],
};

// ============================================================================
// BackstoryParser Class
// ============================================================================

export class BackstoryParser {
  /**
   * Parse an NPC blueprint to determine POI relevance
   */
  parse(npcId: number, blueprint: NpcBlueprint | null): BackstoryPOIResult {
    const result: BackstoryPOIResult = {
      npcId,
      workplacePOIs: [],
      socialPOIs: [],
      mentionedPOIs: [],
      relevantCategories: [],
      keywords: [],
      confidence: 0,
    };

    if (!blueprint) {
      // Return defaults for NPCs without blueprints
      result.socialPOIs = TRAIT_TO_SOCIAL_POIS['default'] ?? [];
      result.relevantCategories = [POICategory.Social, POICategory.Commercial];
      result.confidence = 0.1;
      return result;
    }

    // Extract workplace POIs from occupation
    if (blueprint.occupation) {
      const workplacePOIs = this.extractWorkplacePOIs(blueprint.occupation);
      result.workplacePOIs.push(...workplacePOIs);
      result.keywords.push(blueprint.occupation.toLowerCase());
    }

    // Extract social POIs from traits
    if (blueprint.traits && Array.isArray(blueprint.traits)) {
      for (const trait of blueprint.traits) {
        const socialPOIs = this.extractSocialPOIs(trait);
        result.socialPOIs.push(...socialPOIs);
        result.keywords.push(trait.toLowerCase());
      }
    }

    // Extract social POIs from personality
    if (blueprint.personality) {
      const personalityPOIs = this.extractPOIsFromText(blueprint.personality);
      const personalitySocial = this.extractSocialPOIsFromText(blueprint.personality);
      result.mentionedPOIs.push(...personalityPOIs);
      result.socialPOIs.push(...personalitySocial);
    }

    // Parse backstory text for mentioned POIs
    if (blueprint.backstory) {
      const backstoryPOIs = this.extractPOIsFromText(blueprint.backstory);
      result.mentionedPOIs.push(...backstoryPOIs);

      // Extract additional keywords from backstory
      const backstoryKeywords = this.extractKeywords(blueprint.backstory);
      result.keywords.push(...backstoryKeywords);
    }

    // Deduplicate arrays
    result.workplacePOIs = [...new Set(result.workplacePOIs)];
    result.socialPOIs = [...new Set(result.socialPOIs)];
    result.mentionedPOIs = [...new Set(result.mentionedPOIs)];
    result.keywords = [...new Set(result.keywords)];

    // Determine relevant categories based on extracted POIs
    result.relevantCategories = this.determineRelevantCategories(result);

    // Calculate confidence score
    result.confidence = this.calculateConfidence(result, blueprint);

    // If no social spots found, add defaults
    if (result.socialPOIs.length === 0) {
      result.socialPOIs = TRAIT_TO_SOCIAL_POIS['default'] ?? [];
    }

    return result;
  }

  /**
   * Extract workplace POI types from occupation string
   */
  private extractWorkplacePOIs(occupation: string): POIType[] {
    const occupationLower = occupation.toLowerCase().trim();
    const result: POIType[] = [];

    // Direct match
    const directMatch = OCCUPATION_TO_POI_TYPES[occupationLower];
    if (directMatch) {
      result.push(...directMatch);
    }

    // Check aliases
    for (const [canonicalOccupation, aliases] of Object.entries(OCCUPATION_ALIASES)) {
      if (aliases.some(alias => occupationLower.includes(alias))) {
        const pois = OCCUPATION_TO_POI_TYPES[canonicalOccupation];
        if (pois) {
          result.push(...pois);
        }
      }
    }

    // Partial match on occupation keywords
    for (const [key, pois] of Object.entries(OCCUPATION_TO_POI_TYPES)) {
      if (occupationLower.includes(key) || key.includes(occupationLower)) {
        result.push(...pois);
      }
    }

    return result;
  }

  /**
   * Extract social POI preferences from a trait
   */
  private extractSocialPOIs(trait: string): POIType[] {
    const traitLower = trait.toLowerCase().trim();
    const result: POIType[] = [];

    // Direct match
    const directMatch = TRAIT_TO_SOCIAL_POIS[traitLower];
    if (directMatch) {
      result.push(...directMatch);
    }

    // Check aliases
    for (const [canonicalTrait, aliases] of Object.entries(TRAIT_ALIASES)) {
      if (aliases.some(alias => traitLower.includes(alias))) {
        const pois = TRAIT_TO_SOCIAL_POIS[canonicalTrait];
        if (pois) {
          result.push(...pois);
        }
      }
    }

    // Partial match
    for (const [key, pois] of Object.entries(TRAIT_TO_SOCIAL_POIS)) {
      if (traitLower.includes(key)) {
        result.push(...pois);
      }
    }

    return result;
  }

  /**
   * Extract social POIs from free text (personality, backstory)
   */
  private extractSocialPOIsFromText(text: string): POIType[] {
    const textLower = text.toLowerCase();
    const result: POIType[] = [];

    // Check trait keywords in text
    for (const [trait, pois] of Object.entries(TRAIT_TO_SOCIAL_POIS)) {
      if (textLower.includes(trait)) {
        result.push(...pois);
      }
    }

    // Check trait aliases
    for (const [canonicalTrait, aliases] of Object.entries(TRAIT_ALIASES)) {
      if (aliases.some(alias => textLower.includes(alias))) {
        const pois = TRAIT_TO_SOCIAL_POIS[canonicalTrait];
        if (pois) {
          result.push(...pois);
        }
      }
    }

    return result;
  }

  /**
   * Extract POI types mentioned in text
   */
  private extractPOIsFromText(text: string): POIType[] {
    const textLower = text.toLowerCase();
    const result: POIType[] = [];

    for (const pattern of POI_KEYWORD_PATTERNS) {
      for (const keyword of pattern.keywords) {
        if (textLower.includes(keyword)) {
          result.push(pattern.type);
          break; // One match per type is enough
        }
      }
    }

    return result;
  }

  /**
   * Extract relevant keywords from text for later matching
   */
  private extractKeywords(text: string): string[] {
    const textLower = text.toLowerCase();
    const keywords: string[] = [];

    // Extract occupation-related keywords
    for (const occupation of Object.keys(OCCUPATION_TO_POI_TYPES)) {
      if (textLower.includes(occupation)) {
        keywords.push(occupation);
      }
    }

    // Extract POI-related keywords
    for (const pattern of POI_KEYWORD_PATTERNS) {
      for (const keyword of pattern.keywords) {
        if (textLower.includes(keyword) && keyword.length > 3) {
          keywords.push(keyword);
        }
      }
    }

    return keywords;
  }

  /**
   * Determine relevant POI categories based on extracted data
   */
  private determineRelevantCategories(result: BackstoryPOIResult): POICategory[] {
    const categories = new Set<POICategory>();

    // Everyone needs residential
    categories.add(POICategory.Residential);

    // Add categories based on workplace POIs
    if (result.workplacePOIs.length > 0) {
      // Map workplace POI types to categories
      const workplaceCategories = [POICategory.Industrial, POICategory.Commercial];
      for (const cat of workplaceCategories) {
        categories.add(cat);
      }
    }

    // Add social category for social POIs
    if (result.socialPOIs.length > 0) {
      categories.add(POICategory.Social);
    }

    // Check mentioned POIs for additional categories
    for (const poi of result.mentionedPOIs) {
      if (poi === POIType.Temple || poi === POIType.Shrine || poi === POIType.Cemetery) {
        categories.add(POICategory.Religious);
      }
      if (poi === POIType.Forest || poi === POIType.Lake || poi === POIType.River || poi === POIType.Cave || poi === POIType.ViewPoint) {
        categories.add(POICategory.Nature);
      }
      if (poi === POIType.TownHall || poi === POIType.GuardPost || poi === POIType.Prison) {
        categories.add(POICategory.Government);
      }
    }

    return Array.from(categories);
  }

  /**
   * Calculate confidence score for the extraction
   */
  private calculateConfidence(result: BackstoryPOIResult, blueprint: NpcBlueprint): number {
    let score = 0;
    let maxScore = 0;

    // Has occupation
    maxScore += 0.3;
    if (blueprint.occupation && result.workplacePOIs.length > 0) {
      score += 0.3;
    } else if (blueprint.occupation) {
      score += 0.1;
    }

    // Has traits
    maxScore += 0.2;
    if (blueprint.traits && blueprint.traits.length > 0) {
      score += 0.1 + Math.min(0.1, blueprint.traits.length * 0.02);
    }

    // Has backstory
    maxScore += 0.3;
    if (blueprint.backstory) {
      score += 0.15;
      if (result.mentionedPOIs.length > 0) {
        score += 0.15;
      }
    }

    // Has keywords extracted
    maxScore += 0.2;
    if (result.keywords.length > 0) {
      score += Math.min(0.2, result.keywords.length * 0.05);
    }

    return maxScore > 0 ? score / maxScore : 0;
  }

  /**
   * Get recommended POI types for an NPC to visit based on goal type
   */
  getRecommendedPOIs(
    result: BackstoryPOIResult,
    goalType: 'work' | 'social' | 'rest' | 'explore' | 'any'
  ): POIType[] {
    switch (goalType) {
      case 'work':
        return result.workplacePOIs.length > 0
          ? result.workplacePOIs
          : [POIType.Workshop, POIType.Shop];

      case 'social':
        return result.socialPOIs.length > 0
          ? result.socialPOIs
          : [POIType.Plaza, POIType.Tavern];

      case 'rest':
        return [POIType.Home, POIType.Inn, POIType.Bench];

      case 'explore':
        // Mix of nature and social spots
        return [
          ...result.socialPOIs.slice(0, 2),
          POIType.ViewPoint,
          POIType.Park,
          POIType.Forest,
        ];

      case 'any':
      default:
        // Return all relevant POIs
        return [
          ...result.workplacePOIs,
          ...result.socialPOIs,
          ...result.mentionedPOIs,
        ].filter((v, i, a) => a.indexOf(v) === i); // Dedupe
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const backstoryParser = new BackstoryParser();
