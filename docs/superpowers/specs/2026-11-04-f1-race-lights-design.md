# F1 race lights

The two Govee lamps in the room (`light.left`, `light.right`, controlled by Home
Assistant) react to what is happening in an F1 23 session that RaceLabs is
receiving.

## What the lamps do

| Moment | Source in F1 23 telemetry | Lamps |
|---|---|---|
| Start lights 1-5 | Event `STLG`, `numLights` | Each light beeps: a 0.4 s red blink, brighter each time, dark in between; 1-2 left only, 3-5 both; light 5 stays lit until lights out |
| Lights out | Event `LGOT` | Green 1.5 s |
| Red flag | Event `RDFL` | Solid red until the next start or session |
| Safety car | Session `safety_car_status == 1` | Amber pulse while deployed |
| Virtual safety car | Session `safety_car_status == 2` | Dimmer amber pulse while deployed |
| Yellow flag on the player | Car status `vehicleFiaFlags == 3` | Yellow while shown |
| Racing resumes | Safety car or VSC status back to 0, or the yellow clearing | Green 2 s (1.5 s after a yellow) |
| Player sets fastest lap | Event `FTLP` with the player's index | Purple 2 s |
| Personal best lap | Lap data: a valid lap faster than the previous best | Green 2 s |
| Penalty or lap invalidated | Event `PENA` for the player, or `current_lap_invalid` rising | Short red double pulse |
| Sector done (not in races) | Every car's `sector` changing in lap data | Purple 1 s if fastest of anyone so far, green if a personal best, yellow if slower. Out laps, in laps and invalid laps don't count |
| In the garage | Lap data `is_in_garage` | RaceLabs orange `#FF7700` at 30% while in |
| In the pit lane | Lap data `pit_status > 0` | Soft white while in |
| Chequered flag | Event `CHQF` | White, alternating left/right, 3 times |
| Session over | Event `SEND`, or no packets for 30 s | Lamps restored to how they were before the session |

When several apply at once the highest wins:
red flag > start lights > lights out > chequered > safety car > VSC > yellow >
penalty > fastest lap > personal best > sector > garage > pit. When none apply, the lamps show
the room lighting saved at session start.

## Pieces

- `decoder.py`: decode Event packets (`event` in the frame dict, with the code
  and the fields the lights need) and the player's `vehicleFiaFlags`
  (`fia_flags` in the status dict).
- `race_lights.py`, pure logic, no IO: `RaceLights.feed(frame, now)` turns
  frames into active holds and flashes; `RaceLights.look(now)` returns the
  `(left, right)` lamp states to show, or `None` for room lighting. Each pattern
  is a list of timed steps, looping for holds.
- `ha_lights.py`: the IO. A pipeline listener records frames; a 5 Hz loop asks
  for the current look and sends only what changed to Home Assistant's REST API
  (`light.turn_on` / `light.turn_off`). On the first packet of a session it
  snapshots the lamps with `scene.create` (`scene.racelabs_before`) and on
  session end it restores that scene.

## Config

Off unless `HA_URL` and `HA_TOKEN` are set. `HA_LIGHT_LEFT` and
`HA_LIGHT_RIGHT` default to `light.left` and `light.right`. The token lives in
an untracked `.env.lights` loaded by compose; the backend reaches Home
Assistant on the host through `host.docker.internal`.

## Failure behaviour

A failed Home Assistant call is logged once until a call succeeds again and is
otherwise dropped. Nothing in the lights path can raise into, or wait inside,
the telemetry pipeline.

## Testing

- Unit tests (stdlib `unittest`) for Event packet decoding and for
  `RaceLights` timing and priority.
- `scripts/lights_demo.py` sends a scripted race as F1 23 UDP packets
  so the lamps can be checked without the game.

## Not in this version

Rev light / ERS sync (the lamps take a few updates per second at most) and
Minecraft.
