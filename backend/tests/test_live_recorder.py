import asyncio
import unittest
from typing import Any, Dict, List

from app.live_recorder import FinalizedLap, LiveRecorder

TRACK_LENGTH = 5000.0
META = {
    "session_uid": "111", "track_id": 10, "track": "Spa", "track_length": TRACK_LENGTH,
    "session_type_id": 10, "session_type": "Race", "total_laps": 5,
    "weather": 0, "track_temp": 30, "air_temp": 22,
}


def sample(lap_num: int, i: int, **fields: Any) -> Dict[str, Any]:
    base = {
        "session_time": lap_num * 100.0 + i, "lap_num": lap_num, "lap_distance": float(i) * 100,
        "total_distance": 0.0, "current_lap_time_ms": i * 2000, "sector": min(i // 17, 2),
        "current_lap_invalid": False, "driver_status": 1, "pit_status": 0, "result_status": 2,
        "sector1_ms": 30000, "sector2_ms": 31000, "last_lap_time_ms": 0,
        "speed": 200.0 + i, "throttle": 1.0, "brake": 0.0, "steer": 0.0, "gear": 7, "rpm": 11000,
        "drs": 0, "ers_store_energy": 1.0, "g_force_lat": 0.0, "g_force_lon": 0.0, "g_force_vert": 0.0,
        "world_pos_x": 0.0, "world_pos_y": 0.0, "world_pos_z": 0.0, "car_position": 1, "tyre_compound": 16,
    }
    base.update(fields)
    return base


class RecorderTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.saved: List[FinalizedLap] = []

        async def persist(lap: FinalizedLap):
            self.saved.append(lap)

        self.rec = LiveRecorder(session_factory=None, persist=persist)
        self.rec.start()

    def drive_lap(self, lap_num: int, count: int = 50, meta=META, **fields: Any):
        for i in range(count):
            self.rec.on_sample(sample(lap_num, i, **fields), meta)

    async def test_lap_time_comes_from_next_laps_last_lap_time(self):
        self.drive_lap(1)
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        self.assertEqual(len(self.saved), 1)
        lap = self.saved[0]
        self.assertEqual(lap.lap_number, 1)
        self.assertEqual(lap.lap_time_ms, 92345)
        self.assertEqual(len(lap.samples), 50)
        self.assertEqual(self.rec.status()["recorded_laps"], 1)
        self.assertEqual(self.rec.status()["discarded"], 0)

    async def test_final_lap_completes_when_last_lap_time_changes_without_lap_increment(self):
        # Lap 5 of 5: the counter never reaches 6, but last_lap_time_ms updates at the line.
        self.drive_lap(5, last_lap_time_ms=83000)
        for i in range(10):
            self.rec.on_sample(sample(5, 50 + i, last_lap_time_ms=82500), META)
        self.rec.on_event("SEND")
        await self.rec.drain()

        self.assertEqual([lap.lap_number for lap in self.saved], [5])
        self.assertEqual(self.saved[0].lap_time_ms, 82500)
        self.assertEqual(len(self.saved[0].samples), 50)
        self.assertEqual(self.rec.status()["discarded"], 1)

    async def test_sectors_from_last_sample_and_sector3_derived(self):
        self.drive_lap(1, sector1_ms=30000, sector2_ms=31000)
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        lap = self.saved[0]
        self.assertEqual((lap.sector1_ms, lap.sector2_ms, lap.sector3_ms), (30000, 31000, 31345))

    async def test_sector3_missing_when_sector_times_absent(self):
        self.drive_lap(1, sector1_ms=0, sector2_ms=0)
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        lap = self.saved[0]
        self.assertIsNone(lap.sector1_ms)
        self.assertIsNone(lap.sector3_ms)

    async def test_partial_start_when_recording_began_mid_lap(self):
        for i in range(50):
            self.rec.on_sample(sample(1, i, lap_distance=2500.0 + i * 10), META)
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        self.assertTrue(self.saved[0].partial_start)

    async def test_full_lap_is_not_partial(self):
        self.drive_lap(1)  # first sample at lap_distance 0
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        self.assertFalse(self.saved[0].partial_start)

    async def test_any_invalid_sample_marks_lap_invalid(self):
        for i in range(50):
            self.rec.on_sample(sample(1, i, current_lap_invalid=(i == 20)), META)
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        self.assertFalse(self.saved[0].valid)

    async def test_pit_lap_flagged(self):
        for i in range(50):
            self.rec.on_sample(sample(1, i, pit_status=(1 if i > 40 else 0)), META)
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        self.assertTrue(self.saved[0].pit_lap)

    async def test_lap_dropped_without_lap_time(self):
        self.drive_lap(1)
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=0), META)
        await self.rec.drain()

        self.assertEqual(self.saved, [])
        status = self.rec.status()
        self.assertEqual(status["discarded"], 1)
        self.assertIn("no lap time", status["last_discard_reason"])

    async def test_lap_dropped_with_too_few_samples(self):
        self.drive_lap(1, count=5)
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        self.assertEqual(self.saved, [])
        self.assertIn("5 samples", self.rec.status()["last_discard_reason"])

    async def test_inactive_and_zero_lap_samples_are_ignored(self):
        self.rec.on_sample(sample(1, 0, result_status=0), META)
        self.rec.on_sample(sample(0, 0), META)
        self.drive_lap(1)
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        self.assertEqual(len(self.saved), 1)
        self.assertEqual(len(self.saved[0].samples), 50)

    async def test_session_uid_change_discards_in_progress_lap(self):
        self.drive_lap(3)
        new_meta = {**META, "session_uid": "222"}
        self.rec.on_sample(sample(1, 0, last_lap_time_ms=92345), new_meta)
        await self.rec.drain()

        self.assertEqual(self.saved, [])
        status = self.rec.status()
        self.assertEqual(status["discarded"], 1)
        self.assertEqual(status["last_discard_reason"], "session_uid changed")
        self.assertEqual(status["session_uid"], "222")

    async def test_restart_continues_recording_in_new_session(self):
        self.drive_lap(3)
        new_meta = {**META, "session_uid": "222"}
        self.drive_lap(1, meta=new_meta)
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=90000), new_meta)
        await self.rec.drain()

        self.assertEqual([lap.lap_number for lap in self.saved], [1])
        self.assertEqual(self.saved[0].meta["session_uid"], "222")

    async def test_lap_number_decrease_discards_in_progress_lap(self):
        self.drive_lap(3)
        self.rec.on_sample(sample(1, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        self.assertEqual(self.saved, [])
        self.assertIn("went from 3 to 1", self.rec.status()["last_discard_reason"])

    async def test_session_event_discards_in_progress_lap(self):
        self.drive_lap(1)
        self.rec.on_event("SEND")
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        self.assertEqual(self.saved, [])
        self.assertEqual(self.rec.status()["last_discard_reason"], "session event SEND")

    async def test_other_events_are_ignored(self):
        self.drive_lap(1)
        self.rec.on_event("FTLP")
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        self.assertEqual(len(self.saved), 1)

    async def test_stop_discards_in_progress_lap(self):
        self.drive_lap(1)
        self.rec.stop()
        await self.rec.drain()

        self.assertEqual(self.saved, [])
        status = self.rec.status()
        self.assertFalse(status["recording"])
        self.assertEqual(status["last_discard_reason"], "recording stopped")
        # Samples after stop are ignored
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        self.assertEqual(self.saved, [])

    async def test_start_resets_counters(self):
        self.drive_lap(1)
        self.rec.stop()
        self.rec.start()
        status = self.rec.status()
        self.assertEqual((status["recorded_laps"], status["discarded"]), (0, 0))
        self.assertIsNone(status["session_id"])

    async def test_persist_failure_is_logged_not_raised(self):
        async def failing(lap: FinalizedLap):
            raise RuntimeError("db down")

        rec = LiveRecorder(session_factory=None, persist=failing)
        rec.start()
        for i in range(50):
            rec.on_sample(sample(1, i), META)
        with self.assertLogs("app.live_recorder", level="ERROR"):
            rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
            await rec.drain()
        self.assertEqual(rec.status()["recorded_laps"], 0)


if __name__ == "__main__":
    unittest.main()
