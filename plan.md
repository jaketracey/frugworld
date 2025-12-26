# Frugworld Architecture
Version: 0.2 (implementation-ready for coding agents)  
Backend: SpacetimeDB (Rust module)  
Frontend: WebGL renderer (Three.js or Babylon.js)  
Server Tick: 10–20Hz authoritative  
Client Render: max FPS (requestAnimationFrame)  
Client Sim: fixed-step (recommended 60Hz) for prediction + smoothing  

---

## 1) Purpose and scope
Frugworld is a zone-of-influence (ZOI) AI simulator game where the player moves through an expanding world populated by many AI characters. The system must:
- Simulate NPCs at multiple levels of resolution depending on proximity/relevance.
- Expand the world continuously using chunked procedural generation with persistent changes.
- Log all gameplay events in SpacetimeDB (event-sourced), with derived state for realtime subscriptions.
- Produce coherent NPC backstories, motivations, and procedural dialogue while keeping AI/LLM costs reasonable.
- Support a WebGL client that renders at max FPS and receives server updates at 10–20Hz.

Non-goals (v1):
- Running LLM calls inside the 10–20Hz server tick loop
- Full deterministic lockstep across clients
- MMO-grade anti-cheat

---

## 2) Design principles
1. **Authoritative server, smooth client**: server owns truth; client predicts player motion and interpolates NPC state.
2. **Never call LLM in the tick**: LLM calls are event-driven (dialogue, rare replanning, blueprint creation).
3. **Multi-resolution simulation**: far NPCs are cheap “abstract life sim”; near NPCs are fully interactive.
4. **Event-sourced core**: append events; maintain derived current-state tables.
5. **Chunked infinite world**: deterministic base generation + persistent deltas stored as events/state.

---

## 3) System overview

### 3.1 Data flow summary
- Client connects -> receives `WorldSnapshot` + nearby chunks.
- Client sends input commands (sequence numbered).
- Server applies inputs on tick -> updates world -> writes events -> updates derived state.
- Server computes per-player relevance sets -> sends `WorldDelta` (10–20Hz).
- Client buffers deltas -> interpolates for render; reconciles player prediction using acked inputs.

### 3.2 Runtime loops
**Server**
- Fixed tick loop at 10–20Hz.
- Processes input queue, updates simulation, emits events, updates derived tables.
- Runs interest/LOD assignment and publishes replication messages.

**Client**
- rAF render loop.
- Fixed-step local sim (player prediction).
- Network receive loop (apply deltas, maintain interpolation buffer, reconcile).

---

## 4) Simulation LOD model (multi-resolution NPCs)

### 4.1 LOD tiers
Define distance thresholds (tuneable per platform):
- **LOD0 (interactive)**: 0–15m
- **LOD1 (nearby)**: 15–60m
- **LOD2 (far)**: 60–250m
- **LOD3 (offline/abstract)**: >250m or out of interest set

LOD is computed per player (multiplayer-ready) but v1 can assume single player.

### 4.2 What changes by LOD
| Capability | LOD0 | LOD1 | LOD2 | LOD3 |
|---|---:|---:|---:|---:|
| Transform updates | 10–20Hz | 5–10Hz / compressed | 0.5–2Hz | minutes-scale “life tick” |
| Pathfinding/steering | full | simplified | coarse waypoints | none |
| Interaction | full | limited | none | none |
| Dialogue | enabled | disabled | disabled | disabled |
| AI decision logic | reactive + utility | utility only | schedule/intent | schedule summary only |
| LLM usage | dialogue only | never | never | never |

### 4.3 Hydration / dehydration
NPC state is represented at two levels:
- **Hydrated state**: full movement/controller state, interaction state, short-term intent (LOD0/LOD1).
- **Dehydrated state**: high-level intent, location coarse, schedule, relationships, key stats (LOD2/LOD3).

Transition rules:
- Entering LOD0/LOD1 triggers hydration from dehydrated state (deterministic + stored values).
- Leaving to LOD2/LOD3 triggers dehydration (store summary fields, discard heavy runtime fields).

---

## 5) World expansion and chunking

### 5.1 Chunk grid
- World is partitioned into **chunks**: e.g., 64m x 64m (config).
- Chunks group into **regions** for caching/streaming (e.g., 8x8 chunks).

Coordinates:
- Chunk coord: `(cx, cy)` derived from world position `(x, y)`.

