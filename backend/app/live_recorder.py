"""
Live lap recorder.

Collects the player's LAP_DATA-rate samples for the lap being driven and, once
the game moves on to the next lap, writes the finished lap into the same tables
the CSV importer uses (ImportedSession / ImportedLap / TelemetrySample) with
source = "live". Partial laps are never saved: the lap time comes from the
next lap's first sample, so a lap that is cut short by a restart, a session
change or the recorder stopping has nothing to be saved with.

Alongside the player's laps it keeps, per LAP_DATA packet, where the whole field
is (SessionField, at most 10 Hz, saved with the player lap it was driven during)
and every car's completed laps (GridLap, flushed with each player lap save and
when recording or the session ends).

In time trial the other slots are ghosts replaying one lap each (your best, the
rival). The pipeline hands their samples over too, and every distinct ghost lap
(slot and lap time) is saved once as a lap of the session marked `ghost`, so the
rival's telemetry can be laid over the player's. Partial ghost laps are never
saved: the ghost loops, the full lap comes round again.
"""
import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set, Tuple

from sqlalchemy import insert, select

from app.models import GridLap, ImportedLap, ImportedSession, SessionField, TelemetrySample
from app.resampler import resample_lap

logger = logging.getLogger(__name__)

# ResultStatus values that mean the car is not actually in the session.
_SKIPPED_RESULT_STATUS = (0, 1)  # INVALID, INACTIVE
# Event codes that bound a session.
SESSION_EVENTS = ("SSTA", "SEND")
MIN_SAMPLES_PER_LAP = 20
# A lap whose first sample is further than this into the lap started before recording did.
PARTIAL_START_MIN_M = 50.0
PARTIAL_START_FRACTION = 0.02
SAMPLE_FLUSH_THRESHOLD = 2000
# A flashback rewinds lap_distance within the same lap. Smaller drops are jitter.
FLASHBACK_REWIND_M = 20.0
# Field positions are kept at most this often (session_time seconds).
FIELD_FRAME_INTERVAL_S = 0.1
GRID_SIZE = 22
TIME_TRIAL_TYPE_ID = 13
# The session extra_data keys describing who is in the session.
ROSTER_KEYS = ("participants", "car_team_ids", "player_car_index")
PARTICIPANT_KEYS = ("index", "name", "team_id", "race_number")


@dataclass(frozen=True)
class GridLapResult:
    car_index: int
    lap_number: int
    lap_time_ms: int
    sector1_ms: Optional[int]
    sector2_ms: Optional[int]
    sector3_ms: Optional[int]
    valid: bool


@dataclass(frozen=True)
class FinalizedLap:
    lap_number: int
    lap_time_ms: int
    sector1_ms: Optional[int]
    sector2_ms: Optional[int]
    sector3_ms: Optional[int]
    valid: bool
    partial_start: bool
    pit_lap: bool
    flashbacks: int
    samples: List[Dict[str, Any]]
    meta: Dict[str, Any]
    # time.time() minus session_time of the last sample: maps session_time onto the wall clock.
    wall_offset: float
    # session_time of the lap's first sample: aligns lap time with the field frames.
    session_time_start: float = 0.0
    field_frames: List[Dict[str, Any]] = field(default_factory=list)
    grid_laps: List[GridLapResult] = field(default_factory=list)
    # {"car_index", "lap_time_ms"} when this is a time-trial ghost's lap, not the player's.
    ghost: Optional[Dict[str, Any]] = None


@dataclass
class _LapInProgress:
    lap_number: int
    meta: Dict[str, Any]
    # last_lap_time_ms as it stood when this lap began. On the final lap of a race
    # the lap counter never advances, so a change here is the only completion signal.
    start_last_lap_ms: int = 0
    samples: List[Dict[str, Any]] = field(default_factory=list)
    flashbacks: int = 0
    field_frames: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class _CarLap:
    """One grid car's lap in progress, from its lap_all entries."""
    lap_number: int
    last: Dict[str, Any]
    invalid: bool = False


def sector_ms(lap: Dict[str, Any], number: int) -> int:
    return int(lap.get(f"sector{number}_time_minutes") or 0) * 60000 + int(lap.get(f"sector{number}_time_ms") or 0)


