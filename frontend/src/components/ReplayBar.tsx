import { useEffect, useRef, useState } from 'react';
import { Pause, Play, X } from 'lucide-react';
import { useReplay } from '@/stores/replayStore';
import { formatTime } from '@/utils/formatters';

const SPEEDS = [0.5, 1, 2, 4];

// Transport for a recorded session playing through the live page. The scrubber
// is the session laid out lap by lap, each slice as wide as the lap was long.
export default function ReplayBar() {
  const { session, laps, offsets, playing, speed, t, play, pause, seek, setSpeed, stop, tick } = useReplay();
  const [hover, setHover] = useState<{ lap: number; x: number } | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Drive playback from animation frames while this bar is mounted.
  useEffect(() => {
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      if (useReplay.getState().playing) tick(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tick]);

  if (!session || !laps.length) return null;
  const total = offsets[offsets.length - 1];
  const lapIdx = Math.max(0, offsets.findIndex((o, i) => t >= o && t < (offsets[i + 1] ?? Infinity)));
  const lap = laps[lapIdx];

  const timeAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * total;
  };
  const hovered = hover ? laps[hover.lap] : null;

  return (
    <div className="telemetry-panel h-12 flex items-center gap-3 px-3 shrink-0 border-t-2 border-t-motorsport-purple">
      <button onClick={playing ? pause : play} className="w-8 h-8 flex items-center justify-center border border-motorsport-border-strong text-motorsport-text hover:border-motorsport-orange transition-colors" title={playing ? 'Pause' : 'Play'}>
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <div className="flex border border-motorsport-border">
        {SPEEDS.map(s => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`px-2 h-7 font-telemetry text-[12px] tabular-nums border-r last:border-r-0 border-motorsport-border transition-colors ${
              s === speed ? 'bg-motorsport-surface text-motorsport-text' : 'text-motorsport-muted hover:text-motorsport-text'
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
      <span className="font-telemetry text-[14px] tabular-nums text-motorsport-text w-[72px] shrink-0">
        {formatTime(Math.round(t - offsets[lapIdx]))}
      </span>
      <span className="text-[12px] font-semibold text-motorsport-muted shrink-0">
        lap {lap.number}{lap.nickname ? ` · ${lap.nickname}` : ''}
      </span>

      {/* Scrubber: one slice per lap, hover for its times */}
      <div
        ref={trackRef}
        className="relative flex-1 h-7 flex cursor-pointer select-none"
        onMouseDown={e => { dragging.current = true; seek(timeAt(e.clientX)); }}
        onMouseMove={e => {
          const time = timeAt(e.clientX);
          const idx = Math.max(0, offsets.findIndex((o, i) => time >= o && time < (offsets[i + 1] ?? Infinity)));
          const rect = trackRef.current?.getBoundingClientRect();
          setHover({ lap: idx, x: rect ? e.clientX - rect.left : 0 });
          if (dragging.current) seek(time);
        }}
        onMouseUp={() => { dragging.current = false; }}
        onMouseLeave={() => { dragging.current = false; setHover(null); }}
      >
        {laps.map((l, i) => (
          <div
            key={l.number}
            className="h-full border-r border-motorsport-panel last:border-r-0 transition-colors"
            style={{
              width: `${(l.timeMs / total) * 100}%`,
              backgroundColor: i === lapIdx ? '#2A3745' : hover?.lap === i ? '#1F2A38' : '#141B24',
            }}
          />
        ))}
        <div className="absolute top-0 bottom-0 w-[2px] bg-motorsport-purple pointer-events-none" style={{ left: `${(t / total) * 100}%` }} />
        {hovered && hover && (
          <div
            className="absolute bottom-full mb-2 px-3 py-2 bg-motorsport-panel border border-motorsport-border-strong shadow-panel-lg pointer-events-none whitespace-nowrap"
            style={{ left: Math.max(0, hover.x - 90) }}
          >
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-bold text-motorsport-text">Lap {hovered.number}</span>
              {hovered.nickname && <span className="text-[12px] text-motorsport-muted font-semibold">{hovered.nickname}</span>}
              <span className="font-telemetry text-[14px] tabular-nums text-motorsport-purple">{formatTime(hovered.timeMs)}</span>
            </div>
            <div className="font-telemetry text-[12px] tabular-nums text-motorsport-muted mt-1">
              {hovered.sectorsMs.map(s => (s ? formatTime(s).replace(/^0:/, '') : '--.---')).join('   ')}
            </div>
          </div>
        )}
      </div>

      <span className="text-[13px] font-bold tracking-wide text-motorsport-text truncate max-w-[220px]">{session.name}</span>
      <button onClick={stop} className="w-8 h-8 flex items-center justify-center text-motorsport-muted hover:text-motorsport-red transition-colors" title="Back to live">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
