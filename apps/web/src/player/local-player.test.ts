import type { Episode, PlaybackState, QueueItem } from "@podwaffle/contracts";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as LocalPlayerModule from "./local-player";
import type {
  CastAdapter,
  CastAdapterState,
  CastLoadOptions,
} from "./cast-adapter";

const api = vi.hoisted(() => ({
  acquirePlayback: vi.fn(),
  completeEpisode: vi.fn(),
  movement: vi.fn(),
  telemetry: vi.fn(),
  updatePlayback: vi.fn(),
  startCast: vi.fn(),
  stopCast: vi.fn(),
  playbackCommand: vi.fn(),
  playback: vi.fn(),
}));

vi.mock("../api/client", () => ({ api }));

class FakeAudio extends EventTarget {
  public preload = "";
  public disableRemotePlayback = false;
  public src = "";
  public currentTime = 0;
  public duration = 60;
  public readyState = 1;
  public playbackRate = 1;
  public volume = 1;
  public paused = true;

  public play(): Promise<void> {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  }

  public pause(): void {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }

  public load(): void {
    if (!this.src) {
      this.readyState = 0;
      return;
    }
    this.readyState = 1;
    queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
  }

  public removeAttribute(name: string): void {
    if (name === "src") {
      this.src = "";
      this.readyState = 0;
    }
  }

  public finish(): void {
    this.currentTime = this.duration;
    this.paused = true;
    this.dispatchEvent(new Event("ended"));
  }
}

const first = episode("first", "First episode", 60_000);
const second = episode("second", "Second episode", 90_000);
let audio: FakeAudio;
let playerModule: typeof LocalPlayerModule;

beforeAll(async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal("navigator", {});
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      setInterval: () => 1,
      clearInterval: () => undefined,
      setTimeout: (handler: () => void) => {
        handler();
        return 1;
      },
    }),
  );
  vi.stubGlobal(
    "Audio",
    class {
      public constructor() {
        audio = new FakeAudio();
        return audio;
      }
    },
  );
  playerModule = await import("./local-player");
});

beforeEach(() => {
  vi.clearAllMocks();
  api.acquirePlayback.mockResolvedValue({});
  api.telemetry.mockResolvedValue({ recorded: true });
  api.updatePlayback.mockResolvedValue({});
  api.startCast.mockResolvedValue({});
  api.stopCast.mockResolvedValue({});
  api.playbackCommand.mockResolvedValue({});
  api.playback.mockResolvedValue({ mode: "local" });
  playerModule.usePlayer.setState({
    episode: null,
    playing: false,
    buffering: false,
    positionMs: 0,
    durationMs: 0,
    rate: 1,
    volume: 1,
    muted: false,
    error: null,
    mode: "local",
    remote: false,
    castDeviceName: null,
    castSessionId: null,
    castStatus: "idle",
  });
});

describe("local player completion", () => {
  it("saves the outgoing episode position before loading another episode", async () => {
    await playerModule.player.load(first, false);
    audio.currentTime = 22;

    await playerModule.player.load(second, false);

    expect(api.updatePlayback).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeId: first.id,
        positionMs: 22_000,
        state: "paused",
      }),
    );
  });

  it("loads the next queued episode when media ends", async () => {
    const queue = [queueItem(second)];
    api.completeEpisode.mockResolvedValue({ queue });
    const observedQueues: QueueItem[][] = [];
    const unsubscribe = playerModule.player.subscribeQueue((nextQueue) =>
      observedQueues.push(nextQueue),
    );

    await playerModule.player.load(first, false);
    audio.finish();

    await vi.waitFor(() =>
      expect(playerModule.usePlayer.getState().episode?.id).toBe(second.id),
    );
    expect(api.completeEpisode).toHaveBeenCalledWith(first.id, 60_000, 60_000);
    expect(playerModule.usePlayer.getState().playing).toBe(true);
    expect(observedQueues).toEqual([queue]);
    unsubscribe();
  });

  it("clears the player when the final media item ends", async () => {
    api.completeEpisode.mockResolvedValue({ queue: [] });

    await playerModule.player.load(first, false);
    audio.finish();

    await vi.waitFor(() =>
      expect(playerModule.usePlayer.getState().episode).toBeNull(),
    );
    expect(playerModule.usePlayer.getState()).toMatchObject({
      playing: false,
      buffering: false,
      positionMs: 0,
      durationMs: 0,
      error: null,
    });
    expect(audio.src).toBe("");
  });
});

