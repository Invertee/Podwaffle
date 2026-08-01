import type { PlaybackState } from "@podwaffle/contracts";

import type { NativePlaybackState } from "../native-media";
import { useAuthStore } from "../stores/auth";
import { useNativeMediaStore } from "../stores/nativeMedia";

export interface PlaybackPresentation {
  media: NativePlaybackState | null;
  hasMedia: boolean;
  isPlaying: boolean;
  remote: boolean;
  canTakeOver: boolean;
  ownerDeviceName: string | null;
  sharedPlayback: PlaybackState | null;
}

export function isRemotePlayback(
  playback: PlaybackState | null | undefined,
  currentDeviceId: string | null | undefined,
): playback is PlaybackState {
  return Boolean(
    playback?.episode &&
      playback.activeDeviceId &&
      currentDeviceId &&
      playback.activeDeviceId !== currentDeviceId &&
      playback.state !== "stopped",
  );
}

function remoteMedia(playback: PlaybackState): NativePlaybackState {
  const episode = playback.episode!;
  const playing = playback.state === "playing";
  const active = playback.state !== "stopped";
  return {
    episodeId: episode.id,
    podcastId: episode.podcastId,
    title: episode.title,
    podcastTitle: episode.podcastTitle,
    artworkUrl: episode.artworkUrl,
    durationMs: playback.durationMs ?? episode.durationMs,
    positionMs: playback.positionMs,
    bufferedPositionMs: playback.positionMs,
    playbackStatus: active ? "ready" : "idle",
    playWhenReady: playing,
    playbackRate: playback.playbackRate,
    source: playback.mode === "cast" ? "cast" : "stream",
    queueItemId: null,
    queueIndex: 0,
    queueLength: 0,
    hasLease: false,
    leaseExpiresAt: playback.leaseExpiresAt,
    cast: null,
    lastError: null,
  };
}

export function usePlaybackPresentation(): PlaybackPresentation {
  const native = useNativeMediaStore((state) => state.state);
  const snapshot = useAuthStore((state) => state.snapshot);
  const currentDeviceId = useAuthStore((state) => state.session?.device.id ?? null);
  const playback = snapshot?.playback ?? null;
  const remote = isRemotePlayback(playback, currentDeviceId);
  const media = remote ? remoteMedia(playback) : native;
  const ownerDeviceName = remote
    ? snapshot?.devices.find((device) => device.id === playback.activeDeviceId)?.name ??
      "another device"
    : null;

  return {
    media,
    hasMedia: Boolean(media?.episodeId),
    isPlaying: Boolean(
      remote
        ? playback.state === "playing"
        : media?.playWhenReady &&
            (media.playbackStatus === "ready" ||
              media.playbackStatus === "buffering"),
    ),
    remote,
    canTakeOver: remote,
    ownerDeviceName,
    sharedPlayback: playback,
  };
}
