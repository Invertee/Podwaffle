import {
  queueWithoutPendingCompletions,
  snapshotWithoutCompletedEpisodes,
  snapshotWithoutPendingCompletions,
} from "./queueReconciliation";

function episode(id, overrides = {}) {
  return {
    id,
    podcastId: "00000000-0000-4000-8000-000000000001",
    podcastTitle: "Test podcast",
    title: `Episode ${id}`,
    descriptionHtml: null,
    enclosureUrl: `https://example.test/${id}.mp3`,
    enclosureType: "audio/mpeg",
    publishedAt: null,
    firstDiscoveredAt: "2026-08-12T00:00:00.000Z",
    durationMs: 60_000,
    artworkUrl: null,
    episodeUrl: null,
    positionMs: 0,
    played: false,
    playedAt: null,
    manualPlayState: "none",
    lastPlayedAt: null,
    ...overrides,
  };
}

function queueItem(id, sortIndex, overrides = {}) {
  return {
    id: `10000000-0000-4000-8000-00000000000${sortIndex}`,
    sortIndex,
    addedAt: "2026-08-12T00:00:00.000Z",
    episode: episode(id),
    ...overrides,
  };
}

function update(episodeId, completed) {
  return {
    episodeId,
    positionMs: completed ? 60_000 : 20_000,
    durationMs: 60_000,
    state: completed ? "stopped" : "paused",
    playbackRate: 1,
    completed,
    updatedAt: "2026-08-12T00:00:00.000Z",
  };
}

function snapshot(queue, playbackEpisode = null) {
  return {
    revision: 1,
    profile: {
      id: "00000000-0000-4000-8000-000000000001",
      displayName: "Test",
      timezone: "Europe/London",
      settings: {},
    },
    devices: [],
    subscriptions: [],
    queue,
    playback: playbackEpisode
      ? {
          episode: playbackEpisode,
          positionMs: playbackEpisode.positionMs,
          durationMs: playbackEpisode.durationMs,
          state: "playing",
          mode: "local",
          playbackRate: 1,
          activeDeviceId: null,
          leaseExpiresAt: null,
          castOwnerDeviceId: null,
          castSessionId: null,
          ownedByCurrentDevice: false,
        }
      : null,
  };
}

describe("queueWithoutPendingCompletions", () => {
  it("removes durable and in-memory completions but keeps ordinary progress", () => {
    const queue = [
      queueItem("one", 0),
      queueItem("two", 1),
      queueItem("three", 2),
    ];

    expect(
      queueWithoutPendingCompletions(
        queue,
        [update("one", true), update("two", false)],
        "three",
      ).map((item) => item.episode.id),
    ).toEqual(["two"]);
  });

  it("drops queue rows that predate completion but keeps an explicit requeue", () => {
    const playedAt = "2026-08-12T00:01:00.000Z";
    const stale = queueItem("stale", 0, {
      episode: episode("stale", { played: true, playedAt }),
    });
    const replay = queueItem("replay", 1, {
      addedAt: "2026-08-12T00:02:00.000Z",
      episode: episode("replay", { played: true, playedAt }),
    });

    expect(
      queueWithoutPendingCompletions([stale, replay], [], null).map(
        (item) => item.episode.id,
      ),
    ).toEqual(["replay"]);
  });

  it("clears stale shared playback when its episode is completed locally", () => {
    const current = queueItem("one", 0);
    const upcoming = queueItem("two", 1);
    const currentSnapshot = snapshot([current, upcoming], current.episode);

    const reconciled = snapshotWithoutCompletedEpisodes(currentSnapshot, [
      "one",
    ]);

    expect(reconciled.queue.map((item) => item.episode.id)).toEqual(["two"]);
    expect(reconciled.playback).toBeNull();
  });

  it("clears playback for a completed queue row restored by a stale snapshot", () => {
    const current = queueItem("one", 0, {
      episode: episode("one", {
        positionMs: 60_000,
        played: true,
        playedAt: "2026-08-12T00:01:00.000Z",
      }),
    });
    const currentSnapshot = snapshot([current], current.episode);

    const reconciled = snapshotWithoutPendingCompletions(
      currentSnapshot,
      [],
      null,
    );

    expect(reconciled.queue).toEqual([]);
    expect(reconciled.playback).toBeNull();
  });
});
