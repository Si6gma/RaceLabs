import { memo, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import TelemetryGraphCanvas, { CHANNELS } from '@/components/TelemetryGraphCanvas';
import ZoomRangeBar from '@/components/ZoomRangeBar';
import type { TelemetryPoint } from '@/utils/telemetryAdapter';
import { Activity, SlidersHorizontal, Lock, Unlock } from 'lucide-react';

const LIVE_DEFAULT_CHANNELS = new Set(['speed_kmh', 'throttle', 'brake', 'rpm']);
const TIME_WINDOW_SECONDS = 30;
const PAD_L = 50;
const PAD_R = 60;

function frameToPoint(frame: any): TelemetryPoint | null {
  const telem = frame.telemetry;
  const motion = frame.motion;
  const lap = frame.lap;
  if (!telem) return null;

  const trackLength = frame.session?.track_length ?? 0;
  const lapDistance = lap?.lap_distance ?? 0;

  return {
    speed_kmh: telem.speed ?? 0,
    throttle: telem.throttle ?? 0,
    brake: telem.brake ?? 0,
    steering: telem.steer ?? 0,
    gear: telem.gear ?? 0,
    rpm: telem.engine_rpm ?? 0,
    gforce_lat: motion?.g_force_lat ?? 0,
    delta_time: 0,
    world_position_x: motion?.world_pos_x ?? 0,
    world_position_y: motion?.world_pos_z ?? 0,
    world_position_z: motion?.world_pos_y ?? 0,
    normalized_track_position: trackLength > 0 ? lapDistance / trackLength : 0,
    lap_time: lap?.current_lap_time_ms != null ? lap.current_lap_time_ms / 1000 : undefined,
    sector: lap?.sector ?? 0,
    cumulative_distance: lapDistance,
    timestamp: performance.now() / 1000,
  };
}

function LiveTelemetryGraph() {
  const currentFrame = useTelemetryStore(s => s.currentFrame);

  const bufferRef = useRef<TelemetryPoint[]>([]);
  const lastLapTimeRef = useRef<number | undefined>(undefined);

  const [lapData, setLapData] = useState<TelemetryPoint[]>([]);
  const [visibleChannels, setVisibleChannels] = useState<Set<string>>(LIVE_DEFAULT_CHANNELS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [cursorLocked, setCursorLocked] = useState(false);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [hoverPosition, setHoverPosition] = useState(0);
  const hoverPositionRef = useRef(0);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [zoomRange, setZoomRange] = useState<[number, number]>([0, 1]);

  const graphContainerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const hasDragged = useRef(false);
  const dragStartX = useRef(0);
  const dragStartZoom = useRef<[number, number]>([0, 1]);

  // Accumulate frames into a rolling time-based buffer
  useEffect(() => {
    if (!currentFrame) return;

    const lapTime = currentFrame.lap?.current_lap_time_ms;
    if (lapTime !== undefined && lapTime === lastLapTimeRef.current) return;
    lastLapTimeRef.current = lapTime;

    const point = frameToPoint(currentFrame);
    if (!point) return;

    bufferRef.current.push(point);
  }, [currentFrame]);

  // Sync buffer → state at ~30fps, keeping only the last 30 seconds
  useEffect(() => {
    const id = setInterval(() => {
      const buf = bufferRef.current;
      if (buf.length < 2) return;

      const now = performance.now() / 1000;
      const cutoff = now - TIME_WINDOW_SECONDS;
      // Drop old points
      while (buf.length > 0 && (buf[0].timestamp ?? 0) < cutoff) {
        buf.shift();
      }

      setLapData([...buf]);
    }, 33);
    return () => clearInterval(id);
  }, []);

  const effectivePosition = cursorLocked ? currentPosition : hoverPosition;

  const currentSample = lapData.length > 0
    ? lapData[Math.max(0, Math.min(lapData.length - 1, Math.round(effectivePosition * (lapData.length - 1))))]
    : null;

  const getPositionFromX = useCallback((clientX: number): number => {
    const container = graphContainerRef.current;
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    const graphWidth = rect.width - PAD_L - PAD_R;
    const [zStart, zEnd] = zoomRange;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left - PAD_L) / graphWidth));
    return zStart + ratio * (zEnd - zStart);
  }, [zoomRange]);

  // Non-passive wheel zoom
  const graphWheelRef = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    graphWheelRef.current = (e: WheelEvent) => {
      e.preventDefault();
      const container = graphContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const graphWidth = rect.width - PAD_L - PAD_R;
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left - PAD_L) / graphWidth));
      const [zStart, zEnd] = zoomRange;
      const zoomSpan = zEnd - zStart;
      const factor = e.deltaY < 0 ? 0.85 : 1.15;
      let newSpan = Math.max(0.005, Math.min(1, zoomSpan * factor));
      const center = zStart + ratio * zoomSpan;
      let ns = center - ratio * newSpan;
      let ne = ns + newSpan;
      if (ns < 0) { ns = 0; ne = newSpan; }
      if (ne > 1) { ne = 1; ns = Math.max(0, 1 - newSpan); }
      setZoomRange([ns, ne]);
    };
  }, [zoomRange]);

  useEffect(() => {
    const el = graphContainerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => graphWheelRef.current(e);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    hasDragged.current = false;
    dragStartX.current = e.clientX;
    dragStartZoom.current = [...zoomRange] as [number, number];
  }, [zoomRange]);

  // Throttle hover state updates to ~30fps via rAF to avoid React re-render thrashing.
  const rafHoverRef = useRef<number>(0);
  const pendingHoverRef = useRef<{ pos: number; x: number; y: number } | null>(null);

  const flushHover = useCallback(() => {
    const pending = pendingHoverRef.current;
    if (!pending) return;
    pendingHoverRef.current = null;
    hoverPositionRef.current = pending.pos;
    setHoverPosition(pending.pos);
    setHoverPos({ x: pending.x, y: pending.y });
  }, []);

  const scheduleHoverUpdate = useCallback((pos: number, x: number, y: number) => {
    pendingHoverRef.current = { pos, x, y };
    if (!rafHoverRef.current) {
      rafHoverRef.current = requestAnimationFrame(() => {
        rafHoverRef.current = 0;
        flushHover();
      });
    }
  }, [flushHover]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) {
      const pos = getPositionFromX(e.clientX);
      const container = graphContainerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        scheduleHoverUpdate(pos, e.clientX - rect.left, e.clientY - rect.top);
      } else {
        scheduleHoverUpdate(pos, 0, 0);
      }
      return;
    }
    const dx = Math.abs(e.clientX - dragStartX.current);
    if (dx > 4) hasDragged.current = true;
    const container = graphContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const graphWidth = rect.width - PAD_L - PAD_R;
    const [ds, de] = dragStartZoom.current;
    const span = de - ds;
    const shift = -(dx * Math.sign(e.clientX - dragStartX.current) / graphWidth) * span;
    let ns = ds + shift;
    let ne = de + shift;
    if (ns < 0) { ns = 0; ne = span; }
    if (ne > 1) { ne = 1; ns = Math.max(0, 1 - span); }
    setZoomRange([ns, ne]);
  }, [getPositionFromX, scheduleHoverUpdate]);

  const handleMouseUp = useCallback(() => {
    if (isDragging.current && !hasDragged.current) {
      if (cursorLocked) {
        setCursorLocked(false);
      } else {
        setCurrentPosition(hoverPositionRef.current);
        setCursorLocked(true);
      }
    }
    isDragging.current = false;
  }, [cursorLocked]);

  const handleMouseLeave = useCallback(() => {
    isDragging.current = false;
    if (rafHoverRef.current) {
      cancelAnimationFrame(rafHoverRef.current);
      rafHoverRef.current = 0;
    }
    if (!cursorLocked) setHoverPos(null);
  }, [cursorLocked]);

  const toggleChannel = (key: string) => {
    setVisibleChannels(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const laps = useMemo(() => lapData.length > 0 ? [{ data: lapData, color: '#60a5fa' }] : [], [lapData]);

  return (
    <div className="telemetry-panel flex-1 min-h-0 flex flex-col">
      {/* Controls bar */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-motorsport-border shrink-0">
        <span className="telemetry-label mr-1">Live Graph</span>

        {CHANNELS.filter(c => visibleChannels.has(c.key as string)).map(ch => (
          <button
            key={ch.key}
            onClick={() => toggleChannel(ch.key as string)}
            className="flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] transition-colors"
            style={{ backgroundColor: `${ch.color}20`, color: ch.color }}
          >
            <Activity className="w-3 h-3" />
            {ch.label}
          </button>
        ))}

        <div className="relative ml-auto">
          <button
            onClick={() => setFilterOpen(!filterOpen)}
            className={`flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] transition-colors ${
              filterOpen ? 'bg-motorsport-orange/20 text-motorsport-orange' : 'text-motorsport-muted hover:bg-motorsport-surface'
            }`}
          >
            <SlidersHorizontal className="w-3 h-3" />
            Channels
          </button>
          {filterOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setFilterOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-motorsport-charcoal border border-motorsport-border rounded-sm shadow-lg p-2">
                <div className="flex items-center justify-between mb-2 pb-1 border-b border-motorsport-border">
                  <span className="text-[10px] font-semibold text-motorsport-muted uppercase">Channels</span>
                  <div className="flex gap-1">
                    <button onClick={() => setVisibleChannels(new Set(CHANNELS.map(c => c.key as string)))} className="text-[9px] text-motorsport-blue hover:underline">All</button>
                    <button onClick={() => setVisibleChannels(new Set())} className="text-[9px] text-motorsport-muted hover:underline">None</button>
                  </div>
                </div>
                <div className="space-y-1">
                  {CHANNELS.map(ch => (
                    <label key={ch.key} className="flex items-center gap-2 px-1 py-1 rounded-sm hover:bg-motorsport-surface/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={visibleChannels.has(ch.key as string)}
                        onChange={() => toggleChannel(ch.key as string)}
                        className="w-3 h-3 rounded-sm accent-motorsport-orange"
                      />
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: ch.color }} />
                      <span className="text-[11px] text-motorsport-text">{ch.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className={`flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] ${cursorLocked ? 'text-motorsport-orange' : 'text-motorsport-muted'}`}>
          {cursorLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
          {cursorLocked ? 'Locked' : 'Live'}
        </div>
      </div>

      {/* Graph area */}
      <div
        ref={graphContainerRef}
        className="flex-1 relative min-h-0"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        {lapData.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[11px] text-motorsport-dim">Waiting for live data…</span>
          </div>
        ) : (
          <TelemetryGraphCanvas
            laps={laps}
            visibleChannels={visibleChannels}
            zoomRange={zoomRange}
            effectivePosition={effectivePosition}
            cursorLocked={cursorLocked}
            xField="timestamp"
            timeWindow={TIME_WINDOW_SECONDS}
          />
        )}

        {currentSample && hoverPos && (
          <LiveTooltip
            sample={currentSample}
            visibleChannels={visibleChannels}
            x={hoverPos.x}
            y={hoverPos.y}
            containerRef={graphContainerRef}
          />
        )}
      </div>

      {lapData.length > 0 && (
        <ZoomRangeBar total={1} zoomRange={zoomRange} onZoomChange={setZoomRange} />
      )}
    </div>
  );
}

export default memo(LiveTelemetryGraph);

interface LiveTooltipProps {
  sample: TelemetryPoint;
  visibleChannels: Set<string>;
  x: number;
  y: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

function LiveTooltip({ sample, visibleChannels, x, y, containerRef }: LiveTooltipProps) {
  const TOOLTIP_W = 160;
  const TOOLTIP_H_EST = 200;
  const OFFSET = 14;
  const cw = containerRef.current?.clientWidth ?? 600;
  const ch = containerRef.current?.clientHeight ?? 400;
  const left = x + OFFSET + TOOLTIP_W > cw ? x - OFFSET - TOOLTIP_W : x + OFFSET;
  const top = Math.max(8, Math.min(ch - TOOLTIP_H_EST - 8, y - TOOLTIP_H_EST / 2));

  const ts = sample.timestamp;
  const relTime = ts != null ? `${(-(performance.now() / 1000 - ts)).toFixed(1)}s` : '';
  const headerLabel = relTime || (sample.lap_time != null ? `${sample.lap_time.toFixed(1)}s` : '');

  return (
    <div
      className="absolute pointer-events-none z-20 rounded border border-motorsport-border bg-motorsport-charcoal/95 backdrop-blur-sm shadow-panel-lg px-3 py-2.5 min-w-[140px]"
      style={{ left, top }}
    >
      <div className="text-[10px] text-motorsport-muted mb-2 border-b border-motorsport-border pb-1.5">
        <span className="font-telemetry">{headerLabel || '—'}</span>
      </div>
      <div className="space-y-1.5">
        {CHANNELS.filter(c => visibleChannels.has(c.key as string)).map(ch => {
          const raw = sample[ch.key] as number;
          const display = ch.transform ? ch.transform(raw) : raw;
          return (
            <div key={ch.key} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: ch.color }} />
                <span className="text-[10px] text-motorsport-muted">{ch.label}</span>
              </div>
              <span className="font-telemetry text-[11px] tabular-nums" style={{ color: ch.color }}>
                {display.toFixed(ch.decimals)}{ch.unit}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
