import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Download, Trash2, Upload } from 'lucide-react';
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

const SEGMENTS = 12;
const PURPLE = '#B388FF';

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

export default function Recorded() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const importedSessions   = useTelemetryStore(s => s.importedSessions);
  const setImportedSessions = useTelemetryStore(s => s.setImportedSessions);
  const removeImportedSession = useTelemetryStore(s => s.removeImportedSession);
  const setImportModalOpen = useTelemetryStore(s => s.setImportModalOpen);
  const trackAliases = useTelemetryStore(s => s.trackAliases);
  const trackLabel = (track: string, trackId?: string) => (trackId && trackAliases[trackId]) || track;

  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [session, setSession] = useState<(ImportedSession & { laps: ImportedLap[] }) | null>(null);
  const [laps, setLaps] = useState<LoadedLap[]>([]);
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

  const sessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? importedSessions.filter(s => `${s.name} ${s.track} ${s.session_type}`.toLowerCase().includes(q))
      : importedSessions;
    return [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [importedSessions, query]);

  // ── Selected session and its laps ───────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) { setSession(null); setLaps([]); setSelected([]); return; }
    let cancelled = false;
    const load = async () => {
      setLoadingLaps(true);
      try {
        const res = await fetch(`${API_URL}/api/import/sessions/${sessionId}`);
        if (!res.ok) { if (!cancelled) setSession(null); return; }
        const data = await res.json() as ImportedSession & { laps: ImportedLap[] };
        const loaded = await Promise.all(data.laps.map(async (meta): Promise<LoadedLap> => {
          const r = await fetch(`${API_URL}/api/import/laps/${meta.id}/resampled`);
          if (r.ok) return { meta, samples: (await r.json()).samples as TelemetryPoint[] };
          const raw = await fetch(`${API_URL}/api/import/laps/${meta.id}/telemetry`);
          return { meta, samples: raw.ok ? normalizeImportedSamples((await raw.json()).samples) : [] };
        }));
        if (cancelled) return;
        const ordered = [...loaded].sort((a, b) => a.meta.lap_number - b.meta.lap_number);
        setSession(data);
        setLaps(ordered);
        // Start on the fastest clean lap so the page opens with something to read
        const fastest = ordered
          .filter(l => l.meta.valid && !l.meta.partial && (l.meta.lap_time_ms ?? 0) > 0)
          .sort((a, b) => (a.meta.lap_time_ms ?? 0) - (b.meta.lap_time_ms ?? 0))[0] ?? ordered[0];
        setSelected(fastest ? [fastest.meta.id] : []);
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

  const graphLaps = selectedLaps.map((l, i) => {
    const delta = analysis?.perLap[i]?.delta;
    const data = delta ? l.samples.map((s, k) => ({ ...s, delta_time: delta[k] })) : l.samples.map(s => ({ ...s, delta_time: 0 }));
    return { data, color: colourOf(l.meta.id) };
  });
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
            {sessions.length === 0 && (
              <div className="px-3 py-6 text-[13px] text-motorsport-muted leading-relaxed">
                {importedSessions.length === 0
                  ? 'No sessions yet. Press REC on the live page while driving, or import a CSV.'
                  : 'Nothing matches that search.'}
              </div>
            )}
            {sessions.map(s => {
              const active = s.id === sessionId;
              return (
                <button
                  key={s.id}
                  onClick={() => navigate(`/recorded/${s.id}`)}
                  className={`w-full text-left px-3 py-2.5 border-l-2 border-b border-b-motorsport-border/60 transition-colors ${
                    active ? 'border-l-motorsport-orange bg-motorsport-orange/[0.07]' : 'border-l-transparent hover:bg-motorsport-surface'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[15px] font-bold tracking-wide text-motorsport-text truncate">{s.name || trackLabel(s.track, s.track_id)}</span>
                    <span className="font-telemetry text-[13px] tabular-nums text-motorsport-purple shrink-0">
                      {s.best_lap_time_ms ? formatTime(s.best_lap_time_ms) : ''}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 mt-1 text-[12px] text-motorsport-muted">
                    <span className="truncate">
                      <span className="font-semibold">{trackLabel(s.track, s.track_id)}</span>
                      <span className="mx-1.5">·</span>
                      <span className="font-semibold uppercase tracking-wide">{s.session_type}</span>
                      <span className="mx-1.5">·</span>
                      {s.source === 'live' ? 'recorded' : 'csv'}
                      <span className="mx-1.5">·</span>
                      {s.lap_count} lap{s.lap_count === 1 ? '' : 's'}
                    </span>
                    <span className="font-telemetry tabular-nums shrink-0">{sessionDate(s.created_at)}</span>
                  </div>
                </button>
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
                const isBest = session.best_lap_time_ms != null && meta.lap_time_ms === session.best_lap_time_ms;
                return (
                  <button
                    key={meta.id}
                    onClick={() => toggleLap(meta.id)}
                    className={`w-full flex items-center gap-3 px-3 h-12 border-l-2 border-b border-b-motorsport-border/60 text-left transition-colors ${
                      on ? 'bg-motorsport-surface' : 'hover:bg-motorsport-surface/60'
                    }`}
                    style={{ borderLeftColor: colour ?? 'transparent' }}
                  >
                    <span className="font-telemetry text-[13px] tabular-nums text-motorsport-muted w-6 shrink-0">{meta.lap_number}</span>
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
                    <span className="ml-auto flex items-center gap-1.5 text-[12px] text-motorsport-muted shrink-0">
                      {!meta.valid && <span className="text-motorsport-red font-semibold">invalid</span>}
                      {meta.partial && <span>partial</span>}
                      {meta.pit_lap && <span>pit</span>}
                    </span>
                  </button>
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
              rows={selectedLaps.map(lap => ({ lap: lap.meta.lap_number, color: colourOf(lap.meta.id), sample: sampleAt(lap, effectivePosition) }))}
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
                    <span className="text-[14px] font-bold tracking-wide text-motorsport-text">Lap {meta.lap_number}</span>
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
                      <th key={l.meta.id} className="text-right font-telemetry text-[11px] font-semibold pb-1" style={{ color: colourOf(l.meta.id) }}>L{l.meta.lap_number}</th>
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
                      <th key={l.meta.id} className="text-right font-telemetry text-[11px] font-semibold pb-1" style={{ color: colourOf(l.meta.id) }}>L{l.meta.lap_number}</th>
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

interface TooltipRow { lap: number; color: string; sample: TelemetryPoint | null }

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
                  <span className="text-[12px] font-semibold" style={{ color: r.color }}>L{r.lap}</span>
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
