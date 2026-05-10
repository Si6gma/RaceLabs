import { create } from 'zustand';
import type { TelemetryFrame, SessionSummary, LapSummary, ImportedSession, ImportedLap } from '@/types/telemetry';

interface TelemetryState {
  // Live data
  currentFrame: TelemetryFrame | null;
  frameHistory: TelemetryFrame[];
  maxHistory: number;
  
  // Session
  session: SessionSummary | null;
  laps: Record<number, LapSummary>;
  
  // Imported Sessions
  importedSessions: ImportedSession[];
  selectedImportedSession: ImportedSession | null;
  importedLaps: ImportedLap[];
  
  // Connection
  connected: boolean;
  connecting: boolean;
  replayMode: boolean;
  
  // UI State
  selectedLaps: number[];
  compareLaps: number[];
  importModalOpen: boolean;
  
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
  
  // Imported session actions
  setImportedSessions: (sessions: ImportedSession[]) => void;
  addImportedSession: (session: ImportedSession) => void;
  setSelectedImportedSession: (session: ImportedSession | null) => void;
  setImportedLaps: (laps: ImportedLap[]) => void;
  removeImportedSession: (id: string) => void;
  
  // UI actions
  setImportModalOpen: (open: boolean) => void;
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  currentFrame: null,
  frameHistory: [],
  maxHistory: 1000,
  session: null,
  laps: {},
  importedSessions: [],
  selectedImportedSession: null,
  importedLaps: [],
  connected: false,
  connecting: false,
  replayMode: false,
  selectedLaps: [],
  compareLaps: [],
  importModalOpen: false,
  
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
  
  setImportedSessions: (sessions) => set({ importedSessions: sessions }),
  addImportedSession: (session) => {
    const state = get();
    set({ importedSessions: [session, ...state.importedSessions] });
  },
  setSelectedImportedSession: (session) => set({ selectedImportedSession: session }),
  setImportedLaps: (laps) => set({ importedLaps: laps }),
  removeImportedSession: (id) => {
    const state = get();
    set({ importedSessions: state.importedSessions.filter(s => s.id !== id) });
  },
  
  setImportModalOpen: (open) => set({ importModalOpen: open }),
}));
