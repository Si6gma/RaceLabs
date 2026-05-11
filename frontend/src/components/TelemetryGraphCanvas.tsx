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
  { key: 'speed_kmh', label: 'Speed', color: '#3b82f6', min: 0, max: 350, scale: 1.0, offset: 0, unit: ' km/h', decimals: 0 },
  { key: 'rpm', label: 'RPM', color: '#a855f7', min: 0, max: 15000, scale: 1.0, offset: 0, unit: '', decimals: 0 },
  { key: 'throttle', label: 'Throttle', color: '#22c55e', min: 0, max: 1, scale: 0.22, offset: 0.78, unit: '%', transform: v => v * 100, decimals: 0 },
  { key: 'brake', label: 'Brake', color: '#ef4444', min: 0, max: 1, scale: 0.22, offset: 0.78, unit: '%', transform: v => v * 100, decimals: 0 },
  { key: 'steering', label: 'Steering', color: '#06b6d4', min: -1, max: 1, scale: 0.35, offset: 0.325, unit: '%', transform: v => v * 100, decimals: 0 },
  { key: 'gear', label: 'Gear', color: '#f59e0b', min: 0, max: 8, scale: 0.18, offset: 0.8, unit: '', decimals: 0 },
  { key: 'gforce_lat', label: 'G-Force', color: '#ec4899', min: 0, max: 6, scale: 0.22, offset: 0, unit: 'G', decimals: 2 },
  { key: 'delta_time', label: 'Delta', color: '#ffffff', min: -5, max: 5, scale: 0.3, offset: 0.35, unit: 's', decimals: 3 },
];

export const DEFAULT_VISIBLE = new Set(['speed_kmh', 'throttle', 'brake']);

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
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || laps.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const padding = { top: 20, right: 60, bottom: 30, left: 50 };
    const graphWidth = width - padding.left - padding.right;
    const graphHeight = height - padding.top - padding.bottom;

    ctx.clearRect(0, 0, width, height);

    const [zStart, zEnd] = zoomRange;
    const zoomSamples = Math.max(1, zEnd - zStart);

    // Grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (graphHeight / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    // Draw each visible channel for each lap
    CHANNELS.forEach(ch => {
      if (!visibleChannels.has(ch.key as string)) return;

      laps.forEach((lap) => {
        const samples = lap.data;
        if (samples.length < 2) return;

        const xScale = graphWidth / zoomSamples;
        const startI = Math.max(0, Math.floor(zStart));
        const endI = Math.min(samples.length - 1, Math.ceil(zEnd));

        ctx.strokeStyle = ch.color;
        ctx.lineWidth = ch.key === 'speed_kmh' || ch.key === 'rpm' ? 1.5 : 1;
        if (ch.key === 'throttle' || ch.key === 'brake') ctx.globalAlpha = 0.35;
        else if (ch.key === 'delta_time') ctx.globalAlpha = 0.6;
        else ctx.globalAlpha = 0.9;

        ctx.beginPath();
        let first = true;
        for (let i = startI; i <= endI; i++) {
          const s = samples[i];
          const val = s[ch.key] as number;
          const x = padding.left + (i - zStart) * xScale;
          const normalized = (val - ch.min) / (ch.max - ch.min);
          const y = padding.top + graphHeight * ch.offset + graphHeight * ch.scale * (1 - normalized);
          if (first) { ctx.moveTo(x, y); first = false; }
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
    });

    // Cursor line at effectiveIndex
    if (effectiveIndex >= zStart && effectiveIndex <= zEnd) {
      const xScale = graphWidth / zoomSamples;
      const x = padding.left + (effectiveIndex - zStart) * xScale;

      ctx.strokeStyle = cursorLocked ? '#fff' : 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash(cursorLocked ? [4, 4] : [2, 6]);
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, height - padding.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Zoom window indicator (mini bar at bottom)
    const totalSamples = laps[0]?.data.length ?? 1;
    if (zoomSamples < totalSamples) {
      const total = totalSamples - 1;
      const barY = height - 6;
      const barW = graphWidth;
      const barX = padding.left;
      ctx.fillStyle = '#222';
      ctx.fillRect(barX, barY, barW, 4);
      ctx.fillStyle = '#3b82f6';
      const rs = zStart / total;
      const re = zEnd / total;
      ctx.fillRect(barX + rs * barW, barY, (re - rs) * barW, 4);
    }

    // Y-axis labels (Speed primary)
    ctx.fillStyle = '#888';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('350', padding.left - 5, padding.top + 5);
    ctx.fillText('175', padding.left - 5, padding.top + graphHeight / 2 + 5);
    ctx.fillText('0', padding.left - 5, padding.top + graphHeight - 5);

    // Right-side channel labels
    ctx.textAlign = 'left';
    let labelY = padding.top + 10;
    CHANNELS.forEach(ch => {
      if (!visibleChannels.has(ch.key as string)) return;
      ctx.fillStyle = ch.color;
      ctx.font = '9px monospace';
      ctx.fillText(ch.label, width - padding.right + 6, labelY);
      labelY += 12;
    });
  }, [laps, visibleChannels, effectiveIndex, cursorLocked, zoomRange]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block"
    />
  );
}
