"""
Telemetry Suite - Main FastAPI Application
"""
import asyncio
import logging
import json
from contextlib import asynccontextmanager
from typing import Dict, Any, List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, PlainTextResponse

from app.config import get_settings
from app.database import init_db, get_db
from app.websocket import manager
from app.telemetry import pipeline
from app.udp_receiver import receiver
from app.csv_import_service import CSVImportService
from sqlalchemy.ext.asyncio import AsyncSession

settings = get_settings()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


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
    
    udp_task = asyncio.create_task(receiver.start(udp_handler))
    
    yield
    
    receiver.stop()
    udp_task.cancel()
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


# ============================================================================
# LIVE TELEMETRY ENDPOINTS
# ============================================================================

@app.get("/api/session")
async def get_session():
    return pipeline.get_session_summary()


@app.get("/api/session/laps")
async def get_laps():
    laps = pipeline.get_all_laps()
    summary = {}
    for lap_num, frames in laps.items():
        if not frames:
            continue
        last_frame = frames[-1]
        lap_data = last_frame.get("lap", {})
        summary[lap_num] = {
            "lap_number": lap_num,
            "lap_time_ms": lap_data.get("last_lap_time_ms", 0),
            "sector1_ms": lap_data.get("sector1_time_ms", 0),
            "sector2_ms": lap_data.get("sector2_time_ms", 0),
            "valid": not any(f.get("lap", {}).get("current_lap_invalid", False) for f in frames),
            "frame_count": len(frames),
        }
    return summary


@app.get("/api/session/laps/{lap_number}")
async def get_lap_data(lap_number: int):
    data = pipeline.get_lap_data(lap_number)
    if not data:
        raise HTTPException(status_code=404, detail="Lap not found")
    return {"lap_number": lap_number, "frames": data}


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


@app.post("/api/replay/start")
async def start_replay(lap_number: int, speed: float = 1.0):
    data = pipeline.get_lap_data(lap_number)
    if not data:
        raise HTTPException(status_code=404, detail="Lap not found")
    pipeline.start_replay(data, speed)
    return {"status": "started", "lap_number": lap_number, "frame_count": len(data)}


@app.post("/api/replay/stop")
async def stop_replay():
    pipeline.stop_replay()
    return {"status": "stopped"}


# ============================================================================
# SESSION ENDPOINTS
# ============================================================================

@app.get("/api/sessions")
async def get_sessions():
    return {"sessions": pipeline.get_all_sessions()}


@app.get("/api/sessions/{session_id}/export")
async def export_session(session_id: str):
    data = pipeline.get_session_data(session_id)
    if not data:
        raise HTTPException(status_code=404, detail="Session not found")
    return data


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


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    if pipeline.clear_session(session_id):
        return {"status": "deleted", "session_id": session_id}
    raise HTTPException(status_code=404, detail="Session not found")


@app.post("/api/sessions/{session_id}/replay")
async def replay_session(session_id: str, lap_number: Optional[int] = None):
    data = pipeline.get_session_data(session_id)
    if not data:
        raise HTTPException(status_code=404, detail="Session not found")
    laps = data.get("laps", {})
    if not laps:
        raise HTTPException(status_code=400, detail="No laps in session")
    # If no lap specified, pick best lap or last lap
    target_lap = lap_number
    if target_lap is None:
        best = None
        best_time = float('inf')
        for num, lap in laps.items():
            if lap.get("best_lap_time") and lap["best_lap_time"] < best_time:
                best_time = lap["best_lap_time"]
                best = num
        target_lap = best if best is not None else max(laps.keys())
    lap_data = pipeline.get_lap_data(target_lap)
    if not lap_data:
        raise HTTPException(status_code=404, detail="Lap not found")
    pipeline.start_replay(lap_data, 1.0)
    return {"status": "started", "session_id": session_id, "lap_number": target_lap}


@app.get("/api/import/laps/{lap_id}/telemetry")
async def get_lap_telemetry(lap_id: str, db: AsyncSession = Depends(get_db)):
    """Get telemetry samples for a specific lap."""
    service = CSVImportService(db)
    samples = await service.get_lap_telemetry(lap_id)
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
                    
                elif action == "get_laps":
                    laps = pipeline.get_all_laps()
                    await websocket.send_json({
                        "type": "laps",
                        "data": {k: len(v) for k, v in laps.items()}
                    })
                    
                elif action == "start_replay":
                    lap_num = data.get("lap_number")
                    speed = data.get("speed", 1.0)
                    lap_data = pipeline.get_lap_data(lap_num)
                    if lap_data:
                        pipeline.start_replay(lap_data, speed)
                        await websocket.send_json({
                            "type": "replay_started",
                            "lap_number": lap_num,
                            "frame_count": len(lap_data)
                        })
                        
                elif action == "stop_replay":
                    pipeline.stop_replay()
                    await websocket.send_json({"type": "replay_stopped"})
                    
                else:
                    await websocket.send_json({"type": "error", "message": "Unknown action"})
                    
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await manager.disconnect(websocket)
