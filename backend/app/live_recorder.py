"""
Live lap recorder.

Collects the player's LAP_DATA-rate samples for the lap being driven and, once
the game moves on to the next lap, writes the finished lap into the same tables
the CSV importer uses (ImportedSession / ImportedLap / TelemetrySample) with
source = "live". Partial laps are never saved: the lap time comes from the
next lap's first sample, so a lap that is cut short by a restart, a session
change or the recorder stopping has nothing to be saved with.
"""
import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set

from sqlalchemy import select

from app.models import ImportedLap, ImportedSession, TelemetrySample
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
    samples: List[Dict[str, Any]]
    meta: Dict[str, Any]
    # time.time() minus session_time of the last sample: maps session_time onto the wall clock.
    wall_offset: float


@dataclass
class _LapInProgress:
    lap_number: int
    meta: Dict[str, Any]
    samples: List[Dict[str, Any]] = field(default_factory=list)


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
    s1 = int(last.get("sector1_ms") or 0)
    s2 = int(last.get("sector2_ms") or 0)
    s3 = lap_time_ms - s1 - s2 if s1 > 0 and s2 > 0 else None

    track_length = float(lap.meta.get("track_length") or 0)
    partial_threshold = max(PARTIAL_START_MIN_M, PARTIAL_START_FRACTION * track_length)

    return FinalizedLap(
        lap_number=lap.lap_number,
        lap_time_ms=lap_time_ms,
        sector1_ms=s1 or None,
        sector2_ms=s2 or None,
        sector3_ms=s3 if s3 and s3 > 0 else None,
        valid=not any(s.get("current_lap_invalid") for s in samples),
        partial_start=float(samples[0].get("lap_distance") or 0) > partial_threshold,
        pit_lap=any((s.get("pit_status") or 0) > 0 for s in samples),
        samples=list(samples),
        meta=dict(lap.meta),
        wall_offset=wall_offset,
    )


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
    ):
        self._session_factory = session_factory
        self._persist = persist or self._persist_lap
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
        self._last_discard_reason: Optional[str] = None

    # ----- control -----

    def start(self):
        self._reset_session_state()
        self._recording = True

    def stop(self):
        if self._current is not None:
            self._discard("recording stopped")
        self._recording = False

    def status(self) -> Dict[str, Any]:
        session_id = self._session_ids.get(self._session_uid) if self._session_uid else None
        return {
            "recording": self._recording,
            "session_id": str(session_id) if session_id else None,
            "session_uid": self._session_uid,
            "recorded_laps": self._recorded_laps,
            "discarded": self._discarded,
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
            self._recorded_laps = 0
        self._session_uid = uid

        current = self._current
        if current is None:
            self._current = _LapInProgress(lap_num, dict(meta))
        elif lap_num == current.lap_number:
            current.meta = dict(meta)
        elif lap_num == current.lap_number + 1:
            self._finish(current, int(sample.get("last_lap_time_ms") or 0), float(sample.get("session_time") or 0))
            self._current = _LapInProgress(lap_num, dict(meta))
        elif lap_num < current.lap_number:
            self._discard(f"lap number went from {current.lap_number} to {lap_num}")
            self._current = _LapInProgress(lap_num, dict(meta))
        else:
            self._discard(f"lap number jumped from {current.lap_number} to {lap_num}")
            self._current = _LapInProgress(lap_num, dict(meta))

        self._current.samples.append(sample)

    # ----- internals -----

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
        task = asyncio.create_task(self._persist_safely(result))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _persist_safely(self, lap: FinalizedLap):
        try:
            await self._persist(lap)
            self._recorded_laps += 1
        except Exception:
            logger.exception(f"Live recorder failed to save lap {lap.lap_number}")

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
                        "source": "live",
                    },
                    resampled_data=resample_lap(sample_dicts),
                )
                db.add(lap_row)

                pending = 0
                for index, (raw, s) in enumerate(zip(lap.samples, sample_dicts)):
                    db.add(TelemetrySample(
                        id=uuid.uuid4(),
                        session_id=session_row.id,
                        lap_id=lap_row.id,
                        bin_index=index,
                        normalized_track_position=s["normalized_track_position"],
                        cumulative_distance=s["cumulative_distance"],
                        world_position_x=s["world_position_x"],
                        world_position_y=s["world_position_y"],
                        world_position_z=s["world_position_z"],
                        speed=s["speed_kmh"] / 3.6,
                        speed_kmh=s["speed_kmh"],
                        gforce_lat=s["gforce_lat"],
                        gforce_lon=float(raw.get("g_force_lon") or 0),
                        gforce_vert=float(raw.get("g_force_vert") or 0),
                        throttle=s["throttle"],
                        brake=s["brake"],
                        steering=s["steering"],
                        gear=s["gear"],
                        rpm=s["rpm"],
                        race_position=int(raw.get("car_position") or 0),
                        lap_time=s["lap_time"],
                        sector=int(raw.get("sector") or 0),
                        timestamp=datetime.utcfromtimestamp(
                            lap.wall_offset + float(raw.get("session_time") or 0)
                        ),
                    ))
                    pending += 1
                    if pending >= SAMPLE_FLUSH_THRESHOLD:
                        await db.flush()
                        pending = 0

                session_row.lap_count = (session_row.lap_count or 0) + 1
                session_row.sample_count = (session_row.sample_count or 0) + len(sample_dicts)
                if lap.valid and not lap.partial_start:
                    best = session_row.best_lap_time_ms
                    if best is None or lap.lap_time_ms < best:
                        session_row.best_lap_time_ms = lap.lap_time_ms
                session_row.imported_at = datetime.utcnow()
                await db.commit()
                logger.info(
                    f"Live recorder saved lap {lap.lap_number} ({lap.lap_time_ms} ms, "
                    f"{len(sample_dicts)} samples) to session {session_row.id}"
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
