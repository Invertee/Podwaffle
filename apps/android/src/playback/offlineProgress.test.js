import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  acknowledgePendingPlayback,
  clearPendingCompletion,
  clearPendingPlayback,
  pendingPlaybackUpdates,
  savePendingPlayback,
} from "./offlineProgress";

jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual(
    "@react-native-async-storage/async-storage/jest/async-storage-mock",
  ),
);

const profileId = "00000000-0000-4000-8000-000000000001";
const episodeId = "10000000-0000-4000-8000-000000000001";

beforeEach(async () => {
  await AsyncStorage.clear();
  await clearPendingPlayback(profileId);
});

describe("pending playback persistence", () => {
  it("never downgrades a completed update during concurrent writes", async () => {
    await Promise.all([
      savePendingPlayback(profileId, {
        episodeId,
        positionMs: 20_000,
        durationMs: 60_000,
        state: "playing",
        playbackRate: 1,
        completed: false,
      }),
      savePendingPlayback(profileId, {
        episodeId,
        positionMs: 60_000,
        durationMs: 60_000,
        state: "stopped",
        playbackRate: 1,
        completed: true,
      }),
      savePendingPlayback(profileId, {
        episodeId,
        positionMs: 55_000,
        durationMs: null,
        state: "paused",
        playbackRate: 1,
        completed: false,
      }),
    ]);

    expect(await pendingPlaybackUpdates(profileId)).toEqual([
      expect.objectContaining({
        episodeId,
        positionMs: 60_000,
        durationMs: 60_000,
        state: "stopped",
        completed: true,
      }),
    ]);
  });

  it("does not acknowledge an older write after completion replaces it", async () => {
    const progress = await savePendingPlayback(profileId, {
      episodeId,
      positionMs: 30_000,
      durationMs: 60_000,
      state: "playing",
      playbackRate: 1,
      completed: false,
    });
    const completion = await savePendingPlayback(profileId, {
      episodeId,
      positionMs: 60_000,
      durationMs: 60_000,
      state: "stopped",
      playbackRate: 1,
      completed: true,
    });

    expect(await acknowledgePendingPlayback(profileId, progress)).toBe(false);
    expect(await pendingPlaybackUpdates(profileId)).toEqual([completion]);
    expect(await acknowledgePendingPlayback(profileId, completion)).toBe(true);
    expect(await pendingPlaybackUpdates(profileId)).toEqual([]);
  });

  it("only clears a completion when replay is explicit", async () => {
    await savePendingPlayback(profileId, {
      episodeId,
      positionMs: 20_000,
      durationMs: 60_000,
      state: "paused",
      playbackRate: 1,
      completed: false,
    });
    expect(await clearPendingCompletion(profileId, episodeId)).toBe(false);
    expect(await pendingPlaybackUpdates(profileId)).toHaveLength(1);

    await savePendingPlayback(profileId, {
      episodeId,
      positionMs: 60_000,
      durationMs: 60_000,
      state: "stopped",
      playbackRate: 1,
      completed: true,
    });
    expect(await clearPendingCompletion(profileId, episodeId)).toBe(true);
    expect(await pendingPlaybackUpdates(profileId)).toEqual([]);
  });

  it("preserves an explicit offline rewind instead of merging it forward", async () => {
    await savePendingPlayback(profileId, {
      episodeId,
      positionMs: 50_000,
      durationMs: 60_000,
      state: "paused",
      playbackRate: 1,
      completed: false,
    });
    await savePendingPlayback(profileId, {
      episodeId,
      positionMs: 20_000,
      durationMs: 60_000,
      state: "paused",
      playbackRate: 1,
      completed: false,
      allowRegression: true,
    });

    expect(await pendingPlaybackUpdates(profileId)).toEqual([
      expect.objectContaining({
        episodeId,
        positionMs: 20_000,
        allowRegression: true,
      }),
    ]);
  });

  it("only lets a newly explicit rewind move pending progress backward", async () => {
    await savePendingPlayback(profileId, {
      episodeId,
      positionMs: 50_000,
      durationMs: 60_000,
      state: "paused",
      playbackRate: 1,
      completed: false,
    });
    await savePendingPlayback(profileId, {
      episodeId,
      positionMs: 20_000,
      durationMs: 60_000,
      state: "paused",
      playbackRate: 1,
      completed: false,
      allowRegression: true,
    });
    await savePendingPlayback(profileId, {
      episodeId,
      positionMs: 0,
      durationMs: 60_000,
      state: "paused",
      playbackRate: 1,
      completed: false,
    });

    expect(await pendingPlaybackUpdates(profileId)).toEqual([
      expect.objectContaining({
        episodeId,
        positionMs: 20_000,
        allowRegression: true,
      }),
    ]);

    await savePendingPlayback(profileId, {
      episodeId,
      positionMs: 25_000,
      durationMs: 60_000,
      state: "playing",
      playbackRate: 1,
      completed: false,
    });
    expect(await pendingPlaybackUpdates(profileId)).toEqual([
      expect.objectContaining({
        episodeId,
        positionMs: 25_000,
        allowRegression: true,
      }),
    ]);
  });
});
