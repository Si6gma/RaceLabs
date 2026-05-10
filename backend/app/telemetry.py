"""
Telemetry processing pipeline
Handles buffering, aggregation, and storage
Uses full UDP data to distinguish real laps from pits, garage, out laps, etc.
"""
import asyncio
import time
import logging
from collections import deque
from typing import Dict, List, Any, Optional, Deque, Set
from dataclasses import dataclass, field

from app.decoder import TelemetryFrame, F1Decoder, DriverStatus, PitStatus, ResultStatus

logger = logging.getLogger(__name__)


@dataclass
class LapBuffer:
    lap_number: int
    frames: Deque[Dict[str, Any]] = field(default_factory=lambda: deque(maxlen=20000))
    start_time: float = field(default_factory=time.time)
    best_lap_time: Optional[int] = None
    valid: bool = True
    # Phase tracking
    phases_seen: Set[str] = field(default_factory=set)
    primary_phase: str = "unknown"
    in_pit_frame_count: int = 0
    garage_frame_count: int = 0
    invalid_frame_count: int = 0
    out_lap_frame_count: int = 0
    flying_lap_frame_count: int = 0
    in_lap_frame_count: int = 0
    on_track_frame_count: int = 0
    total_frames: int = 0
    
    _primary_phase_dirty: bool = field(default=True, repr=False)

    def add_frame(self, frame: Dict[str, Any]):
        self.frames.append(frame)
        self.total_frames += 1
        self._primary_phase_dirty = True
        
        lap_info = frame.get("lap", {})
        phase = lap_info.get("lap_phase", "unknown")
        self.phases_seen.add(phase)
        
        # Count frames by phase
        if lap_info.get("is_in_pits"):
            self.in_pit_frame_count += 1
        if lap_info.get("is_in_garage"):
            self.garage_frame_count += 1
        if lap_info.get("current_lap_invalid"):
            self.invalid_frame_count += 1
            self.valid = False
        if lap_info.get("is_out_lap"):
            self.out_lap_frame_count += 1
        if lap_info.get("is_on_flying_lap"):
            self.flying_lap_frame_count += 1
        if lap_info.get("is_in_lap"):
            self.in_lap_frame_count += 1
        if lap_info.get("is_on_track"):
            self.on_track_frame_count += 1
            
        # Best lap time tracking
        last_lap = lap_info.get("last_lap_time_ms", 0)
        if last_lap > 0:
            if self.best_lap_time is None or last_lap < self.best_lap_time:
                self.best_lap_time = last_lap
    
    def _update_primary_phase(self):
        """Determine the primary phase of this lap based on frame counts.
        Called lazily when primary_phase is accessed."""
        if not self._primary_phase_dirty:
            return
        counts = (
            ("garage", self.garage_frame_count),
            ("pitting", self.in_pit_frame_count),
            ("out_lap", self.out_lap_frame_count),
            ("flying_lap", self.flying_lap_frame_count),
            ("in_lap", self.in_lap_frame_count),
            ("on_track", self.on_track_frame_count),
        )
        max_count = -1
        max_phase = "unknown"
        for phase, count in counts:
            if count > max_count:
                max_count = count
                max_phase = phase
        self.primary_phase = max_phase
        self._primary_phase_dirty = False
    
    @property
    def is_timed_lap(self) -> bool:
        """A timed lap is one that is primarily a flying lap or on-track race lap,
        with minimal time in pits or garage."""
        if self.total_frames == 0:
            return False
        
        # Must have actual track time
        track_frames = self.flying_lap_frame_count + self.on_track_frame_count
        if track_frames == 0:
            return False
        
        # Must not be mostly in pits/garage
        non_track_frames = self.in_pit_frame_count + self.garage_frame_count
        if non_track_frames / self.total_frames > 0.3:  # >30% in pits = not a timed lap
            return False
        
        return True
    
    @property
    def is_out_lap(self) -> bool:
        self._update_primary_phase()
        return self.primary_phase == "out_lap"
    
    @property
    def is_in_lap(self) -> bool:
        self._update_primary_phase()
        return self.primary_phase == "in_lap"
    
    @property
    def is_race_lap(self) -> bool:
        self._update_primary_phase()
        return self.primary_phase == "on_track"
    
    @property
    def pit_time_ms(self) -> int:
        """Estimated time spent in pits during this lap."""
        # Rough estimate: ~50ms per frame at 20Hz
        return self.in_pit_frame_count * 50


