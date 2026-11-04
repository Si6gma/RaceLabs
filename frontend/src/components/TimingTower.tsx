import { memo, useRef } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { formatTime } from '@/utils/formatters';
import { GapTracker, RACE_SESSION_TYPES, type Gap } from '@/utils/raceGaps';
import { SectorTracker, type SectorColour } from '@/utils/sectorTimes';

const SECTOR_COLOURS: Record<SectorColour, string> = {
  purple: '#8855FF',
  green:  '#00E85A',
  yellow: '#FFD000',
  none:   '#7A8EA3',
};

function deltaColor(ms: number): string {
  if (ms <= 0)   return '#00E85A';
  if (ms < 300)  return '#FFD000';
  return '#FF2044';
}

const GOOD = '#00E85A';
const BAD  = '#FF2044';

// Ahead: a shrinking gap is good. Behind: a growing gap is good.
// The sign says which for the driver: + good (green), − bad (red).
function isGood(changeMs: number | null, behind: boolean): boolean | null {
  return changeMs == null ? null : behind ? changeMs > 0 : changeMs < 0;
}

function Rate({ label, changeMs, behind }: { label: string; changeMs: number | null; behind: boolean }) {
  const good = isGood(changeMs, behind);
  return (
    <span className="font-telemetry text-[10px] tabular-nums" style={{ color: good == null ? '#4A6078' : good ? GOOD : BAD }}>
      <span className="text-motorsport-dim">{label} </span>
      {changeMs == null ? '--' : `${good ? '+' : '−'}${(Math.abs(changeMs) / 1000).toFixed(2)}/lap`}
    </span>
  );
}

function GapRow({ label, gap, name, behind }: { label: string; gap: Gap | null; name: string; behind: boolean }) {
  const good = isGood(gap?.trendMs ?? gap?.nowMs ?? null, behind);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="eng-label">{label}</span>
        <span className="font-telemetry text-[10px] text-motorsport-muted truncate">{gap ? name : '—'}</span>
      </div>
      <span
        className="font-telemetry text-[17px] font-bold tabular-nums leading-none"
        style={{ color: good == null ? '#B8C8D6' : good ? GOOD : BAD }}
      >
        {gap ? `${(gap.gapMs / 1000).toFixed(3)}s` : '--.---'}
      </span>
      {/* NOW: the gap's derivative over the last ~300 m. LAP: vs this spot last lap. */}
      <div className="flex items-baseline justify-between">
        <Rate label="NOW" changeMs={gap?.nowMs ?? null} behind={behind} />
        <Rate label="LAP" changeMs={gap?.trendMs ?? null} behind={behind} />
      </div>
    </div>
  );
}

