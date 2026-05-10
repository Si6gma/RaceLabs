"""
Telemetry Suite - Main FastAPI Application
"""
import asyncio
import logging
import json
from contextlib import asynccontextmanager
from typing import Dict, Any, List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import init_db
from app.websocket import manager
from app.telemetry import pipeline
from app.udp_receiver import receiver

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


@app.get("/health")
async def health():
    return {"status": "ok", "service": settings.APP_NAME}


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