### 5.2 Deterministic base generation
Each chunk has a deterministic base seed:
- `chunk_seed = hash(world_seed, cx, cy)`

Base generation produces:
- Terrain/biome identifiers
- Navigation mesh seeds / road graphs
- Points of interest (POIs)
- Spawn tables (which NPC archetypes appear)

### 5.3 Persistent deltas
All non-deterministic or player-caused changes are stored as deltas:
- “NPC built a camp”
- “Door opened”
- “Shop inventory changed”
- “Tree destroyed”

Deltas are stored as events and optionally consolidated into chunk state tables.

### 5.4 Chunk lifecycle
- When a player approaches, server ensures chunk exists in DB; if not, generates base and records `ChunkGenerated`.
- Server streams chunk metadata + relevant entity snapshots to client.
- Client requests chunks within `chunk_radius` (e.g., 3–5 chunks) and prefetches outer ring.

---

## 6) AI characters: identity, goals, motivations, memory

### 6.1 NPC blueprint (one-time generation)
Each NPC has a **Blueprint** created once (LLM allowed here) and persisted.

Blueprint fields (structured JSON in DB):
- Identity: name, age, role, appearance tags
- Personality: traits, values, fears, desires
- Backstory: 5–12 bullet facts (canonical)
- Relationships: links to other NPC IDs (optional)
- Voice/style: short style descriptor
- Hard constraints: taboo topics, safety constraints, lore constraints
- “Truth anchors”: facts the NPC will never contradict

LLM usage policy:
- LLM call allowed at NPC creation time OR first time NPC becomes relevant/hydrated.
- Blueprint must be cached and never regenerated unless explicitly migrated.

### 6.2 Goals system (LLM-free runtime)
NPC runtime uses a layered goals model:
- **Long-term goal** (days/weeks): rarely changes.
- **Mid-term goal** (hours/day): updates on major events.
- **Short-term intent** (seconds/minutes): updated by utility/behavior rules.

Runtime updates are rules-based:
- Utility scoring or behavior tree
- Needs model (hunger, safety, social, wealth, etc.)
- Event triggers (attacked, met player, found item, etc.)

### 6.3 Memory model (cost-controlled)
Maintain three memory layers:
1. **Canonical facts**: from Blueprint (always included for dialogue)
2. **Recent summary**: rolling 5–15 bullet summary of recent events relevant to NPC
3. **Conversation summary per player**: rolling summary of player interactions

Storage:
- Persist summaries in DB, not full transcripts.
- Optionally persist full dialogue transcript as events, but do not feed full logs to LLM.

Updates:
- After a dialogue ends or every N turns, create/refresh summaries (LLM allowed but capped).
- Otherwise update summaries via deterministic rules (e.g., “player gave gift” -> append fact).

---

## 7) Procedural dialogue (event-driven LLM)

### 7.1 When dialogue is allowed
- Only when NPC is in LOD0 and in “talkable” interaction state.
- Dialogue generation is an on-demand request, not part of server tick.

### 7.2 Dialogue architecture
Implement a **Dialogue Service** inside the server module (or adjacent worker) that:
- Receives `DialogueRequest(player_id, npc_id, player_utterance, context_ref)`
- Loads: NPC Blueprint, relationship state, recent memory summary, local world facts (POI, time, threats)
- Produces: `DialogueResponse(text, intents, optional_actions, memory_update)`

Dialogue response must output:
- `text`: the line to show player
- `intents`: structured tags (e.g., offer_trade, ask_question, give_hint)
- `optional_actions`: structured suggestions for in-world actions (server validates)
- `memory_update`: concise summary additions (or instructions)

### 7.3 Tooling interface (Agents SDK compatible)
Define tool functions usable by any agent framework:
- `get_npc_blueprint(npc_id)`
- `get_relationship(player_id, npc_id)`
- `get_local_facts(zone_id, chunk_ids[])`
- `write_npc_memory(npc_id, summary_delta)`
- `write_relationship(player_id, npc_id, delta)`
- `emit_event(type, payload)` (server-side only)

### 7.4 Cost controls
- Token caps per response
- Cooldowns: max responses per minute per NPC
- Hard stop: conversation length threshold -> force summary + reset
- Prefer smaller/cheaper models for dialogue; reserve larger models for rare blueprint or replanning

---

## 8) Replanning (rare LLM usage)
Replanning is permitted only on major triggers:
- NPC loses job/home
- NPC relationship changes drastically
- NPC is injured or threatened persistently
- Story/quest milestone

