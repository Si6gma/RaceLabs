import { memo, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import type { TelemetryPoint } from '@/utils/telemetryAdapter';
import { Activity, Lock, Unlock } from 'lucide-react';

const TIME_WINDOW_SECONDS = 30;
const PAD = { top: 6, right: 72, bottom: 26, left: 46, gap: 4 };

interface StripDef {
  key: keyof TelemetryPoint;
  label: string;
  color: string;
  min: number;
  max: number;
  unit: string;
  transform?: (v: number) => number;
  decimals: number;
}

const STRIPS: StripDef[] = [
  { key: 'speed_kmh', label: 'SPEED', color: '#60a5fa', min: 0, max: 350, unit: 'km/h', decimals: 0 },
  { key: 'rpm', label: 'RPM', color: '#c084fc', min: 0, max: 15000, unit: '', decimals: 0 },
  { key: 'throttle', label: 'THROTTLE', color: '#4ade80', min: 0, max: 1, unit: '%', transform: v => v * 100, decimals: 0 },
  { key: 'brake', label: 'BRAKE', color: '#f87171', min: 0, max: 1, unit: '%', transform: v => v * 100, decimals: 0 },
];

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

function findClosestSample(data: TelemetryPoint[], targetTime: number): TelemetryPoint | null {
  if (data.length === 0) return null;
  let closest = data[0];
  let minDiff = Infinity;
  for (const pt of data) {
    const diff = Math.abs((pt.timestamp ?? 0) - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      closest = pt;
    }
  }
  return closest;
}

function LiveTelemetryGraph() {
  const currentFrame = useTelemetryStore(s => s.currentFrame);

  const bufferRef = useRef<TelemetryPoint[]>([]);
  const lastLapTimeRef = useRef<number | undefined>(undefined);

  const [data, setData] = useState<TelemetryPoint[]>([]);
  const [cursorLocked, setCursorLocked] = useState(false);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [hoverPosition, setHoverPosition] = useState(0);
  const hoverPositionRef = useRef(0);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [zoomRange, setZoomRange] = useState<[number, number]>([0, 1]);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDragging = useRef(false);
  const hasDragged = useRef(false);
  const dragStartX = useRef(0);
  const dragStartZoom = useRef<[number, number]>([0, 1]);

  const drawRef = useRef<() => void>(() => {});

  // Accumulate frames into rolling buffer
  useEffect(() => {
    if (!currentFrame) return;
    const lapTime = currentFrame.lap?.current_lap_time_ms;
    if (lapTime !== undefined && lapTime === lastLapTimeRef.current) return;
    lastLapTimeRef.current = lapTime;
    const point = frameToPoint(currentFrame);
    if (!point) return;
    bufferRef.current.push(point);
  }, [currentFrame]);

  // Sync buffer → state at ~30fps, prune old points
  useEffect(() => {
    const id = setInterval(() => {
      const buf = bufferRef.current;
      if (buf.length < 2) return;
      const now = performance.now() / 1000;
      const cutoff = now - TIME_WINDOW_SECONDS;
      while (buf.length > 0 && (buf[0].timestamp ?? 0) < cutoff) {
        buf.shift();
      }
      setData([...buf]);
    }, 33);
    return () => clearInterval(id);
  }, []);

  const effectivePosition = cursorLocked ? currentPosition : hoverPosition;

  const getPositionFromX = useCallback((clientX: number): number => {
    const container = containerRef.current;
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    const graphWidth = rect.width - PAD.left - PAD.right;
    const [zStart, zEnd] = zoomRange;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left - PAD.left) / graphWidth));
    return zStart + ratio * (zEnd - zStart);
  }, [zoomRange]);

  // Wheel zoom
  const graphWheelRef = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    graphWheelRef.current = (e: WheelEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const graphWidth = rect.width - PAD.left - PAD.right;
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left - PAD.left) / graphWidth));
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
    const el = containerRef.current;
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

  // Throttle hover via rAF
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
      const container = containerRef.current;
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
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const graphWidth = rect.width - PAD.left - PAD.right;
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

  // ── Canvas drawing ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function draw() {
      const ctx = canvas!.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas!.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      canvas!.width = rect.width * dpr;
      canvas!.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const width = rect.width;
      const height = rect.height;
      const graphWidth = width - PAD.left - PAD.right;
      const stripsTotalH = height - PAD.top - PAD.bottom - (STRIPS.length - 1) * PAD.gap;
      const stripH = stripsTotalH / STRIPS.length;

      ctx.clearRect(0, 0, width, height);

      // Time domain
      const now = performance.now() / 1000;
      const timeMax = now;
      const timeMin = timeMax - TIME_WINDOW_SECONDS;
      const timeSpan = Math.max(1e-9, TIME_WINDOW_SECONDS);

      const [zStart, zEnd] = zoomRange;
      const posSpan = Math.max(1e-9, zEnd - zStart);
      const xScale = graphWidth / posSpan;

      const samples = data;

      // Find visible sample range
      let startI = 0;
      let endI = samples.length - 1;
      for (let i = 0; i < samples.length; i++) {
        const xNorm = ((samples[i].timestamp ?? timeMin) - timeMin) / timeSpan;
        if (xNorm >= zStart) { startI = Math.max(0, i - 1); break; }
      }
      for (let i = samples.length - 1; i >= 0; i--) {
        const xNorm = ((samples[i].timestamp ?? timeMin) - timeMin) / timeSpan;
        if (xNorm <= zEnd) { endI = Math.min(samples.length - 1, i + 1); break; }
      }

      // Draw each strip
      STRIPS.forEach((strip, si) => {
        const stripTop = PAD.top + si * (stripH + PAD.gap);
        const stripBottom = stripTop + stripH;

        // Background
        ctx.fillStyle = '#060A0F';
        ctx.fillRect(PAD.left, stripTop, graphWidth, stripH);

        // Border
        ctx.strokeStyle = '#1A2840';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(PAD.left, stripTop, graphWidth, stripH);

        // Horizontal gridlines
        ctx.strokeStyle = '#1A2840';
        ctx.lineWidth = 0.5;
        for (let g = 0; g <= 4; g++) {
          const y = stripBottom - (g / 4) * stripH;
          ctx.beginPath();
          ctx.moveTo(PAD.left, y);
          ctx.lineTo(width - PAD.right, y);
          ctx.stroke();
        }

        // Trace
        if (samples.length >= 2) {
          const pts: [number, number][] = [];
          for (let i = startI; i <= endI; i++) {
            const s = samples[i];
            const rawVal = s[strip.key] as number;
            const val = strip.transform ? strip.transform(rawVal) : rawVal;
            const xNorm = ((s.timestamp ?? timeMin) - timeMin) / timeSpan;
            const x = PAD.left + (xNorm - zStart) * xScale;
            const normalized = (val - strip.min) / (strip.max - strip.min);
            const y = stripBottom - normalized * stripH;
            pts.push([x, y]);
          }

          ctx.strokeStyle = strip.color;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          if (pts.length >= 2) {
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 0; i < pts.length - 1; i++) {
              const p0 = pts[Math.max(0, i - 1)];
              const p1 = pts[i];
              const p2 = pts[i + 1];
              const p3 = pts[Math.min(pts.length - 1, i + 2)];
              const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
              const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
              const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
              const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
              ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
            }
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        // Y-axis labels (left)
        ctx.fillStyle = '#64748b';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(strip.max.toString(), PAD.left - 5, stripTop + 10);
        ctx.fillText(((strip.max + strip.min) / 2).toString(), PAD.left - 5, stripTop + stripH / 2 + 3);
        ctx.fillText(strip.min.toString(), PAD.left - 5, stripBottom - 3);

        // Label + current value (right)
        ctx.textAlign = 'left';
        ctx.fillStyle = strip.color;
        ctx.font = '9px monospace';
        ctx.fillText(strip.label, width - PAD.right + 6, stripTop + 10);

        const latest = samples[samples.length - 1];
        if (latest) {
          const raw = latest[strip.key] as number;
          const val = strip.transform ? strip.transform(raw) : raw;
          ctx.font = 'bold 11px monospace';
          ctx.fillText(`${val.toFixed(strip.decimals)}${strip.unit}`, width - PAD.right + 6, stripTop + 24);
        }
      });

      // X-axis labels (bottom)
      ctx.fillStyle = '#475569';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      const numTicks = 6;
      for (let t = 0; t <= numTicks; t++) {
        const x = PAD.left + (t / numTicks) * graphWidth;
        const targetPos = zStart + (t / numTicks) * posSpan;
        const targetTime = timeMin + targetPos * timeSpan;
        const rel = targetTime - timeMax;
        const label = `${rel.toFixed(0)}s`;
        ctx.fillText(label, x, height - 8);
      }

      // Synchronized cursor line (all strips)
      if (effectivePosition >= zStart && effectivePosition <= zEnd) {
        const x = PAD.left + (effectivePosition - zStart) / posSpan * graphWidth;
        ctx.strokeStyle = cursorLocked ? '#fff' : 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash(cursorLocked ? [4, 4] : [2, 6]);
        ctx.beginPath();
        ctx.moveTo(x, PAD.top);
        ctx.lineTo(x, height - PAD.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    drawRef.current = draw;
    draw();
  }, [data, zoomRange, effectivePosition, cursorLocked]);

  // Persistent rAF loop
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      drawRef.current();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Sample at cursor for tooltip
  const currentSample = useMemo(() => {
    if (data.length === 0 || hoverPos == null) return null;
    const now = performance.now() / 1000;
    const timeMax = now;
    const timeMin = timeMax - TIME_WINDOW_SECONDS;
    const timeSpan = Math.max(1e-9, TIME_WINDOW_SECONDS);
    const targetTime = timeMin + effectivePosition * timeSpan;
    return findClosestSample(data, targetTime);
  }, [data, effectivePosition, zoomRange, hoverPos]);

  return (
    <div className="telemetry-panel flex-1 min-h-0 flex flex-col">
      {/* Header */}
      <div className="panel-header justify-between">
        <span className="eng-label font-bold">Live Telemetry</span>
        <div className="flex items-center gap-2">
          {STRIPS.map(s => (
            <div key={s.key} className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide border" style={{ backgroundColor: `${s.color}10`, color: s.color, borderColor: `${s.color}30` }}>
              <Activity className="w-2.5 h-2.5" />
              {s.label}
            </div>
          ))}
          <div className={`flex items-center gap-1 px-2 py-0.5 border text-[10px] font-semibold uppercase tracking-wide ${cursorLocked ? 'text-motorsport-orange border-motorsport-orange/30 bg-motorsport-orange/10' : 'text-motorsport-muted border-motorsport-border'}`}>
            {cursorLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
            {cursorLocked ? 'Locked' : 'Live'}
          </div>
        </div>
      </div>

      {/* Graph area */}
      <div
        ref={containerRef}
        className="flex-1 relative min-h-0 cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        {data.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[11px] text-motorsport-dim">Waiting for live data…</span>
          </div>
        ) : (
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
        )}

        {currentSample && hoverPos && (
          <StackedTooltip sample={currentSample} x={hoverPos.x} y={hoverPos.y} />
        )}
      </div>
    </div>
  );
}

