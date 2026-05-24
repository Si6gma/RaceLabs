import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTelemetryStore } from '@/stores/telemetryStore';
import {
  ArrowLeft, MapPin, Layers, Download, Activity,
  BarChart3, Map as MapIcon, SlidersHorizontal, Lock, Unlock
} from 'lucide-react';
import type { ImportedLap, ImportedSession } from '@/types/telemetry';
import TelemetryGraphCanvas, { CHANNELS, DEFAULT_VISIBLE } from '@/components/TelemetryGraphCanvas';
import TrackMapViewer from '@/components/TrackMapViewer';
import ZoomRangeBar from '@/components/ZoomRangeBar';
import { normalizeImportedSamples, normalizeLiveFrames, type TelemetryPoint } from '@/utils/telemetryAdapter';

const API_URL = import.meta.env.VITE_API_URL || '';

const LAP_COLORS = [
  '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#22d3ee',
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
  const [currentPosition, setCurrentPosition] = useState(0);
  const [currentLapIndex, setCurrentLapIndex] = useState(0);

  const [viewMode, setViewMode] = useState<'graph' | 'track'>('graph');
  const [visibleChannels, setVisibleChannels] = useState<Set<string>>(new Set(DEFAULT_VISIBLE));
  const [filterOpen, setFilterOpen] = useState(false);

  const [cursorLocked, setCursorLocked] = useState(false);
  const [hoverPosition, setHoverPosition] = useState(0);
  const hoverPositionRef = useRef(0);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

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
          // Try resampled first, fall back to raw telemetry
          let samples: TelemetryPoint[] = [];
          const resampledRes = await fetch(`${API_URL}/api/import/laps/${lap.id}/resampled`);
          if (resampledRes.ok) {
            const telem = await resampledRes.json();
            samples = telem.samples as TelemetryPoint[];
          } else {
            const rawRes = await fetch(`${API_URL}/api/import/laps/${lap.id}/telemetry`);
            if (rawRes.ok) {
              const telem = await rawRes.json();
              samples = normalizeImportedSamples(telem.samples);
            }
          }
          return {
            id: lap.id,
            lapNumber: lap.lap_number,
            lapTimeMs: lap.lap_time_ms,
            valid: lap.valid,
            maxSpeed: lap.max_speed,
            sampleCount: samples.length,
            samples,
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

      // Prefer first lap with a recorded time (flying lap), fall back to first valid with enough data
      const firstTimed = lapData.findIndex(l => l.lapTimeMs != null);
      const firstSubstantial = lapData.findIndex(l => l.valid && l.sampleCount > 100);
      const autoSelect = firstTimed >= 0 ? firstTimed : firstSubstantial;
      if (autoSelect >= 0) {
        setSelectedLaps(new Set([autoSelect]));
        setCurrentLapIndex(autoSelect);
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

  const effectivePosition = cursorLocked ? currentPosition : hoverPosition;

  const currentSample = useMemo(() => {
    if (selectedLapData.length === 0) return null;
    const lap = selectedLapData[currentLapIndex % selectedLapData.length];
    if (!lap || lap.samples.length === 0) return null;
    const idx = Math.max(0, Math.min(lap.samples.length - 1, Math.round(effectivePosition * (lap.samples.length - 1))));
    return lap.samples[idx];
  }, [selectedLapData, currentLapIndex, effectivePosition]);

  const currentPoints = useMemo(() => {
    return selectedLapData.map(lap => {
      if (!lap.samples.length) return null;
      const idx = Math.max(0, Math.min(lap.samples.length - 1, Math.round(effectivePosition * (lap.samples.length - 1))));
      return { point: lap.samples[idx], color: lap.color };
    }).filter(Boolean) as Array<{ point: TelemetryPoint; color: string }>;
  }, [selectedLapData, effectivePosition]);

  // Reset zoom when selected laps change
  useEffect(() => {
    if (selectedLapData.length === 0) return;
    setZoomRange([0, 1]);
    setCurrentPosition(0);
    setHoverPosition(0);
    hoverPositionRef.current = 0;
    setCursorLocked(false);
  }, [selectedLapData.map(l => l.id).join(',')]);

  const getPositionFromX = useCallback((clientX: number): number => {
    const container = graphContainerRef.current;
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const padding = { left: 50, right: 60 };
    const graphWidth = rect.width - padding.left - padding.right;
    const [zStart, zEnd] = zoomRange;
    const posSpan = Math.max(1e-9, zEnd - zStart);
    const ratio = Math.max(0, Math.min(1, (x - padding.left) / graphWidth));
    return zStart + ratio * posSpan;
  }, [zoomRange]);

  // Graph wheel zoom — stored in ref so the non-passive listener always has current values
  const graphWheelRef = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    graphWheelRef.current = (e: WheelEvent) => {
      e.preventDefault();

      const container = graphContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const padding = { left: 50, right: 60 };
      const graphWidth = rect.width - padding.left - padding.right;
      const mouseX = e.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, (mouseX - padding.left) / graphWidth));

      const [zStart, zEnd] = zoomRange;
      const zoomSpan = zEnd - zStart;
      const total = 1.0;

      const factor = e.deltaY < 0 ? 0.85 : 1.15;
      let newZoom = Math.max(0.005, Math.min(total, zoomSpan * factor));
      const center = zStart + ratio * zoomSpan;
      let newStart = center - ratio * newZoom;
      let newEnd = newStart + newZoom;
      if (newStart < 0) { newStart = 0; newEnd = newZoom; }
      if (newEnd > total) { newEnd = total; newStart = Math.max(0, total - newZoom); }
      setZoomRange([newStart, newEnd]);
    };
  }, [zoomRange]);

  // Attach non-passive wheel listener so e.preventDefault() actually suppresses page scroll
  useEffect(() => {
    const el = graphContainerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => graphWheelRef.current(e);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    hasDragged.current = false;
    dragStartX.current = e.clientX;
    dragStartZoom.current = [...zoomRange];
  }, [zoomRange]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) {
      const clamped = getPositionFromX(e.clientX);
      hoverPositionRef.current = clamped;
      setHoverPosition(clamped);
      const container = graphContainerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        setHoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }
      return;
    }

    const dx = Math.abs(e.clientX - dragStartX.current);
    if (dx > 4) hasDragged.current = true;

    const container = graphContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const padding = { left: 50, right: 60 };
    const graphWidth = rect.width - padding.left - padding.right;

    const [ds, de] = dragStartZoom.current;
    const zoomSpan = de - ds;
    const total = 1.0;
    const positionShift = -(dx * Math.sign(e.clientX - dragStartX.current) / graphWidth) * zoomSpan;

    let newStart = ds + positionShift;
    let newEnd = de + positionShift;
    if (newStart < 0) { newStart = 0; newEnd = zoomSpan; }
    if (newEnd > total) { newEnd = total; newStart = Math.max(0, total - zoomSpan); }
    setZoomRange([newStart, newEnd]);
  }, [getPositionFromX]);

  const handleMouseUp = useCallback(() => {
    if (isDragging.current && !hasDragged.current) {
      if (cursorLocked) {
        setCursorLocked(false);
      } else {
        setCurrentPosition(hoverPositionRef.current);
        setCursorLocked(true);
      }
    }
    isDragging.current = false;
  }, [cursorLocked]);

  const handleMouseLeaveGraph = useCallback(() => {
    isDragging.current = false;
    if (!cursorLocked) setHoverPos(null);
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
                  setCurrentPosition(0);
                  setHoverPosition(0);
                  hoverPositionRef.current = 0;
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

          {/* Graph view — always mounted, hidden in track mode */}
          <div
            ref={graphContainerRef}
            className={`flex-1 telemetry-panel min-h-0 relative ${viewMode !== 'graph' ? 'hidden' : ''}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeaveGraph}
          >
            <TelemetryGraphCanvas
              laps={selectedLapData.map(l => ({ data: l.samples, color: l.color }))}
              visibleChannels={visibleChannels}
              zoomRange={zoomRange}
              effectivePosition={effectivePosition}
              cursorLocked={cursorLocked}
            />

            {/* Floating hover tooltip */}
            {currentSample && hoverPos && (
              <HoverTooltip
                sample={currentSample}
                visibleChannels={visibleChannels}
                x={hoverPos.x}
                y={hoverPos.y}
                containerRef={graphContainerRef}
                laps={selectedLapData}
                effectivePosition={effectivePosition}
              />
            )}
          </div>

          {/* Zoom range bar — shows when in graph mode and data is loaded */}
          {viewMode === 'graph' && selectedLapData.length > 0 && (
            <ZoomRangeBar
              total={1.0}
              zoomRange={zoomRange}
              onZoomChange={setZoomRange}
            />
          )}

          {/* Track view — always mounted, hidden in graph mode */}
          <div className={`flex-1 telemetry-panel min-h-0 relative flex flex-col ${viewMode !== 'track' ? 'hidden' : ''}`}>
            <div className="panel-header shrink-0">
              <MapPin className="w-3.5 h-3.5 text-motorsport-orange" />
              <span className="text-[10px] font-semibold tracking-widest uppercase text-motorsport-text">Track Map</span>
            </div>
            <div className="flex-1 p-2 min-h-0">
              <TrackMapViewer
                laps={selectedLapData.map(lap => ({ data: lap.samples, color: lap.color }))}
                currentPoint={currentSample}
                currentPoints={currentPoints}
              />
            </div>
            {selectedLapData.length > 1 && (
              <div className="p-2 border-t border-motorsport-border shrink-0">
                <span className="text-[10px] text-motorsport-muted uppercase tracking-wider">Delta</span>
                <div className="mt-1 space-y-1">
                  {selectedLapData.map((lap, i) => {
                    if (i === 0) return null;
                    const refTime = selectedLapData[0].lapTimeMs || 0;
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

        </div>
      </div>
    </div>
  );
}


interface HoverTooltipProps {
  sample: TelemetryPoint;
  visibleChannels: Set<string>;
  x: number;
  y: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  laps: UnifiedLap[];
  effectivePosition: number;
}

function HoverTooltip({ sample, visibleChannels, x, y, containerRef, laps, effectivePosition }: HoverTooltipProps) {
  const TOOLTIP_W = 160;
  const TOOLTIP_H_EST = 200;
  const OFFSET = 14;

  const container = containerRef.current;
  const cw = container?.clientWidth ?? 600;
  const ch = container?.clientHeight ?? 400;

  const left = x + OFFSET + TOOLTIP_W > cw ? x - OFFSET - TOOLTIP_W : x + OFFSET;
  const top = Math.max(8, Math.min(ch - TOOLTIP_H_EST - 8, y - TOOLTIP_H_EST / 2));

  const dist = sample.cumulative_distance ?? 0;
  const distLabel = dist >= 1000 ? `${(dist / 1000).toFixed(2)} km` : `${Math.round(dist)} m`;

  return (
    <div
      className="absolute pointer-events-none z-20 rounded border border-motorsport-border bg-motorsport-charcoal/95 backdrop-blur-sm shadow-panel-lg px-3 py-2.5 min-w-[140px]"
      style={{ left, top }}
    >
      <div className="text-[10px] text-motorsport-muted mb-2 border-b border-motorsport-border pb-1.5 flex items-center justify-between">
        <span className="font-telemetry">{distLabel}</span>
        {laps.length > 1 && (
          <span className="text-[9px] text-motorsport-dim">{(effectivePosition * 100).toFixed(1)}%</span>
        )}
      </div>
      <div className="space-y-1.5">
        {CHANNELS.filter(c => visibleChannels.has(c.key as string)).map(ch => {
          const raw = sample[ch.key] as number;
          const display = ch.transform ? ch.transform(raw) : raw;
          return (
            <div key={ch.key} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: ch.color }} />
                <span className="text-[10px] text-motorsport-muted">{ch.label}</span>
              </div>
              <span className="font-telemetry text-[11px] tabular-nums" style={{ color: ch.color }}>
                {display.toFixed(ch.decimals)}{ch.unit}
              </span>
            </div>
          );
        })}
      </div>
      {laps.length > 1 && (
        <div className="mt-2 pt-1.5 border-t border-motorsport-border space-y-1">
          {laps.map((lap) => {
            const idx = Math.max(0, Math.min(lap.samples.length - 1, Math.round(effectivePosition * (lap.samples.length - 1))));
            const s = lap.samples[idx];
            if (!s) return null;
            const spd = s.speed_kmh ?? 0;
            return (
              <div key={lap.id} className="flex items-center justify-between gap-2 text-[10px]">
                <span style={{ color: lap.color }}>L{lap.lapNumber}</span>
                <span className="font-telemetry text-motorsport-muted">{spd.toFixed(0)} km/h</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatLapTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}
