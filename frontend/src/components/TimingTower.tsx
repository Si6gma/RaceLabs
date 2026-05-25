import { memo } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { formatTime } from '@/utils/formatters';

function deltaColor(ms: number): string {
  if (ms < -200)  return '#00FF88';
  if (ms < 0)     return '#00FF88';
  if (ms === 0)   return '#cdd9e5';
  if (ms < 300)   return '#FFCC00';
  return '#FF3333';
}

function TimingTower() {
  const l       = useTelemetryStore(s => s.currentFrame?.lap);
  const t       = useTelemetryStore(s => s.currentFrame?.telemetry);
  const s       = useTelemetryStore(s => s.currentFrame?.status);
  const session = useTelemetryStore(s => s.session);

  const position   = l?.car_position ?? 0;
  const lapNum     = l?.current_lap_num ?? 0;
  const totalLaps  = session?.total_laps ?? 0;
  const currentMs  = l?.current_lap_time_ms ?? 0;
  const bestMs     = session?.best_lap_time ?? null;
  const lastMs     = l?.last_lap_time_ms ?? 0;
  const invalid    = l?.current_lap_invalid ?? false;
  const pitStatus  = l?.pit_status ?? 0;

  // Live delta: current lap time vs session best
  const deltaMs = bestMs && currentMs > 0 ? currentMs - bestMs : null;

  const drsActive  = t?.drs === 1;
  const drsAllowed = s?.drs_allowed === 1;

  const s1ms = l?.sector1_time_ms ?? 0;
  const s2ms = l?.sector2_time_ms ?? 0;
  const s3ms = lastMs && s1ms && s2ms ? Math.max(0, lastMs - s1ms - s2ms) : 0;

  return (
    <div className="telemetry-panel flex flex-col h-full overflow-hidden">
      <div className="panel-header shrink-0">
        <span className="text-[10px] font-semibold tracking-widest text-motorsport-muted uppercase">
          Timing
        </span>
        {pitStatus > 0 && (
          <span className="eng-chip ml-auto bg-motorsport-yellow/15 text-motorsport-yellow border-motorsport-yellow/30">
            PIT
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 p-2 flex flex-col gap-2 overflow-hidden">
        {/* Position — large */}
        <div className="flex items-baseline gap-2">
          <span className="eng-label">POS</span>
          <span
            className="font-telemetry font-black leading-none"
            style={{ fontSize: '3.5rem', color: position <= 3 ? '#00FF88' : '#cdd9e5' }}
          >
            P{position || '--'}
          </span>
          <div className="ml-auto text-right">
            <span className="eng-label block">LAP</span>
            <span className="font-telemetry text-xl font-bold text-motorsport-text tabular-nums">
              {lapNum || '--'}
              {totalLaps > 0 && (
                <span className="text-sm text-motorsport-muted font-normal">/{totalLaps}</span>
              )}
            </span>
          </div>
        </div>

        {/* Live delta vs best */}
        <div className="bg-motorsport-dark rounded p-2">
          <span className="eng-label block mb-1">DELTA vs BEST</span>
          <span
            className="font-telemetry text-2xl font-bold tabular-nums leading-none"
            style={{ color: deltaMs == null ? '#768390' : deltaColor(deltaMs) }}
          >
            {deltaMs == null
              ? '--:--.---'
              : `${deltaMs > 0 ? '+' : ''}${(deltaMs / 1000).toFixed(3)}s`}
          </span>
        </div>

        {/* Current lap time */}
        <div>
          <span className="eng-label">CURRENT LAP</span>
          <div className="flex items-center gap-2">
            <span className={`font-telemetry text-lg font-bold tabular-nums ${invalid ? 'text-motorsport-red' : 'text-motorsport-text'}`}>
              {formatTime(currentMs)}
            </span>
            {invalid && (
              <span className="eng-chip bg-motorsport-red/15 text-motorsport-red border-motorsport-red/30">
                INV
              </span>
            )}
          </div>
        </div>

        {/* Sector splits */}
        <div className="grid grid-cols-3 gap-1">
          {[['S1', s1ms], ['S2', s2ms], ['S3', s3ms]].map(([sec, ms]) => (
            <div key={sec as string} className="bg-motorsport-dark rounded px-1.5 py-1">
              <span className="eng-label block">{sec as string}</span>
              <span className="font-telemetry text-[10px] tabular-nums text-motorsport-muted">
                {(ms as number) > 0 ? formatTime(ms as number) : '--:--.---'}
              </span>
            </div>
          ))}
        </div>

        {/* Session best */}
        <div className="flex items-center gap-2">
          <span className="eng-label">SESSION BEST</span>
          <span className="font-telemetry text-xs tabular-nums text-eng-cyan ml-auto">
            {bestMs ? formatTime(bestMs) : '--:--.---'}
          </span>
        </div>

        {/* DRS status */}
        <div className="mt-auto pt-2 border-t border-motorsport-border/40 flex items-center gap-2">
          <span className="eng-label">DRS</span>
          <span
            className="eng-chip"
            style={{
              backgroundColor: drsActive ? '#00FF8820' : drsAllowed ? '#FFCC0015' : '#21303f',
              color: drsActive ? '#00FF88' : drsAllowed ? '#FFCC00' : '#444c56',
              borderColor: drsActive ? '#00FF8840' : drsAllowed ? '#FFCC0030' : '#21303f',
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
