import { useEffect, useRef } from 'react';
import type { TelemetryPoint } from '@/utils/telemetryAdapter';

export interface ChannelDef {
  key: keyof TelemetryPoint;
  label: string;
  color: string;
  min: number;
  max: number;
  scale: number;
  offset: number;
  unit: string;
  transform?: (v: number) => number;
  decimals: number;
}

export const CHANNELS: ChannelDef[] = [
  { key: 'speed_kmh', label: 'Speed', color: '#60a5fa', min: 0, max: 350, scale: 1.0, offset: 0, unit: ' km/h', decimals: 0 },
  { key: 'rpm', label: 'RPM', color: '#c084fc', min: 0, max: 15000, scale: 1.0, offset: 0, unit: '', decimals: 0 },
  { key: 'throttle', label: 'Throttle', color: '#4ade80', min: 0, max: 1, scale: 0.22, offset: 0.78, unit: '%', transform: v => v * 100, decimals: 0 },
  { key: 'brake', label: 'Brake', color: '#f87171', min: 0, max: 1, scale: 0.22, offset: 0.78, unit: '%', transform: v => v * 100, decimals: 0 },
  { key: 'steering', label: 'Steering', color: '#22d3ee', min: -1, max: 1, scale: 0.35, offset: 0.325, unit: '%', transform: v => v * 100, decimals: 0 },
  { key: 'gear', label: 'Gear', color: '#fb923c', min: 0, max: 8, scale: 0.18, offset: 0.8, unit: '', decimals: 0 },
  { key: 'gforce_lat', label: 'G-Force', color: '#e879f9', min: 0, max: 6, scale: 0.22, offset: 0, unit: 'G', decimals: 2 },
  { key: 'delta_time', label: 'Delta', color: '#94a3b8', min: -5, max: 5, scale: 0.3, offset: 0.35, unit: 's', decimals: 3 },
];

export const DEFAULT_VISIBLE = new Set(['speed_kmh', 'throttle', 'brake']);

const PAD = { top: 20, right: 60, bottom: 40, left: 50 };

interface LapData {
  data: TelemetryPoint[];
  color: string;
}

interface Props {
  laps: LapData[];
  visibleChannels: Set<string>;
  zoomRange: [number, number];
  effectiveIndex: number;
  cursorLocked: boolean;
}

export default function TelemetryGraphCanvas({
  laps,
  visibleChannels,
  zoomRange,
  effectiveIndex,
  cursorLocked,
}: Props) {
  const dataCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);

  // Data layer — traces, grid, labels, zoom bar, x-axis distance ticks
  useEffect(() => {
    const canvas = dataCanvasRef.current;
    if (!canvas || laps.length === 0) return;

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
      const graphHeight = height - PAD.top - PAD.bottom;

      ctx.clearRect(0, 0, width, height);

      const [zStart, zEnd] = zoomRange;
      const zoomSamples = Math.max(1, zEnd - zStart);

      // Grid lines
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= 5; i++) {
        const y = PAD.top + (graphHeight / 5) * i;
        ctx.beginPath();
        ctx.moveTo(PAD.left, y);
        ctx.lineTo(width - PAD.right, y);
        ctx.stroke();
      }

      // Channel traces
      CHANNELS.forEach(ch => {
        if (!visibleChannels.has(ch.key as string)) return;
        laps.forEach(lap => {
          const samples = lap.data;
          if (samples.length < 2) return;

          const xScale = graphWidth / zoomSamples;
          const startI = Math.max(0, Math.floor(zStart));
          const endI = Math.min(samples.length - 1, Math.ceil(zEnd));

          ctx.strokeStyle = ch.color;
          ctx.lineWidth = ch.key === 'speed_kmh' || ch.key === 'rpm' ? 1.5 : 1;
          ctx.globalAlpha =
            ch.key === 'throttle' || ch.key === 'brake' ? 0.35
            : ch.key === 'delta_time' ? 0.6
            : 0.9;

          ctx.beginPath();
          let first = true;
          for (let i = startI; i <= endI; i++) {
            const s = samples[i];
            const val = s[ch.key] as number;
            const x = PAD.left + (i - zStart) * xScale;
            const normalized = (val - ch.min) / (ch.max - ch.min);
            const y = PAD.top + graphHeight * ch.offset + graphHeight * ch.scale * (1 - normalized);
            if (first) { ctx.moveTo(x, y); first = false; }
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        });
      });

      // X-axis distance labels — use the longest lap so the axis matches the zoom range
      const refLap = laps.reduce((best, l) => l.data.length > best.data.length ? l : best, laps[0]);
      if (refLap && refLap.data.length > 0) {
        ctx.fillStyle = '#475569';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        const numTicks = 6;
        for (let t = 0; t <= numTicks; t++) {
          const idx = Math.max(0, Math.min(
            refLap.data.length - 1,
            Math.floor(zStart + (t / numTicks) * zoomSamples)
          ));
          const dist = refLap.data[idx]?.cumulative_distance ?? 0;
          const x = PAD.left + (t / numTicks) * graphWidth;
          const label = dist >= 1000 ? `${(dist / 1000).toFixed(2)}km` : `${Math.round(dist)}m`;
          ctx.fillText(label, x, PAD.top + graphHeight + 16);
        }
      }

      // Y-axis labels (Speed scale)
      ctx.fillStyle = '#64748b';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText('350', PAD.left - 5, PAD.top + 5);
      ctx.fillText('175', PAD.left - 5, PAD.top + graphHeight / 2 + 5);
      ctx.fillText('0', PAD.left - 5, PAD.top + graphHeight - 5);

      // Right-side channel legend
      ctx.textAlign = 'left';
      let labelY = PAD.top + 10;
      CHANNELS.forEach(ch => {
        if (!visibleChannels.has(ch.key as string)) return;
        ctx.fillStyle = ch.color;
        ctx.font = '9px monospace';
        ctx.fillText(ch.label, width - PAD.right + 6, labelY);
        labelY += 12;
      });
    }

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [laps, visibleChannels, zoomRange]);

  // Cursor overlay — just the vertical line, redraws on every hover
  useEffect(() => {
    const canvas = cursorCanvasRef.current;
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

      ctx.clearRect(0, 0, width, height);

      const [zStart, zEnd] = zoomRange;
      const zoomSamples = Math.max(1, zEnd - zStart);

      if (effectiveIndex >= zStart && effectiveIndex <= zEnd) {
        const x = PAD.left + (effectiveIndex - zStart) * (graphWidth / zoomSamples);
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

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [effectiveIndex, cursorLocked, zoomRange]);

  return (
    <div className="relative w-full h-full">
      <canvas ref={dataCanvasRef} className="absolute inset-0 w-full h-full block" />
      <canvas ref={cursorCanvasRef} className="absolute inset-0 w-full h-full block pointer-events-none" />
    </div>
  );
}
