import { useRef } from 'react';

interface Props {
  total: number;
  zoomRange: [number, number];
  onZoomChange: (r: [number, number]) => void;
}

export default function ZoomRangeBar({ total, zoomRange, onZoomChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'left' | 'right' | 'mid' | null>(null);
  const dragStart = useRef({ x: 0, zoomRange: [0, total] as [number, number] });

  const [zStart, zEnd] = zoomRange;
  const leftPct = (zStart / total) * 100;
  const rightPct = (zEnd / total) * 100;
  const isFullRange = zStart === 0 && zEnd === total;

  const getT = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(total, ((clientX - rect.left) / rect.width) * total));
  };

  const onMouseDown = (e: React.MouseEvent, which: 'left' | 'right' | 'mid') => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = which;
    dragStart.current = { x: e.clientX, zoomRange: [...zoomRange] as [number, number] };

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const [ds, de] = dragStart.current.zoomRange;
      const span = de - ds;

      if (dragging.current === 'left') {
        const t = getT(ev.clientX);
        onZoomChange([Math.min(t, de - 0.02), de]);
      } else if (dragging.current === 'right') {
        const t = getT(ev.clientX);
        onZoomChange([ds, Math.max(t, ds + 0.02)]);
      } else {
        const rect = trackRef.current?.getBoundingClientRect();
        if (!rect) return;
        const dx = ((ev.clientX - dragStart.current.x) / rect.width) * total;
        let ns = ds + dx;
        let ne = de + dx;
        if (ns < 0) { ns = 0; ne = span; }
        if (ne > total) { ne = total; ns = total - span; }
        onZoomChange([ns, ne]);
      }
    };
    const onUp = () => {
      dragging.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleTrackClick = (e: React.MouseEvent) => {
    if (dragging.current) return;
    const t = getT(e.clientX);
    const span = zEnd - zStart;
    let ns = t - span / 2;
    let ne = t + span / 2;
    if (ns < 0) { ns = 0; ne = span; }
    if (ne > total) { ne = total; ns = total - span; }
    onZoomChange([ns, ne]);
  };

  return (
    <div className="shrink-0 px-1 py-1.5">
      <div
        ref={trackRef}
        className="relative h-3 rounded-full bg-motorsport-surface cursor-pointer select-none"
        onClick={handleTrackClick}
      >
        <div
          className={`absolute inset-y-0 rounded-full ${isFullRange ? 'bg-motorsport-border' : 'bg-motorsport-blue/40'}`}
          style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
          onMouseDown={isFullRange ? undefined : (e) => onMouseDown(e, 'mid')}
          onClick={(e) => e.stopPropagation()}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-motorsport-blue border-2 border-motorsport-charcoal cursor-ew-resize shadow-sm"
          style={{ left: `calc(${leftPct}% - 6px)` }}
          onMouseDown={(e) => onMouseDown(e, 'left')}
          onClick={(e) => e.stopPropagation()}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-motorsport-blue border-2 border-motorsport-charcoal cursor-ew-resize shadow-sm"
          style={{ left: `calc(${rightPct}% - 6px)` }}
          onMouseDown={(e) => onMouseDown(e, 'right')}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}
