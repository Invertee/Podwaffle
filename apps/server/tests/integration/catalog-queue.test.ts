import { randomUUID } from "node:crypto";
import supertest from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configForTest } from "../../src/config.js";
import { createRuntime, type Runtime } from "../../src/runtime.js";
import { join, testRuntime } from "../helpers.js";

const runtimes: Runtime[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  while (runtimes.length) await runtimes.pop()?.close();
});

function feed(title: string, episodeTitles: string[]): string {
  return `<?xml version="1.0"?>
    <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
      <channel>
        <title>${title}</title>
        <description>A test podcast</description>
        <itunes:author>Podwaffle Tests</itunes:author>
        <itunes:image href="https://example.com/art.jpg" />
        <link>https://example.com/show</link>
        ${episodeTitles
          .map(
            (episodeTitle, index) => `<item>
              <guid>${title}-${index}</guid>
              <title>${episodeTitle}</title>
              <description><![CDATA[<p>${episodeTitle} notes</p>]]></description>
              <pubDate>${new Date(Date.UTC(2026, 6, 20 + index)).toUTCString()}</pubDate>
              <itunes:duration>${20 + index}:00</itunes:duration>
              <enclosure url="https://example.com/${encodeURIComponent(title)}/${index}.mp3" type="audio/mpeg" />
            </item>`,
          )
          .join("")}
      </channel>
    </rss>`;
}

function command(revision: number) {
  return { commandId: randomUUID(), expectedRevision: revision };
}

