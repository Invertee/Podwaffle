import { requireNativeModule } from "expo-modules-core";

export type NativePlaybackStatus =
  "idle" | "buffering" | "ready" | "ended" | "error";

export type NativeCastPlayerState =
  "idle" | "buffering" | "playing" | "paused" | "unknown";

export interface NativeCastSessionSummary {
  sessionId: string;
  deviceName: string;
  volume: number;
  muted: boolean;
  positionMs: number;
  durationMs: number | null;
  playerState: NativeCastPlayerState;
  mediaLoaded: boolean;
  episodeId: string | null;
}

export interface NativePlaybackState {
  episodeId: string | null;
  podcastId: string | null;
  title: string | null;
  podcastTitle: string | null;
  artworkUrl: string | null;
  durationMs: number | null;
  positionMs: number;
  bufferedPositionMs: number;
  playbackStatus: NativePlaybackStatus;
  playWhenReady: boolean;
  playbackRate: number;
  source: "stream" | "download" | "cast";
  queueItemId: string | null;
  queueIndex: number;
  queueLength: number;
  hasLease: boolean;
  leaseExpiresAt: string | null;
  cast: NativeCastSessionSummary | null;
  lastError: NativeMediaError | null;
}

export interface NativeMediaError {
  code: string;
  message: string;
}

export interface NativeEpisodeCompletion {
  episodeId: string;
  positionMs: number;
  durationMs: number | null;
  source: "stream" | "download" | "cast";
}

export interface NativeCastState {
  available: boolean;
  connecting: boolean;
  connected: boolean;
  session: NativeCastSessionSummary | null;
  availableDevices: string[];
}

export interface NativeEpisodeMedia {
  episodeId: string;
  podcastId: string;
  title: string;
  podcastTitle: string;
  enclosureUrl: string;
  enclosureType?: string | null;
  localDownloadPath: string | null;
  artworkUrl: string | null;
  durationMs: number | null;
  queueItemId: string | null;
}

export interface NativeQueueSnapshot {
  items: NativeEpisodeMedia[];
  currentIndex: number;
}

export interface NativeDownload {
  episodeId: string;
  podcastId: string;
  title: string;
  podcastTitle: string;
  artworkUrl: string | null;
  enclosureUrl: string;
  enclosureType: string | null;
  durationMs: number | null;
  localPath: string | null;
  reason: "manual" | "automatic";
  state: "queued" | "downloading" | "completed" | "failed" | "removing";
  progressBytes: number;
  totalBytes: number | null;
  failureReason: string | null;
  downloadedAt: string | null;
}

export interface NativeDownloadMaintenanceResult {
  removedCount: number;
  freedBytes: number;
  errors: string[];
}

export interface PodwaffleMediaConfig {
  serverBaseUrl: string;
  deviceId: string;
  deviceToken: string;
  profileId: string;
  skipBackSeconds: number;
  skipForwardSeconds: number;
  downloadRetentionDays?: number;
  maxDownloadStorageBytes?: number;
}

export interface DecryptedNotification {
  title: string;
  message: string;
}

export interface NativeNotificationDisplayResult {
  shown: boolean;
  notificationId: number;
  notificationsEnabled: boolean;
  channelImportance: number | null;
  reason: string | null;
}

export const MEDIA_EVENTS = {
  STATE_CHANGED: "media.state.changed",
  POSITION_CHANGED: "media.position.changed",
  METADATA_CHANGED: "media.metadata.changed",
  QUEUE_CHANGED: "media.queue.changed",
  ITEM_ENDED: "media.item.ended",
  ERROR: "media.error",
  AUDIO_FOCUS_CHANGED: "media.audio-focus.changed",
  CAST_STATE_CHANGED: "cast.state.changed",
  CAST_VOLUME_CHANGED: "cast.volume.changed",
  DOWNLOAD_STATE_CHANGED: "download.state.changed",
  DOWNLOAD_MAINTENANCE_COMPLETED: "download.maintenance.completed",
  NATIVE_CONNECTION_CHANGED: "native.connection.changed",
  NATIVE_COMMAND_RESULT: "native.command.result",
} as const;

export type MediaEventName = (typeof MEDIA_EVENTS)[keyof typeof MEDIA_EVENTS];

