"""
Telemetry processing pipeline
Decodes packets, keeps a short frame buffer and a live session summary, and
feeds the player's merged state to the live recorder lap by lap.
"""
import asyncio
import time
import logging
from collections import deque
from typing import Dict, List, Any, Optional, Deque
from dataclasses import dataclass, field

from app.decoder import F1Decoder, DriverStatus, PitStatus, ResultStatus
from app.sector_bounds import DrsZoneLearner, SectorBoundaryLearner
from app.track_sectors_service import TrackSectorsService

logger = logging.getLogger(__name__)

# Keys carrying all-22-car data — kept only on the live WebSocket stream.
_MULTICAR_KEYS = frozenset({
    "motion_all", "lap_all", "telemetry_all", "status_all", "damage_all", "participants",
})
# Player-car sub-dicts merged into the latest-state snapshot handed to the recorder.
_PLAYER_KEYS = ("lap", "telemetry", "motion", "status", "session")
# Per-car arrays the DRS learner needs together; they arrive in separate packets.
_DRS_KEYS = ("lap_all", "status_all", "telemetry_all")
# Learned sector lines are written at most this often per track.
_SECTOR_SAVE_INTERVAL = 1.0


@dataclass
class SessionState:
    session_id: str
    # Header session_uid of the game session this summary belongs to.
    session_uid: str = ""
    track: str = "Unknown"
    session_type: str = "Unknown"
    session_type_id: int = 0
    current_lap: int = 0
    best_lap_time: Optional[int] = None
    total_laps: int = 0
    current_frame: Optional[Dict[str, Any]] = None
    is_active: bool = False
    weather: int = 0
    track_temp: int = 0
    air_temp: int = 0
    track_id: int = -1
    track_length: int = 0
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    # Player state tracking
    driver_status: int = DriverStatus.IN_GARAGE
    pit_status: int = PitStatus.NONE
    in_pits: bool = False
    current_lap_invalid: bool = False
    # True once any frame of the lap being driven was flagged invalid.
    lap_invalid_seen: bool = False
    num_pit_stops: int = 0
    car_position: int = 0
    car_team_ids: List[int] = field(default_factory=list)


