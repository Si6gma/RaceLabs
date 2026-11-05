import { NavLink } from 'react-router-dom';
import { useEffect, useState, useMemo, memo } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import LightsControl from '@/components/LightsControl';
import DriverTag from '@/components/DriverTag';
import { apiFetch } from '@/utils/api';
import { formatTime } from '@/utils/formatters';

const NAV = [
  { path: '/',         label: 'Live'     },
  { path: '/recorded', label: 'Recorded' },
  { path: '/setup',    label: 'Config'   },
];

// ── Status boxes: the same outlined-box language as DRS and ERS ──────────────

type GameStatus = 'offline' | 'no_game' | 'garage' | 'on_track';

const STATUS_STYLE: Record<GameStatus, { border: string; color: string; dashed: boolean; label: string }> = {
  on_track: { border: '#00E85A', color: '#00E85A', dashed: false, label: 'Live' },
  garage:   { border: '#FF7A1A', color: '#FF7A1A', dashed: false, label: 'Garage' },
  no_game:  { border: '#2A3745', color: '#9AACBE', dashed: true,  label: 'No signal' },
  offline:  { border: '#2A3745', color: '#5F7183', dashed: true,  label: 'Offline' },
};

function StatusBox({ border, color, dashed, children }: { border: string; color: string; dashed: boolean; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-3 h-8 px-3 border-2 transition-colors whitespace-nowrap"
      style={{ borderColor: border, borderStyle: dashed ? 'dashed' : 'solid', backgroundColor: dashed ? 'transparent' : `${border}1F`, color }}
    >
      {children}
    </div>
  );
}

function SessionStatusBox({ track, sessionType }: { track?: string; sessionType?: string }) {
  const connected     = useTelemetryStore(s => s.connected);
  const lastFrameTime = useTelemetryStore(s => s.lastFrameTime);
  const driverStatus  = useTelemetryStore(s => s.currentFrame?.lap?.driver_status);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const gameStatus = useMemo((): GameStatus => {
    if (!connected) return 'offline';
    if (!lastFrameTime || now - lastFrameTime > 3000) return 'no_game';
    if (driverStatus === undefined || driverStatus === 0) return 'garage';
    return 'on_track';
  }, [connected, lastFrameTime, now, driverStatus]);

  const s = STATUS_STYLE[gameStatus];
  return (
    <StatusBox border={s.border} color={s.color} dashed={s.dashed}>
      {track && <span className="text-[16px] font-bold tracking-wide text-motorsport-text leading-none">{track}</span>}
      {track && sessionType && (
        <span className="text-[12px] font-bold tracking-wide uppercase text-motorsport-muted leading-none">{sessionType}</span>
      )}
      <span className="text-[12px] font-bold tracking-wide uppercase leading-none">{s.label}</span>
    </StatusBox>
  );
}

// Race control: what the marshals are showing, in priority order.
const YELLOW = '#FFD000';
const RED    = '#FF2044';
const BLUE   = '#4D8BFF';
const GREEN  = '#00E85A';

function raceControl(safetyCar: number | undefined, fiaFlag: number | undefined): { label: string; color: string } | null {
  if (fiaFlag === 4)     return { label: 'Red flag',           color: RED };
  if (safetyCar === 1)   return { label: 'Safety car',         color: YELLOW };
  if (safetyCar === 2)   return { label: 'Virtual safety car', color: YELLOW };
  if (safetyCar === 3)   return { label: 'Formation lap',      color: '#9AACBE' };
  if (fiaFlag === 3)     return { label: 'Yellow flag',        color: YELLOW };
  if (fiaFlag === 2)     return { label: 'Blue flag',          color: BLUE };
  if (fiaFlag === 1)     return { label: 'Green flag',         color: GREEN };
  return null;
}

function RaceControlBox() {
  const safetyCar = useTelemetryStore(s => s.currentFrame?.session?.safety_car_status);
  const fiaFlag   = useTelemetryStore(s => s.currentFrame?.status?.fia_flags);
  const state = raceControl(safetyCar, fiaFlag);
  if (!state) {
    return (
      <StatusBox border="#2A3745" color="#5F7183" dashed>
        <span className="text-[12px] font-bold tracking-wide uppercase leading-none">Track clear</span>
      </StatusBox>
    );
  }
  return (
    <StatusBox border={state.color} color={state.color} dashed={false}>
      <span className="text-[14px] font-bold tracking-wide uppercase leading-none">{state.label}</span>
    </StatusBox>
  );
}

