import type { CastConfirmedState, Episode } from "@podwaffle/contracts";

export interface CastAdapterState {
  available: boolean;
  connected: boolean;
  playing: boolean;
  buffering: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  sessionId: string | null;
  deviceName: string | null;
  mediaLoaded: boolean;
  playerState: string | null;
  completionSequence: number;
}

export interface CastLoadOptions {
  episode: Episode;
  positionMs: number;
  autoplay: boolean;
  playbackRate: number;
}

export interface CastAdapter {
  initialize(): Promise<boolean>;
  subscribe(listener: (state: CastAdapterState) => void): () => void;
  state(): CastAdapterState;
  connectAndLoad(options: CastLoadOptions): Promise<CastAdapterState>;
  resumeSession(sessionId: string): Promise<CastAdapterState>;
  loadMedia(options: CastLoadOptions): Promise<CastAdapterState>;
  play(): Promise<CastAdapterState>;
  pause(): Promise<CastAdapterState>;
  seek(positionMs: number): Promise<CastAdapterState>;
  setVolume(volume: number): Promise<CastAdapterState>;
  setMuted(muted: boolean): Promise<CastAdapterState>;
  reselect(options: CastLoadOptions): Promise<CastAdapterState>;
  endSession(): Promise<CastAdapterState>;
}

interface CastDevice {
  friendlyName?: string;
}

interface CastSession {
  getSessionId(): string;
  getCastDevice(): CastDevice;
  getMediaSession(): { idleReason?: string | null } | null;
  getVolume(): number | null;
  isMute(): boolean | null;
  loadMedia(request: CastLoadRequest): Promise<unknown>;
  endSession(stopCasting: boolean): Promise<unknown>;
}

interface CastContext {
  setOptions(options: {
    receiverApplicationId: string;
    autoJoinPolicy: string;
    resumeSavedSession: boolean;
  }): void;
  requestSession(): Promise<unknown>;
  getCurrentSession(): CastSession | null;
  endCurrentSession(stopCasting: boolean): void;
  addEventListener(type: string, listener: () => void): void;
}

interface RemotePlayer {
  isConnected: boolean;
  isPaused: boolean;
  isMediaLoaded: boolean;
  playerState: string | null;
  currentTime: number;
  duration: number;
  volumeLevel: number;
  isMuted: boolean;
  playbackRate: number;
}

interface RemotePlayerController {
  addEventListener(type: string, listener: () => void): void;
  playOrPause(): void;
  seek(): void;
  setVolumeLevel(): void;
  muteOrUnmute(): void;
}

interface MediaInfo {
  metadata?: GenericMediaMetadata;
  duration?: number;
}

interface GenericMediaMetadata {
  title?: string;
  subtitle?: string;
  images?: Array<{ url: string }>;
  releaseDate?: string;
}

interface CastLoadRequest {
  currentTime: number;
  autoplay: boolean;
  playbackRate: number;
}

interface CastApis {
  cast: {
    framework: {
      CastContext: { getInstance(): CastContext };
      RemotePlayer: new () => RemotePlayer;
      RemotePlayerController: new (
        player: RemotePlayer,
      ) => RemotePlayerController;
      RemotePlayerEventType: { ANY_CHANGE: string };
      CastContextEventType: { SESSION_STATE_CHANGED: string };
    };
  };
  chrome: {
    cast: {
      AutoJoinPolicy: { ORIGIN_SCOPED: string };
      requestSessionById(sessionId: string): void;
      Image: new (url: string) => { url: string };
      media: {
        DEFAULT_MEDIA_RECEIVER_APP_ID: string;
        MediaInfo: new (contentId: string, contentType: string) => MediaInfo;
        GenericMediaMetadata: new () => GenericMediaMetadata;
        LoadRequest: new (mediaInfo: MediaInfo) => CastLoadRequest;
      };
    };
  };
}

interface CastGlobal extends Partial<CastApis> {
  __onGCastApiAvailable?: (available: boolean) => void;
}

const SDK_URL =
  "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

const initialState: CastAdapterState = {
  available: false,
  connected: false,
  playing: false,
  buffering: false,
  positionMs: 0,
  durationMs: 0,
  volume: 1,
  muted: false,
  sessionId: null,
  deviceName: null,
  mediaLoaded: false,
  playerState: null,
  completionSequence: 0,
};

export class GoogleCastAdapter implements CastAdapter {
  private current = { ...initialState };
  private readonly listeners = new Set<(state: CastAdapterState) => void>();
  private initialization: Promise<boolean> | undefined;
  private context: CastContext | undefined;
  private remote: RemotePlayer | undefined;
  private controller: RemotePlayerController | undefined;
  private mediaActive = false;
  private loadingMedia = false;

