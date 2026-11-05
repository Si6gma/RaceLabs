"""
Telemetry Suite - Main FastAPI Application
"""
import asyncio
import logging
import json
from contextlib import asynccontextmanager
from typing import Dict, Any, List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File, Depends, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, PlainTextResponse, JSONResponse
from pydantic import BaseModel, Field

from app.config import get_settings
from app.database import init_db, get_db, async_session
from app.websocket import manager
from app.telemetry import pipeline
from app.live_recorder import LiveRecorder
from app.udp_receiver import receiver
from app.ha_lights import HALights
from app.csv_import_service import CSVImportService
from app.track_alias_service import TrackAliasService
from app.track_sectors_service import TrackSectorsService
from sqlalchemy.ext.asyncio import AsyncSession

settings = get_settings()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

lights: Optional[HALights] = None  # set in lifespan when Home Assistant is configured
recorder = LiveRecorder(async_session)
pipeline.set_recorder(recorder)
pipeline.set_session_factory(async_session)


async def udp_handler(data: bytes):
    """Handle incoming UDP packets"""
    frame = await pipeline.process_packet(data)
    if frame:
        await manager.broadcast(frame, channel="live")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    logger.info("Starting Telemetry Suite...")
    await init_db()
    async with async_session() as db:
        for track_id, stored in (await TrackSectorsService(db).get_all()).items():
            pipeline.sector_learner.seed(track_id, *stored["sectors"])
            pipeline.drs_learner.seed(track_id, stored["drs_zones"])

    if _load_recording_state():
        pipeline.start_recording()
        logger.info("Recording was on before the restart; resumed")

    udp_task = asyncio.create_task(receiver.start(udp_handler))

    global lights
    lights_task = None
    if settings.HA_URL and settings.HA_TOKEN:
        lights = HALights(settings.HA_URL, settings.HA_TOKEN, settings.HA_LIGHT_LEFT, settings.HA_LIGHT_RIGHT,
                          settings.LIGHTS_STATE_FILE)
        pipeline.add_listener(lights.on_frame)
        lights_task = asyncio.create_task(lights.run())
        logger.info(f"Race lights on: {settings.HA_LIGHT_LEFT}, {settings.HA_LIGHT_RIGHT}")
    
    yield
    
    receiver.stop()
    pipeline.stop_recording()
    await recorder.drain()
    udp_task.cancel()
    if lights_task:
        lights_task.cancel()
    try:
        await udp_task
    except asyncio.CancelledError:
        pass
    logger.info("Telemetry Suite stopped")


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    lifespan=lifespan,
)

CONTROL_KEY_HEADER = "X-Control-Key"
_CONTROL_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def control_key_allows(method: str, path: str, presented: Optional[str], control_key: str) -> bool:
    """Whether a request may pass: reads are always open, writes under /api/ need the key."""
    if not control_key or method not in _CONTROL_METHODS or not path.startswith("/api/"):
        return True
    return presented == control_key


# Registered before CORS so CORS wraps it and the 403 carries CORS headers.
@app.middleware("http")
async def control_key_guard(request: Request, call_next):
    presented = request.headers.get(CONTROL_KEY_HEADER)
    if not control_key_allows(request.method, request.url.path, presented, settings.CONTROL_KEY):
        return JSONResponse(status_code=403, content={"detail": "control key required"})
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Health
@app.get("/health")
async def health():
    return {"status": "ok", "service": settings.APP_NAME}


@app.get("/api/access")
async def get_access():
    """Whether write requests need the control key."""
    return {"protected": bool(settings.CONTROL_KEY)}


# ============================================================================
# LIVE TELEMETRY ENDPOINTS
# ============================================================================

@app.get("/api/session")
async def get_session():
    return pipeline.get_session_summary()


@app.get("/api/telemetry/current/phase")
async def get_current_phase():
    """Get the current lap phase (garage, out_lap, flying_lap, in_lap, pitting, on_track, etc.)"""
    frame = pipeline.get_current_frame()
    if not frame:
        raise HTTPException(status_code=404, detail="No telemetry available")
    lap_info = frame.get("lap", {})
    return {
        "lap_phase": lap_info.get("lap_phase", "unknown"),
        "driver_status": lap_info.get("driver_status", 0),
        "pit_status": lap_info.get("pit_status", 0),
        "is_in_pits": lap_info.get("is_in_pits", False),
        "is_in_garage": lap_info.get("is_in_garage", False),
        "is_on_flying_lap": lap_info.get("is_on_flying_lap", False),
        "is_out_lap": lap_info.get("is_out_lap", False),
        "is_in_lap": lap_info.get("is_in_lap", False),
        "is_on_track": lap_info.get("is_on_track", False),
        "current_lap_num": lap_info.get("current_lap_num", 0),
        "current_lap_invalid": lap_info.get("current_lap_invalid", False),
        "lap_distance": lap_info.get("lap_distance", 0.0),
        "current_lap_time_ms": lap_info.get("current_lap_time_ms", 0),
    }


