import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import type { TelemetryFrame } from '@/types/telemetry';
import { TELEMETRY_COLORS } from '@/utils/colors';
import { Activity, Pause, Play, RotateCcw } from 'lucide-react';

interface GraphConfig {
  key: string;
  label: string;
  color: string;
  min: number;
  max: number;
  getter: (f: TelemetryFrame) => number;
}

const GRAPHS: GraphConfig[] = [
  { key: 'speed', label: 'Speed', color: TELEMETRY_COLORS.speed, min: 0, max: 380, getter: f => f.telemetry?.speed || 0 },
  { key: 'throttle', label: 'Throttle', color: TELEMETRY_COLORS.throttle, min: 0, max: 1, getter: f => f.telemetry?.throttle || 0 },
  { key: 'brake', label: 'Brake', color: TELEMETRY_COLORS.brake, min: 0, max: 1, getter: f => f.telemetry?.brake || 0 },
  { key: 'rpm', label: 'RPM', color: TELEMETRY_COLORS.rpm, min: 0, max: 15000, getter: f => f.telemetry?.engine_rpm || 0 },
  { key: 'steer', label: 'Steering', color: TELEMETRY_COLORS.steering, min: -1, max: 1, getter: f => f.telemetry?.steer || 0 },
  { key: 'gear', label: 'Gear', color: TELEMETRY_COLORS.gear, min: -1, max: 8, getter: f => f.telemetry?.gear || 0 },
  { key: 'drs', label: 'DRS', color: TELEMETRY_COLORS.drs, min: 0, max: 1, getter: f => f.telemetry?.drs || 0 },
  { key: 'g_lat', label: 'Lat G', color: TELEMETRY_COLORS.gForce, min: -3.5, max: 3.5, getter: f => f.motion?.g_force_lat || 0 },
];

