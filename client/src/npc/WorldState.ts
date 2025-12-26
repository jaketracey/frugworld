/**
 * WorldState - Global world state for NPC decision making
 * Provides context about time, weather, and environment for goal evaluation
 */

import type { TimeOfDay } from '@/render/DayNightCycle.ts';
import type { Vec3 } from '@/types/protocol.ts';

export enum WeatherType {
  Clear = 'clear',
  Cloudy = 'cloudy',
  Rainy = 'rainy',
  Stormy = 'stormy',
  Snowy = 'snowy',
  Foggy = 'foggy',
}

export enum WeatherSeverity {
  None = 0,
  Light = 1,
  Moderate = 2,
  Heavy = 3,
  Severe = 4,
}

export interface WeatherState {
  type: WeatherType;
  severity: WeatherSeverity;
  temperature: number;
  windSpeed: number;
  durationRemainingMs: number;
}

export enum LocationType {
  Outdoors = 'outdoors',
  Building = 'building',
  Shelter = 'shelter',
  Workplace = 'workplace',
  Home = 'home',
  Market = 'market',
  Tavern = 'tavern',
  Temple = 'temple',
  Farm = 'farm',
  Forest = 'forest',
  Water = 'water',
}

export interface Location {
  id: string;
  name: string;
  type: LocationType;
  position: Vec3;
  radius: number;
  providesShelter: boolean;
  capacity: number;
  occupants: number;
  openTime: number;
  closeTime: number;
}

export enum TimePeriod {
  EarlyMorning = 'early_morning',
  Morning = 'morning',
  Midday = 'midday',
  Afternoon = 'afternoon',
  Evening = 'evening',
  Night = 'night',
}

export interface WorldStateSnapshot {
  tick: number;
  timeOfDay: number;
  timePeriod: TimePeriod;
  timePhase: TimeOfDay;
  weather: WeatherState;
  locations: Map<string, Location>;
  isOutdoorsDangerous: boolean;
}

export interface WorldStateConfig {
  weatherChangeIntervalMs: number;
  dynamicWeather: boolean;
}

const DEFAULT_CONFIG: WorldStateConfig = {
  weatherChangeIntervalMs: 120000,
  dynamicWeather: true,
};

export class WorldState {
  private config: WorldStateConfig;
  private currentTick: number = 0;
  private timeOfDay: number = 0.35;
  private weather: WeatherState;
  private locations: Map<string, Location> = new Map();
  private onWeatherChange: ((weather: WeatherState) => void) | null = null;

  constructor(config: Partial<WorldStateConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.weather = {
      type: WeatherType.Clear,
      severity: WeatherSeverity.None,
      temperature: 20,
      windSpeed: 2,
      durationRemainingMs: this.config.weatherChangeIntervalMs,
    };
  }

  setWeatherChangeCallback(callback: (weather: WeatherState) => void): void {
    this.onWeatherChange = callback;
  }

  updateTime(timeOfDay: number, tick: number): void {
    this.timeOfDay = timeOfDay;
    this.currentTick = tick;
  }

  setWeather(type: WeatherType, severity: WeatherSeverity): void {
    const changed = this.weather.type !== type || this.weather.severity !== severity;
    this.weather.type = type;
    this.weather.severity = severity;
    this.weather.durationRemainingMs = this.config.weatherChangeIntervalMs;
    this.updateWeatherProperties();
    if (changed) this.onWeatherChange?.(this.weather);
  }

  update(deltaMs: number): void {
    this.weather.durationRemainingMs -= deltaMs;
    if (this.config.dynamicWeather && this.weather.durationRemainingMs <= 0) {
      this.transitionWeather();
    }
  }

  registerLocation(location: Location): void {
    this.locations.set(location.id, location);
  }

  unregisterLocation(locationId: string): void {
    this.locations.delete(locationId);
  }

  getLocation(locationId: string): Location | undefined {
    return this.locations.get(locationId);
  }