Replanning outputs structured updates:
- new mid-term goal
- new constraints
- 1–3 planned steps
- updated memory summary

Never run replanning more frequently than a configured rate (e.g., max 1 per NPC per hour).

---

## 9) Backend: SpacetimeDB data model

### 9.1 Event log (append-only)
All gameplay changes are logged as events.

**Table: `event_log`**
- `event_id: u128`
- `ts_ms: u64`
- `tick: u64`
- `zone_id: u64`
- `chunk_x: i32`
- `chunk_y: i32`
- `actor_id: u64?`
- `target_id: u64?`
- `event_type: u16`
- `payload: bytes` (bincode/CBOR/JSON)

Event types (initial set):
- `ChunkGenerated`
- `EntitySpawned`, `EntityDespawned`
- `TransformSet` (optional; prefer derived state for frequent transforms)
- `ActionRequested`, `ActionResolved`
- `DialogueStarted`, `DialogueLine`, `DialogueEnded`
- `GoalUpdated`, `MemoryUpdated`, `RelationshipUpdated`
- `DamageDealt`, `ItemAdded`, `ItemRemoved`

### 9.2 Derived state tables (current truth)
These are subscribed to by clients.

**Table: `entity`**
- `entity_id: u64`
- `kind: u16` (player, npc, prop, item, etc.)
- `archetype_id: u32`
- `zone_id: u64`
- `chunk_x: i32`
- `chunk_y: i32`
- `alive: bool`

**Table: `transform`**
- `entity_id: u64` (pk)
- `x: i32` `y: i32` `z: i32` (quantized)
- `yaw: i16` (quantized)
- `vx: i16` `vy: i16` `vz: i16` (optional)
- `last_tick: u64`

**Table: `npc_blueprint`**
- `npc_id: u64` (pk)
- `blueprint_json: bytes`
- `version: u16`
- `created_ts_ms: u64`

**Table: `npc_state`**
- `npc_id: u64`
- `lod_state: u8` (0-3 current server-side)
- `long_goal: bytes`
- `mid_goal: bytes`
- `short_intent: bytes`
- `needs: bytes` (compact)
- `memory_summary: bytes` (short)
- `last_replan_ts_ms: u64`

**Table: `relationship`**
- `player_id: u64`
- `npc_id: u64`
- `affinity: i16`
- `trust: i16`
- `flags: u32`
- `conversation_summary: bytes`
- (pk: player_id + npc_id)

**Table: `chunk`**
- `zone_id: u64`
- `cx: i32`
- `cy: i32`
- `seed: u64`
- `biome: u16`
- `poi_blob: bytes`
- (pk: zone_id + cx + cy)

**Table: `chunk_delta_index`** (optional)
- `zone_id, cx, cy`
- `last_compaction_tick`
- `delta_blob` (if compacting deltas)

### 9.3 Indexing requirements
- `transform` indexed by chunk coords via join with `entity` for fast interest queries
- `relationship` indexed by player_id
- `event_log` indexed by zone/chunk/tick for replay/debug

---

## 10) Interest management (ZOI replication)

### 10.1 Interest set computation
Every server tick (or every N ticks) compute:
- Player position -> current chunk
- Interest radius (in meters or chunks)
- Entities within radius -> relevance set
- Assign LOD per entity based on distance band

### 10.2 Subscription state
Maintain per-player server-side state:
- `player_interest(player_id) -> {entity_ids, lod_by_entity, chunk_ids}`
- Diff against last tick to compute:
  - spawn-in messages
  - update messages
  - despawn/sleep messages

### 10.3 Update frequencies per LOD
Server publishes different update rates:
- LOD0: every tick (10–20Hz)
- LOD1: every 2 ticks (5–10Hz)
- LOD2: every 10–40 ticks (0.5–2Hz)
- LOD3: none (unless major event occurs)

Implementation: schedule entity update emission with counters per entity or per LOD bucket.

---

## 11) Networking protocol (logical)

### 11.1 Client -> server messages
**`InputCommand`**
- `player_id`
- `input_seq: u32`
- `client_time_ms: u64`
- `move: (ax, ay)` (normalized)
- `actions: bitset` (jump, interact, etc.)
- `aim_yaw: i16` (optional)

**`ChunkSubscribe`**
- `player_id`
- `chunks: [(cx, cy)]`

**`DialogueRequest`**
- `player_id`
- `npc_id`
- `utterance: string`
- `context_hint: bytes?` (optional)

