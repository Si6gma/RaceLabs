"""
UDP listener for F1 23/24 telemetry packets
Uses an asyncio Queue to batch-process packets and avoid task creation overhead.
"""
import asyncio
import logging
import time
from typing import Callable, Optional

logger = logging.getLogger(__name__)


class UDPReceiver:
    def __init__(self, port: int = 20777, queue_size: int = 2048):
        self.port = port
        self.transport: Optional[asyncio.DatagramTransport] = None
        self.protocol: Optional[asyncio.DatagramProtocol] = None
        self._running = False
        self._packet_count = 0
        self._last_count_time = time.time()
        self._callback: Optional[Callable] = None
        self._queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=queue_size)
        self._worker_task: Optional[asyncio.Task] = None
        
    class Protocol(asyncio.DatagramProtocol):
        __slots__ = ("queue",)
        
        def __init__(self, queue: asyncio.Queue):
            self.queue = queue
            
        def datagram_received(self, data: bytes, addr):
            # Non-blocking put; drop packets if queue is full (backpressure)
            try:
                self.queue.put_nowait(data)
            except asyncio.QueueFull:
                pass
            
        def error_received(self, exc):
            logger.error(f"UDP error: {exc}")
            
        def connection_lost(self, exc):
            logger.info("UDP connection lost")
    
    async def _worker(self, callback: Callable):
        """Consume packets from queue and process them."""
        queue = self._queue
        while self._running:
            try:
                data = await asyncio.wait_for(queue.get(), timeout=0.5)
                self._packet_count += 1
                await callback(data)
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.error(f"Packet processing error: {e}")
            
    async def start(self, callback: Callable):
        self._callback = callback
        self._running = True
        
        loop = asyncio.get_event_loop()
        self.transport, self.protocol = await loop.create_datagram_endpoint(
            lambda: self.Protocol(self._queue),
            local_addr=("0.0.0.0", self.port),
            reuse_port=False
        )
        
        # Start worker task
        self._worker_task = asyncio.create_task(self._worker(callback))
        
        logger.info(f"UDP receiver started on port {self.port}")
        
        while self._running:
            await asyncio.sleep(5)
            now = time.time()
            elapsed = now - self._last_count_time
            rate = self._packet_count / elapsed if elapsed > 0 else 0
            dropped = self._protocol and hasattr(self._protocol, '_drop_count') and self._protocol._drop_count or 0
            logger.info(f"UDP packet rate: {rate:.1f} pkt/s (total: {self._packet_count}, queue: {self._queue.qsize()})")
            self._packet_count = 0
            self._last_count_time = now
            
    def stop(self):
        self._running = False
        if self._worker_task:
            self._worker_task.cancel()
        if self.transport:
            self.transport.close()
        logger.info("UDP receiver stopped")
        
    async def handle_packet(self, data: bytes):
        self._packet_count += 1
        if self._callback:
            await self._callback(data)


receiver = UDPReceiver()
