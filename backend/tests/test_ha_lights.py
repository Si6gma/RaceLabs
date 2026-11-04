import asyncio
import unittest
from unittest import mock

from app import ha_lights
from app.ha_lights import HALights


class FakeHA(HALights):
    def __init__(self):
        super().__init__("http://ha", "token", "light.left", "light.right")
        self.calls = []
        self.states = {"light.left": {"state": "off"}, "light.right": {"state": "off"}}
        self.scene_exists = False

    async def _call(self, domain, service, data):
        self.calls.append((domain, service, data.get("entity_id")))

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


if __name__ == "__main__":
    unittest.main()
