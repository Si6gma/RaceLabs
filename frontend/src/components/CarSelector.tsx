import { useEffect, memo } from 'react';
import { Eye, Lock } from 'lucide-react';
import { useTelemetryStore } from '@/stores/telemetryStore';

// Team id → short name (matches the ids used for TEAM_COLORS in TrackMapCanvas)
const TEAM_NAMES: Record<number, string> = {
  0: 'Mercedes', 1: 'Ferrari', 2: 'Red Bull', 3: 'Williams', 4: 'Aston Martin',
  5: 'Alpine', 6: 'AlphaTauri', 7: 'Haas', 8: 'McLaren', 9: 'Alfa Romeo', 85: 'MyTeam',
};

function CarSelector() {
  const participants     = useTelemetryStore(s => s.participants);
  const selectedCarIndex = useTelemetryStore(s => s.selectedCarIndex);
  const playerCarIndex   = useTelemetryStore(s => s.currentFrame?.player_car_index);
  const setSelectedCarIndex = useTelemetryStore(s => s.setSelectedCarIndex);

  // If the watched car leaves the session, fall back to the player's own car.
  useEffect(() => {
    if (selectedCarIndex === null) return;
    if (!participants.some(p => p.index === selectedCarIndex)) {
      setSelectedCarIndex(null);
    }
  }, [participants, selectedCarIndex, setSelectedCarIndex]);

  // Only meaningful once we know who's in the session (multiplayer / grid).
  if (participants.length <= 1) return null;

  const selected = participants.find(p => p.index === selectedCarIndex);
  const spectating = selectedCarIndex !== null;

  return (
    <div className="flex items-center gap-1.5">
      <Eye className={`w-3.5 h-3.5 ${spectating ? 'text-motorsport-cyan' : 'text-motorsport-dim'}`} />
      <select
        value={selectedCarIndex ?? ''}
        onChange={e => setSelectedCarIndex(e.target.value === '' ? null : Number(e.target.value))}
        className={`field pr-6 pl-2 appearance-none cursor-pointer text-[11px] h-7 uppercase tracking-wider max-w-[200px] ${
          spectating ? 'text-motorsport-cyan border-motorsport-cyan/40' : ''
        }`}
        title={selected && !selected.telemetry_public
          ? `${selected.name}: telemetry restricted (position & laps only)`
          : undefined}
      >
        <option value="">
          My Car{playerCarIndex !== undefined ? ` (P${playerCarIndex + 1} slot)` : ''}
        </option>
        {participants.map(p => (
          <option key={p.index} value={p.index}>
            {`#${p.race_number} ${p.name}`}
            {TEAM_NAMES[p.team_id] ? ` · ${TEAM_NAMES[p.team_id]}` : ''}
            {p.ai_controlled ? ' [AI]' : ''}
            {!p.telemetry_public ? ' 🔒' : ''}
          </option>
        ))}
      </select>
      {spectating && selected && !selected.telemetry_public && (
        <Lock className="w-3 h-3 text-motorsport-orange" />
      )}
    </div>
  );
}

export default memo(CarSelector);
