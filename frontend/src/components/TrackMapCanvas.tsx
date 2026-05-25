import { memo, useRef, useEffect } from 'react';
import trackOutlines from '@/data/track_outlines.json';

type Pt = [number, number];

interface TrackOutline {
  name: string;
  centerline: Pt[];
  edge_right: Pt[];
  edge_left: Pt[];
}

const outlines = trackOutlines as unknown as Record<string, TrackOutline>;

interface Props {
  trackId?: number;
  trackLength?: number;
  playerCarIndex?: number;
  allLapDistances?: number[];
  // Fallback live-trace props (used when no pre-baked outline exists)
  posX?: number;
  posZ?: number;
  lapNumber?: number;
  sessionType?: number;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function getBounds(pts: Pt[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

function makeTransform(allPts: Pt[], w: number, h: number, pad = 12) {
  const b = getBounds(allPts);
  const rangeX = b.maxX - b.minX || 1;
  const rangeY = b.maxY - b.minY || 1;
  const scale = Math.min((w - pad * 2) / rangeX, (h - pad * 2) / rangeY);
  const offX = (w - rangeX * scale) / 2 - b.minX * scale;
  const offY = (h - rangeY * scale) / 2 - b.minY * scale;
  return (p: Pt) => [p[0] * scale + offX, p[1] * scale + offY] as Pt;
}

function interpolateOnCenterline(centerline: Pt[], t: number): Pt {
  if (centerline.length === 0) return [0, 0];
  const clamped = Math.max(0, Math.min(1, t));
  const raw = clamped * (centerline.length - 1);
  const lo = Math.floor(raw);
  const hi = Math.min(lo + 1, centerline.length - 1);
  const frac = raw - lo;
  const [x0, y0] = centerline[lo];
  const [x1, y1] = centerline[hi];
  return [x0 + (x1 - x0) * frac, y0 + (y1 - y0) * frac];
}

function drawPolyline(ctx: CanvasRenderingContext2D, pts: Pt[], toScreen: (p: Pt) => Pt) {
  if (pts.length < 2) return;
  ctx.beginPath();
  const s0 = toScreen(pts[0]);
  ctx.moveTo(s0[0], s0[1]);
  for (let i = 1; i < pts.length; i++) {
    const s = toScreen(pts[i]);
    ctx.lineTo(s[0], s[1]);
  }
}

// ── component ─────────────────────────────────────────────────────────────────

function TrackMap({
  trackId,
  trackLength,
  playerCarIndex = 0,
  allLapDistances,
  posX = 0,
  posZ = 0,
  lapNumber,
  sessionType,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const needsDrawRef = useRef(true);

  // Live-trace state (fallback for tracks without pre-baked data)
  const currentLapRef = useRef<Pt[]>([]);
  const previousLapRef = useRef<Pt[]>([]);
  const lastLapNumRef = useRef<number | undefined>(undefined);
  const lastTrackIdRef = useRef<number | undefined>(undefined);
  const lastSessionTypeRef = useRef<number | undefined>(undefined);
  const traceBoundsRef = useRef({ minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });

  // Keep latest props accessible in rAF without stale closure
  const propsRef = useRef({ trackId, trackLength, playerCarIndex, allLapDistances, posX, posZ, lapNumber, sessionType });
  propsRef.current = { trackId, trackLength, playerCarIndex, allLapDistances, posX, posZ, lapNumber, sessionType };

  // rAF draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rafId = 0;
    let lastW = 0, lastH = 0;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      if (rect.width !== lastW || rect.height !== lastH) {
        lastW = rect.width; lastH = rect.height;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = rect.width, H = rect.height;
      ctx.clearRect(0, 0, W, H);

      const { trackId: tid, trackLength: tlen, playerCarIndex: pci, allLapDistances: dists, posX: px, posZ: pz } = propsRef.current;
      const outline = tid !== undefined ? outlines[String(tid)] : undefined;

      if (outline) {
        // ── Pre-baked track ──────────────────────────────────────────────────
        const allPts = [...outline.edge_right, ...outline.edge_left];
        const toScreen = makeTransform(allPts, W, H);

        // Fill between edges
        ctx.beginPath();
        drawPolyline(ctx, outline.edge_right, toScreen);
        // Walk left edge in reverse to close the fill shape
        const revLeft = [...outline.edge_left].reverse();
        for (const p of revLeft) {
          const s = toScreen(p);
          ctx.lineTo(s[0], s[1]);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(60,60,75,0.6)';
        ctx.fill();

        // Edge lines
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#4a4a5a';
        drawPolyline(ctx, outline.edge_right, toScreen);
        ctx.stroke();
        drawPolyline(ctx, outline.edge_left, toScreen);
        ctx.stroke();

        // Start/finish line across track width
        if (outline.edge_right.length > 0 && outline.edge_left.length > 0) {
          const sr = toScreen(outline.edge_right[0]);
          const sl = toScreen(outline.edge_left[0]);
          ctx.beginPath();
          ctx.moveTo(sr[0], sr[1]);
          ctx.lineTo(sl[0], sl[1]);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Car dots
        if (dists && tlen && tlen > 0) {
          for (let i = 0; i < dists.length; i++) {
            const d = dists[i];
            if (d <= 0) continue;
            const t = Math.max(0, Math.min(1, d / tlen));
            const pos = interpolateOnCenterline(outline.centerline, t);
            const [sx, sy] = toScreen(pos);
            const isPlayer = i === pci;
            const r = isPlayer ? 5 : 3.5;
            ctx.beginPath();
            ctx.arc(sx, sy, r + 2, 0, Math.PI * 2);
            ctx.fillStyle = isPlayer ? 'rgba(255,107,0,0.25)' : 'rgba(0,200,255,0.15)';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
            ctx.fillStyle = isPlayer ? '#ff6b00' : '#00c8ff';
            ctx.fill();
          }
        }
      } else {
        // ── Live-trace fallback ──────────────────────────────────────────────
        const current = currentLapRef.current;
        const previous = previousLapRef.current;
        const allPoints = previous.length + current.length;

        if (allPoints < 2) {
          ctx.strokeStyle = '#2a2a2a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(W / 2, H / 2, 30, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#555';
          ctx.font = '10px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('WAITING FOR GPS', W / 2, H / 2 + 4);
          return;
        }

        const b = traceBoundsRef.current;
        const minX = b.minX === Infinity ? 0 : b.minX;
        const maxX = b.maxX === -Infinity ? 1 : b.maxX;
        const minZ = b.minZ === Infinity ? 0 : b.minZ;
        const maxZ = b.maxZ === -Infinity ? 1 : b.maxZ;
        const pad = 10;
        const scaleX = (W - pad * 2) / (maxX - minX || 1);
        const scaleZ = (H - pad * 2) / (maxZ - minZ || 1);
        const scale = Math.min(scaleX, scaleZ);
        const offX = (W - (maxX - minX) * scale) / 2 - minX * scale;
        const offZ = (H - (maxZ - minZ) * scale) / 2 - minZ * scale;
        const toScreen = (p: Pt): Pt => [p[0] * scale + offX, p[1] * scale + offZ];

        if (previous.length >= 2) {
          ctx.beginPath();
          ctx.strokeStyle = '#3a3a4a';
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          drawPolyline(ctx, previous, toScreen);
          ctx.stroke();
        }

        if (current.length >= 2) {
          ctx.beginPath();
          ctx.strokeStyle = '#1e6fa8';
          ctx.lineWidth = 2.5;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          drawPolyline(ctx, current, toScreen);
          ctx.stroke();

          const recent = current.slice(-80);
          for (let i = 1; i < recent.length; i++) {
            const p1 = toScreen(recent[i - 1]);
            const p2 = toScreen(recent[i]);
            ctx.beginPath();
            ctx.strokeStyle = `rgba(0,229,255,${(i / recent.length) * 0.9})`;
            ctx.lineWidth = 2;
            ctx.moveTo(p1[0], p1[1]);
            ctx.lineTo(p2[0], p2[1]);
            ctx.stroke();
          }
        }

        if (px !== 0 || pz !== 0) {
          const cur = toScreen([px, pz]);
          ctx.beginPath();
          ctx.fillStyle = 'rgba(255,107,0,0.3)';
          ctx.arc(cur[0], cur[1], 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.fillStyle = '#ff6b00';
          ctx.arc(cur[0], cur[1], 4, 0, Math.PI * 2);
          ctx.fill();
        }
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

    const onVis = () => { if (document.visibilityState === 'visible') needsDrawRef.current = true; };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelAnimationFrame(rafId); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  // Update live-trace refs and trigger redraws
  useEffect(() => {
    const { trackId: tid, sessionType: st, lapNumber: ln, posX: px, posZ: pz } = propsRef.current;
    const outline = tid !== undefined ? outlines[String(tid)] : undefined;

    if (outline) {
      // Pre-baked track — just mark dirty so car dots redraw
      needsDrawRef.current = true;
      return;
    }

    // Live-trace path
    const trackChanged = tid !== undefined && lastTrackIdRef.current !== undefined && tid !== lastTrackIdRef.current;
    const sessionChanged = st !== undefined && lastSessionTypeRef.current !== undefined && st !== lastSessionTypeRef.current;
    if (trackChanged || sessionChanged) {
      currentLapRef.current = [];
      previousLapRef.current = [];
      traceBoundsRef.current = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    }
    lastTrackIdRef.current = tid;
    lastSessionTypeRef.current = st;

    if (ln !== undefined && lastLapNumRef.current !== undefined && ln !== lastLapNumRef.current) {
      if (currentLapRef.current.length > 0) {
        previousLapRef.current = currentLapRef.current;
        currentLapRef.current = [];
        traceBoundsRef.current = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      }
    }
    lastLapNumRef.current = ln;

    if (px !== 0 || pz !== 0) {
      currentLapRef.current.push([px, pz]);
      const b = traceBoundsRef.current;
      if (px < b.minX) b.minX = px; if (px > b.maxX) b.maxX = px;
      if (pz < b.minZ) b.minZ = pz; if (pz > b.maxZ) b.maxZ = pz;
    }
    needsDrawRef.current = true;
  }, [trackId, trackLength, playerCarIndex, allLapDistances, posX, posZ, lapNumber, sessionType]);

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

export const MiniTrackMapMemo = memo(TrackMap);
