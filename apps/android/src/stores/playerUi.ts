import { create } from "zustand";

interface PlayerUiStore {
  sleepTimerEndsAt: number | null;
  stopAtEpisodeEnd: boolean;
  castStatus: "idle" | "connecting" | "connected" | "stopping" | "error";
  castError: string | null;
  setSleepTimer: (endsAt: number | null) => void;
  setStopAtEpisodeEnd: (enabled: boolean) => void;
  setCastStatus: (
    status: PlayerUiStore["castStatus"],
    error?: string | null,
  ) => void;
}

export const usePlayerUiStore = create<PlayerUiStore>((set) => ({
  sleepTimerEndsAt: null,
  stopAtEpisodeEnd: false,
  castStatus: "idle",
  castError: null,
  setSleepTimer: (sleepTimerEndsAt) => set({ sleepTimerEndsAt }),
  setStopAtEpisodeEnd: (stopAtEpisodeEnd) => set({ stopAtEpisodeEnd }),
  setCastStatus: (castStatus, castError = null) =>
    set({ castStatus, castError }),
}));
