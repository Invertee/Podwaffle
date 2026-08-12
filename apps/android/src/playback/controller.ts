import type {
  CastConfirmedState,
  Episode,
  PlaybackCommand,
  PlaybackState,
} from "@podwaffle/contracts";
import { PermissionsAndroid, Platform } from "react-native";

import { ApiClientError, api, createCommandId } from "../api/client";
import type {
  NativeCastState,
  NativeDownload,
  NativeEpisodeCompletion,
  NativePlaybackState,
} from "../native-media";
import { PodwaffleMediaModule } from "../native-media";
import { useAuthStore } from "../stores/auth";
import { useNativeMediaStore } from "../stores/nativeMedia";
import { downloadedPath } from "../stores/downloads";
import { usePlayerUiStore } from "../stores/playerUi";
import { playbackSyncPolicy } from "../sync/policy";
import { episodeMedia } from "./media";
import { isRemotePlayback } from "./presentation";
import {
  acknowledgePendingPlayback,
  clearPendingCompletion,
  pendingPlaybackUpdates,
  savePendingPlayback,
  type PendingPlaybackUpdate,
} from "./offlineProgress";
import {
  pendingCompletionEpisodeIds,
  queueWithoutPendingCompletions,
  staleCompletedQueueEpisodeIds,
} from "./queueReconciliation";

let notificationPermissionRequested = false;

async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== "android" || Number(Platform.Version) < 33) return true;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (!permission) return true;
  if (await PermissionsAndroid.check(permission).catch(() => false)) {
    notificationPermissionRequested = true;
    return true;
  }
  const result = await PermissionsAndroid.request(permission).catch(
    () => PermissionsAndroid.RESULTS.DENIED,
  );
  notificationPermissionRequested =
    result === PermissionsAndroid.RESULTS.GRANTED;
  return notificationPermissionRequested;
}

function localPlaybackState(
  state: NativePlaybackState,
): "playing" | "paused" | "stopped" {
  if (state.playbackStatus === "ended") return "stopped";
  return state.playWhenReady &&
    (state.playbackStatus === "ready" || state.playbackStatus === "buffering")
    ? "playing"
    : "paused";
}

function durationFor(state: NativePlaybackState, episode: Episode | null) {
  return state.durationMs ?? episode?.durationMs ?? null;
}

class AndroidPlaybackController {
  private activeEpisode: Episode | null = null;
  private leaseExpiresAt = 0;
  private lastStateReportAt = 0;
  private stateReportPromise: Promise<void> | null = null;
  private reportAgain = false;
  private castReportPromise: Promise<void> | null = null;
  private castReportAgain = false;
  private telemetryPromise: Promise<void> | null = null;
  private pendingPlaybackFlushPromise: Promise<void> | null = null;
  private completedEpisodeId: string | null = null;
  private playbackInstanceId = createCommandId();
  private telemetrySequence = 0;
  private listenedSinceTelemetry = 0;
  private lastListeningSampleAt = Date.now();
  private lastTelemetryAt = Date.now();
  private lastNativeState: NativePlaybackState | null = null;
  private lastCastState: NativeCastState | null = null;
  private castBackendActive = false;
  private endingCast = false;
  private lastCastReportAt = 0;
  private offlinePlayback = false;
  private handlingRemoteCommand = false;

  public async ensureNotificationPermission(): Promise<boolean> {
    return ensureNotificationPermission();
  }

  public async playEpisode(
    episode: Episode,
    forceLocal = false,
  ): Promise<void> {
    if (!forceLocal && this.remotePlayback()) {
      await this.relayRemoteCommand({
        commandId: createCommandId(),
        action: "play-episode",
        episodeId: episode.id,
      });
      return;
    }

    const playbackEpisode: Episode = episode.played
      ? { ...episode, positionMs: 0, played: false, playedAt: null }
      : episode;
    const localPath = downloadedPath(playbackEpisode.id);
    if (!playbackEpisode.enclosureUrl && !localPath) {
      throw new Error("This episode does not have a playable audio enclosure.");
    }
    await this.ensureNotificationPermission();
    const cast = useNativeMediaStore.getState().castState;
    if (cast.connected) {
      this.activeEpisode = playbackEpisode;
      this.completedEpisodeId = null;
      this.resetTelemetry();
      await PodwaffleMediaModule.startCast(
        episodeMedia(playbackEpisode, this.queueItemId(playbackEpisode.id)),
        playbackEpisode.positionMs,
        true,
      );
      const clearedPendingCompletion =
        await this.clearPendingCompletionForReplay(playbackEpisode.id).catch(
          () => false,
        );
      if (clearedPendingCompletion) {
        void this.reportCastState(true).catch(() => undefined);
      }
      return;
    }

    const current = useNativeMediaStore.getState().state;
    if (
      current?.episodeId === playbackEpisode.id &&
      current.playbackStatus !== "idle" &&
      current.playbackStatus !== "ended"
    ) {
      this.activeEpisode = playbackEpisode;
      this.completedEpisodeId = null;
      await this.play();
      const clearedPendingCompletion =
        await this.clearPendingCompletionForReplay(playbackEpisode.id).catch(
          () => false,
        );
      if (clearedPendingCompletion) {
        void this.reportCurrentState(true).catch(() => undefined);
      }
      return;
    }

    const { serverUrl, token } = this.connection();
    const playbackRate = current?.playbackRate ?? 1;
    let leaseAcquired = false;
    if (localPath && useAuthStore.getState().connection === "offline") {
      this.offlinePlayback = true;
      this.leaseExpiresAt = 0;
    } else {
      try {
        const acquired = await api.acquirePlayback(serverUrl, token, {
          episodeId: playbackEpisode.id,
          positionMs: playbackEpisode.positionMs,
          durationMs: playbackEpisode.durationMs,
          playbackRate,
        });
        this.setLeaseExpiry(acquired.leaseExpiresAt);
        this.offlinePlayback = false;
        leaseAcquired = true;
      } catch (error) {
        if (!localPath) throw error;
        this.offlinePlayback = true;
        this.leaseExpiresAt = 0;
      }
    }
    this.activeEpisode = playbackEpisode;
    this.completedEpisodeId = null;
    this.resetTelemetry();

    try {
      await this.syncNativeQueue(playbackEpisode.id);
      await PodwaffleMediaModule.playEpisode(
        episodeMedia(playbackEpisode, this.queueItemId(playbackEpisode.id)),
        playbackEpisode.positionMs,
      );
      const clearedPendingCompletion =
        await this.clearPendingCompletionForReplay(playbackEpisode.id).catch(
          () => false,
        );
      if (clearedPendingCompletion) {
        await this.syncNativeQueue(playbackEpisode.id).catch(() => undefined);
      }
      void this.reportCurrentState(true, {
        episodeId: playbackEpisode.id,
        positionMs: playbackEpisode.positionMs,
        durationMs: playbackEpisode.durationMs,
        state: "playing",
        playbackRate,
      }).catch(() => undefined);
    } catch (error) {
      if (leaseAcquired) {
        await api.releasePlayback(serverUrl, token).catch(() => undefined);
      }
      this.activeEpisode = null;
      this.leaseExpiresAt = 0;
      throw error;
    }
  }

