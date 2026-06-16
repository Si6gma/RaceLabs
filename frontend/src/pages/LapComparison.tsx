import { useMemo } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { Check, X, Trophy } from 'lucide-react';
import { formatTime, formatDelta } from '@/utils/formatters';

const LAP_COLORS = ['#00D4FF', '#FF7700', '#00E85A', '#FF2044'];

function getLapColor(lapNumber: number): string {
  return LAP_COLORS[(lapNumber - 1) % LAP_COLORS.length];
}

export default function LapComparison() {
  const laps             = useTelemetryStore(s => s.laps);
  const compareLaps      = useTelemetryStore(s => s.compareLaps);
  const toggleCompareLap = useTelemetryStore(s => s.toggleCompareLap);

  const lapList = useMemo(() =>
    Object.values(laps).sort((a, b) => a.lap_number - b.lap_number),
    [laps]
  );

  const bestLap = useMemo(() => {
    const valid = lapList.filter(l => l.valid && l.lap_time_ms > 0);
    if (!valid.length) return null;
    return valid.reduce((best, cur) => cur.lap_time_ms < best.lap_time_ms ? cur : best);
  }, [lapList]);

  const comparedLaps = useMemo(() =>
    lapList.filter(l => compareLaps.includes(l.lap_number)),
    [lapList, compareLaps]
  );

  return (
    <div className="h-full flex flex-col gap-px p-px bg-motorsport-dim/20 overflow-hidden">

      {/* ── Page header ── */}
      <div className="telemetry-panel shrink-0">
        <div className="panel-header justify-between">
          <span className="eng-label font-bold">Lap Comparison</span>
          <span className="text-[11px] text-motorsport-dim uppercase tracking-wider">
            Select up to 4 laps · {compareLaps.length}/4 selected
          </span>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex gap-px overflow-hidden min-h-0">

        {/* Lap list */}
        <div className="w-72 telemetry-panel flex flex-col overflow-hidden shrink-0">
          <div className="border-b border-motorsport-border bg-motorsport-dark/60 shrink-0">
            <div className="grid grid-cols-4 text-center py-1.5 px-2">
              {['LAP', 'TIME', 'VALID', 'CMP'].map(h => (
                <span key={h} className="eng-label">{h}</span>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            {lapList.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-motorsport-muted text-[13px] uppercase tracking-wider">
                No laps recorded
              </div>
            ) : (
              lapList.map(lap => {
                const isSelected = compareLaps.includes(lap.lap_number);
                const isBest     = bestLap?.lap_number === lap.lap_number;
                return (
                  <div
                    key={lap.lap_number}
                    className={`grid grid-cols-4 items-center px-2 py-1.5 border-b border-motorsport-border/40 transition-colors cursor-pointer ${
                      isSelected ? 'bg-motorsport-surface' : 'hover:bg-motorsport-surface/40'
                    }`}
                    onClick={() => toggleCompareLap(lap.lap_number)}
                  >
                    {/* Lap number */}
                    <div className="flex items-center gap-1.5">
                      {isBest && <Trophy className="w-3 h-3 text-motorsport-yellow shrink-0" />}
                      <span className="font-telemetry text-sm">{lap.lap_number}</span>
                    </div>

                    {/* Time */}
                    <span className="font-telemetry text-[12px] tabular-nums text-motorsport-text">
                      {lap.lap_time_ms > 0 ? formatTime(lap.lap_time_ms) : '--:--'}
                    </span>

                    {/* Valid */}
                    <div className="flex justify-center">
                      {lap.valid
                        ? <Check className="w-3.5 h-3.5 text-motorsport-green" />
                        : <X     className="w-3.5 h-3.5 text-motorsport-red" />
                      }
                    </div>

                    {/* Toggle */}
                    <div className="flex justify-center">
                      <div
                        className="w-4 h-4 border transition-all flex items-center justify-center"
                        style={{
                          backgroundColor: isSelected ? getLapColor(lap.lap_number) + '30' : 'transparent',
                          borderColor: isSelected ? getLapColor(lap.lap_number) : '#1A2840',
                        }}
                      >
                        {isSelected && (
                          <div className="w-2 h-2" style={{ backgroundColor: getLapColor(lap.lap_number) }} />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Comparison panel */}
        <div className="flex-1 telemetry-panel flex flex-col overflow-hidden">
          <div className="panel-header">
            <span className="eng-label font-bold">Analysis</span>
          </div>

          {comparedLaps.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="text-[40px] font-telemetry text-motorsport-dim mb-2">---</div>
                <p className="text-[13px] text-motorsport-muted uppercase tracking-widest">Select laps to compare</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-auto p-2.5">
              <div className="flex flex-col gap-3">

                {/* Lap time cards */}
                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${comparedLaps.length}, 1fr)` }}>
                  {comparedLaps.map(lap => {
                    const color = getLapColor(lap.lap_number);
                    const delta = bestLap && lap.lap_time_ms > 0 && bestLap.lap_time_ms > 0
                      ? lap.lap_time_ms - bestLap.lap_time_ms
                      : null;
                    const isBest = lap.lap_number === bestLap?.lap_number;
                    return (
                      <div
                        key={lap.lap_number}
                        className="telemetry-panel p-2.5"
                        style={{ borderColor: color + '50' }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <div className="w-[3px] h-5" style={{ backgroundColor: color }} />
                            <span className="eng-label">LAP {lap.lap_number}</span>
                          </div>
                          {isBest && <Trophy className="w-3.5 h-3.5 text-motorsport-yellow" />}
                        </div>
                        <div className="font-telemetry font-bold tabular-nums" style={{ fontSize: '1.5rem', color }}>
                          {lap.lap_time_ms > 0 ? formatTime(lap.lap_time_ms) : '--:--'}
                        </div>
                        {delta !== null && !isBest && (
                          <div
                            className="font-telemetry text-[12px] tabular-nums mt-1"
                            style={{ color: delta > 0 ? '#FF2044' : '#00E85A' }}
                          >
                            {formatDelta(delta)}
                          </div>
                        )}
                        {isBest && (
                          <div className="text-[11px] text-motorsport-yellow uppercase tracking-wider mt-1">Best</div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Sector times */}
                <div className="telemetry-panel">
                  <div className="panel-header">
                    <span className="eng-label font-bold">Sector Times</span>
                  </div>
                  <div className="p-2.5 grid grid-cols-3 gap-4">
                    {(['S1', 'S2', 'S3'] as const).map((sector, idx) => (
                      <div key={sector}>
                        <span className="eng-label block mb-2">{sector}</span>
                        <div className="flex flex-col gap-1.5">
                          {comparedLaps.map(lap => {
                            const ms = idx === 0 ? lap.sector1_ms : idx === 1 ? lap.sector2_ms : 0;
                            return (
                              <div key={lap.lap_number} className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 shrink-0" style={{ backgroundColor: getLapColor(lap.lap_number) }} />
                                <span className="font-telemetry text-[12px] tabular-nums text-motorsport-text">
                                  {ms > 0 ? formatTime(ms) : '--:--.---'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Delta to best bar chart */}
                <div className="telemetry-panel">
                  <div className="panel-header">
                    <span className="eng-label font-bold">Delta to Best</span>
                  </div>
                  <div className="p-2.5">
                    <div className="flex items-end gap-3 h-24">
                      {comparedLaps.map(lap => {
                        const delta  = bestLap && lap.lap_time_ms > 0 && bestLap.lap_time_ms > 0
                          ? lap.lap_time_ms - bestLap.lap_time_ms : 0;
                        const isBest = lap.lap_number === bestLap?.lap_number;
                        const height = isBest ? 100 : Math.min(Math.max((delta / 5000) * 100, 5), 100);
                        const color  = getLapColor(lap.lap_number);
                        return (
                          <div key={lap.lap_number} className="flex-1 flex flex-col items-center gap-1">
                            <span className="font-telemetry text-[10px] tabular-nums text-motorsport-muted">
                              {isBest ? 'BEST' : `+${(delta / 1000).toFixed(3)}s`}
                            </span>
                            <div
                              className="w-full transition-all"
                              style={{
                                height: `${height}%`,
                                backgroundColor: color,
                                opacity: isBest ? 1 : 0.65,
                              }}
                            />
                            <span className="text-[10px] text-motorsport-muted uppercase tracking-wider">L{lap.lap_number}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
