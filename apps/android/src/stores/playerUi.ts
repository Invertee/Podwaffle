import { create } from "zustand";

interface PlayerUiStore {
  castStatus: "idle" | "connecting" | "connected" | "stopping" | "error";
  castError: string | null;
  setCastStatus: (
    status: PlayerUiStore["castStatus"],
    error?: string | null,
  ) => void;
}

export const usePlayerUiStore = create<PlayerUiStore>((set) => ({
  castStatus: "idle",
  castError: null,
  setCastStatus: (castStatus, castError = null) =>
    set({ castStatus, castError }),
}));
