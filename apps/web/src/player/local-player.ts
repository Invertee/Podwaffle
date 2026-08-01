import type {
  Episode,
  PlaybackCommand,
  PlaybackState,
  QueueItem,
} from "@podwaffle/contracts";
import { create } from "zustand";
import { api } from "../api/client";
import {
  registerPlaybackCommandHandler,
  sendPlaybackCommandResult,
} from "../api/playback-channel";
import {
  castAdapter,
  confirmedCastState,
  type CastAdapter,
  type CastAdapterState,
} from "./cast-adapter";

interface PlayerView {
  episode: Episode | null;
  playing: boolean;
  buffering: boolean;
  positionMs: number;
  durationMs: number;
  rate: number;
  volume: number;
  muted: boolean;
  error: string | null;
  tabOwner: boolean;
  mode: "local" | "cast";
  remote: boolean;
  castAvailable: boolean;
  castDeviceName: string | null;
  castSessionId: string | null;
  castStatus:
    | "idle"
    | "connecting"
    | "reconnecting"
    | "loading"
    | "connected"
    | "stopping"
    | "error";
  skipBackwardSeconds: number;
  skipForwardSeconds: number;
}

export const usePlayer = create<PlayerView>(() => ({
  episode: null,
  playing: false,
  buffering: false,
  positionMs: 0,
  durationMs: 0,
  rate: 1,
  volume: 1,
  muted: false,
  error: null,
  tabOwner: false,
  mode: "local",
  remote: false,
  castAvailable: false,
  castDeviceName: null,
  castSessionId: null,
  castStatus: "idle",
  skipBackwardSeconds: 15,
  skipForwardSeconds: 30,
}));

const tabId = crypto.randomUUID();
const OWNER_KEY = "podwaffle-player-tab";
const OWNER_TTL = 8_000;
const CAST_HANDOFF_DELAY_MS = 1_000;

export class LocalPlayer {
  private readonly audio = new Audio();
  private readonly channel =
    "BroadcastChannel" in window
      ? new BroadcastChannel("podwaffle-player")
      : null;
  private playbackInstanceId = crypto.randomUUID();
  private sequence = 0;
  private listenedSinceFlush = 0;
  private lastPlayingTick = performance.now();
  private progressTimer: number | undefined;
  private telemetryTimer: number | undefined;
  private ownerTimer: number | undefined;
  private completingEpisodeId: string | null = null;
  private readonly queueListeners = new Set<(queue: QueueItem[]) => void>();
  private castState: CastAdapterState;
  private endingCast = false;
  private changingCastMedia = false;
  private transitioningToCast = false;
  private resumingCastSessionId: string | null = null;
  private resumeCastPromise: Promise<void> | null = null;
  private failedCastSessionId: string | null = null;
  private restoringLocalEpisodeId: string | null = null;

  public constructor(private readonly cast: CastAdapter = castAdapter) {
    this.castState = cast.state();
    // Podwaffle hands media to receivers through the Google Cast Sender SDK.
    // Prevent Chrome from also creating a native Remote Playback route for the
    // local <audio>, which otherwise takes over the Cast UI while it is playing.
    this.audio.disableRemotePlayback = true;
    this.audio.preload = "metadata";
    this.audio.addEventListener("timeupdate", () => this.publish());
    this.audio.addEventListener("durationchange", () => this.publish());
    this.audio.addEventListener("play", () => {
      this.lastPlayingTick = performance.now();
      this.publish();
    });
    this.audio.addEventListener("pause", () => {
      this.countListened();
      this.publish();
      void this.reportState();
      void this.flushTelemetry();
    });
    this.audio.addEventListener("waiting", () => {
      this.countListened();
      usePlayer.setState({ buffering: true });
    });
    this.audio.addEventListener("playing", () => {
      this.lastPlayingTick = performance.now();
      usePlayer.setState({ buffering: false, error: null });
    });
    this.audio.addEventListener("error", () =>
      usePlayer.setState({ error: "This episode could not be played." }),
    );
    this.audio.addEventListener("ended", () => void this.handleEnded());
    this.channel?.addEventListener("message", (event) => {
      const message = event.data as { type?: string; action?: string };
      if (message.type === "command" && this.isTabOwner())
        void this.command(message.action ?? "");
      if (message.type === "state" && !this.isTabOwner())
        usePlayer.setState(message as Partial<PlayerView>);
    });
    this.cast.subscribe((state) => {
      const previous = this.castState;
      this.castState = state;
      usePlayer.setState({
        castAvailable: state.available,
        ...(usePlayer.getState().mode === "cast"
          ? {
              playing: state.playing,
              buffering: state.buffering,
              positionMs: state.positionMs,
              durationMs: state.durationMs,
              volume: state.volume,
              muted: state.muted,
              castDeviceName: state.deviceName,
              castSessionId: state.sessionId,
            }
          : {}),
      });
      if (
        state.completionSequence > previous.completionSequence &&
        usePlayer.getState().mode === "cast" &&
        !this.changingCastMedia &&
        !this.endingCast
      )
        void this.handleEnded("cast");
      if (
        previous.connected &&
        !state.connected &&
        usePlayer.getState().mode === "cast" &&
        !this.endingCast
      )
        void this.restoreLocalFromCast(previous);
    });
    registerPlaybackCommandHandler((command) =>
      this.handleRemoteCommand(command),
    );
    this.setupMediaSession();
    window.addEventListener("keydown", (event) => {
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, select, [contenteditable=true]"))
        return;
      if (
        ![" ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
          event.key,
        )
      )
        return;
      event.preventDefault();
      if (event.key === " ") void this.toggle();
      if (event.key === "ArrowLeft")
        void this.skip(
          -usePlayer.getState().skipBackwardSeconds,
          "skip-backward",
        );
      if (event.key === "ArrowRight")
        void this.skip(usePlayer.getState().skipForwardSeconds, "skip-forward");
      if (event.key === "ArrowUp")
        this.setVolume(usePlayer.getState().volume + 0.05);
      if (event.key === "ArrowDown")
        this.setVolume(usePlayer.getState().volume - 0.05);
    });
  }

