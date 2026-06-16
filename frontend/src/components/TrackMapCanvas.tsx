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

// F1 23 team colors by teamId
const TEAM_COLORS: Record<number, string> = {
  0:  '#00D2BE',  // Mercedes
  1:  '#E8002D',  // Ferrari
  2:  '#3671C6',  // Red Bull
  3:  '#64C4FF',  // Williams
  4:  '#358C75',  // Aston Martin
  5:  '#0090FF',  // Alpine
  6:  '#2B4562',  // AlphaTauri
  7:  '#B6BABD',  // Haas
  8:  '#FF8000',  // McLaren
  9:  '#C92D4B',  // Alfa Romeo
  85: '#AAAAAA',  // MyTeam
};
const FALLBACK_COLOR = '#888888';

function teamColor(teamId: number | undefined): string {
  if (teamId === undefined) return FALLBACK_COLOR;
  return TEAM_COLORS[teamId] ?? FALLBACK_COLOR;
}

interface Props {
  trackId?: number;
  trackLength?: number;
  playerCarIndex?: number;
  allLapDistances?: number[];
  carTeamIds?: number[];
  posX?: number;
  posZ?: number;
  lapNumber?: number;
  sessionType?: number;
}

// ── geometry helpers ──────────────────────────────────────────────────────────