@app.get("/api/telemetry/current")
async def get_current_telemetry():
    frame = pipeline.get_current_frame()
    if not frame:
        raise HTTPException(status_code=404, detail="No telemetry available")
    return frame


@app.get("/api/telemetry/buffer")
async def get_telemetry_buffer(limit: int = 100):
    frames = list(pipeline.frame_buffer)[-limit:]
    return {"frames": frames, "count": len(frames)}


class LightsUpdate(BaseModel):
    enabled: Optional[bool] = None
    brightness: Optional[int] = Field(None, ge=1, le=100)


@app.get("/api/lights")
async def get_lights():
    if not lights:
        return {"configured": False}
    return {"configured": True, "enabled": lights.enabled, "brightness": lights.brightness,
            "testing": lights.demo_running}


@app.post("/api/lights")
async def set_lights(body: LightsUpdate):
    if not lights:
        raise HTTPException(status_code=404, detail="Race lights not configured")
    lights.configure(enabled=body.enabled, brightness=body.brightness)
    return await get_lights()


@app.post("/api/lights/test")
async def test_lights():
    """Run every lamp phase, about a minute, unless the game is live."""
    if not lights:
        raise HTTPException(status_code=404, detail="Race lights not configured")
    refused = lights.start_demo()
    if refused:
        raise HTTPException(status_code=409, detail=f"Can't test the lights: {refused}")
    return await get_lights()


def _recording_status() -> Dict[str, Any]:
    return {**recorder.status(), "recording": pipeline.is_recording}


@app.get("/api/recording/status")
async def get_recording_status():
    return _recording_status()


def _save_recording_state(recording: bool) -> None:
    """Recording is a server-side switch; remember it across restarts."""
    try:
        with open(settings.RECORDING_STATE_FILE, "w") as f:
            json.dump({"recording": recording}, f)
    except OSError as e:
        logger.warning(f"Could not save recording state to {settings.RECORDING_STATE_FILE}: {e}")


def _load_recording_state() -> bool:
    try:
        with open(settings.RECORDING_STATE_FILE) as f:
            return bool(json.load(f).get("recording"))
    except (OSError, ValueError):
        return False


@app.post("/api/recording/start")
async def start_recording():
    pipeline.start_recording()
    _save_recording_state(True)
    return _recording_status()


@app.post("/api/recording/stop")
async def stop_recording():
    pipeline.stop_recording()
    _save_recording_state(False)
    return _recording_status()


# ============================================================================
# CSV IMPORT / EXPORT ENDPOINTS
# ============================================================================

