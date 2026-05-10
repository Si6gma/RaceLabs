import { clamp } from '@/utils/formatters';

interface TelemetryGaugeProps {
  label: string;
  value: number;
  max: number;
  unit?: string;
  color?: string;
  showBar?: boolean;
  precision?: number;
}

export default function TelemetryGauge({ 
  label, 
  value, 
  max, 
  unit = '', 
  color = '#00e5ff',
  showBar = true,
  precision = 0
}: TelemetryGaugeProps) {
  const percent = max > 0 ? clamp((value / max) * 100, 0, 100) : 0;
  
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center">
        <span className="telemetry-label">{label}</span>
        <span className="telemetry-value" style={{ color }}>
          {value?.toFixed(precision)}{unit}
        </span>
      </div>
      {showBar && (
        <div className="gauge-bar">
          <div 
            className="gauge-fill rounded-sm"
            style={{ 
              width: `${percent}%`,
              backgroundColor: color,
            }}
          />
        </div>
      )}
    </div>
  );
}
