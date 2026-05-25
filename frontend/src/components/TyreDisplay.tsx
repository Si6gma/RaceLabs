import { memo } from 'react';
import { getWearColor } from '@/utils/colors';

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

function getTyreTempStyle(temp: number): { bg: string; text: string; border: string; glow?: boolean } {
  if (temp < 85) {
    return { bg: 'bg-blue-900/20', text: 'text-blue-300', border: 'border-blue-800/40' };
  }
  if (temp <= 105) {
    return { bg: 'bg-green-900/20', text: 'text-green-400', border: 'border-green-800/40' };
  }
  return { bg: 'bg-red-900/20', text: 'text-red-400', border: 'border-red-800/40', glow: true };
}

function TyreDisplay({ temps = [0, 0, 0, 0], wear = [0, 0, 0, 0], pressures = [0, 0, 0, 0], compound = 0 }: TyreDisplayProps) {
  const labels = ['FL', 'FR', 'RL', 'RR'];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="telemetry-label">TYRES</span>
        <span className="text-[10px] text-motorsport-muted font-medium">
          {compound ? getCompoundName(compound) : 'Unknown'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {labels.map((label, i) => {
          const temp = temps[i] || 0;
          const style = getTyreTempStyle(temp);
          return (
            <div
              key={label}
              className={`p-1.5 flex flex-col gap-1 rounded border ${style.bg} ${style.border} ${style.glow ? 'animate-pulse' : ''}`}
            >
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold text-motorsport-muted">{label}</span>
                {temp > 0 && (
                  <span className={`font-telemetry text-xs font-bold ${style.text}`}>
                    {temp.toFixed(0)}°
                  </span>
                )}
              </div>

              {/* Wear bar */}
              <div className="gauge-bar h-1">
                <div
                  className="gauge-fill rounded-sm"
                  style={{
                    width: `${Math.min(100, wear[i] || 0)}%`,
                    backgroundColor: getWearColor(wear[i] || 0),
                  }}
                />
              </div>

              <div className="flex justify-between">
                <span className="text-[9px] text-motorsport-dim">{wear[i]?.toFixed(0)}%</span>
                {pressures[i] > 0 && (
                  <span className="text-[9px] text-motorsport-muted">{pressures[i].toFixed(1)} PSI</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(TyreDisplay);
