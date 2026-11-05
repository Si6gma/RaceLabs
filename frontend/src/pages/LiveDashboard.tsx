import { memo, useEffect } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { MiniTrackMapMemo } from '@/components/TrackMapCanvas';
import DriverInputsPanel from '@/components/DriverInputsPanel';
import TyreAnalytics from '@/components/TyreAnalytics';
import TimingTower from '@/components/TimingTower';
import ERSSuite from '@/components/ERSSuite';
import TelemetryTimeline from '@/components/TelemetryTimeline';
import ReplayBar from '@/components/ReplayBar';
import { useSettings } from '@/stores/settingsStore';

function LiveDashboard() {
  const currentFrame = useTelemetryStore(s => s.currentFrame);
  const setSession   = useTelemetryStore(s => s.setSession);
  const selectedCarIndex = useTelemetryStore(s => s.selectedCarIndex);
  const replayMode = useTelemetryStore(s => s.replayMode);
  const traceHeight = useSettings(s => s.traceHeight);

  const t = currentFrame?.telemetry;
  const m = currentFrame?.motion;
  const l = currentFrame?.lap;
  const s = currentFrame?.status;

  // Highlight the car being watched on the map (defaults to the player's own car)
  const viewedCarIndex = selectedCarIndex ?? currentFrame?.player_car_index;

  useEffect(() => {
    if (replayMode) return;
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
  }, [setSession, replayMode]);

  return (
    <div className="h-full flex flex-col gap-px p-px overflow-hidden bg-motorsport-border">

      {/* ── Main row ── */}
      <div className="flex gap-px flex-1 min-h-0">

        {/* Left: driver inputs hug their content; tyres take whatever is left */}
        <div className="grid gap-px w-[300px] shrink-0" style={{ gridTemplateRows: 'auto 1fr' }}>
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
          <MiniTrackMapMemo
            trackId={currentFrame?.session?.track_id}
            trackLength={currentFrame?.session?.track_length}
            playerCarIndex={viewedCarIndex}
            allLapDistances={currentFrame?.all_lap_distances}
            carTeamIds={currentFrame?.car_team_ids}
            posX={m?.world_pos_x}
            posZ={m?.world_pos_z}
            lapNumber={l?.current_lap_num}
            sessionType={currentFrame?.session?.session_type}
          />
        </div>

        {/* Right: Timing (the rest) + ERS (just its numbers) */}
        <div className="grid gap-px w-[300px] shrink-0" style={{ gridTemplateRows: '1fr auto' }}>
          <div className="min-h-0"><TimingTower /></div>
          <div><ERSSuite /></div>
        </div>
      </div>

      {/* ── Replay transport, only while a recording is playing ── */}
      {replayMode && <ReplayBar />}

      {/* ── Telemetry Trace ── */}
      <div className="shrink-0" style={{ height: traceHeight }}>
        <TelemetryTimeline />
      </div>
    </div>
  );
}

export default memo(LiveDashboard);
