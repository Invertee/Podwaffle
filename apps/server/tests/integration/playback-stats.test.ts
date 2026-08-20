import { randomUUID } from "node:crypto";
import supertest from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import type { Runtime } from "../../src/runtime.js";
import { join, testRuntime } from "../helpers.js";

const runtimes: Runtime[] = [];
afterEach(async () => {
  while (runtimes.length) await runtimes.pop()?.close();
});

describe("playback ownership and listening statistics", () => {
  it("transfers leases and deduplicates confirmed telemetry and movements", async () => {
    const created = await testRuntime();
    runtimes.push(created.runtime);
    const first = supertest.agent(created.baseUrl);
    const second = supertest.agent(created.baseUrl);
    await join(first, "Sam", "First tab");
    await join(second, "Sam", "Second tab");
    const now = new Date().toISOString();
    const podcastId = randomUUID();
    const episodeId = randomUUID();
    created.runtime.database.db
      .prepare(
        `INSERT INTO podcasts(
          id, feed_url, title, failure_count, created_at, updated_at
        ) VALUES (?, ?, ?, 0, ?, ?)`,
      )
      .run(podcastId, "https://example.test/feed", "Test show", now, now);
    created.runtime.database.db
      .prepare(
        `INSERT INTO episodes(
          id, podcast_id, guid, enclosure_url, title, first_discovered_at,
          duration_ms, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        episodeId,
        podcastId,
        "episode-1",
        "https://example.test/audio.mp3",
        "Lease test",
        now,
        600_000,
        now,
        now,
      );

    await first
      .post("/api/v1/playback/lease")
      .send({
        episodeId,
        positionMs: 0,
        durationMs: 600_000,
        playbackRate: 1,
      })
      .expect(200);
    await first
      .post("/api/v1/playback/state")
      .send({
        episodeId,
        positionMs: 15_000,
        durationMs: 600_000,
        state: "playing",
        playbackRate: 1,
      })
      .expect(200);

    expect(
      (
        await first.get("/api/v1/episodes/in-progress").expect(200)
      ).body.episodes.map((episode: { id: string }) => episode.id),
    ).toContain(episodeId);

    const playbackInstanceId = randomUUID();
    const telemetry = {
      playbackInstanceId,
      sequence: 0,
      episodeId,
      source: "web-local",
      listenedMs: 15_000,
      contentConsumedMs: 15_000,
    };
    expect(
      (
        await first
          .post("/api/v1/playback/telemetry")
          .send(telemetry)
          .expect(201)
      ).body,
    ).toEqual({ recorded: true });
    expect(
      (
        await first
          .post("/api/v1/playback/telemetry")
          .send(telemetry)
          .expect(200)
      ).body,
    ).toEqual({ recorded: false });

    await first
      .post("/api/v1/playback/movements")
      .send({
        commandId: randomUUID(),
        episodeId,
        type: "seek",
        fromPositionMs: 15_000,
        requestedPositionMs: 300_000,
        confirmedPositionMs: 300_000,
      })
      .expect(201);
    const skipCommand = {
      commandId: randomUUID(),
      episodeId,
      type: "skip-forward",
      fromPositionMs: 300_000,
      requestedPositionMs: 345_000,
      confirmedPositionMs: 342_000,
    };
    await first
      .post("/api/v1/playback/movements")
      .send(skipCommand)
      .expect(201);
    expect(
      (
        await first
          .post("/api/v1/playback/movements")
          .send(skipCommand)
          .expect(200)
      ).body,
    ).toEqual({ recorded: false });

    const stats = await first.get("/api/v1/stats?period=all").expect(200);
    expect(
      (
        stats.body as {
          stats: { listenedMs: number; skippedForwardMs: number };
        }
      ).stats,
    ).toMatchObject({ listenedMs: 15_000, skippedForwardMs: 42_000 });

    await second
      .post("/api/v1/playback/lease")
      .send({
        episodeId,
        positionMs: 342_000,
        durationMs: 600_000,
        playbackRate: 1,
        takeover: true,
      })
      .expect(200);
    await first
      .post("/api/v1/playback/telemetry")
      .send({ ...telemetry, sequence: 1 })
      .expect(409);
    expect(
      (await second.get("/api/v1/playback").expect(200)).body.playback
        .ownedByCurrentDevice,
    ).toBe(true);
  });

  it("advances completed media and becomes idle when the queue is exhausted", async () => {
    const created = await testRuntime();
    runtimes.push(created.runtime);
    const browser = supertest.agent(created.baseUrl);
    await join(browser);

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
        "https://example.test/queue-feed",
        "Queue show",
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
      "queued-1",
      "https://example.test/queued-1.mp3",
      "First queued episode",
      now,
      60_000,
      now,
      now,
    );
    insertEpisode.run(
      secondEpisodeId,
      podcastId,
      "queued-2",
      "https://example.test/queued-2.mp3",
      "Second queued episode",
      now,
      90_000,
      now,
      now,
    );

    for (const episodeId of [firstEpisodeId, secondEpisodeId]) {
      await browser
        .post("/api/v1/queue/items")
        .send({
          commandId: randomUUID(),
          episodeId,
          position: "bottom",
        })
        .expect(201);
    }
    await browser
      .post("/api/v1/playback/lease")
      .send({
        episodeId: firstEpisodeId,
        positionMs: 0,
        durationMs: 60_000,
        playbackRate: 1,
      })
      .expect(200);
    await browser
      .post("/api/v1/playback/state")
      .send({
        episodeId: firstEpisodeId,
        positionMs: 59_000,
        durationMs: 60_000,
        state: "playing",
        playbackRate: 1,
      })
      .expect(200);

    const advanced = await browser
      .post(`/api/v1/episodes/${firstEpisodeId}/progress`)
      .send({
        commandId: randomUUID(),
        positionMs: 60_000,
        durationMs: 60_000,
      })
      .expect(200);
    expect(
      (
        advanced.body as { queue: Array<{ episode: { id: string } }> }
      ).queue.map((item) => item.episode.id),
    ).toEqual([secondEpisodeId]);
    expect((await browser.get("/api/v1/playback")).body.playback).toMatchObject(
      {
        episode: { id: secondEpisodeId },
        positionMs: 0,
        state: "playing",
        ownedByCurrentDevice: true,
      },
    );

    const finished = await browser
      .post(`/api/v1/episodes/${secondEpisodeId}/progress`)
      .send({
        commandId: randomUUID(),
        positionMs: 90_000,
        durationMs: 90_000,
      })
      .expect(200);
    expect((finished.body as { queue: unknown[] }).queue).toEqual([]);
    expect((await browser.get("/api/v1/playback")).body.playback).toMatchObject(
      {
        episode: null,
        positionMs: 0,
        durationMs: null,
        state: "stopped",
        activeDeviceId: null,
        leaseExpiresAt: null,
        ownedByCurrentDevice: false,
      },
    );
  });
});
