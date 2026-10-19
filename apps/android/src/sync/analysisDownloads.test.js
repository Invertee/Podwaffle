import { downloadAnalysedEpisodes } from "./analysisDownloads";
import { api, ApiClientError } from "../api/client";
import { PodwaffleMediaModule } from "../native-media";
import { useAuthStore } from "../stores/auth";
import { useDownloadsStore } from "../stores/downloads";

jest.mock("../api/client", () => ({
  api: { analysedDownloads: jest.fn() },
  ApiClientError: class extends Error {
    constructor(status) {
      super();
      this.status = status;
    }
  },
}));
jest.mock("../native-media", () => ({
  PodwaffleMediaModule: { addDownload: jest.fn() },
}));
jest.mock("../stores/auth", () => ({ useAuthStore: { getState: jest.fn() } }));
jest.mock("../stores/downloads", () => ({
  useDownloadsStore: { getState: jest.fn() },
}));
jest.mock("../playback/media", () => ({
  episodeMedia: (episode) => ({
    episodeId: episode.id,
    enclosureUrl: episode.enclosureUrl,
  }),
}));
const credentials = { serverUrl: "https://podwaffle.test", token: "device" };
const apply = jest.fn();
beforeEach(() => {
  jest.resetAllMocks();
  useAuthStore.getState.mockReturnValue({ credentials });
  useDownloadsStore.getState.mockReturnValue({ apply });
});

it("checks again when another completion arrives during an earlier download lookup", async () => {
  let resolveFirst;
  api.analysedDownloads
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockResolvedValueOnce([
      {
        id: "later",
        enclosureUrl: "https://publisher.test/later.mp3",
        analysedMedia: {
          path: "/media/later",
          sha256: "b".repeat(64),
          adSegments: [],
        },
      },
    ]);
  PodwaffleMediaModule.addDownload.mockResolvedValue({
    episodeId: "later",
    state: "queued",
  });
  const first = downloadAnalysedEpisodes();
  const later = downloadAnalysedEpisodes();
  resolveFirst([]);
  await Promise.all([first, later]);
  expect(api.analysedDownloads).toHaveBeenCalledTimes(2);
  expect(PodwaffleMediaModule.addDownload).toHaveBeenCalledWith(
    expect.objectContaining({ episodeId: "later" }),
    "automatic",
  );
});

it("a fresh wake retries when the lookup already in flight fails", async () => {
  let rejectFirst;
  api.analysedDownloads
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
    )
    .mockResolvedValueOnce([]);
  const first = downloadAnalysedEpisodes();
  const later = downloadAnalysedEpisodes();
  const failed = expect(first).rejects.toThrow("temporary outage");
  rejectFirst(new Error("temporary outage"));
  await failed;
  await expect(later).resolves.toBeUndefined();
  expect(api.analysedDownloads).toHaveBeenCalledTimes(2);
});

it("continues other episodes after one native download fails", async () => {
  const media = {
    path: "/media/checked",
    sha256: "a".repeat(64),
    adSegments: [],
  };
  api.analysedDownloads.mockResolvedValue(
    ["bad", "good"].map((id) => ({
      id,
      enclosureUrl: `https://publisher.test/${id}.mp3`,
      analysedMedia: media,
    })),
  );
  PodwaffleMediaModule.addDownload
    .mockRejectedValueOnce(new Error("bad entry"))
    .mockResolvedValueOnce({ episodeId: "good", state: "queued" });
  await expect(downloadAnalysedEpisodes()).rejects.toThrow("bad entry");
  expect(apply).toHaveBeenCalledWith({ episodeId: "good", state: "queued" });
});

it("does not use results from a server or profile that has been disconnected", async () => {
  let resolve;
  api.analysedDownloads.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const downloading = downloadAnalysedEpisodes();
  useAuthStore.getState.mockReturnValue({
    credentials: { ...credentials, serverUrl: "https://another.test" },
  });
  resolve([
    {
      id: "old",
      analysedMedia: {
        path: "/media/old",
        sha256: "a".repeat(64),
        adSegments: [],
      },
    },
  ]);
  await downloading;
  expect(PodwaffleMediaModule.addDownload).not.toHaveBeenCalled();
});
it("keeps older servers compatible when automatic analysis downloads are unavailable", async () => {
  api.analysedDownloads.mockRejectedValue(new ApiClientError(404));
  await expect(downloadAnalysedEpisodes()).resolves.toBeUndefined();
  expect(PodwaffleMediaModule.addDownload).not.toHaveBeenCalled();
});
it("enqueues the checked bytes and regions as an automatic native download", async () => {
  const analysedMedia = {
    path: "/media/exact",
    sha256: "a".repeat(64),
    adSegments: [{ startMs: 1000, endMs: 2000 }],
  };
  api.analysedDownloads.mockResolvedValue([
    {
      id: "episode",
      enclosureUrl: "https://publisher.test/one.mp3",
      analysedMedia,
    },
  ]);
  PodwaffleMediaModule.addDownload.mockResolvedValue({
    episodeId: "episode",
    state: "queued",
  });
  await downloadAnalysedEpisodes();
  expect(PodwaffleMediaModule.addDownload).toHaveBeenCalledWith(
    expect.objectContaining({
      analysedUrl: "https://podwaffle.test/media/exact",
      analysisSha256: analysedMedia.sha256,
      adSegments: analysedMedia.adSegments,
    }),
    "automatic",
  );
  expect(apply).toHaveBeenCalledWith({ episodeId: "episode", state: "queued" });
});
