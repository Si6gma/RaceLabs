import { useState, useMemo, useEffect, useCallback } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { Table, Download, Play, Trash2, Calendar, Trophy, Flag } from 'lucide-react';
import { formatTime } from '@/utils/formatters';

interface SessionRecord {
  session_id: string;
  name: string;
  track: string;
  session_type: string;
  date: string;
  laps: number;
  best_lap_ms: number;
  status: 'active' | 'completed' | 'saved';
}

function formatDate(ts: number): string {
  try {
    return new Date(ts * 1000).toISOString().split('T')[0];
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

export default function SessionTable() {
  const { session } = useTelemetryStore();
  const [filter, setFilter] = useState('');
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);


  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) return;
      const data = await res.json();
      const records: SessionRecord[] = (data.sessions || []).map((s: any) => ({
        session_id: s.session_id,
        name: `${s.session_type} - ${s.track}`,
        track: s.track,
        session_type: s.session_type,
        date: formatDate(s.created_at),
        laps: s.lap_count || 0,
        best_lap_ms: s.best_lap_time || 0,
        status: s.status || (s.is_active ? 'active' : 'completed'),
      }));
      setSessions(records);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const allSessions = useMemo(() => {
    const current = session ? [{
      session_id: session.session_id,
      name: `${session.session_type} - ${session.track}`,
      track: session.track,
      session_type: session.session_type,
      date: new Date().toISOString().split('T')[0],
      laps: session.lap_count || 0,
      best_lap_ms: session.best_lap_time || 0,
      status: 'active' as const,
    }] : [];
    // Merge current live session on top if not already in fetched list
    const existingIds = new Set(sessions.map(s => s.session_id));
    const merged = [...current.filter(c => !existingIds.has(c.session_id)), ...sessions];
    return merged;
  }, [session, sessions]);

  const filtered = useMemo(() => {
    if (!filter) return allSessions;
    const f = filter.toLowerCase();
    return allSessions.filter(s =>
      s.name.toLowerCase().includes(f) ||
      s.track.toLowerCase().includes(f) ||
      s.session_type.toLowerCase().includes(f)
    );
  }, [allSessions, filter]);

  const handleExport = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/export`);
      if (!res.ok) return;
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sessionId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  };

  const handlePlay = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/replay`, { method: 'POST' });
      if (!res.ok) return;
    } catch {
      // ignore
    }
  };

  const handleDelete = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
      if (!res.ok) return;
      setSessions(prev => prev.filter(s => s.session_id !== sessionId));
      if (selectedSession === sessionId) setSelectedSession(null);
    } catch {
      // ignore
    }
  };

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
          <button
            onClick={() => handleExport(selectedSession || '')}
            disabled={!selectedSession}
            className="flex items-center gap-1 px-3 py-1.5 bg-motorsport-surface rounded-sm text-xs hover:bg-motorsport-surface/80 transition-colors disabled:opacity-40"
          >
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
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-sm text-motorsport-muted">
                    No sessions available. Start receiving telemetry to see sessions here.
                  </td>
                </tr>
              )}
              {filtered.map(s => (
                <tr
                  key={s.session_id}
                  className={`border-b border-motorsport-border/50 hover:bg-motorsport-surface/30 transition-colors cursor-pointer ${
                    selectedSession === s.session_id ? 'bg-motorsport-orange/5' : ''
                  }`}
                  onClick={() => setSelectedSession(s.session_id)}
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
                      <button
                        onClick={(e) => { e.stopPropagation(); handlePlay(s.session_id); }}
                        className="p-1 rounded-sm hover:bg-motorsport-surface transition-colors"
                        title="Replay"
                      >
                        <Play className="w-3.5 h-3.5 text-motorsport-green" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleExport(s.session_id); }}
                        className="p-1 rounded-sm hover:bg-motorsport-surface transition-colors"
                        title="Export"
                      >
                        <Download className="w-3.5 h-3.5 text-motorsport-muted" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(s.session_id); }}
                        className="p-1 rounded-sm hover:bg-motorsport-surface transition-colors"
                        title="Delete"
                      >
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
