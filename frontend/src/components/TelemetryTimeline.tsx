import { memo, useEffect, useRef } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';

interface DataPoint {
  dist:     number;
  speed:    number;
  throttle: number;
  brake:    number;
  gear:     number;
  steer:    number;
}

// Channels stacked inside a single canvas, same pattern as TelemetryGraphCanvas.
// scale + offset place each band within the total chart height.
const CHANNELS = [
  { key: 'speed'    as const, label: 'SPEED',    color: '#00E5FF', min: 0,  max: 350, scale: 0.25, offset: 0.00 },
  { key: 'throttle' as const, label: 'THROTTLE', color: '#00FF88', min: 0,  max: 100, scale: 0.17, offset: 0.28 },
  { key: 'brake'    as const, label: 'BRAKE',    color: '#FF3333', min: 0,  max: 100, scale: 0.17, offset: 0.28 },
  { key: 'gear'     as const, label: 'GEAR',     color: '#FFCC00', min: 0,  max: 9,   scale: 0.15, offset: 0.50 },
  { key: 'steer'    as const, label: 'STEER',    color: '#a855f7', min: -1, max: 1,   scale: 0.13, offset: 0.70 },
];

// Divider y-positions (as fractions of graphHeight) between bands
const DIVIDERS = [0.27, 0.49, 0.69];

const PAD = { top: 8, right: 64, bottom: 24, left: 36 };

function buildDataPoints(): DataPoint[] {
  const { frameHistory, currentFrame } = useTelemetryStore.getState();
  const currentLap = currentFrame?.lap?.current_lap_num;
  if (!frameHistory.length || currentLap == null) return [];

  const seen = new Set<number>();
  const out: DataPoint[] = [];
  for (const f of frameHistory) {
    if (f.lap?.current_lap_num !== currentLap) continue;
    if (f.lap.lap_distance == null || !f.telemetry) continue;
    const bucket = Math.round(f.lap.lap_distance / 5) * 5;
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    out.push({
      dist:     bucket,
      speed:    f.telemetry.speed,
      throttle: f.telemetry.throttle * 100,
      brake:    f.telemetry.brake    * 100,
      gear:     f.telemetry.gear,
      steer:    f.telemetry.steer,
    });
  }
  return out;
}

function draw(canvas: HTMLCanvasElement, data: DataPoint[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr  = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  canvas.width  = rect.width  * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;
  const gW = W - PAD.left - PAD.right;
  const gH = H - PAD.top  - PAD.bottom;

  // Background
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);

  // Horizontal dividers between bands
  ctx.strokeStyle = '#21303f';
  ctx.lineWidth   = 0.5;
  for (const frac of DIVIDERS) {
    const y = PAD.top + gH * frac;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + gW, y);
    ctx.stroke();
  }

  // Channel labels (right-side legend)
  const labeledKeys = new Set<string>();
  ctx.font      = '9px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  CHANNELS.forEach(ch => {
    if (labeledKeys.has(ch.label)) return;
    labeledKeys.add(ch.label);
    ctx.fillStyle = ch.color;
    const labelY = PAD.top + gH * ch.offset + 10;
    ctx.fillText(ch.label, PAD.left + gW + 4, labelY);
  });

  if (data.length < 2) {
    ctx.fillStyle = '#444c56';
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Waiting for lap data…', PAD.left + gW / 2, PAD.top + gH / 2);
    return;
  }

  const xMin   = data[0].dist;
  const xMax   = data[data.length - 1].dist;
  const xRange = Math.max(xMax - xMin, 1);
  const xScale = gW / xRange;

  const toX = (dist: number) => PAD.left + (dist - xMin) * xScale;
  const toY = (val: number, ch: typeof CHANNELS[number]) => {
    const norm = (val - ch.min) / (ch.max - ch.min);
    return PAD.top + gH * ch.offset + gH * ch.scale * (1 - norm);
  };

  // Draw each channel trace (cubic bezier, same as TelemetryGraphCanvas)
  for (const ch of CHANNELS) {
    ctx.strokeStyle  = ch.color;
    ctx.lineWidth    = ch.key === 'speed' ? 1.5 : 1;
    ctx.globalAlpha  = ch.key === 'throttle' || ch.key === 'brake' ? 0.75 : 0.9;
    ctx.lineJoin     = 'round';

    const pts: [number, number][] = data.map(p => [toX(p.dist), toY(p[ch.key], ch)]);

    ctx.beginPath();
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
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // X-axis distance labels
  ctx.fillStyle     = '#444c56';
  ctx.font          = '9px "JetBrains Mono", monospace';
  ctx.textAlign     = 'center';
  ctx.textBaseline  = 'alphabetic';
  const ticks = 6;
  for (let i = 0; i <= ticks; i++) {
    const dist = xMin + (i / ticks) * xRange;
    const x    = PAD.left + (i / ticks) * gW;
    ctx.fillText(dist >= 1000 ? `${(dist / 1000).toFixed(2)}km` : `${Math.round(dist)}m`, x, H - 6);
  }

  // Y-axis speed labels (left)
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = '#444c56';
  for (const v of [0, 175, 350]) {
    const norm = (v - 0) / 350;
    const y = PAD.top + CHANNELS[0].offset * gH + CHANNELS[0].scale * gH * (1 - norm);
    ctx.fillText(String(v), PAD.left - 4, y);
  }
}

function TelemetryTimeline() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef   = useRef<() => void>(() => {});

  // Redraw on an interval — reads store state directly, no subscription
  useEffect(() => {
    drawRef.current = () => {
      const canvas = canvasRef.current;
      if (canvas) draw(canvas, buildDataPoints());
    };

    drawRef.current();
    const id = setInterval(() => drawRef.current(), 100); // 10 fps
    return () => clearInterval(id);
  }, []);

  // Resize observer keeps the canvas sharp when the panel resizes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => drawRef.current());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="telemetry-panel flex flex-col h-full overflow-hidden">
      <div className="panel-header shrink-0">
        <span className="text-[10px] font-semibold tracking-widest text-motorsport-muted uppercase">
          Telemetry Trace
        </span>
        <span className="ml-auto text-[9px] text-motorsport-dim font-telemetry">
          Speed · Throttle · Brake · Gear · Steer
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <canvas ref={canvasRef} className="block w-full h-full" />
      </div>
    </div>
  );
}

export default memo(TelemetryTimeline);
