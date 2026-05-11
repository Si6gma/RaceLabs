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

/**
 * Normalize live UDP frames (nested structure) to TelemetryPoint.
 *
 * Live frames from frame_to_dict() have shape:
 * {
 *   motion?: { world_pos_x, world_pos_y, world_pos_z, g_force_lat, ... },
 *   lap?: { lap_distance, total_distance, sector, current_lap_time_ms, ... },
 *   telemetry?: { speed, throttle, brake, steer, gear, engine_rpm, ... },
 *   session?: { track_length, ... }
 * }
 */
export function normalizeLiveFrames(frames: any[]): TelemetryPoint[] {
  if (!frames || frames.length === 0) return [];

  // Extract track length from first frame that has it
  let trackLength = 1;
  for (const f of frames) {
    if (f.session?.track_length && f.session.track_length > 0) {
      trackLength = f.session.track_length;
      break;
    }
  }

  return frames.map(f => {
    const telem = f.telemetry || {};
    const motion = f.motion || {};
    const lap = f.lap || {};

    const lapDistance = lap.lap_distance ?? 0;

    return {
      speed_kmh: telem.speed ?? 0,
      throttle: telem.throttle ?? 0,
      brake: telem.brake ?? 0,
      steering: telem.steer ?? 0,
      gear: telem.gear ?? 0,
      rpm: telem.engine_rpm ?? 0,
      gforce_lat: motion.g_force_lat ?? 0,
      delta_time: lap.delta_time ?? 0,
      world_position_x: motion.world_pos_x ?? 0,
      world_position_y: motion.world_pos_y ?? 0,
      world_position_z: motion.world_pos_z ?? 0,
      normalized_track_position: trackLength > 0 ? lapDistance / trackLength : 0,
      lap_time: lap.current_lap_time_ms ? lap.current_lap_time_ms / 1000 : undefined,
      sector: lap.sector ?? 0,
      cumulative_distance: lap.total_distance ?? lapDistance ?? 0,
    };
  });
}