describe("local player restoration", () => {
  it("restores a saved local episode at its saved position", async () => {
    const isolated = new playerModule.LocalPlayer(new FakeCastAdapter());
    const shared: PlaybackState = {
      episode: first,
      positionMs: 25_000,
      durationMs: 60_000,
      state: "paused",
      mode: "local",
      playbackRate: 1.25,
      activeDeviceId: "this-device",
      leaseExpiresAt: "2026-07-29T16:00:00.000Z",
      castOwnerDeviceId: null,
      castSessionId: null,
      ownedByCurrentDevice: true,
    };

    isolated.applySharedPlayback(shared);

    await vi.waitFor(() =>
      expect(playerModule.usePlayer.getState().episode?.id).toBe(first.id),
    );
    expect(audio.currentTime).toBe(25);
    expect(audio.playbackRate).toBe(1.25);
    expect(audio.paused).toBe(true);
  });
});

describe("local and Cast handoff", () => {
  it("publishes Cast only after receiver load and restores local playback", async () => {
    const cast = new FakeCastAdapter();
    const isolated = new playerModule.LocalPlayer(cast);
    expect(audio.disableRemotePlayback).toBe(true);
    await isolated.load(first, false);
    audio.currentTime = 10;
    const mediaSession = {
      metadata: { title: first.title },
      playbackState: "playing",
      setPositionState: vi.fn(),
    };
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: mediaSession,
    });
    cast.beforeConnectAndLoad = () => {
      expect(audio.src).toBe("");
      expect(audio.paused).toBe(true);
      expect(mediaSession.metadata).toBeNull();
      expect(mediaSession.playbackState).toBe("none");
      expect(mediaSession.setPositionState).toHaveBeenCalledWith();
    };

    await isolated.startCasting();
    Reflect.deleteProperty(navigator, "mediaSession");
    expect(api.updatePlayback).not.toHaveBeenCalled();
    expect(api.startCast).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeId: first.id,
        positionMs: 10_000,
        castSessionId: "mock-session",
      }),
      true,
    );
    expect(playerModule.usePlayer.getState()).toMatchObject({
      mode: "cast",
      castDeviceName: "Mock speaker",
    });

    cast.setState({ positionMs: 22_000, playing: true });
    await isolated.stopCasting();
    expect(api.stopCast).toHaveBeenCalledWith(
      expect.objectContaining({
        positionMs: 22_000,
        state: "playing",
      }),
    );
    expect(audio.currentTime).toBe(22);
    expect(audio.paused).toBe(false);
    expect(cast.endSessionCalls).toBe(1);
    expect(playerModule.usePlayer.getState().mode).toBe("local");
  });

  it("restores local media when Cast selection is cancelled", async () => {
    const cast = new RejectingCastAdapter();
    const isolated = new playerModule.LocalPlayer(cast);
    await isolated.load(first);
    audio.currentTime = 14;

    await isolated.startCasting();

    expect(audio.src).toBe(first.enclosureUrl);
    expect(audio.currentTime).toBe(14);
    expect(audio.paused).toBe(false);
    expect(playerModule.usePlayer.getState()).toMatchObject({
      episode: first,
      mode: "local",
      playing: true,
      castStatus: "error",
      error: "Cast selection was cancelled",
    });
  });

  it("can start a fresh Cast session after stopping the previous one", async () => {
    const cast = new FakeCastAdapter();
    const isolated = new playerModule.LocalPlayer(cast);
    await isolated.load(first);

    await isolated.startCasting();
    cast.setState({ positionMs: 12_000, playing: false });
    await isolated.stopCasting();
    await isolated.startCasting();

    expect(cast.connectAndLoadCalls).toBe(2);
    expect(playerModule.usePlayer.getState()).toMatchObject({
      episode: first,
      mode: "cast",
      castSessionId: "mock-session",
      castStatus: "connected",
      error: null,
    });
  });

  it("keeps episode changes on the active Cast receiver", async () => {
    const cast = new FakeCastAdapter();
    const isolated = new playerModule.LocalPlayer(cast);
    await isolated.load(first, false);
    await isolated.startCasting();
    vi.clearAllMocks();

    await isolated.load(second);

    expect(api.acquirePlayback).not.toHaveBeenCalled();
    expect(cast.state()).toMatchObject({
      connected: true,
      playing: true,
      positionMs: second.positionMs,
    });
    expect(api.startCast).toHaveBeenCalledWith(
      expect.objectContaining({ episodeId: second.id }),
    );
    expect(playerModule.usePlayer.getState()).toMatchObject({
      episode: second,
      mode: "cast",
      playing: true,
    });
  });

  it("advances the shared queue when Cast media ends", async () => {
    const cast = new FakeCastAdapter();
    const isolated = new playerModule.LocalPlayer(cast);
    api.completeEpisode.mockResolvedValue({ queue: [queueItem(second)] });
    await isolated.load(first, false);
    await isolated.startCasting();

    cast.setState({
      playing: false,
      positionMs: 60_000,
      playerState: "IDLE",
      completionSequence: 1,
    });

    await vi.waitFor(() =>
      expect(playerModule.usePlayer.getState().episode?.id).toBe(second.id),
    );
    expect(api.completeEpisode).toHaveBeenCalledWith(first.id, 60_000, 60_000);
    expect(playerModule.usePlayer.getState()).toMatchObject({
      mode: "cast",
      playing: true,
    });
    expect(audio.paused).toBe(true);
  });

  it("rejoins the persisted Cast session after the page state is restored", async () => {
    const cast = new FakeCastAdapter();
    const isolated = new playerModule.LocalPlayer(cast);
    const shared: PlaybackState = {
      episode: first,
      positionMs: 25_000,
      durationMs: 60_000,
      state: "playing",
      mode: "cast",
      playbackRate: 1,
      activeDeviceId: "device-one",
      leaseExpiresAt: "2026-07-29T16:00:00.000Z",
      castOwnerDeviceId: "device-one",
      castSessionId: "persisted-session",
      ownedByCurrentDevice: true,
    };

    isolated.applySharedPlayback(shared);

    await vi.waitFor(() =>
      expect(cast.state().sessionId).toBe("persisted-session"),
    );
    expect(playerModule.usePlayer.getState()).toMatchObject({
      episode: first,
      mode: "cast",
      playing: true,
      volume: 0.5,
      castDeviceName: "Mock speaker",
    });
    expect(api.startCast).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeId: first.id,
        castSessionId: "persisted-session",
      }),
    );
    expect(audio.paused).toBe(true);
  });

  it("does not start locally when the server still has an active Cast session", async () => {
    const cast = new FakeCastAdapter();
    const isolated = new playerModule.LocalPlayer(cast);
    api.playback.mockResolvedValue({
      episode: first,
      positionMs: 25_000,
      durationMs: 60_000,
      state: "playing",
      mode: "cast",
      playbackRate: 1,
      activeDeviceId: "device-one",
      leaseExpiresAt: "2026-07-29T16:00:00.000Z",
      castOwnerDeviceId: "device-one",
      castSessionId: "persisted-session",
      ownedByCurrentDevice: true,
    });

    await isolated.load(second);

    expect(api.acquirePlayback).not.toHaveBeenCalled();
    expect(api.startCast).toHaveBeenLastCalledWith(
      expect.objectContaining({ episodeId: second.id }),
    );
    expect(playerModule.usePlayer.getState()).toMatchObject({
      episode: second,
      mode: "cast",
      playing: true,
      castStatus: "connected",
    });
    expect(audio.paused).toBe(true);
  });

  it("observes a Cast session owned by another device without joining it", async () => {
    const cast = new FakeCastAdapter();
    const isolated = new playerModule.LocalPlayer(cast);
    const shared: PlaybackState = {
      episode: first,
      positionMs: 25_000,
      durationMs: 60_000,
      state: "playing",
      mode: "cast",
      playbackRate: 1,
      activeDeviceId: "old-device",
      leaseExpiresAt: "2026-07-29T16:00:00.000Z",
      castOwnerDeviceId: "old-device",
      castSessionId: "lost-session",
      ownedByCurrentDevice: false,
    };

    isolated.applySharedPlayback(shared);
    await Promise.resolve();

    expect(playerModule.usePlayer.getState()).toMatchObject({
      episode: first,
      mode: "cast",
      remote: true,
      playing: true,
      positionMs: 25_000,
      castSessionId: "lost-session",
      castStatus: "connected",
      error: null,
    });
    expect(cast.state().connected).toBe(false);
    expect(api.startCast).not.toHaveBeenCalled();
    expect(api.stopCast).not.toHaveBeenCalled();
    expect(audio.paused).toBe(true);

    await isolated.play();
    expect(api.playbackCommand).toHaveBeenCalledWith(
      expect.objectContaining({ action: "play" }),
    );
    expect(cast.state().connected).toBe(false);
  });
});

