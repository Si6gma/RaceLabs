"""
Telemetry processing pipeline
Handles buffering, aggregation, and storage
"""
import asyncio
import time
import logging
from collections import deque
from typing import Dict, List, Any, Optional, Deque
from dataclasses import dataclass, field

from app.decoder import TelemetryFrame, F1Decoder

logger = logging.getLogger(__name__)


@dataclass
class LapBuffer:
    lap_number: int
    frames: Deque[Dict[str, Any]] = field(default_factory=lambda: deque(maxlen=20000))
    start_time: float = field(default_factory=time.time)
    best_lap_time: Optional[int] = None
    valid: bool = True
    
    def add_frame(self, frame: Dict[str, Any]):
        self.frames.append(frame)
        if "lap" in frame and frame["lap"].get("current_lap_invalid"):
            self.valid = False
        if "lap" in frame and frame["lap"].get("last_lap_time_ms", 0) > 0:
            if self.best_lap_time is None or frame["lap"]["last_lap_time_ms"] < self.best_lap_time:
                self.best_lap_time = frame["lap"]["last_lap_time_ms"]


@dataclass
class SessionState:
    session_id: str
    track: str = "Unknown"
    session_type: str = "Unknown"
    current_lap: int = 0
    best_lap_time: Optional[int] = None
    total_laps: int = 0
    lap_buffers: Dict[int, LapBuffer] = field(default_factory=dict)
    current_frame: Optional[Dict[str, Any]] = None
    is_active: bool = False
    weather: int = 0
    track_temp: int = 0
    air_temp: int = 0


class TelemetryPipeline:
    def __init__(self, max_buffer_size: int = 1000):
        self.decoder = F1Decoder()
        self.frame_buffer: Deque[Dict[str, Any]] = deque(maxlen=max_buffer_size)
        self.session_state: Optional[SessionState] = None
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
                self.session_state.track = self._track_name(s.get("track_id", -1))
                self.session_state.session_type = self._session_type_name(s.get("session_type", 0))
                self.session_state.total_laps = s.get("total_laps", 0)
                self.session_state.weather = s.get("weather", 0)
                self.session_state.track_temp = s.get("track_temperature", 0)
                self.session_state.air_temp = s.get("air_temperature", 0)
                
            if "lap" in frame_dict:
                lap_num = frame_dict["lap"].get("current_lap_num", 0)
                if lap_num > 0:
                    self.session_state.current_lap = lap_num
                    if lap_num not in self.session_state.lap_buffers:
                        self.session_state.lap_buffers[lap_num] = LapBuffer(lap_number=lap_num)
                    self.session_state.lap_buffers[lap_num].add_frame(frame_dict)
                    
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
        return self.current_frame
        
    def get_lap_data(self, lap_number: int) -> List[Dict[str, Any]]:
        if self.session_state and lap_number in self.session_state.lap_buffers:
            return list(self.session_state.lap_buffers[lap_number].frames)
        return []
        
    def get_all_laps(self) -> Dict[int, List[Dict[str, Any]]]:
        if not self.session_state:
            return {}
        return {k: list(v.frames) for k, v in self.session_state.lap_buffers.items()}
        
    def get_session_summary(self) -> Dict[str, Any]:
        if not self.session_state:
            return {}
        return {
            "session_id": self.session_state.session_id,
            "track": self.session_state.track,
            "session_type": self.session_state.session_type,
            "current_lap": self.session_state.current_lap,
            "best_lap_time": self.session_state.best_lap_time,
            "total_laps": self.session_state.total_laps,
            "weather": self.session_state.weather,
            "track_temp": self.session_state.track_temp,
            "air_temp": self.session_state.air_temp,
            "lap_count": len(self.session_state.lap_buffers),
            "is_active": self.session_state.is_active,
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