  public start(): void {
    this.claimTab();
    this.ownerTimer ??= window.setInterval(() => this.claimTab(), 3_000);
    this.progressTimer ??= window.setInterval(() => {
      this.countListened();
      if (usePlayer.getState().mode === "cast") {
        if (this.castState.connected) {
          const finished =
            this.castState.playerState === "IDLE" &&
            this.castState.durationMs > 0 &&
            this.castState.positionMs >= this.castState.durationMs - 5_000;
          if (finished) void this.handleEnded("cast");
          else void this.reportCastState().catch(() => undefined);
        }
      } else {
        this.publish();
        if (!this.audio.paused) void this.reportState().catch(() => undefined);
      }
    }, 10_000);
    this.telemetryTimer ??= window.setInterval(
      () => void this.flushTelemetry(),
      15_000,
    );
    void this.cast.initialize();
  }

  public setSkipDurations(
    skipBackwardSeconds: number,
    skipForwardSeconds: number,
  ): void {
    usePlayer.setState({ skipBackwardSeconds, skipForwardSeconds });
  }

  public subscribeQueue(listener: (queue: QueueItem[]) => void): () => void {
    this.queueListeners.add(listener);
    return () => this.queueListeners.delete(listener);
  }

  private isTabOwner(): boolean {
    const raw = localStorage.getItem(OWNER_KEY);
    if (!raw) return false;
    try {
      const owner = JSON.parse(raw) as { id: string; expires: number };
      return owner.id === tabId && owner.expires > Date.now();
    } catch {
      return false;
    }
  }

  private claimTab(): void {
    const raw = localStorage.getItem(OWNER_KEY);
    let available = true;
    try {
      const owner = JSON.parse(raw ?? "{}") as {
        id?: string;
        expires?: number;
      };
      available =
        owner.id === tabId || !owner.expires || owner.expires <= Date.now();
    } catch {
      available = true;
    }
    if (available)
      localStorage.setItem(
        OWNER_KEY,
        JSON.stringify({ id: tabId, expires: Date.now() + OWNER_TTL }),
      );
    usePlayer.setState({ tabOwner: this.isTabOwner() });
  }

  public async load(episode: Episode, autoplay = true): Promise<void> {
    if (!episode.enclosureUrl) {
      usePlayer.setState({ error: "This episode has no playable audio." });
      return;
    }
    if (usePlayer.getState().remote) {
      await api.playbackCommand({
        commandId: crypto.randomUUID(),
        action: "play-episode",
        episodeId: episode.id,
      });
      return;
    }
    this.claimTab();
    if (!this.isTabOwner()) {
      this.channel?.postMessage({ type: "command", action: "takeover" });
      localStorage.setItem(
        OWNER_KEY,
        JSON.stringify({ id: tabId, expires: Date.now() + OWNER_TTL }),
      );
    }
    // Save the outgoing episode before replacing the audio source. Without this,
    // a switch can discard the only position update for the episode being left.
    const outgoing = usePlayer.getState();
    if (outgoing.mode === "local" && outgoing.episode?.id !== episode.id)
      await this.reportState().catch(() => undefined);
    if (usePlayer.getState().mode === "local") {
      const shared = await api.playback().catch(() => null);
      if (shared?.mode === "cast") {
        this.applySharedPlayback(shared);
        await this.resumeCast(shared);
      }
    }
    if (usePlayer.getState().mode === "cast") {
      if (!this.castState.connected) {
        usePlayer.setState({
          castStatus: "reconnecting",
          error: "Reconnecting to the active Cast session. Try again shortly.",
        });
        return;
      }
      await this.loadCastEpisode(episode, autoplay);
      return;
    }
    await api.acquirePlayback({
      episodeId: episode.id,
      positionMs: episode.positionMs,
      durationMs: episode.durationMs,
      playbackRate: this.audio.playbackRate,
    });
    this.audio.src = episode.enclosureUrl;
    this.audio.currentTime = episode.positionMs / 1000;
    this.playbackInstanceId = crypto.randomUUID();
    this.sequence = 0;
    this.listenedSinceFlush = 0;
    usePlayer.setState({
      episode,
      positionMs: episode.positionMs,
      durationMs: episode.durationMs ?? 0,
      error: null,
      mode: "local",
      remote: false,
      castDeviceName: null,
      castSessionId: null,
      castStatus: "idle",
    });
    this.setMetadata(episode);
    if (autoplay) await this.play();
  }

