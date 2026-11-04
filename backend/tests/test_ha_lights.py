import asyncio
import unittest
from unittest import mock

from app import ha_lights
from app.ha_lights import HALights


class FakeHA(HALights):
    def __init__(self, state_file=""):
        super().__init__("http://ha", "token", "light.left", "light.right", state_file)
        self.calls = []
        self.last_data = {}
        self.states = {"light.left": {"state": "off"}, "light.right": {"state": "off"}}
        self.scene_exists = False

    async def _call(self, domain, service, data):
        self.calls.append((domain, service, data.get("entity_id")))
        self.last_data = data

    async def _scene_exists(self):
        return self.scene_exists

    async def _pause(self, seconds):
        pass

    async def _call_get(self, path):
        return self.states[path.rsplit("/", 1)[-1]]


class ResendTest(unittest.TestCase):
    def setUp(self):
        self.ha = FakeHA()
        self.now = 1000.0
        patcher = mock.patch.object(ha_lights.time, "monotonic", lambda: self.now)
        patcher.start()
        self.addCleanup(patcher.stop)

    def tick(self, at):
        self.now = at
        asyncio.run(self.ha._tick())
        calls, self.ha.calls = self.ha.calls, []
        return calls

    def test_a_held_look_is_sent_again_once(self):
        self.ha.on_frame({"player_car_index": 0, "lap": {"is_in_garage": True}})
        self.assertEqual(self.tick(1000.0)[0][:2], ("scene", "create"))
        self.assertEqual(self.tick(1000.2), [("light", "turn_on", ["light.left", "light.right"])])
        self.assertEqual(self.tick(1000.4), [])
        self.assertEqual(len(self.tick(1001.3)), 1)     # the resend
        self.assertEqual(self.tick(1002.5), [])         # and only once

    def test_restore_is_repeated_as_explicit_commands(self):
        self.ha.on_frame({"player_car_index": 0, "lap": {"is_in_garage": True}})
        self.tick(1000.0)
        self.tick(1000.2)
        self.ha.on_frame({"player_car_index": 0, "lap": {"is_in_garage": False}})
        self.assertEqual(self.tick(1000.4), [("scene", "turn_on", "scene.racelabs_before")])
        self.assertEqual(self.tick(1001.5), [("light", "turn_off", "light.left"), ("light", "turn_off", "light.right")])
        self.assertEqual(self.tick(1003.0), [])

    def test_menus_glow_then_restore_once_telemetry_stops(self):
        self.ha.on_frame({"player_car_index": 0, "lap": {"is_in_garage": False}})
        self.tick(1000.0)
        self.ha.on_frame({"player_car_index": 0, "event": {"code": "SEND"}})
        self.assertEqual(self.tick(1000.2), [("light", "turn_on", ["light.left", "light.right"])])
        # Button presses in the menus are events, so they don't keep the session alive.
        self.now = 1020.0
        self.ha.on_frame({"player_car_index": 0, "event": {"code": "BUTN"}})
        # Restore, its repeat as explicit commands, then the snapshot is deleted.
        self.assertEqual(self.tick(1030.1), [
            ("scene", "turn_on", "scene.racelabs_before"),
            ("light", "turn_off", "light.left"), ("light", "turn_off", "light.right"),
            ("scene", "delete", "scene.racelabs_before"),
        ])
        self.assertFalse(self.ha._in_session)

    def test_a_snapshot_left_by_a_dead_process_is_reused_not_retaken(self):
        # The lamps are mid-effect from the previous process; snapshotting them
        # now would make that effect the "room lighting" forever.
        self.ha.scene_exists = True
        self.ha.on_frame({"player_car_index": 0, "lap": {"is_in_garage": False}})
        self.assertEqual(self.tick(1000.0), [])
        self.assertTrue(self.ha._in_session)
        # Nothing active, so the old snapshot is restored straight away.
        self.assertEqual(self.tick(1000.2), [("scene", "turn_on", "scene.racelabs_before")])

    def test_event_packets_alone_do_not_start_a_session(self):
        self.ha.on_frame({"player_car_index": 0, "event": {"code": "BUTN"}})
        self.assertEqual(self.tick(1000.0), [])
        self.assertFalse(self.ha._in_session)


class ControlTest(unittest.TestCase):
    def setUp(self):
        self.ha = FakeHA()
        self.now = 1000.0
        patcher = mock.patch.object(ha_lights.time, "monotonic", lambda: self.now)
        patcher.start()
        self.addCleanup(patcher.stop)

    def tick(self, at):
        self.now = at
        asyncio.run(self.ha._tick())
        calls, self.ha.calls = self.ha.calls, []
        return calls

    def start_garage(self):
        self.ha.on_frame({"player_car_index": 0, "lap": {"is_in_garage": True}})
        self.tick(1000.0)
        return self.tick(1000.2)

    def test_master_brightness_scales_every_effect(self):
        self.ha.configure(brightness=40)
        self.start_garage()                                   # garage is 30%
        self.assertEqual(self.ha.last_data["brightness_pct"], 12)

    def test_changing_brightness_resends_what_is_showing(self):
        self.start_garage()
        self.assertEqual(self.tick(1000.4), [])
        self.ha.configure(brightness=50)
        self.assertEqual(len(self.tick(1000.6)), 1)
        self.assertEqual(self.ha.last_data["brightness_pct"], 15)

    def test_switching_off_restores_the_room_and_stays_quiet(self):
        self.start_garage()
        self.ha.configure(enabled=False)
        self.assertEqual([c[:2] for c in self.tick(1000.4)],
                         [("scene", "turn_on"), ("light", "turn_off"), ("light", "turn_off"), ("scene", "delete")])
        self.ha.on_frame({"player_car_index": 0, "lap": {"is_in_garage": True}})
        self.assertEqual(self.tick(1000.6), [])
        self.assertFalse(self.ha._in_session)
        self.ha.configure(enabled=True)
        self.ha.on_frame({"player_car_index": 0, "lap": {"is_in_garage": True}})
        self.assertEqual(self.tick(1000.8)[0][:2], ("scene", "create"))

    def test_settings_survive_a_restart(self):
        import os, tempfile
        path = os.path.join(tempfile.mkdtemp(), "lights.json")
        FakeHA(path).configure(enabled=False, brightness=35)
        again = FakeHA(path)
        self.assertFalse(again.enabled)
        self.assertEqual(again.brightness, 35)


if __name__ == "__main__":
    unittest.main()
