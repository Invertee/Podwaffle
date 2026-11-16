import { log } from "../logging.js";

export interface FeedLogContext {
  source?: "scheduled" | "manual" | "subscribe";
  podcastId?: string;
  podcastTitle?: string;
}

export function feedHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid URL";
  }
}

// Feed URLs can contain credentials and private subscription tokens. Log hosts
// and show names, and remove URL paths/queries from underlying network errors.
export function feedLogText(text: string): string {
  return text
    .replace(/https?:\/\/[^\s<>"']+/gi, (url) => feedHost(url))
    .replace(/[\r\n\t]/g, " ")
    .slice(0, 500);
}

export function feedLogFields(feedUrl: string, context: FeedLogContext = {}) {
  return {
    feedHost: feedHost(feedUrl),
    source: context.source,
    podcastId: context.podcastId,
    podcastTitle: context.podcastTitle
      ? feedLogText(context.podcastTitle)
      : undefined,
  };
}

export function feedErrorFields(error: unknown): Record<string, unknown> {
  const seen = new Set<unknown>();
  const messages: string[] = [];
  const codes: string[] = [];
  let failedHost: string | undefined;
  function visit(value: unknown): void {
    if (seen.has(value) || seen.size >= 8) return;
    seen.add(value);
    if (!value || typeof value !== "object") {
      if (typeof value === "string") messages.push(feedLogText(value));
      else if (
        typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint" ||
        typeof value === "symbol"
      )
        messages.push(String(value));
      return;
    }
    const detail = value as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      hostname?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    if (typeof detail.message === "string") {
      const name = typeof detail.name === "string" ? detail.name : "Error";
      messages.push(feedLogText(name + ": " + detail.message));
    }
    if (typeof detail.code === "string") codes.push(feedLogText(detail.code));
    if (typeof detail.hostname === "string")
      failedHost = feedHost("https://" + detail.hostname);
    if (detail.cause !== undefined) visit(detail.cause);
    if (Array.isArray(detail.errors))
      for (const child of detail.errors) visit(child);
  }
  visit(error);
  return {
    error: messages.join(" <- "),
    errorCodes: [...new Set(codes)],
    failedHost,
  };
}

export function logFeedRefresh(
  source: "scheduled" | "manual",
  result: {
    podcast: { id: string; title: string; feedUrl: string };
    discoveredEpisodeIds: string[];
  },
  status: "updated" | "not-modified",
): void {
  log("info", "feed.refresh.completed", {
    message: "Podcast feed refresh saved",
    ...feedLogFields(result.podcast.feedUrl, {
      source,
      podcastId: result.podcast.id,
      podcastTitle: result.podcast.title,
    }),
    status,
    newEpisodes: result.discoveredEpisodeIds.length,
  });
}
