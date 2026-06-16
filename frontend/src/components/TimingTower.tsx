import { memo } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { formatTime } from '@/utils/formatters';

function deltaColor(ms: number): string {
  if (ms <= 0)   return '#00E85A';
  if (ms < 300)  return '#FFD000';
  return '#FF2044';
}

function TimingTower() {
  const l       = useTelemetryStore(s => s.currentFrame?.lap);
  const t       = useTelemetryStore(s => s.currentFrame?.telemetry);
  const s       = useTelemetryStore(s => s.currentFrame?.status);
  const session = useTelemetryStore(s => s.session);

  const position  = l?.car_position ?? 0;
  const lapNum    = l?.current_lap_num ?? 0;
  const totalLaps = session?.total_laps ?? 0;
  const currentMs = l?.current_lap_time_ms ?? 0;
  const bestMs    = session?.best_lap_time ?? null;
  const lastMs    = l?.last_lap_time_ms ?? 0;
  const invalid   = l?.current_lap_invalid ?? false;
  const pitStatus = l?.pit_status ?? 0;
  const deltaMs   = bestMs && currentMs > 0 ? currentMs - bestMs : null;
  const drsActive  = t?.drs === 1;
  const drsAllowed = s?.drs_allowed === 1;
  const s1ms = l?.sector1_time_ms ?? 0;
  const s2ms = l?.sector2_time_ms ?? 0;
  const s3ms = lastMs && s1ms && s2ms ? Math.max(0, lastMs - s1ms - s2ms) : 0;

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

        {/* Delta — hero number */}
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
            {[['S1', s1ms], ['S2', s2ms], ['S3', s3ms]].map(([sec, ms]) => (
              <div key={sec as string} className="flex flex-col gap-0.5">
                <span className="eng-label">{sec as string}</span>
                <span className="font-telemetry text-[11px] tabular-nums text-motorsport-muted">
                  {(ms as number) > 0 ? formatTime(ms as number) : '--:--.---'}
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
