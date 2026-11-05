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


# Activation points closer than this belong to the same DRS zone.
DRS_ZONE_MATCH_M = 400.0
# A DRS deactivation further than this past a zone's start is not that zone's end.
DRS_ZONE_MAX_LENGTH_M = 1500.0

Zone = Dict[str, Optional[float]]


def _with_activation(zones: List[Zone], distance: float) -> List[Zone]:
    """Zones after a DRS activation at `distance`: lowers a matching start or adds a zone."""
    for i, zone in enumerate(zones):
        if abs(zone["start"] - distance) < DRS_ZONE_MATCH_M:
            if distance >= zone["start"]:
                return zones
            return _sorted(zones[:i] + [{**zone, "start": distance}] + zones[i + 1:])
    return _sorted(zones + [{"start": distance, "end": None}])


def _with_deactivation(zones: List[Zone], distance: float) -> List[Zone]:
    """Zones after DRS closed at `distance`: the nearest zone starting before it grows to reach it."""
    candidates = [i for i, z in enumerate(zones) if z["start"] < distance < z["start"] + DRS_ZONE_MAX_LENGTH_M]
    if not candidates:
        return zones
    i = max(candidates, key=lambda idx: zones[idx]["start"])
    end = zones[i]["end"]
    if end is not None and end >= distance:
        return zones
    return zones[:i] + [{**zones[i], "end": distance}] + zones[i + 1:]


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
    """Learns DRS zones from where cars gain DRS permission (zone start) and where DRS closes (zone end)."""

    def __init__(self):
        self._track_id: Optional[int] = None
        self._zones: List[Zone] = []
        self._prev_allowed: Dict[int, int] = {}
        self._prev_drs: Dict[int, int] = {}
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
        """Feed the latest per-car arrays. Returns True when a zone was added or changed."""
        if track_id != self._track_id:
            self._reset(track_id)
        zones = self._zones
        for idx, (lap, status, tel) in enumerate(zip(lap_all, status_all, telemetry_all)):
            distance = lap.get("lap_distance", 0.0)
            allowed = int(status.get("drs_allowed", 0))
            drs = int(tel.get("drs", 0))
            prev_allowed = self._prev_allowed.get(idx)
            prev_drs = self._prev_drs.get(idx)
            self._prev_allowed[idx] = allowed
            self._prev_drs[idx] = drs
            if distance <= 0:
                continue
            if prev_allowed == 0 and allowed == 1:
                zones = _with_activation(zones, distance)
            if prev_drs == 1 and drs == 0:
                zones = _with_deactivation(zones, distance)
        changed = zones != self._zones
        self._zones = zones
        return changed

    def _reset(self, track_id: int):
        self._track_id = track_id
        self._prev_allowed = {}
        self._prev_drs = {}
        self._zones = [dict(z) for z in self._seeds.get(track_id, [])]
