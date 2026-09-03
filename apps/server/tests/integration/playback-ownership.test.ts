import { randomUUID } from "node:crypto";
import supertest from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import type { Runtime } from "../../src/runtime.js";
import { join, testRuntime } from "../helpers.js";

const runtimes: Runtime[] = [];

afterEach(async () => {
  while (runtimes.length) await runtimes.pop()?.close();
});

describe("playback ownership", () => {
  it("blocks background lease theft and hands off at the owner's confirmed position", async () => {
    const created = await testRuntime();
    runtimes.push(created.runtime);
    const owner = supertest.agent(created.baseUrl);
    await join(owner, "Sam", "Android owner");
    const browser = supertest.agent(created.baseUrl);
    await join(browser, "Sam", "Web observer");
    const episodeId = insertEpisode(created.runtime);

    await owner
      .post("/api/v1/playback/lease")
      .send({
        episodeId,
        positionMs: 0,
        durationMs: 600_000,
        playbackRate: 1,
        takeover: true,
      })
      .expect(200);
    await owner
      .post("/api/v1/playback/state")
      .send({
        episodeId,
        positionMs: 120_000,
        durationMs: 600_000,
        state: "playing",
        playbackRate: 1,
      })
      .expect(200);

    const rejectedRenewal = await browser
      .post("/api/v1/playback/lease")
      .send({
        episodeId,
        positionMs: 0,
        durationMs: 600_000,
        playbackRate: 1,
      })
      .expect(409);
    expect(rejectedRenewal.body.error.code).toBe("PLAYBACK_TAKEOVER_REQUIRED");
    expect((await browser.get("/api/v1/playback")).body.playback).toMatchObject(
      {
        positionMs: 120_000,
        ownedByCurrentDevice: false,
      },
    );

    const rejectedCast = await browser
      .post("/api/v1/playback/cast")
      .send({
        commandId: randomUUID(),
        confirmed: {
          episodeId,
          positionMs: 0,
          durationMs: 600_000,
          state: "playing",
          playbackRate: 1,
          castSessionId: "stale-browser-cast",
          volume: 0.5,
          muted: false,
        },
      })
      .expect(409);
    expect(rejectedCast.body.error.code).toBe("PLAYBACK_TAKEOVER_REQUIRED");

    const handoff = await browser
      .post("/api/v1/playback/lease")
      .send({
        episodeId,
        positionMs: 0,
        durationMs: 600_000,
        playbackRate: 1,
        takeover: true,
      })
      .expect(200);
    expect(handoff.body.playback).toMatchObject({
      episode: { id: episodeId },
      positionMs: 120_000,
      ownedByCurrentDevice: true,
    });

    await owner
      .post("/api/v1/playback/state")
      .send({
        episodeId,
        positionMs: 121_000,
        durationMs: 600_000,
        state: "playing",
        playbackRate: 1,
      })
      .expect(409);

    await owner
      .post(`/api/v1/episodes/${episodeId}/progress`)
      .send({
        commandId: randomUUID(),
        positionMs: 600_000,
        durationMs: 600_000,
        completed: true,
      })
      .expect(409);
    expect(
      (await browser.get(`/api/v1/episodes/${episodeId}`)).body.episode,
    ).toMatchObject({ played: false, positionMs: 120_000 });
  });

  it("does not wake a renderer after 30 minutes without a playback report", async () => {
    const created = await testRuntime();
    runtimes.push(created.runtime);
    const owner = supertest.agent(created.baseUrl);
    await join(owner, "Sam", "Sleeping phone");
    const controller = supertest.agent(created.baseUrl);
    await join(controller, "Sam", "Web controller");
    const episodeId = insertEpisode(created.runtime);

    await owner
      .post("/api/v1/playback/lease")
      .send({
        episodeId,
        positionMs: 145_000,
        durationMs: 600_000,
        playbackRate: 1,
        takeover: true,
      })
      .expect(200);
    await owner
      .post("/api/v1/playback/state")
      .send({
        episodeId,
        positionMs: 145_000,
        durationMs: 600_000,
        state: "playing",
        playbackRate: 1,
      })
      .expect(200);
    const now = new Date("2026-08-30T12:00:00.000Z");
    created.runtime.database.db
      .prepare("UPDATE playback_state SET updated_at = ?")
      .run(new Date(now.getTime() - 31 * 60_000).toISOString());

    const rejected = await controller
      .post("/api/v1/playback/commands")
      .send({ commandId: randomUUID(), action: "play" })
      .expect(409);
    expect(rejected.body.error.code).toBe("PLAYBACK_NOT_ACTIVE");

    expect(created.runtime.webSockets.sweepIdlePlayback(now)).toBe(1);
    expect(
      (await controller.get("/api/v1/playback")).body.playback,
    ).toMatchObject({
      episode: { id: episodeId },
      positionMs: 145_000,
      state: "paused",
      mode: "local",
      activeDeviceId: null,
      castOwnerDeviceId: null,
    });
  });
});

function insertEpisode(runtime: Runtime): string {
  const now = new Date().toISOString();
  const podcastId = randomUUID();
  const episodeId = randomUUID();
  runtime.database.db
    .prepare(
      `INSERT INTO podcasts(
        id, feed_url, title, failure_count, created_at, updated_at
      ) VALUES (?, ?, 'Ownership show', 0, ?, ?)`,
    )
    .run(podcastId, "https://example.test/ownership-feed", now, now);
  runtime.database.db
    .prepare(
      `INSERT INTO episodes(
        id, podcast_id, guid, enclosure_url, enclosure_type, title,
        first_discovered_at, duration_ms, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'audio/mpeg', 'Ownership episode', ?, 600000, ?, ?)`,
    )
    .run(
      episodeId,
      podcastId,
      episodeId,
      "https://example.test/ownership.mp3",
      now,
      now,
      now,
    );
  return episodeId;
}
