import { create } from 'zustand';
import type { TelemetryPoint } from '@/utils/telemetryAdapter';
import type { LapData, ParticipantInfo, TelemetryFrame } from '@/types/telemetry';
import { useTelemetryStore, clearFrameHistory } from '@/stores/telemetryStore';

// Plays a recorded session back through the live page by feeding the store
// the same frame shape the WebSocket would. Time runs on lap_time, so the
// scrubber maps straight onto laps.

export interface ReplayLap {
  number: number;
  timeMs: number;
  sectorsMs: [number | null, number | null, number | null];
  nickname: string | null;
  samples: TelemetryPoint[];
  /** Game session_time at the lap's first sample, to line up with field frames. */
  sessionTimeStart: number | null;
}

/** One snapshot of the whole grid: [lap_distance, car_position, current_lap_num] per car. */
export interface FieldFrame { t: number; cars: [number, number, number][] }

export interface ReplayField {
  playerCarIndex: number | null;
  participants: ParticipantInfo[];
  carTeamIds: number[];
  laps: Array<{ lap_number: number; frames: FieldFrame[] }>;
}

export interface GridLap {
  car_index: number;
  lap_number: number;
  lap_time_ms: number;
  sector1_ms: number | null;
  sector2_ms: number | null;
  sector3_ms: number | null;
  valid: boolean;
}

export interface ReplaySession {
  id: string;
  name: string;
  trackId: number | undefined;
  trackLength: number;
  sessionType: string;
  field?: ReplayField;
  grid?: GridLap[];
}

const RACE_TYPE_ID = 10;
const PRACTICE_TYPE_ID = 1;

function frameAt(frames: FieldFrame[], t: number): FieldFrame | null {
  if (!frames.length) return null;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < t) lo = mid + 1; else hi = mid;
  }
  return frames[lo];
}

interface ReplayState {
  session: ReplaySession | null;
  laps: ReplayLap[];
  /** Cumulative start of each lap in ms, plus the total at the end. */
  offsets: number[];
  playing: boolean;
  speed: number;
  /** Position in ms from the start of the first lap. */
  t: number;
  load: (session: ReplaySession, laps: ReplayLap[], speed: number) => void;
  play: () => void;
  pause: () => void;
  seek: (t: number) => void;
  setSpeed: (speed: number) => void;
  stop: () => void;
  /** Advance by wall-clock ms and push a frame. Returns false at the end. */
  tick: (dtMs: number) => boolean;
}

const DEFAULT_REDLINE = 13000;

function sampleAt(samples: TelemetryPoint[], seconds: number): TelemetryPoint {
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((samples[mid].lap_time ?? 0) < seconds) lo = mid + 1; else hi = mid;
  }
  return samples[lo];
}

