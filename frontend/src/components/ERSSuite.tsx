import { memo } from 'react';
import { useTelemetryStore } from '@/stores/telemetryStore';

const ERS_MAX_J = 4_000_000;

const ERS_MODES: Record<number, { label: string; color: string }> = {
  0: { label: 'None',     color: '#9AACBE' },
  1: { label: 'Medium',   color: '#00D4FF' },
  2: { label: 'Hotlap',   color: '#FFD000' },
  3: { label: 'Overtake', color: '#FF2044' },
};

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="eng-label">{label}</span>
      <span className="font-telemetry text-[16px] font-semibold tabular-nums leading-none" style={{ color }}>{value}</span>
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
  const storeColor = storePct < 20 ? '#FF2044' : storePct < 50 ? '#FFD000' : '#E8EEF4';

  return (
    <div className="telemetry-panel flex flex-col overflow-hidden px-3 py-3 gap-3">
      {/* Deploy mode as a status box, outlined in the mode's colour */}
      <div
        className="h-11 flex items-center justify-center border-2 text-[16px] font-bold tracking-wide uppercase transition-colors"
        style={{
          borderColor:     deployMode > 0 ? mode.color : '#2A3745',
          backgroundColor: deployMode > 0 ? `${mode.color}1F` : 'transparent',
          color:           deployMode > 0 ? mode.color : '#5F7183',
        }}
      >
        ERS {mode.label}
      </div>

      {/* Battery charge with its bar */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="eng-label">Store</span>
          <span className="font-telemetry text-[22px] font-bold tabular-nums leading-none" style={{ color: storeColor }}>
            {storePct.toFixed(0)}%
          </span>
        </div>
        <div className="eng-bar-track">
          <div className="eng-bar-fill" style={{ width: `${storePct}%`, backgroundColor: storeColor }} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-x-2 gap-y-3">
        <Stat label="Deployed" value={`${deployedPct.toFixed(0)}%`} color="#E8EEF4" />
        <Stat label="Harvest"  value={`${harvestPct.toFixed(0)}%`}  color="#E8EEF4" />
        <Stat
          label="Efficiency"
          value={efficiency != null ? `${efficiency.toFixed(0)}%` : '--'}
          color={efficiency != null ? (efficiency > 70 ? '#00E85A' : '#FFD000') : '#5F7183'}
        />
        <Stat label="MGU-K" value={`${(harvestedMguk / 1000).toFixed(0)} kJ`} color="#9AACBE" />
        <Stat label="MGU-H" value={`${(harvestedMguh / 1000).toFixed(0)} kJ`} color="#9AACBE" />
      </div>
    </div>
  );
}

export default memo(ERSSuite);
