"""
What the room lamps should show for a live F1 23 session.

Pure logic, no IO: feed() turns decoded frames into active holds (shown while a
condition lasts) and flashes (shown for a fixed time), and look() picks the
highest priority one and returns the two lamp states for this instant.
ha_lights.py is what sends them anywhere.
"""
from typing import Any, Dict, List, Optional, Tuple

# A lamp state is (r, g, b, brightness_pct), or OFF.
Lamp = Optional[Tuple[int, int, int, int]]
OFF: Lamp = None
Look = Tuple[Lamp, Lamp]


def _c(rgb: Tuple[int, int, int], pct: int) -> Lamp:
    return (*rgb, pct)


RED = (255, 0, 0)
GREEN = (0, 255, 0)
PURPLE = (160, 0, 255)
AMBER = (255, 120, 0)
YELLOW = (255, 210, 0)
WHITE = (255, 240, 220)

# name -> (steps of (seconds, left, right), loops). Holds loop, flashes don't.
PATTERNS: Dict[str, Tuple[List[Tuple[float, Lamp, Lamp]], bool]] = {
    "red_flag": ([(1.0, _c(RED, 100), _c(RED, 100))], True),
    # Start lights are flashes rather than holds so an aborted start clears itself.
    "start_1": ([(10.0, _c(RED, 25), OFF)], False),
    "start_2": ([(10.0, _c(RED, 50), OFF)], False),
    "start_3": ([(10.0, _c(RED, 60), _c(RED, 60))], False),
    "start_4": ([(10.0, _c(RED, 80), _c(RED, 80))], False),
    "start_5": ([(10.0, _c(RED, 100), _c(RED, 100))], False),
    "lights_out": ([(1.5, _c(GREEN, 100), _c(GREEN, 100))], False),
    "chequered": ([(0.5, _c(WHITE, 100), OFF), (0.5, OFF, _c(WHITE, 100))] * 3, False),
    "safety_car": ([(1.2, _c(AMBER, 100), _c(AMBER, 100)), (1.2, _c(AMBER, 35), _c(AMBER, 35))], True),
    "vsc": ([(1.2, _c(AMBER, 60), _c(AMBER, 60)), (1.2, _c(AMBER, 20), _c(AMBER, 20))], True),
    "yellow": ([(1.0, _c(YELLOW, 100), _c(YELLOW, 100))], True),
    "penalty": ([(0.4, _c(RED, 100), _c(RED, 100)), (0.3, OFF, OFF), (0.4, _c(RED, 100), _c(RED, 100))], False),
    "fastest": ([(2.0, _c(PURPLE, 100), _c(PURPLE, 100))], False),
    "pb": ([(2.0, _c(GREEN, 100), _c(GREEN, 100))], False),
    "pit": ([(1.0, _c(WHITE, 40), _c(WHITE, 40))], True),
}

# Highest first.
PRIORITY = [
    "red_flag", "start_5", "start_4", "start_3", "start_2", "start_1",
    "lights_out", "chequered", "safety_car", "vsc", "yellow",
    "penalty", "fastest", "pb", "pit",
]
_RANK = {name: i for i, name in enumerate(PRIORITY)}
_STARTS = [f"start_{n}" for n in range(1, 6)]

FIA_YELLOW = 3
SC_FULL = 1
SC_VIRTUAL = 2


def _duration(name: str) -> float:
    return sum(step[0] for step in PATTERNS[name][0])


class RaceLights:
    def __init__(self):
        self.reset()

    def reset(self):
        # name -> time it started. Flashes are dropped once their pattern has run.
        self._active: Dict[str, float] = {}
        self.ended = False
        self._best_lap_ms: Optional[int] = None
        self._last_lap_ms = 0
        self._lap_num = 0
        self._lap_invalid = False
        self._completed_lap_invalid = False

    def _hold(self, name: str, on: bool, now: float):
        if on:
            self._active.setdefault(name, now)
        else:
            self._active.pop(name, None)

    def _flash(self, name: str, now: float):
        self._active[name] = now

    def feed(self, frame: Dict[str, Any], now: float):
        player = frame.get("player_car_index", 255)

        session = frame.get("session")
        if session:
            sc = session.get("safety_car_status", 0)
            self._hold("safety_car", sc == SC_FULL, now)
            self._hold("vsc", sc == SC_VIRTUAL, now)

        status = frame.get("status")
        if status:
            self._hold("yellow", status.get("fia_flags") == FIA_YELLOW, now)

        lap = frame.get("lap")
        if lap:
            self._feed_lap(lap, now)

        event = frame.get("event")
        if event:
            self._feed_event(event, player, now)

    def _feed_lap(self, lap: Dict[str, Any], now: float):
        self._hold("pit", lap.get("pit_status", 0) > 0, now)

        invalid = bool(lap.get("current_lap_invalid"))
        lap_num = lap.get("current_lap_num", 0)
        if lap_num != self._lap_num:
            self._completed_lap_invalid = self._lap_invalid
            self._lap_num = lap_num
            self._lap_invalid = invalid
        else:
            if invalid and not self._lap_invalid:
                self._flash("penalty", now)
            self._lap_invalid = self._lap_invalid or invalid

        last = lap.get("last_lap_time_ms", 0)
        if last and last != self._last_lap_ms:
            self._last_lap_ms = last
            if not self._completed_lap_invalid:
                if self._best_lap_ms is not None and last < self._best_lap_ms and "fastest" not in self._active:
                    self._flash("pb", now)
                if self._best_lap_ms is None or last < self._best_lap_ms:
                    self._best_lap_ms = last

    def _feed_event(self, event: Dict[str, Any], player: int, now: float):
        code = event.get("code")
        if code == "STLG":
            for name in _STARTS:
                self._active.pop(name, None)
            n = min(max(event.get("num_lights", 1), 1), 5)
            self._flash(f"start_{n}", now)
            self._active.pop("red_flag", None)
        elif code == "LGOT":
            for name in _STARTS:
                self._active.pop(name, None)
            self._active.pop("red_flag", None)
            self._flash("lights_out", now)
        elif code == "RDFL":
            self._hold("red_flag", True, now)
        elif code == "CHQF":
            self._flash("chequered", now)
        elif code == "FTLP" and event.get("vehicle_idx") == player:
            self._active.pop("pb", None)
            self._flash("fastest", now)
        elif code == "PENA" and event.get("vehicle_idx") == player:
            self._flash("penalty", now)
        elif code == "SSTA":
            self._active.clear()
        elif code == "SEND":
            self._active.clear()
            self.ended = True

    def look(self, now: float) -> Optional[Look]:
        """The two lamp states to show now, or None for the room's own lighting."""
        for name, started in list(self._active.items()):
            if not PATTERNS[name][1] and now - started >= _duration(name):
                del self._active[name]
        if not self._active:
            return None

        name = min(self._active, key=_RANK.__getitem__)
        steps, loops = PATTERNS[name]
        t = now - self._active[name]
        if loops:
            t %= _duration(name)
        for seconds, left, right in steps:
            if t < seconds:
                return (left, right)
            t -= seconds
        return (steps[-1][1], steps[-1][2])
