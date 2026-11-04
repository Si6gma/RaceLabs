import { useEffect, useRef, useState } from 'react';
import { Lightbulb } from 'lucide-react';

interface LightsState {
  configured: boolean;
  enabled: boolean;
  brightness: number;
}

// Header control for the room lamps: on/off, and a master brightness that
// scales every effect. Hidden when the backend has no Home Assistant token.
export default function LightsControl() {
  const [state, setState] = useState<LightsState | null>(null);
  const timer = useRef<number>();

  useEffect(() => {
    fetch('/api/lights').then(r => r.json()).then(setState).catch(() => {});
  }, []);

  if (!state?.configured) return null;

  const post = (patch: Partial<LightsState>) =>
    fetch('/api/lights', {
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

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggle}
        title={state.enabled ? 'Race lights on' : 'Race lights off'}
        className={`flex items-center gap-1.5 px-2.5 py-1 border text-[11px] font-bold tracking-widest uppercase transition-colors ${
          state.enabled
            ? 'bg-motorsport-orange/15 text-motorsport-orange border-motorsport-orange/40 hover:bg-motorsport-orange/25'
            : 'bg-transparent text-motorsport-dim border-motorsport-border hover:text-motorsport-muted hover:border-motorsport-muted/40'
        }`}
      >
        <Lightbulb className="w-3 h-3" />
        LIGHTS
      </button>
      {state.enabled && (
        <label className="flex items-center gap-1.5" title="Lamp brightness for every effect">
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={state.brightness}
            onChange={e => slide(Number(e.target.value))}
            className="w-[70px] h-1 accent-motorsport-orange cursor-pointer"
          />
          <span className="font-telemetry text-[11px] tabular-nums text-motorsport-muted w-[32px]">
            {state.brightness}%
          </span>
        </label>
      )}
    </div>
  );
}
