import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTelemetryStore } from '@/stores/telemetryStore';
import {
  ArrowLeft, MapPin, Layers, Download, Activity,
  BarChart3, Map as MapIcon, SlidersHorizontal, Lock, Unlock
} from 'lucide-react';
import type { TelemetrySample, ImportedLap, ImportedSession } from '@/types/telemetry';
import TelemetryGraphCanvas, { CHANNELS, DEFAULT_VISIBLE } from '@/components/TelemetryGraphCanvas';
import TrackMapViewer from '@/components/TrackMapViewer';
import { normalizeImportedSamples, normalizeLiveFrames, type TelemetryPoint } from '@/utils/telemetryAdapter';

const API_URL = import.meta.env.VITE_API_URL || '';

const LAP_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4',
];

interface UnifiedLap {
  id: string;
  lapNumber: number;
  lapTimeMs?: number;
  valid: boolean;
  maxSpeed: number;
  sampleCount: number;
  primaryPhase?: string;
  isTimedLap?: boolean;
  samples: TelemetryPoint[];
  color: string;
}

interface UnifiedSession {
  id: string;
  name: string;
  track: string;
  lapCount: number;
  sampleCount: number;
  source: 'imported' | 'live';
}

export default function SessionViewer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { setSelectedImportedSession } = useTelemetryStore();

  const [session, setSession] = useState<UnifiedSession | null>(null);
  const [laps, setLaps] = useState<UnifiedLap[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLaps, setSelectedLaps] = useState<Set<number>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentLapIndex, setCurrentLapIndex] = useState(0);

  const [viewMode, setViewMode] = useState<'graph' | 'track'>('graph');
  const [visibleChannels, setVisibleChannels] = useState<Set<string>>(new Set(DEFAULT_VISIBLE));
  const [filterOpen, setFilterOpen] = useState(false);

  const [cursorLocked, setCursorLocked] = useState(false);
  const [hoverIndex, setHoverIndex] = useState(0);
  const hoverIndexRef = useRef(0);

  const [zoomRange, setZoomRange] = useState<[number, number]>([0, 1]);
  const isDragging = useRef(false);
  const hasDragged = useRef(false);
  const dragStartX = useRef(0);
  const dragStartZoom = useRef<[number, number]>([0, 1]);

  const graphContainerRef = useRef<HTMLDivElement>(null);

  // Load session data (imported first, then live fallback)
  useEffect(() => {
    if (!sessionId) return;

    const load = async () => {
      try {
        setLoading(true);

        // Try imported first
        const importedRes = await fetch(`${API_URL}/api/import/sessions/${sessionId}`);
        if (importedRes.ok) {
          const data = await importedRes.json();
          await loadImported(data);
          return;
        }

        // Fallback to live session
        const liveRes = await fetch(`${API_URL}/api/sessions/${sessionId}`);
        if (liveRes.ok) {
          const data = await liveRes.json();
          await loadLive(data);
          return;
        }

        setSession(null);
      } catch (err) {
        console.error('Failed to load session:', err);
        setSession(null);
      } finally {
        setLoading(false);
      }
    };

    const loadImported = async (data: ImportedSession & { laps: ImportedLap[] }) => {
      setSelectedImportedSession(data);

      const lapData = await Promise.all(
        data.laps.map(async (lap, i) => {
          const telemRes = await fetch(`${API_URL}/api/import/laps/${lap.id}/telemetry`);
          let samples: TelemetrySample[] = [];
          if (telemRes.ok) {
            const telem = await telemRes.json();
            samples = telem.samples;
          }
          return {
            id: lap.id,
            lapNumber: lap.lap_number,
            lapTimeMs: lap.lap_time_ms,
            valid: lap.valid,
            maxSpeed: lap.max_speed,
            sampleCount: samples.length,
            samples: normalizeImportedSamples(samples),
            color: LAP_COLORS[i % LAP_COLORS.length],
          };
        })
      );

      setSession({
        id: data.id,
        name: data.name,
        track: data.track,
        lapCount: data.lap_count,
        sampleCount: data.sample_count,
        source: 'imported',
      });
      setLaps(lapData);

      const firstValid = lapData.findIndex(l => l.valid);
      if (firstValid >= 0) {
        setSelectedLaps(new Set([firstValid]));
        setCurrentLapIndex(firstValid);
      }
    };

    const loadLive = (data: any) => {
      // Group frames by lap number
      const framesByLap: Record<number, any[]> = {};
      (data.frames || []).forEach((frame: any) => {
        const lapNum = frame.lap?.current_lap_num ?? 0;
        if (!framesByLap[lapNum]) framesByLap[lapNum] = [];
        framesByLap[lapNum].push(frame);
      });

      const lapNumbers = Object.keys(framesByLap)
        .map(Number)
        .filter(n => n > 0)
        .sort((a, b) => a - b);

      const lapData: UnifiedLap[] = [];
      lapNumbers.forEach((lapNum, i) => {
        const frames = framesByLap[lapNum];
        const meta = data.laps?.[String(lapNum)] || {};
        lapData.push({
          id: `lap_${lapNum}`,
          lapNumber: lapNum,
          lapTimeMs: meta.best_lap_time,
          valid: meta.valid ?? true,
          maxSpeed: 0,
          sampleCount: frames.length,
          primaryPhase: meta.primary_phase,
          isTimedLap: meta.is_timed_lap,
          samples: normalizeLiveFrames(frames),
          color: LAP_COLORS[i % LAP_COLORS.length],
        });
      });

      setSession({
        id: data.session_id,
        name: data.session_id,
        track: data.track,
        lapCount: lapData.length,
        sampleCount: data.frames?.length || 0,
        source: 'live',
      });
      setLaps(lapData);

      if (lapData.length > 0) {
        setSelectedLaps(new Set([0]));
        setCurrentLapIndex(0);
      }
    };

    load();
  }, [sessionId, setSelectedImportedSession]);

  // Selected lap data for graph/map
  const selectedLapData = useMemo(() => {
    const indices = Array.from(selectedLaps);
    if (indices.length === 0 && laps.length > 0) return [laps[0]];
    return indices.map(i => laps[i]).filter(Boolean);
  }, [selectedLaps, laps]);

  const effectiveIndex = cursorLocked ? currentIndex : hoverIndex;

  const currentSample = useMemo(() => {
    if (selectedLapData.length === 0) return null;
    const lap = selectedLapData[currentLapIndex % selectedLapData.length];
    if (!lap || !lap.samples[effectiveIndex]) return null;
    return lap.samples[effectiveIndex];
  }, [selectedLapData, currentLapIndex, effectiveIndex]);

  // Reset zoom when selected laps change
  useEffect(() => {
    const lap = selectedLapData[0];
    if (lap && lap.samples.length > 1) {
      setZoomRange([0, lap.samples.length - 1]);
      setCurrentIndex(0);
      setHoverIndex(0);
      hoverIndexRef.current = 0;
      setCursorLocked(false);
    }
  }, [selectedLapData.map(l => l.id).join(',')]);

  const getSampleIndexFromX = useCallback((clientX: number): number => {
    const container = graphContainerRef.current;
    if (!container || selectedLapData.length === 0) return 0;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const padding = { left: 50, right: 60 };
    const graphWidth = rect.width - padding.left - padding.right;
    const [zStart, zEnd] = zoomRange;
    const zoomSamples = Math.max(1, zEnd - zStart);
    const ratio = Math.max(0, Math.min(1, (x - padding.left) / graphWidth));
    return Math.floor(zStart + ratio * zoomSamples);
  }, [selectedLapData, zoomRange]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const lap = selectedLapData[0];
    if (!lap || lap.samples.length < 2) return;

    const container = graphContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const padding = { left: 50, right: 60 };
    const graphWidth = rect.width - padding.left - padding.right;
    const mouseX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, (mouseX - padding.left) / graphWidth));

    const [zStart, zEnd] = zoomRange;
    const zoomSamples = zEnd - zStart;
    const total = lap.samples.length - 1;

    const factor = e.deltaY < 0 ? 0.85 : 1.15;
    let newZoom = zoomSamples * factor;
    newZoom = Math.max(20, Math.min(total, newZoom));

    const centerSample = zStart + ratio * zoomSamples;
    let newStart = centerSample - ratio * newZoom;
    let newEnd = newStart + newZoom;

    if (newStart < 0) { newStart = 0; newEnd = newZoom; }
    if (newEnd > total) { newEnd = total; newStart = Math.max(0, total - newZoom); }

    setZoomRange([newStart, newEnd]);
  }, [selectedLapData, zoomRange]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    hasDragged.current = false;
    dragStartX.current = e.clientX;
    dragStartZoom.current = [...zoomRange];
  }, [zoomRange]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) {
      const idx = getSampleIndexFromX(e.clientX);
      const lap = selectedLapData[0];
      const clamped = lap ? Math.max(0, Math.min(lap.samples.length - 1, idx)) : idx;
      hoverIndexRef.current = clamped;
      setHoverIndex(clamped);
      return;
    }

    const dx = Math.abs(e.clientX - dragStartX.current);
    if (dx > 4) hasDragged.current = true;

    const container = graphContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const padding = { left: 50, right: 60 };
    const graphWidth = rect.width - padding.left - padding.right;
    const lap = selectedLapData[0];
    if (!lap) return;

    const [ds, de] = dragStartZoom.current;
    const zoomSamples = de - ds;
    const total = lap.samples.length - 1;
    const sampleShift = -(dx * Math.sign(e.clientX - dragStartX.current) / graphWidth) * zoomSamples;

    let newStart = ds + sampleShift;
    let newEnd = de + sampleShift;
    if (newStart < 0) { newStart = 0; newEnd = zoomSamples; }
    if (newEnd > total) { newEnd = total; newStart = Math.max(0, total - zoomSamples); }

    setZoomRange([newStart, newEnd]);
  }, [selectedLapData, getSampleIndexFromX]);

  const handleMouseUp = useCallback(() => {
    if (isDragging.current && !hasDragged.current) {
      if (cursorLocked) {
        setCursorLocked(false);
      } else {
        setCurrentIndex(hoverIndexRef.current);
        setCursorLocked(true);
      }
    }
    isDragging.current = false;
  }, [cursorLocked]);

  const toggleChannel = (key: string) => {
    setVisibleChannels(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-motorsport-muted text-sm">Loading session...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-motorsport-muted text-sm">Session not found</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-3 gap-3 overflow-hidden">
      {/* Header */}
      <div className="telemetry-panel shrink-0 overflow-hidden">
        <div className="panel-header justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/sessions')}
              className="icon-btn"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h1 className="text-[13px] font-semibold text-motorsport-text">{session.name}</h1>
              <p className="text-[11px] text-motorsport-muted mt-0.5">
                {session.track} · {session.lapCount} lap{session.lapCount !== 1 ? 's' : ''} · {session.sampleCount.toLocaleString()} samples
              </p>
            </div>
          </div>
          {session.source === 'imported' && (
            <button
              onClick={async () => {
                const res = await fetch(`${API_URL}/api/import/sessions/${sessionId}/export?format=csv`);
                if (res.ok) {
                  const blob = await res.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${session.name}.csv`;
                  a.click();
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-motorsport-surface border border-motorsport-border rounded text-[11px] hover:bg-motorsport-surface-2 transition-colors"
            >
              <Download className="w-3 h-3" />
              Export
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex gap-3 min-h-0">
        {/* Left Panel - Lap Selector */}
        <div className="w-52 telemetry-panel flex flex-col shrink-0 overflow-hidden">
          <div className="panel-header">
            <Layers className="w-3.5 h-3.5 text-motorsport-orange" />
            <span className="text-[10px] font-semibold tracking-widest uppercase text-motorsport-text">Laps</span>
          </div>
          <div className="flex-1 overflow-auto p-1.5 space-y-1">
            {laps.map((lapData, idx) => (
              <button
                key={lapData.id}
                onClick={() => {
                  const newSet = new Set(selectedLaps);
                  if (newSet.has(idx)) newSet.delete(idx);
                  else newSet.add(idx);
                  setSelectedLaps(newSet);
                  setCurrentLapIndex(idx);
                  setCurrentIndex(0);
                  setHoverIndex(0);
                  hoverIndexRef.current = 0;
                  setCursorLocked(false);
                }}
                className={`w-full text-left px-2.5 py-2 rounded text-xs transition-all ${
                  selectedLaps.has(idx)
                    ? 'bg-motorsport-surface border border-motorsport-border-strong'
                    : 'hover:bg-motorsport-surface/40 border border-transparent'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: lapData.color }}
                    />
                    <span className="font-semibold text-[12px] text-motorsport-text">
                      Lap {lapData.lapNumber}
                    </span>
                  </div>
                  {lapData.valid ? (
                    <span className="text-[9px] text-motorsport-green font-medium tracking-wider">VALID</span>
                  ) : (
                    <span className="text-[9px] text-motorsport-red font-medium tracking-wider">INVALID</span>
                  )}
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-telemetry text-motorsport-text">
                    {lapData.lapTimeMs ? formatLapTime(lapData.lapTimeMs) : '—:——'}
                  </span>
                  <span className="text-motorsport-dim">{lapData.sampleCount} pts</span>
                </div>
                {lapData.primaryPhase && (
                  <div className="text-[10px] text-motorsport-dim capitalize mt-1">
                    {lapData.primaryPhase.replace('_', ' ')}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Center - Main View */}
        <div className="flex-1 flex flex-col gap-3 min-w-0">
          {/* Controls bar */}
          <div className="flex items-center gap-2 telemetry-panel shrink-0 px-2 py-1.5">
            {/* View toggle */}
            <div className="flex items-center gap-1 mr-2 border-r border-motorsport-border pr-2">
              <button
                onClick={() => setViewMode('graph')}
                className={`flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] transition-colors ${
                  viewMode === 'graph'
                    ? 'bg-motorsport-blue/20 text-motorsport-blue'
                    : 'text-motorsport-muted hover:bg-motorsport-surface'
                }`}
              >
                <BarChart3 className="w-3 h-3" />
                Graph
              </button>
              <button
                onClick={() => setViewMode('track')}
                className={`flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] transition-colors ${
                  viewMode === 'track'
                    ? 'bg-motorsport-blue/20 text-motorsport-blue'
                    : 'text-motorsport-muted hover:bg-motorsport-surface'
                }`}
              >
                <MapIcon className="w-3 h-3" />
                Track
              </button>
            </div>

            {viewMode === 'graph' && (
              <>
                {/* Active channel pills */}
                {CHANNELS.filter(c => visibleChannels.has(c.key as string)).map(ch => (
                  <button
                    key={ch.key}
                    onClick={() => toggleChannel(ch.key as string)}
                    className="flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] transition-colors"
                    style={{
                      backgroundColor: `${ch.color}20`,
                      color: ch.color,
                    }}
                  >
                    <Activity className="w-3 h-3" />
                    {ch.label}
                  </button>
                ))}

                {/* Filter menu */}
                <div className="relative ml-auto">
                  <button
                    onClick={() => setFilterOpen(!filterOpen)}
                    className={`flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] transition-colors ${
                      filterOpen ? 'bg-motorsport-orange/20 text-motorsport-orange' : 'text-motorsport-muted hover:bg-motorsport-surface'
                    }`}
                  >
                    <SlidersHorizontal className="w-3 h-3" />
                    Filters
                  </button>
                  {filterOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setFilterOpen(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-motorsport-charcoal border border-motorsport-border rounded-sm shadow-lg p-2">
                        <div className="flex items-center justify-between mb-2 pb-1 border-b border-motorsport-border">
                          <span className="text-[10px] font-semibold text-motorsport-muted uppercase">Channels</span>
                          <div className="flex gap-1">
                            <button
                              onClick={() => setVisibleChannels(new Set(CHANNELS.map(c => c.key as string)))}
                              className="text-[9px] text-motorsport-blue hover:underline"
                            >
                              All
                            </button>
                            <button
                              onClick={() => setVisibleChannels(new Set())}
                              className="text-[9px] text-motorsport-muted hover:underline"
                            >
                              None
                            </button>
                          </div>
                        </div>
                        <div className="space-y-1">
                          {CHANNELS.map(ch => (
                            <label
                              key={ch.key}
                              className="flex items-center gap-2 px-1 py-1 rounded-sm hover:bg-motorsport-surface/50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={visibleChannels.has(ch.key as string)}
                                onChange={() => toggleChannel(ch.key as string)}
                                className="w-3 h-3 rounded-sm accent-motorsport-orange"
                              />
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: ch.color }} />
                              <span className="text-[11px] text-motorsport-text">{ch.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Lock indicator */}
                <div
                  className={`flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] ${
                    cursorLocked ? 'text-motorsport-orange' : 'text-motorsport-muted'
                  }`}
                  title={cursorLocked ? 'Click graph to unlock cursor' : 'Click graph to lock cursor'}
                >
                  {cursorLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  {cursorLocked ? 'Locked' : 'Following'}
                </div>
              </>
            )}
          </div>

          {/* Main content area */}
          {viewMode === 'graph' ? (
            <div
              ref={graphContainerRef}
              className="flex-1 telemetry-panel min-h-0 relative"
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <TelemetryGraphCanvas
                laps={selectedLapData.map(l => ({ data: l.samples, color: l.color }))}
                visibleChannels={visibleChannels}
                zoomRange={zoomRange}
                effectiveIndex={effectiveIndex}
                cursorLocked={cursorLocked}
              />
            </div>
          ) : (
            <div className="flex-1 telemetry-panel min-h-0 relative flex flex-col">
              <div className="panel-header shrink-0">
                <MapPin className="w-3.5 h-3.5 text-motorsport-orange" />
                <span className="text-[10px] font-semibold tracking-widest uppercase text-motorsport-text">Track Map</span>
              </div>
              <div className="flex-1 p-2 min-h-0">
                <TrackMapViewer
                  laps={selectedLapData.map(lap => ({ data: lap.samples, color: lap.color }))}
                  currentPoint={currentSample}
                />
              </div>
              {selectedLapData.length > 1 && (
                <div className="p-2 border-t border-motorsport-border shrink-0">
                  <span className="text-[10px] text-motorsport-muted uppercase tracking-wider">Delta</span>
                  <div className="mt-1 space-y-1">
                    {selectedLapData.map((lap, i) => {
                      if (i === 0) return null;
                      const refLap = selectedLapData[0];
                      const refTime = refLap.lapTimeMs || 0;
                      const lapTime = lap.lapTimeMs || 0;
                      const delta = lapTime - refTime;
                      return (
                        <div key={lap.id} className="flex items-center justify-between text-xs">
                          <span style={{ color: lap.color }}>Lap {lap.lapNumber}</span>
                          <span className={`font-telemetry ${delta > 0 ? 'text-motorsport-red' : 'text-motorsport-green'}`}>
                            {delta >= 0 ? '+' : ''}{(delta / 1000).toFixed(3)}s
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Current Values — dynamic based on visible channels */}
          {currentSample && viewMode === 'graph' && (
            <div className="telemetry-panel p-2 shrink-0">
              <div className="flex items-center justify-end gap-4 text-xs flex-wrap">
                {CHANNELS.filter(c => visibleChannels.has(c.key as string)).map(ch => {
                  const raw = currentSample[ch.key] as number;
                  const display = ch.transform ? ch.transform(raw) : raw;
                  return (
                    <div key={ch.key} className="text-right">
                      <span className="text-[10px] text-motorsport-muted block">{ch.label}</span>
                      <span className="font-telemetry" style={{ color: ch.color }}>
                        {display.toFixed(ch.decimals)}
                      </span>
                      <span className="text-[10px] text-motorsport-muted">{ch.unit}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatLapTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}
