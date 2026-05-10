import { useMemo } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { BarChart3, TrendingUp, AlertTriangle, Gauge } from 'lucide-react';

export default function StatsAnalytics() {
  const { frameHistory, session } = useTelemetryStore();
  
  const stats = useMemo(() => {
    if (frameHistory.length === 0) return null;
    
    const speeds = frameHistory.map(f => f.telemetry?.speed || 0).filter(s => s > 0);
    const rpms = frameHistory.map(f => f.telemetry?.engine_rpm || 0).filter(r => r > 0);
    const throttles = frameHistory.map(f => f.telemetry?.throttle || 0);
    const brakes = frameHistory.map(f => f.telemetry?.brake || 0);
    const gears = frameHistory.map(f => f.telemetry?.gear || 0).filter(g => g > 0);
    const latGs = frameHistory.map(f => f.motion?.g_force_lat || 0);
    const lonGs = frameHistory.map(f => f.motion?.g_force_lon || 0);
    
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
    const max = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : 0;
    const min = (arr: number[]) => arr.length > 0 ? Math.min(...arr) : 0;
    
    return {
      speed: { avg: avg(speeds), max: max(speeds), min: min(speeds) },
      rpm: { avg: avg(rpms), max: max(rpms) },
      throttle: { avg: avg(throttles) * 100 },
      brake: { avg: avg(brakes) * 100 },
      gear: { avg: avg(gears), max: max(gears) },
      gForce: { latMax: max(latGs.map(Math.abs)), lonMax: max(lonGs.map(Math.abs)) },
      totalDistance: frameHistory.length > 0 
        ? (frameHistory[frameHistory.length - 1].lap?.total_distance || 0) 
        : 0,
      frameCount: frameHistory.length,
    };
  }, [frameHistory]);
  
  const tyreStats = useMemo(() => {
    if (frameHistory.length === 0) return null;
    const last = frameHistory[frameHistory.length - 1];
    return {
      temps: last.telemetry?.tyres_surface_temp || [0, 0, 0, 0],
      wear: last.status?.tyres_wear || [0, 0, 0, 0],
      pressures: last.telemetry?.tyres_pressure || [0, 0, 0, 0],
      compound: last.status?.tyre_compound || 0,
      age: last.status?.tyres_age_laps || 0,
    };
  }, [frameHistory]);
  
  return (
    <div className="h-full flex flex-col p-3 gap-3 overflow-auto">
      {/* Header */}
      <div className="flex items-center gap-2 telemetry-panel p-2 shrink-0">
        <BarChart3 className="w-4 h-4 text-motorsport-orange" />
        <span className="text-sm font-semibold">ANALYTICS</span>
      </div>
      
      {!stats ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Gauge className="w-12 h-12 text-motorsport-dim mx-auto mb-3" />
            <p className="text-sm text-motorsport-muted">Collecting telemetry data...</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-3">
          {/* Speed Stats */}
          <div className="telemetry-panel p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-motorsport-cyan" />
              <span className="text-xs font-semibold uppercase tracking-wider text-motorsport-muted">Speed</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-xs text-motorsport-muted">Max</span>
                <span className="font-telemetry text-lg text-motorsport-cyan">{stats.speed.max.toFixed(0)} km/h</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-motorsport-muted">Avg</span>
                <span className="font-telemetry text-sm">{stats.speed.avg.toFixed(0)} km/h</span>
              </div>
              <div className="gauge-bar">
                <div 
                  className="gauge-fill rounded-sm bg-motorsport-cyan"
                  style={{ width: `${(stats.speed.avg / 350) * 100}%` }}
                />
              </div>
            </div>
          </div>
          
          {/* RPM Stats */}
          <div className="telemetry-panel p-4">
            <div className="flex items-center gap-2 mb-3">
              <Gauge className="w-4 h-4 text-motorsport-purple" />
              <span className="text-xs font-semibold uppercase tracking-wider text-motorsport-muted">Engine</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-xs text-motorsport-muted">Max RPM</span>
                <span className="font-telemetry text-lg text-motorsport-purple">{stats.rpm.max.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-motorsport-muted">Avg RPM</span>
                <span className="font-telemetry text-sm">{stats.rpm.avg.toFixed(0)}</span>
              </div>
              <div className="gauge-bar">
                <div 
                  className="gauge-fill rounded-sm bg-motorsport-purple"
                  style={{ width: `${(stats.rpm.avg / 15000) * 100}%` }}
                />
              </div>
            </div>
          </div>
          
          {/* Inputs */}
          <div className="telemetry-panel p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-motorsport-orange" />
              <span className="text-xs font-semibold uppercase tracking-wider text-motorsport-muted">Inputs</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-xs text-motorsport-muted">Throttle %</span>
                <span className="font-telemetry text-sm text-motorsport-green">{stats.throttle.avg.toFixed(1)}%</span>
              </div>
              <div className="gauge-bar">
                <div 
                  className="gauge-fill rounded-sm bg-motorsport-green"
                  style={{ width: `${stats.throttle.avg}%` }}
                />
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-motorsport-muted">Brake %</span>
                <span className="font-telemetry text-sm text-motorsport-red">{stats.brake.avg.toFixed(1)}%</span>
              </div>
              <div className="gauge-bar">
                <div 
                  className="gauge-fill rounded-sm bg-motorsport-red"
                  style={{ width: `${stats.brake.avg}%` }}
                />
              </div>
            </div>
          </div>
          
          {/* G-Force */}
          <div className="telemetry-panel p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-motorsport-yellow" />
              <span className="text-xs font-semibold uppercase tracking-wider text-motorsport-muted">G-Force</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-xs text-motorsport-muted">Lat Max</span>
                <span className="font-telemetry text-lg text-motorsport-yellow">{stats.gForce.latMax.toFixed(2)}G</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-motorsport-muted">Lon Max</span>
                <span className="font-telemetry text-sm">{stats.gForce.lonMax.toFixed(2)}G</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-motorsport-muted">Avg Gear</span>
                <span className="font-telemetry text-sm">{stats.gear.avg.toFixed(1)}</span>
              </div>
            </div>
          </div>
          
          {/* Tyre Degradation */}
          {tyreStats && (
            <div className="col-span-2 telemetry-panel p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-motorsport-muted mb-3">Tyre Condition</h3>
              <div className="grid grid-cols-4 gap-3">
                {['FL', 'FR', 'RL', 'RR'].map((pos, i) => (
                  <div key={pos} className="bg-motorsport-charcoal rounded-sm p-3">
                    <div className="text-xs font-bold text-motorsport-muted mb-2">{pos}</div>
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-[10px] text-motorsport-dim">Temp</span>
                        <span className="font-telemetry text-xs">{tyreStats.temps[i]}°C</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[10px] text-motorsport-dim">Wear</span>
                        <span className="font-telemetry text-xs" style={{ 
                          color: tyreStats.wear[i] > 50 ? '#ff1744' : tyreStats.wear[i] > 30 ? '#ff9100' : '#00e676'
                        }}>
                          {tyreStats.wear[i]}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[10px] text-motorsport-dim">PSI</span>
                        <span className="font-telemetry text-xs">{tyreStats.pressures[i].toFixed(1)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs text-motorsport-muted">
                <span>Compound: <span className="text-motorsport-text">{tyreStats.compound}</span></span>
                <span>Age: <span className="text-motorsport-text">{tyreStats.age} laps</span></span>
              </div>
            </div>
          )}
          
          {/* Session Stats */}
          <div className="col-span-2 telemetry-panel p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-motorsport-muted mb-3">Session Summary</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-motorsport-charcoal rounded-sm p-3">
                <div className="text-[10px] text-motorsport-dim uppercase">Total Frames</div>
                <div className="font-telemetry text-xl text-motorsport-text">{stats.frameCount.toLocaleString()}</div>
              </div>
              <div className="bg-motorsport-charcoal rounded-sm p-3">
                <div className="text-[10px] text-motorsport-dim uppercase">Distance</div>
                <div className="font-telemetry text-xl text-motorsport-text">{(stats.totalDistance / 1000).toFixed(2)} km</div>
              </div>
              <div className="bg-motorsport-charcoal rounded-sm p-3">
                <div className="text-[10px] text-motorsport-dim uppercase">Best Lap</div>
                <div className="font-telemetry text-xl text-motorsport-cyan">
                  {session?.best_lap_time ? formatTime(session.best_lap_time) : '--:--'}
                </div>
              </div>
              <div className="bg-motorsport-charcoal rounded-sm p-3">
                <div className="text-[10px] text-motorsport-dim uppercase">Current Lap</div>
                <div className="font-telemetry text-xl text-motorsport-text">{session?.current_lap || '--'}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(ms: number): string {
  if (!ms || ms <= 0) return '--:--.---';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}
