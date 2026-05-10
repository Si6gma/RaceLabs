import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { Map, ZoomIn, ZoomOut, RotateCcw, Layers } from 'lucide-react';



export default function TrackMapPage() {
  const { frameHistory, currentFrame } = useTelemetryStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 });
  const [overlay, setOverlay] = useState<'speed' | 'throttle' | 'brake'>('speed');
  const [showRacingLine, setShowRacingLine] = useState(true);
  
  const trackPoints = useMemo(() => {
    return frameHistory
      .filter(f => f.motion?.world_pos_x !== undefined)
      .map(f => ({
        x: f.motion!.world_pos_x,
        y: f.motion!.world_pos_y,
        speed: f.telemetry?.speed || 0,
        throttle: f.telemetry?.throttle || 0,
        brake: f.telemetry?.brake || 0,
      }));
  }, [frameHistory]);
  
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.5, Math.min(5, z * delta)));
  }, []);
  
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true);
    setLastMouse({ x: e.clientX, y: e.clientY });
  }, []);
  
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    setLastMouse({ x: e.clientX, y: e.clientY });
  }, [dragging, lastMouse]);
  
  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const w = rect.width;
    const h = rect.height;
    
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);
    
    if (trackPoints.length < 2) {
      ctx.fillStyle = '#555';
      ctx.font = '14px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('WAITING FOR TRACK DATA...', w/2, h/2);
      return;
    }
    
    // Calculate bounds
    const xs = trackPoints.map(p => p.x);
    const ys = trackPoints.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    
    const padding = 40;
    const baseScaleX = (w - padding * 2) / (maxX - minX || 1);
    const baseScaleY = (h - padding * 2) / (maxY - minY || 1);
    const baseScale = Math.min(baseScaleX, baseScaleY);
    
    const cx = w / 2;
    const cy = h / 2;
    
    const transform = (x: number, y: number) => {
      const tx = (x - (minX + maxX) / 2) * baseScale * zoom + cx + offset.x;
      const ty = (y - (minY + maxY) / 2) * baseScale * zoom + cy + offset.y;
      return { x: tx, y: ty };
    };
    
    // Draw track outline
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Outer edge
    ctx.beginPath();
    ctx.strokeStyle = '#1e1e1e';
    ctx.lineWidth = 24 * zoom;
    trackPoints.forEach((p, i) => {
      const tp = transform(p.x, p.y);
      if (i === 0) ctx.moveTo(tp.x, tp.y);
      else ctx.lineTo(tp.x, tp.y);
    });
    ctx.stroke();
    
    // Colored overlay
    if (showRacingLine) {
      for (let i = 1; i < trackPoints.length; i++) {
        const p1 = trackPoints[i-1];
        const p2 = trackPoints[i];
        const t1 = transform(p1.x, p1.y);
        const t2 = transform(p2.x, p2.y);
        
        let color: string;
        
        if (overlay === 'speed') {
          const norm = Math.min(p2.speed / 350, 1);
          color = `hsl(${200 - norm * 200}, 100%, 50%)`;
        } else if (overlay === 'throttle') {
          color = `rgba(0, 230, 118, ${p2.throttle * 0.8 + 0.2})`;
        } else {
          color = `rgba(255, 23, 68, ${p2.brake * 0.8 + 0.2})`;
        }
        
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 8 * zoom;
        ctx.moveTo(t1.x, t1.y);
        ctx.lineTo(t2.x, t2.y);
        ctx.stroke();
      }
    }
    
    // Center line
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 8]);
    trackPoints.forEach((p, i) => {
      const tp = transform(p.x, p.y);
      if (i === 0) ctx.moveTo(tp.x, tp.y);
      else ctx.lineTo(tp.x, tp.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Current position
    if (currentFrame?.motion) {
      const cp = transform(currentFrame.motion.world_pos_x, currentFrame.motion.world_pos_y);
      
      // Glow
      ctx.beginPath();
      ctx.fillStyle = 'rgba(255, 107, 0, 0.2)';
      ctx.arc(cp.x, cp.y, 16 * zoom, 0, Math.PI * 2);
      ctx.fill();
      
      // Car dot
      ctx.beginPath();
      ctx.fillStyle = '#ff6b00';
      ctx.arc(cp.x, cp.y, 5 * zoom, 0, Math.PI * 2);
      ctx.fill();
      
      // Direction indicator
      if (currentFrame.motion.yaw !== undefined) {
        const yaw = currentFrame.motion.yaw;
        ctx.beginPath();
        ctx.strokeStyle = '#ff6b00';
        ctx.lineWidth = 2;
        ctx.moveTo(cp.x, cp.y);
        ctx.lineTo(
          cp.x + Math.cos(yaw) * 20 * zoom,
          cp.y + Math.sin(yaw) * 20 * zoom
        );
        ctx.stroke();
      }
    }
    
  }, [trackPoints, currentFrame, zoom, offset, overlay, showRacingLine]);
  
  return (
    <div className="h-full flex flex-col p-3 gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between telemetry-panel p-2 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Map className="w-4 h-4 text-motorsport-orange" />
            <span className="text-sm font-semibold">TRACK MAP</span>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-xs text-motorsport-muted">Overlay:</span>
            {(['speed', 'throttle', 'brake'] as const).map(o => (
              <button
                key={o}
                onClick={() => setOverlay(o)}
                className={`px-2 py-1 text-xs rounded-sm border transition-all capitalize ${
                  overlay === o
                    ? 'border-motorsport-orange text-motorsport-text bg-motorsport-orange/10'
                    : 'border-transparent text-motorsport-dim hover:text-motorsport-muted'
                }`}
              >
                {o}
              </button>
            ))}
          </div>
          
          <button
            onClick={() => setShowRacingLine(!showRacingLine)}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded-sm border transition-all ${
              showRacingLine
                ? 'border-motorsport-cyan text-motorsport-cyan bg-motorsport-cyan/10'
                : 'border-transparent text-motorsport-dim'
            }`}
          >
            <Layers className="w-3 h-3" />
            Racing Line
          </button>
        </div>
        
        <div className="flex items-center gap-1">
          <button 
            onClick={() => setZoom(z => Math.min(5, z * 1.2))}
            className="p-1.5 rounded-sm bg-motorsport-surface hover:bg-motorsport-surface/80"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setZoom(z => Math.max(0.5, z / 1.2))}
            className="p-1.5 rounded-sm bg-motorsport-surface hover:bg-motorsport-surface/80"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button 
            onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}
            className="p-1.5 rounded-sm bg-motorsport-surface hover:bg-motorsport-surface/80"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      {/* Canvas */}
      <div 
        ref={containerRef}
        className="flex-1 telemetry-panel overflow-hidden cursor-move"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <canvas 
          ref={canvasRef}
          className="w-full h-full block"
        />
      </div>
      
      {/* Legend */}
      <div className="telemetry-panel p-2 flex items-center gap-6 shrink-0">
        {overlay === 'speed' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-motorsport-muted">Speed:</span>
            <div className="flex items-center gap-1">
              <div className="w-16 h-2 rounded-sm" style={{ background: 'linear-gradient(90deg, #00e5ff, #ffea00, #ff1744)' }} />
              <span className="text-[10px] text-motorsport-muted">0-350 km/h</span>
            </div>
          </div>
        )}
        {overlay === 'throttle' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-motorsport-muted">Throttle:</span>
            <div className="w-3 h-3 rounded-sm bg-motorsport-green" />
            <span className="text-[10px] text-motorsport-muted">0-100%</span>
          </div>
        )}
        {overlay === 'brake' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-motorsport-muted">Brake:</span>
            <div className="w-3 h-3 rounded-sm bg-motorsport-red" />
            <span className="text-[10px] text-motorsport-muted">0-100%</span>
          </div>
        )}
        <span className="text-xs text-motorsport-dim">Points: {trackPoints.length}</span>
      </div>
    </div>
  );
}
