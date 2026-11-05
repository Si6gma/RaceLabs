import asyncio
import unittest
from typing import Any, Dict, List

from app.live_recorder import FinalizedLap, GridLapResult, LiveRecorder

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

    async def test_flashback_rewinds_buffer_and_distances_stay_monotonic(self):
        self.drive_lap(1, count=40)  # distances 0..3900
        # Flashback to 2050 m, then drive on from there.
        for i in range(20):
            self.rec.on_sample(sample(1, 60 + i, lap_distance=2050.0 + i * 100), META)
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        lap = self.saved[0]
        distances = [s["lap_distance"] for s in lap.samples]
        self.assertEqual(distances, sorted(distances))
        # 21 kept (0..2000) + 20 after the rewind
        self.assertEqual(len(lap.samples), 41)
        self.assertEqual(lap.flashbacks, 1)
        self.assertEqual(self.rec.status()["flashbacks"], 1)

    async def test_flashback_past_lap_start_drops_everything_buffered(self):
        self.drive_lap(1, count=30)
        self.rec.on_sample(sample(1, 30, lap_distance=-5.0), META)
        for i in range(1, 50):
            self.rec.on_sample(sample(1, 30 + i, lap_distance=float(i) * 100), META)
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        lap = self.saved[0]
        self.assertEqual(len(lap.samples), 50)
        self.assertEqual(lap.samples[0]["lap_distance"], -5.0)
        self.assertEqual(lap.flashbacks, 1)

    async def test_normal_lap_has_no_flashbacks(self):
        self.drive_lap(1)
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        self.assertEqual(self.saved[0].flashbacks, 0)
        self.assertEqual(len(self.saved[0].samples), 50)
        self.assertEqual(self.rec.status()["flashbacks"], 0)

    async def test_small_backwards_jitter_is_not_a_flashback(self):
        self.drive_lap(1, count=30)
        self.rec.on_sample(sample(1, 30, lap_distance=2890.0), META)  # 10 m behind the last sample
        for i in range(31, 50):
            self.rec.on_sample(sample(1, i), META)
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        self.assertEqual(self.saved[0].flashbacks, 0)
        self.assertEqual(len(self.saved[0].samples), 50)

    async def test_flashback_count_resets_with_start(self):
        self.drive_lap(1, count=30)
        self.rec.on_sample(sample(1, 30, lap_distance=500.0), META)
        self.assertEqual(self.rec.status()["flashbacks"], 1)
        self.rec.stop()
        self.rec.start()
        self.assertEqual(self.rec.status()["flashbacks"], 0)

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


def grid_lap(lap_num: int, lap_distance: float = 0.0, **fields: Any) -> Dict[str, Any]:
    base = {
        "current_lap_num": lap_num, "lap_distance": lap_distance, "car_position": 1,
        "result_status": 2, "last_lap_time_ms": 0, "current_lap_invalid": False,
        "sector1_time_minutes": 0, "sector1_time_ms": 28000, "sector2_time_minutes": 1, "sector2_time_ms": 500,
    }
    base.update(fields)
    return base


def empty_slot() -> Dict[str, Any]:
    return {"current_lap_num": 0, "lap_distance": 0.0, "car_position": 0, "result_status": 0}


class FieldAndGridTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.saved: List[FinalizedLap] = []
        self.flushed: List[List[GridLapResult]] = []

        async def persist(lap: FinalizedLap):
            self.saved.append(lap)

        async def persist_grid(meta: Dict[str, Any], laps: List[GridLapResult]):
            self.flushed.append(laps)

        self.rec = LiveRecorder(session_factory=None, persist=persist, persist_grid=persist_grid)
        self.rec.start()

    def drive_lap(self, lap_num: int, count: int = 50, **fields: Any):
        for i in range(count):
            self.rec.on_sample(sample(lap_num, i, **fields), META)

    async def test_field_frames_throttled_to_ten_per_second(self):
        self.drive_lap(1)
        lap_all = [grid_lap(1, 100.0, car_position=3), grid_lap(1, 50.0, car_position=4)]
        for tick in range(100):  # 60 Hz for ~1.65 s
            self.rec.on_lap_all(lap_all, 100.0 + tick / 60.0)
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        frames = self.saved[0].field_frames
        self.assertEqual(len(frames), 17)
        gaps = [b["t"] - a["t"] for a, b in zip(frames, frames[1:])]
        self.assertTrue(all(g >= 0.1 - 1e-6 for g in gaps))
        self.assertEqual(frames[0]["t"], 100.0)
        self.assertEqual(len(frames[0]["cars"]), 22)
        self.assertEqual(frames[0]["cars"][0], [100.0, 3, 1])
        self.assertEqual(frames[0]["cars"][1], [50.0, 4, 1])
        self.assertEqual(frames[0]["cars"][21], [0, 0, 0])
        self.assertEqual(self.saved[0].session_time_start, 100.0)

    async def test_empty_slots_are_zeroed(self):
        self.drive_lap(1)
        self.rec.on_lap_all([grid_lap(1, 100.0), empty_slot()], 100.0)
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        self.assertEqual(self.saved[0].field_frames[0]["cars"][1], [0, 0, 0])

    async def test_frames_dropped_with_a_discarded_lap(self):
        self.drive_lap(1)
        self.rec.on_lap_all([grid_lap(1, 100.0)], 100.0)
        self.rec.stop()
        self.rec.start()
        self.drive_lap(2)
        self.rec.on_sample(sample(3, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        self.assertEqual([lap.lap_number for lap in self.saved], [2])
        self.assertEqual(self.saved[0].field_frames, [])

    async def test_frames_ignored_when_not_recording_or_no_lap_in_progress(self):
        self.rec.on_lap_all([grid_lap(1, 100.0)], 100.0)  # no player lap yet
        self.drive_lap(1)
        self.rec.on_lap_all([grid_lap(1, 200.0)], 100.5)
        self.rec.stop()
        self.rec.on_lap_all([grid_lap(1, 300.0)], 101.0)
        self.rec.start()
        self.drive_lap(1)
        self.rec.on_lap_all([grid_lap(1, 400.0)], 102.0)
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        self.assertEqual([f["cars"][0][0] for f in self.saved[0].field_frames], [400.0])

    async def test_grid_lap_completes_with_sectors_and_validity(self):
        self.drive_lap(1)
        self.rec.on_lap_all([grid_lap(1, 100.0), grid_lap(1, 50.0)], 100.0)
        self.rec.on_lap_all([grid_lap(1, 4900.0), grid_lap(1, 4800.0, current_lap_invalid=True)], 100.2)
        self.rec.on_lap_all([grid_lap(2, 10.0, last_lap_time_ms=91000),
                             grid_lap(2, 5.0, last_lap_time_ms=93000, sector1_time_ms=1)], 100.4)
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        laps = self.saved[0].grid_laps
        self.assertEqual(len(laps), 2)
        self.assertEqual(laps[0], GridLapResult(0, 1, 91000, 28000, 60500, 2500, True))
        # sectors come from the car's last sample of the finished lap; invalid flag sticks
        self.assertEqual(laps[1], GridLapResult(1, 1, 93000, 28000, 60500, 4500, False))
        self.assertEqual(self.rec.status()["grid_laps"], 2)

    async def test_grid_lap_without_time_or_sectors(self):
        self.drive_lap(1)
        self.rec.on_lap_all([grid_lap(1, 100.0, sector1_time_ms=0), grid_lap(1, 100.0)], 100.0)
        self.rec.on_lap_all([grid_lap(2, 10.0, last_lap_time_ms=91000), grid_lap(2, 10.0, last_lap_time_ms=0)], 100.4)
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        laps = self.saved[0].grid_laps
        self.assertEqual(len(laps), 1)
        self.assertEqual((laps[0].sector1_ms, laps[0].sector2_ms, laps[0].sector3_ms), (None, 60500, None))

    async def test_grid_laps_wait_for_the_next_saved_player_lap(self):
        self.drive_lap(1, count=5)  # too short: dropped, but the grid laps are kept
        self.rec.on_lap_all([grid_lap(1, 100.0)], 100.0)
        self.rec.on_lap_all([grid_lap(2, 10.0, last_lap_time_ms=91000)], 100.4)
        self.rec.on_sample(sample(2, 0, last_lap_time_ms=92345), META)
        self.drive_lap(2)
        self.rec.on_sample(sample(3, 0, last_lap_time_ms=92345), META)
        await self.rec.drain()

        self.assertEqual([lap.lap_number for lap in self.saved], [2])
        self.assertEqual([g.lap_number for g in self.saved[0].grid_laps], [1])

    async def test_pending_grid_laps_flushed_on_stop(self):
        self.drive_lap(1)
        self.rec.on_lap_all([grid_lap(1, 100.0)], 100.0)
        self.rec.on_lap_all([grid_lap(2, 10.0, last_lap_time_ms=91000)], 100.4)
        self.rec.stop()
        await self.rec.drain()

        self.assertEqual(self.saved, [])
        self.assertEqual(len(self.flushed), 1)
        self.assertEqual(self.flushed[0][0].lap_time_ms, 91000)
        self.assertEqual(self.rec.status()["grid_laps"], 1)

    async def test_pending_grid_laps_flushed_on_session_end(self):
        self.drive_lap(1)
        self.rec.on_lap_all([grid_lap(1, 100.0)], 100.0)
        self.rec.on_lap_all([grid_lap(2, 10.0, last_lap_time_ms=91000)], 100.4)
        self.rec.on_event("SEND")
        await self.rec.drain()

        self.assertEqual(len(self.flushed), 1)
        # A fresh session: the car's lap 2 is unknown again, so no completion from this increment
        self.rec.on_lap_all([grid_lap(3, 10.0, last_lap_time_ms=90000)], 200.0)
        self.rec.stop()
        await self.rec.drain()
        self.assertEqual(len(self.flushed), 1)

    async def test_nothing_flushed_without_pending_grid_laps(self):
        self.drive_lap(1)
        self.rec.stop()
        await self.rec.drain()

        self.assertEqual(self.flushed, [])


if __name__ == "__main__":
    unittest.main()


TT_META = {**META, "session_type_id": 13, "session_type": "Time Trial"}


class GhostTest(unittest.IsolatedAsyncioTestCase):
    """Time trial ghosts: the other slots replaying a lap. Each distinct ghost lap is saved once."""

    def setUp(self):
        self.saved: List[FinalizedLap] = []

        async def persist(lap: FinalizedLap):
            self.saved.append(lap)

        self.rec = LiveRecorder(session_factory=None, persist=persist)
        self.rec.start()

    def drive_ghost(self, index: int, lap_num: int, count: int = 50, lap_time_ms: int = 0, meta=TT_META):
        for i in range(count):
            self.rec.on_ghost_sample(index, sample(lap_num, i, last_lap_time_ms=lap_time_ms), meta)

    async def test_ghost_lap_saved_once_with_its_slot_and_lap_time(self):
        self.drive_ghost(3, 1)
        self.drive_ghost(3, 2, lap_time_ms=83873)
        self.drive_ghost(3, 3, lap_time_ms=83873)
        self.drive_ghost(3, 4, lap_time_ms=83873)
        await self.rec.drain()
        self.assertEqual(len(self.saved), 1)
        self.assertEqual(self.saved[0].ghost, {"car_index": 3, "lap_time_ms": 83873})
        self.assertEqual(self.saved[0].lap_time_ms, 83873)
        self.assertEqual(self.rec.status()["ghost_laps"], 1)
        self.assertEqual(self.rec.status()["recorded_laps"], 0)

    async def test_ghost_sample_clock_runs_from_its_own_lap_start(self):
        # The game mirrors the player's lap clock onto ghosts, so session_time is the clock.
        self.drive_ghost(3, 1)
        self.drive_ghost(3, 2, lap_time_ms=83873)
        await self.rec.drain()
        times = [s["current_lap_time_ms"] for s in self.saved[0].samples]
        self.assertEqual((times[0], times[1], times[-1]), (0, 1000, 49000))

    async def test_partial_first_ghost_lap_skipped_next_loop_saved(self):
        for i in range(10, 50):
            self.rec.on_ghost_sample(3, sample(1, i), TT_META)
        self.drive_ghost(3, 2, lap_time_ms=83873)
        self.drive_ghost(3, 3, lap_time_ms=83873)
        await self.rec.drain()
        self.assertEqual([lap.lap_number for lap in self.saved], [2])

    async def test_new_ghost_time_is_another_lap(self):
        self.drive_ghost(3, 1)
        self.drive_ghost(3, 2, lap_time_ms=83873)
        self.drive_ghost(3, 3, lap_time_ms=84000)
        self.drive_ghost(3, 4, lap_time_ms=84000)
        await self.rec.drain()
        self.assertEqual([lap.lap_time_ms for lap in self.saved], [83873, 84000])

    async def test_ghosts_outside_time_trial_are_ignored(self):
        self.drive_ghost(3, 1, meta=META)
        self.drive_ghost(3, 2, lap_time_ms=83873, meta=META)
        await self.rec.drain()
        self.assertEqual(self.saved, [])

    async def test_moving_ghosts_join_field_frames_frozen_ones_do_not(self):
        self.rec.on_sample(sample(1, 0), TT_META)
        self.rec.on_ghost_sample(3, sample(1, 0), TT_META)
        self.rec.on_ghost_sample(3, sample(1, 1), TT_META)
        self.rec.on_ghost_sample(7, sample(1, 5), TT_META)
        self.rec.on_ghost_sample(7, sample(1, 5), TT_META)
        lap_all = [{"lap_distance": 0.0, "car_position": 1, "current_lap_num": 1, "result_status": 2}]
        lap_all += [{"lap_distance": 100.0 * i, "car_position": 1, "current_lap_num": 1, "result_status": 0} for i in range(1, 22)]
        self.rec.on_lap_all(lap_all, 100.0)
        frame = self.rec._current.field_frames[-1]
        self.assertEqual(frame["cars"][3], [300.0, 1, 1])
        self.assertEqual(frame["cars"][7], [0, 0, 0])
        self.assertEqual(frame["cars"][2], [0, 0, 0])

    async def test_session_change_forgets_saved_ghosts(self):
        self.rec.on_sample(sample(1, 0), TT_META)
        self.drive_ghost(3, 1)
        self.drive_ghost(3, 2, lap_time_ms=83873)
        self.rec.on_sample(sample(1, 0), {**TT_META, "session_uid": "222"})
        self.drive_ghost(3, 1, meta={**TT_META, "session_uid": "222"})
        self.drive_ghost(3, 2, lap_time_ms=83873, meta={**TT_META, "session_uid": "222"})
        await self.rec.drain()
        self.assertEqual(len(self.saved), 2)
