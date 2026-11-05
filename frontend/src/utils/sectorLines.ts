import type { LapData } from '../types/telemetry';

// Where the sector lines are, in metres from the start line. The game never
// sends this, but every car reveals it the instant its sector counter ticks
// over, so after one lap of traffic the boundaries are known to a few metres.
// The smallest distance seen wins, since each car reports a little past the line.
export class SectorBoundaryLearner {
  private trackId: number | undefined;
  private lastSector = new Map<number, number>();
  private bounds: [number | null, number | null] = [null, null];

  update(laps: LapData[] | undefined, trackId: number | undefined): void {
    if (trackId !== this.trackId) {
      this.trackId = trackId;
      this.lastSector.clear();
      this.bounds = [null, null];
    }
    if (!laps) return;
    laps.forEach((car, idx) => {
      const prev = this.lastSector.get(idx);
      this.lastSector.set(idx, car.sector);
      if (prev === undefined || car.sector === prev || car.lap_distance <= 0) return;
      const crossed: 0 | 1 | null = prev === 0 && car.sector === 1 ? 0 : prev === 1 && car.sector === 2 ? 1 : null;
      if (crossed === null) return;
      const known = this.bounds[crossed];
      if (known == null || car.lap_distance < known) {
        this.bounds = crossed === 0 ? [car.lap_distance, this.bounds[1]] : [this.bounds[0], car.lap_distance];
      }
    });
  }

  distances(): [number | null, number | null] {
    return this.bounds;
  }
}
