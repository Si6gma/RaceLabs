import { create } from 'zustand';
import type { TelemetryFrame, SessionSummary, LapSummary } from '@/types/telemetry';

interface TelemetryState {
  // Live data
  currentFrame: TelemetryFrame | null;
  frameHistory: TelemetryFrame[];
  maxHistory: number;
  
  // Session
  session: SessionSummary | null;
  laps: Record<number, LapSummary>;
  
  // Connection
  connected: boolean;
  connecting: boolean;
  replayMode: boolean;
  
  // UI State
  selectedLaps: number[];
  compareLaps: number[];
  
  // Actions
  setCurrentFrame: (frame: TelemetryFrame) => void;
  setSession: (session: SessionSummary) => void;
  setLaps: (laps: Record<number, LapSummary>) => void;
  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setReplayMode: (replay: boolean) => void;
  selectLap: (lap: number) => void;
  deselectLap: (lap: number) => void;
  toggleCompareLap: (lap: number) => void;
  clearHistory: () => void;
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  currentFrame: null,
  frameHistory: [],
  maxHistory: 1000,
  session: null,
  laps: {},
  connected: false,
  connecting: false,
  replayMode: false,
  selectedLaps: [],
  compareLaps: [],
  
  setCurrentFrame: (frame) => {
    const state = get();
    const newHistory = [...state.frameHistory, frame];
    if (newHistory.length > state.maxHistory) {
      newHistory.shift();
    }
    set({ currentFrame: frame, frameHistory: newHistory });
  },
  
  setSession: (session) => set({ session }),
  setLaps: (laps) => set({ laps }),
  setConnected: (connected) => set({ connected }),
  setConnecting: (connecting) => set({ connecting }),
  setReplayMode: (replayMode) => set({ replayMode }),
  
  selectLap: (lap) => {
    const state = get();
    if (!state.selectedLaps.includes(lap)) {
      set({ selectedLaps: [...state.selectedLaps, lap] });
    }
  },
  
  deselectLap: (lap) => {
    const state = get();
    set({ selectedLaps: state.selectedLaps.filter(l => l !== lap) });
  },
  
  toggleCompareLap: (lap) => {
    const state = get();
    const exists = state.compareLaps.includes(lap);
    if (exists) {
      set({ compareLaps: state.compareLaps.filter(l => l !== lap) });
    } else if (state.compareLaps.length < 4) {
      set({ compareLaps: [...state.compareLaps, lap] });
    }
  },
  
  clearHistory: () => set({ frameHistory: [], currentFrame: null }),
}));
