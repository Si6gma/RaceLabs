import { memo, useEffect, useRef } from 'react';
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
  { key: 'speed_kmh', label: 'Speed', color: '#60a5fa', min: 0, max: 350, scale: 1.0, offset: 0, unit: ' km/h', decimals: 0 },
  { key: 'rpm', label: 'RPM', color: '#c084fc', min: 0, max: 15000, scale: 1.0, offset: 0, unit: '', decimals: 0 },
  { key: 'throttle', label: 'Throttle', color: '#4ade80', min: 0, max: 1, scale: 0.22, offset: 0.78, unit: '%', transform: v => v * 100, decimals: 0 },
  { key: 'brake', label: 'Brake', color: '#f87171', min: 0, max: 1, scale: 0.22, offset: 0.78, unit: '%', transform: v => v * 100, decimals: 0 },
  { key: 'steering', label: 'Steering', color: '#22d3ee', min: -1, max: 1, scale: 0.35, offset: 0.325, unit: '%', transform: v => v * 100, decimals: 0 },
  { key: 'gear', label: 'Gear', color: '#fb923c', min: 0, max: 8, scale: 0.18, offset: 0.8, unit: '', decimals: 0 },
  { key: 'gforce_lat', label: 'G-Force', color: '#e879f9', min: 0, max: 6, scale: 0.22, offset: 0, unit: 'G', decimals: 2 },
  { key: 'delta_time', label: 'Delta', color: '#94a3b8', min: -5, max: 5, scale: 0.3, offset: 0.35, unit: 's', decimals: 3 },
];

export const DEFAULT_VISIBLE = new Set(['speed_kmh', 'throttle', 'brake']);

// Recorded.tsx mirrors left/right in its GRAPH_PAD for the cursor maths.
const PAD = { top: 20, right: 60, bottom: 40, left: 50 };
const BAND_GAP = 4;
const GRID_COLS = 8;
const X_TICKS = 6;
const CURSOR_DOT_RADIUS = 3;
const REF_LINE_WIDTH = 2;
const LINE_WIDTH = 1.5;
const DELTA_MIN_RANGE = 0.5;

const LABEL_FONT = '600 12px "Barlow Condensed", sans-serif';
const AXIS_FONT  = '12px "JetBrains Mono", monospace';
const BG          = '#0D1117';
const GRID        = '#1E2834';
const GRID_STRONG = '#2A3745';
const AXIS_TEXT   = '#9AACBE';
const CURSOR      = 'rgba(232, 238, 244, 0.6)';
const DELTA_LOSS  = 'rgba(255, 32, 68, 0.22)';
const DELTA_GAIN  = 'rgba(0, 232, 90, 0.22)';

interface LapData {
  data: TelemetryPoint[];
  color: string;
}

interface Props {
  laps: LapData[];
  visibleChannels: Set<string>;
  zoomRange: [number, number];
  effectivePosition: number;
  cursorLocked: boolean;
  xField?: 'normalized_track_position' | 'timestamp';
  timeWindow?: number; // seconds, for time-based graphs
}

// ── Layout ───────────────────────────────────────────────────────────────────

interface BandChannel {
  def: ChannelDef;
  min: number;
  max: number;
}

interface Band {
  top: number;
  height: number;
  channels: BandChannel[];
}

interface Layout {
  width: number;
  height: number;
  graphWidth: number;
  graphHeight: number;
  bands: Band[];
}

const isPedal = (ch: ChannelDef) => ch.key === 'throttle' || ch.key === 'brake';

function deltaRange(laps: LapData[]): number {
  const peak = laps.reduce((acc, lap) =>
    lap.data.reduce((m, s) => {
      const d = Math.abs(s.delta_time ?? 0);
      return Number.isFinite(d) && d > m ? d : m;
    }, acc), 0);
  return Math.max(DELTA_MIN_RANGE, Math.ceil(peak));
}

function channelRange(def: ChannelDef, laps: LapData[]): BandChannel {
  if (def.key !== 'delta_time') return { def, min: def.min, max: def.max };
  const r = deltaRange(laps);
  return { def, min: -r, max: r };
}

