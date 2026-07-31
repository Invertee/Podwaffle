import { create } from "zustand";

import type {
  NativeCastState,
  NativePlaybackState,
} from "../native-media/index";

interface NativeMediaStore {
  state: NativePlaybackState | null;
  castState: NativeCastState;
  bound: boolean;
  binding: boolean;
  setBound: (bound: boolean) => void;
  setBinding: (binding: boolean) => void;
  updateState: (state: NativePlaybackState) => void;
  updatePosition: (positionMs: number, bufferedPositionMs: number) => void;
  updateCastState: (castState: NativeCastState) => void;
  clearState: () => void;
}

const initialCastState: NativeCastState = {
  available: false,
  connecting: false,
  connected: false,
  session: null,
  availableDevices: [],
};

export const useNativeMediaStore = create<NativeMediaStore>((set) => ({
  state: null,
  castState: initialCastState,
  bound: false,
  binding: false,

  setBound: (bound) => set({ bound }),
  setBinding: (binding) => set({ binding }),
  updateState: (state) =>
    set((store) => ({
      state:
        store.castState.connected && store.castState.session
          ? castPlaybackState(state, store.castState)
          : state,
    })),
  updatePosition: (positionMs, bufferedPositionMs) =>
    set((store) => {
      if (!store.state || store.castState.connected) return {};
      return {
        state: { ...store.state, positionMs, bufferedPositionMs },
      };
    }),
  updateCastState: (castState) =>
    set((store) => ({
      castState,
      state:
        castState.connected && castState.session
          ? castPlaybackState(store.state, castState)
          : store.state
            ? {
                ...store.state,
                source: store.state.source === "cast" ? "stream" : store.state.source,
                cast: null,
              }
            : null,
    })),
  clearState: () =>
    set({ state: null, castState: initialCastState, bound: false, binding: false }),
}));

function castPlaybackState(
  local: NativePlaybackState | null,
  castState: NativeCastState,
): NativePlaybackState | null {
  const session = castState.session;
  if (!session) return local;
  const playing = session.playerState === "playing";
  const buffering = session.playerState === "buffering";
  return {
    episodeId: session.episodeId ?? local?.episodeId ?? null,
    podcastId: local?.podcastId ?? null,
    title: local?.title ?? null,
    podcastTitle: local?.podcastTitle ?? null,
    artworkUrl: local?.artworkUrl ?? null,
    durationMs: session.durationMs ?? local?.durationMs ?? null,
    positionMs: session.positionMs,
    bufferedPositionMs: session.positionMs,
    playbackStatus: buffering ? "buffering" : session.mediaLoaded ? "ready" : "idle",
    playWhenReady: playing,
    playbackRate: local?.playbackRate ?? 1,
    source: "cast",
    queueItemId: local?.queueItemId ?? null,
    queueIndex: local?.queueIndex ?? 0,
    queueLength: local?.queueLength ?? 0,
    hasLease: local?.hasLease ?? false,
    leaseExpiresAt: local?.leaseExpiresAt ?? null,
    cast: session,
    lastError: local?.lastError ?? null,
  };
}

export const selectIsPlaying = (store: NativeMediaStore) =>
  store.state?.playWhenReady === true &&
  (store.state.playbackStatus === "ready" ||
    store.state.playbackStatus === "buffering");

export const selectHasMedia = (store: NativeMediaStore) =>
  store.state !== null && store.state.episodeId !== null;

export const selectPositionMs = (store: NativeMediaStore) =>
  store.state?.positionMs ?? 0;

export const selectDurationMs = (store: NativeMediaStore) =>
  store.state?.durationMs ?? null;