def split_sectors(lap_time_ms: int, s1: int, s2: int) -> tuple:
    """(sector1, sector2, sector3) as stored: None where unknown, sector3 derived from the lap time."""
    s3 = lap_time_ms - s1 - s2 if s1 > 0 and s2 > 0 else None
    return s1 or None, s2 or None, s3 if s3 and s3 > 0 else None


def complete_grid_lap(car_index: int, finished: _CarLap, lap_time_ms: int) -> Optional[GridLapResult]:
    """The GridLapResult for a car whose lap counter just moved on, or None without a lap time."""
    if lap_time_ms <= 0:
        return None
    s1, s2, s3 = split_sectors(lap_time_ms, sector_ms(finished.last, 1), sector_ms(finished.last, 2))
    return GridLapResult(
        car_index=car_index,
        lap_number=finished.lap_number,
        lap_time_ms=lap_time_ms,
        sector1_ms=s1,
        sector2_ms=s2,
        sector3_ms=s3,
        valid=not finished.invalid,
    )


def field_frame(lap_all: List[Dict[str, Any]], session_time: float, keep: Optional[Set[int]] = None) -> Dict[str, Any]:
    """One snapshot of the field; cars not in the session are zeroed, missing slots too.
    Slots in `keep` (moving ghosts, which the game marks inactive) are kept regardless."""
    cars = []
    for index in range(GRID_SIZE):
        lap = lap_all[index] if index < len(lap_all) else None
        if lap is None or (lap.get("result_status") in _SKIPPED_RESULT_STATUS and index not in (keep or ())):
            cars.append([0, 0, 0])
        else:
            cars.append([float(lap.get("lap_distance") or 0), int(lap.get("car_position") or 0),
                         int(lap.get("current_lap_num") or 0)])
    return {"t": session_time, "cars": cars}


def roster_from_meta(meta: Dict[str, Any]) -> Dict[str, Any]:
    """The participants, team ids and player car index as stored on the session."""
    return {
        "participants": [
            {key: p.get(key) for key in PARTICIPANT_KEYS} for p in (meta.get("participants") or [])
        ],
        "car_team_ids": list(meta.get("car_team_ids") or []),
        "player_car_index": meta.get("player_car_index"),
    }


def is_flashback(previous: Dict[str, Any], sample: Dict[str, Any]) -> bool:
    """True when `sample` sits more than FLASHBACK_REWIND_M behind `previous` on the same lap."""
    if previous.get("lap_num") != sample.get("lap_num"):
        return False
    drop = float(previous.get("lap_distance") or 0) - float(sample.get("lap_distance") or 0)
    return drop > FLASHBACK_REWIND_M


def rewind_samples(samples: List[Dict[str, Any]], lap_distance: float) -> List[Dict[str, Any]]:
    """The samples the game kept after flashing back to `lap_distance`."""
    return [s for s in samples if float(s.get("lap_distance") or 0) < lap_distance]


def finalize_lap(
    lap: _LapInProgress, lap_time_ms: int, wall_offset: float
) -> "FinalizedLap | str":
    """Turn the collected samples into a FinalizedLap, or a string saying why the lap is dropped."""
    samples = lap.samples
    if lap_time_ms <= 0:
        return f"lap {lap.lap_number}: no lap time reported"
    if len(samples) < MIN_SAMPLES_PER_LAP:
        return f"lap {lap.lap_number}: only {len(samples)} samples"

    last = samples[-1]
    s1, s2, s3 = split_sectors(lap_time_ms, int(last.get("sector1_ms") or 0), int(last.get("sector2_ms") or 0))

    track_length = float(lap.meta.get("track_length") or 0)
    partial_threshold = max(PARTIAL_START_MIN_M, PARTIAL_START_FRACTION * track_length)

    return FinalizedLap(
        lap_number=lap.lap_number,
        lap_time_ms=lap_time_ms,
        sector1_ms=s1,
        sector2_ms=s2,
        sector3_ms=s3,
        valid=not any(s.get("current_lap_invalid") for s in samples),
        partial_start=float(samples[0].get("lap_distance") or 0) > partial_threshold,
        pit_lap=any((s.get("pit_status") or 0) > 0 for s in samples),
        flashbacks=lap.flashbacks,
        samples=list(samples),
        meta=dict(lap.meta),
        wall_offset=wall_offset,
        session_time_start=float(samples[0].get("session_time") or 0),
        field_frames=list(lap.field_frames),
    )


