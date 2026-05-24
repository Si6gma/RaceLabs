import { memo, useRef, useEffect } from 'react';

interface Point { x: number; z: number; }

interface MiniTrackMapProps {
  posX?: number;
  posZ?: number;
  lapNumber?: number;
  trackId?: number;
  sessionType?: number;
}

function MiniTrackMap({ posX = 0, posZ = 0, lapNumber, trackId, sessionType }: MiniTrackMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentLapRef = useRef<Point[]>([]);
  const previousLapRef = useRef<Point[]>([]);
  const lastLapNumRef = useRef<number | undefined>(undefined);
  const lastTrackIdRef = useRef<number | undefined>(undefined);
  const lastSessionTypeRef = useRef<number | undefined>(undefined);

  // Cached bounds so we don't recompute min/max over thousands of points every frame.
  const boundsRef = useRef({ minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
  const rafRef = useRef<number>(0);
  const needsDrawRef = useRef(false);

  // Schedule a canvas redraw using requestAnimationFrame.
  const scheduleDraw = () => {
    if (needsDrawRef.current) return;
    needsDrawRef.current = true;
    rafRef.current = requestAnimationFrame(() => {
      needsDrawRef.current = false;
      draw();
    });
  };

  // Accumulate positions, archiving to previous when lap number increments.
  // We push directly into the ref array (no spread) to avoid O(n) copies.
  useEffect(() => {
    const hasPos = posX !== 0 || posZ !== 0;

    // Track or session changed — wipe everything
    const trackChanged = trackId !== undefined && lastTrackIdRef.current !== undefined && trackId !== lastTrackIdRef.current;
    const sessionChanged = sessionType !== undefined && lastSessionTypeRef.current !== undefined && sessionType !== lastSessionTypeRef.current;
    if (trackChanged || sessionChanged) {
      currentLapRef.current = [];
      previousLapRef.current = [];
      boundsRef.current = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    }
    lastTrackIdRef.current = trackId;
    lastSessionTypeRef.current = sessionType;

    if (lapNumber !== undefined && lastLapNumRef.current !== undefined && lapNumber !== lastLapNumRef.current) {
      if (currentLapRef.current.length > 0) {
        previousLapRef.current = currentLapRef.current;
        currentLapRef.current = [];
        // Recompute bounds from scratch when archiving laps
        boundsRef.current = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      }
    }
    lastLapNumRef.current = lapNumber;

    if (hasPos) {
      currentLapRef.current.push({ x: posX, z: posZ });
      // Incrementally update bounds
      const b = boundsRef.current;
      if (posX < b.minX) b.minX = posX;
      if (posX > b.maxX) b.maxX = posX;
      if (posZ < b.minZ) b.minZ = posZ;
      if (posZ > b.maxZ) b.maxZ = posZ;
      scheduleDraw();
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [posX, posZ, lapNumber, trackId, sessionType]);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const current = currentLapRef.current;
    const previous = previousLapRef.current;
    const allPoints = previous.length + current.length;

    if (allPoints < 2) {
      ctx.strokeStyle = '#2a2a2a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#555';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('WAITING FOR GPS', w / 2, h / 2 + 4);
      return;
    }

    const b = boundsRef.current;
    const minX = b.minX === Infinity ? 0 : b.minX;
    const maxX = b.maxX === -Infinity ? 1 : b.maxX;
    const minZ = b.minZ === Infinity ? 0 : b.minZ;
    const maxZ = b.maxZ === -Infinity ? 1 : b.maxZ;

    const padding = 10;
    const scaleX = (w - padding * 2) / (maxX - minX || 1);
    const scaleZ = (h - padding * 2) / (maxZ - minZ || 1);
    const scale = Math.min(scaleX, scaleZ);

    const offsetX = (w - (maxX - minX) * scale) / 2 - minX * scale;
    const offsetZ = (h - (maxZ - minZ) * scale) / 2 - minZ * scale;

    const toScreen = (p: Point) => ({
      x: p.x * scale + offsetX,
      y: p.z * scale + offsetZ,
    });

    // Draw previous lap in gray
    if (previous.length >= 2) {
      ctx.beginPath();
      ctx.strokeStyle = '#3a3a4a';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      previous.forEach((p, i) => {
        const s = toScreen(p);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
    }

    // Draw current lap in cyan/blue
    if (current.length >= 2) {
      ctx.beginPath();
      ctx.strokeStyle = '#1e6fa8';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      current.forEach((p, i) => {
        const s = toScreen(p);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();

      // Highlight recent trail in bright cyan (limit to last 80)
      const recent = current.slice(-80);
      for (let i = 1; i < recent.length; i++) {
        const p1 = toScreen(recent[i - 1]);
        const p2 = toScreen(recent[i]);
        ctx.beginPath();
        ctx.strokeStyle = `rgba(0, 229, 255, ${(i / recent.length) * 0.9})`;
        ctx.lineWidth = 2;
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }

    // Current position dot
    if (posX !== 0 || posZ !== 0) {
      const cur = toScreen({ x: posX, z: posZ });
      ctx.beginPath();
      ctx.fillStyle = 'rgba(255, 107, 0, 0.3)';
      ctx.arc(cur.x, cur.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = '#ff6b00';
      ctx.arc(cur.x, cur.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  return (
    <div className="flex flex-col gap-2 h-full">
      <span className="telemetry-label">TRACK MAP</span>
      <canvas
        ref={canvasRef}
        className="flex-1 w-full min-h-[120px] bg-motorsport-charcoal rounded-sm"
      />
    </div>
  );
}

export const MiniTrackMapMemo = memo(MiniTrackMap);
