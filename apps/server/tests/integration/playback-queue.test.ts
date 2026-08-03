import { randomUUID } from "node:crypto";
import supertest from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import type { Runtime } from "../../src/runtime.js";
import { join, testRuntime } from "../helpers.js";

const runtimes: Runtime[] = [];

afterEach(async () => {
  while (runtimes.length) await runtimes.pop()?.close();
});

type QueueResponseItem = {
  id: string;
  episode: { id: string };
};

function episodeIds(items: QueueResponseItem[]): string[] {
  return items.map((item) => item.episode.id);
}

describe("playback queue invariant", () => {
  it("keeps the current episode at queue position zero and advances from it", async () => {
    const created = await testRuntime();
    runtimes.push(created.runtime);
    const client = supertest.agent(created.baseUrl);
    await join(client);

    const now = new Date().toISOString();
    const podcastId = randomUUID();
    const firstEpisodeId = randomUUID();
    const secondEpisodeId = randomUUID();
    const thirdEpisodeId = randomUUID();

    created.runtime.database.db
      .prepare(
        `INSERT INTO podcasts(
          id, feed_url, title, failure_count, created_at, updated_at
        ) VALUES (?, ?, ?, 0, ?, ?)`,
      )
      .run(
        podcastId,
        "https://example.test/current-queue-feed",
        "Current queue show",
        now,
        now,
      );

    const insertEpisode = created.runtime.database.db.prepare(
      `INSERT INTO episodes(
        id, podcast_id, guid, enclosure_url, title, first_discovered_at,
        duration_ms, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [episodeId, index] of [
      [firstEpisodeId, 1],
      [secondEpisodeId, 2],
      [thirdEpisodeId, 3],
    ] as const) {
      insertEpisode.run(
        episodeId,
        podcastId,
        `queue-${index}`,
        `https://example.test/queue-${index}.mp3`,
        `Queue episode ${index}`,
        now,
        60_000,
        now,
        now,
      );
    }

    for (const episodeId of [secondEpisodeId, thirdEpisodeId]) {
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

    const initialQueue = (await client.get("/api/v1/queue").expect(200)).body
      .queue as QueueResponseItem[];
    expect(episodeIds(initialQueue)).toEqual([
      firstEpisodeId,
      secondEpisodeId,
      thirdEpisodeId,
    ]);

    await client
      .post("/api/v1/playback/lease")
      .send({
        episodeId: thirdEpisodeId,
        positionMs: 0,
        durationMs: 60_000,
        playbackRate: 1,
      })
      .expect(200);

    const pinnedQueue = (await client.get("/api/v1/queue").expect(200)).body
      .queue as QueueResponseItem[];
    expect(episodeIds(pinnedQueue)).toEqual([
      thirdEpisodeId,
      firstEpisodeId,
      secondEpisodeId,
    ]);

    const current = pinnedQueue[0]!;
    const attemptedOrder = [...pinnedQueue.slice(1), current].map(
      (item) => item.id,
    );
    const reordered = await client
      .put("/api/v1/queue/order")
      .send({ commandId: randomUUID(), queueItemIds: attemptedOrder })
      .expect(200);
    expect(episodeIds(reordered.body.queue as QueueResponseItem[])).toEqual([
      thirdEpisodeId,
      firstEpisodeId,
      secondEpisodeId,
    ]);

    const removed = await client
      .delete(`/api/v1/queue/items/${current.id}`)
      .send({ commandId: randomUUID() })
      .expect(200);
    expect(episodeIds(removed.body.queue as QueueResponseItem[])).toEqual([
      thirdEpisodeId,
      firstEpisodeId,
      secondEpisodeId,
    ]);

    const completed = await client
      .post(`/api/v1/episodes/${thirdEpisodeId}/progress`)
      .send({
        commandId: randomUUID(),
        positionMs: 60_000,
        durationMs: 60_000,
      })
      .expect(200);
    expect(episodeIds(completed.body.queue as QueueResponseItem[])).toEqual([
      firstEpisodeId,
      secondEpisodeId,
    ]);
    expect((await client.get("/api/v1/playback")).body.playback).toMatchObject({
      episode: { id: firstEpisodeId },
      positionMs: 0,
      state: "paused",
      ownedByCurrentDevice: true,
    });
  });
});
