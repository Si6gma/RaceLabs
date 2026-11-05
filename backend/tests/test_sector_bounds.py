import unittest

from app.sector_bounds import SectorBoundaryLearner
from app.telemetry import TelemetryPipeline
from app.track_sectors_service import merge_bounds

SPA = 10


def cars(*states):
    """Each state is (sector, lap_distance) for one car."""
    return [{"sector": sector, "lap_distance": distance} for sector, distance in states]


class LearnerTest(unittest.TestCase):
    def setUp(self):
        self.learner = SectorBoundaryLearner()

    def test_starts_unknown(self):
        self.assertEqual(self.learner.bounds(), (None, None))

    def test_first_crossing_sets_bound(self):
        self.assertFalse(self.learner.update(cars((0, 1500.0)), SPA))
        self.assertTrue(self.learner.update(cars((1, 1612.5)), SPA))
        self.assertEqual(self.learner.bounds(), (1612.5, None))

    def test_same_sector_repeated_does_not_change(self):
        self.learner.update(cars((0, 1500.0)), SPA)
        self.learner.update(cars((1, 1612.5)), SPA)
        self.assertFalse(self.learner.update(cars((1, 1700.0)), SPA))
        self.assertEqual(self.learner.bounds(), (1612.5, None))

    def test_later_larger_crossing_is_ignored(self):
        self.learner.update(cars((0, 1500.0), (0, 1400.0)), SPA)
        self.assertTrue(self.learner.update(cars((1, 1612.5), (0, 1500.0)), SPA))
        self.assertFalse(self.learner.update(cars((1, 1700.0), (1, 1650.0)), SPA))
        self.assertEqual(self.learner.bounds(), (1612.5, None))

    def test_smaller_crossing_lowers_bound(self):
        self.learner.update(cars((0, 1500.0), (0, 1400.0)), SPA)
        self.learner.update(cars((1, 1612.5), (0, 1500.0)), SPA)
        self.assertTrue(self.learner.update(cars((1, 1700.0), (1, 1601.0)), SPA))
        self.assertEqual(self.learner.bounds(), (1601.0, None))

    def test_sector_two_crossing_sets_second_bound(self):
        self.learner.update(cars((1, 3000.0)), SPA)
        self.assertTrue(self.learner.update(cars((2, 4210.0)), SPA))
        self.assertEqual(self.learner.bounds(), (None, 4210.0))

    def test_lap_wrap_two_to_zero_is_ignored(self):
        self.learner.update(cars((2, 6990.0)), SPA)
        self.assertFalse(self.learner.update(cars((0, 12.0)), SPA))
        self.assertEqual(self.learner.bounds(), (None, None))

    def test_zero_distance_crossing_is_ignored(self):
        self.learner.update(cars((0, 0.0)), SPA)
        self.assertFalse(self.learner.update(cars((1, 0.0)), SPA))
        self.assertEqual(self.learner.bounds(), (None, None))

    def test_track_change_resets(self):
        self.learner.update(cars((0, 1500.0)), SPA)
        self.learner.update(cars((1, 1612.5)), SPA)
        self.assertFalse(self.learner.update(cars((1, 900.0)), 11))
        self.assertEqual(self.learner.bounds(), (None, None))
        self.assertEqual(self.learner.bounds(SPA), (None, None))

    def test_seed_is_known_before_any_packet_and_survives_track_change(self):
        self.learner.seed(SPA, 1600.0, 4200.0)
        self.assertEqual(self.learner.bounds(SPA), (1600.0, 4200.0))
        self.learner.update(cars((0, 100.0)), SPA)
        self.assertFalse(self.learner.update(cars((1, 1650.0)), SPA))
        self.assertTrue(self.learner.update(cars((2, 4199.0)), SPA))
        self.assertEqual(self.learner.bounds(), (1600.0, 4199.0))
        self.learner.update(cars((0, 100.0)), 11)
        self.assertEqual(self.learner.bounds(), (None, None))
        self.learner.update(cars((0, 100.0)), SPA)
        self.assertEqual(self.learner.bounds(), (1600.0, 4200.0))