// Visible channels in CHANNELS order, one band each; throttle and brake share.
function groupChannels(visibleChannels: Set<string>): ChannelDef[][] {
  return CHANNELS
    .filter(ch => visibleChannels.has(ch.key as string))
    .reduce<ChannelDef[][]>((groups, ch) => {
      const sharedIdx = isPedal(ch) ? groups.findIndex(g => g.some(isPedal)) : -1;
      if (sharedIdx === -1) return [...groups, [ch]];
      return groups.map((g, i) => (i === sharedIdx ? [...g, ch] : g));
    }, []);
}

function buildLayout(width: number, height: number, visibleChannels: Set<string>, laps: LapData[]): Layout {
  const graphWidth = width - PAD.left - PAD.right;
  const graphHeight = height - PAD.top - PAD.bottom;
  const groups = groupChannels(visibleChannels);
  const n = groups.length;
  const bandHeight = n > 0 ? (graphHeight - BAND_GAP * (n - 1)) / n : 0;
  const bands = groups.map((group, i) => ({
    top: PAD.top + i * (bandHeight + BAND_GAP),
    height: bandHeight,
    channels: group.map(def => channelRange(def, laps)),
  }));
  return { width, height, graphWidth, graphHeight, bands };
}

const toY = (band: Band, ch: BandChannel, val: number) =>
  band.top + band.height * (1 - (val - ch.min) / (ch.max - ch.min));

// ── X mapping ────────────────────────────────────────────────────────────────

interface XMapper {
  isTimeBased: boolean;
  timeMin: number;
  timeMax: number;
  timeSpan: number;
  norm: (s: TelemetryPoint) => number;
}

function buildXMapper(laps: LapData[], xField: Props['xField'], timeWindow?: number): XMapper {
  const isTimeBased = xField === 'timestamp';
  const ref = laps[0];
  if (!isTimeBased || !ref || ref.data.length === 0) {
    return { isTimeBased, timeMin: 0, timeMax: 1, timeSpan: 1, norm: s => s.normalized_track_position };
  }
  const timeMax = ref.data[ref.data.length - 1].timestamp ?? 0;
  // Anchor the domain to a fixed window so the graph scrolls smoothly
  const timeSpan = Math.max(1e-9, timeWindow ?? (timeMax - (ref.data[0].timestamp ?? 0)));
  const timeMin = timeMax - timeSpan;
  return { isTimeBased, timeMin, timeMax, timeSpan, norm: s => ((s.timestamp ?? timeMin) - timeMin) / timeSpan };
}

// Index range covering [zStart, zEnd] with one sample of slack either side.
function visibleRange(samples: TelemetryPoint[], norm: XMapper['norm'], zStart: number, zEnd: number): [number, number] {
  const last = samples.length - 1;
  const first = samples.findIndex(s => norm(s) >= zStart);
  const startI = first === -1 ? 0 : Math.max(0, first - 1);
  let endI = last;
  for (let i = last; i >= 0; i--) {
    if (norm(samples[i]) <= zEnd) { endI = Math.min(last, i + 1); break; }
  }
  return [startI, endI];
}

// Nearest sample to a normalised x position (samples are monotonic in x).
function sampleNear(samples: TelemetryPoint[], norm: XMapper['norm'], pos: number): TelemetryPoint | null {
  if (samples.length === 0) return null;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (norm(samples[mid]) < pos) lo = mid + 1; else hi = mid;
  }
  const prev = samples[lo - 1];
  if (prev && Math.abs(norm(prev) - pos) < Math.abs(norm(samples[lo]) - pos)) return prev;
  return samples[lo];
}

// ── Canvas helpers ───────────────────────────────────────────────────────────

function prepareCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  // Reallocating the bitmap is the expensive part; only do it when the box or dpr changed.
  const targetW = Math.round(rect.width * dpr);
  const targetH = Math.round(rect.height * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

const crisp = (v: number) => Math.round(v) + 0.5;

const fmtTick = (ch: ChannelDef, v: number) => {
  const t = ch.transform ? ch.transform(v) : v;
  return Number.isInteger(t) ? String(t) : t.toFixed(1);
};

const fmtDistance = (dist: number) => (dist >= 1000 ? `${(dist / 1000).toFixed(2)} km` : `${Math.round(dist)} m`);

// ── Data layer ───────────────────────────────────────────────────────────────

function drawGrid(ctx: CanvasRenderingContext2D, layout: Layout) {
  const { graphWidth, graphHeight, bands } = layout;
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID_COLS; i++) {
    const x = crisp(PAD.left + (i / GRID_COLS) * graphWidth);
    ctx.beginPath();
    ctx.moveTo(x, PAD.top);
    ctx.lineTo(x, PAD.top + graphHeight);
    ctx.stroke();
  }
  ctx.strokeStyle = GRID_STRONG;
  bands.slice(1).forEach(band => {
    const y = crisp(band.top - BAND_GAP / 2);
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + graphWidth, y);
    ctx.stroke();
  });
}

