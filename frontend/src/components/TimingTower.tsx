import { memo, useRef } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { formatTime } from '@/utils/formatters';
import { GapTracker, RACE_SESSION_TYPES, type Gap } from '@/utils/raceGaps';
import { SectorTracker, type SectorColour } from '@/utils/sectorTimes';
import CarSelector from '@/components/CarSelector';

const SECTOR_COLOURS: Record<SectorColour, string> = {
  purple: '#8855FF',
  green:  '#00E85A',
  yellow: '#FFD000',
  none:   '#9AACBE',
};

function deltaColor(ms: number): string {
  if (ms <= 0)   return '#00E85A';
  if (ms < 300)  return '#FFD000';
  return '#FF2044';
}

const GOOD = '#00E85A';
const BAD  = '#FF2044';

// Pace on the last lap both cars completed: their lap time minus ours.
// Positive means they were slower than us, which is good either side.
function GapRow({ label, gap, name, behind, pace }: {
  label: string; gap: Gap | null; name: string; behind: boolean; pace: { lap: number; ms: number } | null;
}) {
  const good = pace ? pace.ms >= 0 : null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="eng-label">{label}</span>
        <span className="text-[14px] font-semibold tracking-wide text-motorsport-text truncate">{gap ? name : '—'}</span>
      </div>
      <span className="font-telemetry text-[28px] font-bold tabular-nums leading-none" style={{ color: gap ? '#E8EEF4' : '#5F7183' }}>
        {gap ? `${behind ? '+' : '−'}${(gap.gapMs / 1000).toFixed(3)}s` : '--.---'}
      </span>
      <span className="flex items-baseline justify-between h-[13px] leading-none">
        <span className="font-telemetry text-[13px] font-semibold tabular-nums" style={{ color: good == null ? '#5F7183' : good ? GOOD : BAD }}>
          {pace ? `${pace.ms >= 0 ? '+' : '−'}${(Math.abs(pace.ms) / 1000).toFixed(3)} ${pace.ms >= 0 ? 'slower' : 'faster'}` : gap ? 'waiting for a full lap' : ''}
        </span>
        {pace && <span className="text-[12px] text-motorsport-muted font-semibold">lap {pace.lap}</span>}
      </span>
    </div>
  );
}