export default memo(LiveTelemetryGraph);

// ── Tooltip ──

interface TooltipProps {
  sample: TelemetryPoint;
  x: number;
  y: number;
}

function StackedTooltip({ sample, x, y }: TooltipProps) {
  const TOOLTIP_W = 150;
  const OFFSET = 14;
  const left = x + OFFSET + TOOLTIP_W > (typeof window !== 'undefined' ? window.innerWidth : 1200)
    ? x - OFFSET - TOOLTIP_W
    : x + OFFSET;
  const top = Math.max(4, y - 40);

  const ts = sample.timestamp;
  const relTime = ts != null ? `${(-(performance.now() / 1000 - ts)).toFixed(1)}s` : '';

  return (
    <div
      className="absolute pointer-events-none z-20 rounded border border-motorsport-border bg-motorsport-charcoal/95 backdrop-blur-sm shadow-panel-lg px-3 py-2 min-w-[140px]"
      style={{ left, top }}
    >
      <div className="text-[10px] text-motorsport-muted mb-2 border-b border-motorsport-border pb-1">
        <span className="font-telemetry">{relTime || '—'}</span>
      </div>
      <div className="space-y-1">
        {STRIPS.map(strip => {
          const raw = sample[strip.key] as number;
          const val = strip.transform ? strip.transform(raw) : raw;
          return (
            <div key={strip.key} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: strip.color }} />
                <span className="text-[10px] text-motorsport-muted">{strip.label}</span>
              </div>
              <span className="font-telemetry text-[11px] tabular-nums" style={{ color: strip.color }}>
                {val.toFixed(strip.decimals)}{strip.unit}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
