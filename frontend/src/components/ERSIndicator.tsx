import { clamp } from '@/utils/formatters';

interface ERSIndicatorProps {
  storeEnergy: number; // 0-4000000
  deployMode: number;
  harvestedMGUK: number;
  harvestedMGUH: number;
  deployed: number;
}

export default function ERSIndicator({ 
  storeEnergy = 0, 
  deployMode = 0,
  harvestedMGUK = 0,
  harvestedMGUH = 0,
  deployed = 0
}: ERSIndicatorProps) {
  const maxEnergy = 4000000;
  const percent = clamp((storeEnergy / maxEnergy) * 100, 0, 100);
  
  const modeNames = ['None', 'Low', 'Medium', 'High', 'Overtake', 'Hotlap'];
  
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-center">
        <span className="telemetry-label">ERS</span>
        <span className="text-xs font-bold text-motorsport-purple">{modeNames[deployMode] || 'None'}</span>
      </div>
      
      {/* ERS Store Bar */}
      <div className="relative h-4 bg-motorsport-charcoal rounded-sm overflow-hidden">
        <div 
          className="absolute inset-y-0 left-0 rounded-sm transition-all duration-200"
          style={{ 
            width: `${percent}%`,
            background: `linear-gradient(90deg, #7c4dff, #d500f9)`,
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] font-bold text-white drop-shadow-md">
            {percent.toFixed(0)}%
          </span>
        </div>
      </div>
      
      <div className="grid grid-cols-3 gap-2">
        <div className="text-center">
          <div className="text-[10px] text-motorsport-muted">MGUK</div>
          <div className="font-telemetry text-xs text-motorsport-green">+{(harvestedMGUK/1000).toFixed(1)}</div>
        </div>
        <div className="text-center">
          <div className="text-[10px] text-motorsport-muted">MGUH</div>
          <div className="font-telemetry text-xs text-motorsport-green">+{(harvestedMGUH/1000).toFixed(1)}</div>
        </div>
        <div className="text-center">
          <div className="text-[10px] text-motorsport-muted">USED</div>
          <div className="font-telemetry text-xs text-motorsport-red">-{(deployed/1000).toFixed(1)}</div>
        </div>
      </div>
    </div>
  );
}
