import { episodeMedia } from "./media";
import { useDownloadsStore } from "../stores/downloads";

jest.mock("../stores/auth", () => ({
  useAuthStore: {
    getState: () => ({
      credentials: { serverUrl: "https://podwaffle.test" },
      snapshot: { subscriptions: [] },
    }),
  },
}));
jest.mock("../stores/downloads", () => ({
  downloadedPath: () => null,
  useDownloadsStore: { getState: jest.fn() },
}));
const episode = {
  id: "one",
  podcastId: "show",
  title: "One",
  podcastTitle: "Show",
  enclosureUrl: "https://publisher.test/one.mp3",
  durationMs: 60000,
  positionMs: 0,
  played: false,
};
beforeEach(() => useDownloadsStore.getState.mockReturnValue({ items: [] }));
it("keeps ordinary series on the feed without ad metadata", () => {
  expect(episodeMedia(episode)).toMatchObject({
    enclosureUrl: episode.enclosureUrl,
    analysedUrl: null,
    analysisSha256: null,
    adSegments: [],
  });
});
it("selects the checked recording while retaining the publisher fallback", () => {
  const analysedMedia = {
    path: "/media/checked",
    sha256: "a".repeat(64),
    adSegments: [{ startMs: 1000, endMs: 2000 }],
  };
  expect(episodeMedia({ ...episode, analysedMedia })).toMatchObject({
    enclosureUrl: episode.enclosureUrl,
    analysedUrl: "https://podwaffle.test/media/checked",
    analysisSha256: analysedMedia.sha256,
    adSegments: analysedMedia.adSegments,
  });
});
it("uses an offline recording's own regions even when a newer analysis exists", () => {
  useDownloadsStore.getState.mockReturnValue({
    items: [
      {
        episodeId: "one",
        state: "completed",
        analysedUrl: "https://podwaffle.test/media/old",
        analysisSha256: "old",
        adSegments: [{ startMs: 5000, endMs: 6000 }],
      },
    ],
  });
  const media = episodeMedia({
    ...episode,
    analysedMedia: {
      path: "/media/new",
      sha256: "new",
      adSegments: [{ startMs: 1000, endMs: 2000 }],
    },
  });
  expect(media).toMatchObject({
    analysedUrl: "https://podwaffle.test/media/old",
    analysisSha256: "old",
    adSegments: [{ startMs: 5000, endMs: 6000 }],
  });
});
it("does not attach markers from the server to an older publisher download", () => {
  useDownloadsStore.getState.mockReturnValue({
    items: [{ episodeId: "one", state: "completed" }],
  });
  expect(
    episodeMedia({
      ...episode,
      analysedMedia: {
        path: "/media/new",
        sha256: "new",
        adSegments: [{ startMs: 1000, endMs: 2000 }],
      },
    }),
  ).toMatchObject({ analysedUrl: null, analysisSha256: null, adSegments: [] });
});
