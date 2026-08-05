import { randomUUID } from "node:crypto";
import supertest from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import type { Runtime } from "../../src/runtime.js";
import { join, testRuntime } from "../helpers.js";

const runtimes: Runtime[] = [];

afterEach(async () => {
  while (runtimes.length) await runtimes.pop()?.close();
});

describe("episode end handling", () => {
  it("does not advance the queue at the played threshold", async () => {
    const created = await testRuntime();
    runtimes.push(created.runtime);
    const client = supertest.agent(created.baseUrl);
    await join(client);

    const now = new Date().toISOString();
    const podcastId = randomUUID();
    const firstEpisodeId = randomUUID();
    const secondEpisodeId = randomUUID();

    created.runtime.database.db
      .prepare(
        `INSERT INTO podcasts(
          id, feed_url, title, failure_count, created_at, updated_at
        ) VALUES (?, ?, ?, 0, ?, ?)`,
      )
      .run(
        podcastId,
        "https://example.test/actual-end-feed",
        "Actual end show",
        now,
        now,
      );

    const insertEpisode = created.runtime.database.db.prepare(
      `INSERT INTO episodes(
        id, podcast_id, guid, enclosure_url, title, first_discovered_at,
        duration_ms, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertEpisode.run(
      firstEpisodeId,
      podcastId,
      "actual-end-1",
      "https://example.test/actual-end-1.mp3",
      "First episode",
      now,
      60_000,
      now,
      now,
    );
    insertEpisode.run(
      secondEpisodeId,
      podcastId,
      "actual-end-2",
      "https://example.test/actual-end-2.mp3",
      "Second episode",
      now,
      90_000,
      now,
      now,
    );

    for (const episodeId of [firstEpisodeId, secondEpisodeId]) {
      await client
        .post("/api/v1/queue/items")
        .send({
          commandId: randomUUID(),
          episodeId,
          position: "bottom",
        })
        .expect(201);
    }

    await client
      .post("/api/v1/playback/lease")
      .send({
        episodeId: firstEpisodeId,
        positionMs: 0,
        durationMs: 60_000,
        playbackRate: 1,
      })
      .expect(200);

    const nearEnd = await client
      .post(`/api/v1/episodes/${firstEpisodeId}/progress`)
      .send({
        commandId: randomUUID(),
        positionMs: 58_800,
        durationMs: 60_000,
      })
      .expect(200);
    expect(nearEnd.body.episode.played).toBe(true);
    expect(
      (nearEnd.body.queue as Array<{ episode: { id: string } }>).map(
        (item) => item.episode.id,
      ),
    ).toEqual([firstEpisodeId, secondEpisodeId]);
    expect((await client.get("/api/v1/playback").expect(200)).body.playback)
      .toMatchObject({ episode: { id: firstEpisodeId } });

    const ended = await client
      .post(`/api/v1/episodes/${firstEpisodeId}/progress`)
      .send({
        commandId: randomUUID(),
        positionMs: 60_000,
        durationMs: 60_000,
      })
      .expect(200);
    expect(ended.body.episode.played).toBe(true);
    expect(
      (ended.body.queue as Array<{ episode: { id: string } }>).map(
        (item) => item.episode.id,
      ),
    ).toEqual([secondEpisodeId]);
    expect((await client.get("/api/v1/playback").expect(200)).body.playback)
      .toMatchObject({ episode: { id: secondEpisodeId }, positionMs: 0 });
  });
});
