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
    completeEpisode: jest.fn(),
  },
}));
jest.mock("../native-media", () => ({
  PodwaffleMediaModule: {
    refreshCastSession: jest.fn(),
    playEpisode: jest.fn(),
    setQueue: jest.fn(),
    startCast: jest.fn(),
    stop: jest.fn(),
    stopCast: jest.fn(),
    getPendingCompletions: jest.fn(),
    acknowledgeCompletion: jest.fn(),
  },
}));
jest.mock("../stores/auth", () => ({ useAuthStore: { getState: jest.fn() } }));
jest.mock("../stores/nativeMedia", () => ({
  useNativeMediaStore: { getState: jest.fn() },
}));
jest.mock("../stores/downloads", () => ({
  downloadedPath: jest.fn(),
  useDownloadsStore: { getState: () => ({ items: [] }) },
}));
jest.mock("../stores/playerUi", () => ({
  usePlayerUiStore: { getState: () => ({ setCastStatus: jest.fn() }) },
}));
jest.mock("./offlineProgress", () => ({
  pendingPlaybackUpdates: jest.fn(),
  savePendingPlayback: jest.fn(),
  acknowledgePendingPlayback: jest.fn().mockResolvedValue(true),
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
    clearState: jest.fn(() => {
      media.state = null;
      media.castState = { connected: false };
    }),
  };
  useNativeMediaStore.getState.mockReturnValue(media);
  useAuthStore.getState.mockReturnValue({
    credentials: { serverUrl: "https://example.test", token: "token" },
    session: { profile: { id: "profile" }, device: { id: "device" } },
    connection: "online",
    snapshot: { playback: null, queue: [], subscriptions: [] },
    removeQueueEpisodesLocally: jest.fn().mockResolvedValue(),
    applyQueueMutation: jest.fn().mockResolvedValue(),
    refresh: jest.fn().mockResolvedValue(),
    recordQueueActivity: jest.fn().mockResolvedValue(),
    expireQueueIfIdle: jest.fn().mockResolvedValue(false),
  });
  PodwaffleMediaModule.refreshCastSession.mockImplementation(
    async () => media.castState,
  );
  PodwaffleMediaModule.playEpisode.mockResolvedValue(true);
  PodwaffleMediaModule.setQueue.mockResolvedValue(true);
  PodwaffleMediaModule.startCast.mockResolvedValue(true);
  PodwaffleMediaModule.stop.mockResolvedValue();
  PodwaffleMediaModule.stopCast.mockResolvedValue();
  PodwaffleMediaModule.getPendingCompletions.mockResolvedValue([]);
  PodwaffleMediaModule.acknowledgeCompletion.mockResolvedValue();
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
  api.completeEpisode.mockResolvedValue({ queue: [], revision: 2 });
});

afterEach(() => jest.restoreAllMocks());

it("clears native playback when the cached queue has expired", async () => {
  const auth = useAuthStore.getState();
  auth.snapshot.queue = [queued("old")];
  auth.expireQueueIfIdle.mockResolvedValue(true);
  media.state = {
    episodeId: "old",
    playWhenReady: false,
    playbackStatus: "ready",
  };
  expect(await playbackController.expireIdleQueue()).toBe(true);
  expect(PodwaffleMediaModule.stop).toHaveBeenCalled();
  expect(media.state).toBeNull();
});

it("keeps an active local or Cast queue alive", async () => {
  const auth = useAuthStore.getState();
  auth.snapshot.queue = [queued("active")];
  media.state = {
    episodeId: "active",
    playWhenReady: true,
    playbackStatus: "ready",
    source: "cast",
  };
  const now = Date.now();
  expect(await playbackController.expireIdleQueue(now)).toBe(false);
  expect(auth.recordQueueActivity).toHaveBeenCalledWith(now);
  expect(auth.expireQueueIfIdle).not.toHaveBeenCalled();
});