  public async playDownloaded(download: NativeDownload): Promise<void> {
    if (download.state !== "completed" || !download.localPath) {
      throw new Error("The episode download is not ready.");
    }
    const profileId =
      useAuthStore.getState().session?.profile.id ??
      useAuthStore.getState().snapshot?.profile.id;
    const pending = profileId
      ? (await pendingPlaybackUpdates(profileId)).find(
          (item) => item.episodeId === download.episodeId,
        )
      : undefined;
    const cached = await this.resolveEpisode(download.episodeId);
    const pendingPositionMs = pending?.completed
      ? 0
      : (pending?.positionMs ?? 0);
    const episode: Episode = cached ?? {
      id: download.episodeId,
      podcastId: download.podcastId,
      podcastTitle: download.podcastTitle,
      title: download.title,
      descriptionHtml: null,
      enclosureUrl: download.enclosureUrl,
      enclosureType: download.enclosureType,
      publishedAt: null,
      firstDiscoveredAt: download.downloadedAt ?? new Date().toISOString(),
      durationMs: download.durationMs,
      artworkUrl: download.artworkUrl,
      episodeUrl: null,
      positionMs: pendingPositionMs,
      played: false,
      playedAt: null,
      manualPlayState: "none",
      lastPlayedAt: null,
    };
    const replaying = episode.played || pending?.completed === true;
    await this.playEpisode({
      ...episode,
      positionMs: replaying
        ? 0
        : Math.max(episode.positionMs, pendingPositionMs),
      played: replaying ? false : episode.played,
      playedAt: replaying ? null : episode.playedAt,
      durationMs: episode.durationMs ?? download.durationMs,
      enclosureUrl: episode.enclosureUrl ?? download.enclosureUrl,
      enclosureType: episode.enclosureType ?? download.enclosureType,
    });
  }

  public async play(): Promise<void> {
    if (this.remotePlayback()) {
      await this.relayRemoteCommand({
        commandId: createCommandId(),
        action: "play",
      });
      return;
    }
    const cast = useNativeMediaStore.getState().castState;
    if (cast.connected) {
      await PodwaffleMediaModule.castPlay();
      return;
    }
    let state = useNativeMediaStore.getState().state;
    if (!state?.episodeId) {
      const shared = useAuthStore.getState().snapshot?.playback;
      if (shared?.episode) {
        await this.playEpisode({
          ...shared.episode,
          positionMs: shared.positionMs,
          durationMs: shared.durationMs ?? shared.episode.durationMs,
        });
      }
      return;
    }

    // Native playback is authoritative on the device. Start immediately and let
    // lease renewal/reporting continue without blocking the transport control.
    await PodwaffleMediaModule.play();
    state = useNativeMediaStore.getState().state ?? state;
    if (!state.episodeId) return;
    void this.reportCurrentState(true, {
      episodeId: state.episodeId,
      positionMs: state.positionMs,
      durationMs: durationFor(state, this.activeEpisode),
      state: "playing",
      playbackRate: state.playbackRate,
    }).catch(() => undefined);
  }

  public async pause(): Promise<void> {
    if (this.remotePlayback()) {
      await this.relayRemoteCommand({
        commandId: createCommandId(),
        action: "pause",
      });
      return;
    }
    const cast = useNativeMediaStore.getState().castState;
    if (cast.connected) {
      this.sampleListening();
      await PodwaffleMediaModule.castPause();
      void this.flushTelemetry().catch(() => undefined);
      return;
    }
    const state = useNativeMediaStore.getState().state;
    if (!state?.episodeId) return;
    this.sampleListening();
    await PodwaffleMediaModule.pause();
    void this.reportCurrentState(true, {
      episodeId: state.episodeId,
      positionMs: state.positionMs,
      durationMs: durationFor(state, this.activeEpisode),
      state: "paused",
      playbackRate: state.playbackRate,
    }).catch(() => undefined);
    void this.flushTelemetry().catch(() => undefined);
  }

  public async stop(): Promise<void> {
    if (useNativeMediaStore.getState().castState.connected) {
      await this.stopCasting(false);
    }
    const state = useNativeMediaStore.getState().state;
    if (!state?.episodeId) return;
    this.sampleListening();
    await PodwaffleMediaModule.stop();
    await this.reportCurrentState(true, {
      episodeId: state.episodeId,
      positionMs: state.positionMs,
      durationMs: durationFor(state, this.activeEpisode),
      state: "stopped",
      playbackRate: state.playbackRate,
    });
    await this.flushTelemetry();
    const { serverUrl, token } = this.connection();
    await api.releasePlayback(serverUrl, token).catch(() => undefined);
    this.leaseExpiresAt = 0;
  }

