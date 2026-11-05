import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Download, Play, Trash2, Upload } from 'lucide-react';
import { useReplay, type ReplayField, type GridLap } from '@/stores/replayStore';
import DriverTag from '@/components/DriverTag';
import { useSettings } from '@/stores/settingsStore';
import { useTelemetryStore } from '@/stores/telemetryStore';
import type { ImportedLap, ImportedSession } from '@/types/telemetry';
import TelemetryGraphCanvas, { CHANNELS, DEFAULT_VISIBLE } from '@/components/TelemetryGraphCanvas';
import TrackMapViewer from '@/components/TrackMapViewer';
import ZoomRangeBar from '@/components/ZoomRangeBar';
import ImportModal from '@/components/ImportModal';
import { normalizeImportedSamples, type TelemetryPoint } from '@/utils/telemetryAdapter';
import { formatTime } from '@/utils/formatters';
import { apiFetch } from '@/utils/api';
import { deltaTrace, segmentTimes, detectCorners, cornerMetrics, lapStats } from '@/utils/lapAnalysis';

const PURPLE = '#B388FF';
// The time-trial rival's colour in lists and cards: apart from the lap palette and from orange.
const RIVAL_BLUE = '#4D8BFF';

// Sessions on the same circuit closer together than this belong to one race week.
const WEEK_GAP_MS = 8 * 60 * 60 * 1000;
// The order a weekend runs in, for listing sessions inside a week.
const TYPE_ORDER = ['P1', 'P2', 'P3', 'Short P', 'Q1', 'Q2', 'Q3', 'Short Q', 'One-Shot Q', 'Race', 'Race 2', 'Race 3', 'Time Trial'];

interface Week {
  key: string;
  track: string;
  start: string;
  sessions: ImportedSession[];
}

function groupWeeks(sessions: ImportedSession[]): Week[] {
  const asc = [...sessions].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const weeks: Week[] = [];
  for (const s of asc) {
    const last = weeks[weeks.length - 1];
    const prev = last?.sessions[last.sessions.length - 1];
    const sameWeek = prev && last.track === s.track
      && new Date(s.created_at).getTime() - new Date(prev.created_at).getTime() < WEEK_GAP_MS;
    if (sameWeek) last.sessions.push(s);
    else weeks.push({ key: `week:${s.track_id ?? s.track}:${s.created_at.slice(0, 16)}`, track: s.track, start: s.created_at, sessions: [s] });
  }
  const rank = (t: string) => { const i = TYPE_ORDER.indexOf(t); return i < 0 ? TYPE_ORDER.length : i; };
  for (const w of weeks) w.sessions.sort((a, b) => rank(a.session_type) - rank(b.session_type) || a.created_at.localeCompare(b.created_at));
  return weeks.reverse();
}

// A race that stopped before its last lap, or a session we only caught part of.
function sessionIsPartial(s: ImportedSession): boolean {
  const planned = Number(s.extra_data?.total_laps ?? 0);
  return s.source === 'live' && s.session_type.startsWith('Race') && planned > 0 && s.lap_count < planned;
}

function weekDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const API_URL = import.meta.env.VITE_API_URL || '';

// Lap colours stay clear of the channel colours and of orange (selection).
const LAP_COLORS = ['#00D4FF', '#00E85A', '#FFD000', '#FF2044', '#B388FF', '#FF8AD8'];
const MAX_SELECTED = LAP_COLORS.length;

// Graph padding must match TelemetryGraphCanvas so cursor maths line up.
const GRAPH_PAD = { left: 50, right: 60 };

interface LoadedLap {
  meta: ImportedLap;
  samples: TelemetryPoint[];
}

function sessionDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function lapTime(ms?: number): string {
  return ms && ms > 0 ? formatTime(ms) : '--:--.---';
}

function sectorTime(ms?: number): string {
  return ms && ms > 0 ? formatTime(ms).replace(/^0:/, '') : '--.---';
}

// Time-trial ghosts carry no name, only a slot and a lap time. The slot with the
// fastest lap is the rival; any other slot is one of your own laps replaying.
function ghostNames(laps: LoadedLap[]): Map<string, 'Rival' | 'Ghost'> {
  const ghosts = laps.filter(l => l.meta.ghost);
  const fastest = [...ghosts].sort((a, b) => (a.meta.lap_time_ms ?? 0) - (b.meta.lap_time_ms ?? 0))[0];
  const rivalSlot = fastest?.meta.ghost?.car_index;
  return new Map(ghosts.map(l => [l.meta.id, l.meta.ghost?.car_index === rivalSlot ? 'Rival' : 'Ghost']));
}

