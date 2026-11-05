import { useEffect, useState } from 'react';
import { apiFetch, getControlKey, setControlKey } from '@/utils/api';
import { useSettings } from '@/stores/settingsStore';

// Settings that live on this browser or on the server. Nothing here is decoration:
// the control key decides who may press buttons, the rest changes how numbers read.
export default function SetupConfig() {
  const settings = useSettings();

  const [protectedServer, setProtectedServer] = useState<boolean | null>(null);
  const [backendUp, setBackendUp] = useState<boolean | null>(null);
  const [key, setKey] = useState(getControlKey());
  const [keyState, setKeyState] = useState<'unknown' | 'ok' | 'rejected'>('unknown');

  useEffect(() => {
    fetch('/api/access').then(r => r.json()).then(d => setProtectedServer(!!d.protected)).catch(() => setProtectedServer(null));
    fetch('/health').then(r => setBackendUp(r.ok)).catch(() => setBackendUp(false));
  }, []);

  // Prove the key with a harmless write: an empty alias on a track id nobody uses.
  const saveKey = async () => {
    setControlKey(key.trim());
    if (!key.trim()) { setKeyState('unknown'); return; }
    const res = await apiFetch('/api/tracks/probe/alias', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: '' }),
    }).catch(() => null);
    setKeyState(res?.ok ? 'ok' : 'rejected');
  };

  return (
    <div className="h-full flex gap-px p-px overflow-hidden bg-motorsport-border">
      {/* ── Left: who may press the buttons, and whether the backend is there ── */}
      <div className="w-[380px] shrink-0 flex flex-col gap-px min-h-0">
        <div className="telemetry-panel p-4 flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[16px] font-bold tracking-wide text-motorsport-text">Access</span>
            <span className="text-[12px] font-semibold" style={{ color: protectedServer == null ? '#5F7183' : protectedServer ? '#00E85A' : '#FFD000' }}>
              {protectedServer == null ? 'checking' : protectedServer ? 'server asks for a key' : 'server is open'}
            </span>
          </div>
          <p className="text-[13px] text-motorsport-muted leading-relaxed">
            Anyone can watch. Recording, lights, imports, renames and deletes need the control key when the server has one set.
            The key stays in this browser only.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="eng-label">Control key</span>
            <div className="flex gap-2">
              <input
                type="password"
                value={key}
                onChange={e => { setKey(e.target.value); setKeyState('unknown'); }}
                onKeyDown={e => { if (e.key === 'Enter') saveKey(); }}
                placeholder="leave empty on an open server"
                className="flex-1 min-w-0 bg-motorsport-dark border border-motorsport-border px-3 h-9 font-telemetry text-[14px] text-motorsport-text placeholder:text-motorsport-dim focus:outline-none focus:border-motorsport-orange"
              />
              <button onClick={saveKey} className="px-3 h-9 border border-motorsport-border-strong text-[12px] font-bold tracking-wide uppercase text-motorsport-text hover:border-motorsport-orange transition-colors">
                Save
              </button>
            </div>
          </label>
          <span className="text-[13px] font-semibold h-[13px] leading-none" style={{ color: keyState === 'ok' ? '#00E85A' : keyState === 'rejected' ? '#FF2044' : 'transparent' }}>
            {keyState === 'ok' ? 'Key accepted' : keyState === 'rejected' ? 'Key rejected by the server' : '.'}
          </span>
        </div>

        <div className="telemetry-panel p-4 flex flex-col gap-3">
          <span className="text-[16px] font-bold tracking-wide text-motorsport-text">Connection</span>
          <Row label="Backend" value={backendUp == null ? 'checking' : backendUp ? 'reachable' : 'unreachable'} color={backendUp == null ? '#9AACBE' : backendUp ? '#00E85A' : '#FF2044'} />
          <Row label="Game telemetry" value="UDP port 20777 on the server" />
          <Row label="Format" value="F1 23 / F1 24, 2023 packet layout" />
        </div>
      </div>

      {/* ── Right: how things read on this browser ── */}
      <div className="flex-1 min-w-0 telemetry-panel flex flex-col min-h-0 overflow-y-auto">
        <div className="px-4 py-3 border-b border-motorsport-border flex items-baseline justify-between">
          <span className="text-[16px] font-bold tracking-wide text-motorsport-text">Display</span>
          <span className="text-[12px] text-motorsport-muted font-semibold">saved on this browser</span>
        </div>
        <div className="divide-y divide-motorsport-border/60">
          <Choice
            label="Speed" help="Speed readout and traces"
            value={settings.speedUnit} onChange={v => settings.set('speedUnit', v)}
            options={[['kmh', 'km/h'], ['mph', 'mph']]}
          />
          <Choice
            label="Tyre temperature" help="Surface and inner temperatures"
            value={settings.tempUnit} onChange={v => settings.set('tempUnit', v)}
            options={[['c', '°C'], ['f', '°F']]}
          />
          <Choice
            label="Tyre pressure" help="Pressure under each tyre"
            value={settings.pressureUnit} onChange={v => settings.set('pressureUnit', v)}
            options={[['psi', 'psi'], ['bar', 'bar']]}
          />
          <Choice
            label="Lap segments" help="Slices in the Recorded segment table"
            value={settings.segments} onChange={v => settings.set('segments', v)}
            options={[[8, '8'], [12, '12'], [20, '20'], [30, '30']]}
          />
          <Choice
            label="Live trace height" help="The telemetry strip under the live page"
            value={settings.traceHeight} onChange={v => settings.set('traceHeight', v)}
            options={[[240, 'Compact'], [320, 'Normal'], [400, 'Tall']]}
          />
          <Choice
            label="Replay speed" help="Default rate when a recording starts playing"
            value={settings.replaySpeed} onChange={v => settings.set('replaySpeed', v)}
            options={[[0.5, '0.5×'], [1, '1×'], [2, '2×'], [4, '4×']]}
          />
          <Choice
            label="Car picker" help="Which cars the picker on the live page lists"
            value={settings.hideAiDrivers} onChange={v => settings.set('hideAiDrivers', v)}
            options={[[false, 'Everyone'], [true, 'Humans only']]}
          />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="eng-label">{label}</span>
      <span className="text-[13px] font-semibold text-right" style={{ color: color ?? '#E8EEF4' }}>{value}</span>
    </div>
  );
}

function Choice<T extends string | number | boolean>({
  label, help, value, options, onChange,
}: {
  label: string; help: string; value: T; options: [T, string][]; onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-4 px-4 h-14">
      <div className="flex flex-col gap-1 w-[220px] shrink-0">
        <span className="text-[14px] font-bold tracking-wide text-motorsport-text">{label}</span>
        <span className="text-[12px] text-motorsport-muted">{help}</span>
      </div>
      <div className="flex border border-motorsport-border">
        {options.map(([v, text]) => (
          <button
            key={String(v)}
            onClick={() => onChange(v)}
            className={`px-3 h-8 text-[12px] font-bold tracking-wide uppercase border-r last:border-r-0 border-motorsport-border transition-colors ${
              v === value ? 'bg-motorsport-orange/15 text-motorsport-orange' : 'text-motorsport-muted hover:text-motorsport-text'
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
