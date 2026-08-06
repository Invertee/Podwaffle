import { randomUUID } from "node:crypto";
import supertest from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import type { Runtime } from "../../src/runtime.js";
import { join, testRuntime } from "../helpers.js";

const runtimes: Runtime[] = [];
afterEach(async () => {
  while (runtimes.length) await runtimes.pop()?.close();
});

describe("Home Assistant controller credentials", () => {
  it("can observe and control a profile without becoming a playback device", async () => {
    const created = await testRuntime();
    runtimes.push(created.runtime);
    const browser = supertest.agent(created.baseUrl);
    const browserJoin = await join(browser, "Sam", "Browser owner");
    const profileId = (
      browserJoin.body as { session: { profile: { id: string } } }
    ).session.profile.id;

    const controllerJoin = await supertest(created.baseUrl)
      .post("/api/v1/join")
      .send({
        profileId,
        joinCode: "test-secret",
        deviceName: "Home Assistant",
        platform: "home_assistant",
        appVersion: "0.1.0",
      })
      .expect(201);
    const controller = controllerJoin.body as {
      token: string;
      session: {
        device: {
          id: string;
          platform: string;
          playbackTarget: boolean;
        };
      };
    };
    expect(controller.session.device.platform).toBe("home_assistant");
    expect(controller.session.device.playbackTarget).toBe(false);

    const request = supertest(created.baseUrl);
    const authorization = { authorization: `Bearer ${controller.token}` };
    await request.get("/api/v1/snapshot").set(authorization).expect(200);
    await request.get("/api/v1/stats?period=today").set(authorization).expect(200);
    await request.get("/api/v1/devices").set(authorization).expect(200);

    await request
      .post("/api/v1/playback/lease")
      .set(authorization)
      .send({ positionMs: 0, playbackRate: 1 })
      .expect(403);
    await request.get("/api/v1/queue").set(authorization).expect(403);
    await request
      .delete(`/api/v1/devices/${controller.session.device.id}`)
      .set(authorization)
      .send({ commandId: randomUUID() })
      .expect(403);

    await browser
      .post("/api/v1/playback/lease")
      .send({ positionMs: 0, playbackRate: 1 })
      .expect(200);
    const commandId = randomUUID();
    const relayed = await request
      .post("/api/v1/playback/commands")
      .set(authorization)
      .send({ commandId, action: "play" })
      .expect(202);
    expect((relayed.body as { status: string }).status).toBe("pending");
    await request
      .get(`/api/v1/playback/commands/${commandId}`)
      .set(authorization)
      .expect(200);

    await browser
      .post("/api/v1/playback/commands")
      .send({
        commandId: randomUUID(),
        action: "play",
        targetDeviceId: controller.session.device.id,
      })
      .expect(409);
  });
});