  public async play(): Promise<void> {
    if (usePlayer.getState().remote) {
      await api.playbackCommand({
        commandId: crypto.randomUUID(),
        action: "play",
      });
      return;
    }
    if (usePlayer.getState().mode === "cast") {
      await this.castControl("play");
      return;
    }
    const episode = usePlayer.getState().episode;
    if (!episode) return;
    try {
      await api.acquirePlayback({
        episodeId: episode.id,
        positionMs: Math.round(this.audio.currentTime * 1000),
        durationMs: Number.isFinite(this.audio.duration)
          ? Math.round(this.audio.duration * 1000)
          : episode.durationMs,
        playbackRate: this.audio.playbackRate,
      });
      await this.audio.play();
      await this.reportState("playing");
    } catch {
      usePlayer.setState({ error: "Playback was blocked by the browser." });
    }
  }

  public pause(): void {
    if (usePlayer.getState().remote) {
      void api.playbackCommand({
        commandId: crypto.randomUUID(),
        action: "pause",
      });
      return;
    }
    if (usePlayer.getState().mode === "cast") {
      void this.castControl("pause");
      return;
    }
    this.audio.pause();
  }

  public async toggle(): Promise<void> {
    if (usePlayer.getState().remote) {
      await api.playbackCommand({
        commandId: crypto.randomUUID(),
        action: usePlayer.getState().playing ? "pause" : "play",
      });
      return;
    }
    if (!this.isTabOwner()) {
      this.channel?.postMessage({ type: "command", action: "toggle" });
      return;
    }
    if (usePlayer.getState().mode === "cast")
      await this.castControl(usePlayer.getState().playing ? "pause" : "play");
    else if (this.audio.paused) await this.play();
    else this.pause();
  }

  public async skip(
    seconds: number,
    type: "skip-forward" | "skip-backward",
  ): Promise<void> {
    const episode = usePlayer.getState().episode;
    if (!episode) return;
    if (usePlayer.getState().remote) {
      await api.playbackCommand({
        commandId: crypto.randomUUID(),
        action: type,
        offsetMs: Math.abs(seconds * 1000),
      });
      return;
    }
    if (usePlayer.getState().mode === "cast") {
      await this.castControl(type, {
        offsetMs: Math.abs(seconds * 1000),
      });
      return;
    }
    const from = Math.round(this.audio.currentTime * 1000);
    const requested = Math.max(
      0,
      Math.min(
        Number.isFinite(this.audio.duration)
          ? this.audio.duration * 1000
          : Infinity,
        from + seconds * 1000,
      ),
    );
    this.audio.currentTime = requested / 1000;
    await new Promise<void>((resolve) =>
      this.audio.addEventListener("seeked", () => resolve(), { once: true }),
    );
    await api.movement({
      commandId: crypto.randomUUID(),
      episodeId: episode.id,
      type,
      fromPositionMs: from,
      requestedPositionMs: Math.round(requested),
      confirmedPositionMs: Math.round(this.audio.currentTime * 1000),
    });
    this.publish();
  }

  public async seek(positionMs: number): Promise<void> {
    const episode = usePlayer.getState().episode;
    if (!episode) return;
    if (usePlayer.getState().remote) {
      await api.playbackCommand({
        commandId: crypto.randomUUID(),
        action: "seek",
        positionMs,
      });
      return;
    }
    if (usePlayer.getState().mode === "cast") {
      await this.castControl("seek", { positionMs });
      return;
    }
    const from = Math.round(this.audio.currentTime * 1000);
    this.audio.currentTime = positionMs / 1000;
    await new Promise<void>((resolve) =>
      this.audio.addEventListener("seeked", () => resolve(), { once: true }),
    );
    await api.movement({
      commandId: crypto.randomUUID(),
      episodeId: episode.id,
      type: "seek",
      fromPositionMs: from,
      requestedPositionMs: positionMs,
      confirmedPositionMs: Math.round(this.audio.currentTime * 1000),
    });
    await this.reportState();
  }

