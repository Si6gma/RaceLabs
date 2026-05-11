import { useEffect, useRef, useCallback } from 'react';
import { decode } from '@msgpack/msgpack';
import { useTelemetryStore } from '@/stores/telemetryStore';

const WS_URL = import.meta.env.VITE_WS_URL || (import.meta.env.DEV
  ? 'ws://localhost:8000/ws'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`);

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const { setConnected, setConnecting, setCurrentFrame, setSession, setLaps, setReplayMode } = useTelemetryStore();

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    setConnecting(true);
    
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      
      ws.onopen = () => {
        setConnected(true);
        setConnecting(false);
        // Subscribe to live telemetry
        ws.send(JSON.stringify({ action: 'subscribe', channel: 'live' }));
      };
      
      ws.onmessage = async (event) => {
        try {
          let msg: Record<string, unknown>;
          if (event.data instanceof Blob) {
            const buf = await event.data.arrayBuffer();
            msg = decode(new Uint8Array(buf)) as Record<string, unknown>;
          } else {
            msg = JSON.parse(event.data as string);
          }

          if (msg.packet_id !== undefined) {
            setCurrentFrame(msg as unknown as Parameters<typeof setCurrentFrame>[0]);
          } else if (msg.type === 'session') {
            setSession(msg.data as unknown as Parameters<typeof setSession>[0]);
          } else if (msg.type === 'laps') {
            const laps: Record<number, { lap_number: number; lap_time_ms: number; sector1_ms: number; sector2_ms: number; valid: boolean; frame_count: number }> = {};
            for (const [k, v] of Object.entries(msg.data as Record<string, unknown>)) {
              laps[Number(k)] = { lap_number: Number(k), lap_time_ms: 0, sector1_ms: 0, sector2_ms: 0, valid: true, frame_count: v as number };
            }
            setLaps(laps);
          } else if (msg.type === 'replay_started') {
            setReplayMode(true);
          } else if (msg.type === 'replay_stopped') {
            setReplayMode(false);
          }
        } catch {
          // ignore malformed frames
        }
      };
      
      ws.onclose = () => {
        setConnected(false);
        setConnecting(false);
        wsRef.current = null;
        // Reconnect
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };
      
      ws.onerror = () => {
        ws.close();
      };
    } catch {
      setConnecting(false);
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    }
  }, [setConnected, setConnecting, setCurrentFrame, setSession, setLaps, setReplayMode]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
  }, [setConnected]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return { ws: wsRef.current, send, connect, disconnect };
}
