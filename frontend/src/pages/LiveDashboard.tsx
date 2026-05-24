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
  
  return (
    <div className="h-full flex flex-col gap-3 p-3 overflow-hidden">
      {/* Sector Times */}
      <div className="grid grid-cols-3 gap-3 shrink-0">
        {['S1', 'S2', 'S3'].map((sector, i) => (
          <div key={sector} className="telemetry-panel p-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-motorsport-muted">{sector}</span>
              <span className="font-telemetry text-xl">
                {formatTime([l?.sector1_time_ms, l?.sector2_time_ms, 0][i] || 0)}
              </span>
            </div>

          </div>
        ))}
      </div>

      {/* Top Row - Speed, Gear, RPM, Lap Info */}
      <div className="grid grid-cols-12 gap-3 shrink-0">
        {/* Speed Display */}
        <div className="col-span-2 telemetry-panel p-4 flex flex-col items-center justify-center">
          <span className="telemetry-label mb-1">SPEED</span>
          <div className="flex items-baseline gap-1">
            <span className="font-telemetry text-6xl font-bold text-motorsport-cyan text-glow-cyan">
              {formatSpeed(speedKmh)}
            </span>
            <span className="text-sm text-motorsport-muted">km/h</span>
          </div>
        </div>
        
        {/* Gear Display */}
        <div className="col-span-2 telemetry-panel p-4 flex flex-col items-center justify-center">
          <span className="telemetry-label mb-1">GEAR</span>
          <span className={`font-telemetry text-7xl font-bold ${
            gear >= 7 ? 'text-motorsport-red' : 
            gear >= 5 ? 'text-motorsport-orange' : 
            'text-motorsport-text'
          }`}>
            {formatGear(gear)}
          </span>
        </div>
        
        {/* RPM & Throttle/Brake */}
        <div className="col-span-5 telemetry-panel p-4 flex flex-col gap-3 justify-center">
          <RPMBar rpm={rpm} maxRpm={maxRpm} />
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
        
        {/* Lap Timer */}
        <div className="col-span-3 telemetry-panel p-4 flex flex-col justify-between">
          <div>
            <span className="telemetry-label">CURRENT LAP</span>
            <div className="font-telemetry text-3xl font-bold text-motorsport-text">
              {formatTime(l?.current_lap_time_ms || 0)}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-2">
            <div>
              <span className="telemetry-label">LAST</span>
              <div className="font-telemetry text-lg text-motorsport-muted">
                {formatTime(l?.last_lap_time_ms || 0)}
              </div>
            </div>
            <div>
              <span className="telemetry-label">BEST</span>
              <div className="font-telemetry text-lg text-motorsport-cyan">
                {session?.best_lap_time ? formatTime(session.best_lap_time) : '--:--'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center gap-1">
              <span className="text-xs text-motorsport-muted">POS</span>
              <span className="font-telemetry text-xl font-bold text-motorsport-orange">
                {l?.car_position || '--'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-motorsport-muted">SEC</span>
              <span className="font-telemetry text-lg text-motorsport-text">
                {l?.sector || '--'}
              </span>
            </div>
            {l?.current_lap_invalid && (
              <span className="text-xs px-1.5 py-0.5 bg-motorsport-red/20 text-motorsport-red border border-motorsport-red/30 rounded-sm">
                INVALID
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <span className="text-xs text-motorsport-muted">LAP</span>
              <span className="font-telemetry text-lg font-bold text-motorsport-orange">
                {l?.current_lap_num || '--'}
                {session?.total_laps ? <span className="text-xs text-motorsport-muted font-normal">/{session.total_laps}</span> : null}
              </span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Middle Row */}
      <div className="grid grid-cols-12 gap-3 shrink-0">
        {/* Steering */}
        <div className="col-span-2 telemetry-panel p-4 flex items-center justify-center">
          <SteeringWheel steer={t?.steer || 0} size={140} />
        </div>
        
        {/* G-Force & Telemetry */}
        <div className="col-span-4 telemetry-panel p-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-4">
            <TelemetryGauge 
              label="LAT G" 
              value={Math.abs(m?.g_force_lat || 0)} 
              max={3.5} 
              color={getHeatColor(Math.abs(m?.g_force_lat || 0), 1.5, 2.8, 'ascending')}
              precision={2}
            />
            <TelemetryGauge 
              label="LON G" 
              value={Math.abs(m?.g_force_lon || 0)} 
              max={3.5} 
              color={getHeatColor(Math.abs(m?.g_force_lon || 0), 1.5, 2.8, 'ascending')}
              precision={2}
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
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
          
          <div className="grid grid-cols-2 gap-4">
            <TelemetryGauge 
              label="ENGINE TEMP" 
              value={t?.engine_temp || 0} 
              max={150} 
              unit="°C"
              color={getHeatColor(t?.engine_temp || 0, 105, 125, 'ascending')}
            />
            <TelemetryGauge 
              label="BRAKE TEMP AVG" 
              value={t?.brakes_temp ? t.brakes_temp.reduce((a,b) => a+b, 0) / 4 : 0} 
              max={1200} 
              unit="°C"
              color={getHeatColor(
                t?.brakes_temp ? t.brakes_temp.reduce((a,b) => a+b, 0) / 4 : 0,
                500, 950, 'ascending'
              )}
            />
          </div>
        </div>
        
        {/* DRS & ERS */}
        <div className="col-span-2 telemetry-panel p-4 flex flex-row gap-3 items-center justify-center">
          <DRSIndicator active={t?.drs === 1} allowed={s?.drs_allowed === 1} />
          <ERSIndicator 
            storeEnergy={s?.ers_store_energy || 0}
            deployMode={s?.ers_deploy_mode || 0}
          />
        </div>
        
        {/* Tyres */}
        <div className="col-span-2 telemetry-panel p-4">
          <TyreDisplay
            temps={t?.tyres_surface_temp}
            wear={currentFrame?.damage?.tyres_wear}
            pressures={t?.tyres_pressure}
            compound={s?.tyre_compound}
          />
        </div>
        
        {/* Mini Track Map */}
        <div className="col-span-2 telemetry-panel p-4">
          <MiniTrackMapMemo
            posX={m?.world_pos_x}
            posZ={m?.world_pos_z}
            lapNumber={l?.current_lap_num}
            trackId={currentFrame?.session?.track_id}
            sessionType={currentFrame?.session?.session_type}
          />
        </div>
      </div>
      
      {/* Live telemetry graph — fills remaining space */}
      <LiveTelemetryGraph />
    </div>
  );
}

export default memo(LiveDashboard);
