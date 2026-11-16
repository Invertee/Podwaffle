import { log } from "../logging.js";
import {
  feedErrorFields,
  feedHost,
  feedLogFields,
  feedLogText,
  type FeedLogContext,
} from "./feed-diagnostics.js";
import { parseRss, type ParsedFeed } from "./rss.js";

async function download(
  feedUrl: string,
  headers: Record<string, string>,
  context: FeedLogContext,
): Promise<{
  status: "updated" | "not-modified";
  feed?: ParsedFeed;
  etag: string | null;
  lastModified: string | null;
}> {
  const started = Date.now();
  const fields = feedLogFields(feedUrl, context);
  const conditional = Object.keys(headers).some((name) =>
    ["if-none-match", "if-modified-since"].includes(name.toLowerCase()),
  );
  let response: Response | undefined;
  let stage = "request";
  log("info", "feed.download.started", {
    message: "Checking podcast feed",
    ...fields,
    conditional,
  });
  try {
    response = await fetch(feedUrl, {
      headers: {
        accept: "application/rss+xml, application/xml, text/xml",
        ...headers,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    stage = "response";
    const responseFields = {
      ...fields,
      responseHost: feedHost(response.url || feedUrl),
      httpStatus: response.status,
      contentType: response.headers.get("content-type"),
    };
    if (response.status === 304) {
      log("info", "feed.download.not_modified", {
        message: "Publisher reports no feed changes (HTTP 304)",
        ...responseFields,
        conditional,
        durationMs: Date.now() - started,
      });
      return {
        status: "not-modified",
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
      };
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Feed refresh failed (" + response.status + ")");
    }
    const xml = await response.text();
    if (xml.length > 20 * 1024 * 1024) throw new Error("RSS feed is too large");
    stage = "parse";
    const feed = parseRss(xml);
    const latestPublishedAt = feed.episodes.reduce<string | null>(
      (latest, episode) =>
        episode.publishedAt && (!latest || episode.publishedAt > latest)
          ? episode.publishedAt
          : latest,
      null,
    );
    log("info", "feed.download.succeeded", {
      message: "Podcast feed downloaded and parsed",
      ...responseFields,
      podcastTitle: feedLogText(feed.title),
      episodes: feed.episodes.length,
      latestPublishedAt,
      durationMs: Date.now() - started,
    });
    return {
      status: "updated",
      feed,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    };
  } catch (error) {
    log("warn", "feed.download.failed", {
      message: "Podcast feed request failed",
      ...fields,
      responseHost: response?.url ? feedHost(response.url) : undefined,
      httpStatus: response?.status,
      contentType: response?.headers.get("content-type"),
      stage,
      durationMs: Date.now() - started,
      ...feedErrorFields(error),
    });
    throw error;
  }
}

export async function downloadFeed(
  feedUrl: string,
  headers: Record<string, string> = {},
  context: FeedLogContext = {},
): ReturnType<typeof download> {
  try {
    return await download(feedUrl, headers, context);
  } catch (error) {
    const fallback = new URL(feedUrl);
    // Retry only Omny's known hostname alias; keep the subscription unchanged.
    if (
      fallback.hostname !== "www.omnycontent.com" ||
      !["http:", "https:"].includes(fallback.protocol)
    )
      throw error;
    fallback.hostname = "omnycontent.com";
    log("warn", "feed.download.fallback", {
      message: "Retrying Omny podcast feed without www",
      ...feedLogFields(feedUrl, context),
      fallbackHost: fallback.host,
    });
    return download(fallback.href, headers, context);
  }
}
