import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { Table, Download, Trash2, Calendar, Flag, Upload, Search, Filter, FileSpreadsheet, Eye, Play, AlertTriangle } from 'lucide-react';
import { formatTime } from '@/utils/formatters';
import ImportModal from '@/components/ImportModal';
import { useNavigate } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function SessionTable() {
  const session = useTelemetryStore(s => s.session);
  const importedSessions = useTelemetryStore(s => s.importedSessions);
  const setImportedSessions = useTelemetryStore(s => s.setImportedSessions);
  const setImportModalOpen = useTelemetryStore(s => s.setImportModalOpen);
  const removeImportedSession = useTelemetryStore(s => s.removeImportedSession);
  const [filter, setFilter] = useState('');
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [trackFilter, setTrackFilter] = useState('');
  const [sessions, setSessions] = useState<any[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

    if (confirmDelete !== id) {
      setConfirmDelete(id);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmDelete(null), 2500);
      return;
    }

    setConfirmDelete(null);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);

    try {
      if (source === 'local') {
        const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
        if (res.ok) {
          setSessions(prev => prev.filter(s => s.session_id !== id));
          if (selectedSession === id) setSelectedSession(null);
        }
      } else if (source === 'csv') {
        const res = await fetch(`${API_URL}/api/import/sessions/${id}`, { method: 'DELETE' });
        if (res.ok) {
          removeImportedSession(id);
          if (selectedSession === id) setSelectedSession(null);
        }
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }, [confirmDelete, removeImportedSession, selectedSession]);

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
    navigate(`/session/${id}`);
  }, [navigate]);

  return (
    <div className="h-full flex flex-col p-3 gap-3">
      <ImportModal />

      {/* Header */}
      <div className="telemetry-panel shrink-0 overflow-hidden">
        <div className="panel-header justify-between">
          <div className="flex items-center gap-2">
            <Table className="w-3.5 h-3.5 text-motorsport-orange" />
            <span className="text-[11px] font-semibold tracking-widest uppercase text-motorsport-text">Session Library</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Filter className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-motorsport-dim pointer-events-none" />
              <select
                value={trackFilter}
                onChange={(e) => setTrackFilter(e.target.value)}
                className="field pl-7 pr-3 appearance-none cursor-pointer"
              >
                <option value="">All Tracks</option>
                {tracks.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="relative">
              <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-motorsport-dim pointer-events-none" />
              <input
                type="text"
                placeholder="Search sessions…"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="field pl-7 w-44"
              />
            </div>
            <button
              onClick={() => setImportModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-motorsport-orange text-black rounded text-[11px] font-semibold hover:bg-motorsport-orange/90 active:scale-95 transition-all"
            >
              <Upload className="w-3 h-3" />
              Import
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 telemetry-panel overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-motorsport-dark z-10 border-b border-motorsport-border">
              <tr className="telemetry-label">
                <th className="text-left px-3 py-2.5">Status</th>
                <th className="text-left px-3 py-2.5">Name</th>
                <th className="text-left px-3 py-2.5">Track</th>
                <th className="text-left px-3 py-2.5">Type</th>
                <th className="text-left px-3 py-2.5">Date</th>
                <th className="text-right px-3 py-2.5">Laps</th>
                <th className="text-right px-3 py-2.5">Samples</th>
                <th className="text-right px-3 py-2.5">Best Lap</th>
                <th className="text-center px-3 py-2.5">Actions</th>
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
                  className={`table-row-interactive ${selectedSession === s.id ? 'bg-motorsport-orange/5' : ''}`}
                  onClick={() => setSelectedSession(s.id)}
                >
                  <td className="px-3 py-2.5">
                    {s.status === 'active' ? (
                      <span className="badge-live"><Flag className="w-3 h-3" />Live</span>
                    ) : s.source === 'csv' ? (
                      <span className="badge-csv"><FileSpreadsheet className="w-3 h-3" />CSV</span>
                    ) : (
                      <span className="badge-saved"><FileSpreadsheet className="w-3 h-3" />Saved</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[13px] font-medium text-motorsport-text">{s.name}</td>
                  <td className="px-3 py-2.5 text-[13px] text-motorsport-muted">{s.track}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-[11px] px-2 py-0.5 bg-motorsport-surface rounded border border-motorsport-border text-motorsport-muted">
                      {s.session_type}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-motorsport-muted">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3 h-3" />
                      {s.date}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-telemetry text-[13px]">{s.laps}</td>
                  <td className="px-3 py-2.5 text-right font-telemetry text-[13px] text-motorsport-muted">
                    {s.sample_count > 0 ? s.sample_count.toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-telemetry text-[13px] text-motorsport-cyan">
                    {s.best_lap_ms > 0 ? formatTime(s.best_lap_ms) : '—:——'}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-center gap-0.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleView(s.id); }}
                        className="icon-btn"
                        title="View"
                      >
                        <Eye className="w-3.5 h-3.5 text-motorsport-cyan" />
                      </button>
                      {(s.source === 'live' || s.source === 'local') && (
                        <button
                          onClick={(e) => handleReplay(s.id, e)}
                          className="icon-btn"
                          title="Replay"
                        >
                          <Play className="w-3.5 h-3.5 text-motorsport-green" />
                        </button>
                      )}
                      <button
                        onClick={(e) => handleExport(s.id, s.source, e)}
                        className="icon-btn"
                        title="Export"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      {s.source !== 'live' && (
                        <button
                          onClick={(e) => handleDelete(s.id, s.source, e)}
                          className={`p-1.5 rounded transition-colors ${
                            confirmDelete === s.id
                              ? 'bg-motorsport-red/20 text-motorsport-red'
                              : 'text-motorsport-dim hover:text-motorsport-red hover:bg-motorsport-surface'
                          }`}
                          title={confirmDelete === s.id ? 'Click again to confirm' : 'Delete'}
                        >
                          {confirmDelete === s.id
                            ? <AlertTriangle className="w-3.5 h-3.5" />
                            : <Trash2 className="w-3.5 h-3.5" />
                          }
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