### 11.2 Server -> client messages
**`WorldSnapshot`** (initial/resync)
- `server_tick`
- `server_time_ms`
- `chunks: [...]`
- `entities: [...]` (within interest)
- `player_state`
- `last_input_seq_applied`

**`WorldDelta`** (steady state)
- `server_tick`
- `server_time_ms`
- `spawned_entities: [...]`
- `updated_transforms: [...]`
- `updated_components: [...]` (rare)
- `removed_entity_ids: [...]`
- `last_input_seq_applied`

**`ChunkData`**
- `cx, cy`
- `seed`
- `poi_blob`
- `delta_blob?`

**`DialogueResponse`**
- `npc_id`
- `text`
- `intent_tags`
- `optional_actions`
- `server_events_emitted` (ids/types)

### 11.3 Compression/quantization
- Quantize positions to int millimeters/centimeters.
- Delta encode transforms where possible.
- Avoid sending unchanged fields.

---

## 12) Client simulation, interpolation, reconciliation

### 12.1 Player prediction
- Client simulates movement immediately upon input.
- Client sends inputs with `input_seq`.
- Server acks last applied seq in `WorldDelta`.
- Client reconciliation:
  1. Store local predicted states keyed by `input_seq`.
  2. When ack arrives, rewind to server authoritative state and replay unacked inputs.
  3. If drift < threshold, smooth-correct instead of hard snap.

### 12.2 NPC interpolation
- Maintain a ring buffer of transform snapshots per entity keyed by `server_tick`.
- Render at `server_time - interp_delay_ms` (100–200ms typical).
- If missing updates, extrapolate briefly with clamp.

### 12.3 Entity lifecycle
- Spawn when enters interest set.
- If leaves interest set:
  - either despawn locally
  - or fade out / park (depending on design)
- If LOD changes, adjust smoothing and animation fidelity.

---

## 13) Server simulation details

### 13.1 Tick pipeline (authoritative)
Each tick:
1. Dequeue and apply input commands for each player (validated).
2. Update players (movement, interactions).
3. Update NPCs by LOD:
   - LOD0/LOD1: steering + utility selection + interaction gating
   - LOD2/LOD3: coarse schedule/life tick (maybe not every tick)
4. Resolve interactions (collisions/trigger volumes/transactions).
5. Write events to `event_log` for meaningful changes.
6. Update derived tables (`transform`, `npc_state`, etc.).
7. Compute interest diffs and publish `WorldDelta`.

### 13.2 Scheduling for far NPCs
- Maintain a “life tick” scheduler separate from main tick:
  - e.g., every 5–30 seconds per NPC for LOD2, every 1–5 minutes for LOD3
- Life tick updates:
  - coarse location (chunk)
  - needs decay
  - schedule progress
  - rare goal transitions

---

## 14) AI implementation (non-LLM runtime)

### 14.1 Utility/behavior system
Provide a deterministic scoring system:
- Inputs: needs, threats, time-of-day, proximity to POIs, relationship signals
- Output: short intent/action

Example intents:
- `wander`, `work`, `seek_food`, `rest`, `avoid_threat`, `approach_player`, `socialize`

### 14.2 Needs model
Minimal needs (compact):
- hunger, fatigue, safety, social, wealth/comfort
Needs decay based on time and events.

### 14.3 Relationship model
Simple scalar + flags:
- affinity, trust
- flags: offended, owes_favor, friend, hostile
Update on events and dialogue outcomes.

---

## 15) Dialogue implementation

### 15.1 Prompt inputs (must be bounded)
- NPC blueprint (trimmed structured facts)
- Relationship state (numbers + key flags)
- Recent NPC memory summary (<= N bullets)
- Local world facts summary (<= N bullets)
- Player utterance

### 15.2 Prompt outputs (structured)
The model must output JSON with:
- `text`
- `intent_tags[]`
- `memory_delta[]` (bullets)
- `relationship_delta` (optional)
- `actions[]` (optional; server validates)

### 15.3 Safety and lore constraints
- Enforce lore rules server-side (never let LLM write directly to state without validation).
- Keep “truth anchors” as non-negotiable constraints in blueprint.

---

## 16) Cost controls (hard requirements)
- **No LLM calls in 10–20Hz tick loop.**
- Blueprint generation: max once per NPC.
- Dialogue:
  - capped tokens per response
  - rate-limited per NPC + per player
  - auto-summarize long conversations
