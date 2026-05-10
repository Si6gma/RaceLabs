import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTelemetryStore } from '@/stores/telemetryStore';
import {
  ArrowLeft, Gauge, MapPin, Layers, Download, Activity,
  BarChart3, Map as MapIcon
} from 'lucide-react';
import type { TelemetrySample, ImportedLap, ImportedSession } from '@/types/telemetry';

const API_URL = import.meta.env.VITE_API_URL || '';

interface LapTelemetry {
  lap: ImportedLap;
  samples: TelemetrySample[];
  color: string;
}

const LAP_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#a855f7', // purple
  '#06b6d4', // cyan
];

// Fixed telemetry colors
const COLOR_SPEED = '#3b82f6';
const COLOR_THROTTLE = '#22c55e';
const COLOR_BRAKE = '#ef4444';

export default function SessionViewer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { setSelectedImportedSession } = useTelemetryStore();

  const [session, setSession] = useState<ImportedSession | null>(null);
  const [laps, setLaps] = useState<LapTelemetry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLaps, setSelectedLaps] = useState<Set<number>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentLapIndex, setCurrentLapIndex] = useState(0);

  const [viewMode, setViewMode] = useState<'graph' | 'track'>('graph');
  const [showThrottle, setShowThrottle] = useState(true);
  const [showBrake, setShowBrake] = useState(true);
  const [showSpeed, setShowSpeed] = useState(true);

  // Zoom state: sample index range [start, end]
  const [zoomRange, setZoomRange] = useState<[number, number]>([0, 1]);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartZoom = useRef<[number, number]>([0, 1]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackCanvasRef = useRef<HTMLCanvasElement>(null);

  // Load session data
  useEffect(() => {
    if (!sessionId) return;

    const load = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/api/import/sessions/${sessionId}`);
        if (!res.ok) throw new Error('Session not found');
        const data = await res.json();
        setSession(data);
        setSelectedImportedSession(data);

        // Load telemetry for all laps
        const lapData: LapTelemetry[] = [];
        for (let i = 0; i < data.laps.length; i++) {
          const lap = data.laps[i];
          const telemRes = await fetch(`${API_URL}/api/import/laps/${lap.id}/telemetry`);
          if (telemRes.ok) {
            const telem = await telemRes.json();
            lapData.push({
              lap,
              samples: telem.samples,
              color: LAP_COLORS[i % LAP_COLORS.length],
            });
          }
        }
        setLaps(lapData);

        // Auto-select first valid lap
        const firstValid = lapData.findIndex(l => l.lap.valid);
        if (firstValid >= 0) {
          setSelectedLaps(new Set([firstValid]));
          setCurrentLapIndex(firstValid);
        }
      } catch (err) {
        console.error('Failed to load session:', err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [sessionId, setSelectedImportedSession]);

  // Get currently selected lap data
  const selectedLapData = useMemo(() => {
    const indices = Array.from(selectedLaps);
    if (indices.length === 0 && laps.length > 0) return [laps[0]];
    return indices.map(i => laps[i]).filter(Boolean);
  }, [selectedLaps, laps]);

  const currentSample = useMemo(() => {
    if (selectedLapData.length === 0) return null;
    const lap = selectedLapData[currentLapIndex % selectedLapData.length];
    if (!lap || !lap.samples[currentIndex]) return null;
    return lap.samples[currentIndex];
  }, [selectedLapData, currentLapIndex, currentIndex]);

  // Reset zoom when selected laps change
  useEffect(() => {
    const lap = selectedLapData[0];
    if (lap && lap.samples.length > 1) {
      setZoomRange([0, lap.samples.length - 1]);
      setCurrentIndex(0);
    }
  }, [selectedLapData.map(l => l.lap.id).join(',')]);

  // Draw telemetry graphs
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || selectedLapData.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const padding = { top: 20, right: 20, bottom: 30, left: 50 };
    const graphWidth = width - padding.left - padding.right;
    const graphHeight = height - padding.top - padding.bottom;

    ctx.clearRect(0, 0, width, height);

    const [zStart, zEnd] = zoomRange;
    const zoomSamples = Math.max(1, zEnd - zStart);

    // Draw grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (graphHeight / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    // Draw each selected lap
    selectedLapData.forEach((lapData) => {
      const samples = lapData.samples;
      if (samples.length < 2) return;

      const xScale = graphWidth / zoomSamples;

      // Speed
      if (showSpeed) {
        ctx.strokeStyle = COLOR_SPEED;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = Math.floor(zStart); i <= Math.ceil(zEnd) && i < samples.length; i++) {
          const s = samples[i];
          const x = padding.left + (i - zStart) * xScale;
          const y = padding.top + graphHeight - (s.speed_kmh / 350) * graphHeight;
          if (i === Math.floor(zStart)) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // Throttle
      if (showThrottle) {
        ctx.strokeStyle = COLOR_THROTTLE;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = Math.floor(zStart); i <= Math.ceil(zEnd) && i < samples.length; i++) {
          const s = samples[i];
          const x = padding.left + (i - zStart) * xScale;
          const y = padding.top + graphHeight - s.throttle * graphHeight * 0.3;
          if (i === Math.floor(zStart)) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Brake
      if (showBrake) {
        ctx.strokeStyle = COLOR_BRAKE;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = Math.floor(zStart); i <= Math.ceil(zEnd) && i < samples.length; i++) {
          const s = samples[i];
          const x = padding.left + (i - zStart) * xScale;
          const y = padding.top + graphHeight - s.brake * graphHeight * 0.3;
          if (i === Math.floor(zStart)) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    });

    // Draw cursor
    if (currentSample && selectedLapData.length > 0) {
      if (currentIndex >= zStart && currentIndex <= zEnd) {
        const xScale = graphWidth / zoomSamples;
        const x = padding.left + (currentIndex - zStart) * xScale;

        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, height - padding.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Zoom window indicator (mini bar at bottom)
    if (zoomSamples < (selectedLapData[0]?.samples.length || 1)) {
      const total = selectedLapData[0].samples.length - 1;
      const barY = height - 6;
      const barW = graphWidth;
      const barX = padding.left;
      ctx.fillStyle = '#222';
      ctx.fillRect(barX, barY, barW, 4);
      ctx.fillStyle = '#3b82f6';
      const rs = zStart / total;
      const re = zEnd / total;
      ctx.fillRect(barX + rs * barW, barY, (re - rs) * barW, 4);
    }

    // Labels
    ctx.fillStyle = '#888';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('350', padding.left - 5, padding.top + 5);
    ctx.fillText('175', padding.left - 5, padding.top + graphHeight / 2 + 5);
    ctx.fillText('0', padding.left - 5, padding.top + graphHeight - 5);

  }, [selectedLapData, showSpeed, showThrottle, showBrake, currentIndex, currentLapIndex, zoomRange]);

  // Draw track map
  useEffect(() => {
    const canvas = trackCanvasRef.current;
    if (!canvas || selectedLapData.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    ctx.clearRect(0, 0, width, height);

    // Find bounds
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    selectedLapData.forEach(lap => {
      lap.samples.forEach(s => {
        minX = Math.min(minX, s.world_position_x);
        maxX = Math.max(maxX, s.world_position_x);
        minZ = Math.min(minZ, s.world_position_z);
        maxZ = Math.max(maxZ, s.world_position_z);
      });
    });

    const margin = 20;
    const mapWidth = maxX - minX || 1;
    const mapHeight = maxZ - minZ || 1;
    const scale = Math.min((width - margin * 2) / mapWidth, (height - margin * 2) / mapHeight);

    const offsetX = (width - mapWidth * scale) / 2 - minX * scale;
    const offsetY = (height - mapHeight * scale) / 2 - minZ * scale;

    // Draw track lines
    selectedLapData.forEach(lap => {
      ctx.strokeStyle = lap.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      lap.samples.forEach((s, i) => {
        const x = s.world_position_x * scale + offsetX;
        const y = s.world_position_z * scale + offsetY;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    // Draw current position
    if (currentSample) {
      const x = currentSample.world_position_x * scale + offsetX;
      const y = currentSample.world_position_z * scale + offsetY;

      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, [selectedLapData, currentSample]);

  const getSampleIndexFromX = useCallback((clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas || selectedLapData.length === 0) return 0;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const padding = { left: 50, right: 20 };
    const graphWidth = rect.width - padding.left - padding.right;
    const [zStart, zEnd] = zoomRange;
    const zoomSamples = Math.max(1, zEnd - zStart);
    const ratio = Math.max(0, Math.min(1, (x - padding.left) / graphWidth));
    return Math.floor(zStart + ratio * zoomSamples);
  }, [selectedLapData, zoomRange]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging.current) return;
    const idx = getSampleIndexFromX(e.clientX);
    const lap = selectedLapData[0];
    if (lap) {
      setCurrentIndex(Math.max(0, Math.min(lap.samples.length - 1, idx)));
    }
  }, [getSampleIndexFromX, selectedLapData]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const lap = selectedLapData[0];
    if (!lap || lap.samples.length < 2) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const padding = { left: 50, right: 20 };
    const graphWidth = rect.width - padding.left - padding.right;
    const mouseX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, (mouseX - padding.left) / graphWidth));

    const [zStart, zEnd] = zoomRange;
    const zoomSamples = zEnd - zStart;
    const total = lap.samples.length - 1;

    // Zoom factor: wheel up (negative deltaY) = zoom in, down = zoom out
    const factor = e.deltaY < 0 ? 0.85 : 1.15;
    let newZoom = zoomSamples * factor;
    newZoom = Math.max(20, Math.min(total, newZoom)); // min 20 samples visible

    const centerSample = zStart + ratio * zoomSamples;
    let newStart = centerSample - ratio * newZoom;
    let newEnd = newStart + newZoom;

    // Clamp
    if (newStart < 0) { newStart = 0; newEnd = newZoom; }
    if (newEnd > total) { newEnd = total; newStart = Math.max(0, total - newZoom); }

    setZoomRange([newStart, newEnd]);
  }, [selectedLapData, zoomRange]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartZoom.current = [...zoomRange];
  }, [zoomRange]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const padding = { left: 50, right: 20 };
    const graphWidth = rect.width - padding.left - padding.right;
    const lap = selectedLapData[0];
    if (!lap) return;

    const dx = e.clientX - dragStartX.current;
    const [ds, de] = dragStartZoom.current;
    const zoomSamples = de - ds;
    const total = lap.samples.length - 1;
    const sampleShift = -(dx / graphWidth) * zoomSamples;

    let newStart = ds + sampleShift;
    let newEnd = de + sampleShift;
    if (newStart < 0) { newStart = 0; newEnd = zoomSamples; }
    if (newEnd > total) { newEnd = total; newStart = Math.max(0, total - zoomSamples); }

    setZoomRange([newStart, newEnd]);
  }, [selectedLapData]);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

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
      <div className="flex items-center justify-between telemetry-panel p-2 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/sessions')}
            className="p-1.5 hover:bg-motorsport-surface rounded-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-motorsport-muted" />
          </button>
          <div>
            <h1 className="text-sm font-semibold">{session.name}</h1>
            <p className="text-xs text-motorsport-muted">
              {session.track} · {session.lap_count} laps · {session.sample_count?.toLocaleString()} samples
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
            className="flex items-center gap-1.5 px-3 py-1.5 bg-motorsport-surface rounded-sm text-xs hover:bg-motorsport-surface/80 transition-colors"
          >
            <Download className="w-3 h-3" />
            Export
          </button>
        </div>
      </div>

      <div className="flex-1 flex gap-3 min-h-0">
        {/* Left Panel - Lap Selector */}
        <div className="w-56 telemetry-panel flex flex-col shrink-0">
          <div className="p-2 border-b border-motorsport-border">
            <div className="flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-motorsport-orange" />
              <span className="text-xs font-semibold">LAPS</span>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-1">
            {laps.map((lapData, idx) => (
              <button
                key={lapData.lap.id}
                onClick={() => {
                  const newSet = new Set(selectedLaps);
                  if (newSet.has(idx)) {
                    newSet.delete(idx);
                  } else {
                    newSet.add(idx);
                  }
                  setSelectedLaps(newSet);
                  setCurrentLapIndex(idx);
                  setCurrentIndex(0);
                }}
                className={`w-full text-left p-2 rounded-sm text-xs transition-colors ${
                  selectedLaps.has(idx)
                    ? 'bg-motorsport-orange/10 border border-motorsport-orange/30'
                    : 'hover:bg-motorsport-surface/50 border border-transparent'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium" style={{ color: lapData.color }}>
                    Lap {lapData.lap.lap_number}
                  </span>
                  {lapData.lap.valid ? (
                    <span className="text-[9px] text-motorsport-green">VALID</span>
                  ) : (
                    <span className="text-[9px] text-motorsport-red">INVALID</span>
                  )}
                </div>
                <div className="flex items-center justify-between text-motorsport-muted">
                  <span>{lapData.lap.lap_time_ms ? formatLapTime(lapData.lap.lap_time_ms) : '--:--'}</span>
                  <span>{lapData.samples.length} pts</span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-motorsport-dim">
                  <span>Max: {lapData.lap.max_speed.toFixed(0)} km/h</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Center - Main View */}
        <div className="flex-1 flex flex-col gap-3 min-w-0">
          {/* View + Graph Controls */}
          <div className="flex items-center gap-2 telemetry-panel p-2 shrink-0">
            {/* View toggle */}
            <div className="flex items-center gap-1 mr-3 border-r border-motorsport-border pr-3">
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
                <button
                  onClick={() => setShowSpeed(!showSpeed)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] transition-colors ${
                    showSpeed ? 'bg-motorsport-blue/20 text-motorsport-blue' : 'text-motorsport-muted'
                  }`}
                >
                  <Activity className="w-3 h-3" />
                  Speed
                </button>
                <button
                  onClick={() => setShowThrottle(!showThrottle)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] transition-colors ${
                    showThrottle ? 'bg-motorsport-green/20 text-motorsport-green' : 'text-motorsport-muted'
                  }`}
                >
                  <Gauge className="w-3 h-3" />
                  Throttle
                </button>
                <button
                  onClick={() => setShowBrake(!showBrake)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] transition-colors ${
                    showBrake ? 'bg-motorsport-red/20 text-motorsport-red' : 'text-motorsport-muted'
                  }`}
                >
                  <Gauge className="w-3 h-3" />
                  Brake
                </button>
              </>
            )}
          </div>

          {/* Main content area */}
          {viewMode === 'graph' ? (
            <div className="flex-1 telemetry-panel min-h-0 relative">
              <canvas
                ref={canvasRef}
                className="w-full h-full cursor-crosshair"
                onClick={handleSeek}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              />
            </div>
          ) : (
            <div className="flex-1 telemetry-panel min-h-0 relative flex flex-col">
              <div className="p-2 border-b border-motorsport-border shrink-0">
                <div className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-motorsport-orange" />
                  <span className="text-xs font-semibold">TRACK MAP</span>
                </div>
              </div>
              <div className="flex-1 p-2 min-h-0">
                <canvas
                  ref={trackCanvasRef}
                  className="w-full h-full"
                />
              </div>
              {/* Lap Comparison */}
              {selectedLapData.length > 1 && (
                <div className="p-2 border-t border-motorsport-border shrink-0">
                  <span className="text-[10px] text-motorsport-muted uppercase tracking-wider">Delta</span>
                  <div className="mt-1 space-y-1">
                    {selectedLapData.map((lap, i) => {
                      if (i === 0) return null;
                      const refLap = selectedLapData[0];
                      const refTime = refLap.lap.lap_time_ms || 0;
                      const lapTime = lap.lap.lap_time_ms || 0;
                      const delta = lapTime - refTime;
                      return (
                        <div key={lap.lap.id} className="flex items-center justify-between text-xs">
                          <span style={{ color: lap.color }}>Lap {lap.lap.lap_number}</span>
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

          {/* Current Values — always visible */}
          {currentSample && (
            <div className="telemetry-panel p-2 shrink-0">
              <div className="flex items-center justify-end gap-4 text-xs">
                <div className="text-right">
                  <span className="text-[10px] text-motorsport-muted block">Speed</span>
                  <span className="font-telemetry text-motorsport-blue">{currentSample.speed_kmh.toFixed(0)}</span>
                  <span className="text-[10px] text-motorsport-muted"> km/h</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-motorsport-muted block">Throttle</span>
                  <span className="font-telemetry text-motorsport-green">{(currentSample.throttle * 100).toFixed(0)}%</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-motorsport-muted block">Brake</span>
                  <span className="font-telemetry text-motorsport-red">{(currentSample.brake * 100).toFixed(0)}%</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-motorsport-muted block">Gear</span>
                  <span className="font-telemetry text-motorsport-text">{currentSample.gear}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-motorsport-muted block">RPM</span>
                  <span className="font-telemetry text-motorsport-orange">{currentSample.rpm}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-motorsport-muted block">Position</span>
                  <span className="font-telemetry text-motorsport-text">{(currentSample.normalized_track_position * 100).toFixed(1)}%</span>
                </div>
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