  public setRate(rate: number): void {
    if (usePlayer.getState().mode === "cast") return;
    this.countListened();
    this.audio.playbackRate = rate;
    usePlayer.setState({ rate });
    void this.reportState();
  }

  public setVolume(volume: number): void {
    const nextVolume = Math.max(0, Math.min(1, volume));
    if (usePlayer.getState().mode === "cast") {
      usePlayer.setState({ volume: nextVolume });
      void this.cast.setVolume(nextVolume).catch(() =>
        usePlayer.setState({
          volume: this.castState.volume,
          error: "The Cast volume could not be changed.",
        }),
      );
      return;
    }
    this.audio.volume = nextVolume;
    usePlayer.setState({ volume: this.audio.volume });
  }

  private countListened(): void {
    const now = performance.now();
    const state = usePlayer.getState();
    if (state.remote) {
      this.lastPlayingTick = now;
      return;
    }
    if (state.playing && !state.buffering)
      this.listenedSinceFlush += Math.max(0, now - this.lastPlayingTick);
    this.lastPlayingTick = now;
  }

  private async flushTelemetry(): Promise<void> {
    this.countListened();
    const episode = usePlayer.getState().episode;
    const listenedMs = Math.round(this.listenedSinceFlush);
    if (usePlayer.getState().remote) return;
    if (!episode || listenedMs <= 0 || !this.isTabOwner()) return;
    this.listenedSinceFlush = 0;
    try {
      await api.telemetry({
        playbackInstanceId: this.playbackInstanceId,
        sequence: this.sequence++,
        episodeId: episode.id,
        source: usePlayer.getState().mode === "cast" ? "cast" : "web-local",
        listenedMs,
        contentConsumedMs: Math.round(listenedMs * usePlayer.getState().rate),
      });
    } catch {
      this.listenedSinceFlush += listenedMs;
    }
  }

  private async handleEnded(source: "local" | "cast" = "local"): Promise<void> {
    const episode = usePlayer.getState().episode;
    if (!episode || this.completingEpisodeId === episode.id) return;
    this.completingEpisodeId = episode.id;
    this.countListened();
    try {
      await this.flushTelemetry();
      const durationMs =
        source === "cast"
          ? this.castState.durationMs || episode.durationMs
          : Number.isFinite(this.audio.duration) && this.audio.duration > 0
            ? Math.round(this.audio.duration * 1000)
            : episode.durationMs;
      const positionMs = Math.max(
        source === "cast"
          ? this.castState.positionMs
          : Math.round(this.audio.currentTime * 1000),
        durationMs ?? 0,
      );
      const completed = await api.completeEpisode(
        episode.id,
        positionMs,
        durationMs,
      );
      for (const listener of this.queueListeners) listener(completed.queue);
      const next = completed.queue[0]?.episode;
      if (next) {
        await this.load(next);
      } else if (source === "cast") {
        await this.finishCastPlayback(durationMs);
      } else {
        this.resetToIdle();
      }
    } catch {
      if (source === "local")
        await this.reportState("stopped").catch(() => undefined);
      usePlayer.setState({
        playing: false,
        buffering: false,
        ...(source === "cast" ? { castStatus: "error" as const } : {}),
        error: "The next queued episode could not be started.",
      });
    } finally {
      this.completingEpisodeId = null;
    }
  }

  private async finishCastPlayback(durationMs: number | null): Promise<void> {
    const state = usePlayer.getState();
    this.endingCast = true;
    usePlayer.setState({ castStatus: "stopping" });
    try {
      await this.cast.endSession();
      await api.stopCast({
        positionMs: durationMs ?? this.castState.positionMs,
        durationMs,
        state: "stopped",
        playbackRate: state.rate,
      });
      usePlayer.setState({
        mode: "local",
        castDeviceName: null,
        castSessionId: null,
        castStatus: "idle",
      });
      this.resetToIdle();
    } finally {
      this.endingCast = false;
    }
  }

  private resetToIdle(): void {
    const state: Partial<PlayerView> = {
      episode: null,
      playing: false,
      buffering: false,
      positionMs: 0,
      durationMs: 0,
      error: null,
      remote: false,
    };
    usePlayer.setState(state);
    this.channel?.postMessage({ type: "state", ...state });
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
    this.audio.removeAttribute("src");
    this.audio.load();
  }

