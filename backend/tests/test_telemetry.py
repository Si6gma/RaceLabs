import unittest

from app.telemetry import TelemetryPipeline

SPA_RACE = {"track_id": 10, "session_type": 10, "track_length": 7004, "total_laps": 5}


def lap(num: int, last_lap_ms: int = 0, invalid: bool = False):
    return {
        "current_lap_num": num, "last_lap_time_ms": last_lap_ms, "current_lap_invalid": invalid,
        "result_status": 2, "driver_status": 1, "pit_status": 0, "is_in_pits": False,
        "num_pit_stops": 0, "car_position": 1,
    }


class SessionResetTest(unittest.TestCase):
    def setUp(self):
        self.pipe = TelemetryPipeline()
        self.pipe._start_session()
        self.pipe._track_session_uid(111)
        self.pipe._update_session(SPA_RACE)
        self.pipe._update_lap(lap(1))
        self.pipe._update_lap(lap(2, last_lap_ms=90000))
        self.pipe._update_lap(lap(3, last_lap_ms=91000))

    def test_summary_has_track_id_and_session_uid(self):
        summary = self.pipe.get_session_summary()
        self.assertEqual(summary["track_id"], 10)
        self.assertEqual(summary["session_uid"], "111")
        self.assertEqual(summary["track"], "Spa")
        self.assertEqual(summary["current_lap"], 3)
        self.assertEqual(summary["best_lap_time"], 90000)

    def test_same_uid_keeps_session(self):
        before = self.pipe.session_state
        self.pipe._track_session_uid(111)
        self.assertIs(self.pipe.session_state, before)

    def test_new_uid_resets_counters_and_keeps_track(self):
        old = self.pipe.session_state
        self.pipe._track_session_uid(222)
        state = self.pipe.session_state
        self.assertIsNot(state, old)
        self.assertFalse(old.is_active)
        self.assertTrue(state.is_active)
        self.assertEqual(state.session_uid, "222")
        self.assertEqual(state.current_lap, 0)
        self.assertIsNone(state.best_lap_time)
        self.assertEqual((state.track, state.track_id, state.session_type), ("Spa", 10, "Race"))

    def test_new_uid_then_laps_start_fresh(self):
        self.pipe._track_session_uid(222)
        self.pipe._update_lap(lap(1))
        self.pipe._update_lap(lap(2, last_lap_ms=85000))
        summary = self.pipe.get_session_summary()
        self.assertEqual(summary["current_lap"], 2)
        self.assertEqual(summary["best_lap_time"], 85000)

    def test_missing_uid_is_ignored(self):
        before = self.pipe.session_state
        self.pipe._track_session_uid(None)
        self.pipe._track_session_uid(0)
        self.assertIs(self.pipe.session_state, before)
        self.assertEqual(before.session_uid, "111")

    def test_track_change_still_resets(self):
        old = self.pipe.session_state
        self.pipe._update_session({**SPA_RACE, "track_id": 11})
        state = self.pipe.session_state
        self.assertIsNot(state, old)
        self.assertEqual(state.track, "Monza")
        self.assertEqual(state.session_uid, "111")
        self.assertEqual(state.current_lap, 0)


if __name__ == "__main__":
    unittest.main()


class GhostFeedTest(unittest.TestCase):
    """In time trial the pipeline hands every non-player slot to the recorder as a ghost."""

    class Recorder:
        def __init__(self):
            self.ghosts = []

        def on_ghost_sample(self, index, sample, meta):
            self.ghosts.append((index, sample, meta))

        def on_lap_all(self, lap_all, session_time):
            pass

    def feed(self, session_type: int):
        pipe = TelemetryPipeline()
        pipe.recorder = self.Recorder()
        pipe._recording = True
        pipe._start_session()
        pipe._track_session_uid(111)
        pipe._update_session({**SPA_RACE, "session_type": session_type})
        pipe._multicar["telemetry_all"] = [{"speed": 100 + i, "engine_rpm": 9000} for i in range(3)]
        pipe._multicar["motion_all"] = [{"world_pos_x": float(i)} for i in range(3)]
        lap_all = [
            {**lap(5), "lap_distance": 1200.0},
            {**lap(2), "lap_distance": 0.0, "result_status": 0},
            {**lap(2), "lap_distance": 3400.0, "result_status": 0},
        ]
        pipe._feed_ghosts(lap_all, 12.5)
        return pipe.recorder.ghosts

    def test_time_trial_feeds_moving_slots_with_their_own_telemetry(self):
        ghosts = self.feed(13)
        self.assertEqual([g[0] for g in ghosts], [2])
        index, sample, meta = ghosts[0]
        self.assertEqual((sample["speed"], sample["world_pos_x"], sample["lap_distance"], sample["session_time"]), (102, 2.0, 3400.0, 12.5))
        self.assertEqual(meta["session_type_id"], 13)

    def test_other_sessions_feed_nothing(self):
        self.assertEqual(self.feed(10), [])
