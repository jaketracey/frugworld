# Frugworld

A zone-of-influence (ZOI) AI simulator game where players move through an expanding world populated by AI characters.

## Architecture

- **Backend**: SpacetimeDB (Rust module) - Authoritative server at 10-20Hz
- **Frontend**: WebGL renderer (Three.js) - Max FPS with client prediction
- **AI Service**: TypeScript service for LLM-powered NPC interactions

## Project Structure

```
frugworld/
├── server/          # SpacetimeDB Rust module
├── client/          # WebGL frontend (Three.js + TypeScript)
├── ai-service/      # AI/LLM integration service
└── plan.md          # Architecture specification
```

## Key Features

- Multi-resolution NPC simulation (LOD0-LOD3)
- Chunked procedural world generation
- Event-sourced architecture
- Procedural NPC dialogue with cost controls
- Client-side prediction with server reconciliation

## Development

### Backend
```bash
cd server
spacetime build
spacetime publish frugworld
```

### Frontend
```bash
cd client
npm install
npm run dev
```

### AI Service
```bash
cd ai-service
npm install
npm run dev
```

## Design Principles

1. Authoritative server, smooth client
2. Never call LLM in the tick loop
3. Multi-resolution simulation
4. Event-sourced core
5. Chunked infinite world