class MergeRuleTest(unittest.TestCase):
    def test_unknown_stored_takes_new(self):
        self.assertEqual(merge_bounds((None, None), (1600.0, None)), (1600.0, None))

    def test_unknown_new_keeps_stored(self):
        self.assertEqual(merge_bounds((1600.0, 4200.0), (None, None)), (1600.0, 4200.0))

    def test_smaller_wins_per_sector(self):
        self.assertEqual(merge_bounds((1600.0, 4200.0), (1590.0, 4300.0)), (1590.0, 4200.0))


class PipelineSectorBoundsTest(unittest.TestCase):
    def test_summary_carries_learned_bounds(self):
        pipe = TelemetryPipeline()
        pipe._start_session()
        pipe._update_session({"track_id": SPA, "session_type": 10, "track_length": 7004, "total_laps": 5})
        pipe._learn_sectors(cars((0, 1500.0)))
        pipe._learn_sectors(cars((1, 1612.5)))
        self.assertEqual(pipe.get_session_summary()["sector_bounds"], [1612.5, None])

    def test_unknown_track_is_not_learned(self):
        pipe = TelemetryPipeline()
        pipe._start_session()
        pipe._learn_sectors(cars((0, 1500.0)))
        pipe._learn_sectors(cars((1, 1612.5)))
        self.assertEqual(pipe.get_session_summary()["sector_bounds"], [None, None])


if __name__ == "__main__":
    unittest.main()


from app.sector_bounds import DrsZoneLearner, merge_drs_zones  # noqa: E402


def drs_frame(*states):
    """Each state is (lap_distance, drs_open) for one car; returns the three per-car arrays."""
    laps = [{"lap_distance": d} for d, _ in states]
    status = [{} for _ in states]
    tel = [{"drs": o} for _, o in states]
    return laps, status, tel


class DrsLearnerTest(unittest.TestCase):
    def setUp(self):
        self.learner = DrsZoneLearner()

    def feed(self, *states, track=SPA):
        return self.learner.update(*drs_frame(*states), track)

    def test_starts_empty(self):
        self.assertEqual(self.learner.zones(), [])

    def test_opening_alone_learns_nothing(self):
        self.assertFalse(self.feed((1000.0, 0)))
        self.assertFalse(self.feed((1210.0, 1)))
        self.assertEqual(self.learner.zones(), [])

    def test_open_then_close_is_a_zone(self):
        self.feed((1000.0, 0))
        self.feed((1210.0, 1))
        self.assertTrue(self.feed((1900.0, 0)))
        self.assertEqual(self.learner.zones(), [{"start": 1210.0, "end": 1900.0}])

    def test_nearby_span_grows_the_zone_at_both_ends(self):
        self.feed((1000.0, 0), (900.0, 0))
        self.feed((1210.0, 1), (1190.0, 1))
        self.assertTrue(self.feed((1900.0, 0), (1960.0, 0)))
        self.assertEqual(self.learner.zones(), [{"start": 1190.0, "end": 1960.0}])
        self.feed((1250.0, 1), (1300.0, 1))
        self.assertFalse(self.feed((1930.0, 0), (1920.0, 0)))
        self.assertEqual(self.learner.zones(), [{"start": 1190.0, "end": 1960.0}])

    def test_far_span_adds_second_zone_sorted(self):
        self.feed((4000.0, 0))
        self.feed((4100.0, 1))
        self.feed((4600.0, 0))
        self.feed((1200.0, 1))
        self.assertTrue(self.feed((1800.0, 0)))
        self.assertEqual([z["start"] for z in self.learner.zones()], [1200.0, 4100.0])

    def test_closing_past_the_start_line_leaves_end_unknown(self):
        self.feed((6500.0, 0))
        self.feed((6800.0, 1))
        self.assertTrue(self.feed((40.0, 0)))
        self.assertEqual(self.learner.zones(), [{"start": 6800.0, "end": None}])

    def test_span_too_long_is_dropped(self):
        self.feed((1000.0, 0))
        self.feed((1210.0, 1))
        self.assertFalse(self.feed((2800.0, 0)))
        self.assertEqual(self.learner.zones(), [])

    def test_flickering_drs_allowed_is_irrelevant(self):
        # Only the wing matters: nothing happens without a drs 0->1->0 cycle.
        laps, _, tel = drs_frame((1000.0, 0))
        for allowed in (0, 1, 0, 1):
            self.assertFalse(self.learner.update(laps, [{"drs_allowed": allowed}], tel, SPA))
        self.assertEqual(self.learner.zones(), [])

    def test_opening_at_zero_distance_is_ignored(self):
        self.feed((0.0, 0))
        self.feed((0.0, 1))
        self.assertFalse(self.feed((300.0, 0)))
        self.assertEqual(self.learner.zones(), [])

    def test_closing_without_a_seen_opening_is_ignored(self):
        self.feed((1500.0, 1))  # already open when first seen
        self.assertFalse(self.feed((1900.0, 0)))
        self.assertEqual(self.learner.zones(), [])

    def test_track_change_resets_and_seed_applies(self):
        self.learner.seed(11, [{"start": 500.0, "end": 1100.0}])
        self.feed((1000.0, 0))
        self.feed((1210.0, 1))
        self.assertFalse(self.feed((1000.0, 0), track=11))
        self.assertEqual(self.learner.zones(), [{"start": 500.0, "end": 1100.0}])
        self.assertEqual(self.learner.zones(SPA), [])