  public async seekTo(
    positionMs: number,
    type: "seek" | "skip-forward" | "skip-backward" = "seek",
  ): Promise<void> {
    if (this.remotePlayback()) {
      await this.relayRemoteCommand({
        commandId: createCommandId(),
        action: "seek",
        positionMs: Math.max(0, positionMs),
      });
      return;
    }
    const state = useNativeMediaStore.getState().state;
    if (!state?.episodeId) return;
    const durationMs = durationFor(state, this.activeEpisode);
    const requestedPositionMs = Math.max(
      0,
      Math.min(positionMs, durationMs ?? Number.MAX_SAFE_INTEGER),
    );
    const cast = useNativeMediaStore.getState().castState;
    if (cast.connected) {
      await PodwaffleMediaModule.castSeek(requestedPositionMs);
      return;
    }

    await PodwaffleMediaModule.seekTo(requestedPositionMs);
    void (async () => {
      try {
        await this.ensureLease(state);
        if (!this.offlinePlayback) {
          const { serverUrl, token } = this.connection();
          await api.movement(serverUrl, token, {
            commandId: createCommandId(),
            episodeId: state.episodeId!,
            type,
            fromPositionMs: state.positionMs,
            requestedPositionMs,
            confirmedPositionMs: requestedPositionMs,
          });
        }
        await this.reportCurrentState(true, {
          episodeId: state.episodeId!,
          positionMs: requestedPositionMs,
          durationMs,
          state: localPlaybackState(state),
          playbackRate: state.playbackRate,
        });
      } catch {
        if (this.hasLocalMedia(state)) {
          this.offlinePlayback = true;
          this.leaseExpiresAt = 0;
          await this.saveOfflinePlayback(
            {
              episodeId: state.episodeId!,
              positionMs: requestedPositionMs,
              durationMs,
              state: localPlaybackState(state),
              playbackRate: state.playbackRate,
            },
            false,
          );
        }
      }
    })();
  }

  public async skipBackward(): Promise<void> {
    const offsetMs = useAuthStore.getState().skipBackwardSeconds * 1_000;
    if (this.remotePlayback()) {
      await this.relayRemoteCommand({
        commandId: createCommandId(),
        action: "skip-backward",
        offsetMs,
      });
      return;
    }
    const state = useNativeMediaStore.getState().state;
    if (!state?.episodeId) return;
    await this.seekTo(state.positionMs - offsetMs, "skip-backward");
  }

  public async skipForward(): Promise<void> {
    const offsetMs = useAuthStore.getState().skipForwardSeconds * 1_000;
    if (this.remotePlayback()) {
      await this.relayRemoteCommand({
        commandId: createCommandId(),
        action: "skip-forward",
        offsetMs,
      });
      return;
    }
    const state = useNativeMediaStore.getState().state;
    if (!state?.episodeId) return;
    await this.seekTo(state.positionMs + offsetMs, "skip-forward");
  }

  public async next(): Promise<void> {
    if (this.remotePlayback()) {
      await this.relayRemoteCommand({
        commandId: createCommandId(),
        action: "next",
      });
      return;
    }
    const queue = useAuthStore.getState().snapshot?.queue ?? [];
    const state = useNativeMediaStore.getState().state;
    const index = queue.findIndex(
      (item) => item.episode.id === state?.episodeId,
    );
    const next = queue[index >= 0 ? index + 1 : 0]?.episode;
    if (next) await this.playEpisode(next);
    else if (!useNativeMediaStore.getState().castState.connected)
      await PodwaffleMediaModule.next();
  }

  public async previous(): Promise<void> {
    if (this.remotePlayback()) {
      await this.relayRemoteCommand({
        commandId: createCommandId(),
        action: "previous",
      });
      return;
    }
    const state = useNativeMediaStore.getState().state;
    if (state && state.positionMs > 10_000) {
      await this.seekTo(0);
      return;
    }
    const queue = useAuthStore.getState().snapshot?.queue ?? [];
    const index = queue.findIndex(
      (item) => item.episode.id === state?.episodeId,
    );
    const previous = index > 0 ? queue[index - 1]?.episode : undefined;
    if (previous) await this.playEpisode(previous);
    else if (!useNativeMediaStore.getState().castState.connected)
      await PodwaffleMediaModule.previous();
  }

  public async setPlaybackRate(rate: number): Promise<void> {
    const state = useNativeMediaStore.getState().state;
    if (!state?.episodeId || state.source === "cast") return;
    const nextRate = Math.max(0.5, Math.min(4, rate));
    await PodwaffleMediaModule.setPlaybackRate(nextRate);
    void this.reportCurrentState(true, {
      episodeId: state.episodeId,
      positionMs: state.positionMs,
      durationMs: durationFor(state, this.activeEpisode),
      state: localPlaybackState(state),
      playbackRate: nextRate,
    }).catch(() => undefined);
  }

  public async startCasting(): Promise<void> {
    if (this.remotePlayback()) {
      throw new Error("Move playback to this device before starting Cast.");
    }
    const state = useNativeMediaStore.getState().state;
    if (!state?.episodeId)
      throw new Error("Load an episode before starting Cast.");
    const episode = await this.resolveEpisode(state.episodeId);
    if (!episode) throw new Error("The active episode could not be loaded.");
    usePlayerUiStore.getState().setCastStatus("connecting");
    this.activeEpisode = episode;
    await PodwaffleMediaModule.pause();
    try {
      await PodwaffleMediaModule.startCast(
        episodeMedia(episode, state.queueItemId),
        state.positionMs,
        state.playWhenReady,
      );
    } catch (error) {
      usePlayerUiStore
        .getState()
        .setCastStatus(
          "error",
          error instanceof Error ? error.message : "Cast could not be started.",
        );
      throw error;
    }
  }

