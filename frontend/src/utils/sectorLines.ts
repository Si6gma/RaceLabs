import type { CarStatus, CarTelemetry, LapData } from '../types/telemetry';

export interface DrsZone {
  /** Activation point: where DRS first becomes allowed, metres from the start line. */
  start: number;
  /** Where cars close it again, or null until someone has driven the whole zone. */
  end: number | null;
}

// Zones further apart than this are different zones.
const ZONE_MERGE_M = 400;

// DRS zones learned from the grid: `drs_allowed` switching on marks the
// activation point, `drs` switching off marks the end of the zone.
export class DrsZoneLearner {
  private trackId: number | undefined;
  private lastAllowed = new Map<number, number>();
  private lastOpen = new Map<number, number>();
  private zoneList: DrsZone[] = [];

  update(laps: LapData[] | undefined, status: CarStatus[] | undefined, telemetry: CarTelemetry[] | undefined, trackId: number | undefined): void {
    if (trackId !== this.trackId) {
      this.trackId = trackId;
      this.lastAllowed.clear();
      this.lastOpen.clear();
      this.zoneList = [];
    }
    if (!laps || !status || !telemetry) return;
    let changed = false;
    laps.forEach((car, idx) => {
      const allowed = status[idx]?.drs_allowed ?? 0;
      const open = telemetry[idx]?.drs ?? 0;
      const prevAllowed = this.lastAllowed.get(idx);
      const prevOpen = this.lastOpen.get(idx);
      this.lastAllowed.set(idx, allowed);
      this.lastOpen.set(idx, open);
      const d = car.lap_distance;
      if (d <= 0) return;
      if (prevAllowed === 0 && allowed === 1) {
        const zone = this.zoneList.find(z => Math.abs(z.start - d) < ZONE_MERGE_M);
        if (zone) { if (d < zone.start) { zone.start = d; changed = true; } }
        else { this.zoneList.push({ start: d, end: null }); changed = true; }
      }
      if (prevOpen === 1 && open === 0) {
        const zone = [...this.zoneList].reverse().find(z => z.start < d && d - z.start < 1500);
        if (zone && (zone.end == null || d > zone.end)) { zone.end = d; changed = true; }
      }
    });
    if (changed) this.zoneList = [...this.zoneList].sort((a, b) => a.start - b.start).map(z => ({ ...z }));
  }

  zones(): DrsZone[] {
    return this.zoneList;
  }

  seed(trackId: number | undefined, zones: DrsZone[]): void {
    if (trackId === undefined || !zones.length) return;
    if (trackId !== this.trackId) {
      this.trackId = trackId;
      this.lastAllowed.clear();
      this.lastOpen.clear();
      this.zoneList = [];
    }
    for (const z of zones) {
      const have = this.zoneList.find(x => Math.abs(x.start - z.start) < ZONE_MERGE_M);
      if (!have) this.zoneList.push({ ...z });
      else {
        have.start = Math.min(have.start, z.start);
        if (z.end != null) have.end = have.end == null ? z.end : Math.max(have.end, z.end);
      }
    }
    this.zoneList = [...this.zoneList].sort((a, b) => a.start - b.start);
  }
}

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

  // Start from what the backend has already learned for this track; a
  // smaller distance seen live still wins.
  seed(trackId: number | undefined, s1: number | null, s2: number | null): void {
    if (trackId === undefined) return;
    if (trackId !== this.trackId) {
      this.trackId = trackId;
      this.lastSector.clear();
      this.bounds = [null, null];
    }
    const pick = (known: number | null, given: number | null) =>
      given == null ? known : known == null ? given : Math.min(known, given);
    const next: [number | null, number | null] = [pick(this.bounds[0], s1), pick(this.bounds[1], s2)];
    if (next[0] !== this.bounds[0] || next[1] !== this.bounds[1]) this.bounds = next;
  }
}