function TimingTower() {
  const l       = useTelemetryStore(s => s.currentFrame?.lap);
  const t       = useTelemetryStore(s => s.currentFrame?.telemetry);
  const s       = useTelemetryStore(s => s.currentFrame?.status);
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
  const bestMs    = session?.best_lap_time ?? null;
  const invalid   = l?.current_lap_invalid ?? false;
  const pitStatus = l?.pit_status ?? 0;
  const deltaMs   = bestMs && currentMs > 0 ? currentMs - bestMs : null;
  const drsActive  = t?.drs === 1;
  const drsAllowed = s?.drs_allowed === 1;

  return (
    <div className="telemetry-panel flex flex-col h-full overflow-hidden">
      <div className="panel-header justify-between">
        <span className="eng-label font-bold">Timing</span>
        {pitStatus > 0 && (
          <span className="eng-chip bg-motorsport-yellow/15 text-motorsport-yellow border-motorsport-yellow/30">
            PIT LANE
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden divide-y divide-motorsport-border/50">
        {/* Position + Lap */}
        <div className="px-2.5 pt-2 pb-2 flex items-end justify-between shrink-0">
          <div>
            <span className="eng-label block mb-0.5">POSITION</span>
            <span
              className="font-telemetry font-black leading-none tabular-nums"
              style={{ fontSize: '3.4rem', color: position === 1 ? '#00E85A' : position <= 3 ? '#FFD000' : '#B8C8D6' }}
            >
              P{position || '--'}
            </span>
          </div>
          <div className="text-right">
            <span className="eng-label block mb-0.5">LAP</span>
            <span className="font-telemetry text-2xl font-bold tabular-nums text-motorsport-text">
              {lapNum || '--'}
              {totalLaps > 0 && (
                <span className="text-base text-motorsport-muted font-normal">/{totalLaps}</span>
              )}
            </span>
          </div>
        </div>

        {/* Races: gaps to the cars either side. Otherwise: delta vs best. */}
        {isRace ? (
        <div className="px-2.5 py-2 bg-motorsport-dark/50 shrink-0 flex flex-col gap-2">
          <GapRow label="AHEAD" gap={gaps.ahead} name={gaps.ahead ? nameOf(gaps.ahead.carIndex) : ''} behind={false} />
          <GapRow label="BEHIND" gap={gaps.behind} name={gaps.behind ? nameOf(gaps.behind.carIndex) : ''} behind />
        </div>
        ) : (
        <div className="px-2.5 py-2 bg-motorsport-dark/50 shrink-0">
          <span className="eng-label block mb-1">DELTA VS BEST</span>
          <span
            className="font-telemetry font-bold tabular-nums leading-none"
            style={{
              fontSize: '1.9rem',
              color: deltaMs == null ? '#4A6078' : deltaColor(deltaMs),
            }}
          >
            {deltaMs == null
              ? '--:--.---'
              : `${deltaMs > 0 ? '+' : ''}${(deltaMs / 1000).toFixed(3)}s`}
          </span>
        </div>
        )}

        {/* Current lap */}
        <div className="px-2.5 py-1.5 flex items-center justify-between shrink-0">
          <span className="eng-label">CURRENT LAP</span>
          <div className="flex items-center gap-1.5">
            <span className={`font-telemetry text-[15px] font-semibold tabular-nums ${invalid ? 'text-motorsport-red' : 'text-motorsport-text'}`}>
              {formatTime(currentMs)}
            </span>
            {invalid && (
              <span className="eng-chip bg-motorsport-red/15 text-motorsport-red border-motorsport-red/30">INV</span>
            )}
          </div>
        </div>

        {/* Sectors */}
        <div className="px-2.5 py-1.5 shrink-0">
          <div className="grid grid-cols-3 gap-1.5">
            {sectorTimes.map((sec, i) => (
              <div key={i} className="flex flex-col gap-0.5">
                <span className="eng-label">S{i + 1}</span>
                <span
                  className="font-telemetry text-[11px] font-semibold tabular-nums"
                  style={{ color: sec ? SECTOR_COLOURS[sec.colour] : '#4A6078' }}
                >
                  {sec ? formatTime(sec.ms) : '--:--.---'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Session best */}
        <div className="px-2.5 py-1.5 flex items-center justify-between shrink-0">
          <span className="eng-label">SESSION BEST</span>
          <span className="font-telemetry text-[13px] tabular-nums text-motorsport-cyan">
            {bestMs ? formatTime(bestMs) : '--:--.---'}
          </span>
        </div>

        {/* DRS */}
        <div className="mt-auto px-2.5 py-1.5 flex items-center justify-between">
          <span className="eng-label">DRS</span>
          <span
            className="eng-chip"
            style={{
              backgroundColor: drsActive ? '#00E85A20' : drsAllowed ? '#FFD00015' : '#1A2840',
              color:            drsActive ? '#00E85A'   : drsAllowed ? '#FFD000'   : '#4A6078',
              borderColor:      drsActive ? '#00E85A40' : drsAllowed ? '#FFD00030' : '#1A2840',
            }}
          >
            {drsActive ? 'OPEN' : drsAllowed ? 'AVAIL' : 'CLOSED'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default memo(TimingTower);