function queued(id, index = 0) {
  return {
    id: `queue-${id}`,
    sortIndex: index,
    addedAt: "2026-01-01T00:00:00Z",
    episode: { ...episode, id },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("discards an older queue refresh that finishes after a newer one", async () => {
  const auth = useAuthStore.getState();
  auth.snapshot.queue = [queued("old")];
  const older = deferred();
  pendingPlaybackUpdates.mockReturnValueOnce(older.promise);
  const staleSync = playbackController.syncNativeQueue();
  auth.snapshot = { ...auth.snapshot, queue: [queued("new")] };
  await playbackController.syncNativeQueue();
  older.resolve([]);
  await staleSync;
  expect(PodwaffleMediaModule.setQueue).toHaveBeenCalledTimes(1);
  expect(
    PodwaffleMediaModule.setQueue.mock.calls[0][0].items.map(
      (item) => item.episodeId,
    ),
  ).toEqual(["new"]);
});

it("keeps all completed episodes out of stale queues, including native background ends", async () => {
  const auth = useAuthStore.getState();
  auth.snapshot.queue = [queued("one"), queued("two", 1), queued("next", 2)];
  playbackController.completedEpisodeIds.add("one");
  PodwaffleMediaModule.getPendingCompletions.mockResolvedValue([
    { episodeId: "two", positionMs: 600_000, durationMs: 600_000 },
  ]);
  await playbackController.syncNativeQueue();
  expect(
    PodwaffleMediaModule.setQueue.mock.calls[0][0].items.map(
      (item) => item.episodeId,
    ),
  ).toEqual(["next"]);
});

it("allows a completed episode to be explicitly queued again with a new row", async () => {
  const auth = useAuthStore.getState();
  auth.snapshot.queue = [{ ...queued("one"), id: "new-replay-row" }];
  playbackController.completedEpisodeIds.add("one");
  playbackController.completedQueueItemIds.set("one", "old-completed-row");
  await playbackController.syncNativeQueue();
  expect(
    PodwaffleMediaModule.setQueue.mock.calls[0][0].items.map(
      (item) => item.episodeId,
    ),
  ).toEqual(["one"]);
});

it("serializes native queue mutations so the latest queue is applied last", async () => {
  const nativeWrite = deferred();
  const requested = deferred();
  const auth = useAuthStore.getState();
  auth.snapshot.queue = [queued("first")];
  PodwaffleMediaModule.setQueue.mockImplementationOnce(() => {
    requested.resolve();
    return nativeWrite.promise;
  });
  const first = playbackController.syncNativeQueue();
  await requested.promise;
  auth.snapshot = { ...auth.snapshot, queue: [queued("latest")] };
  const latest = playbackController.syncNativeQueue();
  nativeWrite.resolve();
  await Promise.all([first, latest]);
  expect(
    PodwaffleMediaModule.setQueue.mock.calls.map(
      ([queue]) => queue.items[0].episodeId,
    ),
  ).toEqual(["first", "latest"]);
});

it("stops Cast and clears the player when removing the current item", async () => {
  media.state = { episodeId: episode.id, positionMs: 10_000 };
  media.castState = { connected: true };
  await playbackController.clearPlayerForQueueRemoval();
  expect(PodwaffleMediaModule.stopCast).toHaveBeenCalledWith({
    stopReceiver: true,
  });
  expect(PodwaffleMediaModule.stop).toHaveBeenCalled();
  expect(media.state).toBeNull();
  expect(api.updatePlayback).not.toHaveBeenCalled();
});

it("does not restart playback when an old completion response arrives after removal", async () => {
  const response = deferred();
  const requested = deferred();
  api.completeEpisode.mockImplementation(() => {
    requested.resolve();
    return response.promise;
  });
  const finishing = playbackController.finishEpisode({
    episodeId: "one",
    positionMs: 600_000,
    durationMs: 600_000,
  });
  await requested.promise;
  await playbackController.clearPlayerForQueueRemoval();
  response.resolve({ queue: [queued("next")], revision: 2 });
  await finishing;
  expect(PodwaffleMediaModule.playEpisode).not.toHaveBeenCalled();
});

it("imports a native completion into durable pending progress before acknowledging it", async () => {
  const completion = {
    episodeId: "background",
    positionMs: 600_000,
    durationMs: 600_000,
    source: "cast",
  };
  const update = {
    ...completion,
    completed: true,
    state: "stopped",
    playbackRate: 1,
    updatedAt: "2026-01-01",
  };
  PodwaffleMediaModule.getPendingCompletions.mockResolvedValue([completion]);
  pendingPlaybackUpdates.mockResolvedValueOnce([]).mockResolvedValue([update]);
  await playbackController.flushPendingPlayback();
  expect(savePendingPlayback).toHaveBeenCalledWith(
    "profile",
    expect.objectContaining({ episodeId: "background", completed: true }),
  );
  expect(api.completeEpisode).toHaveBeenCalledWith(
    "https://example.test",
    "token",
    "background",
    600_000,
    600_000,
  );
  expect(PodwaffleMediaModule.acknowledgeCompletion).toHaveBeenCalledWith(
    "background",
  );
  expect(api.completeEpisode.mock.invocationCallOrder[0]).toBeLessThan(
    PodwaffleMediaModule.acknowledgeCompletion.mock.invocationCallOrder[0],
  );
});

it("loads local media at the server resume position before queue caching", async () => {
  await playbackController.playEpisode(episode);
  await playbackController.syncNativeQueue(episode.id);
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

it("uses freshly saved Cast progress instead of an older list position", async () => {
  media.castState = { connected: true, session: null };
  api.episode.mockResolvedValue({ ...episode, positionMs: 25_000 });

  await playbackController.playEpisode({ ...episode, positionMs: 90_000 });

  expect(PodwaffleMediaModule.startCast).toHaveBeenCalledWith(
    expect.anything(),
    25_000,
    true,
  );
});

it("starts streaming with saved progress when the server request times out", async () => {
  api.acquirePlayback.mockRejectedValue(new Error("server timeout"));
  api.episode.mockRejectedValue(new Error("server timeout"));
  await playbackController.playEpisode({ ...episode, positionMs: 27_000 });
  expect(PodwaffleMediaModule.playEpisode).toHaveBeenCalledWith(
    expect.anything(),
    27_000,
  );
});

it("uses fresh server progress when a local list item is stale", async () => {
  api.episode.mockResolvedValue({ ...episode, positionMs: 25_000 });
  api.acquirePlayback.mockImplementation(async (_server, _token, input) => ({
    episode,
    positionMs: input.positionMs,
    leaseExpiresAt: new Date(Date.now() + 45_000).toISOString(),
  }));

  await playbackController.playEpisode({ ...episode, positionMs: 90_000 });

  expect(PodwaffleMediaModule.playEpisode).toHaveBeenCalledWith(
    expect.anything(),
    25_000,
  );
});
