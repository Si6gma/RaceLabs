import { memo } from 'react';

interface ERSIndicatorProps {
  deployMode: number;
}

function ERSIndicator({
  deployMode = 0,
}: ERSIndicatorProps) {
  const isOn = deployMode > 0;

  return (
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
  );
}

export default memo(ERSIndicator);
