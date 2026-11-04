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
  16: { name: 'Soft',   color: '#FF2044' },
  17: { name: 'Medium', color: '#FFD000' },
  18: { name: 'Hard',   color: '#FFFFFF' },
  19: { name: 'Inter',  color: '#00E85A' },
  20: { name: 'Wet',    color: '#00D4FF' },
};

const TEMP_BANDS: [number, string][] = [
  [70,  '#1166FF'],
  [85,  '#00D4FF'],
  [105, '#00E85A'],
  [115, '#FFD000'],
  [Infinity, '#FF2044'],
];

function tempColor(t: number): string {
  if (t === 0) return '#5F7183';
  return TEMP_BANDS.find(([max]) => t < max)![1];
}

const TYRE_LABELS = ['FL', 'FR', 'RL', 'RR'];

function TyreCard({
  label, surface, inner, pressure, wear,
}: {
  label: string; surface: number; inner: number; pressure: number; wear: number;
}) {
  const health    = Math.max(0, 100 - wear);
  const wearColor = wear > 70 ? '#FF2044' : wear > 40 ? '#FFD000' : '#00E85A';
  const hasData   = surface > 0 || inner > 0;

  return (
    <div className="bg-motorsport-dark flex flex-col gap-2 p-2.5 min-h-0">
      {/* Surface temperature is the headline: the number the colour bands judge */}
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-bold tracking-wide text-motorsport-text">{label}</span>
        <span className="font-telemetry text-[26px] font-bold tabular-nums leading-none" style={{ color: tempColor(surface) }}>
          {surface > 0 ? `${surface.toFixed(0)}°` : '--'}
        </span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] text-motorsport-muted font-semibold">inner</span>
        <span className="font-telemetry text-[14px] tabular-nums leading-none" style={{ color: tempColor(inner) }}>
          {inner > 0 ? `${inner.toFixed(0)}°` : '--'}
        </span>
      </div>

      {/* Tread left: bar drains as the tyre wears */}
      <div className="flex items-baseline justify-between pt-1">
        <span className="text-[12px] text-motorsport-muted font-semibold">wear</span>
        <span className="font-telemetry text-[14px] tabular-nums leading-none" style={{ color: hasData ? wearColor : '#5F7183' }}>
          {hasData ? `${wear.toFixed(0)}%` : '--'}
        </span>
      </div>
      <div className="h-[3px] bg-motorsport-border">
        <div className="h-full transition-[width] duration-150" style={{ width: `${health}%`, backgroundColor: hasData ? wearColor : 'transparent' }} />
      </div>

      <div className="flex items-baseline justify-between">
        <span className="text-[12px] text-motorsport-muted font-semibold">pressure</span>
        <span className="font-telemetry text-[13px] text-motorsport-text tabular-nums leading-none">
          {pressure > 0 ? `${pressure.toFixed(1)} psi` : '--'}
        </span>
      </div>
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
  const meta = COMPOUND_META[compound] ?? { name: compound ? `C${compound}` : '', color: '#9AACBE' };

  return (
    <div className="telemetry-panel relative h-full overflow-hidden p-2 grid grid-cols-2 grid-rows-2 gap-2">
      {/* Laid out as the car: fronts on top */}
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

      {/* Compound sits at the hub, between the four tyres */}
      {meta.name && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-baseline gap-1.5 px-2.5 py-1 bg-motorsport-panel border border-motorsport-border-strong">
          <span className="text-[14px] font-bold tracking-wide leading-none" style={{ color: meta.color }}>{meta.name}</span>
          {tyreAgeLaps > 0 && (
            <span className="font-telemetry text-[12px] text-motorsport-muted tabular-nums leading-none">{tyreAgeLaps}L</span>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(TyreAnalytics);
