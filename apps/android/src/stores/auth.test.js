import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "../api/client";
import { useAuthStore } from "./auth";

jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual(
    "@react-native-async-storage/async-storage/jest/async-storage-mock",
  ),
);
jest.mock("expo-secure-store", () => ({}));
jest.mock("expo-constants", () => ({ expoConfig: {} }));
jest.mock("../api/client", () => ({
  ApiClientError: class ApiClientError extends Error {},
  api: { me: jest.fn(), sync: jest.fn(), snapshot: jest.fn() },
}));
jest.mock("../native-media", () => ({
  PodwaffleMediaModule: { configure: jest.fn().mockResolvedValue() },
}));
jest.mock("./downloads", () => ({ useDownloadsStore: {} }));
jest.mock("../playback/offlineProgress", () => ({
  pendingPlaybackUpdates: jest.fn().mockResolvedValue([]),
}));

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  const profile = { id: "profile" };
  api.me.mockResolvedValue({ profile, device: { id: "device" } });
  api.sync.mockResolvedValue({ snapshotRequired: true });
  useAuthStore.setState({
    credentials: { serverUrl: "https://example.test", token: "token" },
    snapshot: { revision: 1, profile, queue: [], playback: null },
    settingsProfileId: profile.id,
  });
});

it("does not restore an older queue when a delayed refresh finishes after a removal", async () => {
  const response = deferred();
  const requested = deferred();
  api.snapshot.mockImplementation(() => {
    requested.resolve();
    return response.promise;
  });
  const refreshing = useAuthStore.getState().refresh();
  await requested.promise;
  const staleSnapshot = useAuthStore.getState().snapshot;
  await useAuthStore.getState().applyQueueMutation([], 2);
  response.resolve({
    ...staleSnapshot,
    queue: [{ id: "removed", episode: { id: "old" } }],
  });
  await refreshing;
  expect(useAuthStore.getState().snapshot).toMatchObject({
    revision: 2,
    queue: [],
  });
  expect(
    JSON.parse(await AsyncStorage.getItem("podwaffle.snapshot.v1")),
  ).toMatchObject({ revision: 2, queue: [] });
});

it("persists queue activity and expires the cached queue without changing episode progress", async () => {
  const at = Date.parse("2026-10-01T00:00:00Z");
  const episode = { id: "episode", played: false, positionMs: 15_000 };
  useAuthStore.setState({
    snapshot: {
      ...useAuthStore.getState().snapshot,
      queue: [{ id: "queued", addedAt: "2026-09-01T00:00:00Z", episode }],
      playback: { episode },
      queueLastActivityAt: "2026-09-01T00:00:00Z",
    },
  });
  await useAuthStore.getState().recordQueueActivity(at);
  expect(
    JSON.parse(await AsyncStorage.getItem("podwaffle.snapshot.v1"))
      .queueLastActivityAt,
  ).toBe(new Date(at).toISOString());
  expect(
    await useAuthStore
      .getState()
      .expireQueueIfIdle(at + 3 * 24 * 60 * 60 * 1_000 - 1),
  ).toBe(false);
  expect(
    await useAuthStore
      .getState()
      .expireQueueIfIdle(at + 3 * 24 * 60 * 60 * 1_000),
  ).toBe(true);
  expect(useAuthStore.getState().snapshot).toMatchObject({
    queue: [],
    playback: null,
  });
  expect(episode).toMatchObject({ played: false, positionMs: 15_000 });
});
