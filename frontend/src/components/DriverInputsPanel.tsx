import { memo, useLayoutEffect, useRef } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { formatGear } from '@/utils/formatters';

const GREEN = '#00E85A';
const RED   = '#FF2044';
const BLUE  = '#4D8BFF';
const OFF   = '#1E2834';

// F1 23/24 power units limit at 13,000 rpm; the car status packet carries the
// exact figure once the backend forwards it.
const DEFAULT_REDLINE = 13000;

// ── Rev bar: shift lights and tachometer in one strip ────────────────────────
// Fifteen lamps, five per colour, lit against the redline as the real dash is.
const SEGMENTS = 15;
const PER_ZONE = 5;

function RevBar({ rpm, revPercent }: { rpm: number; revPercent: number }) {
  const lit = Math.round((revPercent / 100) * SEGMENTS);
  return (
    <div className="flex flex-col gap-2 px-3 pt-3 pb-3 border-b border-motorsport-border">
      <div className="flex gap-[3px] items-stretch w-full h-[14px]">
        {Array.from({ length: SEGMENTS }).map((_, i) => {
          const isLit = i < lit;
          const zone  = i < PER_ZONE ? GREEN : i < PER_ZONE * 2 ? RED : BLUE;
          return (
            <div
              key={i}
              className="flex-1 transition-colors duration-50"
              style={{ backgroundColor: isLit ? zone : OFF, boxShadow: isLit ? `0 0 8px ${zone}99` : 'none' }}
            />
          );
        })}
      </div>
      <span className="font-telemetry text-[18px] font-semibold tabular-nums leading-none text-motorsport-text">
        {rpm.toLocaleString()}
        <span className="text-[12px] text-motorsport-muted font-medium ml-1">rpm</span>
      </span>
    </div>
  );
}

// ── Throttle and brake on one track, filling from opposite ends ──────────────
function PedalBar({ throttle, brake }: { throttle: number; brake: number }) {
  const tp = Math.min(100, Math.max(0, throttle * 100));
  const bp = Math.min(100, Math.max(0, brake * 100));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-[10px] bg-motorsport-dark overflow-hidden">
        <div className="absolute inset-y-0 left-0 transition-[width] duration-75 ease-linear"  style={{ width: `${tp}%`, backgroundColor: GREEN }} />
        <div className="absolute inset-y-0 right-0 transition-[width] duration-75 ease-linear" style={{ width: `${bp}%`, backgroundColor: RED, opacity: 0.95 }} />
      </div>
      <div className="flex items-baseline justify-between">
        <span className="font-telemetry text-[16px] font-semibold tabular-nums leading-none" style={{ color: GREEN }}>{tp.toFixed(0)}%</span>
        <span className="font-telemetry text-[16px] font-semibold tabular-nums leading-none" style={{ color: RED }}>{bp.toFixed(0)}%</span>
      </div>
    </div>
  );
}

// ── Micro-trace (SVG) ─────────────────────────────────────────────────────────
const TRACE_FRAMES = 80;
const TRACE_W = 120;
const TRACE_H = 44;

function MicroTrace({ frames }: { frames: { throttle: number; brake: number }[] }) {
  if (frames.length < 2) return <svg width="100%" height={TRACE_H} />;
  const n = frames.length;
  const toX = (i: number) => (i / (n - 1)) * TRACE_W;
  const toY = (v: number) => TRACE_H - 2 - v * (TRACE_H - 4);

  let tp = `M${toX(0)},${toY(frames[0].throttle)}`;
  let bp = `M${toX(0)},${toY(frames[0].brake)}`;
  for (let i = 1; i < n; i++) {
    tp += ` L${toX(i)},${toY(frames[i].throttle)}`;
    bp += ` L${toX(i)},${toY(frames[i].brake)}`;
  }

  return (
    <svg width="100%" height={TRACE_H} viewBox={`0 0 ${TRACE_W} ${TRACE_H}`} preserveAspectRatio="none" className="overflow-visible">
      <path d={tp} fill="none" stroke={GREEN} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <path d={bp} fill="none" stroke={RED}   strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function GValue({ label, value, alert, unit }: { label: string; value: number; alert: boolean; unit?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="eng-label">{label}</span>
      <span className="font-telemetry text-[15px] tabular-nums leading-none" style={{ color: alert ? RED : '#E8EEF4' }}>
        {value >= 0 && !unit ? '+' : ''}{value.toFixed(2)}{unit ?? ''}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function DriverInputsPanel() {
  const t = useTelemetryStore(s => s.currentFrame?.telemetry);
  const m = useTelemetryStore(s => s.currentFrame?.motion);
  const maxRpm = useTelemetryStore(s => s.currentFrame?.status?.max_rpm);

  const speed    = t?.speed    ?? 0;
  const gear     = t?.gear     ?? 0;
  const rpm      = t?.engine_rpm ?? 0;
  const redline  = maxRpm && maxRpm > 0 ? maxRpm : DEFAULT_REDLINE;
  const revPct   = t?.rev_lights_percent ?? Math.min(100, (rpm / redline) * 100);
  const throttle = t?.throttle ?? 0;
  const brake    = t?.brake    ?? 0;
  const latG     = m?.g_force_lat ?? 0;
  const lonG     = m?.g_force_lon ?? 0;
  const gMag     = Math.sqrt(latG * latG + lonG * lonG);

  // Accumulate micro-trace in a ref — avoids subscribing to the 1000-frame
  // frameHistory array and re-running a .slice().map() on every update.
  const traceRef = useRef<{ throttle: number; brake: number }[]>([]);
  useLayoutEffect(() => {
    const entry = { throttle, brake };
    const cur = traceRef.current;
    traceRef.current = cur.length >= TRACE_FRAMES
      ? [...cur.slice(1), entry]
      : [...cur, entry];
  }, [throttle, brake]);

  return (
    <div className="telemetry-panel flex flex-col overflow-hidden">
      <RevBar rpm={rpm} revPercent={revPct} />

      <div className="flex flex-col gap-4 p-3">
        {/* Speed + gear: read from across the room */}
        <div className="flex items-end justify-between shrink-0">
          <div className="flex items-baseline gap-1.5">
            <span className="font-telemetry font-bold leading-none tabular-nums text-motorsport-text" style={{ fontSize: '56px' }}>
              {speed.toFixed(0)}
            </span>
            <span className="text-[13px] text-motorsport-muted font-semibold">km/h</span>
          </div>
          <span className="font-telemetry font-bold leading-none tabular-nums text-motorsport-text" style={{ fontSize: '56px' }}>
            {formatGear(gear)}
          </span>
        </div>

        {/* Pedals: bar now, trace of the last few seconds beneath it */}
        <div className="flex flex-col gap-2 shrink-0">
          <PedalBar throttle={throttle} brake={brake} />
          <div className="bg-motorsport-dark px-2 py-1.5">
            <MicroTrace frames={traceRef.current} />
          </div>
        </div>

        {/* G-Force */}
        <div className="pt-3 border-t border-motorsport-border grid grid-cols-3 gap-2 shrink-0">
          <GValue label="Lat G" value={latG} alert={Math.abs(latG) > 3} />
          <GValue label="Lon G" value={lonG} alert={lonG < -2} />
          <GValue label="Total" value={gMag} alert={false} unit="G" />
        </div>
      </div>
    </div>
  );
}

export default memo(DriverInputsPanel);
