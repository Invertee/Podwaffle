import {
  pendingProgressIsStale,
  resumePositionMs,
} from "./progressReconciliation";

describe("progress reconciliation", () => {
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
