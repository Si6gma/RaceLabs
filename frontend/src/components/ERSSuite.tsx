import { memo } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';

const ERS_MAX_J = 4_000_000;
const ERS_MODES: Record<number, { label: string; color: string }> = {
  0: { label: 'NONE',      color: '#444c56' },
  1: { label: 'MEDIUM',    color: '#00E5FF' },
  2: { label: 'HOTLAP',    color: '#FFCC00' },
  3: { label: 'OVERTAKE',  color: '#FF3333' },
};

function SegmentBar({
  value, max, color, segments = 10,
}: { value: number; max: number; color: string; segments?: number }) {
  const filled = Math.ceil((value / max) * segments);
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          className="flex-1 h-2 rounded-sm transition-colors duration-150"
          style={{ backgroundColor: i < filled ? color : '#21303f' }}
        />
      ))}
    </div>
  );
}

function MetricRow({ label, value, unit, color = '#cdd9e5' }: {
  label: string; value: string; unit?: string; color?: string;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="eng-label">{label}</span>
      <span className="font-telemetry text-[10px] tabular-nums" style={{ color }}>
        {value}{unit && <span className="text-motorsport-dim text-[9px] ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

function ERSSuite() {
  const s = useTelemetryStore(sv => sv.currentFrame?.status);

  const storeJ        = s?.ers_store_energy       ?? 0;
  const deployedJ     = s?.ers_deployed_this_lap   ?? 0;
  const harvestedMguk = s?.ers_harvested_this_lap_mguk ?? 0;
  const harvestedMguh = s?.ers_harvested_this_lap_mguh ?? 0;
  const deployMode    = s?.ers_deploy_mode          ?? 0;

  const storePct       = Math.min(100, (storeJ / ERS_MAX_J) * 100);
  const deployedPct    = Math.min(100, (deployedJ / ERS_MAX_J) * 100);
  const totalHarvestJ  = harvestedMguk + harvestedMguh;
  const efficiency     = deployedJ > 0 && totalHarvestJ > 0
    ? Math.min(100, (deployedJ / totalHarvestJ) * 100)
    : null;

  const mode = ERS_MODES[deployMode] ?? ERS_MODES[0];

  return (
    <div className="telemetry-panel flex flex-col h-full overflow-hidden">
      <div className="panel-header shrink-0 justify-between">
        <span className="text-[10px] font-semibold tracking-widest text-motorsport-muted uppercase">
          ERS
        </span>
        {/* Active mode badge */}
        <span
          className="eng-chip"
          style={{
            backgroundColor: `${mode.color}18`,
            color:            mode.color,
            borderColor:      `${mode.color}40`,
          }}
        >
          {mode.label}
        </span>
      </div>

      <div className="flex-1 min-h-0 p-2 flex flex-col gap-2 overflow-hidden">
        {/* Store energy */}
        <div>
          <div className="flex justify-between mb-1">
            <span className="eng-label">STORE ENERGY</span>
            <span className="font-telemetry text-[10px] tabular-nums" style={{ color: storePct < 20 ? '#FF3333' : storePct < 50 ? '#FFCC00' : '#00FF88' }}>
              {storePct.toFixed(0)}%
            </span>
          </div>
          <SegmentBar
            value={storeJ}
            max={ERS_MAX_J}
            color={storePct < 20 ? '#FF3333' : storePct < 50 ? '#FFCC00' : '#00E5FF'}
          />
        </div>

        {/* Deployed this lap */}
        <div>
          <div className="flex justify-between mb-1">
            <span className="eng-label">DEPLOYED THIS LAP</span>
            <span className="font-telemetry text-[10px] tabular-nums text-motorsport-muted">
              {deployedPct.toFixed(0)}%
            </span>
          </div>
          <SegmentBar value={deployedJ} max={ERS_MAX_J} color="#FF3333" />
        </div>

        {/* Harvested this lap */}
        <div>
          <div className="flex justify-between mb-1">
            <span className="eng-label">HARVESTED THIS LAP</span>
            <span className="font-telemetry text-[10px] tabular-nums text-motorsport-muted">
              {((totalHarvestJ / ERS_MAX_J) * 100).toFixed(0)}%
            </span>
          </div>
          <SegmentBar value={totalHarvestJ} max={ERS_MAX_J} color="#0057FF" />
        </div>

        {/* Metrics */}
        <div className="mt-auto border-t border-motorsport-border/40 pt-2 flex flex-col gap-1">
          <MetricRow
            label="EFFICIENCY"
            value={efficiency != null ? efficiency.toFixed(0) : '--'}
            unit="%"
            color={efficiency != null ? (efficiency > 70 ? '#00FF88' : '#FFCC00') : '#444c56'}
          />
          <MetricRow
            label="MGUK"
            value={(harvestedMguk / 1000).toFixed(0)}
            unit="kJ"
            color="#00E5FF"
          />
          <MetricRow
            label="MGUH"
            value={(harvestedMguh / 1000).toFixed(0)}
            unit="kJ"
            color="#00E5FF"
          />
        </div>
      </div>
    </div>
  );
}

export default memo(ERSSuite);