@app.post("/api/import/validate")
async def validate_csv_upload(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Validate a CSV file before import."""
    try:
        content = await file.read()
        text = content.decode("utf-8")
        service = CSVImportService(db)
        result = await service.validate_upload(text)
        return result
    except Exception as e:
        logger.error(f"Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/import/csv")
async def import_csv(
    file: UploadFile = File(...),
    session_name: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Import a CSV telemetry file. Returns the imported session."""
    try:
        content = await file.read()
        text = content.decode("utf-8")
        service = CSVImportService(db)
        
        # Collect final result from generator
        final_result = None
        async for update in service.import_csv(text, file.filename, session_name):
            final_result = update
        
        if final_result and final_result.get("status") == "error":
            raise HTTPException(status_code=400, detail=final_result.get("message", "Import failed"))
        
        return final_result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Import error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/import/sessions")
async def get_imported_sessions(db: AsyncSession = Depends(get_db)):
    """Get all imported sessions."""
    service = CSVImportService(db)
    sessions = await service.get_sessions()
    return {"sessions": sessions}


@app.get("/api/import/sessions/{session_id}")
async def get_imported_session(session_id: str, db: AsyncSession = Depends(get_db)):
    """Get a single imported session with laps."""
    service = CSVImportService(db)
    session = await service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


class SessionRename(BaseModel):
    name: str = Field(min_length=1, max_length=80)


@app.patch("/api/import/sessions/{session_id}")
async def rename_imported_session(
    session_id: str, body: SessionRename, db: AsyncSession = Depends(get_db)
):
    """Rename an imported or live session."""
    service = CSVImportService(db)
    session = await service.rename_session(session_id, body.name)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.get("/api/import/sessions/{session_id}/telemetry")
async def get_session_telemetry(
    session_id: str,
    lap_numbers: Optional[List[int]] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Get telemetry samples for a session."""
    service = CSVImportService(db)
    data = await service.get_session_telemetry(session_id, lap_numbers)
    if not data:
        raise HTTPException(status_code=404, detail="Session not found")
    return data


class LapNicknameUpdate(BaseModel):
    nickname: str = Field(max_length=40)


@app.patch("/api/import/laps/{lap_id}")
async def set_lap_nickname(lap_id: str, body: LapNicknameUpdate, db: AsyncSession = Depends(get_db)):
    """Set a lap's nickname; an empty string clears it. Returns the lap."""
    service = CSVImportService(db)
    lap = await service.set_lap_nickname(lap_id, body.nickname)
    if not lap:
        raise HTTPException(status_code=404, detail="Lap not found")
    return lap


@app.get("/api/import/laps/{lap_id}/telemetry")
async def get_lap_telemetry(lap_id: str, db: AsyncSession = Depends(get_db)):
    """Get telemetry samples for a specific lap."""
    service = CSVImportService(db)
    samples = await service.get_lap_telemetry(lap_id)
    return {"lap_id": lap_id, "samples": samples, "count": len(samples)}


@app.get("/api/import/laps/{lap_id}/resampled")
async def get_lap_resampled(lap_id: str, db: AsyncSession = Depends(get_db)):
    """Get resampled (fixed-distance grid) telemetry for a specific lap."""
    service = CSVImportService(db)
    samples = await service.get_lap_resampled(lap_id)
    if samples is None:
        raise HTTPException(status_code=404, detail="Lap not found or not resampled")
    return {"lap_id": lap_id, "samples": samples, "count": len(samples)}


@app.delete("/api/import/sessions/{session_id}")
async def delete_imported_session(session_id: str, db: AsyncSession = Depends(get_db)):
    """Delete an imported session."""
    service = CSVImportService(db)
    success = await service.delete_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "deleted", "session_id": session_id}


@app.get("/api/import/sessions/{session_id}/export")
async def export_session_csv(
    session_id: str,
    lap_numbers: Optional[List[int]] = Query(None),
    format: str = "csv",
    db: AsyncSession = Depends(get_db),
):
    """Export session telemetry to CSV."""
    service = CSVImportService(db)
    
    if format == "csv":
        csv_data = await service.export_session_csv(session_id, lap_numbers)
        if not csv_data:
            raise HTTPException(status_code=404, detail="Session not found")
        
        return PlainTextResponse(
            content=csv_data,
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=session_{session_id}.csv"}
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {format}")


# ============================================================================
# TRACK NICKNAMES
# ============================================================================

class TrackAliasUpdate(BaseModel):
    nickname: str = Field(max_length=80)


@app.get("/api/tracks/aliases")
async def get_track_aliases(db: AsyncSession = Depends(get_db)):
    """Every track nickname as {track_id: nickname}."""
    return {"aliases": await TrackAliasService(db).get_aliases()}


@app.put("/api/tracks/{track_id}/alias")
async def set_track_alias(track_id: str, body: TrackAliasUpdate, db: AsyncSession = Depends(get_db)):
    """Set a track nickname; an empty string removes it. Returns the full map."""
    return {"aliases": await TrackAliasService(db).set_alias(track_id, body.nickname.strip())}


@app.get("/api/tracks/sectors")
async def get_track_sectors(db: AsyncSession = Depends(get_db)):
    """Learned track geometry per track_id: {"sectors": [s1_m, s2_m], "drs_zones": [{start, end}]},
    null where unknown."""
    stored = await TrackSectorsService(db).get_all()
    return {"sectors": {
        str(track_id): {"sectors": list(row["sectors"]), "drs_zones": row["drs_zones"]}
        for track_id, row in stored.items()
    }}


# ============================================================================
# WEBSOCKET
# ============================================================================
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            message = await websocket.receive_text()
            try:
                data = json.loads(message)
                action = data.get("action")
                
                if action == "subscribe":
                    channel = data.get("channel", "live")
                    await manager.subscribe(websocket, channel)
                    await websocket.send_json({"type": "subscribed", "channel": channel})
                    
                elif action == "unsubscribe":
                    channel = data.get("channel", "live")
                    await manager.unsubscribe(websocket, channel)
                    
                elif action == "get_session":
                    await websocket.send_json({
                        "type": "session",
                        "data": pipeline.get_session_summary()
                    })
                    
                else:
                    await websocket.send_json({"type": "error", "message": "Unknown action"})
                    
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await manager.disconnect(websocket)