  private async reportState(
    state?: "playing" | "paused" | "stopped",
  ): Promise<void> {
    const episode = usePlayer.getState().episode;
    if (
      !episode ||
      !this.isTabOwner() ||
      usePlayer.getState().mode === "cast" ||
      usePlayer.getState().remote ||
      this.transitioningToCast
    )
      return;
    await api.updatePlayback({
      episodeId: episode.id,
      positionMs: Math.round(this.audio.currentTime * 1000),
      durationMs: Number.isFinite(this.audio.duration)
        ? Math.round(this.audio.duration * 1000)
        : episode.durationMs,
      state: state ?? (this.audio.paused ? "paused" : "playing"),
      playbackRate: this.audio.playbackRate,
    });
  }

  public applySharedPlayback(playback: PlaybackState | null): void {
    const local = usePlayer.getState();
    if (!playback) {
      if (local.remote) usePlayer.setState({ remote: false, playing: false });
      return;
    }
    if (!playback.episode || playback.state === "stopped") {
      if (local.remote) usePlayer.setState({ remote: false, playing: false });
      return;
    }
    if (playback.ownedByCurrentDevice && local.remote) {
      usePlayer.setState({ remote: false });
    }
    if (
      !playback.ownedByCurrentDevice &&
      playback.episode &&
      playback.state !== "stopped"
    ) {
      usePlayer.setState({
        episode: playback.episode,
        playing: playback.state === "playing",
        buffering: false,
        positionMs: playback.positionMs,
        durationMs: playback.durationMs ?? playback.episode.durationMs ?? 0,
        rate: playback.playbackRate,
        mode: playback.mode,
        remote: true,
        castDeviceName: null,
        castSessionId: playback.castSessionId,
        castStatus: playback.mode === "cast" ? "connected" : "idle",
        error: null,
      });
      this.audio.pause();
      return;
    }
    if (playback.mode === "cast") {
      const reconnectFailed =
        this.failedCastSessionId === playback.castSessionId;
      usePlayer.setState({
        episode: playback.episode,
        playing: playback.state === "playing",
        positionMs: playback.positionMs,
        durationMs: playback.durationMs ?? 0,
        rate: playback.playbackRate,
        mode: "cast",
        remote: false,
        castSessionId: playback.castSessionId,
        castStatus: this.castState.connected
          ? "connected"
          : reconnectFailed
            ? "error"
            : "reconnecting",
        ...(reconnectFailed
          ? { error: "The active Cast session could not be reconnected." }
          : {}),
      });
      this.audio.pause();
      if (
        playback.castSessionId &&
        !reconnectFailed &&
        (!this.castState.connected ||
          this.castState.sessionId !== playback.castSessionId)
      )
        void this.resumeCast(playback);
    } else if (local.mode === "cast" && !this.castState.connected) {
      usePlayer.setState({
        episode: playback.episode,
        playing: playback.state === "playing",
        positionMs: playback.positionMs,
        durationMs: playback.durationMs ?? 0,
        rate: playback.playbackRate,
        mode: "local",
        remote: false,
        castDeviceName: null,
        castSessionId: null,
        castStatus: "idle",
      });
    } else if (
      playback.episode &&
      playback.state !== "stopped" &&
      playback.ownedByCurrentDevice &&
      local.mode === "local" &&
      local.episode?.id !== playback.episode.id &&
      this.restoringLocalEpisodeId !== playback.episode.id
    ) {
      void this.restoreLocalPlayback(playback);
    }
  }

  private async restoreLocalPlayback(playback: PlaybackState): Promise<void> {
    const savedEpisode = playback.episode;
    if (!savedEpisode) return;
    this.restoringLocalEpisodeId = savedEpisode.id;
    const episode: Episode = {
      ...savedEpisode,
      positionMs: playback.positionMs,
      durationMs: playback.durationMs ?? savedEpisode.durationMs,
    };
    this.audio.playbackRate = playback.playbackRate;
    usePlayer.setState({ rate: playback.playbackRate });
    try {
      await this.load(episode, playback.state === "playing");
    } finally {
      this.restoringLocalEpisodeId = null;
    }
  }