  public state(): CastAdapterState {
    return this.remote ? this.syncRemote() : this.snapshot();
  }

  public subscribe(listener: (state: CastAdapterState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state());
    return () => this.listeners.delete(listener);
  }

  public initialize(): Promise<boolean> {
    this.initialization ??= this.loadSdk();
    return this.initialization;
  }

  private loadSdk(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const global = window as unknown as CastGlobal;
      const ready = (): boolean => {
        if (!global.cast?.framework || !global.chrome?.cast) return false;
        this.setup(global as CastApis);
        resolve(true);
        return true;
      };
      if (ready()) return;
      const previous = global.__onGCastApiAvailable;
      global.__onGCastApiAvailable = (available) => {
        previous?.(available);
        if (available && ready()) return;
        this.update({ available: false });
        resolve(false);
      };
      const existing = document.querySelector<HTMLScriptElement>(
        `script[src="${SDK_URL}"]`,
      );
      if (existing) return;
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.async = true;
      script.addEventListener("error", () => {
        this.update({ available: false });
        resolve(false);
      });
      document.head.append(script);
    });
  }

  private setup(apis: CastApis): void {
    this.context = apis.cast.framework.CastContext.getInstance();
    const configuredReceiver: unknown = import.meta.env[
      "VITE_GOOGLE_CAST_APP_ID"
    ];
    this.context.setOptions({
      receiverApplicationId:
        typeof configuredReceiver === "string" && configuredReceiver
          ? configuredReceiver
          : apis.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: apis.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      // Persisted Podwaffle Cast sessions are resumed explicitly by session ID.
      // Letting the SDK restore its own saved session here can attach a stale
      // browser session while Podwaffle is in local mode, causing requestSession
      // to show that old session instead of the receiver picker.
      resumeSavedSession: false,
    });
    this.remote = new apis.cast.framework.RemotePlayer();
    this.controller = new apis.cast.framework.RemotePlayerController(
      this.remote,
    );
    this.controller.addEventListener(
      apis.cast.framework.RemotePlayerEventType.ANY_CHANGE,
      () => this.syncRemote(),
    );
    this.context.addEventListener(
      apis.cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
      () => this.syncRemote(),
    );
    this.update({ available: true });
    this.syncRemote();
  }

  public async connectAndLoad(
    options: CastLoadOptions,
  ): Promise<CastAdapterState> {
    // The visible Cast control means setup has normally completed already.
    // Avoid yielding before requestSession() in that path so Chrome receives
    // the request directly inside the user's click activation.
    if (!this.context && !(await this.initialize()))
      throw new Error("Google Cast is unavailable in this browser.");
    const context = this.context;
    if (!context)
      throw new Error("Google Cast is unavailable in this browser.");
    await context.requestSession();
    await this.waitFor(
      () =>
        Boolean(this.context?.getCurrentSession()) &&
        Boolean(this.remote?.isConnected),
      15_000,
    );
    this.syncSession();
    return this.loadMedia(options);
  }

  public async resumeSession(sessionId: string): Promise<CastAdapterState> {
    if (!(await this.initialize()) || !this.context)
      throw new Error("Google Cast is unavailable in this browser.");
    let current = this.context.getCurrentSession();
    if (!current) {
      await this.waitFor(
        () => Boolean(this.context?.getCurrentSession()),
        2_000,
      ).catch(() => undefined);
      current = this.context.getCurrentSession();
    }
    if (current && current.getSessionId() !== sessionId) {
      await this.discardCurrentSession();
      current = null;
    }
    if (!current) {
      (window as unknown as CastApis).chrome.cast.requestSessionById(sessionId);
      await this.waitFor(
        () => Boolean(this.context?.getCurrentSession()),
        15_000,
      );
      current = this.context.getCurrentSession();
    }
    if (!current || current.getSessionId() !== sessionId)
      throw new Error("The active Cast session could not be found.");
    this.syncSession(current);
    const remoteConnected = await this.waitFor(
      () => Boolean(this.remote?.isConnected),
      10_000,
    )
      .then(() => true)
      .catch(() => false);
    return remoteConnected ? this.syncRemote() : this.syncSession(current);
  }

  public async loadMedia(options: CastLoadOptions): Promise<CastAdapterState> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.loadMediaOnce(options);
      } catch (error) {
        lastError = error;
        if (attempt < 2)
          await new Promise<void>((resolve) =>
            window.setTimeout(resolve, 300 * 2 ** attempt),
          );
      }
    }
    throw lastError;
  }

  private async loadMediaOnce(
    options: CastLoadOptions,
  ): Promise<CastAdapterState> {
    const global = window as unknown as CastApis;
    const session = this.context?.getCurrentSession();
    if (!session || !options.episode.enclosureUrl)
      throw new Error("A Cast session or playable enclosure is missing.");
    const mediaInfo = new global.chrome.cast.media.MediaInfo(
      options.episode.enclosureUrl,
      options.episode.enclosureType ?? "audio/mpeg",
    );
    const metadata = new global.chrome.cast.media.GenericMediaMetadata();
    metadata.title = options.episode.title;
    metadata.subtitle = options.episode.podcastTitle;
    if (options.episode.publishedAt)
      metadata.releaseDate = options.episode.publishedAt;
    metadata.images = options.episode.artworkUrl
      ? [new global.chrome.cast.Image(options.episode.artworkUrl)]
      : [];
    mediaInfo.metadata = metadata;
    if (options.episode.durationMs)
      mediaInfo.duration = options.episode.durationMs / 1000;
    const request = new global.chrome.cast.media.LoadRequest(mediaInfo);
    request.currentTime = options.positionMs / 1000;
    request.autoplay = options.autoplay;
    request.playbackRate = options.playbackRate;
    this.loadingMedia = true;
    this.mediaActive = false;
    try {
      await session.loadMedia(request);
      this.mediaActive = true;
      await this.waitFor(
        () =>
          Boolean(this.remote?.isMediaLoaded) ||
          ["PLAYING", "PAUSED", "BUFFERING"].includes(
            this.remote?.playerState ?? "",
          ),
        2_000,
      ).catch(() => undefined);
      this.syncRemote();
      if (
        options.autoplay &&
        (this.remote?.isPaused || this.remote?.playerState === "PAUSED")
      ) {
        this.controller?.playOrPause();
        await this.waitFor(
          () =>
            this.remote?.playerState === "PLAYING" ||
            this.remote?.isPaused === false,
          2_000,
        ).catch(() => undefined);
      }
      const volume = session.getVolume();
      const muted = session.isMute();
      this.update({
        connected: true,
        playing: options.autoplay,
        buffering: false,
        positionMs: options.positionMs,
        durationMs: options.episode.durationMs ?? 0,
        volume: typeof volume === "number" ? volume : this.current.volume,
        muted: typeof muted === "boolean" ? muted : this.current.muted,
        sessionId: session.getSessionId(),
        deviceName: session.getCastDevice().friendlyName ?? "Cast device",
        mediaLoaded: true,
        playerState: options.autoplay ? "PLAYING" : "PAUSED",
      });
      return this.state();
    } finally {
      this.loadingMedia = false;
    }
  }

  public async play(): Promise<CastAdapterState> {
    if (this.remote?.isPaused) this.controller?.playOrPause();
    return this.afterCommand();
  }

  public async pause(): Promise<CastAdapterState> {
    if (this.remote && !this.remote.isPaused) this.controller?.playOrPause();
    return this.afterCommand();
  }

  public async seek(positionMs: number): Promise<CastAdapterState> {
    if (!this.remote) throw new Error("No Cast player is connected.");
    this.remote.currentTime = positionMs / 1000;
    this.controller?.seek();
    return this.afterCommand();
  }

  public async setVolume(volume: number): Promise<CastAdapterState> {
    if (!this.remote) throw new Error("No Cast player is connected.");
    this.remote.volumeLevel = Math.max(0, Math.min(1, volume));
    this.controller?.setVolumeLevel();
    return this.afterCommand();
  }

  public async setMuted(muted: boolean): Promise<CastAdapterState> {
    if (!this.remote) throw new Error("No Cast player is connected.");
    if (this.remote.isMuted !== muted) this.controller?.muteOrUnmute();
    return this.afterCommand();
  }

  public async reselect(options: CastLoadOptions): Promise<CastAdapterState> {
    if (!this.context) throw new Error("Google Cast is unavailable.");
    const priorSessionId = this.context.getCurrentSession()?.getSessionId();
    await this.context.requestSession();
    const next = this.context.getCurrentSession();
    if (
      next &&
      (next.getSessionId() !== priorSessionId || !this.remote?.isMediaLoaded)
    )
      await this.loadMedia(options);
    return this.syncRemote();
  }

  public async endSession(): Promise<CastAdapterState> {
    this.mediaActive = false;
    this.context?.endCurrentSession(true);
    await this.waitFor(
      () =>
        !this.context?.getCurrentSession() ||
        this.remote?.isConnected === false,
      2_000,
    ).catch(() => undefined);
    this.update({
      connected: false,
      playing: false,
      buffering: false,
      sessionId: null,
      deviceName: null,
      mediaLoaded: false,
      playerState: null,
    });
    return this.state();
  }

  private async discardCurrentSession(): Promise<void> {
    const session = this.context?.getCurrentSession();
    if (!session) return;
    this.mediaActive = false;
    await session.endSession(false);
    await this.waitFor(() => !this.context?.getCurrentSession(), 2_000);
    this.update({
      connected: false,
      playing: false,
      buffering: false,
      sessionId: null,
      deviceName: null,
      mediaLoaded: false,
      playerState: null,
    });
  }

  private async afterCommand(): Promise<CastAdapterState> {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
    return this.syncRemote();
  }

  private async waitFor(
    predicate: () => boolean,
    timeoutMs = 5_000,
  ): Promise<void> {
    const started = Date.now();
    while (!predicate()) {
      if (Date.now() - started >= timeoutMs)
        throw new Error("The Cast receiver did not confirm the connection.");
      await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    }
  }

  private syncRemote(): CastAdapterState {
    const session = this.context?.getCurrentSession();
    const remote = this.remote;
    if (!remote) return this.state();
    const remotePositionMs = Math.max(
      0,
      Math.round((remote.currentTime || 0) * 1000),
    );
    const remoteDurationMs = Math.max(
      0,
      Math.round((remote.duration || 0) * 1000),
    );
    const preserveLastPosition =
      !this.loadingMedia &&
      remotePositionMs === 0 &&
      this.current.positionMs > 0 &&
      (!remote.isMediaLoaded ||
        remote.playerState === "IDLE" ||
        !remote.isConnected);
    const positionMs = preserveLastPosition
      ? this.current.positionMs
      : remotePositionMs;
    const durationMs = remoteDurationMs || this.current.durationMs;
    const idleReason = session?.getMediaSession()?.idleReason ?? null;
    const activeState = ["PLAYING", "PAUSED", "BUFFERING"].includes(
      remote.playerState ?? "",
    );
    if (remote.isMediaLoaded || activeState) this.mediaActive = true;
    let completionSequence = this.current.completionSequence;
    if (
      !this.loadingMedia &&
      remote.isConnected &&
      remote.playerState === "IDLE" &&
      this.mediaActive &&
      (idleReason === "FINISHED" ||
        (durationMs > 0 && positionMs >= durationMs - 2_000) ||
        (idleReason === null &&
          this.current.playerState === "PLAYING" &&
          !remote.isMediaLoaded))
    ) {
      this.mediaActive = false;
      completionSequence += 1;
    }
    this.update({
      connected: remote.isConnected,
      playing: remote.playerState === "PLAYING",
      buffering: remote.playerState === "BUFFERING",
      positionMs,
      durationMs,
      volume: remote.volumeLevel,
      muted: remote.isMuted,
      sessionId: session?.getSessionId() ?? null,
      deviceName: session?.getCastDevice().friendlyName ?? null,
      mediaLoaded: remote.isMediaLoaded,
      playerState: remote.playerState,
      completionSequence,
    });
    return this.snapshot();
  }

  private syncSession(
    session = this.context?.getCurrentSession(),
  ): CastAdapterState {
    if (!session) return this.state();
    const volume = session.getVolume();
    const muted = session.isMute();
    this.update({
      connected: true,
      sessionId: session.getSessionId(),
      deviceName: session.getCastDevice().friendlyName ?? "Cast device",
      volume: typeof volume === "number" ? volume : this.current.volume,
      muted: typeof muted === "boolean" ? muted : this.current.muted,
    });
    return this.snapshot();
  }

  private update(update: Partial<CastAdapterState>): void {
    this.current = { ...this.current, ...update };
    const state = this.snapshot();
    for (const listener of this.listeners) listener(state);
  }

  private snapshot(): CastAdapterState {
    return { ...this.current };
  }
}

export function confirmedCastState(
  adapter: CastAdapterState,
  episode: Episode,
  playbackRate: number,
): CastConfirmedState {
  if (!adapter.sessionId) throw new Error("The Cast session is not ready.");
  return {
    episodeId: episode.id,
    positionMs: adapter.positionMs,
    durationMs: adapter.durationMs || episode.durationMs,
    state: adapter.playing ? "playing" : "paused",
    playbackRate,
    castSessionId: adapter.sessionId,
    volume: adapter.volume,
    muted: adapter.muted,
  };
}

export const castAdapter = new GoogleCastAdapter();