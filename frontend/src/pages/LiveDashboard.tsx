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
import { SectorBoundaryLearner, DrsZoneLearner, type DrsZone } from '@/utils/sectorLines';
import { useRef } from 'react';

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

  // Sector lines: seeded from what the backend has stored for the track, then
  // refined live as cars cross them.
  const sectorLearner = useRef(new SectorBoundaryLearner());
  const drsLearner = useRef(new DrsZoneLearner());
  const stored = useRef<Record<string, { sectors?: [number | null, number | null]; drs_zones?: DrsZone[] }>>({});
  const session = useTelemetryStore(s => s.session);
  const trackId = currentFrame?.session?.track_id;

  const seedFromStore = (id: number | undefined) => {
    if (id == null) return;
    const known = stored.current[String(id)];
    if (!known) return;
    if (known.sectors) sectorLearner.current.seed(id, known.sectors[0], known.sectors[1]);
    if (known.drs_zones) drsLearner.current.seed(id, known.drs_zones);
  };

  useEffect(() => {
    fetch('/api/tracks/sectors').then(r => r.json()).then(d => {
      stored.current = d.sectors ?? {};
      seedFromStore(trackId);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (trackId == null) return;
    seedFromStore(trackId);
    if (session?.track_id === trackId) {
      if (session.sector_bounds) sectorLearner.current.seed(trackId, session.sector_bounds[0], session.sector_bounds[1]);
      if (session.drs_zones) drsLearner.current.seed(trackId, session.drs_zones);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, session]);

  sectorLearner.current.update(currentFrame?.lap_all, trackId);
  const sectorDistances = sectorLearner.current.distances();
  drsLearner.current.update(currentFrame?.lap_all, currentFrame?.status_all, currentFrame?.telemetry_all, trackId);
  const drsZones = drsLearner.current.zones();

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
            sectorDistances={sectorDistances}
            drsZones={drsZones}
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