  public async startCasting(): Promise<void> {
    const state = usePlayer.getState();
    if (state.remote)
      throw new Error("Move playback to this browser before starting Cast.");
    const episode = state.episode;
    if (!episode) return;
    const wasPlaying = state.playing;
    const positionMs =
      Math.round(this.audio.currentTime * 1000) || state.positionMs;
    this.transitioningToCast = true;
    usePlayer.setState({ castStatus: "connecting", error: null });
    this.releaseLocalMediaSession();
    try {
      // Chrome removes its local media card asynchronously. Opening the Cast
      // UI immediately can show that now-empty card instead of receiver choices.
      await new Promise<void>((resolve) =>
        window.setTimeout(resolve, CAST_HANDOFF_DELAY_MS),
      );
      const remote = await this.cast.connectAndLoad({
        episode,
        positionMs,
        autoplay: wasPlaying,
        playbackRate: state.rate,
      });
      await api.startCast(confirmedCastState(remote, episode, state.rate));
      usePlayer.setState({
        mode: "cast",
        remote: false,
        playing: remote.playing,
        buffering: remote.buffering,
        positionMs: remote.positionMs,
        durationMs: remote.durationMs,
        volume: remote.volume,
        muted: remote.muted,
        castDeviceName: remote.deviceName,
        castSessionId: remote.sessionId,
        castStatus: "connected",
        error: null,
      });
      this.transitioningToCast = false;
    } catch (error) {
      this.transitioningToCast = false;
      await this.restoreLocalMedia(episode, positionMs, state.rate);
      usePlayer.setState({
        mode: "local",
        castStatus: "error",
        error:
          error instanceof Error
            ? error.message
            : "Google Cast could not be started.",
      });
      if (wasPlaying) await this.play();
      else this.publish();
    }
  }

  private resumeCast(playback: PlaybackState): Promise<void> {
    const sessionId = playback.castSessionId;
    if (!sessionId) return Promise.resolve();
    if (this.failedCastSessionId === sessionId) return Promise.resolve();
    if (this.resumingCastSessionId === sessionId && this.resumeCastPromise)
      return this.resumeCastPromise;
    this.resumingCastSessionId = sessionId;
    const promise = this.performCastResume(playback, sessionId);
    this.resumeCastPromise = promise;
    return promise;
  }

  private async performCastResume(
    playback: PlaybackState,
    sessionId: string,
  ): Promise<void> {
    usePlayer.setState({ castStatus: "reconnecting", error: null });
    try {
      const remote = await this.cast.resumeSession(sessionId);
      usePlayer.setState({
        episode: playback.episode,
        mode: "cast",
        playing: remote.playing,
        buffering: remote.buffering,
        positionMs: remote.positionMs,
        durationMs: remote.durationMs || playback.durationMs || 0,
        volume: remote.volume,
        muted: remote.muted,
        castDeviceName: remote.deviceName,
        castSessionId: remote.sessionId,
        castStatus: "connected",
        error: null,
      });
      if (playback.episode)
        await api.startCast(
          confirmedCastState(remote, playback.episode, playback.playbackRate),
        );
      this.failedCastSessionId = null;
    } catch {
      this.failedCastSessionId = sessionId;
      usePlayer.setState({
        castStatus: "error",
        error: "The active Cast session could not be reconnected.",
      });
    } finally {
      if (this.resumingCastSessionId === sessionId) {
        this.resumingCastSessionId = null;
        this.resumeCastPromise = null;
      }
    }
  }

  private async loadCastEpisode(
    episode: Episode,
    autoplay: boolean,
  ): Promise<void> {
    this.changingCastMedia = true;
    usePlayer.setState({ castStatus: "loading", error: null });
    try {
      const state = usePlayer.getState();
      const remote = await this.cast.loadMedia({
        episode,
        positionMs: episode.positionMs,
        autoplay,
        playbackRate: state.rate,
      });
      this.playbackInstanceId = crypto.randomUUID();
      this.sequence = 0;
      this.listenedSinceFlush = 0;
      usePlayer.setState({
        episode,
        mode: "cast",
        playing: remote.playing,
        buffering: remote.buffering,
        positionMs: remote.positionMs,
        durationMs: remote.durationMs || episode.durationMs || 0,
        volume: remote.volume,
        muted: remote.muted,
        castDeviceName: remote.deviceName,
        castSessionId: remote.sessionId,
        castStatus: "connected",
        error: null,
      });
      this.setMetadata(episode);
      await api.startCast(confirmedCastState(remote, episode, state.rate));
    } catch (error) {
      usePlayer.setState({
        castStatus: "error",
        error:
          error instanceof Error
            ? error.message
            : "The episode could not be loaded on the Cast receiver.",
      });
      throw error;
    } finally {
      this.changingCastMedia = false;
    }
  }

  public async stopCasting(): Promise<void> {
    const state = usePlayer.getState();
    const episode = state.episode;
    if (!episode || state.mode !== "cast") return;
    if (!this.castState.connected && state.castSessionId) {
      if (this.resumeCastPromise) await this.resumeCastPromise;
      if (
        !this.castState.connected &&
        this.failedCastSessionId !== state.castSessionId
      ) {
        usePlayer.setState({ castStatus: "reconnecting", error: null });
        try {
          await this.cast.resumeSession(state.castSessionId);
        } catch {
          this.failedCastSessionId = state.castSessionId;
        }
      }
      if (!this.cast.state().connected) {
        await this.clearUnreachableCast(state, episode);
        return;
      }
    }
    if (!this.cast.state().connected) return;
    const remote = this.cast.state();
    const resume = remote.playing || state.playing;
    this.endingCast = true;
    usePlayer.setState({ castStatus: "stopping", error: null });
    try {
      await this.cast.endSession();
      await this.restoreLocalFromCast(remote, resume);
    } catch (error) {
      usePlayer.setState({
        castStatus: "error",
        error:
          error instanceof Error
            ? error.message
            : "The Cast session could not be stopped.",
      });
    } finally {
      this.endingCast = false;
    }
  }

