import { memo } from 'react';

interface TyreAnalyticsProps {
  surfaceTemps?: number[];
  innerTemps?:   number[];
  pressures?:    number[];
  wear?:         number[];
  compound?:     number;
  tyreAgeLaps?:  number;
}

const COMPOUND_META: Record<number, { name: string; color: string }> = {
  16: { name: 'SOFT',  color: '#FF2044' },
  17: { name: 'MED',   color: '#FFD000' },
  18: { name: 'HARD',  color: '#FFFFFF' },
  19: { name: 'INTER', color: '#00E85A' },
  20: { name: 'WET',   color: '#00D4FF' },
};

function tempColor(t: number): string {
  if (t === 0)   return '#243546';
  if (t < 70)    return '#1166FF';
  if (t < 85)    return '#00D4FF';
  if (t < 105)   return '#00E85A';
  if (t < 115)   return '#FFD000';
  return '#FF2044';
}

function TempZone({ label, temp }: { label: string; temp: number }) {
  const color  = tempColor(temp);
  const isData = temp > 0;
  return (
    <div className="flex flex-col items-center gap-px">
      <span className="text-[8px] text-motorsport-dim font-semibold uppercase tracking-wider">{label}</span>
      <span className="font-telemetry text-[10px] font-bold tabular-nums" style={{ color: isData ? color : '#243546' }}>
        {isData ? temp.toFixed(0) : '--'}
      </span>
      <div className="w-4 h-px" style={{ backgroundColor: isData ? color : '#1A2840' }} />
    </div>
  );
}

const TYRE_LABELS = ['FL', 'FR', 'RL', 'RR'];

function TyreCard({
  label, surface, inner, pressure, wear,
}: {
  label: string; surface: number; inner: number; pressure: number; wear: number;
}) {
  const mid     = surface > 0 && inner > 0 ? (surface + inner) / 2 : 0;
  const health  = Math.max(0, 100 - wear);
  const wearColor = wear > 70 ? '#FF2044' : wear > 40 ? '#FFD000' : '#00E85A';
  const hasData = surface > 0 || inner > 0;
  const avgTemp = mid || surface || inner;

  return (
    <div
      className="bg-motorsport-dark border flex flex-col gap-1.5 p-1.5"
      style={{ borderColor: hasData ? `${tempColor(avgTemp)}40` : '#1A2840' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-widest text-motorsport-muted uppercase">{label}</span>
        {hasData && (
          <span className="font-telemetry text-[9px] tabular-nums" style={{ color: wearColor }}>
            {health.toFixed(0)}%
          </span>
        )}
      </div>

      {/* I / M / O zones */}
      <div className="flex justify-around">
        <TempZone label="I" temp={inner}   />
        <TempZone label="M" temp={mid}     />
        <TempZone label="O" temp={surface} />
      </div>

      {/* Wear bar */}
      <div className="h-[2px] bg-motorsport-border">
        <div
          className="h-full transition-[width] duration-150"
          style={{ width: `${health}%`, backgroundColor: wearColor }}
        />
      </div>

      {/* Pressure */}
      {pressure > 0 && (
        <span className="font-telemetry text-[8px] text-motorsport-dim tabular-nums text-right">
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
  const meta = COMPOUND_META[compound] ?? { name: compound ? `C${compound}` : '---', color: '#4A6078' };

  return (
    <div className="telemetry-panel flex flex-col h-full overflow-hidden">
      <div className="panel-header justify-between">
        <span className="eng-label font-bold">Tyres</span>
        <div className="flex items-center gap-2">
          {tyreAgeLaps > 0 && (
            <span className="font-telemetry text-[9px] text-motorsport-dim tabular-nums">+{tyreAgeLaps}L</span>
          )}
          <span
            className="text-[12px] font-bold tracking-wider"
            style={{ color: meta.color, fontFamily: "'JetBrains Mono', monospace" }}
          >
            {meta.name}
          </span>
        </div>
      </div>

      {/* 2×2 grid */}
      <div className="flex-1 min-h-0 p-1.5 grid grid-cols-2 gap-1.5 content-start">
        {TYRE_LABELS.map((lbl, i) => (
          <TyreCard
            key={lbl}
            label={lbl}
            surface={surfaceTemps[i] ?? 0}
            inner={innerTemps[i]     ?? 0}
            pressure={pressures[i]   ?? 0}
            wear={wear[i]            ?? 0}
          />
        ))}
      </div>

      {/* Thermal legend */}
      <div className="px-2.5 py-1 border-t border-motorsport-border/40 flex gap-2 flex-wrap shrink-0">
        {[
          ['<70°', '#1166FF'],
          ['70-85°', '#00D4FF'],
          ['85-105°', '#00E85A'],
          ['105-115°', '#FFD000'],
          ['>115°', '#FF2044'],
        ].map(([label, color]) => (
          <div key={label} className="flex items-center gap-1">
            <div className="w-1.5 h-1.5" style={{ backgroundColor: color }} />
            <span className="text-[8px] text-motorsport-dim">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(TyreAnalytics);
