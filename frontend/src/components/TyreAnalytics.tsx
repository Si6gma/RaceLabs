import { memo } from 'react';

interface TyreAnalyticsProps {
  surfaceTemps?: number[];  // tyres_surface_temp — outer zone
  innerTemps?:   number[];  // tyres_inner_temp   — inner carcass
  pressures?:    number[];
  wear?:         number[];
  compound?:     number;
  tyreAgeLaps?:  number;
}

const COMPOUND_META: Record<number, { name: string; color: string }> = {
  16: { name: 'SOFT',   color: '#FF3333' },
  17: { name: 'MEDIUM', color: '#FFCC00' },
  18: { name: 'HARD',   color: '#FFFFFF' },
  19: { name: 'INTER',  color: '#00C651' },
  20: { name: 'WET',    color: '#00E5FF' },
};

// Strict thermal colour semantics
function tempColor(t: number): string {
  if (t === 0)   return '#444c56'; // no data
  if (t < 70)    return '#0057FF'; // blue — cold / under temp
  if (t < 85)    return '#00E5FF'; // cyan — warming
  if (t < 105)   return '#00FF88'; // green — optimal window
  if (t < 115)   return '#FFCC00'; // yellow — warm / approaching limit
  return '#FF3333';                  // red — overheating
}

// Single temperature zone cell
function TempZone({ label, temp }: { label: string; temp: number }) {
  const color = tempColor(temp);
  const isData = temp > 0;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[8px] text-motorsport-dim font-medium">{label}</span>
      <div
        className="font-telemetry text-[10px] tabular-nums font-bold"
        style={{ color: isData ? color : '#444c56' }}
      >
        {isData ? temp.toFixed(0) : '--'}
      </div>
      {/* Tiny color bar */}
      <div className="w-5 h-0.5 rounded-full" style={{ backgroundColor: isData ? color : '#21303f' }} />
    </div>
  );
}

const TYRE_LABELS = ['FL', 'FR', 'RL', 'RR'];

function TyreCard({
  label, surface, inner, pressure, wear,
}: {
  label: string;
  surface: number;
  inner: number;
  pressure: number;
  wear: number;
}) {
  const mid = surface > 0 && inner > 0 ? (surface + inner) / 2 : 0;
  const health = Math.max(0, 100 - wear);
  const wearColor = wear > 70 ? '#FF3333' : wear > 40 ? '#FFCC00' : '#00FF88';
  const hasData = surface > 0 || inner > 0;

  return (
    <div className="bg-motorsport-dark border border-motorsport-border rounded p-1.5 flex flex-col gap-1.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold text-motorsport-muted tracking-wider">{label}</span>
        {hasData && (
          <span className="font-telemetry text-[9px] tabular-nums" style={{ color: wearColor }}>
            {health.toFixed(0)}%
          </span>
        )}
      </div>

      {/* I / M / O temperature zones */}
      <div className="flex justify-between">
        <TempZone label="I" temp={inner}   />
        <TempZone label="M" temp={mid}     />
        <TempZone label="O" temp={surface} />
      </div>

      {/* Wear bar */}
      <div className="eng-bar-track">
        <div
          className="eng-bar-fill"
          style={{ width: `${health}%`, backgroundColor: wearColor }}
        />
      </div>

      {/* PSI */}
      {pressure > 0 && (
        <span className="font-telemetry text-[9px] text-motorsport-dim tabular-nums text-right">
          {pressure.toFixed(1)} psi
        </span>
      )}
    </div>
  );
}

function TyreAnalytics({
  surfaceTemps = [0, 0, 0, 0],
  innerTemps   = [0, 0, 0, 0],
  pressures    = [0, 0, 0, 0],
  wear         = [0, 0, 0, 0],
  compound     = 0,
  tyreAgeLaps  = 0,
}: TyreAnalyticsProps) {
  const meta = COMPOUND_META[compound] ?? { name: compound ? `C${compound}` : '---', color: '#768390' };

  return (
    <div className="telemetry-panel flex flex-col h-full overflow-hidden">
      <div className="panel-header shrink-0 justify-between">
        <span className="text-[10px] font-semibold tracking-widest text-motorsport-muted uppercase">Tyres</span>
        <div className="flex items-center gap-2">
          {tyreAgeLaps > 0 && (
            <span className="font-telemetry text-[9px] text-motorsport-dim tabular-nums">
              +{tyreAgeLaps}L
            </span>
          )}
          <span className="font-telemetry text-[10px] font-bold tracking-wider" style={{ color: meta.color }}>
            {meta.name}
          </span>
        </div>
      </div>

      {/* I / M / O legend */}
      <div className="px-2 py-1 flex gap-3">
        <span className="text-[8px] text-motorsport-dim">I = Inner carcass</span>
        <span className="text-[8px] text-motorsport-dim">M = Mid</span>
        <span className="text-[8px] text-motorsport-dim">O = Outer surface</span>
      </div>

      {/* 2×2 tyre grid */}
      <div className="flex-1 min-h-0 p-1.5 grid grid-cols-2 gap-1.5">
        {TYRE_LABELS.map((lbl, i) => (
          <TyreCard
            key={lbl}
            label={lbl}
            surface={surfaceTemps[i] ?? 0}
            inner={innerTemps[i] ?? 0}
            pressure={pressures[i] ?? 0}
            wear={wear[i] ?? 0}
          />
        ))}
      </div>

      {/* Thermal legend */}
      <div className="px-2 py-1 border-t border-motorsport-border/40 flex gap-2 flex-wrap">
        {[
          ['<70°', '#0057FF'],
          ['70-85°', '#00E5FF'],
          ['85-105°', '#00FF88'],
          ['105-115°', '#FFCC00'],
          ['>115°', '#FF3333'],
        ].map(([label, color]) => (
          <div key={label} className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-[8px] text-motorsport-dim">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(TyreAnalytics);
