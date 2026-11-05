"""
Sector boundary learner: watches every car's sector number and remembers the
lap_distance at which it first changed. Cars report a little past the line, so
the smallest distance seen across cars and laps is the best estimate.
"""
from typing import Dict, List, Optional, Tuple

Bounds = Tuple[Optional[float], Optional[float]]


class SectorBoundaryLearner:
    def __init__(self):
        self._track_id: Optional[int] = None
        self._bounds: List[Optional[float]] = [None, None]
        self._prev_sector: Dict[int, int] = {}
        # Stored bounds per track, applied when the learner moves onto that track.
        self._seeds: Dict[int, Bounds] = {}

    def seed(self, track_id: int, s1: Optional[float], s2: Optional[float]):
        """Remember stored bounds for a track; they apply whenever that track is current."""
        self._seeds[track_id] = (s1, s2)
        if track_id == self._track_id:
            self._bounds = [_min(self._bounds[0], s1), _min(self._bounds[1], s2)]

    def bounds(self, track_id: Optional[int] = None) -> Bounds:
        """Current bounds, or the known bounds for `track_id` when it is not the current track."""
        if track_id is None or track_id == self._track_id:
            return (self._bounds[0], self._bounds[1])
        return self._seeds.get(track_id, (None, None))

    def update(self, lap_all: List[dict], track_id: int) -> bool:
        """Feed one LAP_DATA packet. Returns True when a bound was set or lowered."""
        if track_id != self._track_id:
            self._reset(track_id)
        changed = False
        for idx, car in enumerate(lap_all):
            sector = car.get("sector", 0)
            prev = self._prev_sector.get(idx)
            self._prev_sector[idx] = sector
            if prev is None or sector != prev + 1 or sector not in (1, 2):
                continue
            distance = car.get("lap_distance", 0.0)
            if distance <= 0:
                continue
            slot = sector - 1
            if self._bounds[slot] is None or distance < self._bounds[slot]:
                self._bounds[slot] = distance
                changed = True
        return changed

    def _reset(self, track_id: int):
        self._track_id = track_id
        self._prev_sector = {}
        seed = self._seeds.get(track_id, (None, None))
        self._bounds = [seed[0], seed[1]]


def _min(a: Optional[float], b: Optional[float]) -> Optional[float]:
    if a is None:
        return b
    if b is None:
        return a
    return min(a, b)


# Zone starts closer than this belong to the same DRS zone.
DRS_ZONE_MATCH_M = 400.0
# A DRS span longer than this is not one zone (a wrong wing state, a stale start).
DRS_ZONE_MAX_LENGTH_M = 1500.0

Zone = Dict[str, Optional[float]]


def drs_span(start: float, closed_at: float) -> Optional[Zone]:
    """The zone one open-to-close of the wing describes, or None when it cannot be one zone.
    Closing at or before the start means the car wrapped past the line: the end is unknown."""
    if closed_at <= start:
        return {"start": start, "end": None}
    if closed_at - start > DRS_ZONE_MAX_LENGTH_M:
        return None
    return {"start": start, "end": closed_at}


def merge_drs_zones(stored: List[Zone], new: List[Zone]) -> List[Zone]:
    """Zones matched by start within DRS_ZONE_MATCH_M keep the smaller start and the larger end;
    unmatched new zones are added."""
    merged = [dict(z) for z in stored]
    for zone in new:
        match = next((m for m in merged if abs(m["start"] - zone["start"]) < DRS_ZONE_MATCH_M), None)
        if match is None:
            merged.append(dict(zone))
            continue
        match["start"] = min(match["start"], zone["start"])
        match["end"] = _max(match["end"], zone["end"])
    return _sorted(merged)


def _sorted(zones: List[Zone]) -> List[Zone]:
    return sorted(zones, key=lambda z: z["start"])


def _max(a: Optional[float], b: Optional[float]) -> Optional[float]:
    if a is None:
        return b
    if b is None:
        return a
    return max(a, b)


class DrsZoneLearner:
    """Learns DRS zones from the wing itself: where a car opens DRS is a zone start, where it
    closes again is that zone's end."""

    def __init__(self):
        self._track_id: Optional[int] = None
        self._zones: List[Zone] = []
        self._prev_drs: Dict[int, int] = {}
        # lap_distance at which each car last opened DRS.
        self._opened_at: Dict[int, float] = {}
        self._seeds: Dict[int, List[Zone]] = {}

    def seed(self, track_id: int, zones: List[Zone]):
        self._seeds[track_id] = [dict(z) for z in zones]
        if track_id == self._track_id:
            self._zones = merge_drs_zones(self._zones, zones)

    def zones(self, track_id: Optional[int] = None) -> List[Zone]:
        if track_id is None or track_id == self._track_id:
            return [dict(z) for z in self._zones]
        return [dict(z) for z in self._seeds.get(track_id, [])]

    def update(self, lap_all: List[dict], status_all: List[dict], telemetry_all: List[dict], track_id: int) -> bool:
        """Feed the latest per-car arrays (status_all is unused). Returns True when a zone was added or grew."""
        if track_id != self._track_id:
            self._reset(track_id)
        spans: List[Zone] = []
        for idx, (lap, tel) in enumerate(zip(lap_all, telemetry_all)):
            distance = float(lap.get("lap_distance", 0.0))
            drs = int(tel.get("drs", 0))
            prev = self._prev_drs.get(idx)
            self._prev_drs[idx] = drs
            if prev == 0 and drs == 1 and distance > 0:
                self._opened_at[idx] = distance
            elif prev == 1 and drs == 0 and idx in self._opened_at:
                span = drs_span(self._opened_at.pop(idx), distance)
                if span is not None:
                    spans.append(span)
        if not spans:
            return False
        zones = merge_drs_zones(self._zones, spans)
        changed = zones != self._zones
        self._zones = zones
        return changed

    def _reset(self, track_id: int):
        self._track_id = track_id
        self._prev_drs = {}
        self._opened_at = {}
        self._zones = [dict(z) for z in self._seeds.get(track_id, [])]
