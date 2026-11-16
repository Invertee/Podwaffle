import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureLogging } from "../src/logging.js";
import { downloadFeed } from "../src/podcasts/feed-download.js";

const feedUrl =
  "https://www.omnycontent.com/d/playlist/show/podcast.rss?source=app&test=1";
const fallbackUrl = feedUrl.replace("www.omnycontent.com", "omnycontent.com");
const rss =
  '<rss><channel><title>Test podcast</title><item><guid>new-episode</guid><title>New episode</title><enclosure url="https://traffic.omny.fm/new.mp3" type="audio/mpeg"/></item></channel></rss>';

beforeEach(() => {
  configureLogging("info");
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function logs(): string {
  return vi
    .mocked(process.stdout.write)
    .mock.calls.map(([chunk]) => String(chunk))
    .join("");
}

describe("feed download fallback", () => {
  it("uses a working original feed without retrying", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(rss));
    vi.stubGlobal("fetch", fetch);
    const result = await downloadFeed(feedUrl);
    expect(result.feed?.episodes[0]?.guid).toBe("new-episode");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(feedUrl);
  });

  it.each([
    ["DNS failure", () => Promise.reject(new TypeError("fetch failed"))],
    [
      "timeout",
      () => Promise.reject(new DOMException("Timed out", "TimeoutError")),
    ],
    [
      "HTTP failure",
      () => Promise.resolve(new Response("Forbidden", { status: 403 })),
    ],
    [
      "invalid RSS",
      () => Promise.resolve(new Response("<html>Unavailable</html>")),
    ],
  ])("retries the non-www address after %s", async (_name, failure) => {
    const fetch = vi
      .fn()
      .mockImplementationOnce(failure)
      .mockResolvedValueOnce(
        new Response(rss, { headers: { etag: '"fresh"' } }),
      );
    vi.stubGlobal("fetch", fetch);
    const headers = {
      "if-none-match": '"old"',
      "if-modified-since": "Sun, 15 Nov 2026 10:00:00 GMT",
    };
    const result = await downloadFeed(feedUrl, headers);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      feedUrl,
      fallbackUrl,
    ]);
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      headers: {
        accept: "application/rss+xml, application/xml, text/xml",
        ...headers,
      },
      redirect: "follow",
      signal: expect.any(AbortSignal),
    });
    expect(result).toMatchObject({
      status: "updated",
      etag: '"fresh"',
      feed: { title: "Test podcast" },
    });
    expect(result.feed?.episodes[0]?.enclosureUrl).toBe(
      "https://traffic.omny.fm/new.mp3",
    );
  });

  it("accepts an unchanged original feed without retrying", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 304, headers: { etag: '"old"' } }),
      );
    vi.stubGlobal("fetch", fetch);
    expect(await downloadFeed(feedUrl)).toMatchObject({
      status: "not-modified",
      etag: '"old"',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("handles an unchanged fallback feed", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetch);
    expect(await downloadFeed(feedUrl)).toMatchObject({
      status: "not-modified",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    "https://example.com/podcast.rss",
    "https://omnycontent.com/podcast.rss",
    "https://www.omnycontent.com.example.com/podcast.rss",
  ])("does not rewrite another hostname: %s", async (url) => {
    const error = new TypeError("fetch failed");
    const fetch = vi.fn().mockRejectedValue(error);
    vi.stubGlobal("fetch", fetch);
    await expect(downloadFeed(url)).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports a failed fallback without retrying again", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await expect(downloadFeed(feedUrl)).rejects.toThrow(
      "Feed refresh failed (503)",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("feed download diagnostics", () => {
  it("reports nested DNS failures, both attempted hosts and a successful fallback", async () => {
    const cause = Object.assign(
      new Error("getaddrinfo ENOTFOUND www.omnycontent.com"),
      { code: "ENOTFOUND", hostname: "www.omnycontent.com" },
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError("fetch failed", { cause }))
        .mockResolvedValueOnce(new Response(rss)),
    );
    await downloadFeed(
      feedUrl,
      {},
      {
        source: "manual",
        podcastId: "show-id",
        podcastTitle: "Behind the Bastards",
      },
    );
    expect(logs()).toContain('errorCodes=["ENOTFOUND"]');
    expect(logs()).toContain("failedHost=www.omnycontent.com");
    expect(logs()).toContain("fallbackHost=omnycontent.com");
    expect(logs()).toContain("feedHost=omnycontent.com");
    expect(logs()).toContain("podcastTitle=Behind the Bastards");
    expect(logs()).toContain("source=manual");
    expect(logs()).toContain("episodes=1");
  });

  it("reports the HTTP status, redirect host and parse stage without exposing private URLs", async () => {
    const response = new Response("<html>Blocked</html>", {
      headers: { "content-type": "text/html" },
    });
    Object.defineProperty(response, "url", {
      value: "https://cdn.example.com/private-feed-token?key=query-secret",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(
      downloadFeed(
        "https://user:password@feeds.example.com/private-feed-token?key=query-secret",
      ),
    ).rejects.toThrow();
    expect(logs()).toContain("responseHost=cdn.example.com");
    expect(logs()).toContain("httpStatus=200");
    expect(logs()).toContain("contentType=text/html");
    expect(logs()).toContain("stage=parse");
    expect(logs()).not.toMatch(/user:password|private-feed-token|query-secret/);
  });

  it("includes connection errors inside aggregate causes while sanitising embedded URLs", async () => {
    const cause = new AggregateError([
      Object.assign(
        new Error(
          "Cannot connect https://user:password@feeds.example.com/private-feed-token?key=query-secret",
        ),
        { code: "ECONNREFUSED" },
      ),
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause })),
    );
    await expect(
      downloadFeed("https://feeds.example.com/feed.rss"),
    ).rejects.toThrow();
    expect(logs()).toContain("ECONNREFUSED");
    expect(logs()).not.toMatch(/user:password|private-feed-token|query-secret/);
  });

  it("distinguishes conditional unchanged responses from downloaded episodes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 304 })),
    );
    await downloadFeed(feedUrl, { "if-none-match": "old" });
    expect(logs()).toContain("Publisher reports no feed changes (HTTP 304)");
    expect(logs()).toContain("conditional=true");
    expect(logs()).not.toContain("Podcast feed downloaded and parsed");
  });

  it("reports the newest publication even when the feed is not sorted", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            "<rss><channel><title>Dates</title><item><title>Older</title><pubDate>Tue, 10 Nov 2026 10:00:00 GMT</pubDate></item><item><title>Newer</title><pubDate>Thu, 12 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>",
          ),
        ),
    );
    await downloadFeed(feedUrl);
    expect(logs()).toContain("episodes=2");
    expect(logs()).toContain("latestPublishedAt=2026-11-12T10:00:00.000Z");
  });
});
