import { afterEach, describe, expect, it, jest } from "@jest/globals";

import { api } from "./client";

describe("Firebase health compatibility", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("falls back to the legacy push config when the server lacks the health route", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          error: {
            code: "NOT_FOUND",
            message: "The requested resource was not found",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          enabled: true,
          projectId: "podwaffle-project",
          androidAppId: "podwaffle-android-app",
        }),
      });
    global.fetch = fetchMock;

    await expect(
      api.pushHealth("https://podwaffle.example", "device-token"),
    ).resolves.toMatchObject({
      enabled: true,
      status: "configured",
      projectId: "podwaffle-project",
      deviceRegistered: null,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://podwaffle.example/api/v1/push/config",
      expect.any(Object),
    );
  });
});

describe("playback network deadlines", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });
  it("aborts a stalled lease request after three seconds", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const request = api.acquirePlayback("https://example.test", "token", {
      positionMs: 0,
      playbackRate: 1,
    });
    const assertion = expect(request).rejects.toThrow(
      "did not respond in time",
    );
    await jest.advanceTimersByTimeAsync(3_000);
    await assertion;
    expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
