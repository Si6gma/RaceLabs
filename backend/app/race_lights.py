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
RACELABS_ORANGE = (255, 119, 0)  # #FF7700, the dashboard accent

# name -> (steps of (seconds, left, right), loops). Holds loop, flashes don't.
PATTERNS: Dict[str, Tuple[List[Tuple[float, Lamp, Lamp]], bool]] = {
    "red_flag": ([(1.0, _c(RED, 100), _c(RED, 100))], True),
    # Start lights are flashes rather than holds so an aborted start clears itself.
    # Each light beeps (a blink, brighter each time) and goes dark until the next;
    # the fifth stays lit until lights out, like the gantry.
    "start_1": ([(0.4, _c(RED, 25), OFF), (9.6, OFF, OFF)], False),
    "start_2": ([(0.4, _c(RED, 50), OFF), (9.6, OFF, OFF)], False),
    "start_3": ([(0.4, _c(RED, 60), _c(RED, 60)), (9.6, OFF, OFF)], False),
    "start_4": ([(0.4, _c(RED, 80), _c(RED, 80)), (9.6, OFF, OFF)], False),
    "start_5": ([(10.0, _c(RED, 100), _c(RED, 100))], False),
    "lights_out": ([(1.5, _c(GREEN, 100), _c(GREEN, 100))], False),
    "chequered": ([(0.5, _c(WHITE, 100), OFF), (0.5, OFF, _c(WHITE, 100))] * 3, False),
    "safety_car": ([(1.2, _c(AMBER, 100), _c(AMBER, 100)), (1.2, _c(AMBER, 35), _c(AMBER, 35))], True),
    "vsc": ([(1.2, _c(AMBER, 60), _c(AMBER, 60)), (1.2, _c(AMBER, 20), _c(AMBER, 20))], True),
    "yellow": ([(1.0, _c(YELLOW, 100), _c(YELLOW, 100))], True),
    # Racing resumes: the safety car or VSC comes in, or a yellow clears.
    "green_flag": ([(2.0, _c(GREEN, 100), _c(GREEN, 100))], False),
    "yellow_clear": ([(1.5, _c(GREEN, 100), _c(GREEN, 100))], False),
    "penalty": ([(0.4, _c(RED, 100), _c(RED, 100)), (0.3, OFF, OFF), (0.4, _c(RED, 100), _c(RED, 100))], False),
    "fastest": ([(2.0, _c(PURPLE, 100), _c(PURPLE, 100))], False),
    "pb": ([(2.0, _c(GREEN, 100), _c(GREEN, 100))], False),
    "sector_purple": ([(1.0, _c(PURPLE, 100), _c(PURPLE, 100))], False),
    "sector_green": ([(1.0, _c(GREEN, 100), _c(GREEN, 100))], False),
    "sector_yellow": ([(1.0, _c(YELLOW, 100), _c(YELLOW, 100))], False),
    "garage": ([(1.0, _c(RACELABS_ORANGE, 30), _c(RACELABS_ORANGE, 30))], True),
    "pit": ([(1.0, _c(WHITE, 40), _c(WHITE, 40))], True),
}

# Highest first.
PRIORITY = [
    "red_flag", "start_5", "start_4", "start_3", "start_2", "start_1",
    "lights_out", "chequered", "safety_car", "vsc", "green_flag", "yellow", "yellow_clear",
    "penalty", "fastest", "pb", "sector_purple", "sector_green", "sector_yellow",
    "garage", "pit",
]
_RANK = {name: i for i, name in enumerate(PRIORITY)}
_STARTS = [f"start_{n}" for n in range(1, 6)]

FIA_YELLOW = 3
SC_FULL = 1
SC_VIRTUAL = 2
RACE_SESSION_TYPES = {10, 11, 12}
# DriverStatus: only these count as a timed lap for sector colours.
TIMED_DRIVER_STATUS = {1, 4}  # flying lap, on track


def _duration(name: str) -> float:
    return sum(step[0] for step in PATTERNS[name][0])


class RaceLights:
    def __init__(self):
        self.reset()

    def reset(self):
        # name -> time it started. Flashes are dropped once their pattern has run.
        self._active: Dict[str, float] = {}
        self._best_lap_ms: Optional[int] = None
        self._last_lap_ms = 0
        self._lap_num = 0
        self._lap_invalid = False
        self._completed_lap_invalid = False
        self._session_type = 0
        # car index -> (sector, s1_ms, s2_ms, invalid, driver_status) from its last frame
        self._cars: Dict[int, Tuple[int, int, int, bool, int]] = {}
        self._session_best: List[Optional[int]] = [None, None, None]
        self._my_best: List[Optional[int]] = [None, None, None]

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
            if sc == 0 and ("safety_car" in self._active or "vsc" in self._active):
                self._flash("green_flag", now)
            self._hold("safety_car", sc == SC_FULL, now)
            self._hold("vsc", sc == SC_VIRTUAL, now)
            self._session_type = session.get("session_type", 0)

        status = frame.get("status")
        if status:
            yellow = status.get("fia_flags") == FIA_YELLOW
            if not yellow and "yellow" in self._active:
                self._flash("yellow_clear", now)
            self._hold("yellow", yellow, now)

        lap = frame.get("lap")
        if lap:
            self._feed_lap(lap, now)
        if frame.get("lap_all") and self._session_type not in RACE_SESSION_TYPES:
            self._feed_sectors(frame["lap_all"], player, now)

        event = frame.get("event")
        if event:
            self._feed_event(event, player, now)

    def _feed_lap(self, lap: Dict[str, Any], now: float):
        self._hold("garage", bool(lap.get("is_in_garage")), now)
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

    def _feed_sectors(self, cars: List[Dict[str, Any]], player: int, now: float):
        """Flash purple/green/yellow as the player completes a sector, like F1 timing."""
        for idx, car in enumerate(cars):
            sector = car.get("sector", 0)
            s1 = car.get("sector1_time_minutes", 0) * 60000 + car.get("sector1_time_ms", 0)
            s2 = car.get("sector2_time_minutes", 0) * 60000 + car.get("sector2_time_ms", 0)
            invalid = bool(car.get("current_lap_invalid"))
            status = car.get("driver_status", 0)
            prev = self._cars.get(idx)
            self._cars[idx] = (sector, s1, s2, invalid, status)
            if prev is None or prev[0] == sector:
                continue
            prev_sector, prev_s1, prev_s2, prev_invalid, prev_status = prev
            if prev_sector == 0 and sector == 1:
                done, t = 0, s1
            elif prev_sector == 1 and sector == 2:
                done, t = 1, s2
            elif prev_sector == 2 and sector == 0:
                # s1/s2 reset with the new lap, so sector 3 comes from the previous frame.
                done, t = 2, car.get("last_lap_time_ms", 0) - prev_s1 - prev_s2
            else:
                continue
            if t <= 0 or prev_invalid or prev_status not in TIMED_DRIVER_STATUS:
                continue

            best = self._session_best[done]
            if idx == player:
                mine = self._my_best[done]
                if best is None or t < best:
                    self._flash("sector_purple", now)
                elif mine is None or t < mine:
                    self._flash("sector_green", now)
                else:
                    self._flash("sector_yellow", now)
                if mine is None or t < mine:
                    self._my_best[done] = t
            if best is None or t < best:
                self._session_best[done] = t

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
            # The game sends nothing between a session ending and the next one
            # starting (a one-shot restart sits on the garage screen), so treat
            # that gap as the garage until lap data says otherwise.
            self._active.clear()
            self._hold("garage", True, now)

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