class TelemetryPipeline:
    def __init__(self, max_buffer_size: int = 1000, recorder=None, session_factory=None):
        self.decoder = F1Decoder()
        self.frame_buffer: Deque[Dict[str, Any]] = deque(maxlen=max_buffer_size)
        self.current_frame: Optional[Dict[str, Any]] = None
        self.session_state: Optional[SessionState] = None
        self.recorder = recorder
        self.sector_learner = SectorBoundaryLearner()
        self.drs_learner = DrsZoneLearner()
        self._multicar: Dict[str, List[Dict[str, Any]]] = {}
        self._session_factory = session_factory
        self._sector_tasks: Dict[int, asyncio.Task] = {}
        self._sector_saved_at: Dict[int, float] = {}
        self._player: Dict[str, Any] = {}
        self._listeners: List[Any] = []
        self._lock = asyncio.Lock()
        self._recording = False

    def set_recorder(self, recorder):
        self.recorder = recorder

    def set_session_factory(self, session_factory):
        self._session_factory = session_factory

    def add_listener(self, callback):
        self._listeners.append(callback)

    def remove_listener(self, callback):
        if callback in self._listeners:
            self._listeners.remove(callback)

    async def process_packet(self, data: bytes) -> Optional[Dict[str, Any]]:
        frame = self.decoder.decode_packet(data)
        if not frame:
            return None

        frame.timestamp = time.time()
        frame_dict = self.decoder.frame_to_dict(frame)
        # Per-car arrays are only for live spectating over the WebSocket. Strip them
        # before buffering, which is player-focused, to avoid ~22x bloat.
        lean_dict = {k: v for k, v in frame_dict.items() if k not in _MULTICAR_KEYS}

        async with self._lock:
            self.frame_buffer.append(lean_dict)
            self.current_frame = frame_dict

            if self.session_state is None:
                self.session_state = SessionState(session_id=f"sess_{int(time.time())}")
                self.session_state.is_active = True

            if frame_dict.get("car_team_ids"):
                self.session_state.car_team_ids = frame_dict["car_team_ids"]

            # Re-attach persisted team IDs to every frame so the frontend always has them
            if self.session_state.car_team_ids and "car_team_ids" not in frame_dict:
                frame_dict["car_team_ids"] = self.session_state.car_team_ids

            self._player["session_uid"] = frame_dict.get("session_uid")
            self._track_session_uid(frame_dict.get("session_uid"))
            for key in _PLAYER_KEYS:
                if key in frame_dict:
                    self._player[key] = frame_dict[key]

            if "session" in frame_dict:
                self._update_session(frame_dict["session"])

            if "lap" in frame_dict:
                self._update_lap(frame_dict["lap"])

            if "lap_all" in frame_dict:
                self._learn_sectors(frame_dict["lap_all"])

            for key in _DRS_KEYS:
                if key in frame_dict:
                    self._multicar[key] = frame_dict[key]
                    self._learn_drs()

            event_code = (frame_dict.get("event") or {}).get("code")
            if event_code and self._recording and self.recorder:
                self.recorder.on_event(event_code)

        for listener in self._listeners:
            try:
                if asyncio.iscoroutinefunction(listener):
                    await listener(frame_dict)
                else:
                    listener(frame_dict)
            except Exception as e:
                logger.error(f"Listener error: {e}")

        return frame_dict

    def _start_session(self, previous: Optional[SessionState] = None) -> SessionState:
        """Replace the live summary with a fresh one. Track and type fields carry over
        from `previous` so a restart does not show "Unknown" until the next session packet."""
        if previous is not None:
            previous.is_active = False
        state = SessionState(session_id=f"sess_{int(time.time())}")
        state.is_active = True
        if previous is not None:
            state.session_uid = previous.session_uid
            state.track = previous.track
            state.track_id = previous.track_id
            state.track_length = previous.track_length
            state.session_type = previous.session_type
            state.session_type_id = previous.session_type_id
            state.total_laps = previous.total_laps
            state.car_team_ids = previous.car_team_ids
        self.session_state = state
        return state

    def _track_session_uid(self, raw_uid: Any):
        """A new header session_uid means the game started a new session (restart,
        new event). Lap counters and best lap must not survive it."""
        uid = str(raw_uid) if raw_uid not in (None, "", 0) else ""
        state = self.session_state
        if not uid:
            return
        if state.session_uid and uid != state.session_uid:
            state = self._start_session(previous=state)
        state.session_uid = uid

    def _update_session(self, s: Dict[str, Any]):
        state = self.session_state
        new_track = self._track_name(s.get("track_id", -1))
        new_type = self._session_type_name(s.get("session_type", 0))
        # Start a fresh summary if track or session type changed
        if state.track != "Unknown" and state.session_type != "Unknown":
            if new_track != state.track or new_type != state.session_type:
                state = self._start_session(previous=state)
        state.track = new_track
        state.track_id = s.get("track_id", -1)
        state.track_length = s.get("track_length", 0)
        state.session_type = new_type
        state.session_type_id = s.get("session_type", 0)
        state.total_laps = s.get("total_laps", 0)
        state.weather = s.get("weather", 0)
        state.track_temp = s.get("track_temperature", 0)
        state.air_temp = s.get("air_temperature", 0)
        state.updated_at = time.time()

    def _update_lap(self, lap_info: Dict[str, Any]):
        state = self.session_state
        lap_num = lap_info.get("current_lap_num", 0)

        state.driver_status = lap_info.get("driver_status", DriverStatus.IN_GARAGE)
        state.pit_status = lap_info.get("pit_status", PitStatus.NONE)
        state.in_pits = lap_info.get("is_in_pits", False)
        state.current_lap_invalid = lap_info.get("current_lap_invalid", False)
        state.num_pit_stops = lap_info.get("num_pit_stops", 0)
        state.car_position = lap_info.get("car_position", 0)

        if lap_num <= 0:
            return

        if lap_num != state.current_lap:
            # The lap just finished: its time arrives as last_lap_time_ms on the new lap.
            if lap_num == state.current_lap + 1 and state.current_lap > 0 and not state.lap_invalid_seen:
                last = lap_info.get("last_lap_time_ms", 0)
                if last > 0 and (state.best_lap_time is None or last < state.best_lap_time):
                    state.best_lap_time = last
            state.current_lap = lap_num
            state.lap_invalid_seen = False
        state.lap_invalid_seen = state.lap_invalid_seen or state.current_lap_invalid

        result_status = lap_info.get("result_status", ResultStatus.INVALID)
        if result_status in (ResultStatus.INVALID, ResultStatus.INACTIVE):
            return

        if self._recording and self.recorder:
            self.recorder.on_sample(self._player_sample(lap_info), self._recorder_meta())

    def _learn_sectors(self, lap_all: List[Dict[str, Any]]):
        track_id = self.session_state.track_id
        if track_id < 0:
            return
        if self.sector_learner.update(lap_all, track_id):
            self._schedule_sector_save(track_id)

    def _learn_drs(self):
        track_id = self.session_state.track_id
        if track_id < 0 or any(key not in self._multicar for key in _DRS_KEYS):
            return
        if self.drs_learner.update(*(self._multicar[key] for key in _DRS_KEYS), track_id):
            self._schedule_sector_save(track_id)

    def _schedule_sector_save(self, track_id: int):
        """Persist both learners' state for a track in the background, at most once a second.
        A pending task picks up any further lowering before it runs."""
        if self._session_factory is None or track_id in self._sector_tasks:
            return
        wait = max(0.0, self._sector_saved_at.get(track_id, 0.0) + _SECTOR_SAVE_INTERVAL - time.monotonic())
        task = asyncio.create_task(self._save_sectors(track_id, wait))
        self._sector_tasks[track_id] = task

    async def _save_sectors(self, track_id: int, wait: float):
        try:
            if wait > 0:
                await asyncio.sleep(wait)
            s1, s2 = self.sector_learner.bounds(track_id)
            zones = self.drs_learner.zones(track_id)
            async with self._session_factory() as db:
                stored = await TrackSectorsService(db).merge(track_id, s1, s2, zones)
            self.sector_learner.seed(track_id, *stored["sectors"])
            self.drs_learner.seed(track_id, stored["drs_zones"])
        except Exception:
            logger.exception(f"Failed to save sector bounds for track {track_id}")
        finally:
            self._sector_saved_at[track_id] = time.monotonic()
            self._sector_tasks.pop(track_id, None)

    def _player_sample(self, lap: Dict[str, Any]) -> Dict[str, Any]:
        tel = self._player.get("telemetry") or {}
        motion = self._player.get("motion") or {}
        status = self._player.get("status") or {}
        return {
            "session_time": (self.current_frame or {}).get("session_time", 0.0),
            "lap_num": lap.get("current_lap_num", 0),
            "lap_distance": lap.get("lap_distance", 0.0),
            "total_distance": lap.get("total_distance", 0.0),
            "current_lap_time_ms": lap.get("current_lap_time_ms", 0),
            "sector": lap.get("sector", 0),
            "current_lap_invalid": bool(lap.get("current_lap_invalid", False)),
            "driver_status": lap.get("driver_status", 0),
            "pit_status": lap.get("pit_status", 0),
            "result_status": lap.get("result_status", 0),
            "sector1_ms": lap.get("sector1_time_minutes", 0) * 60000 + lap.get("sector1_time_ms", 0),
            "sector2_ms": lap.get("sector2_time_minutes", 0) * 60000 + lap.get("sector2_time_ms", 0),
            "last_lap_time_ms": lap.get("last_lap_time_ms", 0),
            "speed": tel.get("speed", 0),
            "throttle": tel.get("throttle", 0.0),
            "brake": tel.get("brake", 0.0),
            "steer": tel.get("steer", 0.0),
            "gear": tel.get("gear", 0),
            "rpm": tel.get("engine_rpm", 0),
            "drs": tel.get("drs", 0),
            "ers_store_energy": status.get("ers_store_energy", 0.0),
            "g_force_lat": motion.get("g_force_lat", 0.0),
            "g_force_lon": motion.get("g_force_lon", 0.0),
            "g_force_vert": motion.get("g_force_vert", 0.0),
            "world_pos_x": motion.get("world_pos_x", 0.0),
            "world_pos_y": motion.get("world_pos_y", 0.0),
            "world_pos_z": motion.get("world_pos_z", 0.0),
            "car_position": lap.get("car_position", 0),
            "tyre_compound": status.get("tyre_compound", 0),
        }

    def _recorder_meta(self) -> Dict[str, Any]:
        state = self.session_state
        return {
            "session_uid": self._player.get("session_uid"),
            "track_id": state.track_id,
            "track": state.track,
            "track_length": state.track_length,
            "session_type_id": state.session_type_id,
            "session_type": state.session_type,
            "total_laps": state.total_laps,
            "weather": state.weather,
            "track_temp": state.track_temp,
            "air_temp": state.air_temp,
        }

    def get_current_frame(self) -> Optional[Dict[str, Any]]:
        return self.current_frame

    def get_session_summary(self) -> Dict[str, Any]:
        if not self.session_state:
            return {}
        return self._session_to_dict(self.session_state, active=True)

    def _session_to_dict(self, session: SessionState, active: bool = False) -> Dict[str, Any]:
        recorded_laps = self.recorder.status()["recorded_laps"] if self.recorder else 0
        return {
            "session_id": session.session_id,
            "session_uid": session.session_uid,
            "track": session.track,
            "track_id": session.track_id,
            "session_type": session.session_type,
            "current_lap": session.current_lap,
            "best_lap_time": session.best_lap_time,
            "total_laps": session.total_laps,
            "weather": session.weather,
            "track_temp": session.track_temp,
            "air_temp": session.air_temp,
            "recorded_laps": recorded_laps,
            "driver_status": session.driver_status,
            "pit_status": session.pit_status,
            "in_pits": session.in_pits,
            "num_pit_stops": session.num_pit_stops,
            "car_position": session.car_position,
            "sector_bounds": list(self.sector_learner.bounds(session.track_id)),
            "drs_zones": self.drs_learner.zones(session.track_id),
            "is_active": session.is_active,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "status": "active" if active else "completed",
        }

    @property
    def is_recording(self) -> bool:
        return self._recording

    def start_recording(self):
        if self.recorder:
            self.recorder.start()
        self._recording = True

    def stop_recording(self):
        self._recording = False
        if self.recorder:
            self.recorder.stop()

    @staticmethod
    def _track_name(track_id: int) -> str:
        tracks = {
            0: "Melbourne", 1: "Paul Ricard", 2: "Shanghai", 3: "Sakhir", 4: "Catalunya",
            5: "Monaco", 6: "Montreal", 7: "Silverstone", 8: "Hockenheim", 9: "Hungaroring",
            10: "Spa", 11: "Monza", 12: "Singapore", 13: "Suzuka", 14: "Abu Dhabi",
            15: "Texas", 16: "Brazil", 17: "Austria", 18: "Sochi", 19: "Mexico",
            20: "Baku", 21: "Sakhir Short", 22: "Silverstone Short", 23: "Texas Short",
            24: "Suzuka Short", 25: "Hanoi", 26: "Zandvoort", 27: "Imola", 28: "Portimao",
            29: "Jeddah", 30: "Miami", 31: "Las Vegas", 32: "Losail",
        }
        return tracks.get(track_id, f"Track_{track_id}")

    @staticmethod
    def _session_type_name(session_type: int) -> str:
        types = {
            0: "Unknown", 1: "P1", 2: "P2", 3: "P3", 4: "Short P",
            5: "Q1", 6: "Q2", 7: "Q3", 8: "Short Q", 9: "One-Shot Q",
            10: "Race", 11: "Race 2", 12: "Race 3", 13: "Time Trial",
        }
        return types.get(session_type, f"Session_{session_type}")


pipeline = TelemetryPipeline()
