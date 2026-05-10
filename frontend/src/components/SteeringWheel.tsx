interface SteeringWheelProps {
  steer: number; // -1 to 1
  size?: number;
}

export default function SteeringWheel({ steer, size = 120 }: SteeringWheelProps) {
  const rotation = steer * 450; // max 450 degrees
  
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="telemetry-label">STEERING</span>
      <div 
        className="relative"
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} viewBox="0 0 120 120">
          {/* Outer ring */}
          <circle 
            cx="60" 
            cy="60" 
            r="55" 
            fill="none" 
            stroke="#2a2a2a" 
            strokeWidth="4"
          />
          {/* Rotating wheel */}
          <g 
            transform={`rotate(${rotation}, 60, 60)`}
            style={{ transition: 'transform 0.05s linear' }}
          >
            <circle 
              cx="60" 
              cy="60" 
              r="55" 
              fill="none" 
              stroke="#444" 
              strokeWidth="6"
            />
            {/* Center hub */}
            <circle cx="60" cy="60" r="12" fill="#333" stroke="#555" strokeWidth="2" />
            {/* Spokes */}
            <line x1="60" y1="60" x2="60" y2="15" stroke="#444" strokeWidth="6" strokeLinecap="round" />
            <line x1="60" y1="60" x2="20" y2="90" stroke="#444" strokeWidth="5" strokeLinecap="round" />
            <line x1="60" y1="60" x2="100" y2="90" stroke="#444" strokeWidth="5" strokeLinecap="round" />
            {/* Top marker */}
            <rect x="56" y="8" width="8" height="12" fill="#ff6b00" rx="1" />
          </g>
          {/* Center dot */}
          <circle cx="60" cy="60" r="4" fill="#ff6b00" />
        </svg>
      </div>
      <span className="font-telemetry text-xs text-motorsport-muted">
        {steer > 0 ? 'R' : steer < 0 ? 'L' : 'C'} {Math.abs(steer * 100).toFixed(0)}%
      </span>
    </div>
  );
}