# A ghost clock step longer than this is not one packet interval (a pause, a restart).
GHOST_STEP_MAX_S = 0.25


def ghost_sample(sample: Dict[str, Any], previous: Optional[Dict[str, Any]], rewound: bool) -> Dict[str, Any]:
    """The ghost's sample with its own lap clock. The game mirrors the player's
    current_lap_time_ms onto ghosts, so the clock is built from session_time one
    packet at a time; it does not advance across a rewind, and never by more than
    one packet's worth, so time spent paused or restarting is not lap time."""
    if previous is None:
        return {**sample, "current_lap_time_ms": 0}
    step = 0.0 if rewound else float(sample.get("session_time") or 0) - float(previous.get("session_time") or 0)
    step = min(max(step, 0.0), GHOST_STEP_MAX_S)
    return {**sample, "current_lap_time_ms": int(previous.get("current_lap_time_ms") or 0) + int(round(step * 1000))}


def ghost_sectors(samples: List[Dict[str, Any]], lap_time_ms: int) -> tuple:
    """(sector1, sector2, sector3) read off the ghost's own clock where its sector counter
    ticks over; the game's sector time fields mean nothing for ghost slots."""
    first: Dict[int, int] = {}
    for s in samples:
        sector = int(s.get("sector") or 0)
        if sector in (1, 2) and sector not in first:
            first[sector] = int(s.get("current_lap_time_ms") or 0)
    s1 = first.get(1)
    s2 = first[2] - s1 if s1 and 2 in first else None
    s3 = lap_time_ms - first[2] if 2 in first else None
    return s1 or None, s2 if s2 and s2 > 0 else None, s3 if s3 and s3 > 0 else None


def _sample_dicts(lap: FinalizedLap) -> List[Dict[str, Any]]:
    """The same keys the CSV import service hands to resample_lap."""
    track_length = float(lap.meta.get("track_length") or 0)
    out = []
    for s in lap.samples:
        distance = float(s.get("lap_distance") or 0)
        pos = min(max(distance / track_length, 0.0), 1.0) if track_length > 0 else 0.0
        out.append({
            "normalized_track_position": pos,
            "cumulative_distance": distance,
            "speed_kmh": float(s.get("speed") or 0),
            "throttle": float(s.get("throttle") or 0),
            "brake": float(s.get("brake") or 0),
            "steering": float(s.get("steer") or 0),
            "gear": int(s.get("gear") or 0),
            "rpm": int(s.get("rpm") or 0),
            "gforce_lat": float(s.get("g_force_lat") or 0),
            # F1 UDP motion: X lateral, Y altitude, Z longitudinal. The track map and
            # CSV/MoTeC imports use X,Y as the ground plane, so Y and Z are swapped.
            "world_position_x": float(s.get("world_pos_x") or 0),
            "world_position_y": float(s.get("world_pos_z") or 0),
            "world_position_z": float(s.get("world_pos_y") or 0),
            "lap_time": float(s.get("current_lap_time_ms") or 0) / 1000.0,
        })
    return out


