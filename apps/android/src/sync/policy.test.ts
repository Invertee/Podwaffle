import { playbackSyncPolicy } from "./policy";

describe("playbackSyncPolicy", () => {
  afterEach(() => playbackSyncPolicy.setTransport("unknown"));

  it("keeps aggressive sync on wifi", () => {
    playbackSyncPolicy.setTransport("wifi");

    expect(playbackSyncPolicy.liveSyncEnabled).toBe(true);
    expect(playbackSyncPolicy.stateReportIntervalMs).toBe(10_000);
    expect(playbackSyncPolicy.telemetryIntervalMs).toBe(15_000);
    expect(playbackSyncPolicy.leaseRenewalMarginMs).toBe(15_000);
  });

  it("uses battery-aware sync on cellular", () => {
    playbackSyncPolicy.setTransport("cellular");

    expect(playbackSyncPolicy.liveSyncEnabled).toBe(false);
    expect(playbackSyncPolicy.stateReportIntervalMs).toBe(30_000);
    expect(playbackSyncPolicy.telemetryIntervalMs).toBe(60_000);
    expect(playbackSyncPolicy.leaseRenewalMarginMs).toBe(5_000);
  });

  it("treats ethernet as a home-like connection", () => {
    playbackSyncPolicy.setTransport("ethernet");
    expect(playbackSyncPolicy.liveSyncEnabled).toBe(true);
  });
});