export default function Recorded() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const importedSessions   = useTelemetryStore(s => s.importedSessions);
  const setImportedSessions = useTelemetryStore(s => s.setImportedSessions);
  const removeImportedSession = useTelemetryStore(s => s.removeImportedSession);
  const setImportModalOpen = useTelemetryStore(s => s.setImportModalOpen);
  const loadReplay = useReplay(s => s.load);
  const SEGMENTS = useSettings(s => s.segments);
  const replaySpeed = useSettings(s => s.replaySpeed);

  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [lapRenaming, setLapRenaming] = useState<{ id: string; value: string } | null>(null);
  const [weekNames, setWeekNames] = useState<Record<string, string>>({});
  const [weekRenaming, setWeekRenaming] = useState<{ key: string; value: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Week nicknames live in the backend's alias store, keyed by the week key.
  useEffect(() => {
    fetch(`${API_URL}/api/tracks/aliases`).then(r => r.json()).then(d => setWeekNames(d.aliases ?? {})).catch(() => {});
  }, []);

  const renameWeek = async (key: string, name: string) => {
    setWeekRenaming(null);
    const value = name.trim();
    if (value === (weekNames[key] ?? '')) return;
    const res = await apiFetch(`${API_URL}/api/tracks/${encodeURIComponent(key)}/alias`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: value }),
    }).catch(() => null);
    if (res?.ok) setWeekNames((await res.json()).aliases ?? {});
  };

  const toggleWeek = (key: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const [session, setSession] = useState<(ImportedSession & { laps: ImportedLap[] }) | null>(null);
  const [laps, setLaps] = useState<LoadedLap[]>([]);
  const [field, setField] = useState<ReplayField | null>(null);
  const [grid, setGrid] = useState<GridLap[]>([]);
  const [loadingLaps, setLoadingLaps] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [visibleChannels, setVisibleChannels] = useState<Set<string>>(new Set(DEFAULT_VISIBLE));
  const [cursorLocked, setCursorLocked] = useState(false);
  const [lockedPosition, setLockedPosition] = useState(0);
  const [hoverPosition, setHoverPosition] = useState(0);
  const hoverPositionRef = useRef(0);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [zoomRange, setZoomRange] = useState<[number, number]>([0, 1]);
  const isDragging = useRef(false);
  const hasDragged = useRef(false);
  const dragStartX = useRef(0);
  const dragStartZoom = useRef<[number, number]>([0, 1]);
  const graphRef = useRef<HTMLDivElement>(null);

  // ── Sessions: one list, live recordings and CSV imports alike ───────────────
  const refreshSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/import/sessions`);
      if (res.ok) {
        const data = await res.json();
        setImportedSessions(data.sessions ?? []);
      }
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  }, [setImportedSessions]);

  useEffect(() => {
    refreshSessions();
    const id = setInterval(refreshSessions, 10000);
    return () => clearInterval(id);
  }, [refreshSessions]);

  const weeks = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = groupWeeks(importedSessions);
    if (!q) return all;
    return all
      .map(w => ({
        ...w,
        sessions: w.sessions.filter(s => `${weekNames[w.key] ?? ''} ${s.name} ${s.track} ${s.session_type}`.toLowerCase().includes(q)),
      }))
      .filter(w => w.sessions.length > 0);
  }, [importedSessions, query, weekNames]);

  // ── Selected session and its laps ───────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) { setSession(null); setLaps([]); setSelected([]); setField(null); setGrid([]); return; }
    setField(null);
    setGrid([]);
    let cancelled = false;
    const load = async () => {
      setLoadingLaps(true);
      try {
        const res = await fetch(`${API_URL}/api/import/sessions/${sessionId}`);
        if (!res.ok) { if (!cancelled) setSession(null); return; }
        const data = await res.json() as ImportedSession & { laps: ImportedLap[] };
        // The rest of the grid, when the session was recorded live
        fetch(`${API_URL}/api/import/sessions/${sessionId}/field`).then(r => (r.ok ? r.json() : null)).then(f => {
          if (cancelled || !f) return;
          setField({ playerCarIndex: f.player_car_index ?? null, participants: f.participants ?? [], carTeamIds: f.car_team_ids ?? [], laps: f.laps ?? [] });
        }).catch(() => {});
        fetch(`${API_URL}/api/import/sessions/${sessionId}/grid`).then(r => (r.ok ? r.json() : null)).then(g => {
          if (!cancelled && g) setGrid(g.laps ?? []);
        }).catch(() => {});
        const loaded = await Promise.all(data.laps.map(async (meta): Promise<LoadedLap> => {
          const r = await fetch(`${API_URL}/api/import/laps/${meta.id}/resampled`);
          if (r.ok) return { meta, samples: (await r.json()).samples as TelemetryPoint[] };
          const raw = await fetch(`${API_URL}/api/import/laps/${meta.id}/telemetry`);
          return { meta, samples: raw.ok ? normalizeImportedSamples((await raw.json()).samples) : [] };
        }));
        if (cancelled) return;
        // Your laps in order, then the ghosts
        const ordered = [...loaded].sort((a, b) => Number(!!a.meta.ghost) - Number(!!b.meta.ghost) || a.meta.lap_number - b.meta.lap_number);
        setSession(data);
        setLaps(ordered);
        // Start on the fastest clean lap so the page opens with something to read,
        // laid over the rival's lap when the session has one.
        const byTime = (a: LoadedLap, b: LoadedLap) => (a.meta.lap_time_ms ?? 0) - (b.meta.lap_time_ms ?? 0);
        const fastest = ordered
          .filter(l => !l.meta.ghost && l.meta.valid && !l.meta.partial && (l.meta.lap_time_ms ?? 0) > 0)
          .sort(byTime)[0] ?? ordered.find(l => !l.meta.ghost) ?? ordered[0];
        const rival = ordered.filter(l => l.meta.ghost && (l.meta.lap_time_ms ?? 0) > 0).sort(byTime)[0];
        setSelected([fastest, rival].filter((l): l is LoadedLap => !!l).map(l => l.meta.id));
        setConfirmDelete(false);
      } catch (err) {
        console.error('Failed to load session:', err);
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setLoadingLaps(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [sessionId]);

  const selectedLaps = useMemo(
    () => selected.map(id => laps.find(l => l.meta.id === id)).filter((l): l is LoadedLap => !!l),
    [selected, laps],
  );
  const colourOf = (id: string) => LAP_COLORS[selected.indexOf(id)] ?? '#9AACBE';
  const ghostName = useMemo(() => ghostNames(laps), [laps]);
  const lapName = (meta: ImportedLap) => (meta.ghost ? ghostName.get(meta.id) ?? 'Ghost' : `Lap ${meta.lap_number}`);
  const lapShort = (meta: ImportedLap) => (meta.ghost ? (ghostName.get(meta.id) === 'Rival' ? 'RIV' : 'GHO') : `L${meta.lap_number}`);

  const toggleLap = (id: string) => {
    setSelected(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= MAX_SELECTED) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const fastestSelectedMs = useMemo(() => {
    const times = selectedLaps.map(l => l.meta.lap_time_ms ?? 0).filter(t => t > 0);
    return times.length ? Math.min(...times) : null;
  }, [selectedLaps]);

  // Reset the cursor and zoom when the set of laps changes
  const selectionKey = selected.join(',');
  useEffect(() => {
    setZoomRange([0, 1]);
    setLockedPosition(0);
    setHoverPosition(0);
    hoverPositionRef.current = 0;
    setCursorLocked(false);
    // Two laps or more: the delta trace is the first thing to read, so draw it.
    setVisibleChannels(prev => {
      const next = new Set(prev);
      if (selected.length >= 2) next.add('delta_time'); else next.delete('delta_time');
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  const effectivePosition = cursorLocked ? lockedPosition : hoverPosition;

  const sampleAt = (lap: LoadedLap, pos: number): TelemetryPoint | null => {
    if (!lap.samples.length) return null;
    const idx = Math.max(0, Math.min(lap.samples.length - 1, Math.round(pos * (lap.samples.length - 1))));
    return lap.samples[idx];
  };

  const currentPoints = useMemo(
    () => selectedLaps
      .map(lap => { const point = sampleAt(lap, effectivePosition); return point ? { point, color: colourOf(lap.meta.id) } : null; })
      .filter((p): p is { point: TelemetryPoint; color: string } => !!p),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedLaps, effectivePosition, selectionKey],
  );

  // ── Graph interaction: hover cursor, click to lock, wheel zoom, drag pan ────
  const positionFromX = useCallback((clientX: number): number => {
    const el = graphRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const width = rect.width - GRAPH_PAD.left - GRAPH_PAD.right;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left - GRAPH_PAD.left) / width));
    const [zs, ze] = zoomRange;
    return zs + ratio * Math.max(1e-9, ze - zs);
  }, [zoomRange]);

  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    wheelRef.current = (e: WheelEvent) => {
      e.preventDefault();
      const el = graphRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = rect.width - GRAPH_PAD.left - GRAPH_PAD.right;
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left - GRAPH_PAD.left) / width));
      const [zs, ze] = zoomRange;
      const span = ze - zs;
      const next = Math.max(0.005, Math.min(1, span * (e.deltaY < 0 ? 0.85 : 1.15)));
      const centre = zs + ratio * span;
      let start = centre - ratio * next;
      let end = start + next;
      if (start < 0) { start = 0; end = next; }
      if (end > 1) { end = 1; start = Math.max(0, 1 - next); }
      setZoomRange([start, end]);
    };
  }, [zoomRange]);

  useEffect(() => {
    const el = graphRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    hasDragged.current = false;
    dragStartX.current = e.clientX;
    dragStartZoom.current = [...zoomRange];
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const el = graphRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!isDragging.current) {
      const pos = positionFromX(e.clientX);
      hoverPositionRef.current = pos;
      setHoverPosition(pos);
      setHoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      return;
    }
    const dx = e.clientX - dragStartX.current;
    if (Math.abs(dx) > 4) hasDragged.current = true;
    const width = rect.width - GRAPH_PAD.left - GRAPH_PAD.right;
    const [ds, de] = dragStartZoom.current;
    const span = de - ds;
    const shift = -(dx / width) * span;
    let start = ds + shift;
    let end = de + shift;
    if (start < 0) { start = 0; end = span; }
    if (end > 1) { end = 1; start = Math.max(0, 1 - span); }
    setZoomRange([start, end]);
  };

  const onMouseUp = () => {
    if (isDragging.current && !hasDragged.current) {
      if (cursorLocked) setCursorLocked(false);
      else { setLockedPosition(hoverPositionRef.current); setCursorLocked(true); }
    }
    isDragging.current = false;
  };

  const onMouseLeave = () => {
    isDragging.current = false;
    if (!cursorLocked) setHoverPos(null);
  };

  const toggleChannel = (key: string) => {
    setVisibleChannels(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // ── Session actions ─────────────────────────────────────────────────────────
  const exportSession = async () => {
    if (!session) return;
    const res = await fetch(`${API_URL}/api/import/sessions/${session.id}/export?format=csv`);
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.name}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteSession = async () => {
    if (!session) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    const res = await apiFetch(`${API_URL}/api/import/sessions/${session.id}`, { method: 'DELETE' });
    if (res.ok) {
      removeImportedSession(session.id);
      navigate('/recorded');
    }
  };

  const renameLap = async (id: string, nickname: string) => {
    setLapRenaming(null);
    const value = nickname.trim();
    const current = laps.find(l => l.meta.id === id)?.meta.nickname ?? '';
    if (value === current) return;
    const res = await apiFetch(`${API_URL}/api/import/laps/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: value }),
    });
    if (res.ok) {
      setLaps(prev => prev.map(l => (l.meta.id === id ? { ...l, meta: { ...l.meta, nickname: value || null } } : l)));
    }
  };

  const playInLive = () => {
    if (!session) return;
    loadReplay(
      {
        id: session.id, name: session.name, trackId: session.track_id != null ? Number(session.track_id) : undefined,
        trackLength: session.track_length ?? 0, sessionType: session.session_type,
        field: field ?? undefined, grid,
      },
      laps
        .filter(l => !l.meta.ghost && (l.meta.lap_time_ms ?? 0) > 0 && l.samples.length > 1)
        .map(l => ({
          number: l.meta.lap_number,
          timeMs: l.meta.lap_time_ms ?? 0,
          sectorsMs: [l.meta.sector1_ms ?? null, l.meta.sector2_ms ?? null, l.meta.sector3_ms ?? null],
          nickname: l.meta.nickname ?? null,
          samples: l.samples,
          sessionTimeStart: typeof l.meta.extra_data?.session_time_start === 'number' ? l.meta.extra_data.session_time_start : null,
        })),
      replaySpeed,
    );
    navigate('/');
  };

  const renameSession = async (name: string) => {
    setRenaming(null);
    const trimmed = name.trim();
    if (!session || !trimmed || trimmed === session.name) return;
    const res = await apiFetch(`${API_URL}/api/import/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    });
    if (res.ok) {
      setSession({ ...session, name: trimmed });
      setImportedSessions(importedSessions.map(s => (s.id === session.id ? { ...s, name: trimmed } : s)));
    }
  };

  // The first lap picked is the reference: every other lap's delta is measured against it.
  const analysis = useMemo(() => {
    const ref = selectedLaps[0];
    if (!ref) return null;
    const corners = detectCorners(ref.samples);
    return {
      corners,
      perLap: selectedLaps.map(lap => ({
        id: lap.meta.id,
        delta: lap === ref ? null : deltaTrace(ref.samples, lap.samples),
        segments: segmentTimes(lap.samples, SEGMENTS),
        stats: lapStats(lap.samples),
        corners: corners.map(c => cornerMetrics(lap.samples, c)),
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLaps, selectionKey]);

  // Built once per selection, never per hover: the canvases compare these by
  // identity to decide whether the data layer needs redrawing.
  const graphLaps = useMemo(
    () => selectedLaps.map((l, i) => {
      const delta = analysis?.perLap[i]?.delta;
      const data = delta ? l.samples.map((s, k) => ({ ...s, delta_time: delta[k] })) : l.samples.map(s => ({ ...s, delta_time: 0 }));
      return { data, color: LAP_COLORS[i] ?? '#9AACBE' };
    }),
    [selectedLaps, analysis],
  );
  const tooltipLap = selectedLaps[0];
  const tooltipSample = tooltipLap ? sampleAt(tooltipLap, effectivePosition) : null;

  return (
    <div className="h-full flex gap-px p-px overflow-hidden bg-motorsport-border">
      <ImportModal />

      {/* ── Left: sessions above, laps of the chosen session below ── */}
      <div className="w-[300px] shrink-0 grid gap-px min-h-0" style={{ gridTemplateRows: session ? '2fr 3fr' : '1fr' }}>
        <div className="telemetry-panel flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center gap-2 px-3 h-10 border-b border-motorsport-border shrink-0">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search sessions"
              className="flex-1 min-w-0 bg-transparent text-[14px] text-motorsport-text placeholder:text-motorsport-dim focus:outline-none"
            />
            <button
              onClick={() => setImportModalOpen(true)}
              title="Import a CSV export"
              className="flex items-center gap-1.5 px-2 h-7 border border-motorsport-border text-[12px] font-bold tracking-wide uppercase text-motorsport-muted hover:text-motorsport-text hover:border-motorsport-border-strong transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              CSV
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {weeks.length === 0 && (
              <div className="px-3 py-6 text-[13px] text-motorsport-muted leading-relaxed">
                {importedSessions.length === 0
                  ? 'No sessions yet. Press REC on the live page while driving, or import a CSV.'
                  : 'Nothing matches that search.'}
              </div>
            )}
            {weeks.map(w => {
              const open = !collapsed.has(w.key);
              const anyPartial = w.sessions.some(sessionIsPartial);
              const editing = weekRenaming?.key === w.key;
              const title = weekNames[w.key] || `${w.track} · ${weekDate(w.start)}`;
              return (
                <div key={w.key} className="border-b border-motorsport-border">
                  {/* Week: click to fold, double-click to name */}
                  <div
                    role="button"
                    onClick={() => { if (!editing) toggleWeek(w.key); }}
                    onDoubleClick={() => setWeekRenaming({ key: w.key, value: weekNames[w.key] ?? '' })}
                    title="Click to fold, double-click to name this race week"
                    className="flex items-center gap-2 px-3 h-10 cursor-pointer bg-motorsport-dark hover:bg-motorsport-surface transition-colors"
                  >
                    <span className="text-motorsport-muted text-[11px] w-3 shrink-0">{open ? '▾' : '▸'}</span>
                    {editing ? (
                      <input
                        autoFocus
                        value={weekRenaming.value}
                        maxLength={80}
                        placeholder={`${w.track} · ${weekDate(w.start)}`}
                        onClick={e => e.stopPropagation()}
                        onChange={e => setWeekRenaming({ key: w.key, value: e.target.value })}
                        onBlur={e => renameWeek(w.key, e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') renameWeek(w.key, (e.target as HTMLInputElement).value);
                          if (e.key === 'Escape') setWeekRenaming(null);
                        }}
                        className="flex-1 min-w-0 bg-motorsport-panel border border-motorsport-border-strong px-2 h-7 text-[14px] font-bold text-motorsport-text focus:outline-none focus:border-motorsport-orange"
                      />
                    ) : (
                      <span className="flex-1 min-w-0 flex items-baseline gap-2">
                        <span className="text-[15px] font-bold tracking-wide text-motorsport-text truncate">{title}</span>
                        {weekNames[w.key] && <span className="text-[12px] text-motorsport-muted font-semibold truncate">{w.track}</span>}
                      </span>
                    )}
                    <span className="text-[12px] text-motorsport-muted font-semibold shrink-0">
                      {anyPartial && <span className="text-motorsport-yellow mr-2">partial</span>}
                      {w.sessions.length} session{w.sessions.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  {open && w.sessions.map(s => {
                    const active = s.id === sessionId;
                    const partial = sessionIsPartial(s);
                    return (
                      <button
                        key={s.id}
                        onClick={() => navigate(`/recorded/${s.id}`)}
                        className={`w-full text-left pl-7 pr-3 py-2 border-l-2 border-t border-t-motorsport-border/50 transition-colors ${
                          active ? 'border-l-motorsport-orange bg-motorsport-orange/[0.07]' : 'border-l-transparent hover:bg-motorsport-surface'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="px-1.5 h-5 inline-flex items-center border border-motorsport-border-strong text-[11px] font-bold tracking-wide uppercase text-motorsport-text shrink-0">
                              {s.session_type}
                            </span>
                            <span className="text-[14px] font-bold tracking-wide text-motorsport-text truncate">{s.name}</span>
                          </span>
                          <span className="font-telemetry text-[13px] tabular-nums text-motorsport-purple shrink-0">
                            {s.best_lap_time_ms ? formatTime(s.best_lap_time_ms) : ''}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-2 mt-1 text-[12px] text-motorsport-muted">
                          <span className="truncate">
                            {s.lap_count} lap{s.lap_count === 1 ? '' : 's'}
                            {partial && <span className="text-motorsport-yellow font-semibold ml-1.5">partial · {s.lap_count} of {Number(s.extra_data?.total_laps)}</span>}
                            <span className="mx-1.5">·</span>
                            {s.source === 'live' ? 'recorded' : 'csv'}
                          </span>
                          <span className="font-telemetry tabular-nums shrink-0">{sessionDate(s.created_at)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {session && (
          <div className="telemetry-panel flex flex-col min-h-0 overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 h-10 border-b border-motorsport-border shrink-0">
              {renaming != null ? (
                <input
                  autoFocus
                  value={renaming}
                  maxLength={80}
                  onChange={e => setRenaming(e.target.value)}
                  onBlur={e => renameSession(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') renameSession((e.target as HTMLInputElement).value);
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  className="flex-1 min-w-0 bg-motorsport-dark border border-motorsport-border-strong px-2 h-7 text-[14px] font-bold text-motorsport-text focus:outline-none focus:border-motorsport-orange"
                />
              ) : (
                <button
                  onClick={() => setRenaming(session.name)}
                  title="Click to rename this session"
                  className="text-[15px] font-bold tracking-wide text-motorsport-text truncate text-left hover:text-motorsport-orange transition-colors"
                >
                  {session.name}
                </button>
              )}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={playInLive}
                  disabled={loadingLaps || laps.length === 0}
                  title="Play this session on the live page"
                  className="flex items-center gap-1.5 px-2 h-7 border border-motorsport-purple/60 text-[12px] font-bold tracking-wide uppercase text-motorsport-purple hover:bg-motorsport-purple/15 disabled:opacity-40 transition-colors"
                >
                  <Play className="w-3.5 h-3.5" />
                  Play
                </button>
                <button onClick={exportSession} title="Export CSV" className="icon-btn"><Download className="w-4 h-4" /></button>
                <button
                  onClick={deleteSession}
                  onBlur={() => setConfirmDelete(false)}
                  title={confirmDelete ? 'Click again to delete' : 'Delete session'}
                  className={`icon-btn ${confirmDelete ? 'text-motorsport-red hover:text-motorsport-red' : ''}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {loadingLaps && <div className="px-3 py-4 text-[13px] text-motorsport-muted">Loading laps</div>}
              {!loadingLaps && laps.length === 0 && (
                <div className="px-3 py-4 text-[13px] text-motorsport-muted">No completed laps in this session.</div>
              )}
              {laps.map(({ meta }) => {
                const on = selected.includes(meta.id);
                const colour = on ? colourOf(meta.id) : undefined;
                const isBest = !meta.ghost && session.best_lap_time_ms != null && meta.lap_time_ms === session.best_lap_time_ms;
                const rival = !!meta.ghost && ghostName.get(meta.id) === 'Rival';
                const editing = lapRenaming?.id === meta.id;
                return (
                  <div
                    key={meta.id}
                    role="button"
                    onClick={() => { if (!editing) toggleLap(meta.id); }}
                    onDoubleClick={() => setLapRenaming({ id: meta.id, value: meta.nickname ?? '' })}
                    title="Click to compare, double-click to name this lap"
                    className={`w-full flex items-center gap-3 px-3 h-12 border-l-2 border-b border-b-motorsport-border/60 text-left cursor-pointer transition-colors ${
                      on ? 'bg-motorsport-surface' : 'hover:bg-motorsport-surface/60'
                    }`}
                    style={{ borderLeftColor: colour ?? 'transparent' }}
                  >
                    <span className="font-telemetry text-[13px] tabular-nums w-6 shrink-0" style={{ color: rival ? RIVAL_BLUE : '#9AACBE' }}>
                      {meta.ghost ? (rival ? 'R' : 'G') : meta.lap_number}
                    </span>
                    <span className="flex flex-col gap-1 min-w-0">
                      <span
                        className={`font-telemetry text-[16px] font-semibold tabular-nums leading-none ${meta.valid ? '' : 'line-through'}`}
                        style={{ color: isBest ? PURPLE : meta.valid ? '#E8EEF4' : '#9AACBE' }}
                      >
                        {lapTime(meta.lap_time_ms)}
                      </span>
                      <span className="font-telemetry text-[12px] tabular-nums leading-none text-motorsport-muted">
                        {[meta.sector1_ms, meta.sector2_ms, meta.sector3_ms].map(sectorTime).join('  ')}
                      </span>
                    </span>
                    {editing ? (
                      <input
                        autoFocus
                        value={lapRenaming.value}
                        maxLength={40}
                        placeholder="name this lap"
                        onClick={e => e.stopPropagation()}
                        onChange={e => setLapRenaming({ id: meta.id, value: e.target.value })}
                        onBlur={e => renameLap(meta.id, e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') renameLap(meta.id, (e.target as HTMLInputElement).value);
                          if (e.key === 'Escape') setLapRenaming(null);
                        }}
                        className="ml-auto w-[120px] bg-motorsport-dark border border-motorsport-border-strong px-2 h-7 text-[12px] text-motorsport-text focus:outline-none focus:border-motorsport-orange"
                      />
                    ) : (
                      <span className="ml-auto flex items-center gap-1.5 text-[12px] text-motorsport-muted shrink-0 min-w-0">
                        {meta.nickname && <span className="font-semibold text-motorsport-text truncate max-w-[110px]">{meta.nickname}</span>}
                        {meta.ghost && <span className="font-semibold" style={{ color: rival ? RIVAL_BLUE : '#9AACBE' }}>{lapName(meta)}</span>}
                        {!meta.valid && <span className="text-motorsport-red font-semibold">invalid</span>}
                        {meta.partial && <span>partial</span>}
                        {meta.pit_lap && <span>pit</span>}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Centre: trace over distance, then the track ── */}
      <div className="flex-1 min-w-0 grid gap-px" style={{ gridTemplateRows: '3fr auto 2fr' }}>
        <div
          ref={graphRef}
          className="telemetry-panel relative min-h-0 overflow-hidden cursor-crosshair"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
        >
          {selectedLaps.length > 0 ? (
            <TelemetryGraphCanvas
              laps={graphLaps}
              visibleChannels={visibleChannels}
              zoomRange={zoomRange}
              effectivePosition={effectivePosition}
              cursorLocked={cursorLocked}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-[14px] font-semibold text-motorsport-muted">
              {session ? 'Pick a lap on the left' : 'Pick a session on the left'}
            </div>
          )}
          {tooltipSample && hoverPos && selectedLaps.length > 0 && (
            <GraphTooltip
              x={hoverPos.x}
              y={hoverPos.y}
              containerRef={graphRef}
              distance={tooltipSample.cumulative_distance ?? 0}
              visibleChannels={visibleChannels}
              rows={selectedLaps.map(lap => ({ lap: lapShort(lap.meta), color: colourOf(lap.meta.id), sample: sampleAt(lap, effectivePosition) }))}
            />
          )}
        </div>

        <div className="telemetry-panel px-2 py-1.5">
          {selectedLaps.length > 0 && <ZoomRangeBar total={1} zoomRange={zoomRange} onZoomChange={setZoomRange} />}
        </div>

        <div className="telemetry-panel min-h-0 p-2">
          <TrackMapViewer laps={graphLaps} currentPoints={currentPoints} />
        </div>
      </div>

      {/* ── Right: the selected laps side by side, then where the time goes ── */}
      <div className="w-[360px] shrink-0 telemetry-panel flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-motorsport-border">
          {selectedLaps.length === 0 && (
            <div className="px-3 py-6 text-[13px] text-motorsport-muted leading-relaxed">
              Select up to {MAX_SELECTED} laps to overlay them. The first lap picked is the reference every other lap is measured against.
            </div>
          )}

          {/* Lap cards: time, delta to the fastest, and how the lap was driven */}
          {selectedLaps.map(({ meta }, i) => {
            const ms = meta.lap_time_ms ?? 0;
            const delta = fastestSelectedMs != null && ms > 0 ? ms - fastestSelectedMs : null;
            const stats = analysis?.perLap[i]?.stats;
            return (
              <div key={meta.id} className="px-3 py-3 flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <span className="flex items-baseline gap-2">
                    <span className="w-2.5 h-2.5 inline-block translate-y-px" style={{ backgroundColor: colourOf(meta.id) }} />
                    <span className="text-[14px] font-bold tracking-wide" style={{ color: meta.ghost && ghostName.get(meta.id) === 'Rival' ? RIVAL_BLUE : '#E8EEF4' }}>{lapName(meta)}</span>
                    {i === 0 && <span className="text-[12px] text-motorsport-muted font-semibold">reference</span>}
                  </span>
                  <span className="flex items-baseline gap-3">
                    <span className="font-telemetry text-[13px] tabular-nums leading-none" style={{ color: delta == null ? '#5F7183' : delta === 0 ? PURPLE : '#FF2044' }}>
                      {delta == null ? '' : delta === 0 ? 'fastest' : `+${(delta / 1000).toFixed(3)}`}
                    </span>
                    <span className={`font-telemetry text-[20px] font-bold tabular-nums leading-none ${meta.valid ? 'text-motorsport-text' : 'text-motorsport-muted line-through'}`}>
                      {lapTime(meta.lap_time_ms)}
                    </span>
                  </span>
                </div>
                {stats && (
                  <div className="grid grid-cols-4 gap-2">
                    <Stat label="Full throttle" value={`${stats.fullThrottlePct.toFixed(0)}%`} />
                    <Stat label="Braking" value={`${stats.brakingPct.toFixed(0)}%`} />
                    <Stat label="Coasting" value={`${stats.coastingPct.toFixed(0)}%`} />
                    <Stat label="Top" value={meta.max_speed > 0 ? meta.max_speed.toFixed(0) : '--'} />
                  </div>
                )}
              </div>
            );
          })}

          {/* Segments: the lap in twelve equal slices, fastest per slice in purple */}
          {analysis && (
            <div className="px-3 py-3 flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <span className="eng-label">Segments</span>
                <span className="text-[12px] text-motorsport-muted font-semibold">seconds, fastest in purple</span>
              </div>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left font-telemetry text-[11px] font-semibold text-motorsport-muted pb-1 w-6">#</th>
                    {selectedLaps.map(l => (
                      <th key={l.meta.id} className="text-right font-telemetry text-[11px] font-semibold pb-1" style={{ color: colourOf(l.meta.id) }}>{lapShort(l.meta)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: SEGMENTS }, (_, k) => {
                    const times = analysis.perLap.map(p => p.segments[k]);
                    const best = Math.min(...times.filter((t): t is number => t != null));
                    return (
                      <tr key={k} className="border-t border-motorsport-border/50">
                        <td className="font-telemetry text-[12px] tabular-nums text-motorsport-muted py-[3px]">{k + 1}</td>
                        {times.map((t, i) => (
                          <td key={i} className="text-right font-telemetry text-[13px] tabular-nums py-[3px]" style={{ color: t == null ? '#5F7183' : t === best ? PURPLE : '#E8EEF4' }}>
                            {t == null ? '--' : t.toFixed(2)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {selectedLaps.length >= 2 && (() => {
                    const ideal = Array.from({ length: SEGMENTS }, (_, k) => {
                      const ts = analysis.perLap.map(p => p.segments[k]).filter((t): t is number => t != null);
                      return ts.length ? Math.min(...ts) : null;
                    });
                    const sum = ideal.every(t => t != null) ? ideal.reduce((a, t) => a + (t ?? 0), 0) : null;
                    return (
                      <tr className="border-t border-motorsport-border-strong">
                        <td className="text-[12px] font-semibold text-motorsport-muted py-1.5" colSpan={selectedLaps.length}>Theoretical best</td>
                        <td className="text-right font-telemetry text-[13px] font-semibold tabular-nums py-1.5" style={{ color: PURPLE }}>
                          {sum == null ? '--' : formatTime(Math.round(sum * 1000))}
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          )}

          {/* Results: every car's best lap in this session, when the grid was recorded */}
          {grid.length > 0 && field && (() => {
            const byCar = new Map<number, { best: GridLap | null; count: number }>();
            for (const g of grid) {
              const row = byCar.get(g.car_index) ?? { best: null, count: 0 };
              row.count++;
              if (g.valid && g.lap_time_ms > 0 && (!row.best || g.lap_time_ms < row.best.lap_time_ms)) row.best = g;
              byCar.set(g.car_index, row);
            }
            const rows = [...byCar.entries()]
              .map(([carIndex, r]) => ({ carIndex, ...r, who: field.participants.find(p => p.index === carIndex) }))
              .sort((a, b) => (a.best?.lap_time_ms ?? Infinity) - (b.best?.lap_time_ms ?? Infinity));
            const fastest = rows[0]?.best?.lap_time_ms ?? null;
            return (
              <div className="px-3 py-3 flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <span className="eng-label">Results</span>
                  <span className="text-[12px] text-motorsport-muted font-semibold">best lap per driver</span>
                </div>
                <table className="w-full border-collapse">
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.carIndex} className="border-t border-motorsport-border/50">
                        <td className="font-telemetry text-[12px] tabular-nums text-motorsport-muted py-[3px] w-6">{i + 1}</td>
                        <td className="py-[3px] w-10"><DriverTag name={r.who?.name ?? `Car ${r.carIndex + 1}`} teamId={r.who?.team_id} size="sm" /></td>
                        <td className={`text-[13px] font-bold tracking-wide py-[3px] truncate ${r.carIndex === field.playerCarIndex ? 'text-motorsport-orange' : 'text-motorsport-text'}`}>
                          {r.who?.name ?? `Car ${r.carIndex + 1}`}
                        </td>
                        <td className="text-right font-telemetry text-[13px] tabular-nums py-[3px]" style={{ color: r.best && r.best.lap_time_ms === fastest ? PURPLE : '#E8EEF4' }}>
                          {r.best ? formatTime(r.best.lap_time_ms) : '--:--.---'}
                        </td>
                        <td className="text-right font-telemetry text-[12px] tabular-nums text-motorsport-muted py-[3px] w-8">{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}

          {/* Corners on the reference lap: minimum speed and braking point per lap */}
          {analysis && analysis.corners.length > 0 && (
            <div className="px-3 py-3 flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <span className="eng-label">Corners</span>
                <span className="text-[12px] text-motorsport-muted font-semibold">min km/h · brake point m</span>
              </div>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left font-telemetry text-[11px] font-semibold text-motorsport-muted pb-1">at</th>
                    {selectedLaps.map(l => (
                      <th key={l.meta.id} className="text-right font-telemetry text-[11px] font-semibold pb-1" style={{ color: colourOf(l.meta.id) }}>{lapShort(l.meta)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {analysis.corners.map((c, k) => {
                    const rows = analysis.perLap.map(p => p.corners[k]);
                    const fastest = Math.max(...rows.map(r => r.minSpeed));
                    const refBrake = rows[0]?.brakeOn ?? null;
                    return (
                      <tr key={k} className="border-t border-motorsport-border/50 align-top">
                        <td className="font-telemetry text-[12px] tabular-nums text-motorsport-muted py-[3px] whitespace-nowrap">
                          {c.distance >= 1000 ? `${(c.distance / 1000).toFixed(2)} km` : `${Math.round(c.distance)} m`}
                        </td>
                        {rows.map((r, i) => {
                          const brakeDiff = r.brakeOn != null && refBrake != null && i > 0 ? r.brakeOn - refBrake : null;
                          return (
                            <td key={i} className="text-right py-[3px]">
                              <span className="font-telemetry text-[13px] tabular-nums block" style={{ color: r.minSpeed === fastest ? PURPLE : '#E8EEF4' }}>
                                {r.minSpeed.toFixed(0)}
                              </span>
                              <span className="font-telemetry text-[11px] tabular-nums block" style={{ color: brakeDiff == null ? '#5F7183' : brakeDiff > 0 ? '#00E85A' : '#FF2044' }}>
                                {r.brakeOn == null ? '--' : i === 0 ? `${Math.round(r.brakeOn)}` : `${brakeDiff! >= 0 ? '+' : ''}${Math.round(brakeDiff!)}`}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <span className="text-[12px] text-motorsport-muted leading-snug">
                Brake point is metres from the start line on the reference lap; other laps show how much later (+) or earlier (−) they braked.
              </span>
            </div>
          )}
        </div>

        {/* Channels drawn on the trace */}
        <div className="shrink-0 border-t border-motorsport-border p-3 flex flex-wrap gap-1.5">
          {CHANNELS.map(ch => {
            const on = visibleChannels.has(ch.key as string);
            return (
              <button
                key={ch.key as string}
                onClick={() => toggleChannel(ch.key as string)}
                className="px-2 h-7 border text-[12px] font-bold tracking-wide uppercase transition-colors"
                style={{
                  borderColor: on ? ch.color : '#2A3745',
                  color:       on ? ch.color : '#9AACBE',
                  backgroundColor: on ? `${ch.color}1A` : 'transparent',
                }}
              >
                {ch.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="eng-label truncate">{label}</span>
      <span className="font-telemetry text-[14px] tabular-nums leading-none text-motorsport-text">{value}</span>
    </div>
  );
}

// ── Hover readout for the trace ───────────────────────────────────────────────

interface TooltipRow { lap: string; color: string; sample: TelemetryPoint | null }

function GraphTooltip({
  x, y, containerRef, distance, visibleChannels, rows,
}: {
  x: number; y: number; containerRef: React.RefObject<HTMLDivElement | null>;
  distance: number; visibleChannels: Set<string>; rows: TooltipRow[];
}) {
  const W = 200;
  const OFFSET = 14;
  const channels = CHANNELS.filter(c => visibleChannels.has(c.key as string));
  const estH = 40 + channels.length * (18 + rows.length * 16);
  const cw = containerRef.current?.clientWidth ?? 600;
  const chh = containerRef.current?.clientHeight ?? 400;
  const left = x + OFFSET + W > cw ? x - OFFSET - W : x + OFFSET;
  const top = Math.max(8, Math.min(chh - estH - 8, y - estH / 2));
  const distLabel = distance >= 1000 ? `${(distance / 1000).toFixed(2)} km` : `${Math.round(distance)} m`;

  return (
    <div
      className="absolute pointer-events-none z-20 border border-motorsport-border-strong bg-motorsport-panel/95 shadow-panel-lg px-3 py-2.5"
      style={{ left, top, width: W }}
    >
      <div className="font-telemetry text-[12px] tabular-nums text-motorsport-muted pb-1.5 mb-1.5 border-b border-motorsport-border">{distLabel}</div>
      <div className="flex flex-col gap-2">
        {channels.map(ch => (
          <div key={ch.key as string} className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold" style={{ color: ch.color }}>{ch.label}</span>
            {rows.map(r => {
              const raw = r.sample ? (r.sample[ch.key] as number) : null;
              const value = raw == null ? null : ch.transform ? ch.transform(raw) : raw;
              return (
                <div key={r.lap} className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] font-semibold" style={{ color: r.color }}>{r.lap}</span>
                  <span className="font-telemetry text-[13px] tabular-nums text-motorsport-text">
                    {value == null ? '--' : `${value.toFixed(ch.decimals)}${ch.unit}`}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