  private async clearUnreachableCast(
    state: PlayerView,
    episode: Episode,
  ): Promise<void> {
    usePlayer.setState({ castStatus: "stopping", error: null });
    try {
      await api.stopCast({
        positionMs: state.positionMs,
        durationMs: state.durationMs || episode.durationMs,
        state: "paused",
        playbackRate: state.rate,
      });
      await this.restoreLocalMedia(episode, state.positionMs, state.rate);
      this.failedCastSessionId = null;
      usePlayer.setState({
        mode: "local",
        playing: false,
        buffering: false,
        castDeviceName: null,
        castSessionId: null,
        castStatus: "idle",
        error: null,
      });
      this.setMetadata(episode);
      this.publish();
    } catch {
      usePlayer.setState({
        castStatus: "error",
        error:
          "The previous Cast owner is still active. Try Stop Cast again shortly.",
      });
    }
  }

  private async restoreLocalFromCast(
    remote: CastAdapterState,
    resume = remote.playing,
  ): Promise<void> {
    const state = usePlayer.getState();
    const episode = state.episode;
    if (!episode || state.mode !== "cast") return;
    await this.restoreLocalMedia(episode, remote.positionMs, state.rate);
    usePlayer.setState({
      mode: "local",
      positionMs: remote.positionMs,
      playing: false,
      castDeviceName: null,
      castSessionId: null,
      castStatus: "stopping",
    });
    await api.stopCast({
      positionMs: remote.positionMs,
      durationMs: remote.durationMs || episode.durationMs,
      state: resume ? "playing" : "paused",
      playbackRate: state.rate,
    });
    if (resume) {
      try {
        await this.audio.play();
      } catch {
        usePlayer.setState({
          playing: false,
          error: "Local playback could not resume automatically.",
        });
        await this.reportState("paused").catch(() => undefined);
      }
    }
    usePlayer.setState({ castStatus: "idle" });
    this.publish();
  }

  public async reselectCastDevice(): Promise<void> {
    const state = usePlayer.getState();
    if (!state.episode || state.mode !== "cast") return;
    const remote = await this.cast.reselect({
      episode: state.episode,
      positionMs: this.castState.positionMs,
      autoplay: this.castState.playing,
      playbackRate: state.rate,
    });
    await api.startCast(confirmedCastState(remote, state.episode, state.rate));
  }

  public setMuted(muted: boolean): void {
    if (usePlayer.getState().mode === "cast") void this.cast.setMuted(muted);
  }

  private async castControl(
    action: PlaybackCommand["action"],
    details: Pick<PlaybackCommand, "positionMs" | "offsetMs"> = {},
  ): Promise<void> {
    if (this.castState.connected && this.isTabOwner()) {
      if (action === "play") await this.cast.play();
      if (action === "pause") await this.cast.pause();
      if (action === "seek" && details.positionMs !== undefined)
        await this.cast.seek(details.positionMs);
      if (action === "skip-forward" || action === "skip-backward") {
        const direction = action === "skip-forward" ? 1 : -1;
        await this.cast.seek(
          Math.max(
            0,
            this.castState.positionMs + direction * (details.offsetMs ?? 0),
          ),
        );
      }
      await this.reportCastState();
      return;
    }
    await api.playbackCommand({
      commandId: crypto.randomUUID(),
      action,
      ...details,
    });
  }

