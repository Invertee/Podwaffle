import supertest from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import type { Runtime } from "../../src/runtime.js";
import { testRuntime } from "../helpers.js";

const runtimes: Runtime[] = [];
afterEach(async () => {
  while (runtimes.length) await runtimes.pop()?.close();
});

describe("optional Android push", () => {
  it("reports disabled configuration without affecting normal Android use", async () => {
    const created = await testRuntime();
    runtimes.push(created.runtime);
    const client = supertest(created.baseUrl);
    const profiles = await client.get("/api/v1/join/profiles").expect(200);
    const profileId = profiles.body.profiles[0].id as string;
    const joined = await client
      .post("/api/v1/join")
      .send({
        profileId,
        joinCode: "test-secret",
        deviceName: "Push phone",
        platform: "android",
      })
      .expect(201);
    const authorization = `Bearer ${joined.body.token as string}`;

    expect(
      (
        await client
          .get("/api/v1/push/config")
          .set("authorization", authorization)
      ).body,
    ).toEqual({ enabled: false, projectId: null, androidAppId: null });
    const health = await client
      .get("/api/v1/push/health")
      .set("authorization", authorization)
      .expect(200);
    expect(health.body).toMatchObject({
      status: "disabled",
      enabled: false,
      deviceRegistered: false,
      projectId: null,
      androidAppId: null,
    });
    const registration = await client
      .post("/api/v1/push/registrations")
      .set("authorization", authorization)
      .send({ provider: "fcm", registrationToken: "test-token" })
      .expect(503);
    expect(registration.body.error.code).toBe("PUSH_NOT_CONFIGURED");
  });
});
