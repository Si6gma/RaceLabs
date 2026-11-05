import { useEffect, useRef, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { apiFetch } from '@/utils/api';

interface LightsState {
  configured: boolean;
  enabled: boolean;
  brightness: number;
  testing: boolean;
}

// Header control for the room lamps: on/off, and a master brightness that
// scales every effect. Hidden when the backend has no Home Assistant token.
// Every control is always laid out so toggling never shifts the header.
export default function LightsControl() {
  const [state, setState] = useState<LightsState | null>(null);
  const timer = useRef<number>();

  const refresh = () => fetch('/api/lights').then(r => r.json()).then(setState).catch(() => {});

  useEffect(() => { refresh(); }, []);

  // While a test runs, follow it so the button comes back when it ends.
  const testing = state?.testing ?? false;
  useEffect(() => {
    if (!testing) return;
    const id = window.setInterval(refresh, 2000);
    return () => window.clearInterval(id);
  }, [testing]);

  if (!state?.configured) return null;

  const post = (patch: Partial<LightsState>) =>
    apiFetch('/api/lights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(r => r.json()).then(setState).catch(() => {});

  const toggle = () => {
    const enabled = !state.enabled;
    setState({ ...state, enabled });
    post({ enabled });
  };

  const slide = (brightness: number) => {
    setState({ ...state, brightness });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => post({ brightness }), 150);
  };

  const test = () => {
    setState({ ...state, testing: true });
    apiFetch('/api/lights/test', { method: 'POST' }).then(refresh).catch(() => {});
  };

  const off = !state.enabled;

  return (
    <div className="flex items-center h-full border-r border-motorsport-border">
      <button
        onClick={toggle}
        title={state.enabled ? 'Race lights on' : 'Race lights off'}
        className={`flex items-center gap-1.5 px-3 h-full text-[12px] font-bold tracking-wide uppercase transition-colors ${
          state.enabled
            ? 'bg-motorsport-orange/15 text-motorsport-orange hover:bg-motorsport-orange/25'
            : 'bg-transparent text-motorsport-muted hover:text-motorsport-text'
        }`}
      >
        <Lightbulb className="w-3.5 h-3.5" />
        Lights
      </button>
      <label
        className={`flex items-center gap-2 px-3 h-full border-l border-motorsport-border transition-opacity ${off ? 'opacity-40' : ''}`}
        title="Lamp brightness for every effect"
      >
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={state.brightness}
          disabled={off}
          onChange={e => slide(Number(e.target.value))}
          className="w-[72px] h-1 accent-motorsport-orange cursor-pointer disabled:cursor-default"
        />
        <span className="font-telemetry text-[12px] tabular-nums text-motorsport-muted w-[32px] text-right">
          {state.brightness}%
        </span>
      </label>
      <button
        onClick={test}
        disabled={off || state.testing}
        title="Cycle the lamps through every phase (about a minute). Not while the game is live."
        className={`px-3 h-full border-l border-motorsport-border text-[12px] font-bold tracking-wide uppercase transition-colors ${
          state.testing
            ? 'text-motorsport-orange cursor-wait'
            : off ? 'text-motorsport-muted opacity-40 cursor-default' : 'text-motorsport-muted hover:text-motorsport-text'
        }`}
      >
        {state.testing ? 'Testing' : 'Test'}
      </button>
    </div>
  );
}