  public async stopCasting(resumeLocal = true): Promise<void> {
    const cast = useNativeMediaStore.getState().castState;
    const session = cast.session;
    if (!cast.connected || !session) return;
    this.endingCast = true;
    usePlayerUiStore.getState().setCastStatus("stopping");
    try {
      await PodwaffleMediaModule.stopCast({ stopReceiver: true });
      await this.stopBackendCast(
        session.positionMs,
        session.durationMs,
        "paused",
      );
      this.castBackendActive = false;
      if (resumeLocal) {
        await PodwaffleMediaModule.seekTo(session.positionMs);
        if (session.playerState === "playing") {
          await PodwaffleMediaModule.play();
        } else {
          await PodwaffleMediaModule.pause();
        }
      }
      usePlayerUiStore.getState().setCastStatus("idle");
    } finally {
      this.endingCast = false;
    }
  }

  public handleNativeState(state: NativePlaybackState): void {
    this.sampleListening();
    this.lastNativeState = state;
    if (state.episodeId && this.activeEpisode?.id !== state.episodeId) {
      void this.resolveEpisode(state.episodeId).then((episode) => {
        if (episode) this.activeEpisode = episode;
      });
    }
    if (state.playbackStatus === "ended" && state.episodeId) {
      void this.finishEpisode({
        episodeId: state.episodeId,
        positionMs: state.positionMs,
        durationMs: durationFor(state, this.activeEpisode),
      });
      return;
    }
    if (state.episodeId && state.source !== "cast") {
      void this.reportCurrentState(true).catch(() => undefined);
    }
  }

  public handleNativeCompletion(completion: NativeEpisodeCompletion): void {
    void this.finishEpisode(completion);
  }

  public handleNativePosition(): void {
    this.sampleListening();
    const now = Date.now();
    if (
      !useNativeMediaStore.getState().castState.connected &&
      now - this.lastStateReportAt >= playbackSyncPolicy.stateReportIntervalMs
    ) {
      void this.reportCurrentState().catch(() => undefined);
    }
    if (now - this.lastTelemetryAt >= playbackSyncPolicy.telemetryIntervalMs) {
      void this.flushTelemetry();
    }
  }

  public handleCastState(castState: NativeCastState): void {
    const previous = this.lastCastState;
    this.lastCastState = castState;
    useNativeMediaStore.getState().updateCastState(castState);
    this.sampleListening();

    if (castState.connected && castState.session) {
      usePlayerUiStore.getState().setCastStatus("connected");
      if (
        castState.session.episodeId &&
        this.activeEpisode?.id !== castState.session.episodeId
      ) {
        void this.resolveEpisode(castState.session.episodeId).then(
          (episode) => {
            if (episode) this.activeEpisode = episode;
          },
        );
      }
      void this.reportCastState(!this.castBackendActive);
      const session = castState.session;
      if (
        session.playerState === "idle" &&
        session.durationMs &&
        session.positionMs >= session.durationMs - 2_000
      ) {
        void this.finishEpisode({
          episodeId: session.episodeId ?? this.activeEpisode?.id ?? "",
          positionMs: session.positionMs,
          durationMs:
            session.durationMs ?? this.activeEpisode?.durationMs ?? null,
        });
      }
      return;
    }

    if (previous?.connected && previous.session && !this.endingCast) {
      void this.restoreLocalAfterCast(previous);
      return;
    }

    if (
      !castState.connecting &&
      usePlayerUiStore.getState().castStatus === "connecting"
    ) {
      usePlayerUiStore.getState().setCastStatus("idle");
    }
  }

  public async handleCastCancellation(_reason: string): Promise<void> {
    const state = useNativeMediaStore.getState().state;
    const position = state?.positionMs ?? 0;
    await PodwaffleMediaModule.stopCast({ stopReceiver: false }).catch(
      () => undefined,
    );
    this.castBackendActive = false;
    if (state?.episodeId) {
      await PodwaffleMediaModule.seekTo(position).catch(() => undefined);
      await PodwaffleMediaModule.pause().catch(() => undefined);
    }
    usePlayerUiStore.getState().setCastStatus("idle");
  }

  public async handleRemotePlaybackCommand(
    command: PlaybackCommand & { requestedByDeviceId: string },
  ): Promise<{
    status: "accepted" | "rejected";
    confirmed?: CastConfirmedState;
    message?: string;
  }> {
    this.handlingRemoteCommand = true;
    try {
      if (command.action === "play-episode") {
        if (!command.episodeId)
          throw new Error("The requested episode is missing.");
        const episode = await this.resolveEpisode(command.episodeId);
        if (!episode)
          throw new Error("The requested episode could not be loaded.");
        await this.playEpisode(episode, true);
      } else if (command.action === "play") {
        await this.play();
      } else if (command.action === "pause") {
        await this.pause();
      } else if (
        command.action === "seek" &&
        command.positionMs !== undefined
      ) {
        await this.seekTo(command.positionMs);
      } else if (command.action === "skip-forward") {
        const state = useNativeMediaStore.getState().state;
        if (state)
          await this.seekTo(state.positionMs + (command.offsetMs ?? 30_000));
      } else if (command.action === "skip-backward") {
        const state = useNativeMediaStore.getState().state;
        if (state)
          await this.seekTo(state.positionMs - (command.offsetMs ?? 15_000));
      } else if (command.action === "next") {
        await this.next();
      } else if (command.action === "previous") {
        await this.previous();
      }

      const cast = await PodwaffleMediaModule.getCastState().catch(() => null);
      if (cast?.connected && cast.session) {
        this.handleCastState(cast);
        return { status: "accepted", confirmed: this.confirmedCastState(cast) };
      }
      await this.reportCurrentState(true);
      return { status: "accepted" };
    } catch (error) {
      return {
        status: "rejected",
        message:
          error instanceof Error ? error.message : "Playback command failed.",
      };
    } finally {
      this.handlingRemoteCommand = false;
    }
  }

