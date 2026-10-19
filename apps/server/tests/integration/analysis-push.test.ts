import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { MulticastMessage } from "firebase-admin/messaging";
import supertest from "supertest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { analysisResultSchema } from "@podwaffle/contracts";
import {
  AnalysisDispatcher,
  enqueueAnalysis,
} from "../../src/analysis/service.js";
import { configForTest } from "../../src/config.js";
import type { Runtime } from "../../src/runtime.js";
import { join, testRuntime } from "../helpers.js";

const messaging = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("firebase-admin/app", () => ({
  cert: vi.fn(),
  initializeApp: vi.fn(() => ({ name: "test-firebase" })),
  deleteApp: vi.fn(async () => {}),
}));
vi.mock("firebase-admin/messaging", () => ({
  getMessaging: () => ({ sendEachForMulticast: messaging.send }),
}));

let runtime: Runtime | undefined;
beforeEach(() => {
  messaging.send
    .mockReset()
    .mockImplementation(async (message: MulticastMessage) => ({
      successCount: message.tokens.length,
      failureCount: 0,
      responses: message.tokens.map(() => ({
        success: true,
        messageId: randomUUID(),
      })),
    }));
});
afterEach(async () => {
  await new Promise<void>((done) => setImmediate(done));
  await runtime?.close();
  vi.unstubAllGlobals();
});
const downloadMessages = () =>
  messaging.send.mock.calls
    .map(([message]) => message as MulticastMessage)
    .filter((message) => message.data?.kind === "analysis-ready");

async function fixture(
  options: { optedIn?: boolean; retained?: boolean; failed?: boolean } = {},
) {
  const directory = await mkdtemp(
    resolve(tmpdir(), "podwaffle-firebase-test-"),
  );
  const androidConfig = resolve(directory, "android.json"),
    accountConfig = resolve(directory, "account.json");
  await writeFile(
    androidConfig,
    JSON.stringify({
      project_info: { project_id: "test-project" },
      client: [
        {
          client_info: {
            mobilesdk_app_id: "test-app",
            android_client_info: { package_name: "com.podwaffle.app" },
          },
        },
      ],
    }),
  );
  await writeFile(
    accountConfig,
    JSON.stringify({ project_id: "test-project" }),
  );
  // The real runtime imports completed engine work. Firebase transport is mocked;
  // no credentials, network requests to Firebase or model downloads are needed.
  const test = await testRuntime({
    analysis_enabled: false,
    firebase_enabled: true,
    firebase_android_config_path: androidConfig,
    firebase_service_account_path: accountConfig,
  });
  runtime = test.runtime;
  const rt = test.runtime;
  const agent = supertest.agent(test.baseUrl);
  const joined = await join(agent);
  const profileId = String(joined.body.session.profile.id);
  const profiles = (await agent.get("/api/v1/join/profiles")).body
    .profiles as Array<{ id: string; displayName: string }>;
  const guestId = profiles.find(
    (profile) => profile.displayName === "Guest",
  )!.id;
  const register = async (owner: string, token: string) => {
    const response = await supertest(test.baseUrl)
      .post("/api/v1/join")
      .send({
        profileId: owner,
        joinCode: "test-secret",
        platform: "android",
        deviceName: token,
      })
      .expect(201);
    const deviceId = String(response.body.session.device.id);
    rt.push.register(deviceId, { registrationToken: token });
    return deviceId;
  };
  await register(profileId, "phone-token");
  await register(profileId, "tablet-token");
  await register(guestId, "other-profile-token");
  const revoked = await register(profileId, "revoked-token");
  rt.database.db
    .prepare("UPDATE devices SET revoked_at=? WHERE id=?")
    .run(new Date().toISOString(), revoked);
  rt.push.register(String(joined.body.session.device.id), {
    registrationToken: "web-token",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          '<rss><channel><title>Show</title><item><guid>one</guid><title>One</title><enclosure url="https://example.com/one.mp3" type="audio/mpeg"/></item></channel></rss>',
        ),
    ),
  );
  const subscription = await agent
    .post("/api/v1/subscriptions")
    .send({ commandId: randomUUID(), feedUrl: "https://example.com/rss" })
    .expect(201);
  const podcastId = String(subscription.body.subscription.id);
  const episodeId = String(
    (await agent.get(`/api/v1/podcasts/${podcastId}/episodes`)).body.episodes[0]
      .id,
  );
  await agent
    .put(`/api/v1/subscriptions/${podcastId}/analysis`)
    .send({
      commandId: randomUUID(),
      settings: { enabled: options.optedIn ?? true },
    })
    .expect(200);
  const audio = Buffer.from("the exact recording checked during transcription");
  const result = analysisResultSchema.parse({
    version: 1,
    language: "en",
    episodeId,
    durationMs: 60000,
    fingerprint: {
      sha256: createHash("sha256").update(audio).digest("hex"),
      sizeBytes: audio.length,
      etag: null,
    },
    model: "tiny.en",
    provider: "rules",
    generatedAt: new Date().toISOString(),
    fragments: [],
    segments: [],
    diagnostics: { sampleWindows: [], acousticBoundariesMs: [], warnings: [] },
    transcriptExpired: false,
  });
  if (options.retained !== false) {
    const input = resolve(test.dataDir, "checked-audio");
    await writeFile(input, audio);
    await rt.mediaCache.retain(
      { episodeId, enclosureUrl: "https://example.com/one.mp3" },
      input,
      result.fingerprint,
    );
  }
  const id = enqueueAnalysis(rt.database.db, profileId, episodeId);
  const request = JSON.parse(
    String(
      rt.database.db
        .prepare("SELECT request_json FROM episode_analysis_jobs WHERE id=?")
        .get(id)!.request_json,
    ),
  );
  const job = rt.analysis.enqueue(request);
  rt.database.db
    .prepare(
      "UPDATE podcast_jobs SET status=?,stage=?,progress=100,result_json=? WHERE id=?",
    )
    .run(
      options.failed ? "failed" : "completed",
      options.failed ? "failed" : "completed",
      options.failed ? null : JSON.stringify(result),
      job.id,
    );
  rt.database.db
    .prepare("UPDATE episode_analysis_jobs SET remote_job_id=? WHERE id=?")
    .run(job.id, id);
  const dispatcher = new AnalysisDispatcher(
    rt.database,
    rt.sync,
    configForTest(test.dataDir),
    rt.analysis,
  );
  messaging.send.mockClear();
  return { agent, rt, episodeId, profileId, result, dispatcher, id };
}

