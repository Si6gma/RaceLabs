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

  // Poll session metadata every 5 s
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
    /*
     * Top-level layout:
     *   ┌──────────────────────────────────────────────────────────┐
     *   │ main-row  (flex-1, ~65% height)                         │
     *   │  ├── left-col  220 px  (DriverInputs + TyreAnalytics)   │
     *   │  ├── center    flex-1  (Track Map)                       │
     *   │  └── right-col 200 px  (TimingTower + ERSSuite)         │
     *   ├──────────────────────────────────────────────────────────┤
     *   │ timeline (300 px fixed, Recharts multi-channel trace)    │
     *   └──────────────────────────────────────────────────────────┘
     */
    <div className="h-full flex flex-col gap-1.5 p-1.5 overflow-hidden bg-motorsport-black">

      {/* ── Main row ── */}
      <div className="flex gap-1.5 flex-1 min-h-0">

        {/* Left column: Driver Inputs (top) + Tyre Analytics (bottom) */}
        <div className="flex flex-col gap-1.5 w-[220px] shrink-0">
          {/* Driver inputs takes ~55% of left col height */}
          <div className="flex-[55] min-h-0">
            <DriverInputsPanel />
          </div>
          {/* Tyre analytics takes remaining ~45% */}
          <div className="flex-[45] min-h-0">
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

        {/* Center: Track Map — fills all remaining width */}
        <div className="flex-1 min-w-0 telemetry-panel p-1.5">
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

        {/* Right column: Timing Tower (top) + ERS Suite (bottom) */}
        <div className="flex flex-col gap-1.5 w-[200px] shrink-0">
          <div className="flex-[60] min-h-0">
            <TimingTower />
          </div>
          <div className="flex-[40] min-h-0">
            <ERSSuite />
          </div>
        </div>
      </div>

      {/* ── Telemetry Trace Timeline ── */}
      <div className="h-[300px] shrink-0">
        <TelemetryTimeline />
      </div>
    </div>
  );
}

export default memo(LiveDashboard);