  public async takeOverPlayback(): Promise<void> {
    const playback = useAuthStore.getState().snapshot?.playback;
    if (!playback?.episode)
      throw new Error("There is no shared playback to move.");
    const episode: Episode = {
      ...playback.episode,
      positionMs: playback.positionMs,
      durationMs: playback.durationMs ?? playback.episode.durationMs,
    };
    await this.playEpisode(episode, true);
    if (playback.state !== "playing") await this.pause();
    await useAuthStore.getState().refresh();
  }

  public applySharedPlayback(playback: PlaybackState | null): void {
    const currentDeviceId = useAuthStore.getState().session?.device.id;
    if (!isRemotePlayback(playback, currentDeviceId)) return;
    const native = useNativeMediaStore.getState().state;
    if (!native?.episodeId) return;
    const cast = useNativeMediaStore.getState().castState;
    if (cast.connected) {
      void PodwaffleMediaModule.stopCast({ stopReceiver: true }).catch(
        () => undefined,
      );
    } else if (native.playWhenReady) {
      void PodwaffleMediaModule.pause().catch(() => undefined);
    }
  }

  public async flush(): Promise<void> {
    await this.flushPendingPlayback().catch(() => undefined);
    this.sampleListening();
    if (useNativeMediaStore.getState().castState.connected) {
      await this.reportCastState(true).catch(() => undefined);
    } else {
      await this.reportCurrentState(true).catch(() => undefined);
    }
    await this.flushTelemetry().catch(() => undefined);
  }

  public async syncNativeQueue(currentEpisodeId?: string): Promise<void> {
    const auth = useAuthStore.getState();
    const snapshot = auth.snapshot;
    const profileId = auth.session?.profile.id ?? snapshot?.profile.id;
    const pending = profileId ? await pendingPlaybackUpdates(profileId) : [];
    const completedIds = pendingCompletionEpisodeIds(pending, null);
    for (const episodeId of staleCompletedQueueEpisodeIds(
      snapshot?.queue ?? [],
    )) {
      completedIds.add(episodeId);
    }
    const queue = queueWithoutPendingCompletions(
      snapshot?.queue ?? [],
      pending,
      null,
    );
    await useAuthStore
      .getState()
      .removeQueueEpisodesLocally([...completedIds])
      .catch(() => undefined);
    const activeId =
      currentEpisodeId ??
      useNativeMediaStore.getState().state?.episodeId ??
      null;
    const items = queue
      .filter((item) => Boolean(item.episode.enclosureUrl))
      .map((item) => episodeMedia(item.episode, item.id));

    if (
      activeId &&
      activeId !== this.completedEpisodeId &&
      !completedIds.has(activeId) &&
      !items.some((item) => item.episodeId === activeId)
    ) {
      const active =
        this.activeEpisode?.id === activeId
          ? this.activeEpisode
          : await this.resolveEpisode(activeId);
      if (active?.enclosureUrl) items.unshift(episodeMedia(active, null));
    }

    const currentIndex = Math.max(
      0,
      items.findIndex((item) => item.episodeId === activeId),
    );
    await PodwaffleMediaModule.setQueue({ currentIndex, items });
  }

  public reset(): void {
    this.activeEpisode = null;
    this.leaseExpiresAt = 0;
    this.completedEpisodeId = null;
    this.lastNativeState = null;
    this.lastCastState = null;
    this.castBackendActive = false;
    this.offlinePlayback = false;
    this.listenedSinceTelemetry = 0;
  }

  private remotePlayback(): PlaybackState | null {
    if (this.handlingRemoteCommand) return null;
    const store = useAuthStore.getState();
    if (
      store.connection === "offline" &&
      useNativeMediaStore.getState().state?.episodeId
    ) {
      return null;
    }
    const playback = store.snapshot?.playback ?? null;
    return isRemotePlayback(playback, store.session?.device.id)
      ? playback
      : null;
  }

  private async relayRemoteCommand(command: PlaybackCommand): Promise<void> {
    const { serverUrl, token } = this.connection();
    const result = await api.playbackCommand(serverUrl, token, command);
    if (!result.delivered && result.status === "pending") {
      throw new Error(
        "The playing device is offline or not connected to live sync.",
      );
    }
  }

  private connection(): { serverUrl: string; token: string } {
    const credentials = useAuthStore.getState().credentials;
    if (!credentials)
      throw new Error("This device is not connected to Podwaffle.");
    return credentials;
  }

  private queueItemId(episodeId: string): string | null {
    return (
      useAuthStore
        .getState()
        .snapshot?.queue.find((item) => item.episode.id === episodeId)?.id ??
      null
    );
  }

  private async resolveEpisode(episodeId: string): Promise<Episode | null> {
    const snapshot = useAuthStore.getState().snapshot;
    const playbackEpisode = snapshot?.playback?.episode;
    const cached =
      playbackEpisode?.id === episodeId
        ? playbackEpisode
        : snapshot?.queue.find((item) => item.episode.id === episodeId)
            ?.episode;
    if (cached) return cached;
    try {
      const { serverUrl, token } = this.connection();
      return await api.episode(serverUrl, token, episodeId);
    } catch {
      return null;
    }
  }

  private hasLocalMedia(state: NativePlaybackState): boolean {
    return Boolean(
      state.episodeId &&
      (state.source === "download" || downloadedPath(state.episodeId)),
    );
  }

  private resetTelemetry(): void {
    this.playbackInstanceId = createCommandId();
    this.telemetrySequence = 0;
    this.listenedSinceTelemetry = 0;
    this.lastListeningSampleAt = Date.now();
    this.lastTelemetryAt = Date.now();
  }

  private sampleListening(): void {
    const now = Date.now();
    const elapsed = Math.max(
      0,
      Math.min(5_000, now - this.lastListeningSampleAt),
    );
    const state = useNativeMediaStore.getState().state ?? this.lastNativeState;
    if (
      state?.playWhenReady &&
      (state.playbackStatus === "ready" || state.playbackStatus === "buffering")
    ) {
      this.listenedSinceTelemetry += elapsed;
    }
    this.lastListeningSampleAt = now;
  }

