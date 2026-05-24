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
  const boundsRef = useRef({ minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });

  // Latest props for the rAF loop (avoids stale closures)
  const propsRef = useRef({ posX, posZ, lapNumber, trackId, sessionType });
  propsRef.current = { posX, posZ, lapNumber, trackId, sessionType };

  const needsDrawRef = useRef(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rafId = 0;
    let lastW = 0;
    let lastH = 0;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      // Only resize canvas when CSS dimensions actually change
      if (rect.width !== lastW || rect.height !== lastH) {
        lastW = rect.width;
        lastH = rect.height;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

      // Previous lap in gray
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

      // Current lap in cyan/blue
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

        // Recent trail highlight
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
      const { posX: px, posZ: pz } = propsRef.current;
      if (px !== 0 || pz !== 0) {
        const cur = toScreen({ x: px, z: pz });
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

    const loop = () => {
      if (document.visibilityState === 'visible' && needsDrawRef.current) {
        needsDrawRef.current = false;
        draw();
      }
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    const onVis = () => {
      if (document.visibilityState === 'visible') {
        needsDrawRef.current = true;
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // Update data refs whenever props change — no rAF scheduling here.
  useEffect(() => {
    const { posX: px, posZ: pz, lapNumber: ln, trackId: tid, sessionType: st } = propsRef.current;
    const hasPos = px !== 0 || pz !== 0;

    const trackChanged = tid !== undefined && lastTrackIdRef.current !== undefined && tid !== lastTrackIdRef.current;
    const sessionChanged = st !== undefined && lastSessionTypeRef.current !== undefined && st !== lastSessionTypeRef.current;
    if (trackChanged || sessionChanged) {
      currentLapRef.current = [];
      previousLapRef.current = [];
      boundsRef.current = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    }
    lastTrackIdRef.current = tid;
    lastSessionTypeRef.current = st;

    if (ln !== undefined && lastLapNumRef.current !== undefined && ln !== lastLapNumRef.current) {
      if (currentLapRef.current.length > 0) {
        previousLapRef.current = currentLapRef.current;
        currentLapRef.current = [];
        boundsRef.current = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      }
    }
    lastLapNumRef.current = ln;

    if (hasPos) {
      currentLapRef.current.push({ x: px, z: pz });
      const b = boundsRef.current;
      if (px < b.minX) b.minX = px;
      if (px > b.maxX) b.maxX = px;
      if (pz < b.minZ) b.minZ = pz;
      if (pz > b.maxZ) b.maxZ = pz;
      needsDrawRef.current = true;
    }
  }, [posX, posZ, lapNumber, trackId, sessionType]);

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