@dataclass
class SessionState:
    session_id: str
    track: str = "Unknown"
    session_type: str = "Unknown"
    session_type_id: int = 0
    current_lap: int = 0
    best_lap_time: Optional[int] = None
    total_laps: int = 0
    lap_buffers: Dict[int, LapBuffer] = field(default_factory=dict)
    current_frame: Optional[Dict[str, Any]] = None
    is_active: bool = False
    weather: int = 0
    track_temp: int = 0
    air_temp: int = 0
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    # Player state tracking
    driver_status: int = DriverStatus.IN_GARAGE
    pit_status: int = PitStatus.NONE
    in_pits: bool = False
    current_lap_invalid: bool = False
    num_pit_stops: int = 0
    car_position: int = 0


class TelemetryPipeline:
    def __init__(self, max_buffer_size: int = 1000):
        self.decoder = F1Decoder()
        self.frame_buffer: Deque[Dict[str, Any]] = deque(maxlen=max_buffer_size)
        self.session_state: Optional[SessionState] = None
        self._sessions_history: List[SessionState] = []
        self._listeners: List[Any] = []
        self._lock = asyncio.Lock()
        self._running = False
        self._replay_mode = False
        self._replay_buffer: List[Dict[str, Any]] = []
        self._replay_index = 0
        self._replay_speed = 1.0
        
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
        
        async with self._lock:
            self.frame_buffer.append(frame_dict)
            self.current_frame = frame_dict
            
            if self.session_state is None:
                self.session_state = SessionState(session_id=f"sess_{int(time.time())}")
                self.session_state.is_active = True
                
            if "session" in frame_dict:
                s = frame_dict["session"]
                new_track = self._track_name(s.get("track_id", -1))
                new_type = self._session_type_name(s.get("session_type", 0))
                new_type_id = s.get("session_type", 0)
                # Archive current session if track or session type changed
                if self.session_state.track != "Unknown" and self.session_state.session_type != "Unknown":
                    if (new_track != self.session_state.track or new_type != self.session_state.session_type):
                        self._archive_session()
                        self.session_state = SessionState(session_id=f"sess_{int(time.time())}")
                self.session_state.track = new_track
                self.session_state.session_type = new_type
                self.session_state.session_type_id = new_type_id
                self.session_state.total_laps = s.get("total_laps", 0)
                self.session_state.weather = s.get("weather", 0)
                self.session_state.track_temp = s.get("track_temperature", 0)
                self.session_state.air_temp = s.get("air_temperature", 0)
                self.session_state.updated_at = time.time()
            
            if "lap" in frame_dict:
                lap_info = frame_dict["lap"]
                lap_num = lap_info.get("current_lap_num", 0)
                
                # Update session state from lap data
                self.session_state.driver_status = lap_info.get("driver_status", DriverStatus.IN_GARAGE)
                self.session_state.pit_status = lap_info.get("pit_status", PitStatus.NONE)
                self.session_state.in_pits = lap_info.get("is_in_pits", False)
                self.session_state.current_lap_invalid = lap_info.get("current_lap_invalid", False)
                self.session_state.num_pit_stops = lap_info.get("num_pit_stops", 0)
                self.session_state.car_position = lap_info.get("car_position", 0)
                
                # Only process frames for laps that are actually happening
                # Skip completely invalid/inactive frames
                result_status = lap_info.get("result_status", ResultStatus.INVALID)
                if result_status in (ResultStatus.INVALID, ResultStatus.INACTIVE):
                    # Still track current lap number but don't buffer
                    if lap_num > 0:
                        self.session_state.current_lap = lap_num
                elif lap_num > 0:
                    self.session_state.current_lap = lap_num
                    
                    # Create lap buffer if needed
                    if lap_num not in self.session_state.lap_buffers:
                        self.session_state.lap_buffers[lap_num] = LapBuffer(lap_number=lap_num)
                    
                    self.session_state.lap_buffers[lap_num].add_frame(frame_dict)
                    
                    # Update best lap time
                    if self.session_state.lap_buffers[lap_num].best_lap_time:
                        if self.session_state.best_lap_time is None or \
                           self.session_state.lap_buffers[lap_num].best_lap_time < self.session_state.best_lap_time:
                            self.session_state.best_lap_time = self.session_state.lap_buffers[lap_num].best_lap_time
        
        for listener in self._listeners:
            try:
                if asyncio.iscoroutinefunction(listener):
                    await listener(frame_dict)
                else:
                    listener(frame_dict)
            except Exception as e:
                logger.error(f"Listener error: {e}")
                
        return frame_dict
        
    def get_current_frame(self) -> Optional[Dict[str, Any]]:
        return getattr(self, 'current_frame', None)
        
    def get_lap_data(self, lap_number: int) -> List[Dict[str, Any]]:
        if self.session_state and lap_number in self.session_state.lap_buffers:
            return list(self.session_state.lap_buffers[lap_number].frames)
        return []
        
    def get_all_laps(self) -> Dict[int, List[Dict[str, Any]]]:
        if not self.session_state:
            return {}
        return {k: list(v.frames) for k, v in self.session_state.lap_buffers.items()}
    
    def get_lap_summary(self, lap_number: int) -> Optional[Dict[str, Any]]:
        """Get summary info for a specific lap."""
        if not self.session_state or lap_number not in self.session_state.lap_buffers:
            return None
        buf = self.session_state.lap_buffers[lap_number]
        buf._update_primary_phase()
        return {
            "lap_number": lap_number,
            "frame_count": buf.total_frames,
            "valid": buf.valid,
            "primary_phase": buf.primary_phase,
            "phases_seen": list(buf.phases_seen),
            "is_timed_lap": buf.is_timed_lap,
            "is_out_lap": buf.is_out_lap,
            "is_in_lap": buf.is_in_lap,
            "is_race_lap": buf.is_race_lap,
            "best_lap_time_ms": buf.best_lap_time,
            "in_pit_frames": buf.in_pit_frame_count,
            "garage_frames": buf.garage_frame_count,
            "flying_lap_frames": buf.flying_lap_frame_count,
            "on_track_frames": buf.on_track_frame_count,
        }
    
    def get_timed_laps(self) -> Dict[int, List[Dict[str, Any]]]:
        """Get only timed laps (flying laps / on-track race laps), excluding out laps, in laps, and pit time."""
        if not self.session_state:
            return {}
        return {
            k: list(v.frames)
            for k, v in self.session_state.lap_buffers.items()
            if v.is_timed_lap
        }
    
    def get_current_lap_phase(self) -> str:
        """Get the current lap phase."""
        if not self.session_state:
            return "unknown"
        frame = self.get_current_frame()
        if frame and "lap" in frame:
            return frame["lap"].get("lap_phase", "unknown")
        return "unknown"
        
    def get_session_summary(self) -> Dict[str, Any]:
        if not self.session_state:
            return {}
        return self._session_to_dict(self.session_state, active=True)

    def get_all_sessions(self) -> List[Dict[str, Any]]:
        sessions = []
        for s in reversed(self._sessions_history):
            sessions.append(self._session_to_dict(s, active=False))
        if self.session_state and self.session_state.is_active:
            sessions.insert(0, self._session_to_dict(self.session_state, active=True))
        return sessions

    def get_session_data(self, session_id: str) -> Optional[Dict[str, Any]]:
        target = None
        if self.session_state and self.session_state.session_id == session_id:
            target = self.session_state
        else:
            for s in self._sessions_history:
                if s.session_id == session_id:
                    target = s
                    break
        if not target:
            return None
        
        # Ensure primary phases are computed
        for buf in target.lap_buffers.values():
            buf._update_primary_phase()
        
        return {
            "session_id": target.session_id,
            "track": target.track,
            "session_type": target.session_type,
            "created_at": target.created_at,
            "frames": [
                frame
                for lap in sorted(target.lap_buffers.keys())
                for frame in target.lap_buffers[lap].frames
            ],
            "laps": {
                lap_num: {
                    "lap_number": lap_num,
                    "frame_count": buf.total_frames,
                    "best_lap_time": buf.best_lap_time,
                    "valid": buf.valid,
                    "primary_phase": buf.primary_phase,
                    "phases_seen": list(buf.phases_seen),
                    "is_timed_lap": buf.is_timed_lap,
                    "in_pit_frames": buf.in_pit_frame_count,
                    "garage_frames": buf.garage_frame_count,
                    "flying_lap_frames": buf.flying_lap_frame_count,
                    "on_track_frames": buf.on_track_frame_count,
                }
                for lap_num, buf in target.lap_buffers.items()
            },
        }

    def clear_session(self, session_id: str) -> bool:
        if self.session_state and self.session_state.session_id == session_id:
            self.session_state = None
            return True
        for i, s in enumerate(self._sessions_history):
            if s.session_id == session_id:
                self._sessions_history.pop(i)
                return True
        return False

    def _archive_session(self):
        if self.session_state:
            self.session_state.is_active = False
            self._sessions_history.append(self.session_state)
            # Keep only last 50 sessions
            if len(self._sessions_history) > 50:
                self._sessions_history = self._sessions_history[-50:]

    @staticmethod
    def _session_to_dict(session: SessionState, active: bool = False) -> Dict[str, Any]:
        total_frames = sum(buf.total_frames for buf in session.lap_buffers.values())
        timed_laps = sum(1 for buf in session.lap_buffers.values() if buf.is_timed_lap)
        out_laps = sum(1 for buf in session.lap_buffers.values() if buf.is_out_lap)
        in_laps = sum(1 for buf in session.lap_buffers.values() if buf.is_in_lap)
        pit_laps = sum(1 for buf in session.lap_buffers.values() if buf.in_pit_frame_count > 0)
        
        return {
            "session_id": session.session_id,
            "track": session.track,
            "session_type": session.session_type,
            "current_lap": session.current_lap,
            "best_lap_time": session.best_lap_time,
            "total_laps": session.total_laps,
            "weather": session.weather,
            "track_temp": session.track_temp,
            "air_temp": session.air_temp,
            "lap_count": len(session.lap_buffers),
            "timed_lap_count": timed_laps,
            "out_lap_count": out_laps,
            "in_lap_count": in_laps,
            "pit_lap_count": pit_laps,
            "total_frame_count": total_frames,
            "driver_status": session.driver_status,
            "pit_status": session.pit_status,
            "in_pits": session.in_pits,
            "num_pit_stops": session.num_pit_stops,
            "car_position": session.car_position,
            "is_active": session.is_active,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "status": "active" if active else "completed",
        }
        
    def start_replay(self, lap_data: List[Dict[str, Any]], speed: float = 1.0):
        self._replay_mode = True
        self._replay_buffer = lap_data
        self._replay_index = 0
        self._replay_speed = speed
        
    def stop_replay(self):
        self._replay_mode = False
        self._replay_buffer = []
        self._replay_index = 0
        
    def get_replay_frame(self) -> Optional[Dict[str, Any]]:
        if not self._replay_mode or self._replay_index >= len(self._replay_buffer):
            return None
        frame = self._replay_buffer[self._replay_index]
        self._replay_index += 1
        return frame
        
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
