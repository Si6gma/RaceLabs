import { useMemo } from 'react';
import { clamp } from '@/utils/formatters';

interface RPMBarProps {
  rpm: number;
  maxRpm: number;
  shiftLightPercent?: number;
}

export default function RPMBar({ rpm, maxRpm, shiftLightPercent = 85 }: RPMBarProps) {
  const percent = useMemo(() => {
    if (!maxRpm || maxRpm <= 0) return 0;
    return clamp((rpm / maxRpm) * 100, 0, 100);
  }, [rpm, maxRpm]);

  const segments = 30;
  const activeSegments = Math.floor((percent / 100) * segments);
  const shiftStart = Math.floor((shiftLightPercent / 100) * segments);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-end">
        <span className="telemetry-label">RPM</span>
        <span className="font-telemetry text-lg font-bold tabular-nums" style={{ color: getRpmColor(percent, shiftLightPercent) }}>
          {rpm?.toLocaleString() ?? '0'}
        </span>
      </div>
      <div className="flex gap-0.5 h-3">
        {Array.from({ length: segments }).map((_, i) => {
          const isActive = i < activeSegments;
          const isShift = i >= shiftStart;
          return (
            <div
              key={i}
              className="flex-1 rounded-sm transition-all duration-75"
              style={{
                backgroundColor: isActive 
                  ? isShift ? '#ff1744' : '#00e5ff'
                  : '#2a2a2a',
                boxShadow: isActive && isShift ? '0 0 6px rgba(255, 23, 68, 0.6)' : 'none',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function getRpmColor(percent: number, shiftLight: number): string {
  if (percent >= 98) return '#ff1744';
  if (percent >= shiftLight) return '#ffea00';
  return '#e0e0e0';
}
