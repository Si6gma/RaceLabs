import { memo, useMemo } from 'react';
import {
  ComposedChart, Line, Area, XAxis, YAxis,
  ResponsiveContainer, Tooltip, ReferenceLine, CartesianGrid,
} from 'recharts';
import { useTelemetryStore } from '@/stores/telemetryStore';

interface DataPoint {
  dist: number;
  speed: number;
  throttle: number;
  brake: number;
  gear: number;
  steer: number;
}

function useTimelineData(): DataPoint[] {
  const frameHistory = useTelemetryStore(s => s.frameHistory);
  const currentLap   = useTelemetryStore(s => s.currentFrame?.lap?.current_lap_num);

  return useMemo(() => {
    if (!frameHistory.length || currentLap == null) return [];
    const raw = frameHistory.filter(
      f => f.lap?.current_lap_num === currentLap
        && f.lap.lap_distance != null
        && f.telemetry != null,
    );
    // Dedupe by distance bucket (every 5 m) so fast laps still look clean
    const seen = new Set<number>();
    const out: DataPoint[] = [];
    for (const f of raw) {
      const bucket = Math.round(f.lap!.lap_distance / 5) * 5;
      if (seen.has(bucket)) continue;
      seen.add(bucket);
      out.push({
        dist:     bucket,
        speed:    f.telemetry!.speed,
        throttle: +(f.telemetry!.throttle * 100).toFixed(1),
        brake:    +(f.telemetry!.brake    * 100).toFixed(1),
        gear:     f.telemetry!.gear,
        steer:    +f.telemetry!.steer.toFixed(3),
      });
    }
    return out;
  }, [frameHistory, currentLap]);
}

// Shared axis config
const AXIS_STYLE = { fontSize: 9, fill: '#768390', fontFamily: 'JetBrains Mono, monospace' };
const GRID_STROKE = '#1e2d3d';

