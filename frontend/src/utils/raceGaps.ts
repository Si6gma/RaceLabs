import type { LapData } from '../types/telemetry';

export const RACE_SESSION_TYPES = new Set([10, 11, 12]);

export interface Gap {
  carIndex: number;
  gapMs: number;
  // Gap change since this point on track one lap ago: how race engineers
  // quote "gaining two tenths a lap". Null until there is a lap of history.
  trendMs: number | null;
  // How fast the gap is changing right now, over the last few hundred metres,
  // scaled to the same per-lap unit as trendMs. Noisier, but immediate.
  nowMs: number | null;
}

export interface RaceGaps {
  ahead: Gap | null;
  behind: Gap | null;
}

const SAMPLE_EVERY_M = 10;
const MATCH_WITHIN_M = 25;
const NOW_WINDOW_M = 300;

// Gap samples for one rival, keyed by the viewed car's total distance.
class GapHistory {
  private carIndex = -1;
  private samples: Array<[number, number]> = [];   // [total distance m, gap ms]

  track(carIndex: number, distance: number, gapMs: number, trackLength: number): { trendMs: number | null; nowMs: number | null } {
    const last = this.samples[this.samples.length - 1];
    // A new rival, or distance going backwards (flashback, new session), starts over.
    if (carIndex !== this.carIndex || (last && distance < last[0])) {
      this.carIndex = carIndex;
      this.samples = [];
    }
    if (!this.samples.length || distance - this.samples[this.samples.length - 1][0] >= SAMPLE_EVERY_M) {
      this.samples.push([distance, gapMs]);
    }
    while (this.samples.length && this.samples[0][0] < distance - trackLength - MATCH_WITHIN_M) {
      this.samples.shift();
    }

    if (!trackLength) return { trendMs: null, nowMs: null };
    const first = this.samples[0];
    const trendMs = Math.abs(first[0] - (distance - trackLength)) <= MATCH_WITHIN_M ? gapMs - first[1] : null;

    let nowMs: number | null = null;
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const [d, g] = this.samples[i];
      if (distance - d >= NOW_WINDOW_M) {
        if (distance - d <= NOW_WINDOW_M + MATCH_WITHIN_M) nowMs = ((gapMs - g) / (distance - d)) * trackLength;
        break;
      }
    }
    return { trendMs, nowMs };
  }
}

export class GapTracker {
  private ahead = new GapHistory();
  private behind = new GapHistory();

  update(laps: LapData[], viewedIdx: number, trackLength: number): RaceGaps {
    const me = laps[viewedIdx];
    if (!me?.car_position) return { ahead: null, behind: null };
    const distance = me.total_distance;

    let ahead: Gap | null = null;
    const aheadIdx = laps.findIndex(l => l.car_position === me.car_position - 1);
    if (aheadIdx >= 0 && me.delta_to_car_in_front_ms > 0) {
      const gapMs = me.delta_to_car_in_front_ms;
      ahead = { carIndex: aheadIdx, gapMs, ...this.ahead.track(aheadIdx, distance, gapMs, trackLength) };
    }

    let behind: Gap | null = null;
    const behindIdx = laps.findIndex(l => l.car_position === me.car_position + 1);
    if (behindIdx >= 0 && laps[behindIdx].delta_to_car_in_front_ms > 0) {
      const gapMs = laps[behindIdx].delta_to_car_in_front_ms;
      behind = { carIndex: behindIdx, gapMs, ...this.behind.track(behindIdx, distance, gapMs, trackLength) };
    }

    return { ahead, behind };
  }
}
