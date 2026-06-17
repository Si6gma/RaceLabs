import { memo, useEffect, useRef } from 'react';
import { useTelemetryStore, getFrameHistory } from '@/stores/telemetryStore';

interface DataPoint {
  dist:     number;
  speed:    number;
  throttle: number;
  brake:    number;
  gear:     number;
  steer:    number;
}

const CHANNELS = [
  { key: 'speed'    as const, label: 'SPEED',    color: '#00D4FF', min: 0,  max: 350, scale: 0.25, offset: 0.00 },
  { key: 'throttle' as const, label: 'THROTTLE', color: '#00E85A', min: 0,  max: 100, scale: 0.17, offset: 0.28 },
  { key: 'brake'    as const, label: 'BRAKE',    color: '#FF2044', min: 0,  max: 100, scale: 0.17, offset: 0.28 },
  { key: 'gear'     as const, label: 'GEAR',     color: '#FFD000', min: 0,  max: 9,   scale: 0.15, offset: 0.50 },
  { key: 'steer'    as const, label: 'STEER',    color: '#8855FF', min: -1, max: 1,   scale: 0.13, offset: 0.70 },
];

const DIVIDERS = [0.27, 0.49, 0.69];
const PAD = { top: 8, right: 64, bottom: 24, left: 36 };

function buildDataPoints(): DataPoint[] {
  const frameHistory = getFrameHistory();
  const { currentFrame } = useTelemetryStore.getState();
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
  ctx.fillStyle = '#060A0F';
  ctx.fillRect(0, 0, W, H);

  // Subtle grid
  ctx.strokeStyle = '#1A2840';
  ctx.lineWidth   = 0.5;
  const gridCols = 8;
  for (let i = 0; i <= gridCols; i++) {
    const x = PAD.left + (i / gridCols) * gW;
    ctx.beginPath();
    ctx.moveTo(x, PAD.top);
    ctx.lineTo(x, PAD.top + gH);
    ctx.stroke();
  }

  // Band dividers
  ctx.strokeStyle = '#243856';
  ctx.lineWidth   = 0.5;
  for (const frac of DIVIDERS) {
    const y = PAD.top + gH * frac;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + gW, y);
    ctx.stroke();
  }

  // Channel labels (right legend)
  const labeled = new Set<string>();
  ctx.font      = '9px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  CHANNELS.forEach(ch => {
    if (labeled.has(ch.label)) return;
    labeled.add(ch.label);
    ctx.fillStyle = ch.color;
    ctx.fillText(ch.label, PAD.left + gW + 4, PAD.top + gH * ch.offset + 10);
  });

  if (data.length < 2) {
    ctx.fillStyle    = '#4A6078';
    ctx.font         = '10px "Barlow Condensed", "JetBrains Mono", monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('WAITING FOR LAP DATA', PAD.left + gW / 2, PAD.top + gH / 2);
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

  // Draw channel traces
  for (const ch of CHANNELS) {
    ctx.strokeStyle = ch.color;
    ctx.lineWidth   = ch.key === 'speed' ? 1.5 : 1;
    ctx.globalAlpha = ch.key === 'throttle' || ch.key === 'brake' ? 0.8 : 0.9;
    ctx.lineJoin    = 'round';

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
  ctx.fillStyle    = '#4A6078';
  ctx.font         = '9px "JetBrains Mono", monospace';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  const ticks = 6;
  for (let i = 0; i <= ticks; i++) {
    const dist = xMin + (i / ticks) * xRange;
    const x    = PAD.left + (i / ticks) * gW;
    ctx.fillText(dist >= 1000 ? `${(dist / 1000).toFixed(2)}km` : `${Math.round(dist)}m`, x, H - 6);
  }

  // Y-axis speed labels (left)
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = '#4A6078';
  for (const v of [0, 175, 350]) {
    const norm = (v - 0) / 350;
    const y = PAD.top + CHANNELS[0].offset * gH + CHANNELS[0].scale * gH * (1 - norm);
    ctx.fillText(String(v), PAD.left - 4, y);
  }
}

function TelemetryTimeline() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef   = useRef<() => void>(() => {});

  useEffect(() => {
    drawRef.current = () => {
      const canvas = canvasRef.current;
      if (canvas) draw(canvas, buildDataPoints());
    };
    drawRef.current();
    const id = setInterval(() => drawRef.current(), 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => drawRef.current());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="telemetry-panel flex flex-col h-full overflow-hidden">
      <div className="panel-header justify-between">
        <span className="eng-label font-bold">Telemetry Trace</span>
        <span className="text-[10px] text-motorsport-dim font-telemetry tracking-wide">
          SPEED · THROTTLE · BRAKE · GEAR · STEER
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <canvas ref={canvasRef} className="block w-full h-full" />
      </div>
    </div>
  );
}

export default memo(TelemetryTimeline);
