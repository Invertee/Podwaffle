import {
  pendingProgressIsStale,
  resumePositionMs,
  episodeResumePosition,
} from "./progressReconciliation";

describe("progress reconciliation", () => {
  it("resumes stale list entries from pending or snapshot progress", () => {
    expect(
      episodeResumePosition(
        { played: false, positionMs: 0 },
        { positionMs: 80_000 },
        { positionMs: 60_000 },
      ),
    ).toBe(80_000);
    expect(
      episodeResumePosition({ played: false, positionMs: 0 }, undefined, {
        positionMs: 60_000,
      }),
    ).toBe(60_000);
  });
  it("preserves explicit offline rewinds and completed replays", () => {
    expect(
      episodeResumePosition(
        { played: false, positionMs: 80_000 },
        { positionMs: 20_000, allowRegression: true },
      ),
    ).toBe(20_000);
    expect(
      episodeResumePosition(
        { played: true, positionMs: 80_000 },
        { positionMs: 70_000 },
      ),
    ).toBe(0);
  });
  it("resumes a restored native player from materially newer saved progress", () => {
    expect(resumePositionMs(1_800_000, 0)).toBe(1_800_000);
    expect(resumePositionMs(1_800_000, 1_798_000)).toBe(1_798_000);
  });

  it("drops an older pending report but preserves an explicit offline rewind", () => {
    const serverEpisode = { played: false, positionMs: 1_800_000 };
    const stale = { completed: false, positionMs: 300_000 };
    expect(pendingProgressIsStale(stale, serverEpisode)).toBe(true);
    expect(
      pendingProgressIsStale(
        { ...stale, allowRegression: true },
        serverEpisode,
      ),
    ).toBe(false);
  });
});
