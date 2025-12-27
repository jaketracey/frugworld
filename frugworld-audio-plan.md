# Frugworld procedural audio system

## Overview

Add a generative ambient music system to Frugworld that sonifies the social simulation in real-time. The audio should reflect the emergent social dynamics of the NPC network — relationships forming and dissolving, personality distributions, graph tensions, and community structures.

Inspired by Brian Eno's generative music and the gridsynth project (which sonified energy grid data), the goal is music that tells a story about what's happening in the simulation without requiring visual attention.

## Architecture

### Integration point

Add audio to the existing Three.js TypeScript client (`client/`). This client already subscribes to SpacetimeDB for game state, so we tap into the same data streams.

```
┌─────────────────────────────────────────────────────────┐
│  Three.js Client                                        │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────┐ │
│  │ SpacetimeDB  │───▶│ AudioEngine  │───▶│  Tone.js  │ │
│  │ Subscriptions│    │ (new)        │    │           │ │
│  └──────────────┘    └──────────────┘    └───────────┘ │
│         │                   │                          │
│         ▼                   ▼                          │
│  ┌──────────────┐    ┌──────────────┐                  │
│  │ Three.js     │    │ Web Audio    │                  │
│  │ Renderer     │    │ Context      │                  │
│  └──────────────┘    └──────────────┘                  │
└─────────────────────────────────────────────────────────┘
```

### File structure

```
client/
├── src/
│   ├── audio/
│   │   ├── MusicManager.ts       # Mode switching orchestrator
│   │   ├── LegacyAudio.ts        # Wrapper for existing music system
│   │   ├── AudioEngine.ts        # Generative system orchestrator
│   │   ├── instruments/
│   │   │   ├── index.ts
│   │   │   ├── RelationshipSynth.ts
│   │   │   ├── PersonalityPad.ts
│   │   │   ├── TensionDrone.ts
│   │   │   └── EventChime.ts
│   │   ├── generators/
│   │   │   ├── MelodyGenerator.ts
│   │   │   ├── HarmonyEngine.ts
│   │   │   └── RhythmGenerator.ts
│   │   ├── mappings/
│   │   │   ├── PersonalityToMusic.ts
│   │   │   ├── RelationshipToMusic.ts
│   │   │   └── GraphStateToMusic.ts
│   │   ├── ui/
│   │   │   └── MusicToggle.tsx   # Legacy/Generative toggle component
│   │   └── utils/
│   │       ├── scales.ts
│   │       └── AudioMath.ts
│   └── ...existing client code
```

## Data to music mappings

### Global tempo and key

| Data source | Musical parameter | Mapping |
|-------------|-------------------|---------|
| Average graph velocity | Tempo | Higher velocity = faster tempo (40-120 BPM range) |
| Dominant agreeableness | Key/mode | High agreeableness = major modes, low = minor/phrygian |
| Time of day (sim time) | Key shifts | Gradual modulation through circle of fifths |

### Instruments by relationship type

Each relationship type gets a distinct voice:

| Relationship | Instrument | Tone.js implementation |
|--------------|------------|------------------------|
| Friend | Warm pad | `PolySynth` with `AMSynth`, slow attack, chorus |
| CloseFriend | Resonant bell | `MetalSynth` or sampler with reverb |
| Stranger | Sparse pluck | `PluckSynth`, dry, quiet |
| Acquaintance | Soft keys | `FMSynth` with low mod index |
| Rival | Tense string | `MonoSynth` with filter sweep, slight detune |
| Enemy | Dissonant stab | `MonoSynth`, short decay, tritone intervals |
| MentorStudent | Call-response | Two voices, octave apart |

### Personality to timbre

NPC personality shapes the character of notes they "emit":

| Trait | Range | Musical effect |
|-------|-------|----------------|
| Extraversion 0-30 | Introverted | Quiet, sparse, high register |
| Extraversion 70-100 | Extraverted | Loud, dense, mid register |
| Agreeableness 0-30 | Disagreeable | Minor intervals, harsh harmonics |
| Agreeableness 70-100 | Agreeable | Major intervals, soft harmonics |

### Life stage to register and rhythm

| Life stage | Octave | Rhythm character |
|------------|--------|------------------|
| Youth | 5-6 | Faster note values, more variation |
| Adult | 3-4 | Steady, rhythmic |
| Mature | 2-3 | Slower, deliberate |
| Elder | 1-2 | Sparse, sustained |

### Relationship metrics to expression

