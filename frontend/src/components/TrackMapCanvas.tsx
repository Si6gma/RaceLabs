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

import { teamColor } from '@/utils/teams';
import type { DrsZone } from '@/utils/sectorLines';

// Centerline points between two lap fractions, for stroking a stretch of track.
function centerlineSpan(centerline: Pt[], arcLengths: number[], t0: number, t1: number): Pt[] {
  const pts: Pt[] = [interpCenterline(centerline, arcLengths, t0)];
  for (let i = 0; i < centerline.length; i++) {
    if (arcLengths[i] > t0 && arcLengths[i] < t1) pts.push(centerline[i]);
  }
  pts.push(interpCenterline(centerline, arcLengths, t1));
  return pts;
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
  /** Sector 1 and sector 2 end, metres from the start line, once learned. */
  sectorDistances?: [number | null, number | null];
  /** DRS zones as activation point and end, metres from the start line. */
  drsZones?: DrsZone[];
}

// Nearest point on a polyline to p: used to stretch a sector line edge to edge.
function nearest(poly: Pt[], p: Pt): Pt {
  let best = poly[0], bestD = Infinity;
  for (const q of poly) {
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
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

// Scale and offset points to fill the canvas. Track data is pre-oriented to each
// circuit's real-world orientation, so no rotation is applied.
function project(pts: Pt[], scale: number, offX: number, offY: number): Pt[] {
  return pts.map(([x, y]) => [x * scale + offX, y * scale + offY] as Pt);
}

function buildScreenGeometry(outline: TrackOutline, W: number, H: number, pad = 16) {
  // Bounding box of the whole track shape (both edges)
  const b = bounds([...outline.edge_right, ...outline.edge_left]);
  const rangeX = b.maxX - b.minX || 1, rangeY = b.maxY - b.minY || 1;
  const scale = Math.min((W - pad * 2) / rangeX, (H - pad * 2) / rangeY);
  const offX = (W - rangeX * scale) / 2 - b.minX * scale;
  const offY = (H - rangeY * scale) / 2 - b.minY * scale;

  const centerline = project(outline.centerline, scale, offX, offY);

  return {
    edgeRight: project(outline.edge_right, scale, offX, offY),
    edgeLeft:  project(outline.edge_left,  scale, offX, offY),
    centerline,
    arcLengths: cumulativeLengths(centerline),
  };
}

// Cumulative distance along a polyline, normalised to 0..1. Centerline points are
// not evenly spaced (long straights are sampled sparsely), so lap distance has to
// be looked up by arc length rather than by point index.
function cumulativeLengths(pts: Pt[]): number[] {
  const out = new Array<number>(pts.length);
  out[0] = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
    out[i] = out[i - 1] + Math.hypot(dx, dy);
  }
  const total = out[out.length - 1] || 1;
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function interpCenterline(centerline: Pt[], arcLengths: number[], t: number): Pt {
  const n = centerline.length;
  if (n === 0) return [0, 0];
  const target = Math.max(0, Math.min(1, t));

  // Binary search for the segment containing `target`
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arcLengths[mid] <= target) lo = mid; else hi = mid;
  }

  const span = arcLengths[hi] - arcLengths[lo];
  const f = span > 0 ? (target - arcLengths[lo]) / span : 0;
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
  edgeRight: Pt[]; edgeLeft: Pt[]; centerline: Pt[]; arcLengths: number[];
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
  sectorDistances,
  drsZones,
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

  const propsRef = useRef({ trackId, trackLength, playerCarIndex, allLapDistances, carTeamIds, posX, posZ, lapNumber, sessionType, sectorDistances, drsZones });
  propsRef.current = { trackId, trackLength, playerCarIndex, allLapDistances, carTeamIds, posX, posZ, lapNumber, sessionType, sectorDistances, drsZones };

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

      const { trackId: tid, trackLength: tlen, playerCarIndex: pci, allLapDistances: dists, carTeamIds: teams, posX: px, posZ: pz, sectorDistances: sectors, drsZones: zones } = propsRef.current;
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
        ctx.fillStyle = '#141B24';
        ctx.fill();

        // Edge strokes
        ctx.strokeStyle = '#3A4A5C';
        ctx.lineWidth = 2;
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

        // DRS zones: a green band along the centerline from the activation
        // point to where cars close it, with a tick at the activation point.
        if (zones && tlen && tlen > 0) {
          for (const zone of zones) {
            const t0 = zone.start / tlen;
            const t1 = (zone.end ?? Math.min(tlen, zone.start + 120)) / tlen;
            const span = centerlineSpan(geo.centerline, geo.arcLengths, t0, t1);
            ctx.beginPath();
            ctx.moveTo(span[0][0], span[0][1]);
            for (let i = 1; i < span.length; i++) ctx.lineTo(span[i][0], span[i][1]);
            ctx.strokeStyle = zone.end == null ? 'rgba(0,232,90,0.35)' : 'rgba(0,232,90,0.6)';
            ctx.lineWidth = 6;
            ctx.lineCap = 'butt';
            ctx.stroke();
            const c = span[0];
            const a = nearest(geo.edgeLeft, c);
            const b = nearest(geo.edgeRight, c);
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.strokeStyle = '#00E85A';
            ctx.lineWidth = 2;
            ctx.stroke();
            const nx = a[0] - b[0], ny = a[1] - b[1];
            const len = Math.hypot(nx, ny) || 1;
            ctx.fillStyle = '#00E85A';
            ctx.font = '700 11px "Barlow Condensed", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('DRS', a[0] + (nx / len) * 14, a[1] + (ny / len) * 14);
          }
        }

        // Sector lines, edge to edge, once the boundaries have been learned
        if (sectors && tlen && tlen > 0) {
          sectors.forEach((dist, i) => {
            if (dist == null) return;
            const c = interpCenterline(geo.centerline, geo.arcLengths, dist / tlen);
            const a = nearest(geo.edgeLeft, c);
            const b = nearest(geo.edgeRight, c);
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.strokeStyle = '#9AACBE';
            ctx.lineWidth = 2;
            ctx.stroke();
            // Label just off the outside of the line
            const nx = b[0] - a[0], ny = b[1] - a[1];
            const len = Math.hypot(nx, ny) || 1;
            ctx.fillStyle = '#9AACBE';
            ctx.font = '600 12px "Barlow Condensed", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`S${i + 1}`, b[0] + (nx / len) * 12, b[1] + (ny / len) * 12);
          });
        }

        // Car dots (positioned by lap_distance along screen-space centerline)
        if (dists && tlen && tlen > 0) {
          for (let i = 0; i < dists.length; i++) {
            if (dists[i] <= 0) continue;
            const t = Math.max(0, Math.min(1, dists[i] / tlen));
            const [sx, sy] = interpCenterline(geo.centerline, geo.arcLengths, t);
            const isPlayer = i === pci;
            const color = teamColor(teams?.[i] as number | undefined);

            if (isPlayer) {
              // Orange ring: the one colour on the page that means "you"
              ctx.beginPath();
              ctx.arc(sx, sy, 10, 0, Math.PI * 2);
              ctx.strokeStyle = '#FF7A1A';
              ctx.lineWidth = 2.5;
              ctx.stroke();
              ctx.beginPath();
              ctx.arc(sx, sy, 6, 0, Math.PI * 2);
              ctx.fillStyle = color;
              ctx.fill();
            } else {
              ctx.beginPath();
              ctx.arc(sx, sy, 5, 0, Math.PI * 2);
              ctx.fillStyle = color;
              ctx.fill();
              ctx.strokeStyle = '#07090C';
              ctx.lineWidth = 1.5;
              ctx.stroke();
            }
          }
        }

      } else {
        // ── Live-trace fallback ───────────────────────────────────────────────
        const current = traceCurrentRef.current;
        const previous = tracePrevRef.current;

        if (current.length + previous.length < 2) {
          ctx.fillStyle = '#9AACBE';
          ctx.font = '600 14px "Barlow Condensed", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Waiting for position data', W / 2, H / 2 + 5);
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
