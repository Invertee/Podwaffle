import { playbackController } from "./controller";
import { api } from "../api/client";
import { PodwaffleMediaModule } from "../native-media";
import { useAuthStore } from "../stores/auth";
import { useNativeMediaStore } from "../stores/nativeMedia";
import { downloadedPath } from "../stores/downloads";
import { pendingPlaybackUpdates, savePendingPlayback } from "./offlineProgress";

jest.mock("../api/client", () => ({
  ApiClientError: class ApiClientError extends Error {},
  createCommandId: () => "command",
  api: {
    acquirePlayback: jest.fn(),
    updatePlayback: jest.fn(),
    saveEpisodeProgress: jest.fn(),
    episode: jest.fn(),
    startCast: jest.fn(),
    telemetry: jest.fn(),
  },
}));
jest.mock("../native-media", () => ({
  PodwaffleMediaModule: {
    refreshCastSession: jest.fn(),
    playEpisode: jest.fn(),
    setQueue: jest.fn(),
    startCast: jest.fn(),
  },
}));
jest.mock("../stores/auth", () => ({ useAuthStore: { getState: jest.fn() } }));
jest.mock("../stores/nativeMedia", () => ({
  useNativeMediaStore: { getState: jest.fn() },
}));
jest.mock("../stores/downloads", () => ({ downloadedPath: jest.fn() }));
jest.mock("../stores/playerUi", () => ({
  usePlayerUiStore: { getState: () => ({ setCastStatus: jest.fn() }) },
}));
jest.mock("./offlineProgress", () => ({
  pendingPlaybackUpdates: jest.fn(),
  savePendingPlayback: jest.fn(),
  acknowledgePendingPlayback: jest.fn(),
  clearPendingCompletion: jest.fn().mockResolvedValue(false),
}));

const episode = {
  id: "episode",
  podcastId: "podcast",
  enclosureUrl: "https://example.test/audio.mp3",
  durationMs: 600_000,
  positionMs: 0,
  played: false,
};
let media;
beforeEach(() => {
  jest.clearAllMocks();
  playbackController.reset();
  jest
    .spyOn(playbackController, "ensureNotificationPermission")
    .mockResolvedValue(true);
  media = {
    state: null,
    castState: { connected: false },
    updateCastState: jest.fn(),
  };
  useNativeMediaStore.getState.mockReturnValue(media);
  useAuthStore.getState.mockReturnValue({
    credentials: { serverUrl: "https://example.test", token: "token" },
    session: { profile: { id: "profile" }, device: { id: "device" } },
    connection: "online",
    snapshot: { playback: null, queue: [], subscriptions: [] },
    removeQueueEpisodesLocally: jest.fn().mockResolvedValue(),
  });
  PodwaffleMediaModule.refreshCastSession.mockImplementation(
    async () => media.castState,
  );
  PodwaffleMediaModule.playEpisode.mockResolvedValue(true);
  PodwaffleMediaModule.setQueue.mockResolvedValue(true);
  PodwaffleMediaModule.startCast.mockResolvedValue(true);
  pendingPlaybackUpdates.mockResolvedValue([]);
  savePendingPlayback.mockImplementation(async (_profile, update) => update);
  downloadedPath.mockReturnValue(null);
  api.acquirePlayback.mockResolvedValue({
    episode,
    positionMs: 42_000,
    leaseExpiresAt: new Date(Date.now() + 45_000).toISOString(),
  });
  api.updatePlayback.mockResolvedValue({
    playback: { leaseExpiresAt: new Date(Date.now() + 45_000).toISOString() },
  });
  api.saveEpisodeProgress.mockResolvedValue({});
  api.episode.mockResolvedValue(episode);
  api.startCast.mockResolvedValue({});
});

afterEach(() => jest.restoreAllMocks());

it("loads local media at the server resume position before queue caching", async () => {
  await playbackController.playEpisode(episode);
  expect(PodwaffleMediaModule.playEpisode).toHaveBeenCalledWith(
    expect.anything(),
    42_000,
  );
  expect(
    PodwaffleMediaModule.playEpisode.mock.invocationCallOrder[0],
  ).toBeLessThan(PodwaffleMediaModule.setQueue.mock.invocationCallOrder[0]);
});

it("does not wait for an outgoing history upload before starting the next episode", async () => {
  media.state = {
    episodeId: "previous",
    positionMs: 25_000,
    durationMs: 600_000,
    playbackRate: 1,
    playbackStatus: "ready",
    playWhenReady: false,
  };
  api.saveEpisodeProgress.mockImplementation(() => new Promise(() => {}));
  await playbackController.playEpisode(episode);
  expect(savePendingPlayback).toHaveBeenCalledWith(
    "profile",
    expect.objectContaining({ episodeId: "previous", positionMs: 25_000 }),
  );
  expect(PodwaffleMediaModule.playEpisode).toHaveBeenCalled();
});

it("uses pending progress when Cast refresh fails", async () => {
  media.castState = { connected: true, session: null };
  pendingPlaybackUpdates.mockResolvedValue([
    { episodeId: episode.id, positionMs: 90_000, completed: false },
  ]);
  api.episode.mockRejectedValue(new Error("offline"));
  await playbackController.playEpisode(episode);
  expect(PodwaffleMediaModule.startCast).toHaveBeenCalledWith(
    expect.anything(),
    90_000,
    true,
  );
});

it("starts streaming with saved progress when the server request times out", async () => {
  api.acquirePlayback.mockRejectedValue(new Error("server timeout"));
  await playbackController.playEpisode({ ...episode, positionMs: 27_000 });
  expect(PodwaffleMediaModule.playEpisode).toHaveBeenCalledWith(
    expect.anything(),
    27_000,
  );
});