| Metric | Musical parameter |
|--------|-------------------|
| Affinity (0-100) | Consonance of interval (unison at 100, tritone at 0) |
| Trust (0-100) | Reverb send (high trust = shared space) |
| Interaction count | Note density for that edge |

### Graph physics to drone layer

The force-directed simulation provides continuous data:

| Physics value | Sound |
|---------------|-------|
| Total kinetic energy | Drone volume and brightness |
| Spring tension (avg) | Filter cutoff on bass drone |
| Node clustering coefficient | Chord density |
| Graph diameter changes | Slow pitch bend on root drone |

### Events to one-shots

Discrete simulation events trigger musical moments:

| Event | Sound |
|-------|-------|
| New relationship formed | Rising arpeggio |
| Relationship upgraded (Stranger → Friend) | Consonant chord swell |
| Relationship degraded (Friend → Rival) | Descending minor phrase |
| NPC enters LOD0 (player proximity) | Soft chime in stereo field |
| NPC exits LOD0 | Fade-out tail |
| Life stage transition | Modal shift, sustained tone |

## Implementation details

### AudioEngine.ts

```typescript
import * as Tone from 'tone';

interface AudioEngineConfig {
  masterVolume: number;      // -60 to 0 dB
  enabled: boolean;
  spatialAudio: boolean;     // Pan based on graph position
}

class AudioEngine {
  private isPlaying: boolean = false;
  private instruments: Map<string, Tone.Instrument>;
  private droneSynth: Tone.Synth;
  private masterChannel: Tone.Channel;
  
  // Current musical state
  private currentKey: string = 'C';
  private currentMode: string = 'major';
  private currentTempo: number = 60;
  
  constructor(config: AudioEngineConfig);
  
  // Lifecycle
  async init(): Promise<void>;        // Create audio context (requires user gesture)
  start(): void;
  stop(): void;
  dispose(): void;
  
  // State updates from SpacetimeDB
  onGraphStateUpdate(state: GraphState): void;
  onRelationshipChange(event: RelationshipEvent): void;
  onNPCUpdate(npc: NPCState): void;
  onPhysicsUpdate(physics: PhysicsState): void;
  
  // Internal scheduling
  private scheduleMusicLoop(): void;
  private updateGlobalParameters(): void;
}
```

### Scale and harmony utilities

```typescript
// scales.ts
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

export function midiToFreq(midi: number): number;
export function quantizeToScale(midi: number, scale: number[], root: number): number;
export function affinityToInterval(affinity: number): number;  // 0-100 → semitones
```

### Transport and scheduling

Use Tone.js Transport for synchronized timing:

```typescript
Tone.Transport.bpm.value = this.currentTempo;
Tone.Transport.scheduleRepeat((time) => {
  this.onBeat(time);
}, '4n');
```

### Performance considerations

1. **Limit polyphony**: Max 8-12 simultaneous voices
2. **LOD for audio**: Only sonify NPCs in LOD0-LOD1, aggregate LOD2+ into drone texture
3. **Debounce updates**: Don't react to every physics frame — sample at 4-10 Hz
4. **Lazy instrument creation**: Only instantiate synths when needed
5. **Use Tone.js pools**: `PolySynth` handles voice allocation automatically

### User controls

Expose in UI:

- **Music system toggle**: Switch between "Legacy" and "Generative" modes
- Master volume slider
- Audio on/off toggle
- "Musical density" slider (sparse ↔ busy) — generative mode only
- Relationship type mute toggles (focus on friends only, etc.) — generative mode only

### Music system architecture

The audio system must support two distinct modes that the user can switch between at runtime:

```typescript
type MusicMode = 'legacy' | 'generative';

interface MusicSystemConfig {
  mode: MusicMode;
  volume: number;
  enabled: boolean;
}
```

```
┌─────────────────────────────────────────────────────────────┐
│  MusicManager                                               │
│                                                             │
│  ┌─────────────────┐         ┌─────────────────┐           │
│  │ LegacyAudio     │◄───┐    │ GenerativeAudio │           │
│  │ (existing)      │    │    │ (new AudioEngine)│           │
│  └─────────────────┘    │    └─────────────────┘           │
│                         │              ▲                    │
│                    ┌────┴──────────────┴────┐              │
│                    │   Mode Switch Logic    │              │
│                    │   (crossfade on swap)  │              │
│                    └────────────────────────┘              │
│                                ▲                            │
│                                │                            │
│                    ┌───────────┴───────────┐               │
│                    │      UI Toggle        │               │
│                    │  [Legacy] [Generative]│               │
│                    └───────────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

### MusicManager.ts

A wrapper that manages both systems and handles switching:

```typescript
import * as Tone from 'tone';
import { AudioEngine } from './AudioEngine';
import { LegacyAudio } from './LegacyAudio';  // Existing system

