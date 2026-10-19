import { synchronizeFromPush } from "./pushSync";
import { downloadAnalysedEpisodes } from "./analysisDownloads";
import { playbackController } from "../playback/controller";
import { useAuthStore } from "../stores/auth";
import { syncRuntime } from "./runtime";
import { recordPushDiagnostic } from "./pushDiagnostics";

jest.mock("./analysisDownloads", () => ({
  downloadAnalysedEpisodes: jest.fn(),
}));
jest.mock("../playback/controller", () => ({
  playbackController: { flushPendingPlayback: jest.fn() },
}));
jest.mock("../stores/auth", () => ({ useAuthStore: { getState: jest.fn() } }));
jest.mock("./runtime", () => ({
  syncRuntime: { processPendingCommands: jest.fn() },
}));
jest.mock("./pushDiagnostics", () => ({
  recordPushDiagnostic: jest.fn(),
  pushErrorMessage: (error) => error.message,
}));

const refresh = jest.fn();
const authenticated = {
  status: "authenticated",
  credentials: { serverUrl: "https://podwaffle.test", token: "device" },
  refresh,
};
beforeEach(() => {
  jest.resetAllMocks();
  useAuthStore.getState.mockReturnValue(authenticated);
  refresh.mockResolvedValue();
  recordPushDiagnostic.mockResolvedValue();
  downloadAnalysedEpisodes.mockResolvedValue();
  syncRuntime.processPendingCommands.mockResolvedValue();
  playbackController.flushPendingPlayback.mockResolvedValue();
});

it("hands analysis downloads to Android before playback sync or snapshot requests", async () => {
  const order = [];
  downloadAnalysedEpisodes.mockImplementation(async () => {
    order.push("download");
  });
  syncRuntime.processPendingCommands.mockImplementation(async () => {
    order.push("commands");
  });
  refresh.mockImplementation(async () => {
    order.push("refresh");
  });
  await synchronizeFromPush("analysis-ready");
  expect(order).toEqual(["download", "commands", "refresh"]);
});

it("ordinary playback wakes still process commands first and download despite sync failures", async () => {
  const order = [];
  syncRuntime.processPendingCommands.mockImplementation(async () => {
    order.push("commands");
    throw new Error("commands unavailable");
  });
  refresh.mockRejectedValue(new Error("snapshot unavailable"));
  downloadAnalysedEpisodes.mockImplementation(async () => {
    order.push("download");
  });
  await synchronizeFromPush("sync");
  expect(order).toEqual(["commands", "download"]);
  expect(recordPushDiagnostic).toHaveBeenCalledWith(
    "push.playback_commands.failed",
    "commands unavailable",
    "warning",
  );
  expect(recordPushDiagnostic).toHaveBeenCalledWith(
    "push.refresh.failed",
    "snapshot unavailable",
    "warning",
  );
  expect(playbackController.flushPendingPlayback).toHaveBeenCalledTimes(1);
});

it("download failures are recorded without preventing playback catch-up", async () => {
  downloadAnalysedEpisodes.mockRejectedValue(new Error("download unavailable"));
  await synchronizeFromPush("analysis-ready");
  expect(recordPushDiagnostic).toHaveBeenCalledWith(
    "push.analysis_downloads.failed",
    "download unavailable",
    "warning",
  );
  expect(syncRuntime.processPendingCommands).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("restores authentication before handling a background analysis message", async () => {
  const restore = jest.fn(async () => {
    useAuthStore.getState.mockReturnValue(authenticated);
  });
  useAuthStore.getState.mockReturnValue({ status: "restoring", restore });
  await synchronizeFromPush("analysis-ready");
  expect(restore).toHaveBeenCalledTimes(1);
  expect(downloadAnalysedEpisodes).toHaveBeenCalledTimes(1);
});

it("does not download when the device is signed out", async () => {
  useAuthStore.getState.mockReturnValue({
    status: "signed-out",
    credentials: null,
  });
  await synchronizeFromPush("analysis-ready");
  expect(downloadAnalysedEpisodes).not.toHaveBeenCalled();
  expect(syncRuntime.processPendingCommands).not.toHaveBeenCalled();
});
