import type { LapData } from '../types/telemetry';

export const RACE_SESSION_TYPES = new Set([10, 11, 12]);

export interface Gap {
  carIndex: number;
  gapMs: number;
  // Gap change since this point on track one lap ago: how race engineers
  // quote "gaining two tenths a lap". Null until there is a lap of history.
  trendMs: number | null;
}

export interface RaceGaps {
  ahead: Gap | null;
  behind: Gap | null;
}

const SAMPLE_EVERY_M = 10;
const MATCH_WITHIN_M = 25;

// Gap samples for one rival, keyed by the viewed car's total distance.
class GapHistory {
  private carIndex = -1;
  private samples: Array<[number, number]> = [];   // [total distance m, gap ms]

  track(carIndex: number, distance: number, gapMs: number, trackLength: number): number | null {
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

    const target = distance - trackLength;
    const first = this.samples[0];
    if (!trackLength || !first || Math.abs(first[0] - target) > MATCH_WITHIN_M) return null;
    return gapMs - first[1];
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
      ahead = { carIndex: aheadIdx, gapMs, trendMs: this.ahead.track(aheadIdx, distance, gapMs, trackLength) };
    }

    let behind: Gap | null = null;
    const behindIdx = laps.findIndex(l => l.car_position === me.car_position + 1);
    if (behindIdx >= 0 && laps[behindIdx].delta_to_car_in_front_ms > 0) {
      const gapMs = laps[behindIdx].delta_to_car_in_front_ms;
      behind = { carIndex: behindIdx, gapMs, trendMs: this.behind.track(behindIdx, distance, gapMs, trackLength) };
    }

    return { ahead, behind };
  }
}