it("sends a silent offline-download message after completion, including when no adverts were found", async () => {
  const { dispatcher, agent, rt, episodeId, result } = await fixture();
  await dispatcher.tick();
  await vi.waitFor(() => expect(downloadMessages()).toHaveLength(1));
  expect(downloadMessages()[0]).toEqual({
    tokens: expect.arrayContaining(["phone-token", "tablet-token"]),
    data: { kind: "analysis-ready", episodeId, revision: expect.any(String) },
    android: { priority: "normal", ttl: 7 * 24 * 60 * 60_000 },
  });
  expect(downloadMessages()[0]!.tokens).toHaveLength(2);
  const ready = await agent.get("/api/v1/analysis/downloads").expect(200);
  expect(ready.body.episodes).toHaveLength(1);
  expect(ready.body.episodes[0]).toMatchObject({
    id: episodeId,
    analysedMedia: { sha256: result.fingerprint.sha256, adSegments: [] },
  });
  // Importing the completed result again cannot emit another completion message.
  await dispatcher.tick();
  expect(downloadMessages()).toHaveLength(1);
  expect(
    rt.database.db
      .prepare("SELECT status FROM episode_analysis_jobs WHERE episode_id=?")
      .get(episodeId)!.status,
  ).toBe("completed");
});

it.each([{ optedIn: false }, { retained: false }, { failed: true }])(
  "does not request an offline download for ineligible work: %j",
  async (options) => {
    const { dispatcher, agent } = await fixture(options);
    await dispatcher.tick();
    await new Promise<void>((done) => setImmediate(done));
    expect(downloadMessages()).toEqual([]);
    expect(
      (await agent.get("/api/v1/analysis/downloads").expect(200)).body.episodes,
    ).toEqual([]);
  },
);

it("keeps completed audio in catch-up when Firebase is temporarily unavailable", async () => {
  const { dispatcher, agent, rt, id, episodeId } = await fixture();
  messaging.send.mockRejectedValueOnce(new Error("Firebase unavailable"));
  await dispatcher.tick();
  await vi.waitFor(() => expect(downloadMessages()).toHaveLength(1));
  expect(
    rt.database.db
      .prepare("SELECT status FROM episode_analysis_jobs WHERE id=?")
      .get(id)!.status,
  ).toBe("completed");
  const ready = await agent.get("/api/v1/analysis/downloads").expect(200);
  expect(
    ready.body.episodes.map((episode: { id: string }) => episode.id),
  ).toEqual([episodeId]);
});
