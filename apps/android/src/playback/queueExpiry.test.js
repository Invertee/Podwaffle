import { QUEUE_INACTIVITY_MS, snapshotWithoutIdleQueue } from "./queueExpiry";

const activity = Date.parse("2026-10-01T12:00:00Z");
const snapshot = {
  queueLastActivityAt: new Date(activity).toISOString(),
  queue: [
    {
      id: "queued",
      addedAt: "2026-09-01T00:00:00Z",
      episode: { id: "episode", played: false, positionMs: 15_000 },
    },
  ],
  playback: { episode: { id: "episode" }, state: "paused" },
};

it("expires the whole queue exactly 72 hours after activity without marking episodes played", () => {
  expect(
    snapshotWithoutIdleQueue(snapshot, activity + QUEUE_INACTIVITY_MS - 1),
  ).toBe(snapshot);
  expect(
    snapshotWithoutIdleQueue(snapshot, activity + QUEUE_INACTIVITY_MS),
  ).toMatchObject({ queue: [], playback: null });
  expect(snapshot.queue[0].episode).toMatchObject({
    played: false,
    positionMs: 15_000,
  });
});

it("keeps old queue entries when playback or queue activity is recent", () => {
  expect(snapshotWithoutIdleQueue(snapshot, activity + 1_000)).toBe(snapshot);
});

it("uses the latest addition for caches created before activity tracking", () => {
  const oldCache = {
    ...snapshot,
    queueLastActivityAt: undefined,
    queue: [
      ...snapshot.queue,
      {
        ...snapshot.queue[0],
        id: "recent",
        addedAt: new Date(activity).toISOString(),
      },
    ],
  };
  expect(snapshotWithoutIdleQueue(oldCache, activity + 1_000)).toBe(oldCache);
  expect(
    snapshotWithoutIdleQueue(oldCache, activity + QUEUE_INACTIVITY_MS).queue,
  ).toEqual([]);
});
