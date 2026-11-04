import struct
import unittest

from app.decoder import F1Decoder
from app.race_lights import AMBER, GREEN, PURPLE, RACELABS_ORANGE, RED, YELLOW, RaceLights

PLAYER = 3


def header(packet_id: int) -> bytes:
    return struct.pack(F1Decoder.HEADER_FORMAT, 2023, 23, 1, 0, 1, packet_id, 1, 0.0, 0, 0, PLAYER, 255)


def event_packet(code: str, body: bytes = b"") -> bytes:
    return (header(3) + code.encode() + body).ljust(45, b"\0")


def car_status_packet(player_flag: int) -> bytes:
    cars = bytearray(22 * 55)
    struct.pack_into("<b", cars, PLAYER * 55 + 28, player_flag)
    return header(7) + bytes(cars)


class DecoderTest(unittest.TestCase):
    def setUp(self):
        self.d = F1Decoder()

    def decode(self, data):
        return self.d.frame_to_dict(self.d.decode_packet(data))

    def test_fastest_lap(self):
        f = self.decode(event_packet("FTLP", struct.pack("<Bf", PLAYER, 81.5)))
        self.assertEqual(f["event"]["code"], "FTLP")
        self.assertEqual(f["event"]["vehicle_idx"], PLAYER)
        self.assertAlmostEqual(f["event"]["lap_time"], 81.5)

    def test_penalty(self):
        f = self.decode(event_packet("PENA", struct.pack("<3B", 4, 7, PLAYER)))
        self.assertEqual(f["event"], {"code": "PENA", "penalty_type": 4, "vehicle_idx": PLAYER})

    def test_start_lights(self):
        f = self.decode(event_packet("STLG", bytes([4])))
        self.assertEqual(f["event"], {"code": "STLG", "num_lights": 4})

    def test_plain_event(self):
        self.assertEqual(self.decode(event_packet("LGOT"))["event"], {"code": "LGOT"})

    def test_safety_car_status_sits_after_the_marshal_zones(self):
        session = bytearray(615)
        session[49] = 38                    # inside the marshal zones, not the status
        session[124] = 2
        self.assertEqual(self.decode(header(1) + bytes(session))["session"]["safety_car_status"], 2)

    def test_player_fia_flag(self):
        self.assertEqual(self.decode(car_status_packet(3))["status"]["fia_flags"], 3)
        self.assertEqual(self.decode(car_status_packet(-1))["status"]["fia_flags"], -1)


def ev(code, **fields):
    return {"player_car_index": PLAYER, "event": {"code": code, **fields}}


def lap(num, last_ms=0, invalid=False, pit=0):
    return {"player_car_index": PLAYER, "lap": {
        "current_lap_num": num, "last_lap_time_ms": last_ms, "current_lap_invalid": invalid, "pit_status": pit,
    }}


def colour(look):
    """The rgb both lamps show, or None for room lighting."""
    if look is None:
        return None
    return tuple(look[0][:3]) if look[0] else None


