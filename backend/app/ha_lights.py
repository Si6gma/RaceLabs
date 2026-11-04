"""
Sends race_lights' looks to the room lamps through Home Assistant.

The pipeline listener only records frames. A 5 Hz loop does all the IO, so a
slow or absent Home Assistant can never hold up telemetry.
"""
import asyncio
import json
import logging
import os
import time
import urllib.request
from typing import Any, Dict, Optional

from app.race_lights import Lamp, Look, RaceLights

logger = logging.getLogger(__name__)

TICK_SECONDS = 0.2
IDLE_SECONDS = 30.0
# Govee's LAN control is fire-and-forget UDP, so a lost packet leaves a lamp
# showing the wrong thing. Every change is sent once more after this long.
RESEND_SECONDS = 1.0
SNAPSHOT_SCENE = "racelabs_before"


def _request(req: urllib.request.Request):
    with urllib.request.urlopen(req, timeout=2) as resp:
        return json.load(resp)


def _log_if_failed(task: "asyncio.Task"):
    if not task.cancelled() and task.exception():
        logger.error(f"Race lights test died: {task.exception()!r}")


class HALights:
    def __init__(self, url: str, token: str, left: str, right: str, state_file: str = ""):
        self.url = url.rstrip("/")
        self.token = token
        self.entities = (left, right)
        self.lights = RaceLights()
        # Master switch and brightness, set from the dashboard and kept in a
        # file so a reload or restart doesn't put the lamps back to full glare.
        self.enabled = True
        self.brightness = 100
        self._state_file = state_file
        self._load()
        self._last_packet = 0.0
        self._in_session = False
        self._sent: Optional[Look] = None
        self._touched = False
        self._resend_at: Optional[float] = None
        self._failing = False
        self._demo: Optional[asyncio.Task] = None
        self._checked_leftovers = False

    def on_frame(self, frame: Dict[str, Any]):
        now = time.monotonic()
        # Menus keep sending the odd event packet (button presses), so only real
        # telemetry counts as the game being in a session.
        if "event" not in frame:
            self._last_packet = now
        self.lights.feed(frame, now)

    def configure(self, enabled: Optional[bool] = None, brightness: Optional[int] = None):
        if enabled is not None:
            self.enabled = enabled
            if not enabled and self.demo_running:
                self._demo.cancel()
        if brightness is not None:
            self.brightness = min(100, max(1, brightness))
            self._sent = None  # whatever is showing gets sent again at the new level
        if self._state_file:
            try:
                with open(self._state_file, "w") as f:
                    json.dump({"enabled": self.enabled, "brightness": self.brightness}, f)
            except OSError as e:
                logger.warning(f"Race lights: could not save settings to {self._state_file}: {e}")

    @property
    def demo_running(self) -> bool:
        return self._demo is not None and not self._demo.done()

    def start_demo(self) -> Optional[str]:
        """Play every phase on the lamps. Returns why not, or None when started."""
        if not self.enabled:
            return "the lights are switched off"
        if self.demo_running:
            return "a test is already running"
        if self._last_packet and time.monotonic() - self._last_packet < 2.0:
            return "the game is sending telemetry"
        self._demo = asyncio.create_task(self._run_demo())
        self._demo.add_done_callback(_log_if_failed)
        return None

    async def _run_demo(self):
        from app.lights_demo import STEPS
        keepalive: Optional[Dict[str, Any]] = None
        try:
            for seconds, frames in STEPS:
                for frame in frames:
                    self.on_frame(frame)
                    if "lap" in frame:
                        keepalive = frame
                for _ in range(max(1, round(seconds / 0.5))):
                    await self._pause(0.5)
                    if keepalive:
                        self.on_frame(keepalive)
        finally:
            # Over, or cancelled: let the next tick end the session and restore the room.
            self.lights.reset()
            self._last_packet = time.monotonic() - IDLE_SECONDS

    def _load(self):
        if not self._state_file or not os.path.exists(self._state_file):
            return
        try:
            with open(self._state_file) as f:
                saved = json.load(f)
            self.enabled = bool(saved.get("enabled", True))
            self.brightness = min(100, max(1, int(saved.get("brightness", 100))))
        except (OSError, ValueError) as e:
            logger.warning(f"Race lights: ignoring unreadable settings in {self._state_file}: {e}")

    async def run(self):
        while True:
            try:
                await self._tick()
            except Exception as e:
                logger.error(f"Race lights tick error: {e}")
            await asyncio.sleep(TICK_SECONDS)

    async def _tick(self):
        now = time.monotonic()
        if not self._checked_leftovers:
            self._checked_leftovers = True
            if await self._scene_exists():
                # A previous process (killed by a reload, say) died with the
                # lamps mid-effect. Put the room back now, whatever else is going
                # on, rather than snapshotting that effect as "before" later.
                logger.info("Race lights: restoring the lamp snapshot a previous run left behind")
                self._touched = True
                await self._end_session(now)
                return

        if not self._in_session:
            if self.enabled and self._last_packet and now - self._last_packet < IDLE_SECONDS:
                self._in_session = True
                # Save the room's lighting before anything changes it.
                await self._call("scene", "create", {
                    "scene_id": SNAPSHOT_SCENE,
                    "snapshot_entities": list(self.entities),
                })
            return

        # Switched off mid-session counts as the session ending: room lighting back.
        if not self.enabled or now - self._last_packet >= IDLE_SECONDS:
            await self._end_session(now)
            return

        look = self.lights.look(now)
        if look is None:
            await self._restore(now)
            return
        await self._show(look, now)

    async def _end_session(self, now: float):
        await self._restore(now)
        if self._resend_at is not None:
            # The restore's repeat has to happen before the snapshot goes.
            await self._pause(RESEND_SECONDS)
            self._resend_at = None
            for entity in self.entities:
                await self._resend_state(entity)
        await self._call("scene", "delete", {"entity_id": f"scene.{SNAPSHOT_SCENE}"})
        self.lights.reset()
        self._in_session = False
        self._last_packet = 0.0

    def _resend_due(self, now: float) -> bool:
        if self._resend_at is not None and now >= self._resend_at:
            self._resend_at = None
            return True
        return False

    async def _restore(self, now: float):
        if self._touched:
            await self._call("scene", "turn_on", {"entity_id": f"scene.{SNAPSHOT_SCENE}"})
            self._touched = False
            self._resend_at = now + RESEND_SECONDS
        elif self._resend_due(now):
            # Home Assistant skips a scene it thinks is already applied, so
            # repeat it as explicit commands from the state it holds.
            for entity in self.entities:
                await self._resend_state(entity)
        self._sent = None

    async def _resend_state(self, entity: str):
        state = await self._call_get(f"/api/states/{entity}")
        if not state:
            return
        if state.get("state") != "on":
            await self._call("light", "turn_off", {"entity_id": entity})
            return
        attrs = state.get("attributes", {})
        data: Dict[str, Any] = {"entity_id": entity}
        if attrs.get("brightness") is not None:
            data["brightness"] = attrs["brightness"]
        if attrs.get("color_mode") == "color_temp" and attrs.get("color_temp_kelvin"):
            data["color_temp_kelvin"] = attrs["color_temp_kelvin"]
        elif attrs.get("rgb_color"):
            data["rgb_color"] = attrs["rgb_color"]
        await self._call("light", "turn_on", data)

    async def _show(self, look: Look, now: float):
        sent = self._sent or (False, False)  # never equal to a real lamp state
        changed = [i for i in (0, 1) if look[i] != sent[i]]
        resend = not changed and self._resend_due(now)
        if resend:
            changed = [0, 1]
        elif not changed:
            return
        if len(changed) == 2 and look[0] == look[1]:
            await self._set_lamp(list(self.entities), look[0])
        else:
            for i in changed:
                await self._set_lamp([self.entities[i]], look[i])
        self._sent = look
        self._touched = True
        if not resend:
            self._resend_at = now + RESEND_SECONDS

    async def _set_lamp(self, entity_ids, lamp: Lamp):
        if lamp is None:
            await self._call("light", "turn_off", {"entity_id": entity_ids})
        else:
            r, g, b, pct = lamp
            await self._call("light", "turn_on", {
                "entity_id": entity_ids, "rgb_color": [r, g, b],
                "brightness_pct": max(1, round(pct * self.brightness / 100)),
            })

    async def _call(self, domain: str, service: str, data: Dict[str, Any]):
        req = urllib.request.Request(
            f"{self.url}/api/services/{domain}/{service}",
            data=json.dumps(data).encode(),
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
            method="POST",
        )
        await self._send(req, f"{domain}.{service}")

    async def _scene_exists(self) -> bool:
        req = urllib.request.Request(
            f"{self.url}/api/states/scene.{SNAPSHOT_SCENE}",
            headers={"Authorization": f"Bearer {self.token}"},
        )
        try:
            await asyncio.to_thread(_request, req)
            return True
        except Exception:
            # 404 when there is none; anything else and the create below will say so.
            return False

    async def _pause(self, seconds: float):
        await asyncio.sleep(seconds)

    async def _call_get(self, path: str) -> Optional[Dict[str, Any]]:
        req = urllib.request.Request(f"{self.url}{path}", headers={"Authorization": f"Bearer {self.token}"})
        return await self._send(req, path)

    async def _send(self, req: urllib.request.Request, what: str):
        try:
            result = await asyncio.to_thread(_request, req)
            if self._failing:
                logger.info("Race lights: Home Assistant reachable again")
            self._failing = False
            return result
        except Exception as e:
            if not self._failing:
                logger.warning(f"Race lights: Home Assistant call {what} failed: {e}")
            self._failing = True
            return None
