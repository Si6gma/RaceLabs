import { NavLink } from 'react-router-dom';
import { useEffect, useState, useMemo, memo } from 'react';
import { Activity, GitCompare, Table, BarChart3, Settings, Radio } from 'lucide-react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import CarSelector from '@/components/CarSelector';

const navItems = [
  { path: '/',         label: 'Live',     icon: Activity   },
  { path: '/compare',  label: 'Compare',  icon: GitCompare },
  { path: '/sessions', label: 'Sessions', icon: Table      },
  { path: '/stats',    label: 'Analytics',icon: BarChart3  },
  { path: '/setup',    label: 'Config',   icon: Settings   },
];

type GameStatus = 'offline' | 'no_game' | 'garage' | 'on_track';

function GameStatusIndicator({ sessionLabel }: { sessionLabel: string | null }) {
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

  const cfg = {
    offline:  { dot: 'bg-motorsport-dim',                      text: 'text-motorsport-dim',    label: 'OFFLINE'              },
    no_game:  { dot: 'bg-motorsport-dim',                      text: 'text-motorsport-muted',  label: 'NO SIGNAL'            },
    garage:   { dot: 'bg-motorsport-orange',                   text: 'text-motorsport-orange', label: 'GARAGE'               },
    on_track: { dot: 'bg-motorsport-green animate-pulse',      text: 'text-motorsport-green',  label: sessionLabel || 'LIVE' },
  }[gameStatus];

  return (
    <div className="flex items-center gap-2">
      <span className={`w-[5px] h-[5px] ${cfg.dot}`} />
      <span className={`text-[11px] font-bold tracking-widest uppercase ${cfg.text}`}>{cfg.label}</span>
    </div>
  );
}

const GameStatusIndicatorMemo = memo(GameStatusIndicator);

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

  const sessionLabel = useMemo(() => session?.session_type || 'LIVE', [session]);

  return (
    <div className="h-screen flex flex-col bg-motorsport-black overflow-hidden">
      {/* ── Header ── */}
      <header className="h-10 bg-motorsport-charcoal border-b border-motorsport-border flex items-center shrink-0">
        {/* Brand */}
        <div className="flex items-center gap-2 px-4 h-full border-r border-motorsport-border shrink-0">
          <Radio className="w-3.5 h-3.5 text-motorsport-orange" />
          <span className="text-[15px] font-bold tracking-[0.22em] text-motorsport-text uppercase">TEL</span>
          <span className="text-[11px] font-light tracking-[0.1em] text-motorsport-muted uppercase">SUITE</span>
        </div>

        {/* Session chips — full height dividers */}
        {session && (
          <div className="flex items-center h-full text-[11px] font-semibold tracking-wider uppercase">
            <HeaderChip label={session.track} />
            <HeaderChip label={session.session_type} />
            <HeaderChip label={`LAP ${session.current_lap}${session.total_laps ? `/${session.total_laps}` : ''}`} />
            {session.best_lap_time && (
              <div className="flex items-center h-full px-4 border-r border-motorsport-border gap-2">
                <span className="text-motorsport-muted">BEST</span>
                <span className="font-telemetry text-motorsport-cyan">{formatBestLap(session.best_lap_time)}</span>
              </div>
            )}
          </div>
        )}

        {/* Right controls */}
        <div className="ml-auto flex items-center gap-3 px-4 h-full border-l border-motorsport-border">
          <CarSelector />

          {replayMode && (
            <span className="eng-chip bg-motorsport-purple/15 text-motorsport-purple border-motorsport-purple/30">
              REPLAY
            </span>
          )}

          <button
            onClick={toggleRecording}
            className={`flex items-center gap-1.5 px-2.5 py-1 border text-[11px] font-bold tracking-widest uppercase transition-colors ${
              recording
                ? 'bg-motorsport-red/15 text-motorsport-red border-motorsport-red/40 hover:bg-motorsport-red/25'
                : 'bg-transparent text-motorsport-dim border-motorsport-border hover:text-motorsport-muted hover:border-motorsport-muted/40'
            }`}
          >
            <span className={`w-[6px] h-[6px] ${recording ? 'bg-motorsport-red animate-pulse' : 'bg-motorsport-dim'}`} />
            REC
          </button>

          <GameStatusIndicatorMemo sessionLabel={sessionLabel} />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar ── */}
        <nav className="w-[58px] bg-motorsport-charcoal border-r border-motorsport-border flex flex-col py-1 shrink-0">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `relative flex flex-col items-center justify-center h-[54px] transition-all ${
                  isActive
                    ? 'text-motorsport-orange bg-motorsport-orange/[0.07]'
                    : 'text-motorsport-dim hover:text-motorsport-muted hover:bg-motorsport-surface/30'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 inset-y-3 w-[2px] bg-motorsport-orange" />
                  )}
                  <item.icon className="w-4 h-4" strokeWidth={1.5} />
                  <span className="text-[9px] mt-1 tracking-widest uppercase font-semibold">{item.label}</span>
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

function HeaderChip({ label }: { label: string }) {
  return (
    <div className="flex items-center h-full px-4 border-r border-motorsport-border text-motorsport-muted">
      {label}
    </div>
  );
}

function formatBestLap(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis  = ms % 1000;
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}
