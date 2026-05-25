import { create } from 'zustand';
import type { TelemetryFrame, SessionSummary, LapSummary, ImportedSession, ImportedLap } from '@/types/telemetry';

interface TelemetryState {
  // Live data
  currentFrame: TelemetryFrame | null;
  frameHistory: TelemetryFrame[];
  maxHistory: number;
  lastFrameTime: number | null;
  
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
  recording: boolean;
  
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
  setRecording: (recording: boolean) => void;
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
  lastFrameTime: null,
  session: null,
  laps: {},
  importedSessions: [],
  selectedImportedSession: null,
  importedLaps: [],
  connected: false,
  connecting: false,
  replayMode: false,
  recording: false,
  selectedLaps: [],
  compareLaps: [],
  importModalOpen: false,
  
  setCurrentFrame: (frame) => {
    const state = get();
    // Merge sub-objects so partial packets (motion, lap, status, etc.)
    // don't clear fields received in a different packet type
    const merged = {
      ...frame,
      telemetry: frame.telemetry ?? state.currentFrame?.telemetry,
      motion: frame.motion ?? state.currentFrame?.motion,
      lap: frame.lap ?? state.currentFrame?.lap,
      status: frame.status ?? state.currentFrame?.status,
      damage: frame.damage ?? state.currentFrame?.damage,
      session: frame.session ?? state.currentFrame?.session,
      all_lap_distances: frame.all_lap_distances ?? state.currentFrame?.all_lap_distances,
      car_team_ids: frame.car_team_ids ?? state.currentFrame?.car_team_ids,
    };
    const newHistory = [...state.frameHistory, merged];
    if (newHistory.length > state.maxHistory) {
      newHistory.shift();
    }
    set({ currentFrame: merged, frameHistory: newHistory, lastFrameTime: Date.now() });
  },
  
  setSession: (session) => set({ session }),
  setLaps: (laps) => set({ laps }),
  setConnected: (connected) => set({ connected }),
  setConnecting: (connecting) => set({ connecting }),
  setReplayMode: (replayMode) => set({ replayMode }),
  setRecording: (recording) => set({ recording }),
  
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