  private async handleRemoteCommand(command: PlaybackCommand): Promise<void> {
    this.claimTab();
    if (!this.isTabOwner()) return;
    try {
      const current = usePlayer.getState();
      if (
        command.action !== "play-episode" &&
        current.mode === "local" &&
        current.episode
      ) {
        await api.acquirePlayback({
          episodeId: current.episode.id,
          positionMs: current.positionMs,
          durationMs: current.durationMs || current.episode.durationMs,
          playbackRate: current.rate,
        });
      }
      if (command.action === "play-episode") {
        if (!command.episodeId) throw new Error("The requested episode is missing.");
        await this.load(await api.episode(command.episodeId));
      } else if (usePlayer.getState().mode === "cast") {
        await this.castControl(command.action, command);
      } else if (command.action === "play") {
        await this.play();
      } else if (command.action === "pause") {
        this.pause();
      } else if (command.action === "seek" && command.positionMs !== undefined) {
        await this.seek(command.positionMs);
      } else if (command.action === "skip-forward") {
        await this.skip((command.offsetMs ?? 30_000) / 1_000, "skip-forward");
      } else if (command.action === "skip-backward") {
        await this.skip(-(command.offsetMs ?? 15_000) / 1_000, "skip-backward");
      } else if (command.action === "next" || command.action === "previous") {
        const queue = await api.queue();
        const currentId = usePlayer.getState().episode?.id;
        const index = queue.findIndex((item) => item.episode.id === currentId);
        const target =
          command.action === "next"
            ? queue[index >= 0 ? index + 1 : 0]?.episode
            : queue[index > 0 ? index - 1 : 0]?.episode;
        if (target) await this.load(target);
      }
      const episode = usePlayer.getState().episode;
      if (!episode) throw new Error("No episode is active.");
      const result: Parameters<typeof sendPlaybackCommandResult>[0] = {
        commandId: command.commandId,
        status: "accepted",
      };
      if (usePlayer.getState().mode === "cast" && this.castState.connected) {
        result.confirmed = confirmedCastState(
          this.cast.state(),
          episode,
          usePlayer.getState().rate,
        );
      }
      sendPlaybackCommandResult(result);
    } catch (error) {
      sendPlaybackCommandResult({
        commandId: command.commandId,
        status: "rejected",
        message: error instanceof Error ? error.message : "Cast command failed",
      });
    }
  }

  private async reportCastState(): Promise<void> {
    const episode = usePlayer.getState().episode;
    if (!episode || !this.castState.connected) return;
    await api.startCast(
      confirmedCastState(this.cast.state(), episode, usePlayer.getState().rate),
    );
  }

  private publish(): void {
    if (usePlayer.getState().mode === "cast") return;
    const state: Partial<PlayerView> = {
      playing: !this.audio.paused,
      positionMs: Math.round(this.audio.currentTime * 1000) || 0,
      durationMs: Math.round(this.audio.duration * 1000) || 0,
      rate: this.audio.playbackRate,
      volume: this.audio.volume,
    };
    usePlayer.setState(state);
    this.channel?.postMessage({ type: "state", ...state });
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = this.audio.paused
        ? "paused"
        : "playing";
      if (Number.isFinite(this.audio.duration)) {
        try {
          navigator.mediaSession.setPositionState({
            duration: this.audio.duration,
            playbackRate: this.audio.playbackRate,
            position: Math.min(this.audio.currentTime, this.audio.duration),
          });
        } catch {
          // Some browsers reject position state while metadata is loading.
        }
      }
    }
  }

  private async command(action: string): Promise<void> {
    if (action === "toggle") await this.toggle();
    if (action === "takeover") this.pause();
  }

  private setMetadata(episode: Episode): void {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: episode.title,
      artist: episode.podcastTitle,
      artwork: episode.artworkUrl
        ? [{ src: episode.artworkUrl, sizes: "512x512" }]
        : [],
    });
  }

  private releaseLocalMediaSession(): void {
    this.audio.pause();
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      try {
        navigator.mediaSession.setPositionState();
      } catch {
        // Clearing position state is optional in older implementations.
      }
    }
    this.audio.removeAttribute("src");
    this.audio.load();
  }

  private async restoreLocalMedia(
    episode: Episode,
    positionMs: number,
    playbackRate: number,
  ): Promise<void> {
    if (episode.enclosureUrl) this.audio.src = episode.enclosureUrl;
    this.audio.playbackRate = playbackRate;
    if (this.audio.readyState < 1) {
      await new Promise<void>((resolve) => {
        const settled = () => resolve();
        this.audio.addEventListener("loadedmetadata", settled, { once: true });
        this.audio.addEventListener("error", settled, { once: true });
        this.audio.load();
      });
    }
    this.audio.currentTime = positionMs / 1000;
    this.setMetadata(episode);
  }

  private setupMediaSession(): void {
    if (!("mediaSession" in navigator)) return;
    const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => void this.play()],
      ["pause", () => this.pause()],
      [
        "seekbackward",
        (details) =>
          void this.skip(
            -(details.seekOffset ?? usePlayer.getState().skipBackwardSeconds),
            "skip-backward",
          ),
      ],
      [
        "seekforward",
        (details) =>
          void this.skip(
            details.seekOffset ?? usePlayer.getState().skipForwardSeconds,
            "skip-forward",
          ),
      ],
      [
        "seekto",
        (details) => void this.seek(Math.round((details.seekTime ?? 0) * 1000)),
      ],
    ];
    for (const [action, handler] of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Unsupported Media Session actions are optional.
      }
    }
  }
}

export const player = new LocalPlayer();
