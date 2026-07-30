import type { Episode } from "@podwaffle/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmedCastState, GoogleCastAdapter } from "./cast-adapter";

afterEach(() => vi.unstubAllGlobals());

describe("Google Cast Web Sender adapter", () => {
  it("loads enclosure metadata and exposes receiver-confirmed controls", async () => {
    const remote = {
      isConnected: true,
      isPaused: false,
      isMediaLoaded: false,
      playerState: "PLAYING",
      currentTime: 0,
      duration: 600,
      volumeLevel: 1,
      isMuted: false,
      playbackRate: 1,
    };
    let loaded:
      | {
          currentTime: number;
          autoplay: boolean;
          playbackRate: number;
          mediaInfo: {
            contentId: string;
            contentType: string;
            metadata?: {
              title?: string;
              subtitle?: string;
              images?: Array<{ url: string }>;
            };
          };
        }
      | undefined;
    let remoteChanged: (() => void) | undefined;
    const playOrPause = vi.fn(() => {
      remote.isPaused = !remote.isPaused;
      remote.playerState = remote.isPaused ? "PAUSED" : "PLAYING";
    });
    const session = {
      getSessionId: () => "session-1",
      getCastDevice: () => ({ friendlyName: "Kitchen speaker" }),
      getMediaSession: () => null,
      getVolume: () => remote.volumeLevel,
      isMute: () => remote.isMuted,
      loadMedia: (request: NonNullable<typeof loaded>) => {
        loaded = request;
        remote.currentTime = request.currentTime;
        remote.isMediaLoaded = true;
        remote.isPaused = true;
        remote.playerState = "PAUSED";
        return Promise.resolve();
      },
      endSession: vi.fn(() => {
        remote.isConnected = false;
        return Promise.resolve();
      }),
    };
    let currentSession: typeof session | null = null;
    const context = {
      setOptions: vi.fn(),
      addEventListener: vi.fn(),
      requestSession: vi.fn(() => {
        currentSession = session;
        remote.isConnected = true;
        return Promise.resolve();
      }),
      getCurrentSession: () => currentSession,
      endCurrentSession: vi.fn(() => {
        currentSession = null;
        remote.isConnected = false;
      }),
    };
    class MediaInfo {
      public metadata?: {
        title?: string;
        subtitle?: string;
        images?: Array<{ url: string }>;
      };
      public duration?: number;
      public constructor(
        public contentId: string,
        public contentType: string,
      ) {}
    }
    class LoadRequest {
      public currentTime = 0;
      public autoplay = false;
      public playbackRate = 1;
      public constructor(public mediaInfo: InstanceType<typeof MediaInfo>) {}
    }
    class Metadata {
      public title?: string;
      public subtitle?: string;
      public images?: Array<{ url: string }>;
      public releaseDate?: string;
    }
    class Controller {
      public addEventListener(_type: string, listener: () => void): void {
        remoteChanged = listener;
      }
      public playOrPause(): void {
        playOrPause();
      }
      public seek(): void {}
      public setVolumeLevel(): void {}
      public muteOrUnmute(): void {
        remote.isMuted = !remote.isMuted;
      }
    }
    const fakeWindow = {
      setTimeout,
      cast: {
        framework: {
          CastContext: { getInstance: () => context },
          RemotePlayer: class {
            public constructor() {
              return remote;
            }
          },
          RemotePlayerController: Controller,
          RemotePlayerEventType: { ANY_CHANGE: "any" },
          CastContextEventType: { SESSION_STATE_CHANGED: "session" },
        },
      },
      chrome: {
        cast: {
          AutoJoinPolicy: { ORIGIN_SCOPED: "origin_scoped" },
          requestSessionById: vi.fn(),
          Image: class {
            public constructor(public url: string) {}
          },
          media: {
            DEFAULT_MEDIA_RECEIVER_APP_ID: "default-receiver",
            MediaInfo,
            GenericMediaMetadata: Metadata,
            LoadRequest,
          },
        },
      },
    };
    vi.stubGlobal("window", fakeWindow);

    const adapter = new GoogleCastAdapter();
    expect(await adapter.initialize()).toBe(true);
    const connected = await adapter.connectAndLoad({
      episode,
      positionMs: 42_000,
      autoplay: true,
      playbackRate: 1,
    });
    expect(context.setOptions).toHaveBeenCalledWith({
      receiverApplicationId: "default-receiver",
      autoJoinPolicy: "origin_scoped",
      resumeSavedSession: false,
    });
    expect(loaded).toMatchObject({
      currentTime: 42,
      autoplay: true,
      mediaInfo: {
        contentId: episode.enclosureUrl,
        contentType: "audio/mpeg",
        metadata: {
          title: episode.title,
          subtitle: episode.podcastTitle,
          images: [{ url: episode.artworkUrl }],
        },
      },
    });
    expect(connected).toMatchObject({
      connected: true,
      playing: true,
      deviceName: "Kitchen speaker",
      sessionId: "session-1",
      positionMs: 42_000,
    });
    expect(playOrPause).toHaveBeenCalledTimes(1);

    remote.isMediaLoaded = false;
    remoteChanged?.();
    expect(adapter.state().completionSequence).toBe(0);
    remote.currentTime = 0;
    remote.playerState = "IDLE";
    remoteChanged?.();
    expect(adapter.state().completionSequence).toBe(1);
    remote.playerState = "PLAYING";
    remote.isMediaLoaded = true;

    expect((await adapter.seek(55_000)).positionMs).toBe(55_000);
    expect((await adapter.setVolume(0.4)).volume).toBe(0.4);
    expect((await adapter.setMuted(true)).muted).toBe(true);
    expect(confirmedCastState(adapter.state(), episode, 1)).toMatchObject({
      episodeId: episode.id,
      castSessionId: "session-1",
      positionMs: 55_000,
      volume: 0.4,
      muted: true,
    });
    remote.currentTime = 0;
    remote.isConnected = false;
    remote.isMediaLoaded = false;
    remote.playerState = "UNKNOWN";
    remoteChanged?.();
    expect(adapter.state().positionMs).toBe(55_000);

    expect(await adapter.endSession()).toMatchObject({
      connected: false,
      positionMs: 55_000,
    });
    expect(context.endCurrentSession).toHaveBeenCalledWith(true);
    expect(session.endSession).not.toHaveBeenCalled();
  });
});

const episode: Episode = {
  id: "00000000-0000-4000-8000-000000000001",
  podcastId: "00000000-0000-4000-8000-000000000002",
  podcastTitle: "Test show",
  title: "Cast me",
  descriptionHtml: null,
  enclosureUrl: "https://example.test/cast.mp3",
  enclosureType: "audio/mpeg",
  publishedAt: "2026-07-29T12:00:00.000Z",
  firstDiscoveredAt: "2026-07-29T12:00:00.000Z",
  durationMs: 600_000,
  artworkUrl: "https://example.test/art.jpg",
  episodeUrl: null,
  positionMs: 0,
  played: false,
  playedAt: null,
  manualPlayState: "none",
  lastPlayedAt: null,
};
