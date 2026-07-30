/**
 * TypeScript bridge for the podwaffle-media Kotlin module.
 *
 * This file defines the full interface that the Kotlin MediaSessionService
 * exposes to the React Native layer. Commands are async; state changes are
 * delivered through event subscriptions.
 *
 * See: Podwaffle_Implementation_Plan_v2.0.md §32
 */

import { NativeModules, NativeEventEmitter, Platform } from "react-native";

// ---------------------------------------------------------------------------
// State shapes (spec §32.3)
// ---------------------------------------------------------------------------

export type NativePlaybackStatus =
  | "idle"
  | "buffering"
  | "ready"
  | "ended"
  | "error";

export interface NativeCastSessionSummary {
  sessionId: string;
  deviceName: string;
  volume: number;
  muted: boolean;
}

export interface NativePlaybackState {
  episodeId: string | null;
  podcastId: string | null;
  title: string | null;
  podcastTitle: string | null;
  artworkUrl: string | null;
  /** Duration in milliseconds; null when unknown */
  durationMs: number | null;
  /** Confirmed position from the player in milliseconds */
  positionMs: number;
  /** Buffered position in milliseconds */
  bufferedPositionMs: number;
  playbackStatus: NativePlaybackStatus;
  playWhenReady: boolean;
  playbackRate: number;
  /** "stream" | "download" | "cast" */
  source: "stream" | "download" | "cast";
  queueItemId: string | null;
  queueIndex: number;
  queueLength: number;
  /** Whether this device currently holds the backend playback lease */
  hasLease: boolean;
  leaseExpiresAt: string | null;
  cast: NativeCastSessionSummary | null;
  lastError: NativeMediaError | null;
}

export interface NativeMediaError {
  code: string;
  message: string;
}

export interface NativeCastState {
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

// ---------------------------------------------------------------------------
// Module configuration (spec §32.1)
// ---------------------------------------------------------------------------

export interface PodwaffleMediaConfig {
  serverBaseUrl: string;
  deviceId: string;
  deviceToken: string;
  profileId: string;
  skipBackSeconds: number;
  skipForwardSeconds: number;
}

// ---------------------------------------------------------------------------
// Event names (spec §32.2)
// ---------------------------------------------------------------------------

export const MEDIA_EVENTS = {
  STATE_CHANGED: "media.state.changed",
  POSITION_CHANGED: "media.position.changed",
  METADATA_CHANGED: "media.metadata.changed",
  QUEUE_CHANGED: "media.queue.changed",
  ERROR: "media.error",
  AUDIO_FOCUS_CHANGED: "media.audio-focus.changed",
  CAST_STATE_CHANGED: "cast.state.changed",
  CAST_VOLUME_CHANGED: "cast.volume.changed",
  DOWNLOAD_STATE_CHANGED: "download.state.changed",
  DOWNLOAD_MAINTENANCE_COMPLETED: "download.maintenance.completed",
  NATIVE_CONNECTION_CHANGED: "native.connection.changed",
  NATIVE_COMMAND_RESULT: "native.command.result",
} as const;

// ---------------------------------------------------------------------------
// Module accessor
// ---------------------------------------------------------------------------

const LINKING_ERROR =
  `The package 'podwaffle-media' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ android: "• Run `expo prebuild --platform android`\n" }) +
  "• Rebuild the app after installing the module\n";

// The native module is registered in Kotlin as "PodwaffleMedia"
const podwaffleNativeModule = (NativeModules.PodwaffleMedia as Record<string, unknown> | undefined);
const NativeModule: Record<string, unknown> = podwaffleNativeModule ?? {
  getConstants: () => ({}),
};

if (podwaffleNativeModule === undefined) {
  // Warn in development; don't crash on import so mocks work in tests
  console.warn(LINKING_ERROR);
}

const emitter = new NativeEventEmitter(
  podwaffleNativeModule as ConstructorParameters<typeof NativeEventEmitter>[0],
);

// ---------------------------------------------------------------------------
// Typed bridge (spec §32.1)
// ---------------------------------------------------------------------------

function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const fn = NativeModule[method];
  if (typeof fn !== "function") {
    return Promise.reject(new Error(`PodwaffleMedia.${method} not available`));
  }
  return (fn as (...a: unknown[]) => Promise<T>)(...args);
}

export const PodwaffleMediaModule = {
  // --- Configuration ---
  configure(config: PodwaffleMediaConfig): Promise<void> {
    return call("configure", config);
  },

  // --- Service binding ---
  bind(): Promise<NativePlaybackState> {
    return call("bind");
  },

  getState(): Promise<NativePlaybackState> {
    return call("getState");
  },

  // --- Queue / episode loading ---
  setQueue(input: NativeQueueSnapshot): Promise<void> {
    return call("setQueue", input);
  },

  playEpisode(
    input: NativeEpisodeMedia,
    startPositionMs?: number,
  ): Promise<void> {
    return call("playEpisode", input, startPositionMs ?? 0);
  },

  // --- Transport ---
  play(): Promise<void> {
    return call("play");
  },

  pause(): Promise<void> {
    return call("pause");
  },

  stop(): Promise<void> {
    return call("stop");
  },

  seekTo(positionMs: number): Promise<void> {
    return call("seekTo", positionMs);
  },

  skipForward(): Promise<void> {
    return call("skipForward");
  },

  skipBackward(): Promise<void> {
    return call("skipBackward");
  },

  setPlaybackRate(rate: number): Promise<void> {
    return call("setPlaybackRate", rate);
  },

  // --- Cast (implemented in Milestone 23) ---
  showCastPicker(): Promise<void> {
    return call("showCastPicker");
  },

  stopCast(input: { resumeOnDeviceId: string | null }): Promise<void> {
    return call("stopCast", input);
  },

  getCastState(): Promise<NativeCastState> {
    return call("getCastState");
  },

  setCastVolume(volume: number): Promise<void> {
    return call("setCastVolume", volume);
  },

  // --- Downloads (implemented in Milestone 22) ---
  addDownload(
    input: NativeEpisodeMedia,
    reason: "manual" | "automatic",
  ): Promise<void> {
    return call("addDownload", input, reason);
  },

  removeDownload(episodeId: string): Promise<void> {
    return call("removeDownload", episodeId);
  },

  getDownloads(): Promise<NativeDownload[]> {
    return call("getDownloads");
  },

  runDownloadMaintenance(): Promise<NativeDownloadMaintenanceResult> {
    return call("runDownloadMaintenance");
  },

  // --- Events ---
  addListener(
    event: (typeof MEDIA_EVENTS)[keyof typeof MEDIA_EVENTS],
    handler: (data: unknown) => void,
  ) {
    return emitter.addListener(event, handler);
  },
};

export default PodwaffleMediaModule;
