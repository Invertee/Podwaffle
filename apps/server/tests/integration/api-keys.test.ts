import { randomUUID } from "node:crypto";
import supertest from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import type { Runtime } from "../../src/runtime.js";
import { join, testRuntime } from "../helpers.js";

const runtimes: Runtime[] = [];
afterEach(async () => {
  while (runtimes.length) await runtimes.pop()?.close();
});

describe("profile API keys", () => {
  it("creates, lists, scopes, and revokes API keys without exposing them as devices", async () => {
    const created = await testRuntime();
    runtimes.push(created.runtime);
    const browser = supertest.agent(created.baseUrl);
    await join(browser, "Sam", "Browser owner");
    const request = supertest(created.baseUrl);

    const createdKey = await browser
      .post("/api/v1/api-keys")
      .send({ name: "Start page" })
      .expect(201);
    const result = createdKey.body as {
      apiKey: {
        id: string;
        name: string;
        prefix: string;
        scopes: string[];
      };
      token: string;
    };
    expect(result.token).toMatch(/^pwk_/);
    expect(result.apiKey.name).toBe("Start page");
    expect(result.apiKey.prefix).toBe(result.token.slice(0, 12));
    expect(result.apiKey.scopes).toContain("playback:control");

    const keyList = await browser.get("/api/v1/api-keys").expect(200);
    expect(
      (keyList.body as { apiKeys: Array<{ id: string }> }).apiKeys.map(
        (key) => key.id,
      ),
    ).toContain(result.apiKey.id);

    const deviceList = await browser.get("/api/v1/devices").expect(200);
    expect(
      (deviceList.body as { devices: Array<{ id: string }> }).devices.map(
        (device) => device.id,
      ),
    ).not.toContain(result.apiKey.id);

    const authorization = { authorization: `Bearer ${result.token}` };
    await request.get("/api/v1/snapshot").set(authorization).expect(200);

    await browser
      .post("/api/v1/playback/lease")
      .send({ positionMs: 0, playbackRate: 1 })
      .expect(200);
    await request
      .post("/api/v1/playback/commands")
      .set(authorization)
      .send({ commandId: randomUUID(), action: "play" })
      .expect(202);

    await request
      .post("/api/v1/api-keys")
      .set(authorization)
      .send({ name: "Nested key" })
      .expect(403);
    await request
      .post("/api/v1/subscriptions")
      .set(authorization)
      .send({})
      .expect(403);

    await browser.delete(`/api/v1/api-keys/${result.apiKey.id}`).expect(204);
    await request.get("/api/v1/snapshot").set(authorization).expect(401);
  });
});
