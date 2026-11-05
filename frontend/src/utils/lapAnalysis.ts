import type { TelemetryPoint } from './telemetryAdapter';

// Lap comparison maths on the fixed distance grid every lap is resampled to.
// All laps are compared by grid index, which is the same normalized position.

const idxAt = (lap: TelemetryPoint[], frac: number) =>
  Math.max(0, Math.min(lap.length - 1, Math.round(frac * (lap.length - 1))));

// ── Delta time ───────────────────────────────────────────────────────────────
// Seconds behind (+) or ahead (−) of the reference at each point of the lap.
export function deltaTrace(ref: TelemetryPoint[], lap: TelemetryPoint[]): number[] {
  const n = lap.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const r = ref[idxAt(ref, i / Math.max(1, n - 1))];
    out[i] = (lap[i].lap_time ?? 0) - (r?.lap_time ?? 0);
  }
  return out;
}

// ── Segments (mini-sectors) ──────────────────────────────────────────────────
// Time spent in each of n equal-distance slices, from lap_time at the slice edges.
export function segmentTimes(lap: TelemetryPoint[], n: number): (number | null)[] {
  if (lap.length < 2) return new Array(n).fill(null);
  const edge = (k: number) => lap[idxAt(lap, k / n)].lap_time;
  return Array.from({ length: n }, (_, k) => {
    const a = edge(k);
    const b = edge(k + 1);
    return a == null || b == null || b <= a ? null : b - a;
  });
}

// ── Corners ──────────────────────────────────────────────────────────────────
export interface Corner {
  /** Grid index of the speed minimum on the reference lap. */
  index: number;
  /** Metres from the start line. */
  distance: number;
}

const SMOOTH = 4;        // samples either side when smoothing speed
const WINDOW = 40;       // samples either side a minimum must dominate (~85 m on a 4.3 km lap)
const MIN_DROP = 10;     // km/h below the surrounding window to count as a corner
const MERGE = 25;        // minima closer than this are the same corner

function smoothSpeed(lap: TelemetryPoint[]): number[] {
  const n = lap.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - SMOOTH); j <= Math.min(n - 1, i + SMOOTH); j++) { sum += lap[j].speed_kmh; count++; }
    out[i] = sum / count;
  }
  return out;
}

export function detectCorners(ref: TelemetryPoint[]): Corner[] {
  const v = smoothSpeed(ref);
  const n = v.length;
  const corners: Corner[] = [];
  for (let i = WINDOW; i < n - WINDOW; i++) {
    let isMin = true, around = -Infinity;
    for (let j = i - WINDOW; j <= i + WINDOW; j++) {
      if (j !== i && v[j] < v[i]) { isMin = false; break; }
      if (v[j] > around) around = v[j];
    }
    if (!isMin || around - v[i] < MIN_DROP) continue;
    const last = corners[corners.length - 1];
    if (last && i - last.index < MERGE) continue;
    corners.push({ index: i, distance: ref[i].cumulative_distance });
  }
  return corners;
}

export interface CornerMetrics {
  minSpeed: number;
  apexDistance: number;
  /** Metres from the start line where braking began, or null if no brake found. */
  brakeOn: number | null;
  /** Metres where the throttle reached 95 % after the apex, or null. */
  fullThrottle: number | null;
}

const BRAKE_ON = 0.1;
const FULL_THROTTLE = 0.95;
const LOOK_BACK = 150;   // samples to search before the apex for the braking point
const LOOK_AHEAD = 200;  // samples to search after the apex for full throttle

export function cornerMetrics(lap: TelemetryPoint[], corner: Corner): CornerMetrics {
  const n = lap.length;
  const centre = Math.min(n - 1, corner.index);
  // The lap's own minimum near the reference apex
  let apex = centre;
  for (let j = Math.max(0, centre - WINDOW); j <= Math.min(n - 1, centre + WINDOW); j++) {
    if (lap[j].speed_kmh < lap[apex].speed_kmh) apex = j;
  }
  // Walk back from the apex through the braking zone to where the brake first came on
  let brakeOn: number | null = null;
  let i = apex;
  while (i > 0 && lap[i].brake < BRAKE_ON && apex - i < LOOK_BACK) i--;
  if (lap[i].brake >= BRAKE_ON) {
    while (i > 0 && lap[i - 1].brake >= BRAKE_ON && apex - i < LOOK_BACK) i--;
    brakeOn = lap[i].cumulative_distance;
  }
  let fullThrottle: number | null = null;
  for (let k = apex; k < Math.min(n, apex + LOOK_AHEAD); k++) {
    if (lap[k].throttle >= FULL_THROTTLE) { fullThrottle = lap[k].cumulative_distance; break; }
  }
  return { minSpeed: lap[apex].speed_kmh, apexDistance: lap[apex].cumulative_distance, brakeOn, fullThrottle };
}

// ── Whole-lap driver stats ───────────────────────────────────────────────────
export interface LapStats {
  fullThrottlePct: number;
  brakingPct: number;
  coastingPct: number;
}

export function lapStats(lap: TelemetryPoint[]): LapStats {
  if (!lap.length) return { fullThrottlePct: 0, brakingPct: 0, coastingPct: 0 };
  let full = 0, braking = 0, coasting = 0;
  for (const p of lap) {
    if (p.throttle >= FULL_THROTTLE) full++;
    if (p.brake >= BRAKE_ON) braking++;
    if (p.throttle < 0.05 && p.brake < 0.05) coasting++;
  }
  const n = lap.length;
  return { fullThrottlePct: (full / n) * 100, brakingPct: (braking / n) * 100, coastingPct: (coasting / n) * 100 };
}