class FakeCastAdapter implements CastAdapter {
  public connectAndLoadCalls = 0;
  public endSessionCalls = 0;
  public beforeConnectAndLoad: (() => void) | undefined;
  private current: CastAdapterState = {
    available: true,
    connected: false,
    playing: false,
    buffering: false,
    positionMs: 0,
    durationMs: 60_000,
    volume: 0.5,
    muted: false,
    sessionId: null,
    deviceName: null,
    mediaLoaded: false,
    playerState: null,
    completionSequence: 0,
  };
  private readonly listeners = new Set<(state: CastAdapterState) => void>();

  public initialize(): Promise<boolean> {
    return Promise.resolve(true);
  }
  public subscribe(listener: (state: CastAdapterState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state());
    return () => this.listeners.delete(listener);
  }
  public state(): CastAdapterState {
    return { ...this.current };
  }
  public connectAndLoad(options: CastLoadOptions): Promise<CastAdapterState> {
    this.connectAndLoadCalls += 1;
    this.beforeConnectAndLoad?.();
    this.setState({
      connected: true,
      playing: options.autoplay,
      positionMs: options.positionMs,
      sessionId: "mock-session",
      deviceName: "Mock speaker",
      mediaLoaded: true,
      playerState: options.autoplay ? "PLAYING" : "PAUSED",
    });
    return Promise.resolve(this.state());
  }
  public resumeSession(sessionId: string): Promise<CastAdapterState> {
    this.setState({
      connected: true,
      sessionId,
      deviceName: "Mock speaker",
      mediaLoaded: true,
      playerState: "PLAYING",
      playing: true,
    });
    return Promise.resolve(this.state());
  }
  public loadMedia(options: CastLoadOptions): Promise<CastAdapterState> {
    this.setState({
      connected: true,
      playing: options.autoplay,
      positionMs: options.positionMs,
      durationMs: options.episode.durationMs ?? 0,
      sessionId: "mock-session",
      deviceName: "Mock speaker",
      mediaLoaded: true,
      playerState: options.autoplay ? "PLAYING" : "PAUSED",
    });
    return Promise.resolve(this.state());
  }
  public play(): Promise<CastAdapterState> {
    this.setState({ playing: true });
    return Promise.resolve(this.state());
  }
  public pause(): Promise<CastAdapterState> {
    this.setState({ playing: false });
    return Promise.resolve(this.state());
  }
  public seek(positionMs: number): Promise<CastAdapterState> {
    this.setState({ positionMs });
    return Promise.resolve(this.state());
  }
  public setVolume(volume: number): Promise<CastAdapterState> {
    this.setState({ volume });
    return Promise.resolve(this.state());
  }
  public setMuted(muted: boolean): Promise<CastAdapterState> {
    this.setState({ muted });
    return Promise.resolve(this.state());
  }
  public reselect(): Promise<CastAdapterState> {
    return Promise.resolve(this.state());
  }
  public endSession(): Promise<CastAdapterState> {
    this.endSessionCalls += 1;
    this.setState({
      connected: false,
      playing: false,
      sessionId: null,
      deviceName: null,
      mediaLoaded: false,
      playerState: null,
    });
    return Promise.resolve(this.state());
  }
  public setState(update: Partial<CastAdapterState>): void {
    this.current = { ...this.current, ...update };
    for (const listener of this.listeners) listener(this.state());
  }
}

class RejectingCastAdapter extends FakeCastAdapter {
  public override connectAndLoad(): Promise<CastAdapterState> {
    this.beforeConnectAndLoad?.();
    return Promise.reject(new Error("Cast selection was cancelled"));
  }
}

function episode(id: string, title: string, durationMs: number): Episode {
  return {
    id: `00000000-0000-4000-8000-0000000000${id === "first" ? "01" : "02"}`,
    podcastId: "00000000-0000-4000-8000-000000000003",
    podcastTitle: "Test show",
    title,
    descriptionHtml: null,
    enclosureUrl: `https://example.test/${id}.mp3`,
    enclosureType: "audio/mpeg",
    publishedAt: null,
    firstDiscoveredAt: "2026-01-01T00:00:00.000Z",
    durationMs,
    artworkUrl: null,
    episodeUrl: null,
    positionMs: 0,
    played: false,
    playedAt: null,
    manualPlayState: "none",
    lastPlayedAt: null,
  };
}

function queueItem(queuedEpisode: Episode): QueueItem {
  return {
    id: "00000000-0000-4000-8000-000000000004",
    sortIndex: 0,
    addedAt: "2026-01-01T00:00:00.000Z",
    episode: queuedEpisode,
  };
}