// ── Speed channel ────────────────────────────────────────────────
function SpeedChart({ data }: { data: DataPoint[] }) {
  return (
    <div style={{ height: 80 }}>
      <div className="flex items-center gap-2 px-2 pt-1 pb-0.5">
        <span className="eng-label">SPEED</span>
        <span className="font-telemetry text-[9px] text-eng-cyan">km/h</span>
      </div>
      <ResponsiveContainer width="100%" height={62}>
        <ComposedChart data={data} syncId="timeline" margin={{ left: 0, right: 0, top: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis dataKey="dist" hide type="number" domain={['dataMin', 'dataMax']} />
          <YAxis domain={[0, 380]} tick={AXIS_STYLE} tickLine={false} axisLine={false} width={28} tickCount={4} />
          <Tooltip
            contentStyle={{ background: '#161b22', border: '1px solid #21303f', borderRadius: 4, fontSize: 10, fontFamily: 'JetBrains Mono' }}
            labelFormatter={v => `${(+v / 1000).toFixed(2)}km`}
            formatter={(v: number) => [`${v.toFixed(0)} km/h`, 'Speed']}
            cursor={{ stroke: '#768390', strokeWidth: 1, strokeDasharray: '3 3' }}
          />
          <Area dataKey="speed" fill="#00E5FF14" stroke="#00E5FF" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Throttle + Brake channel ─────────────────────────────────────
function InputsChart({ data }: { data: DataPoint[] }) {
  return (
    <div style={{ height: 72 }}>
      <div className="flex items-center gap-2 px-2 pt-1 pb-0.5">
        <span className="eng-label">THROTTLE</span>
        <span className="font-telemetry text-[9px]" style={{ color: '#00FF88' }}>▬</span>
        <span className="eng-label">BRAKE</span>
        <span className="font-telemetry text-[9px]" style={{ color: '#FF3333' }}>▬</span>
      </div>
      <ResponsiveContainer width="100%" height={54}>
        <ComposedChart data={data} syncId="timeline" margin={{ left: 0, right: 0, top: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis dataKey="dist" hide type="number" domain={['dataMin', 'dataMax']} />
          <YAxis domain={[0, 100]} tick={AXIS_STYLE} tickLine={false} axisLine={false} width={28} tickCount={3} />
          <Tooltip
            contentStyle={{ background: '#161b22', border: '1px solid #21303f', borderRadius: 4, fontSize: 10, fontFamily: 'JetBrains Mono' }}
            labelFormatter={v => `${(+v / 1000).toFixed(2)}km`}
            formatter={(v: number, n: string) => [`${v.toFixed(0)}%`, n]}
            cursor={{ stroke: '#768390', strokeWidth: 1, strokeDasharray: '3 3' }}
          />
          <Area dataKey="throttle" name="Throttle" fill="#00FF8822" stroke="#00FF88" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Area dataKey="brake"    name="Brake"    fill="#FF333322" stroke="#FF3333" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Gear channel ─────────────────────────────────────────────────
function GearChart({ data }: { data: DataPoint[] }) {
  return (
    <div style={{ height: 58 }}>
      <div className="flex items-center gap-2 px-2 pt-1 pb-0.5">
        <span className="eng-label">GEAR</span>
      </div>
      <ResponsiveContainer width="100%" height={42}>
        <ComposedChart data={data} syncId="timeline" margin={{ left: 0, right: 0, top: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis dataKey="dist" hide type="number" domain={['dataMin', 'dataMax']} />
          <YAxis domain={[0, 9]} tick={AXIS_STYLE} tickLine={false} axisLine={false} width={28} tickCount={5} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: '#161b22', border: '1px solid #21303f', borderRadius: 4, fontSize: 10, fontFamily: 'JetBrains Mono' }}
            labelFormatter={v => `${(+v / 1000).toFixed(2)}km`}
            formatter={(v: number) => [v, 'Gear']}
            cursor={{ stroke: '#768390', strokeWidth: 1, strokeDasharray: '3 3' }}
          />
          <Line dataKey="gear" stroke="#FFCC00" strokeWidth={1.5} dot={false} isAnimationActive={false} type="stepAfter" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Steering channel ─────────────────────────────────────────────
function SteerChart({ data }: { data: DataPoint[] }) {
  return (
    <div style={{ height: 75 }}>
      <div className="flex items-center gap-2 px-2 pt-1 pb-0.5">
        <span className="eng-label">STEERING</span>
      </div>
      <ResponsiveContainer width="100%" height={57}>
        <ComposedChart data={data} syncId="timeline" margin={{ left: 0, right: 0, top: 2, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis
            dataKey="dist"
            type="number"
            domain={['dataMin', 'dataMax']}
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={{ stroke: '#21303f' }}
            tickFormatter={v => `${(v / 1000).toFixed(1)}km`}
            interval="preserveStartEnd"
            minTickGap={80}
          />
          <YAxis domain={[-1, 1]} tick={AXIS_STYLE} tickLine={false} axisLine={false} width={28} tickCount={3} />
          <Tooltip
            contentStyle={{ background: '#161b22', border: '1px solid #21303f', borderRadius: 4, fontSize: 10, fontFamily: 'JetBrains Mono' }}
            labelFormatter={v => `${(+v / 1000).toFixed(2)}km`}
            formatter={(v: number) => [v.toFixed(3), 'Steer']}
            cursor={{ stroke: '#768390', strokeWidth: 1, strokeDasharray: '3 3' }}
          />
          <ReferenceLine y={0} stroke="#21303f" strokeDasharray="4 2" />
          <Line dataKey="steer" stroke="#a855f7" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function TelemetryTimeline() {
  const data = useTimelineData();

  return (
    <div className="telemetry-panel flex flex-col h-full overflow-hidden">
      <div className="panel-header shrink-0">
        <span className="text-[10px] font-semibold tracking-widest text-motorsport-muted uppercase">
          Telemetry Trace
        </span>
        <span className="ml-auto font-telemetry text-[9px] text-motorsport-dim">
          {data.length > 0 ? `${data.length} samples · ${(data[data.length - 1]?.dist / 1000).toFixed(2)} km` : 'No data'}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {data.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="eng-label">Waiting for lap data…</span>
          </div>
        ) : (
          <>
            <SpeedChart  data={data} />
            <div className="h-px bg-motorsport-border/40 shrink-0" />
            <InputsChart data={data} />
            <div className="h-px bg-motorsport-border/40 shrink-0" />
            <GearChart   data={data} />
            <div className="h-px bg-motorsport-border/40 shrink-0" />
            <SteerChart  data={data} />
          </>
        )}
      </div>
    </div>
  );
}

export default memo(TelemetryTimeline);
