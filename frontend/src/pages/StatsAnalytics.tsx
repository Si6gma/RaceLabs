import { useState, useEffect, useRef } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { formatTime } from '@/utils/formatters';

interface Stats {
  speed:    { avg: number; max: number; min: number };
  rpm:      { avg: number; max: number };
  throttle: { avg: number };
  brake:    { avg: number };
  gear:     { avg: number; max: number };
  gForce:   { latMax: number; lonMax: number };
  totalDistance: number;
  frameCount: number;
}

interface TyreStats {
  temps:     number[];
  wear:      number[];
  pressures: number[];
  compound:  number;
  age:       number;
}

const COMPOUND_NAMES: Record<number, string> = {
  16: 'SOFT', 17: 'MED', 18: 'HARD', 19: 'INTER', 20: 'WET',
};

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="telemetry-panel flex flex-col">
      <div className="panel-header">
        <span className="eng-label font-bold">{label}</span>
      </div>
      <div className="flex-1 p-3 flex flex-col gap-2">
        {children}
      </div>
    </div>
  );
}

function StatRow({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="eng-label">{label}</span>
      <span className="font-telemetry text-[13px] tabular-nums" style={{ color: color || '#B8C8D6' }}>
        {value}{unit && <span className="text-motorsport-dim text-[10px] ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="h-[2px] bg-motorsport-dark mt-0.5">
      <div className="h-full transition-[width] duration-300" style={{ width: `${Math.min(100, (value / max) * 100)}%`, backgroundColor: color }} />
    </div>
  );
}

export default function StatsAnalytics() {
  const session = useTelemetryStore(s => s.session);
  const [stats, setStats]         = useState<Stats | null>(null);
  const [tyreStats, setTyreStats] = useState<TyreStats | null>(null);
  const lastLenRef = useRef(0);

  useEffect(() => {
    const compute = () => {
      const { frameHistory } = useTelemetryStore.getState();
      if (!frameHistory.length) { setStats(null); setTyreStats(null); lastLenRef.current = 0; return; }
      if (frameHistory.length === lastLenRef.current && stats !== null) return;
      lastLenRef.current = frameHistory.length;

      const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
      const max = (arr: number[]) => arr.length ? Math.max(...arr) : 0;
      const min = (arr: number[]) => arr.length ? Math.min(...arr) : 0;

      const speeds    = frameHistory.map(f => f.telemetry?.speed ?? 0).filter(v => v > 0);
      const rpms      = frameHistory.map(f => f.telemetry?.engine_rpm ?? 0).filter(v => v > 0);
      const throttles = frameHistory.map(f => f.telemetry?.throttle ?? 0);
      const brakes    = frameHistory.map(f => f.telemetry?.brake ?? 0);
      const gears     = frameHistory.map(f => f.telemetry?.gear ?? 0).filter(v => v > 0);
      const latGs     = frameHistory.map(f => f.motion?.g_force_lat ?? 0);
      const lonGs     = frameHistory.map(f => f.motion?.g_force_lon ?? 0);

      setStats({
        speed:    { avg: avg(speeds), max: max(speeds), min: min(speeds) },
        rpm:      { avg: avg(rpms), max: max(rpms) },
        throttle: { avg: avg(throttles) * 100 },
        brake:    { avg: avg(brakes) * 100 },
        gear:     { avg: avg(gears), max: max(gears) },
        gForce:   { latMax: max(latGs.map(Math.abs)), lonMax: max(lonGs.map(Math.abs)) },
        totalDistance: frameHistory[frameHistory.length - 1].lap?.total_distance ?? 0,
        frameCount: frameHistory.length,
      });

      const last = frameHistory[frameHistory.length - 1];
      setTyreStats({
        temps:     last.telemetry?.tyres_surface_temp ?? [0,0,0,0],
        wear:      last.status?.tyres_wear            ?? [0,0,0,0],
        pressures: last.telemetry?.tyres_pressure     ?? [0,0,0,0],
        compound:  last.status?.tyre_compound         ?? 0,
        age:       last.status?.tyres_age_laps        ?? 0,
      });
    };

    compute();
    const id = setInterval(compute, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="h-full flex flex-col gap-px p-px bg-motorsport-dim/20 overflow-auto">
      {/* ── Header ── */}
      <div className="telemetry-panel shrink-0">
        <div className="panel-header">
          <span className="eng-label font-bold">Session Analytics</span>
          {session && (
            <span className="text-[11px] text-motorsport-muted ml-auto uppercase tracking-wider">
              {session.track} · {session.session_type}
            </span>
          )}
        </div>
      </div>

      {!stats ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-[40px] font-telemetry text-motorsport-dim mb-2">---</div>
            <p className="text-[13px] text-motorsport-muted uppercase tracking-widest">Collecting telemetry…</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-px">

          {/* Speed */}
          <StatCard label="Speed">
            <div>
              <span className="eng-label block">MAX</span>
              <span className="font-telemetry font-bold tabular-nums" style={{ fontSize: '1.8rem', color: '#00D4FF' }}>
                {stats.speed.max.toFixed(0)}
              </span>
              <span className="eng-label ml-1">KM/H</span>
            </div>
            <StatRow label="AVG" value={stats.speed.avg.toFixed(0)} unit="km/h" />
            <MiniBar value={stats.speed.avg} max={350} color="#00D4FF" />
          </StatCard>

          {/* Engine */}
          <StatCard label="Engine">
            <div>
              <span className="eng-label block">PEAK RPM</span>
              <span className="font-telemetry font-bold tabular-nums" style={{ fontSize: '1.6rem', color: '#8855FF' }}>
                {stats.rpm.max.toLocaleString()}
              </span>
            </div>
            <StatRow label="AVG RPM" value={stats.rpm.avg.toFixed(0)} color="#8855FF" />
            <MiniBar value={stats.rpm.avg} max={15000} color="#8855FF" />
          </StatCard>

          {/* Inputs */}
          <StatCard label="Inputs">
            <StatRow label="AVG THROTTLE" value={stats.throttle.avg.toFixed(1)} unit="%" color="#00E85A" />
            <MiniBar value={stats.throttle.avg} max={100} color="#00E85A" />
            <StatRow label="AVG BRAKE" value={stats.brake.avg.toFixed(1)} unit="%" color="#FF2044" />
            <MiniBar value={stats.brake.avg} max={100} color="#FF2044" />
            <StatRow label="AVG GEAR" value={stats.gear.avg.toFixed(1)} />
          </StatCard>

          {/* G-Force */}
          <StatCard label="G-Force">
            <div>
              <span className="eng-label block">PEAK LATERAL</span>
              <span className="font-telemetry font-bold tabular-nums" style={{ fontSize: '1.8rem', color: '#FFD000' }}>
                {stats.gForce.latMax.toFixed(2)}
              </span>
              <span className="eng-label ml-1">G</span>
            </div>
            <StatRow label="PEAK LONGITUDINAL" value={stats.gForce.lonMax.toFixed(2)} unit="G" color="#FFD000" />
          </StatCard>

          {/* Tyres */}
          {tyreStats && (
            <div className="col-span-2 telemetry-panel">
              <div className="panel-header justify-between">
                <span className="eng-label font-bold">Tyre Condition</span>
                <div className="flex items-center gap-3 text-[12px] text-motorsport-muted uppercase tracking-wider">
                  <span>Compound: <span className="text-motorsport-text font-semibold ml-1">{COMPOUND_NAMES[tyreStats.compound] ?? tyreStats.compound}</span></span>
                  <span>Age: <span className="font-telemetry text-motorsport-text ml-1">{tyreStats.age}L</span></span>
                </div>
              </div>
              <div className="p-3 grid grid-cols-4 gap-2">
                {['FL', 'FR', 'RL', 'RR'].map((pos, i) => {
                  const wearColor = tyreStats.wear[i] > 50 ? '#FF2044' : tyreStats.wear[i] > 30 ? '#FFD000' : '#00E85A';
                  return (
                    <div key={pos} className="bg-motorsport-dark border border-motorsport-border p-2.5 flex flex-col gap-1.5">
                      <span className="text-[12px] font-bold text-motorsport-muted uppercase tracking-widest">{pos}</span>
                      <StatRow label="TEMP" value={`${tyreStats.temps[i]}°`} />
                      <div className="flex items-baseline justify-between">
                        <span className="eng-label">WEAR</span>
                        <span className="font-telemetry text-[13px] tabular-nums" style={{ color: wearColor }}>{tyreStats.wear[i].toFixed(0)}%</span>
                      </div>
                      <div className="h-[2px] bg-motorsport-border">
                        <div className="h-full" style={{ width: `${100 - tyreStats.wear[i]}%`, backgroundColor: wearColor }} />
                      </div>
                      <StatRow label="PSI" value={tyreStats.pressures[i].toFixed(1)} color="#4A6078" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Session summary */}
          <div className="col-span-2 telemetry-panel">
            <div className="panel-header">
              <span className="eng-label font-bold">Session Summary</span>
            </div>
            <div className="p-3 grid grid-cols-2 gap-2">
              {[
                { label: 'TOTAL FRAMES', value: stats.frameCount.toLocaleString(), color: '#B8C8D6' },
                { label: 'DISTANCE', value: `${(stats.totalDistance / 1000).toFixed(2)} km`, color: '#B8C8D6' },
                { label: 'BEST LAP', value: session?.best_lap_time ? formatTime(session.best_lap_time) : '--:--.---', color: '#00D4FF' },
                { label: 'CURRENT LAP', value: `${session?.current_lap || '--'}`, color: '#B8C8D6' },
              ].map(item => (
                <div key={item.label} className="bg-motorsport-dark border border-motorsport-border p-2.5">
                  <span className="eng-label block mb-1">{item.label}</span>
                  <span className="font-telemetry text-xl font-semibold tabular-nums" style={{ color: item.color }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
