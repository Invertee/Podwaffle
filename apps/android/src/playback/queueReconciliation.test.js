import {
  queueWithoutPendingCompletions,
  snapshotWithoutCompletedEpisodes,
} from "./queueReconciliation";

function episode(id) {
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
  };
}

function queueItem(id, sortIndex) {
  return {
    id: `10000000-0000-4000-8000-00000000000${sortIndex}`,
    sortIndex,
    addedAt: "2026-08-12T00:00:00.000Z",
    episode: episode(id),
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

  it("clears stale shared playback when its episode is completed locally", () => {
    const current = queueItem("one", 0);
    const upcoming = queueItem("two", 1);
    const snapshot = {
      revision: 1,
      profile: {
        id: "00000000-0000-4000-8000-000000000001",
        displayName: "Test",
        timezone: "Europe/London",
        settings: {},
      },
      devices: [],
      subscriptions: [],
      queue: [current, upcoming],
      playback: {
        episode: current.episode,
        positionMs: 60_000,
        durationMs: 60_000,
        state: "playing",
        mode: "local",
        playbackRate: 1,
        activeDeviceId: null,
        leaseExpiresAt: null,
        castOwnerDeviceId: null,
        castSessionId: null,
        ownedByCurrentDevice: false,
      },
    };

    const reconciled = snapshotWithoutCompletedEpisodes(snapshot, ["one"]);

    expect(reconciled.queue.map((item) => item.episode.id)).toEqual(["two"]);
    expect(reconciled.playback).toBeNull();
  });
});
