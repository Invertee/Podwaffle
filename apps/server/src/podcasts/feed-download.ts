import { parseRss, type ParsedFeed } from "./rss.js";

async function download(
  feedUrl: string,
  headers: Record<string, string>,
): Promise<{
  status: "updated" | "not-modified";
  feed?: ParsedFeed;
  etag: string | null;
  lastModified: string | null;
}> {
  const response = await fetch(feedUrl, {
    headers: {
      accept: "application/rss+xml, application/xml, text/xml",
      ...headers,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 304)
    return {
      status: "not-modified",
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    };
  if (!response.ok) throw new Error(`Feed refresh failed (${response.status})`);
  const xml = await response.text();
  if (xml.length > 20 * 1024 * 1024) throw new Error("RSS feed is too large");
  return {
    status: "updated",
    feed: parseRss(xml),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
  };
}

export async function downloadFeed(
  feedUrl: string,
  headers: Record<string, string> = {},
): ReturnType<typeof download> {
  try {
    return await download(feedUrl, headers);
  } catch (error) {
    const fallback = new URL(feedUrl);
    // Retry only Omny's known hostname alias; keep the subscription unchanged.
    if (
      fallback.hostname !== "www.omnycontent.com" ||
      !["http:", "https:"].includes(fallback.protocol)
    )
      throw error;
    fallback.hostname = "omnycontent.com";
    return download(fallback.href, headers);
  }
}
