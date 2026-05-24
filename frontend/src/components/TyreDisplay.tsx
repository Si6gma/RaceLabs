import { getTempColor, getWearColor } from '@/utils/colors';

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

export default function TyreDisplay({ temps = [0,0,0,0], wear = [0,0,0,0], pressures = [0,0,0,0], compound = 0 }: TyreDisplayProps) {
  const labels = ['FL', 'FR', 'RL', 'RR'];
  
  return (
    <div className="flex flex-col gap-2">
      <span className="telemetry-label">TYRES</span>
      <div className="text-[10px] text-motorsport-muted mb-1">{compound ? getCompoundName(compound) : 'Unknown'}</div>
      <div className="grid grid-cols-2 gap-2">
        {labels.map((label, i) => (
          <div key={label} className="telemetry-panel p-2 flex flex-col gap-1">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-motorsport-muted">{label}</span>
              {temps[i] > 0 && (
                <span 
                  className="font-telemetry text-xs font-bold"
                  style={{ color: getTempColor(temps[i]) }}
                >
                  {temps[i].toFixed(0)}°
                </span>
              )}
            </div>
            
            {/* Wear bar */}
            <div className="gauge-bar h-1">
              <div 
                className="gauge-fill rounded-sm"
                style={{ 
                  width: `${wear[i]}%`,
                  backgroundColor: getWearColor(wear[i]),
                }}
              />
            </div>
            
            <div className="flex justify-between">
              <span className="text-[10px] text-motorsport-dim">{wear[i]?.toFixed(0)}%</span>
              {pressures[i] > 0 && (
                <span className="text-[10px] text-motorsport-muted">{pressures[i].toFixed(1)}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
