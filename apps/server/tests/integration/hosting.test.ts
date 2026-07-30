import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import supertest from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { configForTest } from "../../src/config.js";
import { createRuntime, type Runtime } from "../../src/runtime.js";

const runtimes: Runtime[] = [];
afterEach(async () => {
  while (runtimes.length) await runtimes.pop()?.close();
});

describe("hosting and proxy behavior", () => {
  it("serves health, version, assets and the SPA with appropriate caching", async () => {
    const dataDir = await mkdtemp(resolve(tmpdir(), "podwaffle-host-"));
    const webDir = resolve(dataDir, "web");
    await mkdir(resolve(webDir, "assets"), { recursive: true });
    await writeFile(
      resolve(webDir, "index.html"),
      "<main>Podwaffle shell</main>",
    );
    await writeFile(
      resolve(webDir, "assets", "app-abc.js"),
      "console.log('ok')",
    );
    const runtime = await createRuntime(configForTest(dataDir), {
      webDistPath: webDir,
    });
    runtimes.push(runtime);
    const request = supertest(runtime.server);

    await request.get("/health").expect(200).expect("content-type", /json/);
    await request
      .get("/version.json")
      .expect(200)
      .expect("cache-control", "no-store");
    await request
      .get("/assets/app-abc.js")
      .expect(200)
      .expect("cache-control", /immutable/);
    await request
      .get("/some/client/route")
      .expect(200)
      .expect("cache-control", "no-store")
      .expect(/Podwaffle shell/);
  });

  it("trusts one proxy hop when setting secure browser credentials", async () => {
    const dataDir = await mkdtemp(resolve(tmpdir(), "podwaffle-proxy-"));
    const runtime = await createRuntime(configForTest(dataDir));
    runtimes.push(runtime);
    const request = supertest(runtime.server);
    const profiles = await request.get("/api/v1/join/profiles");
    const id = (profiles.body as { profiles: { id: string }[] }).profiles[0]
      ?.id;
    const response = await request
      .post("/api/v1/join")
      .set("x-forwarded-proto", "https")
      .send({
        profileId: id,
        joinCode: "test-secret",
        deviceName: "Proxied browser",
        platform: "web",
      })
      .expect(201);
    expect(response.headers["set-cookie"]?.[0]).toContain("Secure");
  });
});
