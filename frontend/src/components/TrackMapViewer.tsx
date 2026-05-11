import { useEffect, useRef } from 'react';
import type { TelemetryPoint } from '@/utils/telemetryAdapter';

interface Props {
  data: TelemetryPoint[];
  color: string;
  currentPoint?: TelemetryPoint | null;
}

export default function TrackMapViewer({ data, color, currentPoint }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    ctx.clearRect(0, 0, width, height);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    data.forEach(s => {
      minX = Math.min(minX, s.world_position_x);
      maxX = Math.max(maxX, s.world_position_x);
      minZ = Math.min(minZ, s.world_position_z);
      maxZ = Math.max(maxZ, s.world_position_z);
    });

    const margin = 20;
    const mapWidth = maxX - minX || 1;
    const mapHeight = maxZ - minZ || 1;
    const scale = Math.min((width - margin * 2) / mapWidth, (height - margin * 2) / mapHeight);

    const offsetX = (width - mapWidth * scale) / 2 - minX * scale;
    const offsetY = (height - mapHeight * scale) / 2 - minZ * scale;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((s, i) => {
      const x = s.world_position_x * scale + offsetX;
      const y = s.world_position_z * scale + offsetY;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

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
  }, [data, color, currentPoint]);

  return <canvas ref={canvasRef} className="w-full h-full block" />;
}