class DrsZoneMergeTest(unittest.TestCase):
    def test_matching_zone_keeps_smaller_start_and_larger_end(self):
        merged = merge_drs_zones([{"start": 1200.0, "end": 1800.0}], [{"start": 1150.0, "end": 1900.0}])
        self.assertEqual(merged, [{"start": 1150.0, "end": 1900.0}])

    def test_unknown_end_never_wins(self):
        merged = merge_drs_zones([{"start": 1200.0, "end": 1800.0}], [{"start": 1210.0, "end": None}])
        self.assertEqual(merged, [{"start": 1200.0, "end": 1800.0}])

    def test_unmatched_zone_is_added_sorted(self):
        merged = merge_drs_zones([{"start": 4000.0, "end": None}], [{"start": 1200.0, "end": 1800.0}])
        self.assertEqual([z["start"] for z in merged], [1200.0, 4000.0])

    def test_stored_input_is_not_mutated(self):
        stored = [{"start": 1200.0, "end": 1800.0}]
        merge_drs_zones(stored, [{"start": 1150.0, "end": None}])
        self.assertEqual(stored, [{"start": 1200.0, "end": 1800.0}])


class PipelineDrsTest(unittest.TestCase):
    def test_summary_carries_learned_zones_once_all_arrays_seen(self):
        pipe = TelemetryPipeline()
        pipe._start_session()
        pipe._update_session({"track_id": SPA, "session_type": 10, "track_length": 7004, "total_laps": 5})
        laps, status, tel = drs_frame((1000.0, 0))
        pipe._multicar.update({"lap_all": laps, "status_all": status, "telemetry_all": tel})
        pipe._learn_drs()
        pipe._multicar["telemetry_all"] = [{"drs": 1}]
        pipe._multicar["lap_all"] = [{"lap_distance": 1210.0}]
        pipe._learn_drs()
        pipe._multicar["telemetry_all"] = [{"drs": 0}]
        pipe._multicar["lap_all"] = [{"lap_distance": 1900.0}]
        pipe._learn_drs()
        self.assertEqual(pipe.get_session_summary()["drs_zones"], [{"start": 1210.0, "end": 1900.0}])


from app.sector_bounds import drs_span  # noqa: E402


class DrsZoneRulesTest(unittest.TestCase):
    def test_span_shorter_than_minimum_is_dropped(self):
        self.assertIsNone(drs_span(1852.8, 1864.2))

    def test_span_starting_inside_a_zone_extends_it(self):
        merged = merge_drs_zones([{"start": 1309.0, "end": 1863.0}], [{"start": 1800.0, "end": 1900.0}])
        self.assertEqual(merged, [{"start": 1309.0, "end": 1900.0}])

    def test_span_starting_inside_a_zone_with_unknown_end_merges(self):
        merged = merge_drs_zones([{"start": 4203.0, "end": 4945.0}], [{"start": 4838.0, "end": None}])
        self.assertEqual(merged, [{"start": 4203.0, "end": 4945.0}])