function TimingTower() {
  const l       = useTelemetryStore(s => s.currentFrame?.lap);
  const session = useTelemetryStore(s => s.session);
  const lapAll      = useTelemetryStore(s => s.currentFrame?.lap_all);
  const sessionData = useTelemetryStore(s => s.currentFrame?.session);
  const playerIdx   = useTelemetryStore(s => s.currentFrame?.player_car_index);
  const selectedIdx = useTelemetryStore(s => s.selectedCarIndex);
  const participants = useTelemetryStore(s => s.participants);
  const tracker = useRef(new GapTracker());
  const sectors = useRef({ sessionId: '', tracker: new SectorTracker() });
  if (session?.session_id && session.session_id !== sectors.current.sessionId) {
    sectors.current = { sessionId: session.session_id, tracker: new SectorTracker() };
  }

  const isRace = sessionData != null && RACE_SESSION_TYPES.has(sessionData.session_type);
  const viewedIdx = selectedIdx ?? playerIdx ?? 0;
  const gaps = isRace && lapAll
    ? tracker.current.update(lapAll, viewedIdx, sessionData?.track_length ?? 0)
    : { ahead: null, behind: null };
  if (lapAll) sectors.current.tracker.update(lapAll);
  const sectorTimes = sectors.current.tracker.latestFor(viewedIdx);
  const nameOf = (idx: number) => participants.find(p => p.index === idx)?.name ?? `Car ${idx + 1}`;

  const position  = l?.car_position ?? 0;
  const lapNum    = l?.current_lap_num ?? 0;
  const totalLaps = session?.total_laps ?? 0;
  const currentMs = l?.current_lap_time_ms ?? 0;
  // The backend only knows a best lap once it is recording, so prefer what the
  // tracker has seen the viewed car set this session.
  // Until a lap completes on screen, the last lap time is the best we know.
  const lastLapMs = l?.last_lap_time_ms ?? 0;
  const bestMs    = sectors.current.tracker.bestLapFor(viewedIdx) ?? session?.best_lap_time ?? (lastLapMs > 0 ? lastLapMs : null);
  const invalid   = l?.current_lap_invalid ?? false;
  const pitStatus = l?.pit_status ?? 0;
  const deltaMs   = bestMs && currentMs > 0 ? currentMs - bestMs : null;

  return (
    <div className="telemetry-panel flex flex-col h-full overflow-hidden">
      <CarSelector />

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden divide-y divide-motorsport-border">
        {/* P10 on the left; the running lap time over the lap count on the right */}
        <div className="px-3 py-3 flex items-end justify-between shrink-0">
          <div className="flex items-end gap-2">
            <span
              className="font-telemetry font-bold leading-none tabular-nums text-motorsport-text"
              style={{ fontSize: '56px' }}
            >
              P{position || '--'}
            </span>
            {pitStatus > 0 && (
              <span className="eng-chip mb-1 bg-motorsport-yellow/15 text-motorsport-yellow border-motorsport-yellow/30">Pit</span>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              {invalid && (
                <span className="eng-chip bg-motorsport-red/15 text-motorsport-red border-motorsport-red/30">Invalid</span>
              )}
              <span className={`font-telemetry text-[22px] font-semibold tabular-nums leading-none ${invalid ? 'text-motorsport-red' : 'text-motorsport-text'}`}>
                {formatTime(currentMs)}
              </span>
            </div>
            <span className="font-telemetry text-[28px] font-bold tabular-nums leading-none text-motorsport-text">
              {lapNum || '--'}
              {totalLaps > 0 && (
                <span className="text-[18px] text-motorsport-muted font-normal">/{totalLaps}</span>
              )}
            </span>
          </div>
        </div>

        {/* Races: gaps to the cars either side. Otherwise: delta vs best.
            Both take the same height so nothing below moves between sessions. */}
        {isRace ? (
        <div className="px-3 py-3 bg-motorsport-dark shrink-0 h-[180px] flex flex-col justify-between">
          <GapRow
            label="Ahead" behind={false} gap={gaps.ahead}
            name={gaps.ahead ? nameOf(gaps.ahead.carIndex) : ''}
            pace={gaps.ahead ? sectors.current.tracker.paceDeltaFor(viewedIdx, gaps.ahead.carIndex) : null}
          />
          <GapRow
            label="Behind" behind gap={gaps.behind}
            name={gaps.behind ? nameOf(gaps.behind.carIndex) : ''}
            pace={gaps.behind ? sectors.current.tracker.paceDeltaFor(viewedIdx, gaps.behind.carIndex) : null}
          />
        </div>
        ) : (
        <div className="px-3 py-3 bg-motorsport-dark shrink-0 h-[180px] flex flex-col justify-center gap-2">
          <span className="eng-label">Delta to best</span>
          <span
            className="font-telemetry font-bold tabular-nums leading-none"
            style={{
              fontSize: '36px',
              color: deltaMs == null ? '#5F7183' : deltaColor(deltaMs),
            }}
          >
            {deltaMs == null
              ? '--:--.---'
              : `${deltaMs > 0 ? '+' : ''}${(deltaMs / 1000).toFixed(3)}s`}
          </span>
        </div>
        )}

        {/* Sectors */}
        <div className="px-3 py-2.5 shrink-0">
          <div className="grid grid-cols-3 gap-2">
            {sectorTimes.map((sec, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <span className="eng-label">S{i + 1}</span>
                <span
                  className="font-telemetry text-[15px] font-semibold tabular-nums leading-none"
                  style={{ color: sec ? SECTOR_COLOURS[sec.colour] : '#5F7183' }}
                >
                  {sec ? formatTime(sec.ms).replace(/^0:/, '') : '--.---'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Session best: purple is the F1 colour for it, so no label needed */}
        <div className="px-3 py-3 flex-1 min-h-[56px] flex items-center justify-center">
          <span className="font-telemetry text-[28px] font-bold tabular-nums leading-none text-motorsport-purple">
            {bestMs ? formatTime(bestMs) : '--:--.---'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default memo(TimingTower);