  private async ensureLease(state: NativePlaybackState): Promise<void> {
    if (
      Date.now() <
      this.leaseExpiresAt - playbackSyncPolicy.leaseRenewalMarginMs
    ) {
      return;
    }
    if (
      useAuthStore.getState().connection === "offline" &&
      this.hasLocalMedia(state)
    ) {
      this.offlinePlayback = true;
      this.leaseExpiresAt = 0;
      return;
    }
    const { serverUrl, token } = this.connection();
    try {
      const playback = await api.acquirePlayback(serverUrl, token, {
        episodeId: state.episodeId ?? undefined,
        positionMs: state.positionMs,
        durationMs: durationFor(state, this.activeEpisode),
        playbackRate: state.playbackRate,
      });
      this.setLeaseExpiry(playback.leaseExpiresAt);
      this.offlinePlayback = false;
    } catch (error) {
      if (this.hasLocalMedia(state)) {
        this.offlinePlayback = true;
        this.leaseExpiresAt = 0;
        return;
      }
      throw error;
    }
  }

  private setLeaseExpiry(value: string | null): void {
    const parsed = value ? Date.parse(value) : Number.NaN;
    this.leaseExpiresAt = Number.isFinite(parsed)
      ? parsed
      : Date.now() + 40_000;
  }

  private async reportCurrentState(
    force = false,
    override?: {
      episodeId: string;
      positionMs: number;
      durationMs: number | null;
      state: "playing" | "paused" | "stopped";
      playbackRate: number;
    },
  ): Promise<void> {
    if (useNativeMediaStore.getState().castState.connected) return;
    if (
      !force &&
      Date.now() - this.lastStateReportAt <
        playbackSyncPolicy.stateReportIntervalMs
    ) {
      return;
    }
    if (this.stateReportPromise) {
      this.reportAgain ||= force;
      return this.stateReportPromise;
    }
    const native = useNativeMediaStore.getState().state;
    const body =
      override ??
      (native?.episodeId
        ? {
            episodeId: native.episodeId,
            positionMs: native.positionMs,
            durationMs: durationFor(native, this.activeEpisode),
            state: localPlaybackState(native),
            playbackRate: native.playbackRate,
          }
        : null);
    if (!body || body.episodeId === this.completedEpisodeId) return;

    const perform = async () => {
      if (await this.completionPending(body.episodeId)) return;
      const { serverUrl, token } = this.connection();
      if (native) await this.ensureLease(native);
      if (await this.completionPending(body.episodeId)) return;
      if (this.offlinePlayback) {
        await this.saveOfflinePlayback(body, false);
        this.lastStateReportAt = Date.now();
        return;
      }
      try {
        const result = await api.updatePlayback(serverUrl, token, body);
        this.setLeaseExpiry(result.playback.leaseExpiresAt);
        this.lastStateReportAt = Date.now();
      } catch (error) {
        if (
          error instanceof ApiClientError &&
          error.status === 409 &&
          error.body?.error.code === "PLAYBACK_LEASE_REQUIRED" &&
          native
        ) {
          if (await this.completionPending(body.episodeId)) return;
          this.leaseExpiresAt = 0;
          await this.ensureLease(native);
          if (await this.completionPending(body.episodeId)) return;
          const result = await api.updatePlayback(serverUrl, token, body);
          this.setLeaseExpiry(result.playback.leaseExpiresAt);
          this.lastStateReportAt = Date.now();
          return;
        }
        if (native?.source === "download" || downloadedPath(body.episodeId)) {
          if (await this.completionPending(body.episodeId)) return;
          this.offlinePlayback = true;
          this.leaseExpiresAt = 0;
          await this.saveOfflinePlayback(body, false);
          this.lastStateReportAt = Date.now();
          return;
        }
        throw error;
      }
    };

    this.stateReportPromise = perform().finally(() => {
      this.stateReportPromise = null;
    });
    try {
      await this.stateReportPromise;
    } finally {
      if (this.reportAgain) {
        this.reportAgain = false;
        void this.reportCurrentState(true).catch(() => undefined);
      }
    }
  }

  private async reportCastState(
    force = false,
    allowedCompletedEpisodeId?: string,
  ): Promise<void> {
    const cast = useNativeMediaStore.getState().castState;
    const episodeId = this.activeEpisode?.id;
    if (!cast.connected || !cast.session || !episodeId) return;
    if (
      episodeId !== allowedCompletedEpisodeId &&
      (await this.completionPending(episodeId))
    ) {
      return;
    }
    if (
      !force &&
      Date.now() - this.lastCastReportAt <
        playbackSyncPolicy.stateReportIntervalMs
    ) {
      return;
    }
    if (this.castReportPromise) {
      this.castReportAgain = true;
      return this.castReportPromise;
    }

    const perform = async () => {
      if (
        episodeId !== allowedCompletedEpisodeId &&
        (await this.completionPending(episodeId))
      ) {
        return;
      }
      const currentCast = useNativeMediaStore.getState().castState;
      if (
        !currentCast.connected ||
        !currentCast.session ||
        this.activeEpisode?.id !== episodeId
      ) {
        return;
      }
      const { serverUrl, token } = this.connection();
      await api.startCast(
        serverUrl,
        token,
        this.confirmedCastState(currentCast),
      );
      this.castBackendActive = true;
      this.lastCastReportAt = Date.now();
    };

    const report = perform();
    this.castReportPromise = report;
    try {
      await report;
    } finally {
      if (this.castReportPromise === report) this.castReportPromise = null;
      if (this.castReportAgain) {
        this.castReportAgain = false;
        void this.reportCastState(true).catch(() => undefined);
      }
    }
  }

