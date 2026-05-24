import { NavLink } from 'react-router-dom';
import { useEffect, useState, useMemo, memo } from 'react';
import {
  Activity,
  GitCompare,
  Table,
  BarChart3,
  Settings,
  Radio,
  RotateCcw,
} from 'lucide-react';
import { useTelemetryStore } from '@/stores/telemetryStore';

const navItems = [
  { path: '/', label: 'Live', icon: Activity },
  { path: '/compare', label: 'Compare', icon: GitCompare },
  { path: '/sessions', label: 'Sessions', icon: Table },
  { path: '/stats', label: 'Analytics', icon: BarChart3 },
  { path: '/setup', label: 'Setup', icon: Settings },
];

type GameStatus = 'offline' | 'no_game' | 'garage' | 'on_track';

function GameStatusIndicator({ sessionLabel }: { sessionLabel: string | null }) {
  const connected = useTelemetryStore(s => s.connected);
  const lastFrameTime = useTelemetryStore(s => s.lastFrameTime);
  const driverStatus = useTelemetryStore(s => s.currentFrame?.lap?.driver_status);

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

  return (
    <div className="flex items-center gap-1.5">
      {gameStatus === 'offline' && (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-motorsport-dim" />
          <span className="text-[11px] text-motorsport-muted">Offline</span>
        </>
      )}
      {gameStatus === 'no_game' && (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-motorsport-dim" />
          <span className="text-[11px] text-motorsport-muted">No Game</span>
        </>
      )}
      {gameStatus === 'garage' && (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-motorsport-orange" />
          <span className="text-[11px] text-motorsport-orange font-medium">In Garage</span>
        </>
      )}
      {gameStatus === 'on_track' && (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-motorsport-green animate-pulse" />
          <span className="text-[11px] text-motorsport-green font-medium">{sessionLabel}</span>
        </>
      )}
    </div>
  );
}

const GameStatusIndicatorMemo = memo(GameStatusIndicator);

export default function Layout({ children }: { children: React.ReactNode }) {
  const session = useTelemetryStore(s => s.session);
  const replayMode = useTelemetryStore(s => s.replayMode);
  const recording = useTelemetryStore(s => s.recording);
  const setRecording = useTelemetryStore(s => s.setRecording);

  useEffect(() => {
    fetch('/api/recording/status').then(r => r.json()).then(d => setRecording(d.recording)).catch(() => {});
  }, [setRecording]);

  async function toggleRecording() {
    const endpoint = recording ? '/api/recording/stop' : '/api/recording/start';
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      setRecording(data.recording);
    } catch {}
  }

  const sessionLabel = useMemo(() => {
    return session?.session_type || 'On Track';
  }, [session]);

  return (
    <div className="h-screen flex flex-col bg-motorsport-black overflow-hidden">
      {/* Top Header */}
      <header className="h-11 bg-motorsport-charcoal border-b border-motorsport-border flex items-center px-4 gap-6 shrink-0">
        {/* Brand */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-6 h-6 rounded-sm bg-motorsport-orange/15 flex items-center justify-center">
            <Radio className="w-3.5 h-3.5 text-motorsport-orange" />
          </div>
          <span className="text-[13px] font-semibold tracking-widest text-motorsport-text uppercase">
            Telemetry Suite
          </span>
        </div>

        {/* Session info chips */}
        {session && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="px-2 py-0.5 bg-motorsport-surface rounded border border-motorsport-border text-motorsport-muted">
              {session.track}
            </span>
            <span className="px-2 py-0.5 bg-motorsport-surface rounded border border-motorsport-border text-motorsport-muted">
              {session.session_type}
            </span>
            <span className="px-2 py-0.5 bg-motorsport-surface rounded border border-motorsport-border text-motorsport-muted">
              Lap <span className="text-motorsport-text font-medium">{session.current_lap}</span>
              {session.total_laps ? `/${session.total_laps}` : ''}
            </span>
            {session.best_lap_time && (
              <span className="px-2 py-0.5 bg-motorsport-surface rounded border border-motorsport-border text-motorsport-muted font-telemetry">
                Best <span className="text-motorsport-cyan">{formatBestLap(session.best_lap_time)}</span>
              </span>
            )}
          </div>
        )}

        {/* Right side status */}
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={toggleRecording}
            className={`flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded border font-semibold tracking-wider uppercase transition-colors ${
              recording
                ? 'bg-motorsport-red/15 text-motorsport-red border-motorsport-red/40 hover:bg-motorsport-red/25'
                : 'bg-transparent text-motorsport-dim border-motorsport-border hover:text-motorsport-muted hover:border-motorsport-muted/40'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${recording ? 'bg-motorsport-red animate-pulse' : 'bg-motorsport-dim'}`} />
            Rec
          </button>

          {replayMode && (
            <span className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 bg-motorsport-purple/15 text-motorsport-purple border border-motorsport-purple/30 rounded font-semibold tracking-wider uppercase">
              <RotateCcw className="w-3 h-3" />
              Replay
            </span>
          )}
          <GameStatusIndicatorMemo sessionLabel={sessionLabel} />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-[60px] bg-motorsport-charcoal border-r border-motorsport-border flex flex-col py-2 shrink-0">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `relative flex flex-col items-center justify-center h-[52px] transition-all group ${
                  isActive
                    ? 'text-motorsport-orange bg-motorsport-orange/8 shadow-inset-orange'
                    : 'text-motorsport-dim hover:text-motorsport-muted hover:bg-motorsport-surface/40'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 inset-y-2 w-0.5 bg-motorsport-orange rounded-r" />
                  )}
                  <item.icon className="w-[18px] h-[18px]" />
                  <span className="text-[9px] mt-1 font-medium tracking-wide">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Main Content */}
        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}

function formatBestLap(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}
