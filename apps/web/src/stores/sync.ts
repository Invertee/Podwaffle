import { create } from "zustand";
import type { Snapshot } from "@podwaffle/contracts";

interface SyncState {
  revision: number;
  snapshot: Snapshot | null;
  connected: boolean;
  setSnapshot: (snapshot: Snapshot) => void;
  setConnected: (connected: boolean) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  revision: 0,
  snapshot: null,
  connected: false,
  setSnapshot: (snapshot) =>
    set((state) =>
      snapshot.revision >= state.revision
        ? { snapshot, revision: snapshot.revision }
        : state,
    ),
  setConnected: (connected) => set({ connected }),
}));
