import { useState } from 'react';
import { Settings, Wifi, Server, Database, Save, RotateCcw } from 'lucide-react';

interface ConfigState {
  udpPort: number;
  wsUrl: string;
  apiUrl: string;
  influxUrl: string;
  bufferSize: number;
  fps: number;
  theme: 'dark' | 'darker';
  units: 'metric' | 'imperial';
  showTyreTemps: boolean;
  showDamage: boolean;
  autoRecord: boolean;
}

const DEFAULT_CONFIG: ConfigState = {
  udpPort: 20777,
  wsUrl: 'ws://localhost:8000/ws',
  apiUrl: 'http://localhost:8000',
  influxUrl: 'http://localhost:8086',
  bufferSize: 1000,
  fps: 60,
  theme: 'dark',
  units: 'metric',
  showTyreTemps: true,
  showDamage: true,
  autoRecord: false,
};

export default function SetupConfig() {
  const [config, setConfig] = useState<ConfigState>(DEFAULT_CONFIG);
  const [saved, setSaved] = useState(false);
  
  const updateConfig = <K extends keyof ConfigState>(key: K, value: ConfigState[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };
  
  const handleSave = () => {
    localStorage.setItem('telemetry_config', JSON.stringify(config));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  
  const handleReset = () => {
    setConfig(DEFAULT_CONFIG);
    setSaved(false);
  };
  
  return (
    <div className="h-full flex flex-col p-3 gap-3 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between telemetry-panel p-2 shrink-0">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-motorsport-orange" />
          <span className="text-sm font-semibold">CONFIGURATION</span>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-xs text-motorsport-green px-2 py-1 bg-motorsport-green/10 rounded-sm">
              Saved!
            </span>
          )}
          <button 
            onClick={handleReset}
            className="flex items-center gap-1 px-3 py-1.5 bg-motorsport-charcoal rounded-sm text-xs hover:bg-motorsport-surface transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
          <button 
            onClick={handleSave}
            className="flex items-center gap-1 px-3 py-1.5 bg-motorsport-orange rounded-sm text-xs text-white hover:bg-motorsport-orange/90 transition-colors"
          >
            <Save className="w-3 h-3" />
            Save
          </button>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        {/* Connection Settings */}
        <div className="telemetry-panel p-4">
          <div className="flex items-center gap-2 mb-4">
            <Wifi className="w-4 h-4 text-motorsport-cyan" />
            <span className="text-xs font-semibold uppercase tracking-wider text-motorsport-muted">Connection</span>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="text-xs text-motorsport-muted block mb-1">UDP Port</label>
              <input
                type="number"
                value={config.udpPort}
                onChange={e => updateConfig('udpPort', Number(e.target.value))}
                className="w-full bg-motorsport-charcoal border border-motorsport-border rounded-sm px-3 py-2 text-sm text-motorsport-text focus:outline-none focus:border-motorsport-cyan"
              />
            </div>
            
            <div>
              <label className="text-xs text-motorsport-muted block mb-1">WebSocket URL</label>
              <input
                type="text"
                value={config.wsUrl}
                onChange={e => updateConfig('wsUrl', e.target.value)}
                className="w-full bg-motorsport-charcoal border border-motorsport-border rounded-sm px-3 py-2 text-sm text-motorsport-text focus:outline-none focus:border-motorsport-cyan"
              />
            </div>
            
            <div>
              <label className="text-xs text-motorsport-muted block mb-1">API URL</label>
              <input
                type="text"
                value={config.apiUrl}
                onChange={e => updateConfig('apiUrl', e.target.value)}
                className="w-full bg-motorsport-charcoal border border-motorsport-border rounded-sm px-3 py-2 text-sm text-motorsport-text focus:outline-none focus:border-motorsport-cyan"
              />
            </div>
          </div>
        </div>
        
        {/* Data Settings */}
        <div className="telemetry-panel p-4">
          <div className="flex items-center gap-2 mb-4">
            <Database className="w-4 h-4 text-motorsport-purple" />
            <span className="text-xs font-semibold uppercase tracking-wider text-motorsport-muted">Data Storage</span>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="text-xs text-motorsport-muted block mb-1">InfluxDB URL</label>
              <input
                type="text"
                value={config.influxUrl}
                onChange={e => updateConfig('influxUrl', e.target.value)}
                className="w-full bg-motorsport-charcoal border border-motorsport-border rounded-sm px-3 py-2 text-sm text-motorsport-text focus:outline-none focus:border-motorsport-purple"
              />
            </div>
            
            <div>
              <label className="text-xs text-motorsport-muted block mb-1">Buffer Size (frames)</label>
              <input
                type="number"
                value={config.bufferSize}
                onChange={e => updateConfig('bufferSize', Number(e.target.value))}
                className="w-full bg-motorsport-charcoal border border-motorsport-border rounded-sm px-3 py-2 text-sm text-motorsport-text focus:outline-none focus:border-motorsport-purple"
              />
            </div>
            
            <div>
              <label className="text-xs text-motorsport-muted block mb-1">Target FPS</label>
              <select
                value={config.fps}
                onChange={e => updateConfig('fps', Number(e.target.value))}
                className="w-full bg-motorsport-charcoal border border-motorsport-border rounded-sm px-3 py-2 text-sm text-motorsport-text focus:outline-none focus:border-motorsport-purple"
              >
                <option value={30}>30 FPS</option>
                <option value={60}>60 FPS</option>
                <option value={120}>120 FPS</option>
              </select>
            </div>
          </div>
        </div>
        
        {/* Display Settings */}
        <div className="telemetry-panel p-4">
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-4 h-4 text-motorsport-green" />
            <span className="text-xs font-semibold uppercase tracking-wider text-motorsport-muted">Display</span>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="text-xs text-motorsport-muted block mb-1">Theme</label>
              <select
                value={config.theme}
                onChange={e => updateConfig('theme', e.target.value as 'dark' | 'darker')}
                className="w-full bg-motorsport-charcoal border border-motorsport-border rounded-sm px-3 py-2 text-sm text-motorsport-text focus:outline-none focus:border-motorsport-green"
              >
                <option value="dark">Dark</option>
                <option value="darker">Darker</option>
              </select>
            </div>
            
            <div>
              <label className="text-xs text-motorsport-muted block mb-1">Units</label>
              <select
                value={config.units}
                onChange={e => updateConfig('units', e.target.value as 'metric' | 'imperial')}
                className="w-full bg-motorsport-charcoal border border-motorsport-border rounded-sm px-3 py-2 text-sm text-motorsport-text focus:outline-none focus:border-motorsport-green"
              >
                <option value="metric">Metric (km/h, °C, bar)</option>
                <option value="imperial">Imperial (mph, °F, psi)</option>
              </select>
            </div>
          </div>
        </div>
        
        {/* Feature Toggles */}
        <div className="telemetry-panel p-4">
          <div className="flex items-center gap-2 mb-4">
            <Settings className="w-4 h-4 text-motorsport-yellow" />
            <span className="text-xs font-semibold uppercase tracking-wider text-motorsport-muted">Features</span>
          </div>
          
          <div className="space-y-3">
            {[
              { key: 'showTyreTemps' as const, label: 'Show Tyre Temperatures' },
              { key: 'showDamage' as const, label: 'Show Damage Indicators' },
              { key: 'autoRecord' as const, label: 'Auto-record Sessions' },
            ].map(toggle => (
              <label key={toggle.key} className="flex items-center justify-between cursor-pointer">
                <span className="text-sm text-motorsport-text">{toggle.label}</span>
                <button
                  onClick={() => updateConfig(toggle.key, !config[toggle.key])}
                  className={`w-10 h-5 rounded-full transition-colors relative ${
                    config[toggle.key] ? 'bg-motorsport-green' : 'bg-motorsport-dim'
                  }`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    config[toggle.key] ? 'left-5' : 'left-0.5'
                  }`} />
                </button>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