export default function TelemetryCharts() {
  const { frameHistory, currentFrame } = useTelemetryStore();
  const [activeGraphs, setActiveGraphs] = useState<string[]>(['speed', 'throttle', 'brake', 'rpm']);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const visibleFrames = useMemo(() => {
    if (paused) {
      return frameHistory.slice(-600);
    }
    return frameHistory.slice(-400);
  }, [frameHistory, paused]);
  
  const toggleGraph = useCallback((key: string) => {
    setActiveGraphs(prev => 
      prev.includes(key) 
        ? prev.filter(k => k !== key)
        : [...prev, key]
    );
  }, []);
  
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setHoverX(x);
  }, []);
  
  const handleMouseLeave = useCallback(() => {
    setHoverX(null);
  }, []);
  
  const activeConfigs = GRAPHS.filter(g => activeGraphs.includes(g.key));
  
  return (
    <div className="h-full flex flex-col p-3 gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between telemetry-panel p-2 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-motorsport-orange" />
            <span className="text-sm font-semibold">TELEMETRY TRACES</span>
          </div>
          
          <div className="flex gap-1">
            {GRAPHS.map(g => (
              <button
                key={g.key}
                onClick={() => toggleGraph(g.key)}
                className={`px-2 py-1 text-xs rounded-sm border transition-all ${
                  activeGraphs.includes(g.key)
                    ? 'border-motorsport-border bg-motorsport-surface text-motorsport-text'
                    : 'border-transparent text-motorsport-dim hover:text-motorsport-muted'
                }`}
                style={activeGraphs.includes(g.key) ? { borderColor: g.color } : {}}
              >
                <span className="w-2 h-2 rounded-full inline-block mr-1" style={{ backgroundColor: g.color }} />
                {g.label}
              </button>
            ))}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setPaused(!paused)}
            className="p-1.5 rounded-sm bg-motorsport-surface hover:bg-motorsport-surface/80 transition-colors"
          >
            {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </button>
          <button 
            onClick={() => setPaused(false)}
            className="p-1.5 rounded-sm bg-motorsport-surface hover:bg-motorsport-surface/80 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      {/* Graphs */}
      <div 
        ref={containerRef}
        className="flex-1 flex flex-col gap-1 overflow-hidden"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {activeConfigs.map(config => (
          <TelemetryGraph
            key={config.key}
            config={config}
            frames={visibleFrames}
            hoverX={hoverX}
            containerRef={containerRef}
          />
        ))}
      </div>
      
      {/* Hover Tooltip */}
      {hoverX !== null && currentFrame && (
        <div className="telemetry-panel p-2 flex gap-4 shrink-0">
          {activeConfigs.map(g => (
            <div key={g.key} className="flex items-center gap-1.5">
              <span className="text-xs text-motorsport-muted">{g.label}:</span>
              <span className="font-telemetry text-sm font-bold" style={{ color: g.color }}>
                {g.getter(currentFrame).toFixed(g.max <= 1 ? 2 : 0)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface TelemetryGraphProps {
  config: GraphConfig;
  frames: TelemetryFrame[];
  hoverX: number | null;
  containerRef: React.RefObject<HTMLDivElement>;
}

function TelemetryGraph({ config, frames, hoverX, containerRef }: TelemetryGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      
      const w = rect.width;
      const h = rect.height;
      const padding = { top: 4, bottom: 4, left: 40, right: 8 };
      
      ctx.clearRect(0, 0, w, h);
      
      // Background
      ctx.fillStyle = '#141414';
      ctx.fillRect(0, 0, w, h);
      
      // Grid lines
      ctx.strokeStyle = '#1e1e1e';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = padding.top + (h - padding.top - padding.bottom) * (i / 4);
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(w - padding.right, y);
        ctx.stroke();
      }
      
      // Label
      ctx.fillStyle = '#888';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(config.label, padding.left - 6, h / 2);
      
      // Min/Max labels
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillText(config.max.toString(), padding.left - 4, padding.top + 6);
      ctx.fillText(config.min.toString(), padding.left - 4, h - padding.bottom - 2);
      
      if (frames.length < 2) {
        ctx.fillStyle = '#555';
        ctx.textAlign = 'center';
        ctx.fillText('NO DATA', w / 2, h / 2);
        return;
      }
      
      const graphW = w - padding.left - padding.right;
      const graphH = h - padding.top - padding.bottom;
      
      const mapY = (val: number) => {
        const norm = (val - config.min) / (config.max - config.min);
        return padding.top + graphH * (1 - norm);
      };
      
      const mapX = (idx: number) => {
        return padding.left + (idx / (frames.length - 1)) * graphW;
      };
      
      // Draw line
      ctx.beginPath();
      ctx.strokeStyle = config.color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      
      frames.forEach((frame, i) => {
        const val = config.getter(frame);
        const x = mapX(i);
        const y = mapY(val);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      
      // Fill area under line
      ctx.lineTo(mapX(frames.length - 1), h - padding.bottom);
      ctx.lineTo(padding.left, h - padding.bottom);
      ctx.closePath();
      ctx.fillStyle = config.color + '10';
      ctx.fill();
      
      // Hover cursor
      if (hoverX !== null && containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        const relativeX = hoverX - (canvasRect.left - containerRect.left);
        
        if (relativeX >= padding.left && relativeX <= w - padding.right) {
          const idx = Math.round(((relativeX - padding.left) / graphW) * (frames.length - 1));
          const frame = frames[Math.min(idx, frames.length - 1)];
          if (frame) {
            const val = config.getter(frame);
            const x = mapX(Math.min(idx, frames.length - 1));
            const y = mapY(val);
            
            ctx.beginPath();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, h - padding.bottom);
            ctx.stroke();
            ctx.setLineDash([]);
            
            ctx.beginPath();
            ctx.fillStyle = config.color;
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px "JetBrains Mono", monospace';
            ctx.textAlign = 'left';
            ctx.fillText(val.toFixed(config.max <= 1 ? 2 : 0), x + 6, y - 6);
          }
        }
      }
    };
    
    render();
    
    const animate = () => {
      render();
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [frames, config, hoverX, containerRef]);
  
  return (
    <div className="flex-1 min-h-[60px] relative">
      <canvas 
        ref={canvasRef}
        className="w-full h-full block"
      />
    </div>
  );
}
