"""
UDP listener for F1 23/24 telemetry packets
"""
import asyncio
import logging
import time
from typing import Callable, Optional

logger = logging.getLogger(__name__)


class UDPReceiver:
    def __init__(self, port: int = 20777):
        self.port = port
        self.transport: Optional[asyncio.DatagramTransport] = None
        self.protocol: Optional[asyncio.DatagramProtocol] = None
        self._running = False
        self._packet_count = 0
        self._last_count_time = time.time()
        self._callback: Optional[Callable] = None
        
    class Protocol(asyncio.DatagramProtocol):
        def __init__(self, callback: Callable):
            self.callback = callback
            
        def datagram_received(self, data: bytes, addr):
            asyncio.create_task(self.callback(data))
            
        def error_received(self, exc):
            logger.error(f"UDP error: {exc}")
            
        def connection_lost(self, exc):
            logger.info("UDP connection lost")
            
    async def start(self, callback: Callable):
        self._callback = callback
        self._running = True
        
        loop = asyncio.get_event_loop()
        self.transport, self.protocol = await loop.create_datagram_endpoint(
            lambda: self.Protocol(callback),
            local_addr=("0.0.0.0", self.port),
            reuse_port=False
        )
        
        logger.info(f"UDP receiver started on port {self.port}")
        
        while self._running:
            await asyncio.sleep(5)
            now = time.time()
            elapsed = now - self._last_count_time
            rate = self._packet_count / elapsed if elapsed > 0 else 0
            logger.info(f"UDP packet rate: {rate:.1f} pkt/s (total: {self._packet_count})")
            self._packet_count = 0
            self._last_count_time = now
            
    def stop(self):
        self._running = False
        if self.transport:
            self.transport.close()
        logger.info("UDP receiver stopped")
        
    async def handle_packet(self, data: bytes):
        self._packet_count += 1
        if self._callback:
            await self._callback(data)


receiver = UDPReceiver()
