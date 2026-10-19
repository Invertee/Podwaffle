import { randomUUID } from "node:crypto";
import supertest from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { configForTest } from "../../src/config.js";
import { QUEUE_INACTIVITY_MS } from "../../src/playback/queue-expiry.js";
import { createRuntime, type Runtime } from "../../src/runtime.js";
import { join, testRuntime } from "../helpers.js";

const runtimes: Runtime[] = [];
afterEach(async () => {
  while (runtimes.length) await runtimes.pop()?.close();
});

async function setup(mode: "local" | "cast" = "local") {
  const created = await testRuntime();
  runtimes.push(created.runtime);
  const client = supertest.agent(created.baseUrl);
  const joined = await join(client);
  const profileId = joined.body.session.profile.id as string;
  const db = created.runtime.database.db;
  const podcastId = randomUUID();
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO podcasts(id, feed_url, title, created_at, updated_at) VALUES (?, ?, 'Expiry show', ?, ?)",
  ).run(podcastId, `https://example.test/${podcastId}`, now, now);
  for (const episodeId of ids) {
    db.prepare(
      "INSERT INTO episodes(id, podcast_id, guid, title, enclosure_url, duration_ms, first_discovered_at, created_at, updated_at) VALUES (?, ?, ?, 'Expiry episode', ?, 600000, ?, ?, ?)",
    ).run(
      episodeId,
      podcastId,
      episodeId,
      `https://example.test/${episodeId}.mp3`,
      now,
      now,
      now,
    );
    await client
      .post("/api/v1/queue/items")
      .send({ commandId: randomUUID(), episodeId, position: "bottom" })
      .expect(201);
  }
  const current = ids[0]!;
  const state = {
    episodeId: current,
    positionMs: 15_000,
    durationMs: 600_000,
    state: "paused",
    playbackRate: 1,
  };
  const confirmed = { ...state, castSessionId: "expiry-cast" };
  if (mode === "cast") {
    await client
      .post("/api/v1/playback/cast")
      .send({ commandId: randomUUID(), confirmed })
      .expect(200);
  } else {
    await client.post("/api/v1/playback/lease").send(state).expect(200);
    await client.post("/api/v1/playback/state").send(state).expect(200);
  }
  const age = (time: number) =>
    db
      .prepare(
        "UPDATE queue_activity SET last_activity_at = ? WHERE profile_id = ?",
      )
      .run(new Date(time).toISOString(), profileId);
  const activity = () =>
    (
      db
        .prepare(
          "SELECT last_activity_at FROM queue_activity WHERE profile_id = ?",
        )
        .get(profileId) as { last_activity_at: string }
    ).last_activity_at;
  return {
    ...created,
    client,
    profileId,
    ids,
    current,
    state,
    confirmed,
    age,
    activity,
  };
}

describe("three-day queue inactivity expiry", () => {
  it.each(["local", "cast"] as const)(
    "clears the whole %s queue at 72 hours and preserves unplayed progress",
    async (mode) => {
      const f = await setup(mode);
      const lastActivity = Date.parse(f.activity());
      expect(
        f.runtime.queueExpiry.sweep(lastActivity + QUEUE_INACTIVITY_MS - 1),
      ).toBe(0);
      expect(
        f.runtime.queueExpiry.sweep(lastActivity + QUEUE_INACTIVITY_MS),
      ).toBe(1);
      expect(
        f.runtime.queueExpiry.sweep(lastActivity + QUEUE_INACTIVITY_MS + 1),
      ).toBe(0);
      expect((await f.client.get("/api/v1/queue")).body.queue).toEqual([]);
      expect(
        (await f.client.get("/api/v1/playback")).body.playback,
      ).toMatchObject({
        episode: null,
        state: "stopped",
        mode: "local",
        activeDeviceId: null,
        castOwnerDeviceId: null,
      });
      expect(
        (await f.client.get(`/api/v1/episodes/${f.current}`)).body.episode,
      ).toMatchObject({ played: false, positionMs: 15_000 });
      expect(
        f.runtime.sync.eventsAfter(f.profileId, 0).at(-1)?.payload.reason,
      ).toBe("queue_inactivity_timeout");
      await f.client
        .post("/api/v1/playback/lease")
        .send({ ...f.state, takeover: false })
        .expect(409);
      await f.client
        .post("/api/v1/playback/cast")
        .send({ commandId: randomUUID(), confirmed: f.confirmed })
        .expect(409);
      expect((await f.client.get("/api/v1/queue")).body.queue).toEqual([]);
      await f.client
        .post("/api/v1/playback/lease")
        .send({ ...f.state, takeover: true })
        .expect(200);
      expect((await f.client.get("/api/v1/queue")).body.queue).toHaveLength(1);
    },
  );

  it.each(["local", "cast"] as const)(
    "ignores paused %s heartbeats but resets on playback and seeking",
    async (mode) => {
      const f = await setup(mode);
      const old = Date.now() - 2 * 24 * 60 * 60 * 1_000;
      f.age(old);
      const report = (state: object) =>
        mode === "cast"
          ? f.client
              .post("/api/v1/playback/cast")
              .send({
                commandId: randomUUID(),
                background: true,
                confirmed: { ...f.confirmed, ...state },
              })
          : f.client
              .post("/api/v1/playback/state")
              .send({ ...f.state, ...state });
      await report({}).expect(200);
      await report({}).expect(200);
      expect(f.activity()).toBe(new Date(old).toISOString());
      await report({ positionMs: 25_000 }).expect(200);
      expect(Date.parse(f.activity())).toBeGreaterThan(old);
      f.age(old);
      await report({ state: "playing", positionMs: 26_000 }).expect(200);
      expect(f.runtime.queueExpiry.sweep(old + QUEUE_INACTIVITY_MS)).toBe(0);
    },
  );

  it("resets inactivity after queue edits and expires old queues before a client reads them", async () => {
    const f = await setup();
    const old = Date.now() - QUEUE_INACTIVITY_MS + 60_000;
    f.age(old);
    const queue = (await f.client.get("/api/v1/queue")).body.queue as {
      id: string;
    }[];
    await f.client
      .put("/api/v1/queue/order")
      .send({
        commandId: randomUUID(),
        queueItemIds: [queue[0]!.id, queue[2]!.id, queue[1]!.id],
      })
      .expect(200);
    expect(Date.parse(f.activity())).toBeGreaterThan(old);
    f.age(old);
    await f.client
      .delete(`/api/v1/queue/items/${queue[1]!.id}`)
      .send({ commandId: randomUUID() })
      .expect(200);
    expect(Date.parse(f.activity())).toBeGreaterThan(old);
    f.age(Date.now() - QUEUE_INACTIVITY_MS - 1);
    expect((await f.client.get("/api/v1/snapshot")).body.queue).toEqual([]);
  });

  it("retains the inactivity deadline across a server restart", async () => {
    const f = await setup();
    f.age(Date.now() - QUEUE_INACTIVITY_MS - 1);
    await runtimes.pop()!.close();
    const reopened = await createRuntime(configForTest(f.dataDir));
    runtimes.push(reopened);
    expect(
      reopened.database.db
        .prepare(
          "SELECT COUNT(*) AS count FROM queue_items WHERE profile_id = ?",
        )
        .get(f.profileId),
    ).toMatchObject({ count: 0 });
    expect(
      reopened.sync.eventsAfter(f.profileId, 0).at(-1)?.payload.reason,
    ).toBe("queue_inactivity_timeout");
  });
});
