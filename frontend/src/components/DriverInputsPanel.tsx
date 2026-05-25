import { memo, useMemo } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { formatGear } from '@/utils/formatters';

// ── Shift-light strip ────────────────────────────────────────────
// 15 LEDs. rev_lights_percent drives how many light up.
// Green (0-8), Red (9-12), Blue/flash (13-14)
const LED_COUNT = 15;
function ShiftLights({ revPercent }: { revPercent: number }) {
  const lit = Math.round((revPercent / 100) * LED_COUNT);
  return (
    <div className="flex gap-0.5 items-center w-full">
      {Array.from({ length: LED_COUNT }).map((_, i) => {
        const isLit = i < lit;
        let color = '#21303f';
        if (isLit) {
          if (i < 9)       color = '#00FF88';
          else if (i < 13) color = '#FF3333';
          else             color = '#00E5FF';
        }
        return (
          <div
            key={i}
            className="flex-1 h-2.5 rounded-sm transition-colors duration-50"
            style={{ backgroundColor: color, opacity: isLit ? 1 : 0.25 }}
          />
        );
      })}
    </div>
  );
}

// ── Micro-trace: last N frames of throttle + brake ───────────────
// Rendered as a tiny inline SVG path for zero re-render overhead
const TRACE_FRAMES = 80;
const TRACE_W = 120;
const TRACE_H = 32;

function MicroTrace({ frames }: { frames: { throttle: number; brake: number }[] }) {
  const { tPath, bPath } = useMemo(() => {
    if (!frames.length) return { tPath: '', bPath: '' };
    const n = frames.length;
    const toX = (i: number) => (i / (TRACE_FRAMES - 1)) * TRACE_W;
    const toY = (v: number) => TRACE_H - v * TRACE_H;

    let tp = `M${toX(0)},${toY(frames[0].throttle)}`;
    let bp = `M${toX(0)},${toY(frames[0].brake)}`;
    for (let i = 1; i < n; i++) {
      tp += ` L${toX(i)},${toY(frames[i].throttle)}`;
      bp += ` L${toX(i)},${toY(frames[i].brake)}`;
    }
    return { tPath: tp, bPath: bp };
  }, [frames]);

  return (
    <svg width={TRACE_W} height={TRACE_H} className="overflow-visible">
      <path d={tPath} fill="none" stroke="#00FF88" strokeWidth={1.2} />
      <path d={bPath} fill="none" stroke="#FF3333" strokeWidth={1.2} />
    </svg>
  );
}

// ── Vertical input bar ───────────────────────────────────────────
function InputBar({
  label, value, color,
}: { label: string; value: number; color: string }) {
  const pct = Math.min(100, Math.max(0, value * 100));
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="eng-label">{label}</span>
      <div className="relative w-7 h-20 bg-motorsport-dark rounded-sm overflow-hidden">
        <div
          className="absolute bottom-0 w-full transition-[height] duration-75 ease-linear"
          style={{ height: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="font-telemetry text-[10px] tabular-nums" style={{ color }}>
        {pct.toFixed(0)}
      </span>
    </div>
  );
}

function DriverInputsPanel() {
  const t           = useTelemetryStore(s => s.currentFrame?.telemetry);
  const frameHistory = useTelemetryStore(s => s.frameHistory);
  const m           = useTelemetryStore(s => s.currentFrame?.motion);

  const speed     = t?.speed ?? 0;
  const gear      = t?.gear  ?? 0;
  const rpm       = t?.engine_rpm ?? 0;
  const revPct    = t?.rev_lights_percent ?? Math.min(100, (rpm / 15000) * 100);
  const throttle  = t?.throttle ?? 0;
  const brake     = t?.brake    ?? 0;
  const latG      = m?.g_force_lat ?? 0;
  const lonG      = m?.g_force_lon ?? 0;

  // Last TRACE_FRAMES frames for micro-trace
  const traceFrames = useMemo(() => {
    const slice = frameHistory.slice(-TRACE_FRAMES);
    return slice.map(f => ({
      throttle: f.telemetry?.throttle ?? 0,
      brake:    f.telemetry?.brake    ?? 0,
    }));
  }, [frameHistory]);

  // Gear color: ascending gears get hotter
  const gearColor =
    gear >= 7 ? '#FF3333' :
    gear >= 5 ? '#FFCC00' :
    gear >= 3 ? '#00FF88' :
    '#cdd9e5';

  // G-force resultant magnitude
  const gMag = Math.sqrt(latG * latG + lonG * lonG);

  return (
    <div className="telemetry-panel flex flex-col h-full overflow-hidden">
      <div className="panel-header shrink-0">
        <span className="text-[10px] font-semibold tracking-widest text-motorsport-muted uppercase">
          Driver Inputs
        </span>
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-2 p-2">
        {/* Speed + Gear row */}
        <div className="flex items-end gap-3">
          <div className="flex flex-col">
            <span className="eng-label">SPEED</span>
            <span
              className="font-telemetry font-bold leading-none tabular-nums"
              style={{ fontSize: '2.6rem', color: '#00E5FF' }}
            >
              {speed.toFixed(0)}
            </span>
            <span className="eng-label mt-0.5">km/h</span>
          </div>

          <div className="ml-auto flex flex-col items-center">
            <span className="eng-label">GEAR</span>
            <span
              className="font-telemetry font-black leading-none tabular-nums"
              style={{ fontSize: '4rem', color: gearColor }}
            >
              {formatGear(gear)}
            </span>
          </div>
        </div>

        {/* RPM shift lights */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between">
            <span className="eng-label">RPM</span>
            <span className="font-telemetry text-[10px] text-motorsport-muted tabular-nums">
              {rpm.toLocaleString()}
            </span>
          </div>
          <ShiftLights revPercent={revPct} />
        </div>

        {/* Throttle + Brake bars + micro-trace */}
        <div className="flex items-end gap-2 mt-auto">
          <InputBar label="THR" value={throttle} color="#00FF88" />
          <InputBar label="BRK" value={brake}    color="#FF3333" />
          <div className="flex flex-col gap-1 flex-1">
            <span className="eng-label">MODULATION</span>
            <div className="bg-motorsport-dark rounded-sm p-1 overflow-hidden">
              <MicroTrace frames={traceFrames} />
            </div>
          </div>
        </div>

        {/* G-Force readout */}
        <div className="flex gap-3 pt-1 border-t border-motorsport-border/40">
          <div>
            <span className="eng-label">LAT G</span>
            <div className="font-telemetry text-xs tabular-nums" style={{ color: Math.abs(latG) > 3 ? '#FF3333' : '#cdd9e5' }}>
              {latG >= 0 ? '+' : ''}{latG.toFixed(2)}
            </div>
          </div>
          <div>
            <span className="eng-label">LON G</span>
            <div className="font-telemetry text-xs tabular-nums" style={{ color: lonG < -2 ? '#FF3333' : '#cdd9e5' }}>
              {lonG >= 0 ? '+' : ''}{lonG.toFixed(2)}
            </div>
          </div>
          <div className="ml-auto">
            <span className="eng-label">RESULTANT</span>
            <div className="font-telemetry text-xs tabular-nums text-motorsport-text">
              {gMag.toFixed(2)}G
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(DriverInputsPanel);
