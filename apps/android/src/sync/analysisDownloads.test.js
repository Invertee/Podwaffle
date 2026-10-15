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
  jest.clearAllMocks();
  useAuthStore.getState.mockReturnValue({ credentials });
  useDownloadsStore.getState.mockReturnValue({ apply });
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
