import { memo } from 'react';

interface TyreDisplayProps {
  temps?: number[];
  wear?: number[];
  pressures?: number[];
  compound?: number;
}

function getCompoundName(compound: number): string {
  const compounds: Record<number, string> = {
    16: 'SOFT', 17: 'MEDIUM', 18: 'HARD', 19: 'INTER', 20: 'WET',
  };
  return compounds[compound] || `C${compound}`;
}

/**
 * Conditional styling utility for the tyre progress bar.
 *
 * Returns a color theme object with `fill`, `track`, and `text` colours.
 *
 * Rules:
 * - If `value` is 0% OR `temp` is 0°C (no telemetry), the bar is a muted,
 *   dark gray (unknown / inactive state).
 * - Otherwise the bar uses a vibrant colour that corresponds to the tyre's
 *   temperature status:
 *     • < 85°C  → Cold (blue)
 *     • 85–105°C → Optimal window (green)
 *     • > 105°C  → Overheating (red)
 */
function getBarTheme(
  value: number,
  temp: number
): {
  fill: string;
  track: string;
  text: string;
  glow?: string;
} {
  // ── Unknown / inactive state ──
  if (value === 0 || temp === 0) {
    return {
      fill: '#475569',   // slate-600  – muted fill
      track: '#1e293b',  // slate-800  – dark track
      text: '#64748b',   // slate-500  – muted label/value
    };
  }

  // ── Active: temperature-based vibrant theme ──
  if (temp < 85) {
    // Cold
    return {
      fill: '#3b82f6',   // blue-500
      track: '#172554',  // blue-950
      text: '#60a5fa',   // blue-400
    };
  }

  if (temp <= 105) {
    // Optimal window
    return {
      fill: '#22c55e',   // green-500
      track: '#052e16',  // green-950
      text: '#4ade80',   // green-400
    };
  }

  // Overheating
  return {
    fill: '#ef4444',   // red-500
    track: '#450a0a',  // red-950
    text: '#f87171',   // red-400
    glow: '0 0 8px rgba(239,68,68,0.4)',
  };
}

function TyreDisplay({
  temps = [0, 0, 0, 0],
  wear = [0, 0, 0, 0],
  pressures = [0, 0, 0, 0],
  compound = 0,
}: TyreDisplayProps) {
  const labels = ['FL', 'FR', 'RL', 'RR'];

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="telemetry-label">TYRES</span>
        <span className="text-[10px] text-motorsport-muted font-medium">
          {compound ? getCompoundName(compound) : 'Unknown'}
        </span>
      </div>

      {/* 2×2 Grid */}
      <div className="grid grid-cols-2 gap-2">
        {labels.map((label, i) => {
          const temp = temps[i] || 0;
          const value = wear[i] || 0;
          const theme = getBarTheme(value, temp);

          const isUnknown = value === 0 || temp === 0;
          const displayValue = isUnknown ? 'Unknown' : `${value.toFixed(0)}%`;
          const barWidth = isUnknown ? '0%' : `${Math.min(100, value)}%`;

          return (
            <div
              key={label}
              className="bg-motorsport-black border border-motorsport-border rounded p-2.5 flex flex-col gap-2"
            >
              {/* Label + primary percentage value */}
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold tracking-wider text-motorsport-muted">
                  {label}
                </span>
                <span
                  className="font-telemetry text-sm font-bold tabular-nums"
                  style={{ color: theme.text }}
                >
                  {displayValue}
                </span>
              </div>

              {/* Horizontal progress bar */}
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ backgroundColor: theme.track }}
              >
                <div
                  className="h-full rounded-full transition-all duration-300 ease-out"
                  style={{
                    width: barWidth,
                    backgroundColor: theme.fill,
                    boxShadow: theme.glow,
                  }}
                />
              </div>

              {/* Pressure readout (optional) */}
              {pressures[i] > 0 && (
                <span className="font-telemetry text-[10px] text-motorsport-dim self-end tabular-nums">
                  {pressures[i].toFixed(1)} PSI
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(TyreDisplay);
