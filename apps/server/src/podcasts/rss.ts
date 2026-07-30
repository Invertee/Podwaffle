export interface ParsedFeed {
  title: string;
  author: string | null;
  description: string | null;
  artworkUrl: string | null;
  websiteUrl: string | null;
  episodes: ParsedEpisode[];
}

export interface ParsedEpisode {
  guid: string | null;
  title: string;
  descriptionHtml: string | null;
  enclosureUrl: string | null;
  enclosureType: string | null;
  publishedAt: string | null;
  durationMs: number | null;
  artworkUrl: string | null;
  episodeUrl: string | null;
  explicit: boolean;
}

function decodeXml(value: string): string {
  return value
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/i, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(xml: string, names: string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(":", "\\:");
    const match = new RegExp(
      `<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`,
      "i",
    ).exec(xml);
    if (match?.[1] !== undefined) return decodeXml(match[1]);
  }
  return null;
}

function attribute(xml: string, element: string, name: string): string | null {
  const elementMatch = new RegExp(`<${element}\\b([^>]*)\\/?\\s*>`, "i").exec(
    xml,
  );
  if (!elementMatch?.[1]) return null;
  const value = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(
    elementMatch[1],
  )?.[1];
  return value ? decodeXml(value) : null;
}

function date(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function duration(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const parts = value.split(":").map(Number);
  if (parts.some(Number.isNaN) || parts.length > 3) return null;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return seconds * 1000;
}

function image(xml: string): string | null {
  return (
    attribute(xml, "itunes:image", "href") ??
    attribute(xml, "media:thumbnail", "url") ??
    tag(xml, ["url"])
  );
}

export function parseRss(xml: string): ParsedFeed {
  const channel = /<channel(?:\s[^>]*)?>([\s\S]*?)<\/channel>/i.exec(xml)?.[1];
  if (!channel) throw new Error("The response is not a supported RSS feed");
  const itemMatches = channel.matchAll(
    /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi,
  );
  const episodes: ParsedEpisode[] = [];
  for (const match of itemMatches) {
    const item = match[1] ?? "";
    const title = tag(item, ["title"]);
    if (!title) continue;
    episodes.push({
      guid: tag(item, ["guid"]),
      title,
      descriptionHtml: tag(item, [
        "content:encoded",
        "description",
        "itunes:summary",
      ]),
      enclosureUrl: attribute(item, "enclosure", "url"),
      enclosureType: attribute(item, "enclosure", "type"),
      publishedAt: date(tag(item, ["pubDate", "dc:date"])),
      durationMs: duration(tag(item, ["itunes:duration"])),
      artworkUrl: image(item),
      episodeUrl: tag(item, ["link"]),
      explicit: ["yes", "true", "explicit"].includes(
        (tag(item, ["itunes:explicit"]) ?? "").toLowerCase(),
      ),
    });
  }
  const title = tag(channel, ["title"]);
  if (!title) throw new Error("The RSS feed has no title");
  return {
    title,
    author: tag(channel, ["itunes:author", "author", "dc:creator"]),
    description: tag(channel, ["description", "itunes:summary"]),
    artworkUrl: image(channel),
    websiteUrl: tag(channel, ["link"]),
    episodes,
  };
}
