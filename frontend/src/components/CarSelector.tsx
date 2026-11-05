import { useEffect, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Lock } from 'lucide-react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { TEAM_NAMES } from '@/utils/teams';
import DriverTag from '@/components/DriverTag';
import { useSettings } from '@/stores/settingsStore';

// Picks which car the dashboard follows. Lives at the top of the timing tower
// so the name sits directly above the numbers it belongs to.
function CarSelector() {
  const participants     = useTelemetryStore(s => s.participants);
  const selectedCarIndex = useTelemetryStore(s => s.selectedCarIndex);
  const playerCarIndex   = useTelemetryStore(s => s.currentFrame?.player_car_index);
  const setSelectedCarIndex = useTelemetryStore(s => s.setSelectedCarIndex);
  const lapAll = useTelemetryStore(s => s.currentFrame?.lap_all);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hideAi = useSettings(s => s.hideAiDrivers);

  // The list is portalled to the body, so it is never clipped by the panel
  // it sits in. It is pinned under the button and bounded by the viewport.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = rootRef.current?.getBoundingClientRect();
      if (r) setAnchor({ top: r.bottom, left: r.left, width: r.width });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  // If the watched car leaves the session, fall back to the player's own car.
  useEffect(() => {
    if (selectedCarIndex === null) return;
    if (!participants.some(p => p.index === selectedCarIndex)) {
      setSelectedCarIndex(null);
    }
  }, [participants, selectedCarIndex, setSelectedCarIndex]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const viewedIndex = selectedCarIndex ?? playerCarIndex ?? null;
  const viewed      = participants.find(p => p.index === viewedIndex);
  const spectating  = selectedCarIndex !== null;
  const title       = viewed ? viewed.name : 'My car';

  // Until the grid is known there is nothing to pick, but the row keeps its
  // height so the tower does not jump when the participants packet lands.
  if (participants.length <= 1) {
    return (
      <div className="shrink-0 border-b border-motorsport-border flex items-center px-3 h-9">
        <span className="text-[15px] font-bold tracking-wide text-motorsport-text">My car</span>
      </div>
    );
  }

  const choose = (index: number | null) => {
    setSelectedCarIndex(index);
    setOpen(false);
  };

  // Running order: by the game's car_position, unknowns at the bottom.
  const positionOf = (index: number) => lapAll?.[index]?.car_position || 99;
  const listed = participants
    .filter(p => !hideAi || !p.ai_controlled || p.index === selectedCarIndex)
    .sort((a, b) => positionOf(a.index) - positionOf(b.index));

  return (
    <div ref={rootRef} className="relative shrink-0 border-b border-motorsport-border">
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-3 h-9 text-left hover:bg-motorsport-surface transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          {viewed && <DriverTag name={viewed.name} teamId={viewed.team_id} />}
          <span className="text-[15px] font-bold tracking-wide truncate text-motorsport-text">{title}</span>
          {viewed && (
            <span className="text-[12px] text-motorsport-muted font-semibold truncate">
              {spectating ? TEAM_NAMES[viewed.team_id] ?? '' : 'you'}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          {viewed && !viewed.telemetry_public && <Lock className="w-3.5 h-3.5 text-motorsport-orange" />}
          <ChevronDown className={`w-4 h-4 text-motorsport-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && anchor && createPortal(
        <ul
          role="listbox"
          className="fixed z-50 overflow-y-auto bg-motorsport-panel border border-motorsport-border-strong shadow-panel-lg"
          style={{ top: anchor.top, left: anchor.left, width: anchor.width, maxHeight: `calc(100vh - ${anchor.top + 16}px)` }}
          onMouseDown={e => e.stopPropagation()}
        >
          <Option
            selected={!spectating}
            name="My car"
            position={playerCarIndex !== undefined ? positionOf(playerCarIndex) : undefined}
            detail={playerCarIndex !== undefined ? `slot ${playerCarIndex + 1}` : ''}
            onPick={() => choose(null)}
          />
          {listed.map(p => (
            <Option
              key={p.index}
              selected={selectedCarIndex === p.index}
              name={p.name}
              teamId={p.team_id}
              position={positionOf(p.index)}
              detail={[`#${p.race_number}`, TEAM_NAMES[p.team_id], p.ai_controlled ? 'AI' : null].filter(Boolean).join(' · ')}
              locked={!p.telemetry_public}
              onPick={() => choose(p.index)}
            />
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}

function Option({
  selected, name, teamId, position, detail, locked, onPick,
}: {
  selected: boolean; name: string; teamId?: number; position?: number; detail: string; locked?: boolean; onPick: () => void;
}) {
  return (
    <li
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className={`flex items-center gap-2.5 px-3 h-9 cursor-pointer border-l-2 transition-colors ${
        selected ? 'border-motorsport-orange bg-motorsport-orange/[0.08]' : 'border-transparent hover:bg-motorsport-surface'
      }`}
    >
      {teamId !== undefined
        ? <DriverTag name={name} teamId={teamId} size="sm" />
        : <span className="w-[38px] shrink-0" />}
      <span className="font-telemetry text-[13px] font-semibold tabular-nums text-motorsport-text w-8 shrink-0">
        {position !== undefined && position < 99 ? `P${position}` : ''}
      </span>
      <span className="text-[14px] font-bold tracking-wide truncate text-motorsport-text">
        {name}
      </span>
      <span className="ml-auto text-[12px] text-motorsport-muted truncate">{detail}</span>
      {locked && <Lock className="w-3.5 h-3.5 text-motorsport-orange shrink-0" />}
    </li>
  );
}

export default memo(CarSelector);