  findNearestLocation(position: Vec3, type: LocationType, options?: { mustBeOpen?: boolean; mustHaveCapacity?: boolean }): Location | null {
    let nearest: Location | null = null;
    let nearestDist = Infinity;
    for (const location of this.locations.values()) {
      if (location.type !== type) continue;
      if (options?.mustBeOpen && !this.isLocationOpen(location)) continue;
      if (options?.mustHaveCapacity && location.capacity > 0 && location.occupants >= location.capacity) continue;
      const dx = position.x - location.position.x;
      const dy = position.y - location.position.y;
      const dz = position.z - location.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < nearestDist) { nearestDist = dist; nearest = location; }
    }
    return nearest;
  }

  findNearestShelter(position: Vec3): Location | null {
    let nearest: Location | null = null;
    let nearestDist = Infinity;
    for (const location of this.locations.values()) {
      if (!location.providesShelter) continue;
      const dx = position.x - location.position.x;
      const dy = position.y - location.position.y;
      const dz = position.z - location.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < nearestDist) { nearestDist = dist; nearest = location; }
    }
    return nearest;
  }

  isLocationOpen(location: Location): boolean {
    if (location.openTime < 0 || location.closeTime < 0) return true;
    const time = this.timeOfDay;
    if (location.openTime > location.closeTime) return time >= location.openTime || time <= location.closeTime;
    return time >= location.openTime && time <= location.closeTime;
  }

  isAtLocation(position: Vec3, locationId: string): boolean {
    const location = this.locations.get(locationId);
    if (!location) return false;
    const dx = position.x - location.position.x;
    const dy = position.y - location.position.y;
    const dz = position.z - location.position.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) <= location.radius;
  }

  getLocationAt(position: Vec3): Location | null {
    for (const location of this.locations.values()) {
      if (this.isAtLocation(position, location.id)) return location;
    }
    return null;
  }

  getSnapshot(): WorldStateSnapshot {
    return {
      tick: this.currentTick,
      timeOfDay: this.timeOfDay,
      timePeriod: this.getTimePeriod(),
      timePhase: this.getTimePhase(),
      weather: { ...this.weather },
      locations: new Map(this.locations),
      isOutdoorsDangerous: this.isOutdoorsDangerous(),
    };
  }

  getTimeOfDay(): number { return this.timeOfDay; }

  getTimePeriod(): TimePeriod {
    const t = this.timeOfDay;
    if (t >= 0.2 && t < 0.3) return TimePeriod.EarlyMorning;
    if (t >= 0.3 && t < 0.4) return TimePeriod.Morning;
    if (t >= 0.4 && t < 0.55) return TimePeriod.Midday;
    if (t >= 0.55 && t < 0.7) return TimePeriod.Afternoon;
    if (t >= 0.7 && t < 0.8) return TimePeriod.Evening;
    return TimePeriod.Night;
  }

  getTimePhase(): TimeOfDay {
    const t = this.timeOfDay;
    if (t < 0.2 || t >= 0.85) return 'night';
    if (t < 0.3) return 'dawn';
    if (t < 0.75) return 'day';
    return 'dusk';
  }

  getWeather(): Readonly<WeatherState> { return this.weather; }

  needsShelter(): boolean {
    return this.weather.type === WeatherType.Stormy || this.weather.severity >= WeatherSeverity.Heavy ||
      (this.weather.type === WeatherType.Rainy && this.weather.severity >= WeatherSeverity.Moderate);
  }

  isOutdoorsDangerous(): boolean {
    return this.weather.type === WeatherType.Stormy || this.weather.severity >= WeatherSeverity.Severe ||
      this.weather.temperature < -10 || this.weather.temperature > 40;
  }

  isNight(): boolean { return this.getTimePhase() === 'night'; }
  isDay(): boolean { const phase = this.getTimePhase(); return phase === 'day' || phase === 'dawn' || phase === 'dusk'; }

  private updateWeatherProperties(): void {
    const baseTemp = this.getBaseTemperature();
    switch (this.weather.type) {
      case WeatherType.Clear: this.weather.temperature = baseTemp + 5; this.weather.windSpeed = 2; break;
      case WeatherType.Cloudy: this.weather.temperature = baseTemp - 2; this.weather.windSpeed = 5; break;
      case WeatherType.Rainy: this.weather.temperature = baseTemp - 5; this.weather.windSpeed = 8 + this.weather.severity * 3; break;
      case WeatherType.Stormy: this.weather.temperature = baseTemp - 8; this.weather.windSpeed = 15 + this.weather.severity * 5; break;
      case WeatherType.Snowy: this.weather.temperature = -5 - this.weather.severity * 3; this.weather.windSpeed = 5 + this.weather.severity * 2; break;
      case WeatherType.Foggy: this.weather.temperature = baseTemp - 3; this.weather.windSpeed = 1; break;
    }
  }

  private getBaseTemperature(): number {
    const t = this.timeOfDay;
    if (t < 0.3 || t > 0.8) return 5;
    if (t < 0.5) return 5 + (t - 0.3) * 100;
    if (t < 0.6) return 25;
    return 25 - (t - 0.6) * 100;
  }

  private transitionWeather(): void {
    const transitions: Record<WeatherType, WeatherType[]> = {
      [WeatherType.Clear]: [WeatherType.Clear, WeatherType.Clear, WeatherType.Cloudy, WeatherType.Foggy],
      [WeatherType.Cloudy]: [WeatherType.Clear, WeatherType.Cloudy, WeatherType.Rainy, WeatherType.Foggy],
      [WeatherType.Rainy]: [WeatherType.Cloudy, WeatherType.Rainy, WeatherType.Stormy],
      [WeatherType.Stormy]: [WeatherType.Rainy, WeatherType.Cloudy],
      [WeatherType.Snowy]: [WeatherType.Cloudy, WeatherType.Snowy, WeatherType.Clear],
      [WeatherType.Foggy]: [WeatherType.Clear, WeatherType.Cloudy, WeatherType.Foggy],
    };
    const options = transitions[this.weather.type];
    const newType = options[Math.floor(Math.random() * options.length)];
    let newSeverity = WeatherSeverity.None;
    if (newType !== WeatherType.Clear) newSeverity = (Math.floor(Math.random() * 3) + 1) as WeatherSeverity;
    this.setWeather(newType, newSeverity);
  }
}
