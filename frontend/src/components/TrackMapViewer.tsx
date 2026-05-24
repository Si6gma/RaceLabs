import { useEffect, useRef, useCallback } from 'react';
import type { TelemetryPoint } from '@/utils/telemetryAdapter';

interface LapTrace {
  data: TelemetryPoint[];
  color: string;
}

interface CurrentPoint {
  point: TelemetryPoint;
  color: string;
}

interface Props {
  laps: LapTrace[];
  currentPoint?: TelemetryPoint | null;
  currentPoints?: CurrentPoint[];
}

export default function TrackMapViewer({ laps, currentPoint, currentPoints }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<() => void>(() => {});
  const rafRef = useRef<number | null>(null);

  // Pan/zoom state kept in refs — no React re-renders on interaction
  const transformRef = useRef({ scale: 1, panX: 0, panY: 0 });
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const scheduleDraw = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      drawRef.current();
    });
  }, []);

  // Main draw effect — re-runs when lap data or current point changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || laps.length === 0) return;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const W = rect.width;
      const H = rect.height;
      ctx.clearRect(0, 0, W, H);

      // Ground plane convention (both CSV and normalised live frames): X = lateral, Y = longitudinal, Z = altitude.
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      laps.forEach(({ data }) => {
        data.forEach(s => {
          if (s.world_position_x !== 0 || s.world_position_y !== 0) {
            minX = Math.min(minX, s.world_position_x);
            maxX = Math.max(maxX, s.world_position_x);
            minY = Math.min(minY, s.world_position_y);
            maxY = Math.max(maxY, s.world_position_y);
          }
        });
      });
      if (!isFinite(minX)) return;

      const margin = 24;
      const fitScale = Math.min(
        (W - margin * 2) / (maxX - minX || 1),
        (H - margin * 2) / (maxY - minY || 1),
      );
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      const { scale: uScale, panX, panY } = transformRef.current;
      const S = fitScale * uScale;

      // Draw in world-coordinate space
      ctx.save();
      ctx.translate(W / 2 + panX, H / 2 + panY);
      ctx.scale(S, S);
      ctx.translate(-cx, -cy);

      laps.forEach(({ data, color }, lapIdx) => {
        if (data.length === 0) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = (lapIdx === 0 ? 2 : 1.5) / S;
        ctx.globalAlpha = laps.length === 1 ? 1 : 0.8;
        ctx.beginPath();
        data.forEach((s, i) => {
          if (i === 0) ctx.moveTo(s.world_position_x, s.world_position_y);
          else ctx.lineTo(s.world_position_x, s.world_position_y);
        });
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
      ctx.restore();

      // Current-point dots — drawn in screen space so they're always 5px radius
      const pointsToDraw: CurrentPoint[] = currentPoints ?? (currentPoint ? [{ point: currentPoint, color: '#fff' }] : []);
      pointsToDraw.forEach(({ point, color }) => {
        const sx = (point.world_position_x - cx) * S + W / 2 + panX;
        const sy = (point.world_position_y - cy) * S + H / 2 + panY;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // Zoom-reset hint when zoomed in
      if (uScale !== 1 || panX !== 0 || panY !== 0) {
        ctx.fillStyle = 'rgba(148,163,184,0.4)';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText('double-click to reset', W - 8, H - 8);
      }
    };

    drawRef.current = draw;
    draw();

    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      drawRef.current = () => {};
    };
  }, [laps, currentPoint]);

  // Wheel zoom — non-passive so we can preventDefault
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const rawF = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const t = transformRef.current;
      const newScale = Math.max(0.5, Math.min(60, t.scale * rawF));
      const f = newScale / t.scale; // actual factor after clamping

      transformRef.current = {
        scale: newScale,
        panX: (mx - rect.width / 2) * (1 - f) + t.panX * f,
        panY: (my - rect.height / 2) * (1 - f) + t.panY * f,
      };
      scheduleDraw();
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [scheduleDraw]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    transformRef.current = {
      ...transformRef.current,
      panX: transformRef.current.panX + dx,
      panY: transformRef.current.panY + dy,
    };
    scheduleDraw();
  }, [scheduleDraw]);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleDoubleClick = useCallback(() => {
    transformRef.current = { scale: 1, panX: 0, panY: 0 };
    scheduleDraw();
  }, [scheduleDraw]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block cursor-grab active:cursor-grabbing select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDoubleClick={handleDoubleClick}
    />
  );
}
