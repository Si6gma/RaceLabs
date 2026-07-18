import { create } from 'zustand';
import type { TelemetryFrame, SessionSummary, LapSummary, ImportedSession, ImportedLap, ParticipantInfo } from '@/types/telemetry';

// Project a car's per-slot data into the flat frame shape the panels already read.
// `carIndex` picks which of the 22 slots becomes the top-level motion/lap/telemetry/etc.
// Falls back to the existing player fields when the per-car arrays aren't present
// (e.g. recordings, session viewer), so default behavior is unchanged.
function projectCar(frame: TelemetryFrame, carIndex: number): TelemetryFrame {
  if (!frame.telemetry_all && !frame.motion_all && !frame.lap_all) return frame;
  return {
    ...frame,
    telemetry: frame.telemetry_all?.[carIndex] ?? frame.telemetry,
    motion:    frame.motion_all?.[carIndex]    ?? frame.motion,
    lap:       frame.lap_all?.[carIndex]       ?? frame.lap,
    status:    frame.status_all?.[carIndex]    ?? frame.status,
    damage:    frame.damage_all?.[carIndex]    ?? frame.damage,
  };
}

// ── Non-reactive frame history ────────────────────────────────────────────────
// Stored outside Zustand so pushing frames doesn't trigger O(n) array copy or
// subscriber notifications at 30 fps. Consumers that need historical data call
// getFrameHistory() directly (e.g. StatsAnalytics, TelemetryTimeline).
const MAX_HISTORY = 1000;
const _frameHistory: TelemetryFrame[] = [];

export function getFrameHistory(): TelemetryFrame[] {
  return _frameHistory;
}

export function clearFrameHistory(): void {
  _frameHistory.length = 0;
}

// ── Store types ───────────────────────────────────────────────────────────────

interface TelemetryState {
  currentFrame:  TelemetryFrame | null;
  lastFrameTime: number | null;

  // Multiplayer spectating: which car the dashboard is showing.
  // null = follow the player's own car (default).
  selectedCarIndex: number | null;
  participants:     ParticipantInfo[];

  session:  SessionSummary | null;
  laps:     Record<number, LapSummary>;

  importedSessions:        ImportedSession[];
  selectedImportedSession: ImportedSession | null;
  importedLaps:            ImportedLap[];

  connected:  boolean;
  connecting: boolean;
  replayMode: boolean;
  recording:  boolean;

  selectedLaps: number[];
  compareLaps:  number[];
  importModalOpen: boolean;

  // Actions
  setCurrentFrame:           (frame: TelemetryFrame) => void;
  setSelectedCarIndex:       (index: number | null) => void;
  setSession:                (session: SessionSummary) => void;
  setLaps:                   (laps: Record<number, LapSummary>) => void;
  setConnected:              (connected: boolean) => void;
  setConnecting:             (connecting: boolean) => void;
  setReplayMode:             (replay: boolean) => void;
  setRecording:              (recording: boolean) => void;
  selectLap:                 (lap: number) => void;
  deselectLap:               (lap: number) => void;
  toggleCompareLap:          (lap: number) => void;
  clearHistory:              () => void;
  setImportedSessions:       (sessions: ImportedSession[]) => void;
  addImportedSession:        (session: ImportedSession) => void;
  setSelectedImportedSession:(session: ImportedSession | null) => void;
  setImportedLaps:           (laps: ImportedLap[]) => void;
  removeImportedSession:     (id: string) => void;
  setImportModalOpen:        (open: boolean) => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  currentFrame:            null,
  lastFrameTime:           null,
  selectedCarIndex:        null,
  participants:            [],
  session:                 null,
  laps:                    {},
  importedSessions:        [],
  selectedImportedSession: null,
  importedLaps:            [],
  connected:               false,
  connecting:              false,
  replayMode:              false,
  recording:               false,
  selectedLaps:            [],
  compareLaps:             [],
  importModalOpen:         false,

  setCurrentFrame: (frame) => {
    const { currentFrame: prev, selectedCarIndex, participants } = get();
    // Merge sub-objects: partial packets don't clear fields from prior packets
    const merged: TelemetryFrame = {
      ...frame,
      telemetry:         frame.telemetry         ?? prev?.telemetry,
      motion:            frame.motion             ?? prev?.motion,
      lap:               frame.lap                ?? prev?.lap,
      status:            frame.status             ?? prev?.status,
      damage:            frame.damage             ?? prev?.damage,
      session:           frame.session            ?? prev?.session,
      all_lap_distances: frame.all_lap_distances  ?? prev?.all_lap_distances,
      car_team_ids:      frame.car_team_ids       ?? prev?.car_team_ids,
      motion_all:        frame.motion_all         ?? prev?.motion_all,
      lap_all:           frame.lap_all            ?? prev?.lap_all,
      telemetry_all:     frame.telemetry_all      ?? prev?.telemetry_all,
      status_all:        frame.status_all         ?? prev?.status_all,
      damage_all:        frame.damage_all         ?? prev?.damage_all,
      participants:      frame.participants       ?? prev?.participants,
    };

    // Project the selected car (null = follow player) into the flat frame shape
    const effIndex = selectedCarIndex ?? merged.player_car_index ?? 0;
    const projected = projectCar(merged, effIndex);

    // Push to mutable ring buffer — O(1), no Zustand notification
    if (_frameHistory.length >= MAX_HISTORY) _frameHistory.shift();
    _frameHistory.push(projected);

    // Refresh the participants list only when a new one arrives (keeps a stable
    // reference so the selector doesn't re-render on every telemetry frame).
    const nextParticipants = frame.participants ?? participants;
    set({
      currentFrame: projected,
      lastFrameTime: Date.now(),
      ...(nextParticipants !== participants ? { participants: nextParticipants } : {}),
    });
  },

  setSelectedCarIndex: (index) => {
    const { currentFrame } = get();
    if (currentFrame) {
      const effIndex = index ?? currentFrame.player_car_index ?? 0;
      set({ selectedCarIndex: index, currentFrame: projectCar(currentFrame, effIndex) });
    } else {
      set({ selectedCarIndex: index });
    }
  },

  setSession:   (session)   => set({ session }),
  setLaps:      (laps)      => set({ laps }),
  setConnected: (connected) => set({ connected }),
  setConnecting:(connecting)=> set({ connecting }),
  setReplayMode:(replayMode)=> set({ replayMode }),
  setRecording: (recording) => set({ recording }),

  selectLap: (lap) => {
    const { selectedLaps } = get();
    if (!selectedLaps.includes(lap)) set({ selectedLaps: [...selectedLaps, lap] });
  },
  deselectLap: (lap) => {
    set({ selectedLaps: get().selectedLaps.filter(l => l !== lap) });
  },
  toggleCompareLap: (lap) => {
    const { compareLaps } = get();
    if (compareLaps.includes(lap)) {
      set({ compareLaps: compareLaps.filter(l => l !== lap) });
    } else if (compareLaps.length < 4) {
      set({ compareLaps: [...compareLaps, lap] });
    }
  },

  clearHistory: () => {
    clearFrameHistory();
    set({ currentFrame: null });
  },

  setImportedSessions:        (sessions) => set({ importedSessions: sessions }),
  addImportedSession:         (session)  => set({ importedSessions: [session, ...get().importedSessions] }),
  setSelectedImportedSession: (session)  => set({ selectedImportedSession: session }),
  setImportedLaps:            (laps)     => set({ importedLaps: laps }),
  removeImportedSession:      (id)       => set({ importedSessions: get().importedSessions.filter(s => s.id !== id) }),
  setImportModalOpen:         (open)     => set({ importModalOpen: open }),
}));