  private confirmedCastState(cast: NativeCastState): CastConfirmedState {
    const session = cast.session;
    if (!session || !this.activeEpisode) {
      throw new Error("The Cast receiver is not ready.");
    }
    return {
      episodeId: this.activeEpisode.id,
      positionMs: session.positionMs,
      durationMs: session.durationMs ?? this.activeEpisode.durationMs,
      state: session.playerState === "playing" ? "playing" : "paused",
      playbackRate: useNativeMediaStore.getState().state?.playbackRate ?? 1,
      castSessionId: session.sessionId,
      volume: session.volume,
      muted: session.muted,
    };
  }

  private async stopBackendCast(
    positionMs: number,
    durationMs: number | null,
    state: "playing" | "paused" | "stopped",
  ): Promise<void> {
    if (!this.castBackendActive) return;
    const { serverUrl, token } = this.connection();
    await api.stopCast(serverUrl, token, {
      positionMs,
      durationMs,
      state,
      playbackRate: useNativeMediaStore.getState().state?.playbackRate ?? 1,
    });
  }

  private async restoreLocalAfterCast(
    previous: NativeCastState,
  ): Promise<void> {
    const session = previous.session;
    if (!session) return;
    const resume = session.playerState === "playing";
    try {
      await this.stopBackendCast(
        session.positionMs,
        session.durationMs,
        resume ? "playing" : "paused",
      );
    } catch {
      // A server-side idle timeout may already have cleared the Cast owner.
    }
    this.castBackendActive = false;
    await PodwaffleMediaModule.seekTo(session.positionMs).catch(
      () => undefined,
    );
    if (resume) await PodwaffleMediaModule.play().catch(() => undefined);
    else await PodwaffleMediaModule.pause().catch(() => undefined);
    usePlayerUiStore.getState().setCastStatus("idle");
  }

  private async flushTelemetry(
    allowedCompletedEpisodeId?: string,
  ): Promise<void> {
    if (this.telemetryPromise) {
      await this.telemetryPromise;
      if (!allowedCompletedEpisodeId) return;
    }

    const perform = async () => {
      this.sampleListening();
      const state = useNativeMediaStore.getState().state;
      const listenedMs = Math.min(
        300_000,
        Math.round(this.listenedSinceTelemetry),
      );
      if (!state?.episodeId || listenedMs <= 0) {
        this.lastTelemetryAt = Date.now();
        return;
      }
      if (
        state.episodeId !== allowedCompletedEpisodeId &&
        (await this.completionPending(state.episodeId))
      ) {
        this.lastTelemetryAt = Date.now();
        return;
      }
      if (this.offlinePlayback) {
        this.lastTelemetryAt = Date.now();
        return;
      }
      this.listenedSinceTelemetry = Math.max(
        0,
        this.listenedSinceTelemetry - listenedMs,
      );
      this.lastTelemetryAt = Date.now();
      try {
        if (state.source !== "cast") {
          await this.ensureLease(state);
        } else {
          await this.reportCastState(true, allowedCompletedEpisodeId);
        }
        const { serverUrl, token } = this.connection();
        await api.telemetry(serverUrl, token, {
          playbackInstanceId: this.playbackInstanceId,
          sequence: this.telemetrySequence++,
          episodeId: state.episodeId,
          source: state.source === "cast" ? "cast" : "android-local",
          listenedMs,
          contentConsumedMs: Math.round(listenedMs * state.playbackRate),
        });
      } catch {
        this.listenedSinceTelemetry += listenedMs;
      }
    };

    const telemetry = perform();
    this.telemetryPromise = telemetry;
    try {
      await telemetry;
    } finally {
      if (this.telemetryPromise === telemetry) this.telemetryPromise = null;
    }
  }

  private async finishEpisode(completion: {
    episodeId: string;
    positionMs: number;
    durationMs: number | null;
  }): Promise<void> {
    if (
      !completion.episodeId ||
      this.completedEpisodeId === completion.episodeId
    ) {
      return;
    }
    this.completedEpisodeId = completion.episodeId;

    const nativeAtCompletion = useNativeMediaStore.getState().state;
    const durationMs =
      completion.durationMs ??
      nativeAtCompletion?.durationMs ??
      (this.activeEpisode?.id === completion.episodeId
        ? this.activeEpisode.durationMs
        : null);
    const completionState = {
      episodeId: completion.episodeId,
      positionMs: Math.max(completion.positionMs, durationMs ?? 0),
      durationMs,
      state: "stopped" as const,
      playbackRate: nativeAtCompletion?.playbackRate ?? 1,
    };

    // Record completion before any network operation. A process death or failed
    // response can then be retried without reintroducing the finished queue item.
    const pendingCompletion = await this.saveOfflinePlayback(
      completionState,
      true,
    ).catch(() => null);
    await useAuthStore
      .getState()
      .removeQueueEpisodesLocally([completion.episodeId])
      .catch(() => undefined);
    await this.syncNativeQueue(
      nativeAtCompletion?.episodeId ?? undefined,
    ).catch(() => undefined);

    let completed: Awaited<ReturnType<typeof api.completeEpisode>>;
    try {
      // Older state, Cast, retry and telemetry requests may already be waiting on
      // the network. Let them finish first so completion is the final
      // authoritative write and no late lease can restore the finished episode.
      const barriers = [
        this.stateReportPromise,
        this.castReportPromise,
        this.pendingPlaybackFlushPromise,
      ].filter((promise): promise is Promise<void> => promise !== null);
      await Promise.all(
        barriers.map((promise) => promise.catch(() => undefined)),
      );
      await this.flushTelemetry(completion.episodeId).catch(() => undefined);

      const { serverUrl, token } = this.connection();
      completed = await api.completeEpisode(
        serverUrl,
        token,
        completion.episodeId,
        completionState.positionMs,
        durationMs,
      );
    } catch {
      this.offlinePlayback = true;
      this.leaseExpiresAt = 0;
      const native = useNativeMediaStore.getState().state;
      const advanced = Boolean(
        native?.episodeId && native.episodeId !== completion.episodeId,
      );
      if (advanced && native?.episodeId) {
        const nextEpisode = await this.resolveEpisode(native.episodeId);
        if (nextEpisode) this.activeEpisode = nextEpisode;
        void this.reportCurrentState(true).catch(() => undefined);
      } else {
        this.activeEpisode = null;
        await PodwaffleMediaModule.stop().catch(() => undefined);
      }
      return;
    }

    this.offlinePlayback = false;
    const profileId =
      useAuthStore.getState().session?.profile.id ??
      useAuthStore.getState().snapshot?.profile.id;
    if (profileId && pendingCompletion) {
      await acknowledgePendingPlayback(profileId, pendingCompletion).catch(
        () => false,
      );
    }
    await useAuthStore
      .getState()
      .applyQueueMutation(completed.queue, completed.revision)
      .catch(() => undefined);

    if (useNativeMediaStore.getState().castState.connected) {
      await this.stopBackendCast(
        completionState.positionMs,
        durationMs,
        "stopped",
      ).catch(() => undefined);
      this.castBackendActive = false;
    } else {
      this.leaseExpiresAt = 0;
    }
    void useAuthStore
      .getState()
      .refresh()
      .catch(() => undefined);

    const native = useNativeMediaStore.getState().state;
    if (native?.episodeId && native.episodeId !== completion.episodeId) {
      const nativeEpisode =
        completed.queue.find((item) => item.episode.id === native.episodeId)
          ?.episode ?? (await this.resolveEpisode(native.episodeId));
      if (nativeEpisode) this.activeEpisode = nativeEpisode;
      void this.reportCurrentState(true).catch(() => undefined);
      return;
    }

    const nextEpisode = completed.queue[0]?.episode;
    if (nextEpisode) {
      await this.playEpisode(nextEpisode);
    } else {
      this.activeEpisode = null;
      if (useNativeMediaStore.getState().castState.connected) {
        await PodwaffleMediaModule.stopCast({ stopReceiver: true });
      } else {
        await PodwaffleMediaModule.stop();
      }
    }
  }

