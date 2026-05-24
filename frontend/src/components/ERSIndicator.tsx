import { memo } from 'react';
import { clamp } from '@/utils/formatters';

interface ERSIndicatorProps {
  storeEnergy: number; // 0-4000000
  deployMode: number;
}

function ERSIndicator({
  storeEnergy = 0,
  deployMode = 0,
}: ERSIndicatorProps) {
  const maxEnergy = 4000000;
  const percent = clamp((storeEnergy / maxEnergy) * 100, 0, 100);
  const isOn = deployMode > 0;
  const activeSegments = Math.ceil(percent / 10);

  return (
    <div className="flex flex-col gap-3 items-center">
      {/* ERS Status Box — styled like DRS but yellow */}
      <div className="flex flex-col items-center gap-1.5">
        <div
          className={`w-16 h-8 flex items-center justify-center rounded-sm border-2 font-bold text-sm tracking-wider transition-all duration-150 ${
            isOn
              ? 'bg-yellow-400/15 border-yellow-400 text-yellow-400 shadow-[0_0_12px_rgba(255,234,0,0.3)]'
              : 'bg-motorsport-charcoal border-motorsport-border text-motorsport-dim'
          }`}
        >
          ERS
        </div>
        <span className="text-[10px] text-motorsport-dim">
          {isOn ? 'DEPLOYING' : 'STANDBY'}
        </span>
      </div>

      {/* Segmented Battery Bar — 10 black-increment blocks */}
      <div className="w-full">
        <div className="flex gap-0.5 h-4">
          {Array.from({ length: 10 }).map((_, i) => {
            const filled = i < activeSegments;
            const isFirst = i === 0;
            const isLast = i === 9;
            return (
              <div
                key={i}
                className={`flex-1 rounded-sm transition-colors duration-150 ${
                  filled
                    ? 'bg-yellow-400'
                    : 'bg-motorsport-black'
                }`}
                style={{
                  borderRadius: isFirst ? '3px 0 0 3px' : isLast ? '0 3px 3px 0' : '0',
                }}
              />
            );
          })}
        </div>
        <div className="text-center mt-1">
          <span className="font-telemetry text-[10px] text-yellow-400 tabular-nums">
            {percent.toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
}

export default memo(ERSIndicator);
