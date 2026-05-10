import { useState, useMemo, useEffect, useCallback } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { Table, Download, Trash2, Calendar, Flag, Upload, Search, Filter, FileSpreadsheet, Eye, Play } from 'lucide-react';
import { formatTime } from '@/utils/formatters';
import ImportModal from '@/components/ImportModal';
import { useNavigate } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function SessionTable() {
  const { session, importedSessions, setImportedSessions, setImportModalOpen, removeImportedSession, setSelectedImportedSession } = useTelemetryStore();
  const [filter, setFilter] = useState('');
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [trackFilter, setTrackFilter] = useState('');
  const [sessions, setSessions] = useState<any[]>([]);
  const navigate = useNavigate();

  // Fetch imported sessions
  useEffect(() => {
    const fetchImported = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/api/import/sessions`);
        if (res.ok) {
          const data = await res.json();
          setImportedSessions(data.sessions || []);
        }
      } catch (err) {
        console.error('Failed to fetch imported sessions:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchImported();
  }, [setImportedSessions]);

  // Fetch local pipeline sessions
  useEffect(() => {
    const fetchLocal = async () => {
      try {
        const res = await fetch('/api/sessions');
        if (!res.ok) return;
        const data = await res.json();
        setSessions(data.sessions || []);
      } catch (err) {
        console.error('Failed to fetch local sessions:', err);
      }
    };
    fetchLocal();
    const interval = setInterval(fetchLocal, 5000);
    return () => clearInterval(interval);
  }, []);

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
      source: 'live',
      sample_count: 0,
    }] : [];

    const local = sessions.map((s: any) => ({
      id: s.session_id,
      name: `${s.session_type} - ${s.track}`,
      track: s.track,
      session_type: s.session_type,
      date: new Date((s.created_at || 0) * 1000).toISOString().split('T')[0],
      laps: s.lap_count || 0,
      best_lap_ms: s.best_lap_time || 0,
      status: (s.status || (s.is_active ? 'active' : 'completed')) as 'active' | 'completed' | 'saved',
      source: 'local' as const,
      sample_count: 0,
    }));

    const imported = importedSessions.map(s => ({
      id: s.id,
      name: s.name,
      track: s.track,
      session_type: s.session_type,
      date: s.created_at?.split('T')[0] || '',
      laps: s.lap_count,
      best_lap_ms: s.best_lap_time_ms || 0,
      status: 'saved' as const,
      source: s.source,
      sample_count: s.sample_count,
    }));

    return [...current, ...local, ...imported];
  }, [session, sessions, importedSessions]);

  const tracks = useMemo(() => {
    const trackSet = new Set(allSessions.map(s => s.track));
    return Array.from(trackSet).sort();
  }, [allSessions]);

  const filtered = useMemo(() => {
    let result = allSessions;

    if (filter) {
      const f = filter.toLowerCase();
      result = result.filter(s =>
        s.name.toLowerCase().includes(f) ||
        s.track.toLowerCase().includes(f) ||
        s.session_type.toLowerCase().includes(f)
      );
    }

    if (trackFilter) {
      result = result.filter(s => s.track === trackFilter);
    }

    return result;
  }, [allSessions, filter, trackFilter]);

  const handleDelete = useCallback(async (id: string, source: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this session?')) return;

    try {
      if (source === 'local') {
        const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
        if (res.ok) {
          setSessions(prev => prev.filter(s => s.session_id !== id));
          if (selectedSession === id) setSelectedSession(null);
        }
      } else if (source === 'csv') {
        const res = await fetch(`${API_URL}/api/import/sessions/${id}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          removeImportedSession(id);
          if (selectedSession === id) setSelectedSession(null);
        }
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }, [removeImportedSession, selectedSession]);

  const handleExport = useCallback(async (id: string, source: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (source === 'live' || source === 'local') {
        const res = await fetch(`/api/sessions/${id}/export`);
        if (!res.ok) return;
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${id}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const res = await fetch(`${API_URL}/api/import/sessions/${id}/export?format=csv`);
        if (res.ok) {
          const blob = await res.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `session_${id}.csv`;
          a.click();
          window.URL.revokeObjectURL(url);
        }
      }
    } catch (err) {
      console.error('Export failed:', err);
    }
  }, []);

  const handleReplay = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/sessions/${id}/replay`, { method: 'POST' });
      if (!res.ok) return;
    } catch (err) {
      console.error('Replay failed:', err);
    }
  }, []);

  const handleView = useCallback((id: string) => {
    const importedSession = importedSessions.find(s => s.id === id);
    if (importedSession) {
      setSelectedImportedSession(importedSession);
      navigate(`/session/${id}`);
    }
  }, [importedSessions, setSelectedImportedSession, navigate]);

  return (
    <div className="h-full flex flex-col p-3 gap-3">
      <ImportModal />

      {/* Header */}
      <div className="flex items-center justify-between telemetry-panel p-2 shrink-0">
        <div className="flex items-center gap-2">
          <Table className="w-4 h-4 text-motorsport-orange" />
          <span className="text-sm font-semibold">SESSION LIBRARY</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Track Filter */}
          <div className="relative">
            <Filter className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-motorsport-muted" />
            <select
              value={trackFilter}
              onChange={(e) => setTrackFilter(e.target.value)}
              className="bg-motorsport-charcoal border border-motorsport-border rounded-sm pl-7 pr-3 py-1.5 text-xs text-motorsport-text focus:outline-none focus:border-motorsport-orange appearance-none cursor-pointer"
            >
              <option value="">All Tracks</option>
              {tracks.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-motorsport-muted" />
            <input
              type="text"
              placeholder="Filter sessions..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="bg-motorsport-charcoal border border-motorsport-border rounded-sm pl-7 pr-3 py-1.5 text-xs text-motorsport-text placeholder-motorsport-dim focus:outline-none focus:border-motorsport-orange w-48"
            />
          </div>

          {/* Import Button */}
          <button
            onClick={() => setImportModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-motorsport-orange text-motorsport-black rounded-sm text-xs font-semibold hover:bg-motorsport-orange/90 transition-colors"
          >
            <Upload className="w-3 h-3" />
            Import
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
                <th className="text-right p-3">Samples</th>
                <th className="text-right p-3">Best Lap</th>
                <th className="text-center p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-sm text-motorsport-muted">
                    Loading sessions...
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-sm text-motorsport-muted">
                    No sessions found. Import a CSV or start receiving telemetry to get started.
                  </td>
                </tr>
              )}
              {filtered.map(s => (
                <tr
                  key={s.id}
                  className={`border-b border-motorsport-border/50 hover:bg-motorsport-surface/30 transition-colors cursor-pointer ${
                    selectedSession === s.id ? 'bg-motorsport-orange/5' : ''
                  }`}
                  onClick={() => setSelectedSession(s.id)}
                >
                  <td className="p-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-sm border ${
                      s.status === 'active'
                        ? 'bg-motorsport-green/10 text-motorsport-green border-motorsport-green/30'
                        : 'bg-motorsport-muted/10 text-motorsport-muted border-motorsport-muted/30'
                    }`}>
                      {s.status === 'active' ? (
                        <><Flag className="w-3 h-3" /> LIVE</>
                      ) : (
                        <><FileSpreadsheet className="w-3 h-3" /> {s.source === 'csv' ? 'CSV' : 'SAVED'}</>
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
                  <td className="p-3 text-right font-telemetry text-sm text-motorsport-muted">
                    {s.sample_count > 0 ? s.sample_count.toLocaleString() : '--'}
                  </td>
                  <td className="p-3 text-right font-telemetry text-sm text-motorsport-cyan">
                    {s.best_lap_ms > 0 ? formatTime(s.best_lap_ms) : '--:--'}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-center gap-1">
                      {s.source === 'csv' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleView(s.id);
                          }}
                          className="p-1 rounded-sm hover:bg-motorsport-surface transition-colors"
                          title="View Session"
                        >
                          <Eye className="w-3.5 h-3.5 text-motorsport-cyan" />
                        </button>
                      )}
                      {(s.source === 'live' || s.source === 'local') && (
                        <button
                          onClick={(e) => handleReplay(s.id, e)}
                          className="p-1 rounded-sm hover:bg-motorsport-surface transition-colors"
                          title="Replay"
                        >
                          <Play className="w-3.5 h-3.5 text-motorsport-green" />
                        </button>
                      )}
                      <button
                        onClick={(e) => handleExport(s.id, s.source, e)}
                        className="p-1 rounded-sm hover:bg-motorsport-surface transition-colors"
                        title="Export"
                      >
                        <Download className="w-3.5 h-3.5 text-motorsport-muted" />
                      </button>
                      {s.source !== 'live' && (
                        <button
                          onClick={(e) => handleDelete(s.id, s.source, e)}
                          className="p-1 rounded-sm hover:bg-motorsport-surface transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-motorsport-red" />
                        </button>
                      )}
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
              {filtered.filter(s => s.best_lap_ms > 0).length > 0
                ? formatTime(Math.min(...filtered.filter(s => s.best_lap_ms > 0).map(s => s.best_lap_ms)))
                : '--:--'}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