function bounds(pts: Pt[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

// Find the rotation (0–179°) that maximises fill of the canvas.
function bestAngle(centerline: Pt[], W: number, H: number, pad = 16): number {
  let best = 0, bestScale = 0;
  for (let deg = 0; deg < 180; deg++) {
    const r = (deg * Math.PI) / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of centerline) {
      const rx = x * cos - y * sin, ry = x * sin + y * cos;
      if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
    }
    const s = Math.min((W - pad * 2) / (maxX - minX || 1), (H - pad * 2) / (maxY - minY || 1));
    if (s > bestScale) { bestScale = s; best = r; }
  }
  return best;
}

// Rotate all points by angle then scale/offset to fill the canvas.
// Uses the bounding box of `refPts` (usually all edge points combined) for the transform.
function project(pts: Pt[], angle: number, scale: number, offX: number, offY: number): Pt[] {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return pts.map(([x, y]) => {
    const rx = x * cos - y * sin, ry = x * sin + y * cos;
    return [rx * scale + offX, ry * scale + offY];
  });
}

function buildScreenGeometry(outline: TrackOutline, W: number, H: number, pad = 16) {
  const angle = bestAngle(outline.centerline, W, H, pad);
  const cos = Math.cos(angle), sin = Math.sin(angle);

  // Rotate all edge points to find the real bounding box of the track shape
  const allRot: Pt[] = [...outline.edge_right, ...outline.edge_left].map(([x, y]) => [
    x * cos - y * sin, x * sin + y * cos,
  ]);
  const b = bounds(allRot);
  const rangeX = b.maxX - b.minX || 1, rangeY = b.maxY - b.minY || 1;
  const scale = Math.min((W - pad * 2) / rangeX, (H - pad * 2) / rangeY);
  const offX = (W - rangeX * scale) / 2 - b.minX * scale;
  const offY = (H - rangeY * scale) / 2 - b.minY * scale;

  return {
    edgeRight: project(outline.edge_right, angle, scale, offX, offY),
    edgeLeft:  project(outline.edge_left,  angle, scale, offX, offY),
    centerline: project(outline.centerline, angle, scale, offX, offY),
  };
}

function interpCenterline(centerline: Pt[], t: number): Pt {
  const n = centerline.length;
  if (n === 0) return [0, 0];
  const raw = Math.max(0, Math.min(1, t)) * (n - 1);
  const lo = Math.floor(raw), hi = Math.min(lo + 1, n - 1);
  const f = raw - lo;
  return [centerline[lo][0] + (centerline[hi][0] - centerline[lo][0]) * f,
          centerline[lo][1] + (centerline[hi][1] - centerline[lo][1]) * f];
}

function strokePoly(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
}

// ── component ─────────────────────────────────────────────────────────────────

interface GeoCache {
  trackId: number; W: number; H: number; dpr: number;
  edgeRight: Pt[]; edgeLeft: Pt[]; centerline: Pt[];
}

function TrackMap({
  trackId,
  trackLength,
  playerCarIndex = 0,
  allLapDistances,
  carTeamIds,
  posX = 0,
  posZ = 0,
  lapNumber,
  sessionType,
}: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const needsDraw  = useRef(true);
  const geoCache   = useRef<GeoCache | null>(null);

  // Live-trace state (fallback for missing tracks)
  const traceCurrentRef = useRef<Pt[]>([]);
  const tracePrevRef    = useRef<Pt[]>([]);
  const lastLapRef      = useRef<number | undefined>(undefined);
  const lastTrackRef    = useRef<number | undefined>(undefined);
  const lastSessRef     = useRef<number | undefined>(undefined);
  const traceBounds     = useRef({ minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });

  const propsRef = useRef({ trackId, trackLength, playerCarIndex, allLapDistances, carTeamIds, posX, posZ, lapNumber, sessionType });
  propsRef.current = { trackId, trackLength, playerCarIndex, allLapDistances, carTeamIds, posX, posZ, lapNumber, sessionType };

  // ── rAF draw loop ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rafId = 0;
    let lastW = 0, lastH = 0, lastDpr = 0;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr  = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const W = rect.width, H = rect.height;

      // Resize canvas only when CSS dimensions or DPR actually change
      if (W !== lastW || H !== lastH || dpr !== lastDpr) {
        lastW = W; lastH = H; lastDpr = dpr;
        canvas.width  = W * dpr;
        canvas.height = H * dpr;
        geoCache.current = null; // canvas changed → rebuild geometry
      }

      // Reset transform before clearing so clearRect always covers the full canvas
      ctx.resetTransform();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const { trackId: tid, trackLength: tlen, playerCarIndex: pci, allLapDistances: dists, carTeamIds: teams, posX: px, posZ: pz } = propsRef.current;
      const outline = tid !== undefined ? outlines[String(tid)] : undefined;

      if (outline) {
        // ── Rebuild geometry cache when track or canvas changes ───────────────
        const cache = geoCache.current;
        if (!cache || cache.trackId !== tid || cache.W !== W || cache.H !== H || cache.dpr !== dpr) {
          const g = buildScreenGeometry(outline, W, H);
          geoCache.current = { trackId: tid as number, W, H, dpr, ...g };
        }
        const geo = geoCache.current!;

        // Fill between edges
        ctx.beginPath();
        ctx.moveTo(geo.edgeRight[0][0], geo.edgeRight[0][1]);
        for (let i = 1; i < geo.edgeRight.length; i++) ctx.lineTo(geo.edgeRight[i][0], geo.edgeRight[i][1]);
        for (let i = geo.edgeLeft.length - 1; i >= 0; i--) ctx.lineTo(geo.edgeLeft[i][0], geo.edgeLeft[i][1]);
        ctx.closePath();
        ctx.fillStyle = 'rgba(14,22,32,0.85)';
        ctx.fill();

        // Edge strokes
        ctx.strokeStyle = '#243856';
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        strokePoly(ctx, geo.edgeRight); ctx.stroke();
        strokePoly(ctx, geo.edgeLeft);  ctx.stroke();

        // Start/finish line
        ctx.beginPath();
        ctx.moveTo(geo.edgeRight[0][0], geo.edgeRight[0][1]);
        ctx.lineTo(geo.edgeLeft[0][0],  geo.edgeLeft[0][1]);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Car dots (positioned by lap_distance along screen-space centerline)
        if (dists && tlen && tlen > 0) {
          for (let i = 0; i < dists.length; i++) {
            if (dists[i] <= 0) continue;
            const t = Math.max(0, Math.min(1, dists[i] / tlen));
            const [sx, sy] = interpCenterline(geo.centerline, t);
            const isPlayer = i === pci;
            const color = teamColor(teams?.[i] as number | undefined);

            if (isPlayer) {
              // White highlight ring
              ctx.beginPath();
              ctx.arc(sx, sy, 7.5, 0, Math.PI * 2);
              ctx.strokeStyle = 'rgba(255,255,255,0.9)';
              ctx.lineWidth = 2;
              ctx.stroke();
              // Glow
              ctx.beginPath();
              ctx.arc(sx, sy, 5, 0, Math.PI * 2);
              ctx.fillStyle = `${color}55`;
              ctx.fill();
              // Core dot
              ctx.beginPath();
              ctx.arc(sx, sy, 5, 0, Math.PI * 2);
              ctx.fillStyle = color;
              ctx.fill();
            } else {
              ctx.beginPath();
              ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
              ctx.fillStyle = color;
              ctx.fill();
            }
          }
        }

      } else {
        // ── Live-trace fallback ───────────────────────────────────────────────
        const current = traceCurrentRef.current;
        const previous = tracePrevRef.current;

        if (current.length + previous.length < 2) {
          ctx.strokeStyle = '#1A2840';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(W / 2, H / 2, 24, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#4A6078';
          ctx.font = '10px "Barlow Condensed", monospace';
          ctx.textAlign = 'center';
          ctx.fillText('WAITING FOR GPS', W / 2, H / 2 + 4);
          return;
        }

        const b = traceBounds.current;
        const pad = 10;
        const rangeX = (b.maxX === -Infinity ? 1 : b.maxX) - (b.minX === Infinity ? 0 : b.minX) || 1;
        const rangeZ = (b.maxZ === -Infinity ? 1 : b.maxZ) - (b.minZ === Infinity ? 0 : b.minZ) || 1;
        const sc = Math.min((W - pad * 2) / rangeX, (H - pad * 2) / rangeZ);
        const ox = (W - rangeX * sc) / 2 - (b.minX === Infinity ? 0 : b.minX) * sc;
        const oz = (H - rangeZ * sc) / 2 - (b.minZ === Infinity ? 0 : b.minZ) * sc;
        const ts = ([x, z]: Pt): Pt => [x * sc + ox, z * sc + oz];

        if (previous.length >= 2) {
          strokePoly(ctx, previous.map(ts));
          ctx.strokeStyle = '#1A2840'; ctx.lineWidth = 2; ctx.stroke();
        }
        if (current.length >= 2) {
          strokePoly(ctx, current.map(ts));
          ctx.strokeStyle = '#1166FF'; ctx.lineWidth = 2.5; ctx.stroke();
          const recent = current.slice(-80).map(ts);
          for (let i = 1; i < recent.length; i++) {
            ctx.beginPath();
            ctx.moveTo(recent[i-1][0], recent[i-1][1]);
            ctx.lineTo(recent[i][0],   recent[i][1]);
            ctx.strokeStyle = `rgba(0,229,255,${(i / recent.length) * 0.9})`;
            ctx.lineWidth = 2; ctx.stroke();
          }
        }
        if (px !== 0 || pz !== 0) {
          const [cx, cy] = ts([px, pz]);
          ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,107,0,0.3)'; ctx.fill();
          ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#ff6b00'; ctx.fill();
        }
      }
    };

    const loop = () => {
      if (document.visibilityState === 'visible' && needsDraw.current) {
        needsDraw.current = false;
        draw();
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    const onVis = () => { if (document.visibilityState === 'visible') needsDraw.current = true; };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelAnimationFrame(rafId); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  // ── React effect: update live-trace data + mark dirty ─────────────────────
  useEffect(() => {
    const { trackId: tid, sessionType: st, lapNumber: ln, posX: px, posZ: pz } = propsRef.current;
    const hasBaked = tid !== undefined && outlines[String(tid)] !== undefined;

    if (hasBaked) {
      needsDraw.current = true;
      return;
    }

    const trackChanged = tid !== undefined && lastTrackRef.current !== undefined && tid !== lastTrackRef.current;
    const sessChanged  = st  !== undefined && lastSessRef.current  !== undefined && st  !== lastSessRef.current;
    if (trackChanged || sessChanged) {
      traceCurrentRef.current = [];
      tracePrevRef.current    = [];
      traceBounds.current     = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    }
    lastTrackRef.current = tid;
    lastSessRef.current  = st;

    if (ln !== undefined && lastLapRef.current !== undefined && ln !== lastLapRef.current && traceCurrentRef.current.length > 0) {
      tracePrevRef.current    = traceCurrentRef.current;
      traceCurrentRef.current = [];
      traceBounds.current     = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    }
    lastLapRef.current = ln;

    if (px !== 0 || pz !== 0) {
      traceCurrentRef.current.push([px, pz]);
      const b = traceBounds.current;
      if (px < b.minX) b.minX = px; if (px > b.maxX) b.maxX = px;
      if (pz < b.minZ) b.minZ = pz; if (pz > b.maxZ) b.maxZ = pz;
    }
    needsDraw.current = true;
  }, [trackId, trackLength, playerCarIndex, allLapDistances, carTeamIds, posX, posZ, lapNumber, sessionType]);

  return (
    <div className="flex flex-col h-full">
      <canvas ref={canvasRef} className="flex-1 w-full min-h-[120px] bg-motorsport-black" />
    </div>
  );
}

export const MiniTrackMapMemo = memo(TrackMap);
