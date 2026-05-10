"""
WebSocket telemetry broadcaster
Manages client connections and streams telemetry data
"""
import asyncio
import json
import logging
from typing import Set, Dict, Any, Optional
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.subscriptions: Dict[str, Set[WebSocket]] = {
            "live": set(),
            "replay": set(),
            "session": set(),
        }
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        async with self._lock:
            self.active_connections.add(websocket)
        logger.info(f"Client connected. Total: {len(self.active_connections)}")

    async def disconnect(self, websocket: WebSocket):
        async with self._lock:
            self.active_connections.discard(websocket)
            for sub in self.subscriptions.values():
                sub.discard(websocket)
        logger.info(f"Client disconnected. Total: {len(self.active_connections)}")

    async def subscribe(self, websocket: WebSocket, channel: str):
        async with self._lock:
            if channel in self.subscriptions:
                self.subscriptions[channel].add(websocket)
        logger.info(f"Client subscribed to {channel}")

    async def unsubscribe(self, websocket: WebSocket, channel: str):
        async with self._lock:
            if channel in self.subscriptions:
                self.subscriptions[channel].discard(websocket)

    async def broadcast(self, message: Dict[str, Any], channel: Optional[str] = None):
        data = json.dumps(message, default=str)
        targets = self.subscriptions.get(channel, self.active_connections) if channel else self.active_connections
        
        disconnected = set()
        for connection in list(targets):
            try:
                await connection.send_text(data)
            except Exception:
                disconnected.add(connection)
        
        if disconnected:
            async with self._lock:
                for conn in disconnected:
                    self.active_connections.discard(conn)
                    for sub in self.subscriptions.values():
                        sub.discard(conn)

    async def broadcast_binary(self, data: bytes, channel: Optional[str] = None):
        targets = self.subscriptions.get(channel, self.active_connections) if channel else self.active_connections
        
        disconnected = set()
        for connection in list(targets):
            try:
                await connection.send_bytes(data)
            except Exception:
                disconnected.add(connection)
        
        if disconnected:
            async with self._lock:
                for conn in disconnected:
                    self.active_connections.discard(conn)
                    for sub in self.subscriptions.values():
                        sub.discard(conn)


manager = ConnectionManager()
