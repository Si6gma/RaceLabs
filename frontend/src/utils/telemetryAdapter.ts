import type { TelemetrySample } from '@/types/telemetry';

/**
 * Unified flat telemetry point format.
 * Both live frames (via UDP) and imported samples (from DB) normalize to this.
 */
export interface TelemetryPoint {
  speed_kmh: number;
  throttle: number;
  brake: number;
  steering: number;
  gear: number;
  rpm: number;
  gforce_lat: number;
  delta_time: number;
  world_position_x: number;
  world_position_y: number;
  world_position_z: number;
  normalized_track_position: number;
  lap_time?: number;
  sector: number;
  cumulative_distance: number;
  /** Monotonic timestamp in seconds (e.g. performance.now()/1000). Used for time-based graphs. */
  timestamp?: number;
}

/**
 * Normalize imported CSV samples (already mostly flat) to TelemetryPoint.
 */
export function normalizeImportedSamples(samples: TelemetrySample[]): TelemetryPoint[] {
  return samples.map(s => ({
    speed_kmh: s.speed_kmh ?? 0,
    throttle: s.throttle ?? 0,
    brake: s.brake ?? 0,
    steering: s.steering ?? 0,
    gear: s.gear ?? 0,
    rpm: s.rpm ?? 0,
    gforce_lat: s.gforce_lat ?? 0,
    delta_time: s.delta_time ?? 0,
    world_position_x: s.world_position_x ?? 0,
    world_position_y: s.world_position_y ?? 0,
    world_position_z: s.world_position_z ?? 0,
    normalized_track_position: s.normalized_track_position ?? 0,
    lap_time: s.lap_time,
    sector: s.sector ?? 0,
    cumulative_distance: s.cumulative_distance ?? 0,
  }));
}
