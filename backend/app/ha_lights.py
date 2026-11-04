"""
Sends race_lights' looks to the room lamps through Home Assistant.

The pipeline listener only records frames. A 5 Hz loop does all the IO, so a
slow or absent Home Assistant can never hold up telemetry.
"""
import asyncio
import json
import logging
import time
import urllib.request
from typing import Any, Dict, Optional

from app.race_lights import Lamp, Look, RaceLights

logger = logging.getLogger(__name__)

TICK_SECONDS = 0.2
IDLE_SECONDS = 30.0
SNAPSHOT_SCENE = "racelabs_before"


def _post(req: urllib.request.Request):
    with urllib.request.urlopen(req, timeout=2):
        pass


class HALights:
    def __init__(self, url: str, token: str, left: str, right: str):
        self.url = url.rstrip("/")
        self.token = token
        self.entities = (left, right)
        self.lights = RaceLights()
        self._last_packet = 0.0
        self._in_session = False
        self._sent: Optional[Look] = None
        self._touched = False
        self._failing = False

    def on_frame(self, frame: Dict[str, Any]):
        now = time.monotonic()
        self._last_packet = now
        self.lights.feed(frame, now)

    async def run(self):
        while True:
            try:
                await self._tick()
            except Exception as e:
                logger.error(f"Race lights tick error: {e}")
            await asyncio.sleep(TICK_SECONDS)

    async def _tick(self):
        now = time.monotonic()
        if not self._in_session:
            if self._last_packet and now - self._last_packet < IDLE_SECONDS:
                # Save the room's lighting before anything changes it.
                self._in_session = True
                await self._call("scene", "create", {
                    "scene_id": SNAPSHOT_SCENE,
                    "snapshot_entities": list(self.entities),
                })
            return

        if self.lights.ended or now - self._last_packet >= IDLE_SECONDS:
            await self._restore()
            self.lights.reset()
            self._in_session = False
            self._last_packet = 0.0
            return

        look = self.lights.look(now)
        if look is None:
            await self._restore()
            return
        await self._show(look)

    async def _restore(self):
        if self._touched:
            await self._call("scene", "turn_on", {"entity_id": f"scene.{SNAPSHOT_SCENE}"})
            self._touched = False
        self._sent = None

    async def _show(self, look: Look):
        sent = self._sent or (False, False)  # never equal to a real lamp state
        changed = [i for i in (0, 1) if look[i] != sent[i]]
        if not changed:
            return
        if len(changed) == 2 and look[0] == look[1]:
            await self._set_lamp(list(self.entities), look[0])
        else:
            for i in changed:
                await self._set_lamp([self.entities[i]], look[i])
        self._sent = look
        self._touched = True

    async def _set_lamp(self, entity_ids, lamp: Lamp):
        if lamp is None:
            await self._call("light", "turn_off", {"entity_id": entity_ids})
        else:
            r, g, b, pct = lamp
            await self._call("light", "turn_on", {
                "entity_id": entity_ids, "rgb_color": [r, g, b], "brightness_pct": pct,
            })

    async def _call(self, domain: str, service: str, data: Dict[str, Any]):
        req = urllib.request.Request(
            f"{self.url}/api/services/{domain}/{service}",
            data=json.dumps(data).encode(),
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            await asyncio.to_thread(_post, req)
            if self._failing:
                logger.info("Race lights: Home Assistant reachable again")
            self._failing = False
        except Exception as e:
            if not self._failing:
                logger.warning(f"Race lights: Home Assistant call {domain}.{service} failed: {e}")
            self._failing = True