function buildFrame(session: ReplaySession, laps: ReplayLap[], lapIdx: number, intoLapMs: number): TelemetryFrame {
  const lap = laps[lapIdx];
  const p = sampleAt(lap.samples, intoLapMs / 1000);
  const prev = laps[lapIdx - 1];
  const sector = p.sector ?? 0;
  const lapData = {
    last_lap_time_ms: prev?.timeMs ?? 0,
    current_lap_time_ms: Math.round(intoLapMs),
    sector1_time_ms: sector >= 1 ? lap.sectorsMs[0] ?? 0 : 0,
    sector2_time_ms: sector >= 2 ? lap.sectorsMs[1] ?? 0 : 0,
    lap_distance: p.cumulative_distance,
    total_distance: p.cumulative_distance,
    delta_to_car_in_front_ms: 0,
    delta_to_race_leader_ms: 0,
    car_position: 1,
    current_lap_num: lap.number,
    pit_status: 0,
    sector,
    current_lap_invalid: false,
    penalties: 0,
    driver_status: 1,
    result_status: 2,
  };
  const rpm = p.rpm ?? 0;
  const telemetry = {
    speed: p.speed_kmh, throttle: p.throttle, steer: p.steering, brake: p.brake, clutch: 0,
    gear: p.gear, engine_rpm: rpm, drs: 0, rev_lights_percent: Math.max(0, Math.min(100, (rpm / DEFAULT_REDLINE) * 100)),
    brakes_temp: [0, 0, 0, 0], tyres_surface_temp: [0, 0, 0, 0], tyres_inner_temp: [0, 0, 0, 0],
    engine_temp: 0, tyres_pressure: [0, 0, 0, 0],
  };
  const motion = {
    speed: p.speed_kmh / 3.6,
    // The adapter stores the game's Z (longitudinal) as world_position_y; undo that here.
    world_pos_x: p.world_position_x, world_pos_y: p.world_position_z, world_pos_z: p.world_position_y,
    g_force_lat: p.gforce_lat, g_force_lon: 0, g_force_vert: 1, yaw: 0, pitch: 0, roll: 0, wheel_speed: [0, 0, 0, 0],
  };
  const status = {
    fuel_in_tank: 0, fuel_capacity: 0, fuel_remaining_laps: 0, drs_allowed: 0, tyres_wear: [0, 0, 0, 0],
    tyre_compound: 0, tyres_age_laps: 0, front_left_wing_damage: 0, front_right_wing_damage: 0, rear_wing_damage: 0,
    engine_damage: 0, gearbox_damage: 0, ers_store_energy: 0, ers_deploy_mode: 0,
    ers_harvested_this_lap_mguk: 0, ers_harvested_this_lap_mguh: 0, ers_deployed_this_lap: 0, max_rpm: DEFAULT_REDLINE,
  };
  const damage = {
    tyres_wear: [0, 0, 0, 0], tyres_damage: [0, 0, 0, 0], front_left_wing_damage: 0, front_right_wing_damage: 0,
    rear_wing_damage: 0, floor_damage: 0, diffuser_damage: 0, sidepod_damage: 0, gear_box_damage: 0, engine_damage: 0,
  };
  // With field data the whole grid comes back: every car's distance, position
  // and lap at this moment, plus each car's last lap time from the grid laps.
  const field = session.field;
  const player = field?.playerCarIndex ?? 0;
  let lapAll: LapData[] = [lapData];
  let allDistances = [p.cumulative_distance];
  let teamIds: number[] = [85];
  let participants: ParticipantInfo[] = [];
  if (field && lap.sessionTimeStart != null) {
    const fieldLap = field.laps.find(f => f.lap_number === lap.number);
    const snap = fieldLap ? frameAt(fieldLap.frames, lap.sessionTimeStart + intoLapMs / 1000) : null;
    if (snap) {
      const grid = session.grid ?? [];
      lapAll = snap.cars.map(([dist, pos, lapNum], i) => {
        if (i === player) return { ...lapData, car_position: pos || lapData.car_position };
        const lastLap = grid.find(g => g.car_index === i && g.lap_number === lapNum - 1);
        return {
          ...lapData,
          lap_distance: dist, total_distance: dist, car_position: pos, current_lap_num: lapNum,
          current_lap_time_ms: 0, sector: 0, sector1_time_ms: 0, sector2_time_ms: 0,
          last_lap_time_ms: lastLap?.lap_time_ms ?? 0, current_lap_invalid: false,
          driver_status: dist > 0 ? 1 : 0, result_status: dist > 0 ? 2 : 0,
        };
      });
      allDistances = snap.cars.map(c => c[0]);
      teamIds = field.carTeamIds.length ? field.carTeamIds : teamIds;
      participants = field.participants;
    }
  }
  const isRace = session.sessionType.startsWith('Race');

  // The store projects the viewed car from the per-car arrays when they exist,
  // so the replay must supply its own or the last live grid would leak through.
  return {
    packet_id: 6,
    session_time: (useTelemetryStore.getState().currentFrame?.session_time ?? 0) + 0.033,
    frame_identifier: 0,
    player_car_index: player,
    timestamp: Date.now(),
    telemetry, motion, status, damage, lap: lapAll[player] ?? lapData,
    telemetry_all: lapAll.map(() => telemetry),
    motion_all: lapAll.map(() => motion),
    status_all: lapAll.map(() => status),
    damage_all: lapAll.map(() => damage),
    lap_all: lapAll,
    all_lap_distances: allDistances,
    car_team_ids: teamIds,
    participants,
    session: {
      weather: 0, track_temperature: 0, air_temperature: 0, total_laps: laps.length, track_length: session.trackLength,
      session_type: isRace && field ? RACE_TYPE_ID : PRACTICE_TYPE_ID, track_id: session.trackId ?? -1,
      session_time_left: 0, session_duration: 0, safety_car_status: 0,
    },
  };
}

export const useReplay = create<ReplayState>((set, get) => ({
  session: null,
  laps: [],
  offsets: [0],
  playing: false,
  speed: 1,
  t: 0,

  load: (session, laps, speed) => {
    const offsets = laps.reduce<number[]>((acc, lap) => [...acc, acc[acc.length - 1] + lap.timeMs], [0]);
    clearFrameHistory();
    const tel = useTelemetryStore.getState();
    tel.setReplayMode(true);
    tel.setSelectedCarIndex(null);
    tel.setSessionBest(null);
    tel.setSession({
      session_id: `replay-${session.id}`, track: session.name, track_id: session.trackId,
      session_type: session.sessionType, current_lap: laps[0]?.number ?? 0,
      best_lap_time: laps.length ? Math.min(...laps.map(l => l.timeMs)) : null,
      total_laps: laps.length, weather: 0, track_temp: 0, air_temp: 0, lap_count: laps.length,
      recorded_laps: 0, is_active: true,
    });
    set({ session, laps, offsets, playing: true, speed, t: 0 });
    get().tick(0);
  },

  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  setSpeed: (speed) => set({ speed }),

  seek: (t) => {
    const total = get().offsets[get().offsets.length - 1];
    clearFrameHistory();
    set({ t: Math.max(0, Math.min(total - 1, t)) });
    get().tick(0);
  },

  stop: () => {
    set({ session: null, laps: [], offsets: [0], playing: false, t: 0 });
    clearFrameHistory();
    useTelemetryStore.getState().setReplayMode(false);
  },

  tick: (dtMs) => {
    const { session, laps, offsets, t, speed } = get();
    if (!session || !laps.length) return false;
    const total = offsets[offsets.length - 1];
    const next = t + dtMs * speed;
    if (next >= total) { set({ t: total - 1, playing: false }); return false; }
    let lapIdx = 0;
    while (lapIdx < laps.length - 1 && offsets[lapIdx + 1] <= next) lapIdx++;
    const frame = buildFrame(session, laps, lapIdx, next - offsets[lapIdx]);
    set({ t: next });
    useTelemetryStore.getState().setCurrentFrame(frame);
    return true;
  },
}));