type MusicMode = 'legacy' | 'generative';

class MusicManager {
  private mode: MusicMode = 'legacy';
  private legacyAudio: LegacyAudio;
  private generativeAudio: AudioEngine;
  private crossfadeDuration: number = 2;  // seconds
  
  constructor() {
    this.legacyAudio = new LegacyAudio();
    this.generativeAudio = new AudioEngine();
  }
  
  async init(): Promise<void> {
    await Tone.start();
    await this.legacyAudio.init();
    await this.generativeAudio.init();
  }
  
  setMode(newMode: MusicMode): void {
    if (newMode === this.mode) return;
    
    const oldMode = this.mode;
    this.mode = newMode;
    
    // Crossfade between systems
    this.crossfade(oldMode, newMode);
  }
  
  getMode(): MusicMode {
    return this.mode;
  }
  
  private crossfade(from: MusicMode, to: MusicMode): void {
    const fromSystem = from === 'legacy' ? this.legacyAudio : this.generativeAudio;
    const toSystem = to === 'legacy' ? this.legacyAudio : this.generativeAudio;
    
    // Start the new system
    toSystem.start();
    toSystem.fadeIn(this.crossfadeDuration);
    
    // Fade out and stop the old system
    fromSystem.fadeOut(this.crossfadeDuration, () => {
      fromSystem.stop();
    });
  }
  
  // Forward state updates to active system only
  onGraphStateUpdate(state: GraphState): void {
    if (this.mode === 'generative') {
      this.generativeAudio.onGraphStateUpdate(state);
    }
  }
  
  onRelationshipChange(event: RelationshipEvent): void {
    if (this.mode === 'generative') {
      this.generativeAudio.onRelationshipChange(event);
    }
  }
  
  // ... other forwarding methods
}
```

### UI component

```typescript
// React example — adapt to your UI framework
interface MusicToggleProps {
  musicManager: MusicManager;
}

function MusicToggle({ musicManager }: MusicToggleProps) {
  const [mode, setMode] = useState<MusicMode>(musicManager.getMode());
  
  const handleModeChange = (newMode: MusicMode) => {
    setMode(newMode);
    musicManager.setMode(newMode);
  };
  
  return (
    <div className="music-toggle">
      <label>Music System</label>
      <div className="toggle-buttons">
        <button 
          className={mode === 'legacy' ? 'active' : ''} 
          onClick={() => handleModeChange('legacy')}
        >
          Legacy
        </button>
        <button 
          className={mode === 'generative' ? 'active' : ''} 
          onClick={() => handleModeChange('generative')}
        >
          Generative
        </button>
      </div>
    </div>
  );
}
```

### Persistence

Store the user's preference in localStorage:

```typescript
const MUSIC_MODE_KEY = 'frugworld_music_mode';

function loadMusicPreference(): MusicMode {
  return (localStorage.getItem(MUSIC_MODE_KEY) as MusicMode) || 'legacy';
}

function saveMusicPreference(mode: MusicMode): void {
  localStorage.setItem(MUSIC_MODE_KEY, mode);
}
```

### LegacyAudio wrapper

If the existing music system isn't already wrapped in a class, create a thin adapter:

```typescript
// LegacyAudio.ts — wraps existing music implementation
class LegacyAudio {
  private volume: Tone.Volume;
  
  async init(): Promise<void> {
    // Initialize existing music system
    // Move existing setup code here
  }
  
  start(): void {
    // Start legacy playback
  }
  
  stop(): void {
    // Stop legacy playback
  }
  
  fadeIn(duration: number): void {
    this.volume.volume.rampTo(0, duration);
  }
  