class RaceLightsTest(unittest.TestCase):
    def setUp(self):
        self.l = RaceLights()

    def test_room_lighting_when_nothing_is_happening(self):
        self.l.feed(lap(1), 0)
        self.assertIsNone(self.l.look(0))

    def test_start_lights_build_then_lights_out(self):
        self.l.feed(ev("STLG", num_lights=1), 0)
        left, right = self.l.look(0.1)
        self.assertEqual(left, (*RED, 25))
        self.assertIsNone(right)
        self.l.feed(ev("STLG", num_lights=5), 1)
        self.assertEqual(self.l.look(1.1), ((*RED, 100), (*RED, 100)))
        self.l.feed(ev("LGOT"), 2)
        self.assertEqual(colour(self.l.look(2.1)), GREEN)
        self.assertIsNone(self.l.look(4))

    def test_aborted_start_clears_itself(self):
        self.l.feed(ev("STLG", num_lights=3), 0)
        self.assertIsNone(self.l.look(11))

    def test_safety_car_holds_and_pulses(self):
        self.l.feed({"session": {"safety_car_status": 1}}, 0)
        self.assertEqual(self.l.look(0.1)[0], (*AMBER, 100))
        self.assertEqual(self.l.look(1.3)[0], (*AMBER, 35))
        self.assertEqual(self.l.look(60.1)[0][:3], AMBER)
        self.l.feed({"session": {"safety_car_status": 0}}, 61)
        self.assertIsNone(self.l.look(61))

    def test_safety_car_beats_penalty(self):
        self.l.feed({"session": {"safety_car_status": 1}}, 0)
        self.l.feed(ev("PENA", vehicle_idx=PLAYER), 0)
        self.assertEqual(colour(self.l.look(0.1)), AMBER)

    def test_yellow_beats_penalty(self):
        self.l.feed({"status": {"fia_flags": 3}}, 0)
        self.l.feed(ev("PENA", vehicle_idx=PLAYER), 0)
        self.assertEqual(colour(self.l.look(0.1)), YELLOW)

    def test_other_cars_events_are_ignored(self):
        self.l.feed(ev("FTLP", vehicle_idx=PLAYER + 1), 0)
        self.l.feed(ev("PENA", vehicle_idx=PLAYER + 1), 0)
        self.assertIsNone(self.l.look(0.1))

    def test_fastest_lap_is_purple_and_hides_pb(self):
        self.l.feed(lap(1), 0)
        self.l.feed(lap(2, last_ms=90000), 90)
        self.l.feed(lap(3, last_ms=89000), 179)
        self.assertEqual(colour(self.l.look(179.1)), GREEN)
        self.l.feed(ev("FTLP", vehicle_idx=PLAYER), 179.2)
        self.assertEqual(colour(self.l.look(179.3)), PURPLE)
        self.assertIsNone(self.l.look(181.5))

    def test_pb_needs_a_valid_lap(self):
        self.l.feed(lap(1), 0)
        self.l.feed(lap(2, last_ms=90000), 90)
        self.l.feed(lap(2, last_ms=90000, invalid=True), 100)
        self.l.feed(lap(3, last_ms=85000), 175)
        self.assertNotEqual(colour(self.l.look(175.1)), GREEN)
        self.l.feed(lap(4, last_ms=88000), 263)
        self.assertEqual(colour(self.l.look(263.1)), GREEN)

    def test_lap_invalidated_pulses_red(self):
        self.l.feed(lap(1), 0)
        self.l.feed(lap(1, invalid=True), 5)
        self.assertEqual(colour(self.l.look(5.1)), RED)
        self.assertEqual(self.l.look(5.5), (None, None))
        self.assertEqual(colour(self.l.look(5.8)), RED)

    def test_pit_lane(self):
        self.l.feed(lap(1, pit=1), 0)
        self.assertEqual(self.l.look(0.1)[0][3], 40)
        self.l.feed(lap(1, pit=0), 10)
        self.assertIsNone(self.l.look(10))

    def test_red_flag_holds_until_restart(self):
        self.l.feed(ev("RDFL"), 0)
        self.assertEqual(colour(self.l.look(300)), RED)
        self.l.feed(ev("LGOT"), 301)
        self.assertEqual(colour(self.l.look(301.1)), GREEN)

    def test_session_end_shows_the_garage_until_driving_again(self):
        self.l.feed({"session": {"safety_car_status": 1}}, 0)
        self.l.feed(ev("SEND"), 1)
        self.assertEqual(self.l.look(1.1), ((*RACELABS_ORANGE, 30), (*RACELABS_ORANGE, 30)))
        self.l.feed(ev("SSTA"), 8)
        self.l.feed(lap(1), 8)
        self.assertIsNone(self.l.look(8.1))


    def test_garage_glows_orange_at_30(self):
        self.l.feed({"player_car_index": PLAYER, "lap": {"is_in_garage": True, "pit_status": 2}}, 0)
        self.assertEqual(self.l.look(0.1), ((*RACELABS_ORANGE, 30), (*RACELABS_ORANGE, 30)))
        self.l.feed({"player_car_index": PLAYER, "lap": {"is_in_garage": False, "pit_status": 0}}, 5)
        self.assertIsNone(self.l.look(5))


def cars(player_sector, player_s1=0, player_s2=0, rival_sector=0, rival_s1=0, last_ms=0, status=1, invalid=False):
    grid = [{"sector": 0, "driver_status": 0} for _ in range(22)]
    grid[PLAYER] = {"sector": player_sector, "sector1_time_ms": player_s1, "sector2_time_ms": player_s2,
                    "last_lap_time_ms": last_ms, "driver_status": status, "current_lap_invalid": invalid}
    grid[0] = {"sector": rival_sector, "sector1_time_ms": rival_s1, "driver_status": 1}
    return {"player_car_index": PLAYER, "session": {"session_type": 9}, "lap_all": grid}


class SectorTest(unittest.TestCase):
    def setUp(self):
        self.l = RaceLights()

    def test_purple_when_fastest_of_anyone(self):
        self.l.feed(cars(0), 0)
        self.l.feed(cars(1, player_s1=30000), 30)
        self.assertEqual(colour(self.l.look(30.1)), PURPLE)
        self.assertIsNone(self.l.look(31.1))

    def test_green_when_only_a_personal_best(self):
        self.l.feed(cars(0, rival_sector=0), 0)
        self.l.feed(cars(0, rival_sector=1, rival_s1=29000), 1)
        self.l.feed(cars(1, player_s1=30000, rival_sector=1, rival_s1=29000), 30)
        self.assertEqual(colour(self.l.look(30.1)), GREEN)

    def test_yellow_when_slower_than_own_best_and_sector_3_from_lap_time(self):
        self.l.feed(cars(0), 0)
        self.l.feed(cars(1, player_s1=30000), 30)
        self.l.feed(cars(2, player_s1=30000, player_s2=40000), 70)
        self.l.feed(cars(0, last_ms=100000), 100)          # S3 = 30000
        self.assertEqual(colour(self.l.look(100.1)), PURPLE)
        self.l.feed(cars(1, player_s1=31000), 131)
        self.assertEqual(colour(self.l.look(131.1)), YELLOW)

    def test_out_laps_invalid_laps_and_races_dont_flash(self):
        self.l.feed(cars(0, status=3), 0)
        self.l.feed(cars(1, player_s1=30000, status=3), 30)
        self.assertIsNone(self.l.look(30.1))
        self.l.feed(cars(2, player_s1=30000, player_s2=40000, invalid=True), 70)
        self.l.feed(cars(0, last_ms=100000), 100)
        self.assertIsNone(self.l.look(100.1))
        race = RaceLights()
        race.feed({**cars(0), "session": {"session_type": 10}}, 0)
        race.feed({**cars(1, player_s1=30000), "session": {"session_type": 10}}, 30)
        self.assertIsNone(race.look(30.1))


if __name__ == "__main__":
    unittest.main()
