//! NPC Blueprint Generation Pipeline
//!
//! Implements Section 6.1 of the plan: NPC identity and personality generation.
//!
//! Blueprint fields:
//! - Identity: name, age, role, appearance tags
//! - Personality: traits, values, fears, desires
//! - Backstory: 5-12 bullet facts
//! - Relationships: links to other NPCs
//! - Voice/style: short style descriptor
//! - Hard constraints: taboo topics, safety constraints
//! - Truth anchors: facts the NPC will never contradict
//!
//! NOTE: This module provides infrastructure for blueprint storage and validation.
//! Actual LLM generation should be done by an external service that calls
//! the provided reducers.

use crate::{
    current_tick, event_types::*, now_ms, EntityKind, EventLog, NpcBlueprint,
    // Table accessor traits
    chunk, entity, npc_blueprint, event_log,
};
use serde::{Deserialize, Serialize};
use spacetimedb::{reducer, ReducerContext, Table};

// =============================================================================
// Blueprint Schema
// =============================================================================

/// Blueprint schema version for migrations.
pub const CURRENT_BLUEPRINT_VERSION: u16 = 1;

/// Full NPC blueprint structure.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Blueprint {
    /// Schema version
    pub version: u16,

    /// Identity information
    pub identity: BlueprintIdentity,

    /// Personality traits and values
    pub personality: BlueprintPersonality,

    /// Background story (bullet points)
    pub backstory: Vec<String>,

    /// Known relationships to other NPCs
    pub relationships: Vec<BlueprintRelationship>,

    /// Speaking style
    pub voice_style: BlueprintVoiceStyle,

    /// Hard constraints that must never be violated
    pub constraints: BlueprintConstraints,

    /// Truth anchors - facts this NPC will never contradict
    pub truth_anchors: Vec<String>,

    /// Generation metadata
    pub metadata: BlueprintMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlueprintIdentity {
    /// Display name
    pub name: String,
    /// Age in years
    pub age: u16,
    /// Role/occupation
    pub role: String,
    /// Gender (for pronoun selection)
    pub gender: String,
    /// Physical appearance tags
    pub appearance: Vec<String>,
    /// Notable features
    pub distinctive_features: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlueprintPersonality {
    /// Core personality traits (e.g., "honest", "suspicious", "kind")
    pub traits: Vec<String>,
    /// Values they hold dear (e.g., "family", "honor", "wealth")
    pub values: Vec<String>,
    /// Things they fear
    pub fears: Vec<String>,
    /// Things they desire
    pub desires: Vec<String>,
    /// Quirks or habits
    pub quirks: Vec<String>,
    /// Typical mood
    pub default_mood: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlueprintRelationship {
    /// Target NPC ID (0 if not yet assigned)
    pub target_npc_id: u64,
    /// Relationship type (family, friend, rival, etc.)
    pub relationship_type: String,
    /// Brief description
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlueprintVoiceStyle {
    /// Overall tone (e.g., "warm and friendly", "gruff but kind")
    pub tone: String,
    /// Vocabulary complexity: "simple", "moderate", or "sophisticated"
    pub vocabulary_level: String,
    /// Speech patterns (e.g., "uses contractions", "formal")
    pub speech_patterns: Vec<String>,
    /// Character-specific phrases they often use
    #[serde(default)]
    pub catchphrases: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlueprintConstraints {
    /// Topics the NPC will never discuss
    pub taboo_topics: Vec<String>,
    /// Safety constraints (content policy)
    pub safety_constraints: Vec<String>,
    /// Lore constraints (things that must be true in-world)
    pub lore_constraints: Vec<String>,
    /// Actions the NPC will never take
    pub forbidden_actions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlueprintMetadata {
    /// When the blueprint was created
    pub created_ts_ms: u64,
    /// Generation method (llm, procedural, template)
    pub generation_method: String,
    /// Model used for generation (if LLM)
    pub model_id: Option<String>,
    /// Seed used for procedural generation (if applicable)
    pub seed: Option<u64>,
}

// =============================================================================
// Default Blueprints by Archetype
// =============================================================================

/// Generate a default procedural blueprint based on archetype.
pub fn generate_procedural_blueprint(
    archetype_id: u32,
    npc_id: u64,
    chunk_seed: u64,
    ts_ms: u64,
) -> Blueprint {
    // Use npc_id and chunk_seed for deterministic variation
    let mut rng = chunk_seed.wrapping_add(npc_id);
    let next_rand = |state: &mut u64| -> u64 {
        *state = state.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
        *state
    };

    // Name generation (simple procedural)
    let first_names = ["Aldric", "Bran", "Cedric", "Delia", "Elara", "Fenn", "Greta", "Hugo",
                       "Ida", "Jareth", "Kira", "Liam", "Mira", "Nolan", "Ora", "Piers"];
    let last_names = ["Smith", "Miller", "Cooper", "Fletcher", "Hunter", "Fisher", "Carpenter",
                      "Mason", "Thatcher", "Weaver", "Potter", "Baker", "Farmer", "Shepherd"];

    let first_idx = (next_rand(&mut rng) % first_names.len() as u64) as usize;
    let last_idx = (next_rand(&mut rng) % last_names.len() as u64) as usize;
    let name = format!("{} {}", first_names[first_idx], last_names[last_idx]);

    let age = 20 + (next_rand(&mut rng) % 50) as u16;
    let gender = if next_rand(&mut rng) % 2 == 0 { "male" } else { "female" };

    let (role, traits, values, desires) = match archetype_id {
        1 => ( // Merchant
            "Merchant",
            vec!["shrewd", "friendly", "patient"],
            vec!["profit", "reputation"],
            vec!["wealth", "respect"],
        ),
        2 => ( // Guard
            "Guard",
            vec!["vigilant", "disciplined", "stern"],
            vec!["duty", "order"],
            vec!["peace", "recognition"],
        ),
        3 => ( // Villager
            "Villager",
            vec!["simple", "hardworking", "curious"],
            vec!["family", "community"],
            vec!["comfort", "safety"],
        ),
        4 => ( // Craftsman
            "Craftsman",
            vec!["meticulous", "proud", "dedicated"],
            vec!["quality", "tradition"],
            vec!["mastery", "legacy"],
        ),
        5 => ( // Wanderer
            "Wanderer",
            vec!["mysterious", "observant", "independent"],
            vec!["freedom", "knowledge"],
            vec!["discovery", "stories"],
        ),
        6 => ( // Hunter
            "Hunter",
            vec!["patient", "skilled", "solitary"],
            vec!["survival", "nature"],
            vec!["respect", "good hunt"],
        ),
        7 => ( // Farmer
            "Farmer",
            vec!["hardworking", "practical", "hospitable"],
            vec!["land", "harvest"],
            vec!["prosperity", "good weather"],
        ),
        8 => ( // Explorer
            "Explorer",
            vec!["adventurous", "resourceful", "curious"],
            vec!["discovery", "knowledge"],
            vec!["fame", "treasure"],
        ),
        9 => ( // Scavenger
            "Scavenger",
            vec!["opportunistic", "cautious", "resourceful"],
            vec!["survival", "self-reliance"],
            vec!["security", "valuable finds"],
        ),
        _ => ( // Default traveler
            "Traveler",
            vec!["adaptable", "observant"],
            vec!["safety", "passage"],
            vec!["destination", "stories"],
        ),
    };

    // Generate backstory
    let backstory = generate_backstory(&role, age, &mut rng);

    // Generate appearance
    let appearance = generate_appearance(gender, archetype_id, &mut rng);

    // Voice style based on archetype
    let voice_style = match archetype_id {
        1 => BlueprintVoiceStyle { // Merchant
            tone: "persuasive and friendly".to_string(),
            vocabulary_level: "moderate".to_string(),
            speech_patterns: vec!["uses sales pitch phrases".to_string(), "mentions prices".to_string()],
            catchphrases: vec!["A fine deal!".to_string(), "For you, a special price!".to_string()],
        },
        2 => BlueprintVoiceStyle { // Guard
            tone: "formal and stern".to_string(),
            vocabulary_level: "simple".to_string(),
            speech_patterns: vec!["clipped sentences".to_string(), "military precision".to_string()],
            catchphrases: vec!["Move along.".to_string(), "Stay out of trouble.".to_string()],
        },
        3 => BlueprintVoiceStyle { // Villager
            tone: "warm and simple".to_string(),
            vocabulary_level: "simple".to_string(),
            speech_patterns: vec!["uses local dialect".to_string(), "asks about weather".to_string()],
            catchphrases: vec!["Good day to you!".to_string(), "Lovely weather, eh?".to_string()],
        },
        4 => BlueprintVoiceStyle { // Craftsman
            tone: "measured and proud".to_string(),
            vocabulary_level: "moderate".to_string(),
            speech_patterns: vec!["uses trade terminology".to_string(), "talks about quality".to_string()],
            catchphrases: vec!["Fine craftsmanship!".to_string(), "Built to last.".to_string()],
        },
        5 => BlueprintVoiceStyle { // Wanderer
            tone: "cryptic and thoughtful".to_string(),
            vocabulary_level: "sophisticated".to_string(),
            speech_patterns: vec!["speaks in metaphors".to_string(), "pauses often".to_string()],
            catchphrases: vec!["The road reveals much...".to_string()],
        },
        6 => BlueprintVoiceStyle { // Hunter
            tone: "quiet and direct".to_string(),
            vocabulary_level: "simple".to_string(),
            speech_patterns: vec!["wastes no words".to_string(), "observant".to_string()],
            catchphrases: vec!["Hmm.".to_string(), "Watch your step.".to_string()],
        },
        7 => BlueprintVoiceStyle { // Farmer
            tone: "friendly and folksy".to_string(),
            vocabulary_level: "simple".to_string(),
            speech_patterns: vec!["earthy wisdom".to_string(), "talks about harvest".to_string()],
            catchphrases: vec!["Hard work pays off!".to_string(), "Bless the rain.".to_string()],
        },
        8 => BlueprintVoiceStyle { // Explorer
            tone: "enthusiastic and animated".to_string(),
            vocabulary_level: "moderate".to_string(),
            speech_patterns: vec!["full of tales".to_string(), "gestures widely".to_string()],
            catchphrases: vec!["You won't believe what I saw!".to_string(), "Adventure awaits!".to_string()],
        },
        9 => BlueprintVoiceStyle { // Scavenger
            tone: "wary and brief".to_string(),
            vocabulary_level: "simple".to_string(),
            speech_patterns: vec!["always watching".to_string(), "speaks quietly".to_string()],
            catchphrases: vec!["Keep it quiet.".to_string(), "Might be useful...".to_string()],
        },
        _ => BlueprintVoiceStyle { // Default
            tone: "neutral and adaptable".to_string(),
            vocabulary_level: "simple".to_string(),
            speech_patterns: vec!["speaks plainly".to_string()],
            catchphrases: vec![],
        },
    };

    Blueprint {
        version: CURRENT_BLUEPRINT_VERSION,
        identity: BlueprintIdentity {
            name,
            age,
            role: role.to_string(),
            gender: gender.to_string(),
            appearance,
            distinctive_features: vec![],
        },
        personality: BlueprintPersonality {
            traits: traits.iter().map(|s| s.to_string()).collect(),
            values: values.iter().map(|s| s.to_string()).collect(),
            fears: vec!["failure".to_string()],
            desires: desires.iter().map(|s| s.to_string()).collect(),
            quirks: vec![],
            default_mood: "neutral".to_string(),
        },
        backstory,
        relationships: vec![],
        voice_style,
        constraints: BlueprintConstraints {
            taboo_topics: vec![],
            safety_constraints: vec![
                "Never reveal game mechanics".to_string(),
                "Never break character".to_string(),
            ],
            lore_constraints: vec![],
            forbidden_actions: vec![],
        },
        truth_anchors: vec![
            format!("My name is {}", first_names[first_idx]),
            format!("I am a {}", role),
        ],
        metadata: BlueprintMetadata {
            created_ts_ms: ts_ms,
            generation_method: "procedural".to_string(),
            model_id: None,
            seed: Some(chunk_seed.wrapping_add(npc_id)),
        },
    }
}

fn generate_backstory(role: &str, age: u16, rng: &mut u64) -> Vec<String> {
    let next_rand = |state: &mut u64| -> u64 {
        *state = state.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
        *state
    };

    let childhood = match next_rand(rng) % 4 {
        0 => "Grew up in a small village",
        1 => "Raised in the city",
        2 => "Orphaned at a young age",
        _ => "Came from a large family",
    };

    let motivation = match role {
        "Merchant" => "Learned trade from a traveling merchant",
        "Guard" => "Joined the guard to protect the innocent",
        "Villager" => "Has lived here all their life",
        "Craftsman" => "Apprenticed under a master for years",
        "Wanderer" => "Left home seeking adventure",
        "Hunter" => "Learned to track from an elder",
        "Farmer" => "Inherited the family farm",
        "Explorer" => "Drawn to the unknown since childhood",
        "Scavenger" => "Learned to survive after losing everything",
        _ => "Found this path through circumstance",
    };

    let years_experience = if age > 20 { (age - 16) / 2 } else { 1 };

    vec![
        childhood.to_string(),
        motivation.to_string(),
        format!("Has been a {} for about {} years", role.to_lowercase(), years_experience),
        "Values honest dealings".to_string(),
        "Has a few close friends in the area".to_string(),
    ]
}

fn generate_appearance(_gender: &str, archetype_id: u32, rng: &mut u64) -> Vec<String> {
    let next_rand = |state: &mut u64| -> u64 {
        *state = state.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
        *state
    };

    let heights = ["short", "average height", "tall"];
    let builds = ["slender", "average build", "stocky", "muscular"];
    let hair_colors = ["black hair", "brown hair", "blonde hair", "gray hair", "red hair"];

    let height_idx = (next_rand(rng) % heights.len() as u64) as usize;
    let build_idx = (next_rand(rng) % builds.len() as u64) as usize;
    let hair_idx = (next_rand(rng) % hair_colors.len() as u64) as usize;

    let mut tags = vec![
        heights[height_idx].to_string(),
        builds[build_idx].to_string(),
        hair_colors[hair_idx].to_string(),
    ];

    // Add archetype-specific appearance
    match archetype_id {
        1 => tags.push("well-dressed".to_string()),
        2 => tags.push("armored".to_string()),
        3 => tags.push("simple clothing".to_string()),
        4 => tags.push("work-stained apron".to_string()),
        5 => tags.push("travel-worn cloak".to_string()),
        6 => tags.push("leather gear".to_string()),
        7 => tags.push("sun-weathered skin".to_string()),
        8 => tags.push("adventuring gear".to_string()),
        9 => tags.push("patched clothing".to_string()),
        _ => {}
    }

    tags
}

// =============================================================================
// Reducers
// =============================================================================

/// Generate and store a procedural blueprint for an NPC.
#[reducer]
pub fn generate_npc_blueprint(ctx: &ReducerContext, npc_id: u64) -> Result<(), String> {
    let ts_ms = now_ms(ctx);
    let tick = current_tick(ctx);

    // Get NPC entity
    let entity = ctx.db.entity().entity_id().find(npc_id)
        .ok_or("NPC entity not found")?;

    if entity.kind != EntityKind::Npc.as_u16() {
        return Err("Entity is not an NPC".to_string());
    }

    // Check if blueprint already exists with content
    if let Some(existing) = ctx.db.npc_blueprint().npc_id().find(npc_id) {
        if !existing.blueprint_json.is_empty() && existing.version > 0 {
            return Err("Blueprint already exists".to_string());
        }
    }

    // Get chunk seed for deterministic generation
    let chunk = ctx.db.chunk()
        .iter()
        .find(|c| c.cx == entity.chunk_x && c.cy == entity.chunk_y);

    let chunk_seed = chunk.map(|c| c.seed).unwrap_or(0);

    // Generate blueprint
    let blueprint = generate_procedural_blueprint(
        entity.archetype_id,
        npc_id,
        chunk_seed,
        ts_ms,
    );

    let blueprint_json = serde_json::to_vec(&blueprint)
        .map_err(|e| format!("Failed to serialize blueprint: {}", e))?;

    // Update or insert blueprint
    if ctx.db.npc_blueprint().npc_id().find(npc_id).is_some() {
        ctx.db.npc_blueprint().npc_id().update(NpcBlueprint {
            npc_id,
            blueprint_json,
            version: CURRENT_BLUEPRINT_VERSION,
            created_ts_ms: ts_ms,
        });
    } else {
        ctx.db.npc_blueprint().try_insert(NpcBlueprint {
            npc_id,
            blueprint_json,
            version: CURRENT_BLUEPRINT_VERSION,
            created_ts_ms: ts_ms,
        }).map_err(|e| format!("Failed to insert blueprint: {}", e))?;
    }

    // Emit event
    let _ = ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick,
        zone_id: entity.zone_id,
        chunk_x: entity.chunk_x,
        chunk_y: entity.chunk_y,
        actor_id: None,
        target_id: Some(npc_id),
        event_type: EventType::BlueprintCreated.as_u16(),
        payload: Vec::new(),
    });

    log::info!("Generated procedural blueprint for NPC {}", npc_id);

    Ok(())
}

/// Set an LLM-generated blueprint for an NPC.
/// Called by external LLM service after generating the blueprint.
#[reducer]
pub fn set_llm_blueprint(
    ctx: &ReducerContext,
    npc_id: u64,
    blueprint_json: String,
    model_id: String,
) -> Result<(), String> {
    let ts_ms = now_ms(ctx);
    let tick = current_tick(ctx);

    // Validate JSON structure
    let mut blueprint: Blueprint = serde_json::from_str(&blueprint_json)
        .map_err(|e| format!("Invalid blueprint JSON: {}", e))?;

    // Validate blueprint
    validate_blueprint(&blueprint)?;

    // Update metadata
    blueprint.metadata.created_ts_ms = ts_ms;
    blueprint.metadata.generation_method = "llm".to_string();
    blueprint.metadata.model_id = Some(model_id);
    blueprint.version = CURRENT_BLUEPRINT_VERSION;

    // Get entity
    let entity = ctx.db.entity().entity_id().find(npc_id)
        .ok_or("NPC entity not found")?;

    // Serialize updated blueprint
    let blueprint_bytes = serde_json::to_vec(&blueprint)
        .map_err(|e| format!("Failed to serialize: {}", e))?;

    // Update or insert
    if ctx.db.npc_blueprint().npc_id().find(npc_id).is_some() {
        ctx.db.npc_blueprint().npc_id().update(NpcBlueprint {
            npc_id,
            blueprint_json: blueprint_bytes,
            version: CURRENT_BLUEPRINT_VERSION,
            created_ts_ms: ts_ms,
        });
    } else {
        ctx.db.npc_blueprint().try_insert(NpcBlueprint {
            npc_id,
            blueprint_json: blueprint_bytes,
            version: CURRENT_BLUEPRINT_VERSION,
            created_ts_ms: ts_ms,
        }).map_err(|e| format!("Failed to insert blueprint: {}", e))?;
    }

    // Emit event
    let _ = ctx.db.event_log().try_insert(EventLog {
        event_id: 0,
        ts_ms,
        tick,
        zone_id: entity.zone_id,
        chunk_x: entity.chunk_x,
        chunk_y: entity.chunk_y,
        actor_id: None,
        target_id: Some(npc_id),
        event_type: EventType::BlueprintCreated.as_u16(),
        payload: Vec::new(),
    });

    log::info!("Set LLM blueprint for NPC {}", npc_id);

    Ok(())
}

/// Get the blueprint for an NPC.
#[reducer]
pub fn get_npc_blueprint(ctx: &ReducerContext, npc_id: u64) {
    let result = ctx.db.npc_blueprint().npc_id().find(npc_id)
        .and_then(|bp| {
            if bp.blueprint_json.is_empty() {
                None
            } else {
                String::from_utf8(bp.blueprint_json.clone()).ok()
            }
        });
    if let Some(json) = result {
        log::info!("Blueprint for NPC {}: {}", npc_id, json);
    } else {
        log::info!("No blueprint found for NPC {}", npc_id);
    }
}

/// Get a trimmed blueprint suitable for dialogue prompts.
#[reducer]
pub fn get_blueprint_for_dialogue(ctx: &ReducerContext, npc_id: u64) {
    let Some(bp) = ctx.db.npc_blueprint().npc_id().find(npc_id) else {
        log::info!("No blueprint found for NPC {}", npc_id);
        return;
    };

    if bp.blueprint_json.is_empty() {
        log::info!("Empty blueprint for NPC {}", npc_id);
        return;
    }

    let Ok(full) = serde_json::from_slice::<Blueprint>(&bp.blueprint_json) else {
        log::info!("Failed to parse blueprint for NPC {}", npc_id);
        return;
    };

    // Create trimmed version for dialogue
    #[derive(Serialize)]
    struct TrimmedBlueprint {
        name: String,
        role: String,
        traits: Vec<String>,
        values: Vec<String>,
        voice_style: String,
        truth_anchors: Vec<String>,
        backstory_summary: String,
    }

    let trimmed = TrimmedBlueprint {
        name: full.identity.name,
        role: full.identity.role,
        traits: full.personality.traits,
        values: full.personality.values,
        voice_style: full.voice_style.tone,
        truth_anchors: full.truth_anchors,
        backstory_summary: full.backstory.first().cloned().unwrap_or_default(),
    };

    if let Ok(json) = serde_json::to_string(&trimmed) {
        log::info!("Trimmed blueprint for NPC {}: {}", npc_id, json);
    }
}

/// Add a truth anchor to an NPC's blueprint.
#[reducer]
pub fn add_truth_anchor(ctx: &ReducerContext, npc_id: u64, anchor: String) -> Result<(), String> {
    let bp = ctx.db.npc_blueprint().npc_id().find(npc_id)
        .ok_or("Blueprint not found")?;

    if bp.blueprint_json.is_empty() {
        return Err("Blueprint is empty, generate one first".to_string());
    }

    let mut blueprint: Blueprint = serde_json::from_slice(&bp.blueprint_json)
        .map_err(|e| format!("Failed to parse blueprint: {}", e))?;

    // Add anchor (avoid duplicates)
    if !blueprint.truth_anchors.contains(&anchor) {
        blueprint.truth_anchors.push(anchor);
    }

    let blueprint_bytes = serde_json::to_vec(&blueprint)
        .map_err(|e| format!("Failed to serialize: {}", e))?;

    ctx.db.npc_blueprint().npc_id().update(NpcBlueprint {
        blueprint_json: blueprint_bytes,
        ..bp
    });

    Ok(())
}

/// Add a backstory fact to an NPC's blueprint.
#[reducer]
pub fn add_backstory_fact(ctx: &ReducerContext, npc_id: u64, fact: String) -> Result<(), String> {
    let bp = ctx.db.npc_blueprint().npc_id().find(npc_id)
        .ok_or("Blueprint not found")?;

    if bp.blueprint_json.is_empty() {
        return Err("Blueprint is empty, generate one first".to_string());
    }

    let mut blueprint: Blueprint = serde_json::from_slice(&bp.blueprint_json)
        .map_err(|e| format!("Failed to parse blueprint: {}", e))?;

    // Add fact (max 12)
    if blueprint.backstory.len() < 12 {
        blueprint.backstory.push(fact);
    } else {
        // Replace oldest non-core fact
        blueprint.backstory.remove(2);
        blueprint.backstory.push(fact);
    }

    let blueprint_bytes = serde_json::to_vec(&blueprint)
        .map_err(|e| format!("Failed to serialize: {}", e))?;

    ctx.db.npc_blueprint().npc_id().update(NpcBlueprint {
        blueprint_json: blueprint_bytes,
        ..bp
    });

    Ok(())
}

// =============================================================================
// Validation
// =============================================================================

/// Validate a blueprint structure.
fn validate_blueprint(bp: &Blueprint) -> Result<(), String> {
    // Identity validation
    if bp.identity.name.is_empty() {
        return Err("Name is required".to_string());
    }
    if bp.identity.name.len() > 100 {
        return Err("Name too long (max 100 chars)".to_string());
    }
    if bp.identity.role.is_empty() {
        return Err("Role is required".to_string());
    }

    // Personality validation
    if bp.personality.traits.is_empty() {
        return Err("At least one trait is required".to_string());
    }
    if bp.personality.traits.len() > 10 {
        return Err("Too many traits (max 10)".to_string());
    }

    // Backstory validation
    if bp.backstory.len() < 3 {
        return Err("At least 3 backstory facts required".to_string());
    }
    if bp.backstory.len() > 12 {
        return Err("Too many backstory facts (max 12)".to_string());
    }

    // Voice style
    if bp.voice_style.tone.is_empty() {
        return Err("Voice style tone is required".to_string());
    }
    if bp.voice_style.tone.len() > 200 {
        return Err("Voice style tone too long (max 200 chars)".to_string());
    }

    // Truth anchors
    if bp.truth_anchors.len() > 20 {
        return Err("Too many truth anchors (max 20)".to_string());
    }

    Ok(())
}
