import { NavLink } from 'react-router-dom';
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

export default function Layout({ children }: { children: React.ReactNode }) {
  const { connected, session, replayMode } = useTelemetryStore();

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
          {replayMode && (
            <span className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 bg-motorsport-purple/15 text-motorsport-purple border border-motorsport-purple/30 rounded font-semibold tracking-wider uppercase">
              <RotateCcw className="w-3 h-3" />
              Replay
            </span>
          )}
          <div className="flex items-center gap-1.5">
            {connected ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-motorsport-green animate-pulse" />
                <span className="text-[11px] text-motorsport-green font-medium">Live</span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-motorsport-dim" />
                <span className="text-[11px] text-motorsport-muted">Offline</span>
              </>
            )}
          </div>
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
