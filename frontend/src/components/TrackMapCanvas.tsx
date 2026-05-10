import { useRef, useEffect } from 'react';

interface MiniTrackMapProps {
  posX?: number;
  posZ?: number;
  sessionTime?: number;
  history?: { x: number; z: number; speed: number }[];
}

export function MiniTrackMap({ posX = 0, posZ = 0, history = [] }: MiniTrackMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<{ x: number; z: number; speed: number }[]>([]);
  
  useEffect(() => {
    if (posX !== 0 || posZ !== 0) {
      historyRef.current.push({ x: posX, z: posZ, speed: 0 });
      if (historyRef.current.length > 2000) {
        historyRef.current = historyRef.current.slice(-2000);
      }
    }
  }, [posX, posZ]);
  
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
    
    const points = historyRef.current.length > 0 ? historyRef.current : history;
    if (points.length < 2) {
      // Draw placeholder
      ctx.strokeStyle = '#2a2a2a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(w/2, h/2, 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#555';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('WAITING FOR GPS', w/2, h/2 + 4);
      return;
    }
    
    // Calculate bounds
    const xs = points.map(p => p.x);
    const zs = points.map(p => p.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    
    const padding = 10;
    const scaleX = (w - padding * 2) / (maxX - minX || 1);
    const scaleZ = (h - padding * 2) / (maxZ - minZ || 1);
    const scale = Math.min(scaleX, scaleZ);
    
    const offsetX = (w - (maxX - minX) * scale) / 2 - minX * scale;
    const offsetZ = (h - (maxZ - minZ) * scale) / 2 - minZ * scale;
    
    const transform = (x: number, z: number) => ({
      x: x * scale + offsetX,
      y: z * scale + offsetZ,
    });
    
    // Draw track line
    ctx.beginPath();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    points.forEach((p, i) => {
      const tp = transform(p.x, p.z);
      if (i === 0) ctx.moveTo(tp.x, tp.y);
      else ctx.lineTo(tp.x, tp.y);
    });
    ctx.stroke();
    
    // Draw speed-colored recent path
    const recent = points.slice(-100);
    for (let i = 1; i < recent.length; i++) {
      const p1 = transform(recent[i-1].x, recent[i-1].z);
      const p2 = transform(recent[i].x, recent[i].z);
      ctx.beginPath();
      ctx.strokeStyle = `rgba(0, 229, 255, ${i / recent.length * 0.8})`;
      ctx.lineWidth = 2;
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    
    // Draw current position
    const current = transform(posX, posZ);
    ctx.beginPath();
    ctx.fillStyle = '#ff6b00';
    ctx.arc(current.x, current.y, 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Glow
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255, 107, 0, 0.3)';
    ctx.arc(current.x, current.y, 8, 0, Math.PI * 2);
    ctx.fill();
    
  }, [posX, posZ, history]);
  
  return (
    <div className="flex flex-col gap-2 h-full">
      <span className="telemetry-label">TRACK MAP</span>
      <canvas 
        ref={canvasRef} 
        className="flex-1 w-full min-h-[120px] bg-motorsport-charcoal rounded-sm"
      />
    </div>
  );
}