interface PodwaffleNativeModule {
  configure(config: PodwaffleMediaConfig): Promise<void>;
  clearConfiguration(): Promise<void>;
  decryptNotification(
    input: Record<string, unknown>,
    joinCode: string,
  ): Promise<DecryptedNotification>;
  showMessageNotification(input: {
    identifier: string;
    title: string;
    message: string;
  }): Promise<NativeNotificationDisplayResult>;
  bind(): Promise<NativePlaybackState>;
  getState(): Promise<NativePlaybackState>;
  setQueue(input: NativeQueueSnapshot): Promise<void>;
  playEpisode(
    input: NativeEpisodeMedia,
    startPositionMs: number,
  ): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seekTo(positionMs: number): Promise<void>;
  skipForward(): Promise<void>;
  skipBackward(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  setPlaybackRate(rate: number): Promise<void>;
  startCast(
    input: NativeEpisodeMedia,
    startPositionMs: number,
    autoplay: boolean,
  ): Promise<NativeCastState>;
  castPlay(): Promise<NativeCastState>;
  castPause(): Promise<NativeCastState>;
  castSeek(positionMs: number): Promise<NativeCastState>;
  showCastPicker(): Promise<NativeCastState>;
  stopCast(input: { stopReceiver: boolean }): Promise<NativeCastState>;
  getCastState(): Promise<NativeCastState>;
  setCastVolume(volume: number): Promise<NativeCastState>;
  addDownload(
    input: NativeEpisodeMedia,
    reason: "manual" | "automatic",
  ): Promise<NativeDownload>;
  removeDownload(episodeId: string): Promise<void>;
  getDownloads(): Promise<NativeDownload[]>;
  runDownloadMaintenance(): Promise<NativeDownloadMaintenanceResult>;
  addListener(
    event: MediaEventName,
    handler: (data: unknown) => void,
  ): { remove(): void };
}

const nativeModule =
  requireNativeModule<PodwaffleNativeModule>("PodwaffleMedia");

export const PodwaffleMediaModule = {
  configure(config: PodwaffleMediaConfig): Promise<void> {
    return nativeModule.configure(config);
  },
  clearConfiguration(): Promise<void> {
    return nativeModule.clearConfiguration();
  },
  decryptNotification(
    input: Record<string, unknown>,
    joinCode: string,
  ): Promise<DecryptedNotification> {
    return nativeModule.decryptNotification(input, joinCode);
  },
  showMessageNotification(input: {
    identifier: string;
    title: string;
    message: string;
  }): Promise<NativeNotificationDisplayResult> {
    return nativeModule.showMessageNotification(input);
  },
  bind(): Promise<NativePlaybackState> {
    return nativeModule.bind();
  },
  getState(): Promise<NativePlaybackState> {
    return nativeModule.getState();
  },
  setQueue(input: NativeQueueSnapshot): Promise<void> {
    return nativeModule.setQueue(input);
  },
  playEpisode(input: NativeEpisodeMedia, startPositionMs = 0): Promise<void> {
    return nativeModule.playEpisode(input, startPositionMs);
  },
  play(): Promise<void> {
    return nativeModule.play();
  },
  pause(): Promise<void> {
    return nativeModule.pause();
  },
  stop(): Promise<void> {
    return nativeModule.stop();
  },
  seekTo(positionMs: number): Promise<void> {
    return nativeModule.seekTo(positionMs);
  },
  skipForward(): Promise<void> {
    return nativeModule.skipForward();
  },
  skipBackward(): Promise<void> {
    return nativeModule.skipBackward();
  },
  next(): Promise<void> {
    return nativeModule.next();
  },
  previous(): Promise<void> {
    return nativeModule.previous();
  },
  setPlaybackRate(rate: number): Promise<void> {
    return nativeModule.setPlaybackRate(rate);
  },
  startCast(
    input: NativeEpisodeMedia,
    startPositionMs: number,
    autoplay: boolean,
  ): Promise<NativeCastState> {
    return nativeModule.startCast(input, startPositionMs, autoplay);
  },
  castPlay(): Promise<NativeCastState> {
    return nativeModule.castPlay();
  },
  castPause(): Promise<NativeCastState> {
    return nativeModule.castPause();
  },
  castSeek(positionMs: number): Promise<NativeCastState> {
    return nativeModule.castSeek(positionMs);
  },
  showCastPicker(): Promise<NativeCastState> {
    return nativeModule.showCastPicker();
  },
  stopCast(input: { stopReceiver: boolean }): Promise<NativeCastState> {
    return nativeModule.stopCast(input);
  },
  getCastState(): Promise<NativeCastState> {
    return nativeModule.getCastState();
  },
  setCastVolume(volume: number): Promise<NativeCastState> {
    return nativeModule.setCastVolume(volume);
  },
  addDownload(
    input: NativeEpisodeMedia,
    reason: "manual" | "automatic",
  ): Promise<NativeDownload> {
    return nativeModule.addDownload(input, reason);
  },
  removeDownload(episodeId: string): Promise<void> {
    return nativeModule.removeDownload(episodeId);
  },
  getDownloads(): Promise<NativeDownload[]> {
    return nativeModule.getDownloads();
  },
  runDownloadMaintenance(): Promise<NativeDownloadMaintenanceResult> {
    return nativeModule.runDownloadMaintenance();
  },
  addListener(event: MediaEventName, handler: (data: unknown) => void) {
    return nativeModule.addListener(event, handler);
  },
};

export default PodwaffleMediaModule;
