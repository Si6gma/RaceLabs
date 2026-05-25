import { memo, useEffect, useRef } from 'react';

interface GForceCircleProps {
  latG: number;
  longG: number;
  size?: number;
}

function GForceCircle({ latG, longG, size = 140 }: GForceCircleProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latRef = useRef(latG);
  const lonRef = useRef(longG);
  const trailRef = useRef<{ lat: number; lon: number; age: number }[]>([]);

  latRef.current = latG;
  lonRef.current = longG;

  // Update trail when props change
  useEffect(() => {
    const trail = trailRef.current;
    trail.push({ lat: latG, lon: longG, age: 0 });
    if (trail.length > 8) trail.shift();
  }, [latG, longG]);

  // Persistent rAF draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let raf = 0;

    function draw() {
      const ctx = canvas!.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas!.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      canvas!.width = rect.width * dpr;
      canvas!.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const w = rect.width;
      const h = rect.height;
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) / 2 - 10;

      ctx.clearRect(0, 0, w, h);

      // Background circle
      ctx.fillStyle = '#0d1117';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#21262d';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Concentric rings (1G, 2G, 3G, 4G)
      const rings = [1, 2, 3, 4];
      rings.forEach((g) => {
        const r = (g / 4) * radius;
        ctx.strokeStyle = g === 4 ? '#334155' : '#21262d';
        ctx.lineWidth = g === 4 ? 1.5 : 1;
        ctx.setLineDash(g === 4 ? [] : [3, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Ring label
        ctx.fillStyle = '#475569';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        const labelAngle = -Math.PI / 4;
        const lx = cx + Math.cos(labelAngle) * r;
        const ly = cy + Math.sin(labelAngle) * r;
        ctx.fillText(`${g}G`, lx, ly + 4);
      });

      // Crosshairs
      ctx.strokeStyle = '#21262d';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx + radius, cy);
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx, cy + radius);
      ctx.stroke();

      // Axis labels
      ctx.fillStyle = '#475569';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('LAT', cx, cy + radius + 14);
      ctx.textAlign = 'right';
      ctx.fillText('LONG', cx - radius - 4, cy + 3);

      // Center dot
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fill();

      // Age trail points
      const trail = trailRef.current;
      trail.forEach((pt) => {
        pt.age += 1;
        const alpha = Math.max(0, 1 - pt.age / 60); // fade over ~60 frames
        const tx = cx + (pt.lat / 4) * radius;
        const ty = cy - (pt.lon / 4) * radius;
        ctx.fillStyle = `rgba(255, 107, 0, ${alpha * 0.5})`;
        ctx.beginPath();
        ctx.arc(tx, ty, 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
      // Remove old trail points
      trailRef.current = trail.filter(pt => pt.age < 60);

      // Current dot glow
      const dx = cx + (latRef.current / 4) * radius;
      const dy = cy - (lonRef.current / 4) * radius;

      const glow = ctx.createRadialGradient(dx, dy, 0, dx, dy, 14);
      glow.addColorStop(0, 'rgba(255, 107, 0, 0.5)');
      glow.addColorStop(1, 'rgba(255, 107, 0, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(dx, dy, 14, 0, Math.PI * 2);
      ctx.fill();

      // Current dot
      ctx.fillStyle = '#ff6b00';
      ctx.beginPath();
      ctx.arc(dx, dy, 4, 0, Math.PI * 2);
      ctx.fill();

      // Value readout inside circle (top-left)
      ctx.fillStyle = '#ff6b00';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'left';
      const mag = Math.sqrt(latRef.current ** 2 + lonRef.current ** 2);
      ctx.fillText(`${mag.toFixed(2)}G`, cx - radius + 6, cy - radius + 14);
    }

    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="telemetry-label">G-FORCE</span>
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size }}
        className="block rounded-full"
      />
      <div className="flex gap-3">
        <span className="font-telemetry text-[10px] text-motorsport-muted">
          L {latG.toFixed(2)}
        </span>
        <span className="font-telemetry text-[10px] text-motorsport-muted">
          R {longG.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

export default memo(GForceCircle);
