import { describe, expect, it } from "vitest";
import { parseRss } from "../src/podcasts/rss.js";

describe("RSS normalisation", () => {
  it("normalises common RSS and iTunes fields", () => {
    const parsed = parseRss(`
      <rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
        <channel>
          <title>Fish &amp; Chips</title>
          <description><![CDATA[<p>A show</p>]]></description>
          <itunes:author>Sam</itunes:author>
          <itunes:image href="https://example.com/show.jpg"/>
          <item>
            <guid>episode-1</guid>
            <title>The first episode</title>
            <itunes:duration>01:02:03</itunes:duration>
            <itunes:explicit>yes</itunes:explicit>
            <enclosure url="https://example.com/one.mp3" type="audio/mpeg"/>
          </item>
        </channel>
      </rss>
    `);
    expect(parsed.title).toBe("Fish & Chips");
    expect(parsed.artworkUrl).toBe("https://example.com/show.jpg");
    expect(parsed.episodes[0]).toMatchObject({
      guid: "episode-1",
      durationMs: 3_723_000,
      explicit: true,
      enclosureType: "audio/mpeg",
    });
  });
});
