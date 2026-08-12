import AsyncStorage from "@react-native-async-storage/async-storage";

import {
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
});