  fadeOut(duration: number, callback?: () => void): void {
    this.volume.volume.rampTo(-Infinity, duration);
    if (callback) {
      setTimeout(callback, duration * 1000);
    }
  }
}
```

## Tone.js setup

### Dependencies

```bash
npm install tone
```

### Audio context initialization

Web Audio requires user gesture to start. Add a "Start Audio" button or hook into existing play/pause:

```typescript
document.getElementById('startAudio')?.addEventListener('click', async () => {
  await Tone.start();
  console.log('Audio context started');
  audioEngine.start();
});
```

### Example instrument definitions

```typescript
// Warm friend pad
const friendPad = new Tone.PolySynth(Tone.AMSynth, {
  harmonicity: 2,
  oscillator: { type: 'sine' },
  envelope: {
    attack: 0.5,
    decay: 0.3,
    sustain: 0.8,
    release: 2,
  },
  modulation: { type: 'sine' },
  modulationEnvelope: {
    attack: 0.5,
    decay: 0.2,
    sustain: 0.5,
    release: 1,
  },
}).toDestination();

// Tense rival string
const rivalSynth = new Tone.MonoSynth({
  oscillator: { type: 'sawtooth' },
  filter: {
    type: 'lowpass',
    frequency: 800,
    Q: 2,
  },
  envelope: {
    attack: 0.1,
    decay: 0.3,
    sustain: 0.4,
    release: 0.8,
  },
  filterEnvelope: {
    attack: 0.05,
    decay: 0.2,
    sustain: 0.3,
    release: 0.5,
    baseFrequency: 200,
    octaves: 3,
  },
}).toDestination();

// Background tension drone
const tensionDrone = new Tone.Synth({
  oscillator: { type: 'sine' },
  envelope: {
    attack: 2,
    decay: 1,
    sustain: 1,
    release: 4,
  },
}).toDestination();
```

### Effects chain

```typescript
const reverb = new Tone.Reverb({ decay: 4, wet: 0.3 });
const delay = new Tone.PingPongDelay('8n', 0.2);
const filter = new Tone.Filter(2000, 'lowpass');
const limiter = new Tone.Limiter(-3);

// Chain: instruments → filter → reverb → delay → limiter → destination
friendPad.chain(filter, reverb, delay, limiter, Tone.Destination);
```

## Integration with SpacetimeDB subscriptions

Hook into existing subscription callbacks in the client:

```typescript
// In existing SpacetimeDB subscription handler
spacetimeClient.db.npcState.onUpdate((oldNpc, newNpc) => {
  audioEngine.onNPCUpdate(newNpc);
});

spacetimeClient.db.relationships.onInsert((relationship) => {
  audioEngine.onRelationshipChange({
    type: 'created',
    relationship,
  });
});

spacetimeClient.db.relationships.onUpdate((oldRel, newRel) => {
  if (oldRel.relationshipType !== newRel.relationshipType) {
    audioEngine.onRelationshipChange({
      type: 'upgraded',
      from: oldRel.relationshipType,
      to: newRel.relationshipType,
      relationship: newRel,
    });
  }
});
```

## Implementation phases

### Phase 1: Foundation and mode switching

1. Set up Tone.js in client, audio context initialization
2. Wrap existing music system in `LegacyAudio` class with start/stop/fadeIn/fadeOut interface
3. Create `MusicManager` class that handles mode switching and crossfading
4. Create `AudioEngine` class (generative) with matching interface
5. Add UI toggle for Legacy/Generative mode selection
6. Add localStorage persistence for mode preference
7. Add basic drone in generative mode that responds to graph size
8. Ensure both systems can be toggled without audio glitches

### Phase 2: Relationship voices

1. Implement instrument set for each relationship type
2. Map relationship events to musical phrases
3. Add spatial panning based on graph position
4. Implement affinity → consonance mapping

### Phase 3: Generative melody

1. Create scale/harmony utilities
2. Implement MelodyGenerator that creates phrases from NPC state
3. Add rhythm variation based on life stage
4. Schedule melodic loops on Transport

### Phase 4: Graph physics integration

1. Sample physics state at regular intervals
2. Map kinetic energy to drone characteristics
3. Add filter modulation based on spring tension
4. Implement subtle pitch drift from graph diameter

### Phase 5: Polish

1. Tune volumes and mixing
2. Add user controls for density/focus
3. Performance profiling and optimization
4. Cross-browser testing

## Testing approach

1. **Isolation testing**: AudioEngine with mock data, no SpacetimeDB
2. **Visual sync**: Verify audio events align with graph visualization
3. **Performance**: Monitor audio glitches under high node counts
4. **Musical evaluation**: Does it sound good? Iterate on mappings.

## References

- [Tone.js documentation](https://tonejs.github.io/)
- [Gridsynth implementation](https://github.com/rihanari/gridsynth) — prior art for data sonification
- [Brian Eno's generative music principles](https://en.wikipedia.org/wiki/Generative_music)
- [Web Audio API best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)
