import { memo } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';

const ERS_MAX_J = 4_000_000;

const ERS_MODES: Record<number, { label: string; color: string }> = {
  0: { label: 'NONE',     color: '#4A6078' },
  1: { label: 'MEDIUM',   color: '#00D4FF' },
  2: { label: 'HOTLAP',   color: '#FFD000' },
  3: { label: 'OVERTAKE', color: '#FF2044' },
};

// Segmented bar — looks like an LED bar graph
function SegBar({
  value, max, color, segments = 12,
}: { value: number; max: number; color: string; segments?: number }) {
  const filled = Math.ceil((value / max) * segments);
  return (
    <div className="flex gap-px">
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          className="flex-1 transition-colors duration-150"
          style={{
            height: '4px',
            backgroundColor: i < filled ? color : '#1A2840',
            boxShadow: i < filled && i === filled - 1 ? `0 0 5px ${color}88` : 'none',
          }}
        />
      ))}
    </div>
  );
}

function ErsRow({ label, pct, value, max, color }: {
  label: string; pct: number; value: number; max: number; color: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="eng-label">{label}</span>
        <span className="font-telemetry text-[10px] tabular-nums" style={{ color }}>
          {pct.toFixed(0)}%
        </span>
      </div>
      <SegBar value={value} max={max} color={color} />
    </div>
  );
}

function ERSSuite() {
  const s = useTelemetryStore(sv => sv.currentFrame?.status);

  const storeJ        = s?.ers_store_energy           ?? 0;
  const deployedJ     = s?.ers_deployed_this_lap       ?? 0;
  const harvestedMguk = s?.ers_harvested_this_lap_mguk ?? 0;
  const harvestedMguh = s?.ers_harvested_this_lap_mguh ?? 0;
  const deployMode    = s?.ers_deploy_mode              ?? 0;

  const storePct      = Math.min(100, (storeJ / ERS_MAX_J) * 100);
  const deployedPct   = Math.min(100, (deployedJ / ERS_MAX_J) * 100);
  const totalHarvestJ = harvestedMguk + harvestedMguh;
  const harvestPct    = Math.min(100, (totalHarvestJ / ERS_MAX_J) * 100);
  const efficiency    = deployedJ > 0 && totalHarvestJ > 0
    ? Math.min(100, (deployedJ / totalHarvestJ) * 100)
    : null;

  const mode = ERS_MODES[deployMode] ?? ERS_MODES[0];
  const storeColor = storePct < 20 ? '#FF2044' : storePct < 50 ? '#FFD000' : '#00D4FF';

  return (
    <div className="telemetry-panel flex flex-col h-full overflow-hidden">
      <div className="panel-header justify-between">
        <span className="eng-label font-bold">ERS</span>
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

      <div className="flex-1 min-h-0 p-2.5 flex flex-col gap-2.5 overflow-hidden">
        <ErsRow
          label="STORE"
          pct={storePct}
          value={storeJ}
          max={ERS_MAX_J}
          color={storeColor}
        />
        <ErsRow
          label="DEPLOYED"
          pct={deployedPct}
          value={deployedJ}
          max={ERS_MAX_J}
          color="#FF2044"
        />
        <ErsRow
          label="HARVESTED"
          pct={harvestPct}
          value={totalHarvestJ}
          max={ERS_MAX_J}
          color="#1166FF"
        />

        {/* Stats row */}
        <div className="mt-auto pt-2 border-t border-motorsport-border/40 grid grid-cols-3 gap-1">
          <div>
            <span className="eng-label block">EFF</span>
            <span
              className="font-telemetry text-[11px] tabular-nums"
              style={{ color: efficiency != null ? (efficiency > 70 ? '#00E85A' : '#FFD000') : '#4A6078' }}
            >
              {efficiency != null ? `${efficiency.toFixed(0)}%` : '--'}
            </span>
          </div>
          <div>
            <span className="eng-label block">MGUK</span>
            <span className="font-telemetry text-[11px] tabular-nums text-motorsport-cyan">
              {(harvestedMguk / 1000).toFixed(0)}kJ
            </span>
          </div>
          <div>
            <span className="eng-label block">MGUH</span>
            <span className="font-telemetry text-[11px] tabular-nums text-motorsport-cyan">
              {(harvestedMguh / 1000).toFixed(0)}kJ
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(ERSSuite);