- Replanning:
  - rate-limited (e.g., <= 1/hour/NPC)
  - only on major triggers
- Memory: summaries only in prompts; full transcripts optional as events but not fed wholesale.

---

## 17) Observability and debugging

### 17.1 Metrics
- Server tick duration p50/p95
- Entities per player interest set
- Deltas per tick bytes/player
- NPC hydration count (thrash detection)
- LLM requests: count, tokens, latency, cost estimate

### 17.2 Replay/debug
- Use `event_log` to replay:
  - chunk generation
  - spawns
  - key actions
  - dialogue
- Provide admin/dev endpoints or tooling to:
  - dump NPC blueprint + memory
  - inspect interest set composition
  - trace entity update emission schedule

---

## 18) Security / validation (baseline)
- Validate client inputs: rate, bounds, speed hacks (basic).
- Server validates all `optional_actions` from dialogue before applying.
- Never let client authoritatively set transforms.

---

## 19) Implementation plan (phased)

### Phase 1: Walking world + replication
- Chunk generation (seeded)
- Spawn NPCs in chunks (basic archetypes)
- Interest set replication (LOD0 only)
- Client render + interpolation

### Phase 2: LOD tiers + hydration
- LOD0/1/2/3 representation
- Update frequency throttling
- Life tick scheduling for far NPCs

### Phase 3: NPC blueprints + goals
- Blueprint table + generation pipeline (LLM once)
- Utility goals + needs model
- Memory summary storage

### Phase 4: Dialogue
- DialogueRequest/Response messages
- Event-driven LLM calls
- Summarization + relationship deltas

### Phase 5: Scale + polish
- Compression
- Prefetching chunks
- Metrics + replay tooling

---

## 20) Agent implementation tasks (for coding agents)

### A) Backend (Rust / SpacetimeDB)
1. Define tables: `event_log`, `entity`, `transform`, `chunk`, `npc_blueprint`, `npc_state`, `relationship`.
2. Implement chunk generation function:
   - deterministic seed
   - insert `chunk`
   - emit `ChunkGenerated`
3. Implement entity spawn/despawn + persistence:
   - `EntitySpawned` events
   - derived state writes
4. Implement server tick loop:
   - input queue
   - movement + updates
5. Implement interest management:
   - compute relevance set
   - LOD assignment
   - diff and emit `WorldDelta`
6. Implement LOD scheduling:
   - per-LOD emission counters
   - life tick scheduler for LOD2/LOD3
7. Implement dialogue pipeline:
   - request handler (async/job style)
   - fetch context tools
   - validate response actions
   - write `DialogueLine` and memory/relationship updates
8. Add metrics hooks and debug queries.

### B) Frontend (WebGL)
1. Networking client:
   - connect, snapshot, delta apply
2. Entity component system:
   - spawn/despawn
   - transform smoothing buffers
3. Player prediction + reconciliation:
   - input buffer
   - ack handling
4. Chunk streaming:
   - request radius
   - integrate chunk visuals (terrain/props)
5. NPC LOD rendering:
   - LOD0 high fidelity, LOD1 simplified, LOD2 billboard/marker, LOD3 none
6. Dialogue UI:
   - trigger talk (LOD0 only)
   - render NPC responses
   - show intent-driven options (optional)

### C) AI tooling integration
1. Blueprint generation function (one-shot):
   - outputs structured JSON
   - persists to `npc_blueprint`
2. Dialogue generation function:
   - bounded prompt builder
   - structured output parser/validator
3. Summarization function:
   - compress conversation into bullets
   - update `relationship.conversation_summary`

---

## 21) Open questions (implementation defaults if unanswered)
- Choose server tick: default 20Hz if CPU allows, else 10Hz.
- Chunk size default: 64m (tune for nav + streaming).
- Engine choice: Three.js vs Babylon.js (both fine; pick one for v1).
- Physics: start with simple kinematic movement + avoidance.

---

## 22) Acceptance criteria (v1)
- Player can walk indefinitely; world expands via chunk generation.
- At least 200 NPCs exist in simulation; client only renders/updates those in interest set.
- LOD transitions occur without visible “popping” (basic smoothing).
- Dialogue works for nearby NPCs (LOD0) and is procedurally generated.
- LLM usage remains bounded: no tick-loop calls; blueprint is one-time; dialogue is rate-limited.
- Event log supports replay/inspection of key events and dialogue.

---
