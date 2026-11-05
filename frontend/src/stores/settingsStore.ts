import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Per-browser preferences. Nothing here changes what is recorded, only how it reads.
export type SpeedUnit = 'kmh' | 'mph';
export type TempUnit = 'c' | 'f';
export type PressureUnit = 'psi' | 'bar';

interface SettingsState {
  speedUnit: SpeedUnit;
  tempUnit: TempUnit;
  pressureUnit: PressureUnit;
  /** Equal-distance slices the Recorded page splits a lap into. */
  segments: 8 | 12 | 20 | 30;
  /** Hide AI cars from the car picker. */
  hideAiDrivers: boolean;
  /** Height of the live telemetry trace in pixels. */
  traceHeight: 240 | 320 | 400;
  /** Default playback rate for replays. */
  replaySpeed: 0.5 | 1 | 2 | 4;
  set: <K extends keyof Omit<SettingsState, 'set'>>(key: K, value: SettingsState[K]) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      speedUnit: 'kmh',
      tempUnit: 'c',
      pressureUnit: 'psi',
      segments: 12,
      hideAiDrivers: false,
      traceHeight: 320,
      replaySpeed: 1,
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
    }),
    { name: 'racelabs.settings' },
  ),
);

export const speedValue = (kmh: number, unit: SpeedUnit) => (unit === 'mph' ? kmh * 0.621371 : kmh);
export const speedLabel = (unit: SpeedUnit) => (unit === 'mph' ? 'mph' : 'km/h');
export const tempValue = (c: number, unit: TempUnit) => (unit === 'f' ? c * 9 / 5 + 32 : c);
export const pressureText = (psi: number, unit: PressureUnit) =>
  unit === 'bar' ? `${(psi * 0.0689476).toFixed(2)} bar` : `${psi.toFixed(1)} psi`;
