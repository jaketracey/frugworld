# Frugworld

**A vibecode project by Jake Tracey**

Exploring the meanings of language in emergent gameplay scenarios through AI-driven NPC social networks.

---

## Overview

Frugworld is an experimental zone-of-influence AI simulator that visualizes the emergent social fabric of NPC (Non-Player Character) relationships. The project investigates how language, personality, and social dynamics create meaning through gameplay—watching as NPCs form friendships, rivalries, and complex social hierarchies based on their interactions, memories, and evolving personalities.

The visualization renders these relationships as an interactive force-directed graph, where the topology itself becomes a language—expressing the hidden social structures that emerge from simulated life.

---

## Philosophy: Vibecode & Emergent Meaning

This project embraces the **vibecode** approach: code that captures vibes, intuitions, and emergent behaviors rather than rigid specifications. The meaning of language in Frugworld isn't predefined—it emerges from:

- **NPC Personalities**: Extraversion, agreeableness, and life stages shape how NPCs communicate and form bonds
- **Relationship Evolution**: Strangers become friends, mentors, or rivals through accumulated interactions
- **Memory & Intent**: NPCs carry memories and goals that influence their social decisions
- **Visual Vocabulary**: The graph itself speaks—node sizes, colors, edge thickness all encode semantic meaning

---

## Architecture

```
frugworld/
├── server/              # SpacetimeDB Rust module
├── client/              # WebGL frontend (Three.js + TypeScript)
├── graph-client/        # WASM graph visualization (wgpu + egui)
├── ai-service/          # AI/LLM integration service
└── plan.md              # Architecture specification
```

### Core Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Backend** | SpacetimeDB (Rust) | Authoritative server at 20Hz tick rate |
| **Frontend** | Three.js + TypeScript | WebGL renderer with client prediction |
| **Graph Client** | wgpu + egui (WASM) | Force-directed relationship visualization |
| **AI Service** | TypeScript + OpenAI | LLM-powered NPC dialogue |

---

## Graph Visualization

### Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| **wgpu** | 27.0.1 | GPU graphics abstraction (WebGPU/Vulkan/Metal) |
| **egui** | 0.33.3 | Immediate-mode UI framework |
| **winit** | 0.30 | Cross-platform windowing |
| **glam** | 0.29 | Linear algebra |
| **wasm-bindgen** | 0.2 | Rust-JavaScript FFI |

### Visual Language

The graph speaks through a visual vocabulary:

```
Node Size       ← Extraversion (introverted=small, extraverted=large)
Node Color      ← Agreeableness (cold blue=disagreeable, warm orange=agreeable)
Node Shape      ← Life Stage (Circle=Youth, Square=Adult, Hexagon=Mature, Pentagon=Elder)
Node Glow       ← Social Reputation
Node Opacity    ← LOD State (distance-based fade)

Edge Color      ← Relationship Type (green=friend, red=enemy, blue=mentor, gray=stranger)
Edge Thickness  ← Interaction Count (thicker = more encounters)
```

### Spatial Systems

**Quadtree with Barnes-Hut Approximation:**
- O(log n) spatial queries for view culling
- O(n log n) force calculations (vs naive O(n²))
- 15-unit hit radius for node picking

**Force-Directed Layout:**
- Repulsion: Barnes-Hut approximation pushes nodes apart
- Attraction: Spring forces pull connected nodes together
- Chunk gravity: Gentle attraction toward world chunk centers
- Damping: 0.92 velocity reduction for stability

---

## Data Model

### Nodes — NPC Representation

Each node encodes an NPC's identity and state:

- **Identity**: entity_id, name, archetype, chunk coordinates
- **Personality Traits** (0-100): extraversion, agreeableness
- **Life Stage**: Youth → Adult → Mature → Elder
- **Semantic State**: short_intent, mid_goal, long_goal, needs_summary, memory_summary
- **Social Reputation**: affects visual glow intensity

### Edges — Relationships

Directional relationships with semantic depth:

- **Types**: Stranger → Acquaintance → Friend → CloseFriend, Rival, Enemy, MentorStudent
- **Metrics**: affinity (asymmetric), trust, interaction_count
- **Flags**: Met, Traded, Hostile, Owes Favor, Offended, Shared Secret, Active Grudge

---

## Backend Systems

### SpacetimeDB Server

An event-sourced game server providing:

- **20 Hz tick rate** deterministic simulation
- **Multi-LOD NPC updates** based on player proximity
- **Utility-based AI** decision making
- **Personality evolution** over time
- **Memory consolidation** and knowledge storage

### NPC Simulation (LOD-based)

| LOD | Radius | Update Frequency | Detail Level |
|-----|--------|------------------|--------------|
| LOD0 | 15m | Every tick | Full behavior, goals, memory |
| LOD1 | 60m | Hourly | Reduced updates |
| LOD2 | 250m | Daily | Minimal updates |
| LOD3 | >250m | Monthly | Life-tick only |

### Key Server Tables

- **Event Log**: Append-only audit trail (event sourcing)
- **NPC Blueprint**: Persistent identity, personality, backstory
- **NPC State**: Runtime simulation (goals, intents, memory)
- **NPC-NPC Relationships**: Social bonds with affinity/trust
- **Chunks**: Deterministically generated world regions

---

## Controls

### Camera

| Input | Action |
|-------|--------|
| WASD | Pan camera |
| Scroll wheel | Zoom (0.1x - 10x) |
| Middle-mouse drag | Pan |
| F | Fit all nodes to view |
| R | Reset camera |

### Interaction

| Input | Action |
|-------|--------|
| Click | Select node |
| Shift+Click | Multi-select |
| Tab | Cycle through neighbors |
| Esc | Clear selection |
| 1-3 | Filter relationship types |
| Space | Toggle layout simulation |

---

## Development

### Backend
```bash
cd server
spacetime build
spacetime publish frugworld
```

### Frontend (Three.js)
```bash
cd client
npm install
npm run dev
```

### Graph Client (WASM)
```bash
cd graph-client
cargo build --release --target wasm32-unknown-unknown
```

### AI Service
```bash
cd ai-service
npm install
npm run dev
```

---

## Design Principles

1. **Authoritative server, smooth client** - Server owns truth, clients predict
2. **Never call LLM in the tick loop** - Async dialogue generation
3. **Multi-resolution simulation** - LOD-based CPU efficiency
4. **Event-sourced core** - Complete audit trail, replayable state
5. **Chunked infinite world** - Deterministic procedural generation

---

## The Emergent Language

In Frugworld, language emerges at multiple levels:

1. **Topological**: The shape of the social graph encodes community structure
2. **Chromatic**: Colors speak of personality and relationship valence
3. **Kinetic**: The physics simulation reveals social tensions and attractions
4. **Narrative**: NPC memories and goals create story fragments
5. **Temporal**: Relationships evolve, creating arcs of meaning over time

The visualization doesn't just display data—it speaks a visual language that lets us perceive the invisible social dynamics that emerge from simulated consciousness.

---

## Key Features

- Multi-resolution NPC simulation (LOD0-LOD3)
- Chunked procedural world generation
- Event-sourced architecture
- Procedural NPC dialogue with cost controls
- Client-side prediction with server reconciliation
- Force-directed graph visualization
- GPU-accelerated rendering (10,000+ nodes)
- Real-time relationship dynamics

---

*Built with curiosity about what happens when we let meaning emerge from simulation rather than specification.*
