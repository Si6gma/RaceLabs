import { memo, useMemo, useEffect } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { formatTime, formatGear, formatSpeed } from '@/utils/formatters';
import { getHeatColor } from '@/utils/colors';
import RPMBar from '@/components/RPMBar';
import TelemetryGauge from '@/components/TelemetryGauge';
import SteeringWheel from '@/components/SteeringWheel';
import TyreDisplay from '@/components/TyreDisplay';
import DRSIndicator from '@/components/DRSIndicator';
import ERSIndicator from '@/components/ERSIndicator';
import GForceCircle from '@/components/GForceCircle';
import { MiniTrackMapMemo } from '@/components/TrackMapCanvas';
import LiveTelemetryGraph from '@/components/LiveTelemetryGraph';

function LiveDashboard() {
  const currentFrame = useTelemetryStore(s => s.currentFrame);
  const session = useTelemetryStore(s => s.session);
  const setSession = useTelemetryStore(s => s.setSession);

  const t = currentFrame?.telemetry;
  const l = currentFrame?.lap;
  const s = currentFrame?.status;
  const m = currentFrame?.motion;

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/session');
        if (res.ok) {
          const data = await res.json();
          if (data && data.session_id) setSession(data);
        }
      } catch {}
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [setSession]);

  const speedKmh = useMemo(() => (t?.speed || 0), [t?.speed]);
  const gear = useMemo(() => (t?.gear || 0), [t?.gear]);
  const rpm = useMemo(() => (t?.engine_rpm || 0), [t?.engine_rpm]);
  const maxRpm = useMemo(() => 15000, []);
  const avgBrakeTemp = useMemo(() =>
    t?.brakes_temp ? t.brakes_temp.reduce((a, b) => a + b, 0) / 4 : 0,
    [t?.brakes_temp]
  );

  return (
    <div className="h-full flex flex-col gap-2 p-2 overflow-hidden">
      {/* ── Top Row: Speed | Gear+RPM+Inputs | Lap Info ── */}
      <div className="grid grid-cols-12 gap-2 shrink-0">
        {/* Speed */}
        <div className="col-span-2 telemetry-panel p-3 flex flex-col items-center justify-center">
          <span className="telemetry-label mb-0.5">SPEED</span>
          <div className="flex items-baseline gap-1">
            <span className="font-telemetry text-5xl font-bold text-motorsport-cyan text-glow-cyan">
              {formatSpeed(speedKmh)}
            </span>
            <span className="text-xs text-motorsport-muted">km/h</span>
          </div>
        </div>

        {/* Gear + RPM + Throttle + Brake */}
        <div className="col-span-6 telemetry-panel p-3 flex flex-col gap-2 justify-center">
          <div className="flex items-center gap-3">
            {/* Compact Gear */}
            <div className="flex flex-col items-center">
              <span className={`font-telemetry text-3xl font-bold leading-none ${
                gear >= 7 ? 'text-motorsport-red' :
                  gear >= 5 ? 'text-motorsport-orange' :
                    'text-motorsport-text'
              }`}>
                {formatGear(gear)}
              </span>
            </div>
            <div className="flex-1">
              <RPMBar rpm={rpm} maxRpm={maxRpm} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TelemetryGauge
              label="THROTTLE"
              value={(t?.throttle || 0) * 100}
              max={100}
              color="#00e676"
              unit="%"
              showBar
            />
            <TelemetryGauge
              label="BRAKE"
              value={(t?.brake || 0) * 100}
              max={100}
              color="#ff1744"
              unit="%"
              showBar
            />
          </div>
        </div>

        {/* Lap Info */}
        <div className="col-span-4 telemetry-panel p-3 flex flex-col justify-between">
          <div className="flex items-end justify-between">
            <div>
              <span className="telemetry-label">CURRENT</span>
              <div className="font-telemetry text-2xl font-bold text-motorsport-text">
                {formatTime(l?.current_lap_time_ms || 0)}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-motorsport-muted">LAP</span>
              <span className="font-telemetry text-lg font-bold text-motorsport-orange">
                {l?.current_lap_num || '--'}
                {session?.total_laps ? <span className="text-[10px] text-motorsport-muted font-normal">/{session.total_laps}</span> : null}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-1.5">
            <div>
              <span className="telemetry-label">S1</span>
              <div className="font-telemetry text-sm text-motorsport-muted">{formatTime(l?.sector1_time_ms || 0)}</div>
            </div>
            <div>
              <span className="telemetry-label">S2</span>
              <div className="font-telemetry text-sm text-motorsport-muted">{formatTime(l?.sector2_time_ms || 0)}</div>
            </div>
            <div>
              <span className="telemetry-label">S3</span>
              <div className="font-telemetry text-sm text-motorsport-muted">
                {l?.last_lap_time_ms && l?.sector1_time_ms != null && l?.sector2_time_ms != null
                  ? formatTime(Math.max(0, l.last_lap_time_ms - l.sector1_time_ms - l.sector2_time_ms))
                  : '--:--'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-1.5 pt-1.5 border-t border-motorsport-border/40">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-motorsport-muted">POS</span>
              <span className="font-telemetry text-base font-bold text-motorsport-orange">
                {l?.car_position || '--'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-motorsport-muted">BEST</span>
              <span className="font-telemetry text-sm text-motorsport-cyan">
                {session?.best_lap_time ? formatTime(session.best_lap_time) : '--:--'}
              </span>
            </div>
            {l?.current_lap_invalid && (
              <span className="ml-auto text-[10px] px-1.5 py-0.5 bg-motorsport-red/20 text-motorsport-red border border-motorsport-red/30 rounded-sm">
                INVALID
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Middle Row: 3 Columns ── */}
      <div className="grid grid-cols-12 gap-2 shrink-0">
        {/* Column A: Steering + G-Force */}
        <div className="col-span-3 telemetry-panel p-3 flex items-center justify-around gap-2">
          <SteeringWheel steer={t?.steer || 0} size={110} />
          <GForceCircle latG={m?.g_force_lat || 0} longG={m?.g_force_lon || 0} size={110} />
        </div>

        {/* Column B: Car Temps */}
        <div className="col-span-4 telemetry-panel p-3 flex flex-col gap-2 justify-center">
          <div className="grid grid-cols-2 gap-2">
            <TelemetryGauge
              label="ENGINE"
              value={t?.engine_temp || 0}
              max={150}
              unit="°C"
              color={getHeatColor(t?.engine_temp || 0, 105, 125, 'ascending')}
            />
            <TelemetryGauge
              label="BRAKE AVG"
              value={avgBrakeTemp}
              max={1200}
              unit="°C"
              color={getHeatColor(avgBrakeTemp, 500, 950, 'ascending')}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TelemetryGauge
              label="FUEL"
              value={s?.fuel_in_tank || 0}
              max={s?.fuel_capacity || 110}
              unit="kg"
              color={getHeatColor(s?.fuel_in_tank || 0, 80, 30, 'descending')}
              precision={1}
            />
            <TelemetryGauge
              label="LAPS LEFT"
              value={s?.fuel_remaining_laps || 0}
              max={100}
              color={getHeatColor(s?.fuel_remaining_laps || 0, 25, 8, 'descending')}
              precision={1}
            />
          </div>
        </div>

        {/* Column C: DRS/ERS + Tyres + Track Map */}
        <div className="col-span-5 grid grid-cols-5 gap-2">
          {/* DRS & ERS */}
          <div className="col-span-2 telemetry-panel p-3 flex flex-col gap-2 justify-center">
            <div className="flex flex-row gap-2 items-center justify-center">
              <DRSIndicator active={t?.drs === 1} allowed={s?.drs_allowed === 1} />
              <ERSIndicator deployMode={s?.ers_deploy_mode || 0} />
            </div>
            <div className="w-full">
              <div className="flex gap-0.5 h-3">
                {Array.from({ length: 10 }).map((_, i) => {
                  const percent = Math.min(100, Math.max(0, ((s?.ers_store_energy || 0) / 4000000) * 100));
                  const filled = i < Math.ceil(percent / 10);
                  return (
                    <div
                      key={i}
                      className={`flex-1 rounded-sm transition-colors duration-150 ${filled ? 'bg-yellow-400' : 'bg-motorsport-black'}`}
                    />
                  );
                })}
              </div>
              <div className="text-center mt-0.5">
                <span className="font-telemetry text-[10px] text-yellow-400 tabular-nums">
                  {Math.min(100, Math.max(0, ((s?.ers_store_energy || 0) / 4000000) * 100)).toFixed(0)}%
                </span>
              </div>
            </div>
          </div>

          {/* Tyres */}
          <div className="col-span-2 telemetry-panel p-3">
            <TyreDisplay
              temps={t?.tyres_surface_temp}
              wear={currentFrame?.damage?.tyres_wear}
              pressures={t?.tyres_pressure}
              compound={s?.tyre_compound}
            />
          </div>

          {/* Mini Track Map */}
          <div className="col-span-1 telemetry-panel p-2 flex items-center justify-center">
            <MiniTrackMapMemo
              trackId={currentFrame?.session?.track_id}
              trackLength={currentFrame?.session?.track_length}
              playerCarIndex={currentFrame?.player_car_index}
              allLapDistances={currentFrame?.all_lap_distances}
              posX={m?.world_pos_x}
              posZ={m?.world_pos_z}
              lapNumber={l?.current_lap_num}
              sessionType={currentFrame?.session?.session_type}
            />
          </div>
        </div>
      </div>

      {/* ── Bottom: Stacked Telemetry Graph ── */}
      <LiveTelemetryGraph />
    </div>
  );
}

export default memo(LiveDashboard);
