import { NavLink } from 'react-router-dom';
import { 
  Activity, 
  GitCompare, 
  Table, 
  BarChart3, 
  Settings,
  Radio,
  Wifi,
  WifiOff
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
      {/* Top Status Bar */}
      <header className="h-10 bg-motorsport-charcoal border-b border-motorsport-border flex items-center px-4 justify-between shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-motorsport-orange" />
            <span className="text-sm font-semibold tracking-wider text-motorsport-text">TELEMETRY SUITE</span>
          </div>
          
          {session && (
            <div className="flex items-center gap-4 text-xs telemetry-label">
              <span className="text-motorsport-muted">Track: <span className="text-motorsport-text">{session.track}</span></span>
              <span className="text-motorsport-muted">Session: <span className="text-motorsport-text">{session.session_type}</span></span>
              <span className="text-motorsport-muted">Lap: <span className="text-motorsport-text">{session.current_lap}/{session.total_laps || '--'}</span></span>
              {session.best_lap_time && (
                <span className="text-motorsport-muted">Best: <span className="text-motorsport-cyan">{formatBestLap(session.best_lap_time)}</span></span>
              )}
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-3">
          {replayMode && (
            <span className="text-xs px-2 py-0.5 bg-motorsport-purple/20 text-motorsport-purple border border-motorsport-purple/30 rounded-sm">
              REPLAY
            </span>
          )}
          <div className="flex items-center gap-1.5">
            {connected ? (
              <Wifi className="w-3.5 h-3.5 text-motorsport-green" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-motorsport-red" />
            )}
            <span className={`text-xs ${connected ? 'text-motorsport-green' : 'text-motorsport-red'}`}>
              {connected ? 'LIVE' : 'OFFLINE'}
            </span>
          </div>
        </div>
      </header>
      
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-14 bg-motorsport-charcoal border-r border-motorsport-border flex flex-col items-center py-3 gap-1 shrink-0">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `w-10 h-10 flex flex-col items-center justify-center rounded-sm transition-colors ${
                  isActive 
                    ? 'bg-motorsport-orange/10 text-motorsport-orange' 
                    : 'text-motorsport-muted hover:text-motorsport-text hover:bg-motorsport-surface'
                }`
              }
            >
              <item.icon className="w-4 h-4" />
              <span className="text-[9px] mt-0.5 font-medium">{item.label}</span>
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