describe("podcast catalog, episode state, and queue", () => {
  it("shares feed ingestion, synchronises ordering and indicators, and persists queue state", async () => {
    let primaryFeed = feed("Primary show", ["One", "Two"]);
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      const body = url.includes("secondary")
        ? feed("Secondary show", ["Other"])
        : primaryFeed;
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/rss+xml",
          etag: '"test-etag"',
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const created = await testRuntime();
    runtimes.push(created.runtime);
    const sam = supertest.agent(created.baseUrl);
    const guest = supertest.agent(created.baseUrl);
    await join(sam, "Sam", "Sam browser");
    await join(guest, "Guest", "Guest browser");

    let samRevision = (
      (await sam.get("/api/v1/snapshot").expect(200)).body as {
        revision: number;
      }
    ).revision;
    const firstSubscribe = await sam
      .post("/api/v1/subscriptions")
      .send({
        ...command(samRevision),
        feedUrl: "https://feeds.example/primary.xml",
      })
      .expect(201);
    const primaryId = (
      firstSubscribe.body as {
        subscription: { id: string };
        revision: number;
      }
    ).subscription.id;
    samRevision = (firstSubscribe.body as { revision: number }).revision;

    const secondSubscribe = await sam
      .post("/api/v1/subscriptions")
      .send({
        ...command(samRevision),
        feedUrl: "https://feeds.example/secondary.xml",
      })
      .expect(201);
    const secondaryId = (
      secondSubscribe.body as {
        subscription: { id: string };
        revision: number;
      }
    ).subscription.id;
    samRevision = (secondSubscribe.body as { revision: number }).revision;

    const reordered = await sam
      .put("/api/v1/subscriptions/order")
      .send({
        ...command(samRevision),
        podcastIds: [secondaryId, primaryId],
      })
      .expect(200);
    samRevision = (reordered.body as { revision: number }).revision;
    expect(
      (
        (await sam.get("/api/v1/subscriptions")).body as {
          subscriptions: Array<{ id: string }>;
        }
      ).subscriptions.map((item) => item.id),
    ).toEqual([secondaryId, primaryId]);

    let guestRevision = (
      (await guest.get("/api/v1/snapshot")).body as { revision: number }
    ).revision;
    const guestSubscribe = await guest
      .post("/api/v1/subscriptions")
      .send({
        ...command(guestRevision),
        feedUrl: "https://feeds.example/primary.xml",
      })
      .expect(201);
    guestRevision = (guestSubscribe.body as { revision: number }).revision;
    expect(
      (
        created.runtime.database.db
          .prepare("SELECT COUNT(*) AS count FROM podcasts WHERE feed_url = ?")
          .get("https://feeds.example/primary.xml") as { count: number }
      ).count,
    ).toBe(1);

    const episodesResponse = await sam
      .get(`/api/v1/podcasts/${primaryId}/episodes`)
      .expect(200);
    const episodes = (
      episodesResponse.body as {
        episodes: Array<{ id: string; title: string; durationMs: number }>;
      }
    ).episodes;
    expect(episodes).toHaveLength(2);

    const progress = await sam
      .post(`/api/v1/episodes/${episodes[0]!.id}/progress`)
      .send({
        ...command(samRevision),
        positionMs: episodes[0]!.durationMs * 0.98,
        durationMs: episodes[0]!.durationMs,
      })
      .expect(200);
    samRevision = (progress.body as { revision: number }).revision;
    expect(
      (progress.body as { episode: { played: boolean } }).episode.played,
    ).toBe(false);

    const manualUnplayed = await sam
      .patch(`/api/v1/episodes/${episodes[0]!.id}/state`)
      .send({ ...command(samRevision), played: false })
      .expect(200);
    samRevision = (manualUnplayed.body as { revision: number }).revision;
    const completedAgain = await sam
      .post(`/api/v1/episodes/${episodes[0]!.id}/progress`)
      .send({
        ...command(samRevision),
        positionMs: episodes[0]!.durationMs,
        durationMs: episodes[0]!.durationMs,
      })
      .expect(200);
    samRevision = (completedAgain.body as { revision: number }).revision;
    expect(
      (completedAgain.body as { episode: { played: boolean } }).episode.played,
    ).toBe(false);

    const bottom = await sam
      .post("/api/v1/queue/items")
      .send({
        ...command(samRevision),
        episodeId: episodes[0]!.id,
        position: "bottom",
      })
      .expect(201);
    samRevision = (bottom.body as { revision: number }).revision;
    const next = await sam
      .post("/api/v1/queue/items")
      .send({
        ...command(samRevision),
        episodeId: episodes[1]!.id,
        position: "next",
      })
      .expect(201);
    samRevision = (next.body as { revision: number }).revision;
    expect(
      (next.body as { queue: Array<{ episode: { id: string } }> }).queue.map(
        (item) => item.episode.id,
      ),
    ).toEqual([episodes[1]!.id, episodes[0]!.id]);

    primaryFeed = feed("Primary show", ["One", "Two", "Just arrived"]);
    const samProfileId = (
      created.runtime.database.db
        .prepare("SELECT id FROM profiles WHERE display_name = 'Sam'")
        .get() as { id: string }
    ).id;
    created.runtime.database.db
      .prepare(
        "UPDATE subscriptions SET subscribed_at = ? WHERE profile_id = ? AND podcast_id = ?",
      )
      .run("2026-01-01T00:00:00.000Z", samProfileId, primaryId);
    created.runtime.database.db
      .prepare("UPDATE podcasts SET next_check_at = ? WHERE id = ?")
      .run("2026-01-01T00:00:00.000Z", primaryId);
    const callsBeforeRefresh = fetchMock.mock.calls.length;
    await created.runtime.feedScheduler.refreshDue();
    expect(fetchMock.mock.calls.length).toBe(callsBeforeRefresh + 1);
    samRevision = (
      (await sam.get("/api/v1/snapshot")).body as { revision: number }
    ).revision;
    const library = await sam.get("/api/v1/subscriptions").expect(200);
    expect(
      (
        library.body as {
          subscriptions: Array<{ id: string; hasNewEpisode: boolean }>;
        }
      ).subscriptions.find((item) => item.id === primaryId)?.hasNewEpisode,
    ).toBe(true);

    await created.runtime.close();
    runtimes.pop();
    const restarted = await createRuntime(configForTest(created.dataDir));
    runtimes.push(restarted);
    await new Promise<void>((done) =>
      restarted.server.listen(new URL(created.baseUrl).port, "127.0.0.1", done),
    );
    const persistedQueue = await sam.get("/api/v1/queue").expect(200);
    expect((persistedQueue.body as { queue: unknown[] }).queue).toHaveLength(2);
    expect(guestRevision).toBeGreaterThan(0);
  });
});
