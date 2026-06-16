import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';
import { Download, Trash2, Calendar, Flag, Upload, Search, Filter, FileSpreadsheet, Eye, Play, AlertTriangle } from 'lucide-react';
import { formatTime } from '@/utils/formatters';
import ImportModal from '@/components/ImportModal';
import { useNavigate } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function SessionTable() {
  const session            = useTelemetryStore(s => s.session);
  const importedSessions   = useTelemetryStore(s => s.importedSessions);
  const setImportedSessions = useTelemetryStore(s => s.setImportedSessions);
  const setImportModalOpen = useTelemetryStore(s => s.setImportModalOpen);
  const removeImportedSession = useTelemetryStore(s => s.removeImportedSession);
  const [filter, setFilter]         = useState('');
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [loading, setLoading]       = useState(false);
  const [trackFilter, setTrackFilter] = useState('');
  const [sessions, setSessions]     = useState<any[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/api/import/sessions`);
        if (res.ok) setImportedSessions((await res.json()).sessions || []);
      } catch { /* swallow */ } finally { setLoading(false); }
    })();
  }, [setImportedSessions]);

  useEffect(() => {
    const fetchLocal = async () => {
      try {
        const res = await fetch('/api/sessions');
        if (res.ok) setSessions((await res.json()).sessions || []);
      } catch { /* swallow */ }
    };
    fetchLocal();
    const id = setInterval(fetchLocal, 5000);
    return () => clearInterval(id);
  }, []);

  const allSessions = useMemo(() => {
    const current = session ? [{
      id: session.session_id,
      name: `${session.session_type} — ${session.track}`,
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
      name: `${s.session_type} — ${s.track}`,
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

  const tracks = useMemo(() => Array.from(new Set(allSessions.map(s => s.track))).sort(), [allSessions]);

  const filtered = useMemo(() => {
    let r = allSessions;
    if (filter) {
      const f = filter.toLowerCase();
      r = r.filter(s => s.name.toLowerCase().includes(f) || s.track.toLowerCase().includes(f) || s.session_type.toLowerCase().includes(f));
    }
    if (trackFilter) r = r.filter(s => s.track === trackFilter);
    return r;
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
        if (res.ok) { setSessions(p => p.filter(s => s.session_id !== id)); if (selectedSession === id) setSelectedSession(null); }
      } else if (source === 'csv') {
        const res = await fetch(`${API_URL}/api/import/sessions/${id}`, { method: 'DELETE' });
        if (res.ok) { removeImportedSession(id); if (selectedSession === id) setSelectedSession(null); }
      }
    } catch { /* swallow */ }
  }, [confirmDelete, removeImportedSession, selectedSession]);

  const handleExport = useCallback(async (id: string, source: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (source === 'live' || source === 'local') {
        const res = await fetch(`/api/sessions/${id}/export`);
        if (!res.ok) return;
        const blob = new Blob([JSON.stringify(await res.json(), null, 2)], { type: 'application/json' });
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${id}.json` });
        a.click(); URL.revokeObjectURL(a.href);
      } else {
        const res = await fetch(`${API_URL}/api/import/sessions/${id}/export?format=csv`);
        if (res.ok) {
          const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: `session_${id}.csv` });
          a.click(); URL.revokeObjectURL(a.href);
        }
      }
    } catch { /* swallow */ }
  }, []);

  const handleReplay = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try { await fetch(`/api/sessions/${id}/replay`, { method: 'POST' }); } catch { /* swallow */ }
  }, []);

  return (
    <div className="h-full flex flex-col gap-px p-px bg-motorsport-dim/20 overflow-hidden">
      <ImportModal />

      {/* ── Header ── */}
      <div className="telemetry-panel shrink-0">
        <div className="panel-header justify-between">
          <span className="eng-label font-bold">Session Library</span>
          <div className="flex items-center gap-2">
            {/* Track filter */}
            <div className="relative">
              <Filter className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-motorsport-dim pointer-events-none" />
              <select
                value={trackFilter}
                onChange={e => setTrackFilter(e.target.value)}
                className="field pl-7 pr-3 appearance-none cursor-pointer text-[12px] h-7"
              >
                <option value="">All Tracks</option>
                {tracks.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {/* Search */}
            <div className="relative">
              <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-motorsport-dim pointer-events-none" />
              <input
                type="text"
                placeholder="Search…"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="field pl-7 w-40 text-[12px] h-7"
              />
            </div>
            <button onClick={() => setImportModalOpen(true)} className="btn-primary h-7 text-[11px]">
              <Upload className="w-3 h-3" /> Import CSV
            </button>
          </div>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 telemetry-panel overflow-hidden flex flex-col min-h-0">
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-motorsport-dark border-b border-motorsport-border z-10">
              <tr>
                {['Status', 'Session', 'Track', 'Type', 'Date', 'Laps', 'Samples', 'Best Lap', 'Actions'].map(h => (
                  <th key={h} className="eng-label text-left px-3 py-2 font-bold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-[13px] text-motorsport-muted uppercase tracking-wider">Loading sessions…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-[13px] text-motorsport-muted uppercase tracking-wider">No sessions found — import a CSV or start telemetry</td></tr>
              )}
              {filtered.map(s => (
                <tr
                  key={s.id}
                  className={`table-row-interactive text-[13px] ${selectedSession === s.id ? 'bg-motorsport-orange/[0.04]' : ''}`}
                  onClick={() => setSelectedSession(s.id)}
                >
                  <td className="px-3 py-2">
                    {s.status === 'active'
                      ? <span className="badge-live"><Flag className="w-3 h-3" />Live</span>
                      : s.source === 'csv'
                      ? <span className="badge-csv"><FileSpreadsheet className="w-3 h-3" />CSV</span>
                      : <span className="badge-saved"><FileSpreadsheet className="w-3 h-3" />Saved</span>
                    }
                  </td>
                  <td className="px-3 py-2 font-medium text-motorsport-text max-w-[200px] truncate">{s.name}</td>
                  <td className="px-3 py-2 text-motorsport-muted">{s.track}</td>
                  <td className="px-3 py-2">
                    <span className="text-[11px] px-2 py-0.5 bg-motorsport-surface border border-motorsport-border text-motorsport-muted uppercase tracking-wider">
                      {s.session_type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-motorsport-muted">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3 h-3 shrink-0" />
                      {s.date}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-telemetry">{s.laps}</td>
                  <td className="px-3 py-2 text-right font-telemetry text-motorsport-muted">
                    {s.sample_count > 0 ? s.sample_count.toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-telemetry text-motorsport-cyan">
                    {s.best_lap_ms > 0 ? formatTime(s.best_lap_ms) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-center gap-px">
                      <button onClick={e => { e.stopPropagation(); navigate(`/session/${s.id}`); }} className="icon-btn" title="View">
                        <Eye className="w-3.5 h-3.5 text-motorsport-cyan" />
                      </button>
                      {(s.source === 'live' || s.source === 'local') && (
                        <button onClick={e => handleReplay(s.id, e)} className="icon-btn" title="Replay">
                          <Play className="w-3.5 h-3.5 text-motorsport-green" />
                        </button>
                      )}
                      <button onClick={e => handleExport(s.id, s.source, e)} className="icon-btn" title="Export">
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      {s.source !== 'live' && (
                        <button
                          onClick={e => handleDelete(s.id, s.source, e)}
                          className={`p-1.5 transition-colors ${
                            confirmDelete === s.id
                              ? 'text-motorsport-red bg-motorsport-red/10'
                              : 'text-motorsport-dim hover:text-motorsport-red hover:bg-motorsport-surface'
                          }`}
                          title={confirmDelete === s.id ? 'Click again to confirm delete' : 'Delete'}
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

      {/* ── Footer summary ── */}
      <div className="telemetry-panel shrink-0 px-3 py-1.5 flex items-center justify-between">
        <span className="text-[12px] text-motorsport-muted uppercase tracking-wider">
          {filtered.length} session{filtered.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-5 text-[12px]">
          <span className="text-motorsport-muted uppercase tracking-wider">
            Total Laps: <span className="font-telemetry text-motorsport-text ml-1">{filtered.reduce((a, s) => a + s.laps, 0)}</span>
          </span>
          <span className="text-motorsport-muted uppercase tracking-wider">
            Best: <span className="font-telemetry text-motorsport-cyan ml-1">
              {filtered.filter(s => s.best_lap_ms > 0).length > 0
                ? formatTime(Math.min(...filtered.filter(s => s.best_lap_ms > 0).map(s => s.best_lap_ms)))
                : '—'}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
