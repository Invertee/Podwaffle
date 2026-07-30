/**
 * Zustand store for native media playback state.
 *
 * This store is the single source of truth for UI rendering of playback.
 * It is populated by event subscriptions from the Kotlin MediaSessionService
 * and must NEVER be directly mutated by UI components — use the
 * PodwaffleMediaModule commands instead.
 *
 * See: spec §28.2, §32.2
 */

import { create } from "zustand";
import type { NativePlaybackState } from "../native-media/index";

interface NativeMediaStore {
  /** null means no media is loaded / service not yet bound */
  state: NativePlaybackState | null;
  /** Whether we have successfully bound to the MediaSessionService */
  bound: boolean;
  /** Whether we're in the process of binding */
  binding: boolean;

  // Actions
  setBound: (bound: boolean) => void;
  setBinding: (binding: boolean) => void;
  updateState: (state: NativePlaybackState) => void;
  updatePosition: (positionMs: number, bufferedPositionMs: number) => void;
  clearState: () => void;
}

export const useNativeMediaStore = create<NativeMediaStore>((set) => ({
  state: null,
  bound: false,
  binding: false,

  setBound: (bound) => set({ bound }),
  setBinding: (binding) => set({ binding }),

  updateState: (state) => set({ state }),

  updatePosition: (positionMs, bufferedPositionMs) =>
    set((store) => {
      if (!store.state) return {};
      return {
        state: { ...store.state, positionMs, bufferedPositionMs },
      };
    }),

  clearState: () => set({ state: null, bound: false, binding: false }),
}));

// Convenience selectors
export const selectIsPlaying = (s: NativeMediaStore) =>
  s.state?.playWhenReady === true && s.state.playbackStatus === "ready";

export const selectHasMedia = (s: NativeMediaStore) =>
  s.state?.episodeId !== null && s.state !== null;

export const selectPositionMs = (s: NativeMediaStore) =>
  s.state?.positionMs ?? 0;

export const selectDurationMs = (s: NativeMediaStore) =>
  s.state?.durationMs ?? null;