function drawBandLabels(ctx: CanvasRenderingContext2D, layout: Layout) {
  const { graphWidth, bands } = layout;
  for (const band of bands) {
    // Channel names on the right, one line per channel in the band
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    band.channels.forEach((ch, row) => {
      ctx.fillStyle = ch.def.color;
      ctx.fillText(ch.def.label, PAD.left + graphWidth + 8, band.top + 14 + row * 16);
    });
    // Max at the top and min at the bottom on the left; a shared band has one scale
    const axis = band.channels[0];
    ctx.font = AXIS_FONT;
    ctx.fillStyle = AXIS_TEXT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(fmtTick(axis.def, axis.max), PAD.left - 8, band.top);
    ctx.textBaseline = 'bottom';
    ctx.fillText(fmtTick(axis.def, axis.min), PAD.left - 8, band.top + band.height);
  }
}

function tracePath(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
}

function fillDelta(ctx: CanvasRenderingContext2D, band: Band, pts: [number, number][], zeroY: number) {
  const first = pts[0][0];
  const last = pts[pts.length - 1][0];
  const fillSide = (clipTop: number, clipBottom: number, color: string) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.left, clipTop, last - first + 2, clipBottom - clipTop);
    ctx.clip();
    tracePath(ctx, pts);
    ctx.lineTo(last, zeroY);
    ctx.lineTo(first, zeroY);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  };
  fillSide(band.top, zeroY, DELTA_LOSS);                 // above zero: losing time
  fillSide(zeroY, band.top + band.height, DELTA_GAIN);   // below zero: gaining
}

function drawBand(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  band: Band,
  laps: LapData[],
  xm: XMapper,
  zoomRange: [number, number],
) {
  const [zStart, zEnd] = zoomRange;
  const xScale = layout.graphWidth / Math.max(1e-9, zEnd - zStart);
  const toX = (s: TelemetryPoint) => PAD.left + (xm.norm(s) - zStart) * xScale;
  const shared = band.channels.length > 1;

  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.left, band.top, layout.graphWidth, band.height);
  ctx.clip();
  ctx.lineJoin = 'round';

  for (const ch of band.channels) {
    const isDelta = ch.def.key === 'delta_time';
    const zeroY = isDelta ? crisp(toY(band, ch, 0)) : 0;
    if (isDelta) {
      ctx.strokeStyle = GRID_STRONG;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.left, zeroY);
      ctx.lineTo(PAD.left + layout.graphWidth, zeroY);
      ctx.stroke();
    }

    laps.forEach((lap, lapIdx) => {
      const samples = lap.data;
      if (samples.length < 2) return;
      const [startI, endI] = visibleRange(samples, xm.norm, zStart, zEnd);
      const pts: [number, number][] = [];
      for (let i = startI; i <= endI; i++) {
        const s = samples[i];
        pts.push([toX(s), toY(band, ch, s[ch.def.key] as number)]);
      }
      if (pts.length < 2) return;

      if (isDelta) fillDelta(ctx, band, pts, zeroY);

      // Every lap keeps its own colour in every band; the reference lap is heavier.
      // In the shared pedal band the brake trace is dashed so the two can be told apart.
      ctx.strokeStyle = lap.color;
      ctx.lineWidth = lapIdx === 0 ? REF_LINE_WIDTH : LINE_WIDTH;
      ctx.setLineDash(shared && ch.def.key === 'brake' ? [4, 3] : []);
      tracePath(ctx, pts);
      ctx.stroke();
    });
  }

  ctx.setLineDash([]);
  ctx.restore();
}

