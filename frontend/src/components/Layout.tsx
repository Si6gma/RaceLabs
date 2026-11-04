import { NavLink } from 'react-router-dom';
import { useEffect, useState, useMemo, memo } from 'react';
import { Activity, History, Settings, Radio } from 'lucide-react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import LightsControl from '@/components/LightsControl';

const navItems = [
  { path: '/',         label: 'Live',     icon: Activity },
  { path: '/recorded', label: 'Recorded', icon: History  },
  { path: '/setup',    label: 'Config',   icon: Settings },
];

type GameStatus = 'offline' | 'no_game' | 'garage' | 'on_track';

// The circuit box doubles as the status light, like the DRS and ERS boxes:
// solid green on track, orange in the garage, dashed grey with no signal.
const STATUS_STYLE: Record<GameStatus, { border: string; color: string; dashed: boolean; label: string }> = {
  on_track: { border: '#00E85A', color: '#00E85A', dashed: false, label: 'Live' },
  garage:   { border: '#FF7A1A', color: '#FF7A1A', dashed: false, label: 'Garage' },
  no_game:  { border: '#2A3745', color: '#9AACBE', dashed: true,  label: 'No signal' },
  offline:  { border: '#2A3745', color: '#5F7183', dashed: true,  label: 'Offline' },
};

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
    <div
      className="flex items-center gap-3 h-7 px-3 border-2 transition-colors"
      style={{ borderColor: s.border, borderStyle: s.dashed ? 'dashed' : 'solid', backgroundColor: s.dashed ? 'transparent' : `${s.border}1F` }}
    >
      {track ? (
        <>
          <span className="text-[16px] font-bold tracking-wide text-motorsport-text leading-none">{track}</span>
          {sessionType && (
            <span className="text-[12px] font-bold tracking-wide uppercase text-motorsport-muted leading-none">{sessionType}</span>
          )}
        </>
      ) : null}
      <span className="text-[12px] font-bold tracking-wide uppercase leading-none" style={{ color: s.color }}>
        {s.label}
      </span>
    </div>
  );
}

const SessionStatusBoxMemo = memo(SessionStatusBox);

export default function Layout({ children }: { children: React.ReactNode }) {
  const session    = useTelemetryStore(s => s.session);
  const replayMode = useTelemetryStore(s => s.replayMode);
  const recording  = useTelemetryStore(s => s.recording);
  const setRecording = useTelemetryStore(s => s.setRecording);

  useEffect(() => {
    fetch('/api/recording/status').then(r => r.json()).then(d => setRecording(d.recording)).catch(() => {});
  }, [setRecording]);

  async function toggleRecording() {
    const endpoint = recording ? '/api/recording/stop' : '/api/recording/start';
    try {
      const res  = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      setRecording(data.recording);
    } catch {}
  }


  return (
    <div className="h-screen flex flex-col bg-motorsport-black overflow-hidden">
      {/* ── Header ── */}
      <header className="h-10 bg-motorsport-charcoal border-b border-motorsport-border flex items-center shrink-0">
        {/* Brand */}
        <div className="flex items-center gap-2 px-4 h-full border-r border-motorsport-border shrink-0">
          <Radio className="w-3.5 h-3.5 text-motorsport-orange" />
          <span className="text-[16px] font-bold tracking-[0.2em] text-motorsport-text uppercase">TEL</span>
          <span className="text-[12px] font-medium tracking-[0.1em] text-motorsport-muted uppercase">SUITE</span>
        </div>

        {/* Where we are and whether the car is on track, in one box */}
        <div className="flex items-center h-full px-4 border-r border-motorsport-border">
          <SessionStatusBoxMemo track={session?.track} sessionType={session?.session_type} />
        </div>

        {/* Right controls */}
        <div className="ml-auto flex items-center gap-3 px-4 h-full border-l border-motorsport-border">
          {replayMode && (
            <span className="eng-chip bg-motorsport-purple/15 text-motorsport-purple border-motorsport-purple/30">
              REPLAY
            </span>
          )}

          <LightsControl />

          <button
            onClick={toggleRecording}
            className={`flex items-center gap-1.5 px-2.5 py-1 border text-[12px] font-bold tracking-wide uppercase transition-colors ${
              recording
                ? 'bg-motorsport-red/15 text-motorsport-red border-motorsport-red/40 hover:bg-motorsport-red/25'
                : 'bg-transparent text-motorsport-dim border-motorsport-border hover:text-motorsport-muted hover:border-motorsport-muted/40'
            }`}
          >
            <span className={`w-[6px] h-[6px] ${recording ? 'bg-motorsport-red animate-pulse' : 'bg-motorsport-dim'}`} />
            REC
            {(session?.recorded_laps ?? 0) > 0 && (
              <span className="font-telemetry tabular-nums" title="Completed laps recorded this session">
                · {session!.recorded_laps} {session!.recorded_laps === 1 ? 'LAP' : 'LAPS'}
              </span>
            )}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar ── */}
        <nav className="w-[68px] bg-motorsport-charcoal border-r border-motorsport-border flex flex-col py-1 shrink-0">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `relative flex flex-col items-center justify-center h-[58px] transition-all ${
                  isActive
                    ? 'text-motorsport-orange bg-motorsport-orange/[0.07]'
                    : 'text-motorsport-muted hover:text-motorsport-text hover:bg-motorsport-surface/30'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 inset-y-3 w-[2px] bg-motorsport-orange" />
                  )}
                  <item.icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                  <span className="text-[11px] mt-1.5 tracking-wide uppercase font-semibold">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* ── Main ── */}
        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
