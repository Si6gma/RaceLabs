import { useState, useMemo } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { Table, Download, Play, Trash2, Calendar, Trophy, Flag } from 'lucide-react';
import { formatTime } from '@/utils/formatters';

interface SessionRecord {
  id: string;
  name: string;
  track: string;
  session_type: string;
  date: string;
  laps: number;
  best_lap_ms: number;
  status: 'active' | 'completed' | 'saved';
}

const MOCK_SESSIONS: SessionRecord[] = [
  { id: '1', name: 'FP1 - Bahrain', track: 'Sakhir', session_type: 'P1', date: '2024-03-01', laps: 28, best_lap_ms: 89321, status: 'completed' },
  { id: '2', name: 'FP2 - Bahrain', track: 'Sakhir', session_type: 'P2', date: '2024-03-01', laps: 32, best_lap_ms: 88542, status: 'completed' },
  { id: '3', name: 'Q1 - Bahrain', track: 'Sakhir', session_type: 'Q1', date: '2024-03-02', laps: 12, best_lap_ms: 87654, status: 'completed' },
  { id: '4', name: 'Race - Bahrain', track: 'Sakhir', session_type: 'Race', date: '2024-03-02', laps: 57, best_lap_ms: 88123, status: 'saved' },
];

export default function SessionTable() {
  const { session } = useTelemetryStore();
  const [filter, setFilter] = useState('');
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  
  const allSessions = useMemo(() => {
    const current = session ? [{
      id: session.session_id,
      name: `${session.session_type} - ${session.track}`,
      track: session.track,
      session_type: session.session_type,
      date: new Date().toISOString().split('T')[0],
      laps: session.lap_count,
      best_lap_ms: session.best_lap_time || 0,
      status: 'active' as const,
    }] : [];
    return [...current, ...MOCK_SESSIONS];
  }, [session]);
  
  const filtered = useMemo(() => {
    if (!filter) return allSessions;
    const f = filter.toLowerCase();
    return allSessions.filter(s => 
      s.name.toLowerCase().includes(f) || 
      s.track.toLowerCase().includes(f) ||
      s.session_type.toLowerCase().includes(f)
    );
  }, [allSessions, filter]);
  
  return (
    <div className="h-full flex flex-col p-3 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between telemetry-panel p-2 shrink-0">
        <div className="flex items-center gap-2">
          <Table className="w-4 h-4 text-motorsport-orange" />
          <span className="text-sm font-semibold">SESSIONS</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Filter sessions..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="bg-motorsport-charcoal border border-motorsport-border rounded-sm px-3 py-1.5 text-xs text-motorsport-text placeholder-motorsport-dim focus:outline-none focus:border-motorsport-orange w-48"
          />
          <button className="flex items-center gap-1 px-3 py-1.5 bg-motorsport-surface rounded-sm text-xs hover:bg-motorsport-surface/80 transition-colors">
            <Download className="w-3 h-3" />
            Export
          </button>
        </div>
      </div>
      
      {/* Table */}
      <div className="flex-1 telemetry-panel overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-motorsport-panel z-10">
              <tr className="text-[10px] text-motorsport-muted uppercase tracking-wider border-b border-motorsport-border">
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Track</th>
                <th className="text-left p-3">Type</th>
                <th className="text-left p-3">Date</th>
                <th className="text-right p-3">Laps</th>
                <th className="text-right p-3">Best Lap</th>
                <th className="text-center p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr 
                  key={s.id}
                  className={`border-b border-motorsport-border/50 hover:bg-motorsport-surface/30 transition-colors ${
                    selectedSession === s.id ? 'bg-motorsport-orange/5' : ''
                  }`}
                  onClick={() => setSelectedSession(s.id)}
                >
                  <td className="p-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-sm border ${
                      s.status === 'active' 
                        ? 'bg-motorsport-green/10 text-motorsport-green border-motorsport-green/30'
                        : s.status === 'completed'
                        ? 'bg-motorsport-cyan/10 text-motorsport-cyan border-motorsport-cyan/30'
                        : 'bg-motorsport-muted/10 text-motorsport-muted border-motorsport-muted/30'
                    }`}>
                      {s.status === 'active' ? (
                        <><Flag className="w-3 h-3" /> LIVE</>
                      ) : s.status === 'completed' ? (
                        <><Trophy className="w-3 h-3" /> DONE</>
                      ) : (
                        'SAVED'
                      )}
                    </span>
                  </td>
                  <td className="p-3 text-sm font-medium">{s.name}</td>
                  <td className="p-3 text-sm text-motorsport-muted">{s.track}</td>
                  <td className="p-3">
                    <span className="text-xs px-2 py-0.5 bg-motorsport-charcoal rounded-sm text-motorsport-text">
                      {s.session_type}
                    </span>
                  </td>
                  <td className="p-3 text-sm text-motorsport-muted">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {s.date}
                    </div>
                  </td>
                  <td className="p-3 text-right font-telemetry text-sm">{s.laps}</td>
                  <td className="p-3 text-right font-telemetry text-sm text-motorsport-cyan">
                    {s.best_lap_ms > 0 ? formatTime(s.best_lap_ms) : '--:--'}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-center gap-1">
                      <button className="p-1 rounded-sm hover:bg-motorsport-surface transition-colors">
                        <Play className="w-3.5 h-3.5 text-motorsport-green" />
                      </button>
                      <button className="p-1 rounded-sm hover:bg-motorsport-surface transition-colors">
                        <Download className="w-3.5 h-3.5 text-motorsport-muted" />
                      </button>
                      <button className="p-1 rounded-sm hover:bg-motorsport-surface transition-colors">
                        <Trash2 className="w-3.5 h-3.5 text-motorsport-red" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Summary Footer */}
      <div className="telemetry-panel p-2 flex items-center justify-between shrink-0">
        <span className="text-xs text-motorsport-muted">
          {filtered.length} session{filtered.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-4 text-xs">
          <span className="text-motorsport-muted">
            Total Laps: <span className="text-motorsport-text font-telemetry">{filtered.reduce((a, s) => a + s.laps, 0)}</span>
          </span>
          <span className="text-motorsport-muted">
            Best: <span className="text-motorsport-cyan font-telemetry">
              {formatTime(Math.min(...filtered.filter(s => s.best_lap_ms > 0).map(s => s.best_lap_ms)) || 0)}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
