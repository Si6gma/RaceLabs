import { memo, useLayoutEffect, useRef } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { formatGear } from '@/utils/formatters';

// ── Shift lights ─────────────────────────────────────────────────────────────
const LED_COUNT = 15;

function ShiftLights({ revPercent }: { revPercent: number }) {
  const lit = Math.round((revPercent / 100) * LED_COUNT);
  return (
    <div className="flex gap-px items-center w-full px-2.5 py-1.5 bg-motorsport-dark/60">
      {Array.from({ length: LED_COUNT }).map((_, i) => {
        const isLit = i < lit;
        const color = isLit
          ? i < 9  ? '#00E85A'
          : i < 13 ? '#FF2044'
          :           '#00D4FF'
          : '#1A2840';
        return (
          <div
            key={i}
            className="flex-1 h-[5px] transition-colors duration-50"
            style={{
              backgroundColor: color,
              boxShadow: isLit ? `0 0 6px ${color}88` : 'none',
            }}
          />
        );
      })}
    </div>
  );
}

// ── Micro-trace (SVG) ─────────────────────────────────────────────────────────
const TRACE_FRAMES = 80;
const TRACE_W = 120;
const TRACE_H = 28;

function MicroTrace({ frames }: { frames: { throttle: number; brake: number }[] }) {
  if (frames.length < 2) return <svg width="100%" height={TRACE_H} />;
  const n = frames.length;
  const toX = (i: number) => (i / (n - 1)) * TRACE_W;
  const toY = (v: number) => TRACE_H - v * TRACE_H;

  let tp = `M${toX(0)},${toY(frames[0].throttle)}`;
  let bp = `M${toX(0)},${toY(frames[0].brake)}`;
  for (let i = 1; i < n; i++) {
    tp += ` L${toX(i)},${toY(frames[i].throttle)}`;
    bp += ` L${toX(i)},${toY(frames[i].brake)}`;
  }

  return (
    <svg width="100%" height={TRACE_H} viewBox={`0 0 ${TRACE_W} ${TRACE_H}`} preserveAspectRatio="none" className="overflow-visible">
      <path d={tp} fill="none" stroke="#00E85A" strokeWidth={1.2} />
      <path d={bp} fill="none" stroke="#FF2044" strokeWidth={1.2} />
    </svg>
  );
}

// ── Input bar (horizontal) ────────────────────────────────────────────────────
function InputBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.min(100, Math.max(0, value * 100));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="eng-label">{label}</span>
        <span className="font-telemetry text-[10px] tabular-nums" style={{ color }}>{pct.toFixed(0)}%</span>
      </div>
      <div className="h-[3px] bg-motorsport-dark">
        <div
          className="h-full transition-[width] duration-75 ease-linear"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function DriverInputsPanel() {
  const t = useTelemetryStore(s => s.currentFrame?.telemetry);
  const m = useTelemetryStore(s => s.currentFrame?.motion);

  const speed    = t?.speed    ?? 0;
  const gear     = t?.gear     ?? 0;
  const rpm      = t?.engine_rpm ?? 0;
  const revPct   = t?.rev_lights_percent ?? Math.min(100, (rpm / 15000) * 100);
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

  const gearColor =
    gear >= 7 ? '#FF2044' :
    gear >= 5 ? '#FFD000' :
    gear >= 3 ? '#00E85A' :
    '#B8C8D6';

  const rpmBarColor =
    revPct > 85 ? '#FF2044' :
    revPct > 65 ? '#FFD000' :
    '#00E85A';

  return (
    <div className="telemetry-panel flex flex-col h-full overflow-hidden">
      <div className="panel-header">
        <span className="eng-label font-bold">Driver Inputs</span>
      </div>

      {/* Shift LEDs */}
      <div className="shrink-0 border-b border-motorsport-border">
        <ShiftLights revPercent={revPct} />
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-2.5 p-2.5 overflow-hidden">
        {/* Speed + Gear */}
        <div className="flex items-end justify-between shrink-0">
          <div className="flex flex-col">
            <span className="eng-label">SPEED</span>
            <span
              className="font-telemetry font-bold leading-none tabular-nums"
              style={{ fontSize: '2.8rem', color: '#00D4FF', textShadow: '0 0 16px #00D4FF44' }}
            >
              {speed.toFixed(0)}
            </span>
            <span className="eng-label mt-0.5">KM/H</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="eng-label">GEAR</span>
            <span
              className="font-telemetry font-black leading-none tabular-nums"
              style={{ fontSize: '4rem', color: gearColor }}
            >
              {formatGear(gear)}
            </span>
          </div>
        </div>

        {/* RPM */}
        <div className="shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="eng-label">RPM</span>
            <span className="font-telemetry text-[10px] text-motorsport-muted tabular-nums">
              {rpm.toLocaleString()}
            </span>
          </div>
          <div className="h-[3px] bg-motorsport-dark">
            <div
              className="h-full transition-[width] duration-75"
              style={{ width: `${Math.min(100, (rpm / 15000) * 100)}%`, backgroundColor: rpmBarColor }}
            />
          </div>
        </div>

        {/* Throttle / Brake */}
        <div className="flex flex-col gap-2 shrink-0">
          <InputBar label="THROTTLE" value={throttle} color="#00E85A" />
          <InputBar label="BRAKE"    value={brake}    color="#FF2044" />
        </div>

        {/* Modulation trace */}
        <div className="flex flex-col gap-1 shrink-0">
          <span className="eng-label">MODULATION</span>
          <div className="bg-motorsport-dark px-1.5 py-1">
            <MicroTrace frames={traceRef.current} />
          </div>
        </div>

        {/* G-Force */}
        <div className="mt-auto pt-2 border-t border-motorsport-border/40 flex items-center justify-between shrink-0">
          <div>
            <span className="eng-label block">LAT G</span>
            <span className="font-telemetry text-xs tabular-nums" style={{ color: Math.abs(latG) > 3 ? '#FF2044' : '#B8C8D6' }}>
              {latG >= 0 ? '+' : ''}{latG.toFixed(2)}
            </span>
          </div>
          <div>
            <span className="eng-label block">LON G</span>
            <span className="font-telemetry text-xs tabular-nums" style={{ color: lonG < -2 ? '#FF2044' : '#B8C8D6' }}>
              {lonG >= 0 ? '+' : ''}{lonG.toFixed(2)}
            </span>
          </div>
          <div className="text-right">
            <span className="eng-label block">RESULT</span>
            <span className="font-telemetry text-xs tabular-nums text-motorsport-text">
              {gMag.toFixed(2)}G
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(DriverInputsPanel);
