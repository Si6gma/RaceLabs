"""
A scripted session for the TEST button: every lamp phase in about a minute,
fed through the same path real telemetry takes.

Each step is (seconds to hold, frames to feed). The last lap frame fed stays
the keepalive for later steps, since only lap-style frames keep a session
alive and the garage glow needs lap data to agree it is in the garage.
"""
from typing import Any, Dict, List, Tuple

PLAYER = 0


def _lap(**fields: Any) -> Dict[str, Any]:
    return {"player_car_index": PLAYER, "lap": {
        "current_lap_num": 1, "pit_status": 0, "is_in_garage": False, **fields,
    }}


def _event(code: str, **fields: Any) -> Dict[str, Any]:
    return {"player_car_index": PLAYER, "event": {"code": code, **fields}}


def _safety_car(status: int) -> Dict[str, Any]:
    return {"player_car_index": PLAYER, "session": {"safety_car_status": status, "session_type": 10}}


def _flag(fia_flag: int) -> Dict[str, Any]:
    return {"player_car_index": PLAYER, "status": {"fia_flags": fia_flag}}


STEPS: List[Tuple[float, List[Dict[str, Any]]]] = [
    (3.0, [_event("SEND"), _lap(is_in_garage=True)]),            # garage glow
    (1.0, [_event("SSTA"), _lap(), _event("STLG", num_lights=1)]),
    (1.0, [_event("STLG", num_lights=2)]),
    (1.0, [_event("STLG", num_lights=3)]),
    (1.0, [_event("STLG", num_lights=4)]),
    (1.5, [_event("STLG", num_lights=5)]),
    (3.0, [_event("LGOT")]),                                     # lights out
    (3.0, [_flag(3)]),                                           # yellow flag
    (3.0, [_flag(0)]),                                           # clears: green
    (4.0, [_safety_car(1)]),                                     # safety car
    (3.0, [_safety_car(0)]),                                     # in: green
    (4.0, [_safety_car(2)]),                                     # virtual safety car
    (3.0, [_safety_car(0)]),
    (3.0, [_event("RDFL")]),                                     # red flag
    (3.0, [_event("LGOT")]),                                     # restart
    (3.0, [_lap(pit_status=1)]),                                 # pit lane
    (1.0, [_lap()]),
    (3.0, [_event("PENA", vehicle_idx=PLAYER)]),                 # penalty
    (0.5, [_lap(current_lap_num=2, last_lap_time_ms=90000)]),
    (3.0, [_lap(current_lap_num=3, last_lap_time_ms=89000)]),    # personal best
    (3.0, [_event("FTLP", vehicle_idx=PLAYER)]),                 # fastest lap
    (4.0, [_event("CHQF")]),                                     # chequered flag
    (3.0, [_event("SEND"), _lap(is_in_garage=True)]),            # garage, then room lighting
]
