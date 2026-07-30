import { randomUUID } from "node:crypto";
import supertest from "supertest";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { configForTest } from "../../src/config.js";
import { createRuntime, type Runtime } from "../../src/runtime.js";
import { join, testRuntime } from "../helpers.js";

const runtimes: Runtime[] = [];
afterEach(async () => {
  while (runtimes.length) await runtimes.pop()?.close();
});

describe("authentication and durable sync", () => {
  it("persists a joined browser session across a backend restart", async () => {
    const created = await testRuntime();
    runtimes.push(created.runtime);
    const agent = supertest.agent(created.baseUrl);
    const response = await join(agent);
    expect(response.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    await agent.get("/api/v1/me").expect(200);
    await created.runtime.close();
    runtimes.pop();

    const restarted = await createRuntime(configForTest(created.dataDir));
    runtimes.push(restarted);
    await new Promise<void>((done) =>
      restarted.server.listen(new URL(created.baseUrl).port, "127.0.0.1", done),
    );
    await agent.get("/api/v1/me").expect(200);
  });

  it("broadcasts live events, catches up missed revisions, and revokes access", async () => {
    const created = await testRuntime();
    runtimes.push(created.runtime);
    const first = supertest.agent(created.baseUrl);
    const firstJoin = await join(first, "Sam", "First");
    const cookie = (
      firstJoin.headers["set-cookie"] as unknown as string[]
    )[0]?.split(";")[0];
    expect(cookie).toBeTruthy();
    const firstSnapshot = await first.get("/api/v1/snapshot").expect(200);
    const revision = (firstSnapshot.body as { revision: number }).revision;

    const socket = new WebSocket(
      `${created.baseUrl.replace("http", "ws")}/ws?afterRevision=${revision}`,
      { headers: { cookie } },
    );
    await new Promise<void>((resolveOpen, reject) => {
      socket.once("open", resolveOpen);
      socket.once("error", reject);
    });
    const eventPromise = new Promise<{
      event: { type: string; revision: number };
    }>((resolveEvent) =>
      socket.once("message", (data) =>
        resolveEvent(
          JSON.parse(data.toString()) as {
            event: { type: string; revision: number };
          },
        ),
      ),
    );

    const second = supertest.agent(created.baseUrl);
    const secondJoin = await join(second, "Sam", "Second");
    const secondId = (
      secondJoin.body as { session: { device: { id: string } } }
    ).session.device.id;
    const live = await eventPromise;
    expect(live.event.type).toBe("device.joined");
    expect(live.event.revision).toBe(revision + 1);
    socket.close();

    const catchup = await first
      .get(`/api/v1/sync?afterRevision=${revision}`)
      .expect(200);
    expect((catchup.body as { events: unknown[] }).events).toHaveLength(1);

    const latest = await first.get("/api/v1/snapshot").expect(200);
    const currentRevision = (latest.body as { revision: number }).revision;
    const revoke = await first
      .delete(`/api/v1/devices/${secondId}`)
      .send({ commandId: randomUUID(), expectedRevision: currentRevision })
      .expect(200);
    expect((revoke.body as { revoked: boolean }).revoked).toBe(true);
    await second.get("/api/v1/me").expect(401);
  });

  it("returns a prior response for a repeated command id", async () => {
    const created = await testRuntime();
    runtimes.push(created.runtime);
    const first = supertest.agent(created.baseUrl);
    await join(first, "Sam", "First");
    const second = supertest.agent(created.baseUrl);
    const joined = await join(second, "Sam", "Second");
    const targetId = (joined.body as { session: { device: { id: string } } })
      .session.device.id;
    const snapshot = await first.get("/api/v1/snapshot");
    const commandId = randomUUID();
    const body = {
      commandId,
      expectedRevision: (snapshot.body as { revision: number }).revision,
    };
    const initial = await first
      .delete(`/api/v1/devices/${targetId}`)
      .send(body);
    expect(initial.status).toBe(200);
    const replay = await first.delete(`/api/v1/devices/${targetId}`).send(body);
    expect(replay.status).toBe(200);
    expect((replay.body as { replayed: boolean }).replayed).toBe(true);
  });
});