// Fastest lap of the session and who set it, in purple like every best.
function SessionBestBox() {
  const best = useTelemetryStore(s => s.sessionBest);
  const participants = useTelemetryStore(s => s.participants);
  const playerIndex = useTelemetryStore(s => s.currentFrame?.player_car_index);
  if (!best) return null;
  const who = participants.find(p => p.index === best.carIndex);
  const name = who?.name ?? (best.carIndex === playerIndex ? 'You' : `Car ${best.carIndex + 1}`);
  return (
    <StatusBox border="#B388FF" color="#B388FF" dashed={false}>
      <DriverTag name={name} teamId={who?.team_id} size="sm" />
      <span className="font-telemetry text-[15px] font-bold tabular-nums leading-none">{formatTime(best.ms)}</span>
    </StatusBox>
  );
}

const SessionStatusBoxMemo = memo(SessionStatusBox);
const RaceControlBoxMemo = memo(RaceControlBox);
const SessionBestBoxMemo = memo(SessionBestBox);

// ── Layout ───────────────────────────────────────────────────────────────────

export default function Layout({ children }: { children: React.ReactNode }) {
  const session    = useTelemetryStore(s => s.session);
  const replayMode = useTelemetryStore(s => s.replayMode);
  const recording  = useTelemetryStore(s => s.recording);
  const setRecording = useTelemetryStore(s => s.setRecording);

  useEffect(() => {
    fetch('/api/recording/status').then(r => r.json()).then(d => setRecording(d.recording)).catch(() => {});
  }, [setRecording]);

  const [recDenied, setRecDenied] = useState(false);

  async function toggleRecording() {
    const endpoint = recording ? '/api/recording/stop' : '/api/recording/start';
    try {
      const res  = await apiFetch(endpoint, { method: 'POST' });
      if (!res.ok) {
        setRecDenied(true);
        setTimeout(() => setRecDenied(false), 2500);
        return;
      }
      const data = await res.json();
      setRecording(data.recording);
    } catch {}
  }

  const recordedLaps = session?.recorded_laps ?? 0;

  return (
    <div className="h-screen flex flex-col bg-motorsport-black overflow-hidden">
      <header className="h-12 bg-motorsport-charcoal border-b border-motorsport-border flex items-center px-4 gap-6 shrink-0">
        {/* Wordmark: the mark plus the name, and a way home */}
        <NavLink to="/" className="flex items-center gap-2 shrink-0 group" title="Live">
          <img src="/logo.svg" alt="" className="w-6 h-6" />
          <span className="text-[19px] font-bold tracking-wide text-motorsport-text leading-none group-hover:text-motorsport-orange transition-colors">
            Race<span className="font-medium text-motorsport-muted group-hover:text-motorsport-orange transition-colors">Labs</span>
          </span>
        </NavLink>
        <nav className="flex items-stretch h-full shrink-0">
          {NAV.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `relative flex items-center px-3 text-[13px] font-bold tracking-wide uppercase transition-colors ${
                  isActive ? 'text-motorsport-text' : 'text-motorsport-muted hover:text-motorsport-text'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {item.label}
                  {isActive && <span className="absolute left-3 right-3 bottom-0 h-[2px] bg-motorsport-orange" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Where we are, and what race control is showing */}
        <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
          <SessionStatusBoxMemo track={session?.track} sessionType={session?.session_type} />
          <RaceControlBoxMemo />
          <SessionBestBoxMemo />
        </div>

        {/* Controls: one bordered group, every segment the same height */}
        <div className="flex items-center h-8 border border-motorsport-border shrink-0">
          {replayMode && (
            <span className="flex items-center px-3 h-full text-[12px] font-bold tracking-wide uppercase text-motorsport-purple border-r border-motorsport-border">
              Replay
            </span>
          )}
          <LightsControl />
          <button
            onClick={toggleRecording}
            title={recording ? 'Stop recording laps' : 'Record completed laps'}
            className={`flex items-center gap-2 px-3 h-full text-[12px] font-bold tracking-wide uppercase transition-colors ${
              recording ? 'bg-motorsport-red/15 text-motorsport-red hover:bg-motorsport-red/25' : 'text-motorsport-muted hover:text-motorsport-text'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${recording ? 'bg-motorsport-red animate-pulse' : 'bg-motorsport-dim'}`} />
            {recDenied ? <span className="text-motorsport-red">Key needed</span> : 'Rec'}
            {recordedLaps > 0 && (
              <span className="font-telemetry tabular-nums normal-case" title="Completed laps recorded this session">
                {recordedLaps} {recordedLaps === 1 ? 'lap' : 'laps'}
              </span>
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
