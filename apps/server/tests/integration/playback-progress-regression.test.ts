import { randomUUID } from "node:crypto";
import supertest from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import type { Runtime } from "../../src/runtime.js";
import { join, testRuntime } from "../helpers.js";

const runtimes: Runtime[] = [];

afterEach(async () => {
  while (runtimes.length) await runtimes.pop()?.close();
});

describe("playback progress regression guard", () => {
  it("rejects stale large rewinds but allows normal skip-back and explicit seeks", async () => {
    const created = await testRuntime();
    runtimes.push(created.runtime);
    const client = supertest.agent(created.baseUrl);
    await join(client);

    const now = new Date().toISOString();
    const podcastId = randomUUID();
    const episodeId = randomUUID();
    created.runtime.database.db
      .prepare(
        `INSERT INTO podcasts(
          id, feed_url, title, failure_count, created_at, updated_at
        ) VALUES (?, ?, ?, 0, ?, ?)`,
      )
      .run(
        podcastId,
        "https://example.test/progress-regression-feed",
        "Progress regression show",
        now,
        now,
      );
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
        "progress-regression-episode",
        "https://example.test/progress-regression.mp3",
        "Regression episode",
        now,
        3_600_000,
        now,
        now,
      );

    await client.post("/api/v1/playback/lease").send({
      episodeId,
      positionMs: 0,
      durationMs: 3_600_000,
      playbackRate: 1,
    }).expect(200);

    const progressed = await client.post("/api/v1/playback/state").send({
      episodeId,
      positionMs: 1_800_000,
      durationMs: 3_600_000,
      state: "paused",
      playbackRate: 1,
    }).expect(200);
    expect(progressed.body.episode.positionMs).toBe(1_800_000);

    const staleLease = await client.post("/api/v1/playback/lease").send({
      episodeId,
      positionMs: 0,
      durationMs: 3_600_000,
      playbackRate: 1,
    }).expect(200);
    expect(staleLease.body.playback.positionMs).toBe(1_800_000);

    const staleState = await client.post("/api/v1/playback/state").send({
      episodeId,
      positionMs: 0,
      durationMs: 3_600_000,
      state: "paused",
      playbackRate: 1,
    }).expect(200);
    expect(staleState.body.playback.positionMs).toBe(1_800_000);
    expect(staleState.body.episode.positionMs).toBe(1_800_000);

    const normalSkipBack = await client.post("/api/v1/playback/state").send({
      episodeId,
      positionMs: 1_786_000,
      durationMs: 3_600_000,
      state: "paused",
      playbackRate: 1,
    }).expect(200);
    expect(normalSkipBack.body.episode.positionMs).toBe(1_786_000);

    await client.post("/api/v1/playback/state").send({
      episodeId,
      positionMs: 1_800_000,
      durationMs: 3_600_000,
      state: "paused",
      playbackRate: 1,
    }).expect(200);

    await client.post("/api/v1/playback/movements").send({
      commandId: randomUUID(),
      episodeId,
      type: "seek",
      fromPositionMs: 1_800_000,
      requestedPositionMs: 600_000,
      confirmedPositionMs: 600_000,
    }).expect(201);

    const explicitRewind = await client.post("/api/v1/playback/state").send({
      episodeId,
      positionMs: 600_000,
      durationMs: 3_600_000,
      state: "paused",
      playbackRate: 1,
    }).expect(200);
    expect(explicitRewind.body.playback.positionMs).toBe(600_000);
    expect(explicitRewind.body.episode.positionMs).toBe(600_000);
  });
});