  public async flushPendingPlayback(): Promise<void> {
    if (this.pendingPlaybackFlushPromise) {
      return this.pendingPlaybackFlushPromise;
    }

    const perform = async () => {
      const auth = useAuthStore.getState();
      const profileId = auth.session?.profile.id ?? auth.snapshot?.profile.id;
      const credentials = auth.credentials;
      if (!profileId || !credentials) return;
      const pending = await pendingPlaybackUpdates(profileId);
      const ordered = [...pending].sort((left, right) => {
        const completionOrder =
          Number(right.completed) - Number(left.completed);
        if (completionOrder !== 0) return completionOrder;
        return left.updatedAt.localeCompare(right.updatedAt);
      });
      for (const update of ordered) {
        try {
          if (update.completed) {
            this.completedEpisodeId = update.episodeId;
            await useAuthStore
              .getState()
              .removeQueueEpisodesLocally([update.episodeId])
              .catch(() => undefined);
            await this.syncNativeQueue().catch(() => undefined);
            await api.completeEpisode(
              credentials.serverUrl,
              credentials.token,
              update.episodeId,
              update.positionMs,
              update.durationMs,
            );
          } else {
            if (await this.completionPending(update.episodeId)) continue;
            const lease = await api.acquirePlayback(
              credentials.serverUrl,
              credentials.token,
              {
                episodeId: update.episodeId,
                positionMs: update.positionMs,
                durationMs: update.durationMs,
                playbackRate: update.playbackRate,
              },
            );
            this.setLeaseExpiry(lease.leaseExpiresAt);
            if (await this.completionPending(update.episodeId)) continue;
            await api.updatePlayback(credentials.serverUrl, credentials.token, {
              episodeId: update.episodeId,
              positionMs: update.positionMs,
              durationMs: update.durationMs,
              state: update.state,
              playbackRate: update.playbackRate,
            });
          }
          await acknowledgePendingPlayback(profileId, update);
        } catch {
          this.offlinePlayback = true;
          return;
        }
      }
      if (pending.length > 0) {
        this.offlinePlayback = false;
        await useAuthStore
          .getState()
          .refresh()
          .catch(() => undefined);
      }
    };

    const flush = perform();
    this.pendingPlaybackFlushPromise = flush;
    try {
      await flush;
    } finally {
      if (this.pendingPlaybackFlushPromise === flush) {
        this.pendingPlaybackFlushPromise = null;
      }
    }
  }

  private async clearPendingCompletionForReplay(
    episodeId: string,
  ): Promise<boolean> {
    const auth = useAuthStore.getState();
    const profileId = auth.session?.profile.id ?? auth.snapshot?.profile.id;
    if (!profileId) return false;
    const cleared = await clearPendingCompletion(profileId, episodeId);
    if (cleared && this.completedEpisodeId === episodeId) {
      this.completedEpisodeId = null;
    }
    return cleared;
  }

  private async completionPending(episodeId: string): Promise<boolean> {
    if (this.completedEpisodeId === episodeId) return true;
    const auth = useAuthStore.getState();
    const profileId = auth.session?.profile.id ?? auth.snapshot?.profile.id;
    if (!profileId) return false;
    const pending = await pendingPlaybackUpdates(profileId);
    return pendingCompletionEpisodeIds(pending, this.completedEpisodeId).has(
      episodeId,
    );
  }

  private async saveOfflinePlayback(
    body: {
      episodeId: string;
      positionMs: number;
      durationMs: number | null;
      state: "playing" | "paused" | "stopped";
      playbackRate: number;
    },
    completed: boolean,
  ): Promise<PendingPlaybackUpdate | null> {
    const auth = useAuthStore.getState();
    const profileId = auth.session?.profile.id ?? auth.snapshot?.profile.id;
    if (!profileId) return null;
    return savePendingPlayback(profileId, { ...body, completed });
  }
}

export const playbackController = new AndroidPlaybackController();
