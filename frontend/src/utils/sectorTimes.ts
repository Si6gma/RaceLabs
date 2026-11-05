import type { LapData } from '../types/telemetry';

// F1 timing colours: purple = fastest of anyone this session, green = the
// driver's own best, yellow = slower. 'none' for out/in laps and invalid laps.
export type SectorColour = 'purple' | 'green' | 'yellow' | 'none';

export interface SectorTime {
  ms: number;
  colour: SectorColour;
}

// DriverStatus: only flying laps and racing laps count towards bests.
const TIMED_DRIVER_STATUS = new Set([1, 4]);

interface CarState {
  sector: number;
  s1: number;
  s2: number;
  invalid: boolean;
  status: number;
}

const sectorMs = (minutes: number | undefined, ms: number | undefined) => (minutes ?? 0) * 60000 + (ms ?? 0);

// Watches every car cross the sector lines, keeping session and personal bests
// so each car's latest sector times can be coloured as F1 timing does.
export class SectorTracker {
  private cars = new Map<number, CarState>();
  private sessionBest: Array<number | null> = [null, null, null];
  private carBest = new Map<number, Array<number | null>>();
  private latest = new Map<number, Array<SectorTime | null>>();
  private bestLap = new Map<number, number>();
  // Every completed lap's time per car, by lap number, so two cars can be
  // compared on the same lap once both have finished it.
  private lapTimes = new Map<number, Map<number, number>>();

  update(laps: LapData[]) {
    laps.forEach((car, idx) => {
      const now: CarState = {
        sector: car.sector,
        s1: sectorMs(car.sector1_time_minutes, car.sector1_time_ms),
        s2: sectorMs(car.sector2_time_minutes, car.sector2_time_ms),
        invalid: car.current_lap_invalid,
        status: car.driver_status,
      };
      const prev = this.cars.get(idx);
      this.cars.set(idx, now);
      if (!prev || prev.sector === now.sector) return;

      let done: number;
      let ms: number;
      if (prev.sector === 0 && now.sector === 1) { done = 0; ms = now.s1; }
      else if (prev.sector === 1 && now.sector === 2) { done = 1; ms = now.s2; }
      // s1/s2 reset with the new lap, so sector 3 comes from the previous frame.
      else if (prev.sector === 2 && now.sector === 0) {
        done = 2; ms = car.last_lap_time_ms - prev.s1 - prev.s2;
        if (car.last_lap_time_ms > 0) {
          const times = this.lapTimes.get(idx) ?? new Map<number, number>();
          times.set(car.current_lap_num - 1, car.last_lap_time_ms);
          this.lapTimes.set(idx, times);
        }
      }
      else return;
      if (ms <= 0) return;

      let colour: SectorColour = 'none';
      if (!prev.invalid && TIMED_DRIVER_STATUS.has(prev.status)) {
        const bests = this.carBest.get(idx) ?? [null, null, null];
        const best = this.sessionBest[done];
        const mine = bests[done];
        colour = best == null || ms < best ? 'purple' : mine == null || ms < mine ? 'green' : 'yellow';
        if (best == null || ms < best) this.sessionBest[done] = ms;
        if (mine == null || ms < mine) bests[done] = ms;
        this.carBest.set(idx, bests);
        // A clean lap just finished: keep the car's fastest for the session.
        if (done === 2) {
          const lapMs = car.last_lap_time_ms;
          const bestLap = this.bestLap.get(idx);
          if (lapMs > 0 && (bestLap == null || lapMs < bestLap)) this.bestLap.set(idx, lapMs);
        }
      }
      const latest = this.latest.get(idx) ?? [null, null, null];
      latest[done] = { ms, colour };
      this.latest.set(idx, latest);
    });
  }

  latestFor(carIdx: number): Array<SectorTime | null> {
    return this.latest.get(carIdx) ?? [null, null, null];
  }

  bestLapFor(carIdx: number): number | null {
    return this.bestLap.get(carIdx) ?? null;
  }

  // The other car's time minus ours on our most recent completed lap, or null
  // until both have finished that lap. Positive means they were slower.
  paceDeltaFor(carIdx: number, otherIdx: number): { lap: number; ms: number } | null {
    const mine = this.lapTimes.get(carIdx);
    const theirs = this.lapTimes.get(otherIdx);
    if (!mine || !theirs) return null;
    const lap = Math.max(...mine.keys());
    const a = mine.get(lap);
    const b = theirs.get(lap);
    return a != null && b != null ? { lap, ms: b - a } : null;
  }
}
