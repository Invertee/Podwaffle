import { create } from "zustand";

import type { NativeDownload } from "../native-media";
import { PodwaffleMediaModule } from "../native-media";

interface DownloadsStore {
  items: NativeDownload[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  apply: (download: NativeDownload) => void;
  remove: (episodeId: string) => void;
  clear: () => void;
}

function order(items: NativeDownload[]): NativeDownload[] {
  const rank: Record<NativeDownload["state"], number> = {
    downloading: 0,
    queued: 1,
    failed: 2,
    completed: 3,
    removing: 4,
  };
  return [...items].sort((a, b) => {
    const state = rank[a.state] - rank[b.state];
    if (state !== 0) return state;
    return (b.downloadedAt ?? "").localeCompare(a.downloadedAt ?? "");
  });
}

export const useDownloadsStore = create<DownloadsStore>((set, get) => ({
  items: [],
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const items = await PodwaffleMediaModule.getDownloads();
      set({ items: order(items), loaded: true, loading: false });
    } catch (error) {
      set({
        loading: false,
        loaded: true,
        error: error instanceof Error ? error.message : "Downloads could not be loaded.",
      });
    }
  },

  apply: (download) =>
    set((state) => {
      const next = state.items.filter((item) => item.episodeId !== download.episodeId);
      next.push(download);
      return { items: order(next), loaded: true };
    }),

  remove: (episodeId) =>
    set((state) => ({
      items: state.items.filter((item) => item.episodeId !== episodeId),
    })),

  clear: () => set({ items: [], loaded: false, loading: false, error: null }),
}));

export function downloadedPath(episodeId: string): string | null {
  const item = useDownloadsStore
    .getState()
    .items.find((download) => download.episodeId === episodeId);
  return item?.state === "completed" ? item.localPath : null;
}
