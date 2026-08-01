import type {
  CastConfirmedState,
  Episode,
  PlaybackCommand,
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
import { episodeMedia } from "./media";
import {
  pendingPlaybackUpdates,
  removePendingPlayback,
  savePendingPlayback,
} from "./offlineProgress";

const STATE_REPORT_INTERVAL_MS = 10_000;
const TELEMETRY_INTERVAL_MS = 15_000;
const LEASE_RENEWAL_MARGIN_MS = 15_000;
let notificationPermissionRequested = false;

async function ensureNotificationPermission(): Promise<void> {
  if (
    notificationPermissionRequested ||
    Platform.OS !== "android" ||
    Number(Platform.Version) < 33
  ) {
    return;
  }
  notificationPermissionRequested = true;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (!permission) return;
  await PermissionsAndroid.request(permission).catch(() => undefined);
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

  public async playEpisode(episode: Episode): Promise<void> {
    const localPath = downloadedPath(episode.id);
    if (!episode.enclosureUrl && !localPath) {
      throw new Error("This episode does not have a playable audio enclosure.");
    }
    await ensureNotificationPermission();
    const cast = useNativeMediaStore.getState().castState;
    if (cast.connected) {
      this.activeEpisode = episode;
      this.completedEpisodeId = null;
      this.resetTelemetry();
      await PodwaffleMediaModule.startCast(
        episodeMedia(episode, this.queueItemId(episode.id)),
        episode.positionMs,
        true,
      );
      return;
    }

    const current = useNativeMediaStore.getState().state;
    if (
      current?.episodeId === episode.id &&
      current.playbackStatus !== "idle" &&
      current.playbackStatus !== "ended"
    ) {
      this.activeEpisode = episode;
      await this.play();
      return;
    }

    const { serverUrl, token } = this.connection();
    const playbackRate = current?.playbackRate ?? 1;
    let leaseAcquired = false;
    try {
      const acquired = await api.acquirePlayback(serverUrl, token, {
        episodeId: episode.id,
        positionMs: episode.positionMs,
        durationMs: episode.durationMs,
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
    this.activeEpisode = episode;
    this.completedEpisodeId = null;
    this.resetTelemetry();

    try {
      await this.syncNativeQueue(episode.id);
      await PodwaffleMediaModule.playEpisode(
        episodeMedia(episode, this.queueItemId(episode.id)),
        episode.positionMs,
      );
      await this.reportCurrentState(true, {
        episodeId: episode.id,
        positionMs: episode.positionMs,
        durationMs: episode.durationMs,
        state: "playing",
        playbackRate,
      });
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
    const profileId = useAuthStore.getState().session?.profile.id ??
      useAuthStore.getState().snapshot?.profile.id;
    const pending = profileId
      ? (await pendingPlaybackUpdates(profileId)).find(
          (item) => item.episodeId === download.episodeId,
        )
      : undefined;
    const cached = await this.resolveEpisode(download.episodeId);
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
      positionMs: pending?.positionMs ?? 0,
      played: pending?.completed ?? false,
      playedAt: null,
      manualPlayState: "none",
      lastPlayedAt: null,
    };
    await this.playEpisode({
      ...episode,
      positionMs: Math.max(episode.positionMs, pending?.positionMs ?? 0),
      durationMs: episode.durationMs ?? download.durationMs,
      enclosureUrl: episode.enclosureUrl ?? download.enclosureUrl,
      enclosureType: episode.enclosureType ?? download.enclosureType,
    });
  }

  public async play(): Promise<void> {
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
    await this.ensureLease(state);
    await PodwaffleMediaModule.play();
    state = useNativeMediaStore.getState().state ?? state;
    if (!state.episodeId) return;
    await this.reportCurrentState(true, {
      episodeId: state.episodeId,
      positionMs: state.positionMs,
      durationMs: durationFor(state, this.activeEpisode),
      state: "playing",
      playbackRate: state.playbackRate,
    });
  }

  public async pause(): Promise<void> {
    const cast = useNativeMediaStore.getState().castState;
    if (cast.connected) {
      this.sampleListening();
      await PodwaffleMediaModule.castPause();
      await this.flushTelemetry();
      return;
    }
    const state = useNativeMediaStore.getState().state;
    if (!state?.episodeId) return;
    this.sampleListening();
    await PodwaffleMediaModule.pause();
    await this.reportCurrentState(true, {
      episodeId: state.episodeId,
      positionMs: state.positionMs,
      durationMs: durationFor(state, this.activeEpisode),
      state: "paused",
      playbackRate: state.playbackRate,
    });
    await this.flushTelemetry();
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
    await this.ensureLease(state);
    await PodwaffleMediaModule.seekTo(requestedPositionMs);
    if (!this.offlinePlayback) {
      const { serverUrl, token } = this.connection();
      await api.movement(serverUrl, token, {
        commandId: createCommandId(),
        episodeId: state.episodeId,
        type,
        fromPositionMs: state.positionMs,
        requestedPositionMs,
        confirmedPositionMs: requestedPositionMs,
      }).catch(() => undefined);
    }
    await this.reportCurrentState(true, {
      episodeId: state.episodeId,
      positionMs: requestedPositionMs,
      durationMs,
      state: localPlaybackState(state),
      playbackRate: state.playbackRate,
    });
  }

  public async skipBackward(): Promise<void> {
    const state = useNativeMediaStore.getState().state;
    if (!state?.episodeId) return;
    await this.seekTo(
      state.positionMs - useAuthStore.getState().skipBackwardSeconds * 1_000,
      "skip-backward",
    );
  }

  public async skipForward(): Promise<void> {
    const state = useNativeMediaStore.getState().state;
    if (!state?.episodeId) return;
    await this.seekTo(
      state.positionMs + useAuthStore.getState().skipForwardSeconds * 1_000,
      "skip-forward",
    );
  }

  public async next(): Promise<void> {
    const queue = useAuthStore.getState().snapshot?.queue ?? [];
    const state = useNativeMediaStore.getState().state;
    const index = queue.findIndex((item) => item.episode.id === state?.episodeId);
    const next = queue[index >= 0 ? index + 1 : 0]?.episode;
    if (next) await this.playEpisode(next);
    else if (!useNativeMediaStore.getState().castState.connected)
      await PodwaffleMediaModule.next();
  }

  public async previous(): Promise<void> {
    const state = useNativeMediaStore.getState().state;
    if (state && state.positionMs > 10_000) {
      await this.seekTo(0);
      return;
    }
    const queue = useAuthStore.getState().snapshot?.queue ?? [];
    const index = queue.findIndex((item) => item.episode.id === state?.episodeId);
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
    await this.reportCurrentState(true, {
      episodeId: state.episodeId,
      positionMs: state.positionMs,
      durationMs: durationFor(state, this.activeEpisode),
      state: localPlaybackState(state),
      playbackRate: nextRate,
    });
  }

  public async startCasting(): Promise<void> {
    const state = useNativeMediaStore.getState().state;
    if (!state?.episodeId) throw new Error("Load an episode before starting Cast.");
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
      await this.stopBackendCast(session.positionMs, session.durationMs, "paused");
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
      void this.reportCurrentState(true);
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
      now - this.lastStateReportAt >= STATE_REPORT_INTERVAL_MS
    ) {
      void this.reportCurrentState();
    }
    if (now - this.lastTelemetryAt >= TELEMETRY_INTERVAL_MS) {
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
      if (castState.session.episodeId && this.activeEpisode?.id !== castState.session.episodeId) {
        void this.resolveEpisode(castState.session.episodeId).then((episode) => {
          if (episode) this.activeEpisode = episode;
        });
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
          durationMs: session.durationMs ?? this.activeEpisode?.durationMs ?? null,
        });
      }
      return;
    }

    if (previous?.connected && previous.session && !this.endingCast) {
      void this.restoreLocalAfterCast(previous);
      return;
    }

    if (!castState.connecting && usePlayerUiStore.getState().castStatus === "connecting") {
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

  public async handleRemoteCastCommand(
    command: PlaybackCommand & { requestedByDeviceId: string },
  ): Promise<{
    status: "accepted" | "rejected";
    confirmed?: CastConfirmedState;
    message?: string;
  }> {
    try {
      const cast = useNativeMediaStore.getState().castState;
      if (!cast.connected || !cast.session) {
        throw new Error("This Android device does not own an active Cast session.");
      }
      if (command.action === "play") await PodwaffleMediaModule.castPlay();
      if (command.action === "pause") await PodwaffleMediaModule.castPause();
      if (command.action === "seek" && command.positionMs !== undefined) {
        await PodwaffleMediaModule.castSeek(command.positionMs);
      }
      if (
        command.action === "skip-forward" ||
        command.action === "skip-backward"
      ) {
        const direction = command.action === "skip-forward" ? 1 : -1;
        await PodwaffleMediaModule.castSeek(
          Math.max(
            0,
            cast.session.positionMs + direction * (command.offsetMs ?? 0),
          ),
        );
      }
      if (command.action === "next") await this.next();
      if (command.action === "previous") await this.previous();
      const confirmed = await PodwaffleMediaModule.getCastState();
      if (!confirmed.session) throw new Error("The Cast receiver did not confirm the command.");
      this.handleCastState(confirmed);
      return { status: "accepted", confirmed: this.confirmedCastState(confirmed) };
    } catch (error) {
      return {
        status: "rejected",
        message: error instanceof Error ? error.message : "Cast command failed.",
      };
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
    const snapshot = useAuthStore.getState().snapshot;
    const queue = snapshot?.queue ?? [];
    const activeId =
      currentEpisodeId ?? useNativeMediaStore.getState().state?.episodeId ?? null;
    const items = queue
      .filter((item) => Boolean(item.episode.enclosureUrl))
      .map((item) => episodeMedia(item.episode, item.id));

    if (activeId && !items.some((item) => item.episodeId === activeId)) {
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

  private connection(): { serverUrl: string; token: string } {
    const credentials = useAuthStore.getState().credentials;
    if (!credentials) throw new Error("This device is not connected to Podwaffle.");
    return credentials;
  }

  private queueItemId(episodeId: string): string | null {
    return (
      useAuthStore
        .getState()
        .snapshot?.queue.find((item) => item.episode.id === episodeId)?.id ?? null
    );
  }

  private async resolveEpisode(episodeId: string): Promise<Episode | null> {
    const snapshot = useAuthStore.getState().snapshot;
    const cached =
      snapshot?.playback?.episode?.id === episodeId
        ? snapshot.playback.episode
        : snapshot?.queue.find((item) => item.episode.id === episodeId)?.episode;
    if (cached) return cached;
    try {
      const { serverUrl, token } = this.connection();
      return await api.episode(serverUrl, token, episodeId);
    } catch {
      return null;
    }
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
    const elapsed = Math.max(0, Math.min(5_000, now - this.lastListeningSampleAt));
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
    if (Date.now() < this.leaseExpiresAt - LEASE_RENEWAL_MARGIN_MS) return;
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
      if (state.episodeId && downloadedPath(state.episodeId)) {
        this.offlinePlayback = true;
        this.leaseExpiresAt = 0;
        return;
      }
      throw error;
    }
  }

  private setLeaseExpiry(value: string | null): void {
    const parsed = value ? Date.parse(value) : Number.NaN;
    this.leaseExpiresAt = Number.isFinite(parsed) ? parsed : Date.now() + 40_000;
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
    if (!force && Date.now() - this.lastStateReportAt < STATE_REPORT_INTERVAL_MS) return;
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
    if (!body) return;

    const perform = async () => {
      const { serverUrl, token } = this.connection();
      if (native) await this.ensureLease(native);
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
          this.leaseExpiresAt = 0;
          await this.ensureLease(native);
          const result = await api.updatePlayback(serverUrl, token, body);
          this.setLeaseExpiry(result.playback.leaseExpiresAt);
          this.lastStateReportAt = Date.now();
          return;
        }
        if (downloadedPath(body.episodeId)) {
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
        void this.reportCurrentState(true);
      }
    }
  }

  private async reportCastState(force = false): Promise<void> {
    const cast = useNativeMediaStore.getState().castState;
    if (!cast.connected || !cast.session || !this.activeEpisode) return;
    if (!force && Date.now() - this.lastCastReportAt < STATE_REPORT_INTERVAL_MS) return;
    const { serverUrl, token } = this.connection();
    await api.startCast(serverUrl, token, this.confirmedCastState(cast));
    this.castBackendActive = true;
    this.lastCastReportAt = Date.now();
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

  private async restoreLocalAfterCast(previous: NativeCastState): Promise<void> {
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
    await PodwaffleMediaModule.seekTo(session.positionMs).catch(() => undefined);
    if (resume) await PodwaffleMediaModule.play().catch(() => undefined);
    else await PodwaffleMediaModule.pause().catch(() => undefined);
    usePlayerUiStore.getState().setCastStatus("idle");
  }

  private async flushTelemetry(): Promise<void> {
    this.sampleListening();
    const state = useNativeMediaStore.getState().state;
    const listenedMs = Math.min(300_000, Math.round(this.listenedSinceTelemetry));
    if (!state?.episodeId || listenedMs <= 0) {
      this.lastTelemetryAt = Date.now();
      return;
    }
    if (this.offlinePlayback) {
      this.lastTelemetryAt = Date.now();
      return;
    }
    this.listenedSinceTelemetry = Math.max(0, this.listenedSinceTelemetry - listenedMs);
    this.lastTelemetryAt = Date.now();
    try {
      if (state.source !== "cast") await this.ensureLease(state);
      else await this.reportCastState(true);
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
    try {
      await this.flushTelemetry();
      const { serverUrl, token } = this.connection();
      const durationMs = completion.durationMs;
      const completed = await api.completeEpisode(
        serverUrl,
        token,
        completion.episodeId,
        Math.max(completion.positionMs, durationMs ?? 0),
        durationMs,
      );
      if (useNativeMediaStore.getState().castState.connected) {
        await this.stopBackendCast(
          completion.positionMs,
          durationMs,
          "stopped",
        ).catch(
          () => undefined,
        );
        this.castBackendActive = false;
      } else {
        await api.releasePlayback(serverUrl, token).catch(() => undefined);
        this.leaseExpiresAt = 0;
      }
      await useAuthStore.getState().refresh();
      const nextEpisode = completed.queue[0]?.episode;
      if (nextEpisode) await this.playEpisode(nextEpisode);
      else {
        this.activeEpisode = null;
        if (useNativeMediaStore.getState().castState.connected) {
          await PodwaffleMediaModule.stopCast({ stopReceiver: true });
        } else {
          await PodwaffleMediaModule.stop();
        }
      }
    } catch {
      if (downloadedPath(completion.episodeId)) {
        this.offlinePlayback = true;
        await this.saveOfflinePlayback(
          {
            episodeId: completion.episodeId,
            positionMs: Math.max(completion.positionMs, completion.durationMs ?? 0),
            durationMs: completion.durationMs,
            state: "stopped",
            playbackRate:
              useNativeMediaStore.getState().state?.playbackRate ?? 1,
          },
          true,
        );
        await PodwaffleMediaModule.stop().catch(() => undefined);
        return;
      }
      this.completedEpisodeId = null;
    }
  }

  public async flushPendingPlayback(): Promise<void> {
    const auth = useAuthStore.getState();
    const profileId = auth.session?.profile.id ?? auth.snapshot?.profile.id;
    const credentials = auth.credentials;
    if (!profileId || !credentials) return;
    const pending = await pendingPlaybackUpdates(profileId);
    for (const update of pending) {
      try {
        if (update.completed) {
          await api.completeEpisode(
            credentials.serverUrl,
            credentials.token,
            update.episodeId,
            update.positionMs,
            update.durationMs,
          );
        } else {
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
          await api.updatePlayback(credentials.serverUrl, credentials.token, {
            episodeId: update.episodeId,
            positionMs: update.positionMs,
            durationMs: update.durationMs,
            state: update.state,
            playbackRate: update.playbackRate,
          });
        }
        await removePendingPlayback(profileId, update.episodeId);
      } catch {
        this.offlinePlayback = true;
        return;
      }
    }
    if (pending.length > 0) {
      this.offlinePlayback = false;
      await useAuthStore.getState().refresh().catch(() => undefined);
    }
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
  ): Promise<void> {
    const auth = useAuthStore.getState();
    const profileId = auth.session?.profile.id ?? auth.snapshot?.profile.id;
    if (!profileId) return;
    await savePendingPlayback(profileId, { ...body, completed });
  }
}

export const playbackController = new AndroidPlaybackController();
