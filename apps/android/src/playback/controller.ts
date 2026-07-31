import type { Episode } from "@podwaffle/contracts";

import { ApiClientError, api, createCommandId } from "../api/client";
import type { NativePlaybackState } from "../native-media";
import { PodwaffleMediaModule } from "../native-media";
import { useAuthStore } from "../stores/auth";
import { useNativeMediaStore } from "../stores/nativeMedia";

const STATE_REPORT_INTERVAL_MS = 10_000;
const TELEMETRY_INTERVAL_MS = 15_000;
const LEASE_RENEWAL_MARGIN_MS = 15_000;

function playbackStateFromNative(
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

  public async playEpisode(episode: Episode): Promise<void> {
    if (!episode.enclosureUrl) {
      throw new Error("This episode does not have a playable audio enclosure.");
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
    const acquired = await api.acquirePlayback(serverUrl, token, {
      episodeId: episode.id,
      positionMs: episode.positionMs,
      durationMs: episode.durationMs,
      playbackRate,
    });
    this.setLeaseExpiry(acquired.leaseExpiresAt);
    this.activeEpisode = episode;
    this.completedEpisodeId = null;
    this.playbackInstanceId = createCommandId();
    this.telemetrySequence = 0;
    this.listenedSinceTelemetry = 0;
    this.lastListeningSampleAt = Date.now();
    this.lastTelemetryAt = Date.now();

    const queueItemId =
      useAuthStore
        .getState()
        .snapshot?.queue.find((item) => item.episode.id === episode.id)?.id ?? null;
    try {
      await PodwaffleMediaModule.playEpisode(
        {
          episodeId: episode.id,
          podcastId: episode.podcastId,
          title: episode.title,
          podcastTitle: episode.podcastTitle,
          enclosureUrl: episode.enclosureUrl,
          localDownloadPath: null,
          artworkUrl: episode.artworkUrl,
          durationMs: episode.durationMs,
          queueItemId,
        },
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
      await api.releasePlayback(serverUrl, token).catch(() => undefined);
      this.activeEpisode = null;
      this.leaseExpiresAt = 0;
      throw error;
    }
  }

  public async play(): Promise<void> {
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
    const episodeId = state.episodeId;
    if (!episodeId) return;
    await this.reportCurrentState(true, {
      episodeId,
      positionMs: state.positionMs,
      durationMs: durationFor(state, this.activeEpisode),
      state: "playing",
      playbackRate: state.playbackRate,
    });
  }

  public async pause(): Promise<void> {
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
    await this.ensureLease(state);
    await PodwaffleMediaModule.seekTo(requestedPositionMs);
    const { serverUrl, token } = this.connection();
    await api.movement(serverUrl, token, {
      commandId: createCommandId(),
      episodeId: state.episodeId,
      type,
      fromPositionMs: state.positionMs,
      requestedPositionMs,
      confirmedPositionMs: requestedPositionMs,
    });
    await this.reportCurrentState(true, {
      episodeId: state.episodeId,
      positionMs: requestedPositionMs,
      durationMs,
      state: playbackStateFromNative(state),
      playbackRate: state.playbackRate,
    });
  }

  public async skipBackward(): Promise<void> {
    const state = useNativeMediaStore.getState().state;
    if (!state?.episodeId) return;
    const seconds = useAuthStore.getState().skipBackwardSeconds;
    await this.seekTo(
      Math.max(0, state.positionMs - seconds * 1000),
      "skip-backward",
    );
  }

  public async skipForward(): Promise<void> {
    const state = useNativeMediaStore.getState().state;
    if (!state?.episodeId) return;
    const seconds = useAuthStore.getState().skipForwardSeconds;
    await this.seekTo(state.positionMs + seconds * 1000, "skip-forward");
  }

  public async setPlaybackRate(rate: number): Promise<void> {
    const state = useNativeMediaStore.getState().state;
    if (!state?.episodeId) return;
    const nextRate = Math.max(0.5, Math.min(4, rate));
    await PodwaffleMediaModule.setPlaybackRate(nextRate);
    await this.reportCurrentState(true, {
      episodeId: state.episodeId,
      positionMs: state.positionMs,
      durationMs: durationFor(state, this.activeEpisode),
      state: playbackStateFromNative(state),
      playbackRate: nextRate,
    });
  }

  public handleNativeState(state: NativePlaybackState): void {
    this.sampleListening();
    this.lastNativeState = state;
    if (state.episodeId && this.activeEpisode?.id !== state.episodeId) {
      const snapshot = useAuthStore.getState().snapshot;
      const cached =
        snapshot?.playback?.episode?.id === state.episodeId
          ? snapshot.playback.episode
          : snapshot?.queue.find((item) => item.episode.id === state.episodeId)
              ?.episode;
      if (cached) this.activeEpisode = cached;
      else void this.loadEpisode(state.episodeId);
    }
    if (state.playbackStatus === "ended" && state.episodeId) {
      void this.finishEpisode(state);
      return;
    }
    if (state.episodeId) void this.reportCurrentState(true);
  }

  public handleNativePosition(
    _positionMs: number,
    _bufferedPositionMs: number,
  ): void {
    this.sampleListening();
    const now = Date.now();
    if (now - this.lastStateReportAt >= STATE_REPORT_INTERVAL_MS) {
      void this.reportCurrentState();
    }
    if (now - this.lastTelemetryAt >= TELEMETRY_INTERVAL_MS) {
      void this.flushTelemetry();
    }
  }

  public async flush(): Promise<void> {
    this.sampleListening();
    await this.reportCurrentState(true).catch(() => undefined);
    await this.flushTelemetry().catch(() => undefined);
  }

  public reset(): void {
    this.activeEpisode = null;
    this.leaseExpiresAt = 0;
    this.completedEpisodeId = null;
    this.lastNativeState = null;
    this.listenedSinceTelemetry = 0;
  }

  private connection(): { serverUrl: string; token: string } {
    const credentials = useAuthStore.getState().credentials;
    if (!credentials) throw new Error("This device is not connected to Podwaffle.");
    return credentials;
  }

  private async loadEpisode(episodeId: string): Promise<void> {
    try {
      const { serverUrl, token } = this.connection();
      const episode = await api.episode(serverUrl, token, episodeId);
      if (useNativeMediaStore.getState().state?.episodeId === episodeId) {
        this.activeEpisode = episode;
      }
    } catch {
      // State reporting can continue with native metadata alone.
    }
  }

  private sampleListening(): void {
    const now = Date.now();
    const elapsed = Math.max(0, Math.min(5_000, now - this.lastListeningSampleAt));
    if (
      this.lastNativeState?.playWhenReady &&
      this.lastNativeState.playbackStatus === "ready"
    ) {
      this.listenedSinceTelemetry += elapsed;
    }
    this.lastListeningSampleAt = now;
  }

  private async ensureLease(state: NativePlaybackState): Promise<void> {
    if (Date.now() < this.leaseExpiresAt - LEASE_RENEWAL_MARGIN_MS) return;
    const { serverUrl, token } = this.connection();
    const playback = await api.acquirePlayback(serverUrl, token, {
      episodeId: state.episodeId ?? undefined,
      positionMs: state.positionMs,
      durationMs: durationFor(state, this.activeEpisode),
      playbackRate: state.playbackRate,
    });
    this.setLeaseExpiry(playback.leaseExpiresAt);
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
    if (!force && Date.now() - this.lastStateReportAt < STATE_REPORT_INTERVAL_MS) {
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
            state: playbackStateFromNative(native),
            playbackRate: native.playbackRate,
          }
        : null);
    if (!body) return;

    const perform = async () => {
      const { serverUrl, token } = this.connection();
      if (native) await this.ensureLease(native);
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

  private async flushTelemetry(): Promise<void> {
    this.sampleListening();
    const state = useNativeMediaStore.getState().state;
    const listenedMs = Math.round(this.listenedSinceTelemetry);
    if (!state?.episodeId || listenedMs <= 0) {
      this.lastTelemetryAt = Date.now();
      return;
    }
    this.listenedSinceTelemetry = 0;
    this.lastTelemetryAt = Date.now();
    try {
      await this.ensureLease(state);
      const { serverUrl, token } = this.connection();
      await api.telemetry(serverUrl, token, {
        playbackInstanceId: this.playbackInstanceId,
        sequence: this.telemetrySequence++,
        episodeId: state.episodeId,
        source: "android-local",
        listenedMs,
        contentConsumedMs: Math.round(listenedMs * state.playbackRate),
      });
    } catch {
      this.listenedSinceTelemetry += listenedMs;
    }
  }

  private async finishEpisode(state: NativePlaybackState): Promise<void> {
    if (!state.episodeId || this.completedEpisodeId === state.episodeId) return;
    this.completedEpisodeId = state.episodeId;
    try {
      await this.flushTelemetry();
      const { serverUrl, token } = this.connection();
      const durationMs = durationFor(state, this.activeEpisode);
      const completed = await api.completeEpisode(
        serverUrl,
        token,
        state.episodeId,
        Math.max(state.positionMs, durationMs ?? 0),
        durationMs,
      );
      await api.releasePlayback(serverUrl, token).catch(() => undefined);
      this.leaseExpiresAt = 0;
      await useAuthStore.getState().refresh();
      const nextEpisode = completed.queue[0]?.episode;
      if (nextEpisode) {
        await this.playEpisode(nextEpisode);
      } else {
        this.activeEpisode = null;
        await PodwaffleMediaModule.stop();
      }
    } catch {
      // Permit a later STATE_ENDED notification to retry server completion.
      this.completedEpisodeId = null;
    }
  }
}

export const playbackController = new AndroidPlaybackController();
