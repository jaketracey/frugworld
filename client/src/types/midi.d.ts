/**
 * Type declarations for MIDI libraries
 */

declare module 'midi-player-js' {
  export interface Event {
    name: string;
    noteNumber?: number;
    velocity?: number;
    channel?: number;
    tick?: number;
    track?: number;
    delta?: number;
  }

  export class Player {
    constructor(callback?: (event: Event) => void);
    loadArrayBuffer(buffer: ArrayBuffer): void;
    loadDataUri(dataUri: string): void;
    play(): void;
    pause(): void;
    stop(): void;
    isPlaying(): boolean;
    on(event: 'midiEvent' | 'endOfFile' | 'playing', callback: (event: Event) => void): void;
    setTempo(tempo: number): void;
    getTempo(): number;
    getSongTime(): number;
    getSongTimeRemaining(): number;
    getSongPercentRemaining(): number;
    getTotalTicks(): number;
    getCurrentTick(): number;
    skipToTick(tick: number): void;
    skipToPercent(percent: number): void;
    skipToSeconds(seconds: number): void;
  }

  export default { Player };
}

declare module 'soundfont-player' {
  export interface InstrumentOptions {
    format?: 'mp3' | 'ogg';
    soundfont?: 'MusyngKite' | 'FluidR3_GM';
    nameToUrl?: (name: string, soundfont: string, format: string) => string;
    destination?: AudioNode;
    gain?: number;
    attack?: number;
    decay?: number;
    sustain?: number;
    release?: number;
    adsr?: [number, number, number, number];
  }

  export interface PlayOptions {
    gain?: number;
    duration?: number;
    attack?: number;
    decay?: number;
    sustain?: number;
    release?: number;
    loop?: boolean;
    adsr?: [number, number, number, number];
  }

  export interface Player {
    play(note: string | number, when?: number, options?: PlayOptions): AudioBufferSourceNode;
    stop(when?: number): void;
    connect(destination: AudioNode): Player;
  }

  export function instrument(
    ac: AudioContext,
    name: string,
    options?: InstrumentOptions
  ): Promise<Player>;

  export default {
    instrument,
  };
}
