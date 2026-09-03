const { isConfirmedPlaybackEnd } = require("./completion");

describe("playback completion confirmation", () => {
  it("rejects transient ended states away from the episode end", () => {
    expect(isConfirmedPlaybackEnd(120_000, 3_600_000)).toBe(false);
    expect(isConfirmedPlaybackEnd(0, 3_600_000)).toBe(false);
  });

  it("accepts positions at the duration boundary", () => {
    expect(isConfirmedPlaybackEnd(3_598_000, 3_600_000)).toBe(true);
    expect(isConfirmedPlaybackEnd(3_600_000, 3_600_000)).toBe(true);
  });

  it("leaves unknown-duration completion to the native end event", () => {
    expect(isConfirmedPlaybackEnd(120_000, null)).toBe(false);
  });
});
