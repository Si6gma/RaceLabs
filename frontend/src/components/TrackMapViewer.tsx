import { useEffect, useRef } from 'react';
import type { TelemetryPoint } from '@/utils/telemetryAdapter';

interface LapTrace {
  data: TelemetryPoint[];
  color: string;
}

interface Props {
  laps: LapTrace[];
  currentPoint?: TelemetryPoint | null;
}

export default function TrackMapViewer({ laps, currentPoint }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
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
      ctx.clearRect(0, 0, width, height);

      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      laps.forEach(({ data }) => {
        data.forEach(s => {
          if (s.world_position_x !== 0 || s.world_position_z !== 0) {
            minX = Math.min(minX, s.world_position_x);
            maxX = Math.max(maxX, s.world_position_x);
            minZ = Math.min(minZ, s.world_position_z);
            maxZ = Math.max(maxZ, s.world_position_z);
          }
        });
      });

      if (!isFinite(minX)) return;

      const margin = 20;
      const mapWidth = maxX - minX || 1;
      const mapHeight = maxZ - minZ || 1;
      const scale = Math.min((width - margin * 2) / mapWidth, (height - margin * 2) / mapHeight);
      const offsetX = (width - mapWidth * scale) / 2 - minX * scale;
      const offsetY = (height - mapHeight * scale) / 2 - minZ * scale;

      laps.forEach(({ data, color }, lapIdx) => {
        if (data.length === 0) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = lapIdx === 0 ? 2 : 1.5;
        ctx.globalAlpha = laps.length === 1 ? 1 : 0.8;
        ctx.beginPath();
        data.forEach((s, i) => {
          const x = s.world_position_x * scale + offsetX;
          const y = s.world_position_z * scale + offsetY;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      });
      ctx.globalAlpha = 1;

      if (currentPoint) {
        const x = currentPoint.world_position_x * scale + offsetX;
        const y = currentPoint.world_position_z * scale + offsetY;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [laps, currentPoint]);

  return <canvas ref={canvasRef} className="w-full h-full block" />;
}
