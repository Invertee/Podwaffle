import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import type supertest from "supertest";
import { configForTest } from "../src/config.js";
import { createRuntime, type Runtime } from "../src/runtime.js";

export async function testRuntime(): Promise<{
  runtime: Runtime;
  dataDir: string;
  baseUrl: string;
}> {
  const dataDir = await mkdtemp(resolve(tmpdir(), "podwaffle-test-"));
  const runtime = await createRuntime(configForTest(dataDir));
  await new Promise<void>((done) =>
    runtime.server.listen(0, "127.0.0.1", () => done()),
  );
  const address = runtime.server.address() as AddressInfo;
  return { runtime, dataDir, baseUrl: `http://127.0.0.1:${address.port}` };
}

export async function join(
  agent: ReturnType<typeof supertest.agent>,
  profileName = "Sam",
  deviceName = "Test browser",
) {
  const profiles = await agent.get("/api/v1/join/profiles").expect(200);
  const profile = (
    profiles.body as { profiles: { id: string; displayName: string }[] }
  ).profiles.find((candidate) => candidate.displayName === profileName);
  if (!profile) throw new Error("Test profile not found");
  return agent
    .post("/api/v1/join")
    .send({
      profileId: profile.id,
      joinCode: "test-secret",
      deviceName,
      platform: "web",
    })
    .expect(201);
}
