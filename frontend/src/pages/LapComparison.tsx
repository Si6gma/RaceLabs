import { useMemo } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { GitCompare, Check, X, Trophy } from 'lucide-react';
import { formatTime, formatDelta } from '@/utils/formatters';

export default function LapComparison() {
  const { laps, compareLaps, toggleCompareLap } = useTelemetryStore();
  
  const lapList = useMemo(() => {
    return Object.values(laps).sort((a, b) => a.lap_number - b.lap_number);
  }, [laps]);
  
  const bestLap = useMemo(() => {
    const validLaps = lapList.filter(l => l.valid && l.lap_time_ms > 0);
    if (validLaps.length === 0) return null;
    return validLaps.reduce((best, current) => 
      current.lap_time_ms < best.lap_time_ms ? current : best
    );
  }, [lapList]);
  
  const comparedLaps = useMemo(() => {
    return lapList.filter(l => compareLaps.includes(l.lap_number));
  }, [lapList, compareLaps]);
  
  return (
    <div className="h-full flex flex-col p-3 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between telemetry-panel p-2 shrink-0">
        <div className="flex items-center gap-2">
          <GitCompare className="w-4 h-4 text-motorsport-orange" />
          <span className="text-sm font-semibold">LAP COMPARISON</span>
        </div>
        <div className="text-xs text-motorsport-muted">
          Select up to 4 laps to compare
        </div>
      </div>
      
      <div className="flex-1 flex gap-3 overflow-hidden">
        {/* Lap List */}
        <div className="w-80 telemetry-panel flex flex-col overflow-hidden">
          <div className="p-2 border-b border-motorsport-border">
            <span className="text-xs font-semibold text-motorsport-muted uppercase tracking-wider">Available Laps</span>
          </div>
          
          <div className="flex-1 overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-motorsport-panel">
                <tr className="text-[10px] text-motorsport-muted uppercase">
                  <th className="text-left p-2">Lap</th>
                  <th className="text-left p-2">Time</th>
                  <th className="text-left p-2">Valid</th>
                  <th className="text-center p-2">Compare</th>
                </tr>
              </thead>
              <tbody>
                {lapList.map(lap => (
                  <tr 
                    key={lap.lap_number}
                    className={`border-b border-motorsport-border/50 hover:bg-motorsport-surface/50 transition-colors ${
                      bestLap?.lap_number === lap.lap_number ? 'bg-motorsport-cyan/5' : ''
                    }`}
                  >
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <span className="font-telemetry text-sm">{lap.lap_number}</span>
                        {bestLap?.lap_number === lap.lap_number && (
                          <Trophy className="w-3 h-3 text-motorsport-cyan" />
                        )}
                      </div>
                    </td>
                    <td className="p-2 font-telemetry text-sm">
                      {lap.lap_time_ms > 0 ? formatTime(lap.lap_time_ms) : '--:--'}
                    </td>
                    <td className="p-2">
                      {lap.valid ? (
                        <Check className="w-3.5 h-3.5 text-motorsport-green" />
                      ) : (
                        <X className="w-3.5 h-3.5 text-motorsport-red" />
                      )}
                    </td>
                    <td className="p-2 text-center">
                      <button
                        onClick={() => toggleCompareLap(lap.lap_number)}
                        className={`w-5 h-5 rounded-sm border transition-all ${
                          compareLaps.includes(lap.lap_number)
                            ? 'bg-motorsport-orange border-motorsport-orange'
                            : 'border-motorsport-dim hover:border-motorsport-muted'
                        }`}
                      >
                        {compareLaps.includes(lap.lap_number) && (
                          <Check className="w-3.5 h-3.5 text-white mx-auto" />
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        
        {/* Comparison View */}
        <div className="flex-1 telemetry-panel flex flex-col overflow-hidden">
          <div className="p-2 border-b border-motorsport-border">
            <span className="text-xs font-semibold text-motorsport-muted uppercase tracking-wider">Comparison</span>
          </div>
          
          {comparedLaps.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <GitCompare className="w-12 h-12 text-motorsport-dim mx-auto mb-3" />
                <p className="text-sm text-motorsport-muted">Select laps from the list to compare</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-auto p-3">
              <div className="grid gap-3">
                {/* Summary Cards */}
                <div className="grid grid-cols-4 gap-2">
                  {comparedLaps.map(lap => (
                    <div 
                      key={lap.lap_number} 
                      className="telemetry-panel p-3"
                      style={{ borderColor: getLapColor(lap.lap_number) }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-motorsport-muted">Lap {lap.lap_number}</span>
                        {bestLap?.lap_number === lap.lap_number && (
                          <Trophy className="w-3 h-3 text-motorsport-cyan" />
                        )}
                      </div>
                      <div className="font-telemetry text-2xl font-bold" style={{ color: getLapColor(lap.lap_number) }}>
                        {lap.lap_time_ms > 0 ? formatTime(lap.lap_time_ms) : '--:--'}
                      </div>
                      {bestLap && lap.lap_time_ms > 0 && bestLap.lap_time_ms > 0 && lap.lap_number !== bestLap.lap_number && (
                        <div className="text-xs mt-1" style={{ 
                          color: lap.lap_time_ms > bestLap.lap_time_ms ? '#ff1744' : '#00e676'
                        }}>
                          {formatDelta(lap.lap_time_ms - bestLap.lap_time_ms)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                
                {/* Sector Comparison */}
                <div className="telemetry-panel p-3">
                  <h3 className="text-xs font-semibold text-motorsport-muted uppercase mb-3">Sector Times</h3>
                  <div className="grid grid-cols-3 gap-4">
                    {['S1', 'S2', 'S3'].map((sector, idx) => (
                      <div key={sector}>
                        <div className="text-xs text-motorsport-muted mb-2">{sector}</div>
                        <div className="space-y-1">
                          {comparedLaps.map(lap => {
                            const sectorTime = idx === 0 ? lap.sector1_ms : idx === 1 ? lap.sector2_ms : 0;
                            return (
                              <div key={lap.lap_number} className="flex items-center gap-2">
                                <div 
                                  className="w-2 h-2 rounded-full shrink-0" 
                                  style={{ backgroundColor: getLapColor(lap.lap_number) }}
                                />
                                <span className="font-telemetry text-sm">
                                  {sectorTime > 0 ? formatTime(sectorTime) : '--:--'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Delta Visualization Placeholder */}
                <div className="telemetry-panel p-3">
                  <h3 className="text-xs font-semibold text-motorsport-muted uppercase mb-3">Delta to Best</h3>
                  <div className="h-32 flex items-end gap-2 px-4">
                    {comparedLaps.map(lap => {
                      const delta = bestLap && lap.lap_time_ms > 0 && bestLap.lap_time_ms > 0
                        ? lap.lap_time_ms - bestLap.lap_time_ms
                        : 0;
                      const height = Math.min(Math.max(delta / 5000 * 100, 5), 100);
                      const isBest = lap.lap_number === bestLap?.lap_number;
                      
                      return (
                        <div key={lap.lap_number} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-[10px] font-telemetry text-motorsport-muted">
                            {isBest ? 'BEST' : `+${(delta/1000).toFixed(2)}`}
                          </span>
                          <div 
                            className="w-full rounded-t-sm transition-all"
                            style={{ 
                              height: `${isBest ? 100 : height}%`,
                              backgroundColor: isBest ? '#00e676' : '#ff1744',
                              opacity: isBest ? 1 : 0.7,
                            }}
                          />
                          <span className="text-[10px] text-motorsport-muted">L{lap.lap_number}</span>
                        </div>
                      );
                    })}
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

function getLapColor(lapNumber: number): string {
  const colors = ['#00e5ff', '#ff6b00', '#00e676', '#ff1744'];
  return colors[(lapNumber - 1) % colors.length];
}
