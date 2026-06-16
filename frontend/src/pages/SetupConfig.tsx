import { useState } from 'react';
import { Wifi, Server, Database, Save, RotateCcw, Check } from 'lucide-react';

interface ConfigState {
  udpPort:      number;
  wsUrl:        string;
  apiUrl:       string;
  influxUrl:    string;
  bufferSize:   number;
  fps:          number;
  theme:        'dark' | 'darker';
  units:        'metric' | 'imperial';
  showTyreTemps: boolean;
  showDamage:   boolean;
  autoRecord:   boolean;
}

const DEFAULT_CONFIG: ConfigState = {
  udpPort:      20777,
  wsUrl:        'ws://localhost:8000/ws',
  apiUrl:       'http://localhost:8000',
  influxUrl:    'http://localhost:8086',
  bufferSize:   1000,
  fps:          60,
  theme:        'dark',
  units:        'metric',
  showTyreTemps: true,
  showDamage:   true,
  autoRecord:   false,
};

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="eng-label">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="relative w-10 h-5 border transition-colors shrink-0"
      style={{
        backgroundColor: checked ? '#FF770015' : 'transparent',
        borderColor: checked ? '#FF770060' : '#1A2840',
      }}
    >
      <div
        className="absolute top-0.5 w-4 h-4 transition-transform flex items-center justify-center"
        style={{
          left: checked ? '20px' : '2px',
          backgroundColor: checked ? '#FF7700' : '#243546',
        }}
      >
        {checked && <Check className="w-2.5 h-2.5 text-black" strokeWidth={3} />}
      </div>
    </button>
  );
}

export default function SetupConfig() {
  const [config, setConfig] = useState<ConfigState>(DEFAULT_CONFIG);
  const [saved, setSaved]   = useState(false);

  const set = <K extends keyof ConfigState>(key: K, value: ConfigState[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    localStorage.setItem('telemetry_config', JSON.stringify(config));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="h-full flex flex-col gap-px p-px bg-motorsport-dim/20 overflow-auto">
      {/* ── Header ── */}
      <div className="telemetry-panel shrink-0">
        <div className="panel-header justify-between">
          <span className="eng-label font-bold">System Configuration</span>
          <div className="flex items-center gap-2">
            {saved && (
              <span className="flex items-center gap-1.5 text-[11px] text-motorsport-green uppercase tracking-wider">
                <Check className="w-3 h-3" /> Saved
              </span>
            )}
            <button onClick={() => { setConfig(DEFAULT_CONFIG); setSaved(false); }} className="btn-ghost h-7 text-[11px]">
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
            <button onClick={handleSave} className="btn-primary h-7 text-[11px]">
              <Save className="w-3 h-3" /> Save
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px">

        {/* Connection */}
        <div className="telemetry-panel">
          <div className="panel-header">
            <Wifi className="w-3.5 h-3.5 text-motorsport-cyan" />
            <span className="eng-label font-bold">Connection</span>
          </div>
          <div className="p-3 flex flex-col gap-4">
            <FieldGroup label="UDP Port">
              <input
                type="number"
                value={config.udpPort}
                onChange={e => set('udpPort', Number(e.target.value))}
                className="field text-[13px] h-8"
              />
            </FieldGroup>
            <FieldGroup label="WebSocket URL">
              <input
                type="text"
                value={config.wsUrl}
                onChange={e => set('wsUrl', e.target.value)}
                className="field text-[13px] h-8"
              />
            </FieldGroup>
            <FieldGroup label="API URL">
              <input
                type="text"
                value={config.apiUrl}
                onChange={e => set('apiUrl', e.target.value)}
                className="field text-[13px] h-8"
              />
            </FieldGroup>
          </div>
        </div>

        {/* Data Storage */}
        <div className="telemetry-panel">
          <div className="panel-header">
            <Database className="w-3.5 h-3.5 text-motorsport-purple" />
            <span className="eng-label font-bold">Data Storage</span>
          </div>
          <div className="p-3 flex flex-col gap-4">
            <FieldGroup label="InfluxDB URL">
              <input
                type="text"
                value={config.influxUrl}
                onChange={e => set('influxUrl', e.target.value)}
                className="field text-[13px] h-8"
              />
            </FieldGroup>
            <FieldGroup label="Frame Buffer Size">
              <input
                type="number"
                value={config.bufferSize}
                onChange={e => set('bufferSize', Number(e.target.value))}
                className="field text-[13px] h-8"
              />
            </FieldGroup>
            <FieldGroup label="Target FPS">
              <select
                value={config.fps}
                onChange={e => set('fps', Number(e.target.value))}
                className="field text-[13px] h-8 appearance-none cursor-pointer"
              >
                <option value={30}>30 FPS</option>
                <option value={60}>60 FPS</option>
                <option value={120}>120 FPS</option>
              </select>
            </FieldGroup>
          </div>
        </div>

        {/* Display */}
        <div className="telemetry-panel">
          <div className="panel-header">
            <Server className="w-3.5 h-3.5 text-motorsport-green" />
            <span className="eng-label font-bold">Display</span>
          </div>
          <div className="p-3 flex flex-col gap-4">
            <FieldGroup label="Units">
              <select
                value={config.units}
                onChange={e => set('units', e.target.value as 'metric' | 'imperial')}
                className="field text-[13px] h-8 appearance-none cursor-pointer"
              >
                <option value="metric">Metric (km/h, °C, bar)</option>
                <option value="imperial">Imperial (mph, °F, psi)</option>
              </select>
            </FieldGroup>
          </div>
        </div>

        {/* Feature Toggles */}
        <div className="telemetry-panel">
          <div className="panel-header">
            <span className="eng-label font-bold">Features</span>
          </div>
          <div className="p-3 flex flex-col gap-1">
            {([
              { key: 'showTyreTemps' as const, label: 'Show Tyre Temperatures' },
              { key: 'showDamage'    as const, label: 'Show Damage Indicators' },
              { key: 'autoRecord'   as const, label: 'Auto-record Sessions'    },
            ]).map(toggle => (
              <label key={toggle.key} className="flex items-center justify-between cursor-pointer py-2 border-b border-motorsport-border/40 last:border-0">
                <span className="text-[13px] text-motorsport-text">{toggle.label}</span>
                <Toggle checked={config[toggle.key] as boolean} onChange={() => set(toggle.key, !config[toggle.key])} />
              </label>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
