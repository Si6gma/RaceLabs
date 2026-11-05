import type { CarStatus, CarTelemetry, LapData } from '../types/telemetry';

export interface DrsZone {
  /** Activation point: where DRS first becomes allowed, metres from the start line. */
  start: number;
  /** Where cars close it again, or null until someone has driven the whole zone. */
  end: number | null;
}

// Zones further apart than this are different zones.
const ZONE_MERGE_M = 400;
// A span shorter than this is a flap flicker, not a zone; longer than the max is not one zone.
const ZONE_MIN_M = 50;
const ZONE_MAX_M = 1500;

// DRS zones learned from the grid: each car's stretch with the flap open is a
// span, spans that start near each other are one zone. Where cars open it is
// the activation line (smallest start wins), where they close it is the end.
// `drs_allowed` is not used: in a race it flickers with the one-second gap.
export class DrsZoneLearner {
  private trackId: number | undefined;
  private lastOpen = new Map<number, number>();
  private openedAt = new Map<number, number>();
  private zoneList: DrsZone[] = [];

  update(laps: LapData[] | undefined, _status: CarStatus[] | undefined, telemetry: CarTelemetry[] | undefined, trackId: number | undefined): void {
    if (trackId !== this.trackId) {
      this.trackId = trackId;
      this.lastOpen.clear();
      this.openedAt.clear();
      this.zoneList = [];
    }
    if (!laps || !telemetry) return;
    let changed = false;
    laps.forEach((car, idx) => {
      const open = telemetry[idx]?.drs ?? 0;
      const prevOpen = this.lastOpen.get(idx);
      this.lastOpen.set(idx, open);
      const d = car.lap_distance;
      if (d <= 0) return;
      if (prevOpen === 0 && open === 1) this.openedAt.set(idx, d);
      if (prevOpen === 1 && open === 0) {
        const start = this.openedAt.get(idx);
        this.openedAt.delete(idx);
        if (start == null) return;
        // A span that wraps past the start line is a zone starting near the end
        // of the lap; keep its start and let the end stay unknown.
        const end = d > start ? d : null;
        if (end != null && (end - start < ZONE_MIN_M || end - start > ZONE_MAX_M)) return;
        changed = this.absorb({ start, end }) || changed;
      }
    });
    if (changed) this.zoneList = [...this.zoneList].sort((a, b) => a.start - b.start).map(z => ({ ...z }));
  }

  // Same zone: starts close together, or the span opens inside a known zone.
  private absorb(span: DrsZone): boolean {
    const zone = this.zoneList.find(z =>
      Math.abs(z.start - span.start) < ZONE_MERGE_M || (z.end != null && z.start <= span.start && span.start <= z.end));
    if (!zone) { this.zoneList.push({ ...span }); return true; }
    let changed = false;
    if (span.start < zone.start) { zone.start = span.start; changed = true; }
    if (span.end != null && (zone.end == null || span.end > zone.end)) { zone.end = span.end; changed = true; }
    return changed;
  }

  zones(): DrsZone[] {
    return this.zoneList;
  }

  seed(trackId: number | undefined, zones: DrsZone[]): void {
    if (trackId === undefined || !zones.length) return;
    if (trackId !== this.trackId) {
      this.trackId = trackId;
      this.lastOpen.clear();
      this.openedAt.clear();
      this.zoneList = [];
    }
    for (const z of zones) this.absorb(z);
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