class LiveRecorder:
    def __init__(
        self,
        session_factory,
        persist: Optional[Callable[[FinalizedLap], Awaitable[None]]] = None,
        persist_grid: Optional[Callable[[Dict[str, Any], List[GridLapResult]], Awaitable[None]]] = None,
    ):
        self._session_factory = session_factory
        self._persist = persist or self._persist_lap
        self._persist_grid = persist_grid or self._persist_grid_laps
        self._db_lock = asyncio.Lock()
        self._tasks: Set[asyncio.Task] = set()
        # session_uid -> ImportedSession.id
        self._session_ids: Dict[str, uuid.UUID] = {}
        self._recording = False
        self._reset_session_state()

    def _reset_session_state(self):
        self._session_uid: Optional[str] = None
        self._current: Optional[_LapInProgress] = None
        self._recorded_laps = 0
        self._discarded = 0
        self._flashbacks = 0
        self._last_discard_reason: Optional[str] = None
        # The meta of the last player sample: names the session pending grid laps belong to.
        self._last_meta: Optional[Dict[str, Any]] = None
        self._last_field_t: Optional[float] = None
        self._grid: Dict[int, _CarLap] = {}
        self._pending_grid: List[GridLapResult] = []
        self._grid_laps = 0
        self._ghosts: Dict[int, _LapInProgress] = {}
        self._ghost_saved: Set[Tuple[int, int]] = set()
        self._ghost_laps = 0

    # ----- control -----

    def start(self):
        self._reset_session_state()
        self._recording = True

    def stop(self):
        if self._current is not None:
            self._discard("recording stopped")
        self._flush_grid()
        self._recording = False

    def status(self) -> Dict[str, Any]:
        session_id = self._session_ids.get(self._session_uid) if self._session_uid else None
        return {
            "recording": self._recording,
            "session_id": str(session_id) if session_id else None,
            "session_uid": self._session_uid,
            "recorded_laps": self._recorded_laps,
            "discarded": self._discarded,
            "flashbacks": self._flashbacks,
            "grid_laps": self._grid_laps,
            "ghost_laps": self._ghost_laps,
            "last_discard_reason": self._last_discard_reason,
        }

    async def drain(self):
        """Wait for every scheduled persist to finish (tests and shutdown)."""
        if self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    # ----- feed -----

    def on_event(self, code: str):
        if not self._recording or code not in SESSION_EVENTS:
            return
        if self._current is not None:
            self._discard(f"session event {code}")
        self._flush_grid()
        self._reset_grid()
        self._reset_ghosts()
        self._session_uid = None

    def on_sample(self, sample: Dict[str, Any], meta: Dict[str, Any]):
        if not self._recording:
            return
        lap_num = int(sample.get("lap_num") or 0)
        if sample.get("result_status") in _SKIPPED_RESULT_STATUS or lap_num <= 0:
            return

        uid = str(meta.get("session_uid") or "")
        if self._session_uid is not None and uid != self._session_uid:
            if self._current is not None:
                self._discard("session_uid changed")
            self._flush_grid()
            self._reset_grid()
            self._reset_ghosts()
            self._recorded_laps = 0
            self._flashbacks = 0
            self._grid_laps = 0
            self._ghost_laps = 0
        self._session_uid = uid
        self._last_meta = dict(meta)

        last_lap_ms = int(sample.get("last_lap_time_ms") or 0)
        session_time = float(sample.get("session_time") or 0)
        current = self._current
        if current is None:
            self._current = _LapInProgress(lap_num, dict(meta), last_lap_ms)
        elif lap_num == current.lap_number:
            current.meta = dict(meta)
            # Chequered flag: the lap finished but the counter stayed put. The
            # cruise afterwards starts a fresh in-progress lap that SEND discards.
            if last_lap_ms > 0 and last_lap_ms != current.start_last_lap_ms and current.samples:
                self._finish(current, last_lap_ms, session_time)
                self._current = _LapInProgress(lap_num, dict(meta), last_lap_ms)
        elif lap_num == current.lap_number + 1:
            self._finish(current, last_lap_ms, session_time)
            self._current = _LapInProgress(lap_num, dict(meta), last_lap_ms)
        elif lap_num < current.lap_number:
            self._discard(f"lap number went from {current.lap_number} to {lap_num}")
            self._current = _LapInProgress(lap_num, dict(meta), last_lap_ms)
        else:
            self._discard(f"lap number jumped from {current.lap_number} to {lap_num}")
            self._current = _LapInProgress(lap_num, dict(meta), last_lap_ms)

        current = self._current
        if current.samples and is_flashback(current.samples[-1], sample):
            self._flashback(current, float(sample.get("lap_distance") or 0))
        current.samples.append(sample)

    def on_lap_all(self, lap_all: List[Dict[str, Any]], session_time: float):
        """Every car's LAP_DATA for one packet: a field frame at most 10 Hz, and grid lap completions."""
        if not self._recording:
            return
        self._track_grid(lap_all)
        last = self._last_field_t
        if last is not None and 0 <= session_time - last < FIELD_FRAME_INTERVAL_S - 1e-6:
            return
        self._last_field_t = session_time
        if self._current is not None:
            self._current.field_frames.append(field_frame(lap_all, session_time, self._moving_ghosts()))

    def on_ghost_sample(self, index: int, sample: Dict[str, Any], meta: Dict[str, Any]):
        """A time-trial ghost slot's LAP_DATA-rate sample, in the player sample's shape.
        A ghost that stops moving is left alone; a lap completes when its counter moves on."""
        if not self._recording or meta.get("session_type_id") != TIME_TRIAL_TYPE_ID:
            return
        lap_num = int(sample.get("lap_num") or 0)
        if lap_num <= 0:
            return
        distance = float(sample.get("lap_distance") or 0)
        current = self._ghosts.get(index)
        if current is None or lap_num != current.lap_number:
            if current is not None and lap_num == current.lap_number + 1:
                self._finish_ghost(index, current, int(sample.get("last_lap_time_ms") or 0), float(sample.get("session_time") or 0))
            current = _LapInProgress(lap_num, dict(meta))
            self._ghosts[index] = current
        elif current.samples and distance == float(current.samples[-1].get("lap_distance") or 0):
            return
        rewound = bool(current.samples) and is_flashback(current.samples[-1], sample)
        if rewound:
            current.samples = rewind_samples(current.samples, distance)
        current.samples.append(ghost_sample(sample, current.samples[-1] if current.samples else None, rewound))

    # ----- internals -----

    def _moving_ghosts(self) -> Set[int]:
        return {index for index, ghost in self._ghosts.items() if len(ghost.samples) > 1}

    def _reset_ghosts(self):
        self._ghosts = {}
        self._ghost_saved = set()

    def _finish_ghost(self, index: int, lap: _LapInProgress, lap_time_ms: int, next_session_time: float):
        if lap_time_ms <= 0 or (index, lap_time_ms) in self._ghost_saved:
            return
        result = finalize_lap(lap, lap_time_ms, time.time() - next_session_time)
        if isinstance(result, str) or result.partial_start:
            return
        self._ghost_saved.add((index, lap_time_ms))
        s1, s2, s3 = ghost_sectors(result.samples, lap_time_ms)
        result = replace(result, sector1_ms=s1, sector2_ms=s2, sector3_ms=s3, ghost={"car_index": index, "lap_time_ms": lap_time_ms})
        self._schedule(self._persist_safely(result))

    def _track_grid(self, lap_all: List[Dict[str, Any]]):
        for index, lap in enumerate(lap_all):
            lap_num = int(lap.get("current_lap_num") or 0)
            if lap.get("result_status") in _SKIPPED_RESULT_STATUS or lap_num <= 0:
                self._grid.pop(index, None)
                continue
            car = self._grid.get(index)
            if car is not None and lap_num == car.lap_number:
                car.last = lap
                car.invalid = car.invalid or bool(lap.get("current_lap_invalid"))
                continue
            if car is not None and lap_num == car.lap_number + 1:
                done = complete_grid_lap(index, car, int(lap.get("last_lap_time_ms") or 0))
                if done is not None:
                    self._pending_grid.append(done)
            self._grid[index] = _CarLap(lap_num, lap, bool(lap.get("current_lap_invalid")))

    def _reset_grid(self):
        self._grid = {}
        self._last_field_t = None

    def _take_pending_grid(self) -> List[GridLapResult]:
        pending, self._pending_grid = self._pending_grid, []
        return pending

    def _flush_grid(self):
        """Persist pending grid laps on their own (recording or session ending)."""
        pending = self._take_pending_grid()
        if not pending:
            return
        if self._last_meta is None:
            logger.info(f"Live recorder dropped {len(pending)} grid laps: no session seen")
            return
        self._schedule(self._persist_grid_safely(dict(self._last_meta), pending))

    def _schedule(self, coro: Awaitable[None]):
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def _flashback(self, lap: _LapInProgress, lap_distance: float):
        kept = rewind_samples(lap.samples, lap_distance)
        dropped = len(lap.samples) - len(kept)
        lap.samples = kept
        lap.flashbacks += 1
        self._flashbacks += 1
        logger.info(f"Live recorder flashback on lap {lap.lap_number}: dropped {dropped} samples")

    def _discard(self, reason: str):
        current = self._current
        self._current = None
        self._discarded += 1
        self._last_discard_reason = reason
        count = len(current.samples) if current else 0
        logger.info(f"Live recorder discarded in-progress lap ({count} samples): {reason}")

    def _finish(self, lap: _LapInProgress, lap_time_ms: int, next_session_time: float):
        wall_offset = time.time() - next_session_time
        result = finalize_lap(lap, lap_time_ms, wall_offset)
        if isinstance(result, str):
            self._discarded += 1
            self._last_discard_reason = result
            logger.info(f"Live recorder dropped {result}")
            return
        result.grid_laps.extend(self._take_pending_grid())
        self._schedule(self._persist_safely(result))

    async def _persist_safely(self, lap: FinalizedLap):
        try:
            await self._persist(lap)
            if lap.ghost:
                self._ghost_laps += 1
            else:
                self._recorded_laps += 1
            self._grid_laps += len(lap.grid_laps)
        except Exception:
            logger.exception(f"Live recorder failed to save lap {lap.lap_number}")

    async def _persist_grid_safely(self, meta: Dict[str, Any], grid_laps: List[GridLapResult]):
        try:
            await self._persist_grid(meta, grid_laps)
            self._grid_laps += len(grid_laps)
        except Exception:
            logger.exception(f"Live recorder failed to save {len(grid_laps)} grid laps")

    async def _persist_grid_laps(self, meta: Dict[str, Any], grid_laps: List[GridLapResult]):
        async with self._db_lock:
            async with self._session_factory() as db:
                session_row = await self._get_or_create_session(db, meta)
                await self._insert_grid_laps(db, session_row.id, grid_laps)
                await db.commit()
                logger.info(f"Live recorder saved {len(grid_laps)} grid laps to session {session_row.id}")

    @staticmethod
    async def _insert_grid_laps(db, session_id: uuid.UUID, grid_laps: List[GridLapResult]):
        if not grid_laps:
            return
        await db.execute(insert(GridLap), [
            {"id": uuid.uuid4(), "session_id": session_id, **g.__dict__} for g in grid_laps
        ])

    @staticmethod
    def _sync_roster(session_row: ImportedSession, meta: Dict[str, Any]):
        """Write who is in the session onto its extra_data when first seen or changed."""
        extra = session_row.extra_data or {}
        roster = roster_from_meta(meta)
        if all(extra.get(key) == roster[key] for key in ROSTER_KEYS):
            return
        session_row.extra_data = {**extra, **roster}

    async def _persist_lap(self, lap: FinalizedLap):
        async with self._db_lock:
            async with self._session_factory() as db:
                session_row = await self._get_or_create_session(db, lap.meta)
                sample_dicts = _sample_dicts(lap)
                speeds = [s["speed_kmh"] for s in sample_dicts]
                lap_row = ImportedLap(
                    id=uuid.uuid4(),
                    session_id=session_row.id,
                    lap_number=lap.lap_number,
                    lap_index=session_row.lap_count or 0,
                    lap_time_ms=lap.lap_time_ms,
                    sector1_ms=lap.sector1_ms,
                    sector2_ms=lap.sector2_ms,
                    sector3_ms=lap.sector3_ms,
                    valid=lap.valid,
                    valid_bin_count=len(sample_dicts),
                    total_bin_count=len(sample_dicts),
                    max_speed=max(speeds),
                    avg_speed=sum(speeds) / len(speeds),
                    min_speed=min(speeds),
                    extra_data={
                        "sample_count": len(sample_dicts),
                        "partial_start": lap.partial_start,
                        "pit_lap": lap.pit_lap,
                        "flashbacks": lap.flashbacks,
                        "session_time_start": lap.session_time_start,
                        "source": "live",
                        **({"ghost": lap.ghost} if lap.ghost else {}),
                    },
                    resampled_data=resample_lap(sample_dicts),
                )
                db.add(lap_row)
                if lap.field_frames:
                    db.add(SessionField(
                        id=uuid.uuid4(), session_id=session_row.id,
                        lap_number=lap.lap_number, frames=lap.field_frames,
                    ))
                await self._insert_grid_laps(db, session_row.id, lap.grid_laps)
                self._sync_roster(session_row, lap.meta)

                # One multi-row INSERT per chunk instead of ten thousand ORM
                # objects: a lap lands in well under a second and the database
                # is not busy while the next lap is being driven.
                await db.flush()
                rows = [
                    {
                        "id": uuid.uuid4(),
                        "session_id": session_row.id,
                        "lap_id": lap_row.id,
                        "bin_index": index,
                        "normalized_track_position": s["normalized_track_position"],
                        "cumulative_distance": s["cumulative_distance"],
                        "world_position_x": s["world_position_x"],
                        "world_position_y": s["world_position_y"],
                        "world_position_z": s["world_position_z"],
                        "speed": s["speed_kmh"] / 3.6,
                        "speed_kmh": s["speed_kmh"],
                        "gforce_lat": s["gforce_lat"],
                        "gforce_lon": float(raw.get("g_force_lon") or 0),
                        "gforce_vert": float(raw.get("g_force_vert") or 0),
                        "throttle": s["throttle"],
                        "brake": s["brake"],
                        "steering": s["steering"],
                        "gear": s["gear"],
                        "rpm": s["rpm"],
                        "race_position": int(raw.get("car_position") or 0),
                        "lap_time": s["lap_time"],
                        "sector": int(raw.get("sector") or 0),
                        "timestamp": datetime.utcfromtimestamp(lap.wall_offset + float(raw.get("session_time") or 0)),
                    }
                    for index, (raw, s) in enumerate(zip(lap.samples, sample_dicts))
                ]
                for start in range(0, len(rows), SAMPLE_FLUSH_THRESHOLD):
                    await db.execute(insert(TelemetrySample), rows[start:start + SAMPLE_FLUSH_THRESHOLD])

                # Ghost laps are not the player's: they count for nothing on the session.
                if not lap.ghost:
                    session_row.lap_count = (session_row.lap_count or 0) + 1
                session_row.sample_count = (session_row.sample_count or 0) + len(sample_dicts)
                if lap.valid and not lap.partial_start and not lap.ghost:
                    best = session_row.best_lap_time_ms
                    if best is None or lap.lap_time_ms < best:
                        session_row.best_lap_time_ms = lap.lap_time_ms
                session_row.imported_at = datetime.utcnow()
                await db.commit()
                logger.info(
                    f"Live recorder saved lap {lap.lap_number} ({lap.lap_time_ms} ms, "
                    f"{len(sample_dicts)} samples, {len(lap.field_frames)} field frames, "
                    f"{len(lap.grid_laps)} grid laps) to session {session_row.id}"
                )

    async def _get_or_create_session(self, db, meta: Dict[str, Any]) -> ImportedSession:
        uid = str(meta.get("session_uid") or "")
        cached = self._session_ids.get(uid)
        if cached is not None:
            row = await db.get(ImportedSession, cached)
            if row is not None:
                return row
        result = await db.execute(
            select(ImportedSession).where(
                ImportedSession.extra_data["session_uid"].as_string() == uid
            )
        )
        row = result.scalars().first()
        if row is None:
            track = meta.get("track") or "Unknown"
            session_type = meta.get("session_type") or "Unknown"
            row = ImportedSession(
                id=uuid.uuid4(),
                name=f"{track} {session_type} · {datetime.now():%Y-%m-%d %H:%M}",
                track=track,
                track_id=str(meta.get("track_id")) if meta.get("track_id") is not None else None,
                track_length=float(meta.get("track_length") or 0),
                session_type=session_type,
                source="live",
                sample_count=0,
                lap_count=0,
                extra_data={
                    "session_uid": uid,
                    "source": "live",
                    "total_laps": meta.get("total_laps"),
                    "weather": meta.get("weather"),
                    "track_temp": meta.get("track_temp"),
                    "air_temp": meta.get("air_temp"),
                },
            )
            db.add(row)
            await db.flush()
        self._session_ids[uid] = row.id
        return row
