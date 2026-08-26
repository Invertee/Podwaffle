import { randomUUID } from "node:crypto";
import supertest from "supertest";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import type { Runtime } from "../../src/runtime.js";
import { join, testRuntime } from "../helpers.js";

const runtimes: Runtime[] = [];
afterEach(async () => {
  while (runtimes.length) await runtimes.pop()?.close();
});

describe("cross-client Google Cast control", () => {
  it("relays to the Cast owner and persists only its confirmed result", async () => {
    const created = await testRuntime();
    runtimes.push(created.runtime);
    const owner = supertest.agent(created.baseUrl);
    const ownerJoin = await join(owner, "Sam", "Cast owner");
    const ownerCookie = (
      ownerJoin.headers["set-cookie"] as unknown as string[]
    )[0]?.split(";")[0];
    const second = supertest.agent(created.baseUrl);
    await join(second, "Sam", "Remote browser");
    const episodeId = insertEpisode(created.runtime);

    await owner
      .post("/api/v1/playback/cast")
      .send({
        commandId: randomUUID(),
        confirmed: {
          episodeId,
          positionMs: 12_000,
          durationMs: 600_000,
          state: "playing",
          playbackRate: 1,
          castSessionId: "cast-session-one",
          volume: 0.6,
          muted: false,
        },
      })
      .expect(200);
    const revision = (
      (await owner.get("/api/v1/snapshot")).body as { revision: number }
    ).revision;
    const socket = new WebSocket(
      `${created.baseUrl.replace("http", "ws")}/ws?afterRevision=${revision}`,
      { headers: { cookie: ownerCookie } },
    );
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });

    const commandId = randomUUID();
    const commandMessage = nextMessage(socket);
    const submitted = await second
      .post("/api/v1/playback/commands")
      .send({ commandId, action: "pause" })
      .expect(202);
    expect(submitted.body).toMatchObject({
      commandId,
      status: "pending",
      delivered: true,
      replayed: false,
    });
    expect(await commandMessage).toMatchObject({
      type: "playback.command",
      command: { commandId, action: "pause" },
    });

    const resultEvent = nextMessage(socket);
    socket.send(
      JSON.stringify({
        type: "playback.command.result",
        commandId,
        status: "accepted",
        confirmed: {
          episodeId,
          positionMs: 12_500,
          durationMs: 600_000,
          state: "paused",
          playbackRate: 1,
          castSessionId: "cast-session-one",
          volume: 0.6,
          muted: false,
        },
      }),
    );
    expect(await resultEvent).toMatchObject({
      type: "sync.event",
      event: {
        type: "playback.cast.updated",
        payload: { commandId, status: "accepted" },
      },
    });
    expect(
      (await second.get("/api/v1/playback").expect(200)).body.playback,
    ).toMatchObject({
      mode: "cast",
      state: "paused",
      positionMs: 12_500,
      castSessionId: "cast-session-one",
    });

    const replay = await second
      .post("/api/v1/playback/commands")
      .send({ commandId, action: "pause" })
      .expect(200);
    expect(replay.body).toMatchObject({
      status: "accepted",
      replayed: true,
    });
    const count = created.runtime.database.db
      .prepare(
        "SELECT COUNT(*) AS count FROM playback_commands WHERE command_id = ?",
      )
      .get(commandId) as { count: number };
    expect(count.count).toBe(1);
    socket.close();
  });

  it("returns a nonplaying Cast session to local mode after 30 minutes", async () => {
    const created = await testRuntime();
    runtimes.push(created.runtime);
    const owner = supertest.agent(created.baseUrl);
    await join(owner);
    const episodeId = insertEpisode(created.runtime);
    const now = new Date("2026-07-29T12:00:00.000Z");
    await owner
      .post("/api/v1/playback/cast")
      .send({
        commandId: randomUUID(),
        confirmed: {
          episodeId,
          positionMs: 20_000,
          durationMs: 600_000,
          state: "paused",
          playbackRate: 1,
          castSessionId: "idle-cast",
        },
      })
      .expect(200);
    created.runtime.database.db
      .prepare("UPDATE playback_state SET updated_at = ?")
      .run(new Date(now.getTime() - 31 * 60_000).toISOString());

    expect(created.runtime.webSockets.sweepIdleCasts(now)).toBe(1);
    expect((await owner.get("/api/v1/playback")).body.playback).toMatchObject({
      mode: "local",
      state: "paused",
      activeDeviceId: null,
      castOwnerDeviceId: null,
      castSessionId: null,
      positionMs: 20_000,
    });
    expect(
      created.runtime.database.db
        .prepare(
          "SELECT position_ms FROM episode_state WHERE profile_id = ? AND episode_id = ?",
        )
        .get((await owner.get("/api/v1/snapshot")).body.profile.id, episodeId),
    ).toEqual({ position_ms: 20_000 });
  });

  it("persists regular Cast progress before the session ends", async () => {
    const created = await testRuntime();
    runtimes.push(created.runtime);
    const owner = supertest.agent(created.baseUrl);
    await join(owner, "Sam", "Android Cast owner");
    const episodeId = insertEpisode(created.runtime);

    await owner
      .post("/api/v1/playback/cast")
      .send({
        commandId: randomUUID(),
        confirmed: {
          episodeId,
          positionMs: 15_000,
          durationMs: 600_000,
          state: "playing",
          playbackRate: 1,
          castSessionId: "durable-progress",
        },
      })
      .expect(200);
    await owner
      .post("/api/v1/playback/cast")
      .send({
        commandId: randomUUID(),
        confirmed: {
          episodeId,
          positionMs: 185_000,
          durationMs: 600_000,
          state: "playing",
          playbackRate: 1,
          castSessionId: "durable-progress",
        },
      })
      .expect(200);

    // A transient zero from a reconnecting Cast sender must not erase progress.
    await owner
      .post("/api/v1/playback/cast")
      .send({
        commandId: randomUUID(),
        confirmed: {
          episodeId,
          positionMs: 0,
          durationMs: 600_000,
          state: "playing",
          playbackRate: 1,
          castSessionId: "durable-progress",
        },
      })
      .expect(200);

    const snapshot = await owner.get("/api/v1/snapshot").expect(200);
    expect(snapshot.body.playback).toMatchObject({
      mode: "cast",
      positionMs: 185_000,
    });
    expect(
      created.runtime.database.db
        .prepare(
          "SELECT position_ms FROM episode_state WHERE profile_id = ? AND episode_id = ?",
        )
        .get(snapshot.body.profile.id, episodeId),
    ).toEqual({ position_ms: 185_000 });
  });

  it("lets another profile device clear a Cast session after its owner lease expires", async () => {
    const created = await testRuntime();
    runtimes.push(created.runtime);
    const owner = supertest.agent(created.baseUrl);
    await join(owner, "Sam", "Old browser");
    const replacement = supertest.agent(created.baseUrl);
    await join(replacement, "Sam", "Replacement browser");
    const episodeId = insertEpisode(created.runtime);

    await owner
      .post("/api/v1/playback/cast")
      .send({
        commandId: randomUUID(),
        confirmed: {
          episodeId,
          positionMs: 20_000,
          durationMs: 600_000,
          state: "playing",
          playbackRate: 1,
          castSessionId: "lost-cast",
        },
      })
      .expect(200);

    const stop = {
      commandId: randomUUID(),
      positionMs: 20_000,
      durationMs: 600_000,
      state: "paused",
      playbackRate: 1,
    };
    await replacement.delete("/api/v1/playback/cast").send(stop).expect(409);

    created.runtime.database.db
      .prepare("UPDATE playback_state SET lease_expires_at = ?")
      .run(new Date(Date.now() - 1_000).toISOString());

    await replacement
      .delete("/api/v1/playback/cast")
      .send({ ...stop, commandId: randomUUID() })
      .expect(200);
    expect(
      (await replacement.get("/api/v1/playback")).body.playback,
    ).toMatchObject({
      mode: "local",
      state: "paused",
      activeDeviceId: expect.any(String),
      castOwnerDeviceId: null,
      castSessionId: null,
      positionMs: 20_000,
    });
  });
});

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) =>
    socket.once("message", (data) =>
      resolve(JSON.parse(data.toString()) as Record<string, unknown>),
    ),
  );
}

function insertEpisode(runtime: Runtime): string {
  const now = new Date().toISOString();
  const podcastId = randomUUID();
  const episodeId = randomUUID();
  runtime.database.db
    .prepare(
      `INSERT INTO podcasts(
        id, feed_url, title, failure_count, created_at, updated_at
      ) VALUES (?, ?, 'Cast show', 0, ?, ?)`,
    )
    .run(podcastId, "https://example.test/cast-feed", now, now);
  runtime.database.db
    .prepare(
      `INSERT INTO episodes(
        id, podcast_id, guid, enclosure_url, enclosure_type, title,
        first_discovered_at, duration_ms, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'audio/mpeg', 'Cast episode', ?, 600000, ?, ?)`,
    )
    .run(
      episodeId,
      podcastId,
      episodeId,
      "https://example.test/cast.mp3",
      now,
      now,
      now,
    );
  return episodeId;
}