function drawXAxis(ctx: CanvasRenderingContext2D, layout: Layout, laps: LapData[], xm: XMapper, zoomRange: [number, number]) {
  const ref = laps[0];
  if (!ref || ref.data.length === 0) return;
  const [zStart, zEnd] = zoomRange;
  const posSpan = Math.max(1e-9, zEnd - zStart);
  ctx.fillStyle = AXIS_TEXT;
  ctx.font = AXIS_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (let t = 0; t <= X_TICKS; t++) {
    const targetPos = zStart + (t / X_TICKS) * posSpan;
    const x = PAD.left + (t / X_TICKS) * layout.graphWidth;
    const label = xm.isTimeBased
      ? `${(xm.timeMin + targetPos * xm.timeSpan - xm.timeMax).toFixed(0)}s`
      : fmtDistance(ref.data[Math.max(0, Math.min(ref.data.length - 1, Math.round(targetPos * (ref.data.length - 1))))]?.cumulative_distance ?? 0);
    ctx.fillText(label, x, PAD.top + layout.graphHeight + 16);
  }
}

function drawData(canvas: HTMLCanvasElement, props: Props) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  const { ctx, width, height } = prepared;
  const { laps, visibleChannels, zoomRange, xField, timeWindow } = props;

  const layout = buildLayout(width, height, visibleChannels, laps);
  const xm = buildXMapper(laps, xField, timeWindow);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  drawGrid(ctx, layout);
  drawBandLabels(ctx, layout);
  for (const band of layout.bands) drawBand(ctx, layout, band, laps, xm, zoomRange);
  drawXAxis(ctx, layout, laps, xm, zoomRange);
}

// ── Cursor layer ─────────────────────────────────────────────────────────────

function drawCursor(canvas: HTMLCanvasElement, props: Props) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  const { ctx, width, height } = prepared;
  const { laps, visibleChannels, zoomRange, effectivePosition, cursorLocked, xField, timeWindow } = props;

  ctx.clearRect(0, 0, width, height);

  const [zStart, zEnd] = zoomRange;
  if (effectivePosition < zStart || effectivePosition > zEnd) return;

  const layout = buildLayout(width, height, visibleChannels, laps);
  const xm = buildXMapper(laps, xField, timeWindow);
  const x = PAD.left + ((effectivePosition - zStart) / Math.max(1e-9, zEnd - zStart)) * layout.graphWidth;

  ctx.strokeStyle = CURSOR;
  ctx.lineWidth = 1;
  ctx.setLineDash(cursorLocked ? [] : [4, 4]);
  ctx.beginPath();
  ctx.moveTo(x, PAD.top);
  ctx.lineTo(x, height - PAD.bottom);
  ctx.stroke();
  ctx.setLineDash([]);

  // A dot on each lap's trace in every band
  for (const band of layout.bands) {
    for (const ch of band.channels) {
      for (const lap of laps) {
        const s = sampleNear(lap.data, xm.norm, effectivePosition);
        if (!s) continue;
        const y = toY(band, ch, s[ch.def.key] as number);
        if (y < band.top || y > band.top + band.height) continue;
        ctx.fillStyle = lap.color;
        ctx.beginPath();
        ctx.arc(x, y, CURSOR_DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// ── Component ────────────────────────────────────────────────────────────────

function TelemetryGraphCanvas(props: Props) {
  const { laps, visibleChannels, zoomRange, effectivePosition, cursorLocked, xField = 'normalized_track_position', timeWindow } = props;
  const dataCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<() => void>(() => {});
  const cursorDrawRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = dataCanvasRef.current;
    if (!canvas || laps.length === 0) return;
    drawRef.current = () => drawData(canvas, { laps, visibleChannels, zoomRange, effectivePosition, cursorLocked, xField, timeWindow });
    drawRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laps, visibleChannels, zoomRange, xField, timeWindow]);

  useEffect(() => {
    const canvas = cursorCanvasRef.current;
    if (!canvas) return;
    cursorDrawRef.current = () => drawCursor(canvas, { laps, visibleChannels, zoomRange, effectivePosition, cursorLocked, xField, timeWindow });
    cursorDrawRef.current();
  }, [laps, visibleChannels, zoomRange, effectivePosition, cursorLocked, xField, timeWindow]);

  // Persistent observers, created once; they call whatever draw is current
  useEffect(() => {
    const data = dataCanvasRef.current;
    const cursor = cursorCanvasRef.current;
    if (!data || !cursor) return;
    const observer = new ResizeObserver(() => { drawRef.current(); cursorDrawRef.current(); });
    observer.observe(data);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative w-full h-full">
      <canvas ref={dataCanvasRef} className="absolute inset-0 w-full h-full block" />
      <canvas ref={cursorCanvasRef} className="absolute inset-0 w-full h-full block pointer-events-none" />
    </div>
  );
}

export default memo(TelemetryGraphCanvas);
