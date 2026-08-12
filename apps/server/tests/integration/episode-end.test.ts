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
  it("waits for actual media end and becomes idle after the final item", async () => {
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
      null,
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
    expect(nearEnd.body.episode.played).toBe(false);
    expect(
      (nearEnd.body.queue as Array<{ episode: { id: string } }>).map(
        (item) => item.episode.id,
      ),
    ).toEqual([firstEpisodeId, secondEpisodeId]);
    expect(
      (await client.get("/api/v1/playback").expect(200)).body.playback,
    ).toMatchObject({ episode: { id: firstEpisodeId } });

    const firstEnded = await client
      .post(`/api/v1/episodes/${firstEpisodeId}/progress`)
      .send({
        commandId: randomUUID(),
        positionMs: 60_000,
        durationMs: 60_000,
        completed: true,
      })
      .expect(200);
    expect(firstEnded.body.episode.played).toBe(true);
    expect(
      (firstEnded.body.queue as Array<{ episode: { id: string } }>).map(
        (item) => item.episode.id,
      ),
    ).toEqual([secondEpisodeId]);
    expect(
      (await client.get("/api/v1/playback").expect(200)).body.playback,
    ).toMatchObject({ episode: { id: secondEpisodeId }, positionMs: 0 });

    const staleState = await client
      .post("/api/v1/playback/state")
      .send({
        episodeId: firstEpisodeId,
        positionMs: 55_000,
        durationMs: 60_000,
        state: "playing",
        playbackRate: 1,
      })
      .expect(200);
    expect(staleState.body.episode).toMatchObject({
      id: firstEpisodeId,
      positionMs: 60_000,
      played: true,
    });
    expect(staleState.body.playback).toMatchObject({
      episode: { id: secondEpisodeId },
      positionMs: 0,
    });
    expect(
      (
        (await client.get("/api/v1/queue").expect(200)).body.queue as Array<{
          episode: { id: string };
        }>
      ).map((item) => item.episode.id),
    ).toEqual([secondEpisodeId]);

    const finalEnded = await client
      .post(`/api/v1/episodes/${secondEpisodeId}/progress`)
      .send({
        commandId: randomUUID(),
        positionMs: 80_000,
        durationMs: null,
        completed: true,
      })
      .expect(200);
    expect(finalEnded.body.episode.played).toBe(true);
    expect(finalEnded.body.queue).toEqual([]);
    expect(
      (await client.get("/api/v1/playback").expect(200)).body.playback,
    ).toMatchObject({
      episode: null,
      positionMs: 0,
      durationMs: null,
      state: "stopped",
      mode: "local",
      activeDeviceId: null,
      leaseExpiresAt: null,
      castOwnerDeviceId: null,
      castSessionId: null,
      ownedByCurrentDevice: false,
    });

    const staleFinalState = await client
      .post("/api/v1/playback/state")
      .send({
        episodeId: secondEpisodeId,
        positionMs: 75_000,
        durationMs: null,
        state: "playing",
        playbackRate: 1,
      })
      .expect(200);
    expect(staleFinalState.body.episode).toMatchObject({
      id: secondEpisodeId,
      positionMs: 80_000,
      played: true,
    });
    expect(staleFinalState.body.playback).toMatchObject({
      episode: null,
      positionMs: 0,
      state: "stopped",
      activeDeviceId: null,
      leaseExpiresAt: null,
    });
    expect((await client.get("/api/v1/queue").expect(200)).body.queue).toEqual(
      [],
    );

    const profile = created.runtime.database.db
      .prepare("SELECT id FROM profiles WHERE display_name = ?")
      .get("Sam") as { id: string };
    const completedEpisode = (
      await client.get(`/api/v1/episodes/${firstEpisodeId}`).expect(200)
    ).body.episode as { playedAt: string };
    created.runtime.database.db
      .prepare(
        `INSERT INTO queue_items(
          id, profile_id, episode_id, sort_index, added_at
        ) VALUES (?, ?, ?, 0, ?)`,
      )
      .run(randomUUID(), profile.id, firstEpisodeId, now);

    const replayQueue = await client
      .post("/api/v1/queue/items")
      .send({
        commandId: randomUUID(),
        episodeId: firstEpisodeId,
        position: "bottom",
      })
      .expect(201);
    expect(replayQueue.body.queue).toHaveLength(1);
    expect(replayQueue.body.queue[0].episode.id).toBe(firstEpisodeId);
    expect(Date.parse(replayQueue.body.queue[0].addedAt)).toBeGreaterThan(
      Date.parse(completedEpisode.playedAt),
    );
  });
});
