import { memo } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';

const ERS_MAX_J = 4_000_000;

const ERS_MODES: Record<number, { label: string; color: string }> = {
  0: { label: 'NONE',     color: '#4A6078' },
  1: { label: 'MEDIUM',   color: '#00D4FF' },
  2: { label: 'HOTLAP',   color: '#FFD000' },
  3: { label: 'OVERTAKE', color: '#FF2044' },
};

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <span className="eng-label block">{label}</span>
      <span className="font-telemetry text-[11px] tabular-nums" style={{ color }}>{value}</span>
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
    <div className="telemetry-panel flex flex-col overflow-hidden">
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

      <div className="px-2.5 py-2 grid grid-cols-3 gap-x-1 gap-y-1.5">
        <Stat label="STORE"    value={`${storePct.toFixed(0)}%`}    color={storeColor} />
        <Stat label="DEPLOYED" value={`${deployedPct.toFixed(0)}%`} color="#FF2044" />
        <Stat label="HARVEST"  value={`${harvestPct.toFixed(0)}%`}  color="#1166FF" />
        <Stat
          label="EFF"
          value={efficiency != null ? `${efficiency.toFixed(0)}%` : '--'}
          color={efficiency != null ? (efficiency > 70 ? '#00E85A' : '#FFD000') : '#4A6078'}
        />
        <Stat label="MGUK" value={`${(harvestedMguk / 1000).toFixed(0)}kJ`} color="#00D4FF" />
        <Stat label="MGUH" value={`${(harvestedMguh / 1000).toFixed(0)}kJ`} color="#00D4FF" />
      </div>
    </div>
  );
}

export default memo(ERSSuite);
