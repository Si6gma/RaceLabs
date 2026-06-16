import { memo, useEffect } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { MiniTrackMapMemo } from '@/components/TrackMapCanvas';
import DriverInputsPanel from '@/components/DriverInputsPanel';
import TyreAnalytics from '@/components/TyreAnalytics';
import TimingTower from '@/components/TimingTower';
import ERSSuite from '@/components/ERSSuite';
import TelemetryTimeline from '@/components/TelemetryTimeline';

function LiveDashboard() {
  const currentFrame = useTelemetryStore(s => s.currentFrame);
  const setSession   = useTelemetryStore(s => s.setSession);

  const t = currentFrame?.telemetry;
  const m = currentFrame?.motion;
  const l = currentFrame?.lap;
  const s = currentFrame?.status;

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/session');
        if (res.ok) {
          const data = await res.json();
          if (data?.session_id) setSession(data);
        }
      } catch { /* swallow */ }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [setSession]);

  return (
    <div className="h-full flex flex-col gap-px p-px overflow-hidden bg-motorsport-dim/20">

      {/* ── Main row ── */}
      <div className="flex gap-px flex-1 min-h-0">

        {/* Left: Driver Inputs (60%) + Tyres (40%) */}
        <div className="grid gap-px w-[216px] shrink-0" style={{ gridTemplateRows: '3fr 2fr' }}>
          <div className="min-h-0"><DriverInputsPanel /></div>
          <div className="min-h-0">
            <TyreAnalytics
              surfaceTemps={t?.tyres_surface_temp}
              innerTemps={t?.tyres_inner_temp}
              pressures={t?.tyres_pressure}
              wear={currentFrame?.damage?.tyres_wear}
              compound={s?.tyre_compound}
              tyreAgeLaps={s?.tyres_age_laps}
            />
          </div>
        </div>

        {/* Center: Track Map */}
        <div className="flex-1 min-w-0 telemetry-panel overflow-hidden">
          <div className="panel-header">
            <span className="eng-label font-bold">Track Map</span>
            {currentFrame?.session?.track_id !== undefined && (
              <span className="font-telemetry text-[10px] text-motorsport-dim ml-auto">
                ID·{currentFrame.session.track_id}
                {currentFrame.session.track_length
                  ? ` · ${(currentFrame.session.track_length / 1000).toFixed(3)}km`
                  : ''}
              </span>
            )}
          </div>
          <div className="h-[calc(100%-33px)]">
            <MiniTrackMapMemo
              trackId={currentFrame?.session?.track_id}
              trackLength={currentFrame?.session?.track_length}
              playerCarIndex={currentFrame?.player_car_index}
              allLapDistances={currentFrame?.all_lap_distances}
              carTeamIds={currentFrame?.car_team_ids}
              posX={m?.world_pos_x}
              posZ={m?.world_pos_z}
              lapNumber={l?.current_lap_num}
              sessionType={currentFrame?.session?.session_type}
            />
          </div>
        </div>

        {/* Right: Timing (60%) + ERS (40%) */}
        <div className="grid gap-px w-[196px] shrink-0" style={{ gridTemplateRows: '3fr 2fr' }}>
          <div className="min-h-0"><TimingTower /></div>
          <div className="min-h-0"><ERSSuite /></div>
        </div>
      </div>

      {/* ── Telemetry Trace ── */}
      <div className="h-[300px] shrink-0">
        <TelemetryTimeline />
      </div>
    </div>
  );
}

export default memo(LiveDashboard);
