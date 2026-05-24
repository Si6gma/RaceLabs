import { memo } from 'react';

interface DRSIndicatorProps {
  active: boolean;
  allowed: boolean;
}

function DRSIndicator({ active, allowed }: DRSIndicatorProps) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div 
        className={`w-16 h-8 flex items-center justify-center rounded-sm border-2 font-bold text-sm tracking-wider transition-all duration-150 ${
          active 
            ? 'bg-motorsport-cyan/20 border-motorsport-cyan text-motorsport-cyan shadow-[0_0_12px_rgba(0,229,255,0.3)]' 
            : allowed
            ? 'bg-motorsport-charcoal border-motorsport-dim text-motorsport-muted'
            : 'bg-motorsport-charcoal border-motorsport-border text-motorsport-dim'
        }`}
      >
        {active ? 'OPEN' : 'DRS'}
      </div>
      <span className="text-[10px] text-motorsport-dim">
        {active ? 'ACTIVE' : allowed ? 'ZONE' : 'N/A'}
      </span>
    </div>
  );
}

export default memo(DRSIndicator);
