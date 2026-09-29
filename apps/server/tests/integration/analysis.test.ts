import { randomUUID } from "node:crypto";
import supertest from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import { join, testRuntime } from "../helpers.js";
import type { Runtime } from "../../src/runtime.js";
import { configForTest } from "../../src/config.js";
import {
  AnalysisDispatcher,
  enqueueAnalysis,
  getEpisodeAnalysis,
} from "../../src/analysis/service.js";
import { upsertPodcastAndEpisodes } from "../../src/podcasts/service.js";
import { parseRss } from "../../src/podcasts/rss.js";

let runtime: Runtime | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  await runtime?.close();
});
const command = () => ({ commandId: randomUUID() });
const feed = (count: number) =>
  parseRss(
    `<rss><channel><title>Test</title>${Array.from({ length: count }, (_, i) => `<item><guid>${i}</guid><title>Episode ${i}</title><enclosure url="https://example.com/${i}.mp3" type="audio/mpeg"/><podcast:chapters url="https://example.com/${i}.json"/></item>`).join("")}</channel></rss>`,
  );

async function setup() {
  const test = await testRuntime();
  runtime = test.runtime;
  const agent = supertest.agent(test.baseUrl);
  const joined = await join(agent);
  const profileId = joined.body.session.profile.id as string;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          '<rss><channel><title>Test</title><item><guid>0</guid><title>Episode 0</title><enclosure url="https://example.com/0.mp3"/></item></channel></rss>',
        ),
    ),
  );
  const subscribed = await agent
    .post("/api/v1/subscriptions")
    .send({ ...command(), feedUrl: "https://example.com/feed" })
    .expect(201);
  const podcastId = subscribed.body.subscription.id as string;
  const episodeId = (await agent.get(`/api/v1/podcasts/${podcastId}/episodes`))
    .body.episodes[0].id as string;
  const config = configForTest(test.dataDir, {
    analysis_server_url: "http://analyser.test:5000",
  });
  return { ...test, agent, profileId, podcastId, episodeId, config };
}

it("opt-in queues only newly discovered episodes and isolates subscription settings", async () => {
  const { agent, profileId, podcastId, runtime: rt } = await setup();
  const url = `/api/v1/subscriptions/${podcastId}/analysis`;
  expect((await agent.get(url)).body.settings.enabled).toBe(false);
  const settings = { enabled: true, phrases: ["waffle sponsor"] };
  const request = { ...command(), settings };
  await agent.put(url).send(request).expect(200);
  expect((await agent.put(url).send(request)).body.replayed).toBe(true);
  expect(
    rt.database.db
      .prepare("SELECT COUNT(*) AS count FROM episode_analysis_jobs")
      .get()?.count,
  ).toBe(0);
  const guest = supertest.agent(rt.server);
  await join(guest, "Guest");
  await guest.get(url).expect(404);
  const refresh = () =>
    rt.database.transaction(() =>
      upsertPodcastAndEpisodes(
        rt.database.db,
        { feedUrl: "https://example.com/feed" },
        { status: "updated", feed: feed(2), etag: null, lastModified: null },
        30,
      ),
    );
  refresh();
  refresh();
  const jobs = rt.database.db
    .prepare("SELECT * FROM episode_analysis_jobs")
    .all();
  expect(jobs).toHaveLength(1);
  expect(jobs[0]?.profile_id).toBe(profileId);
  expect(JSON.parse(String(jobs[0]?.request_json)).chaptersUrl).toBe(
    "https://example.com/1.json",
  );
  await agent
    .put(url)
    .send({ ...command(), settings: { enabled: false, phrases: [] } })
    .expect(200);
  rt.database.transaction(() =>
    upsertPodcastAndEpisodes(
      rt.database.db,
      { feedUrl: "https://example.com/feed" },
      { status: "updated", feed: feed(3), etag: null, lastModified: null },
      30,
    ),
  );
  expect(
    rt.database.db
      .prepare("SELECT COUNT(*) AS count FROM episode_analysis_jobs")
      .get()?.count,
  ).toBe(1);
});

it("retries with a stable request key, imports results, expires snippets and detects enclosure changes", async () => {
  const { runtime: rt, profileId, episodeId, config } = await setup();
  const id = enqueueAnalysis(rt.database.db, profileId, episodeId);
  expect(enqueueAnalysis(rt.database.db, profileId, episodeId)).toBe(id);
  const dispatcher = new AnalysisDispatcher(rt.database, rt.sync, config);
  const remoteId = randomUUID();
  let complete = false;
  const result = {
    version: 1,
    language: "en",
    episodeId,
    durationMs: 60000,
    fingerprint: { sha256: "a".repeat(64), sizeBytes: 1234, etag: null },
    model: "tiny.en",
    provider: "rules",
    generatedAt: new Date().toISOString(),
    segments: [
      {
        startMs: 10000,
        endMs: 12000,
        kind: "advertisement",
        title: "Possible advert",
        confidence: 0.6,
        source: "rules",
        evidence: "Phrase: our sponsor",
        boundaryStatus: "approximate",
      },
    ],
    fragments: [{ startMs: 10000, endMs: 12000, text: "our sponsor" }],
    diagnostics: {
      sampleWindows: [{ startMs: 0, endMs: 30000 }],
      acousticBoundariesMs: [],
      warnings: [],
    },
    transcriptExpired: false,
  };
  const transport = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.body)
      expect(JSON.parse(String(options.body)).requestKey).toBe(id);
    return Response.json({
      job: {
        id: remoteId,
        requestKey: id,
        status: complete ? "completed" : "queued",
        stage: complete ? "completed" : "queued",
        progress: complete ? 100 : 0,
        error: null,
        result: complete ? result : null,
      },
      logs: [],
    });
  });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
  await dispatcher.tick();
  expect(
    getEpisodeAnalysis(rt.database.db, config, profileId, episodeId).job
      ?.attempts,
  ).toBe(1);
  vi.stubGlobal("fetch", transport);
  rt.database.db
    .prepare("UPDATE episode_analysis_jobs SET next_attempt_at='2000-01-01'")
    .run();
  await dispatcher.tick();
  complete = true;
  rt.database.db
    .prepare("UPDATE episode_analysis_jobs SET next_attempt_at='2000-01-01'")
    .run();
  await dispatcher.tick();
  expect(transport.mock.calls[1]?.[0]).toContain(`/jobs/${remoteId}`);
  expect(
    getEpisodeAnalysis(rt.database.db, config, profileId, episodeId).job?.result
      ?.segments,
  ).toHaveLength(1);
  rt.database.db
    .prepare(
      "UPDATE episode_analysis_jobs SET transcript_expires_at='2000-01-01'",
    )
    .run();
  const expired = getEpisodeAnalysis(
    rt.database.db,
    config,
    profileId,
    episodeId,
  ).job?.result;
  expect(expired?.fragments).toEqual([]);
  expect(expired?.segments).toHaveLength(1);
  expect(expired?.transcriptExpired).toBe(true);
  rt.database.db
    .prepare(
      "UPDATE episodes SET enclosure_url='https://example.com/changed.mp3' WHERE id=?",
    )
    .run(episodeId);
  expect(
    getEpisodeAnalysis(rt.database.db, config, profileId, episodeId).job?.stale,
  ).toBe(true);
  await dispatcher.stop();
});

it("rejects malformed analysis results and unavailable manual analysis with clear errors", async () => {
  const { runtime: rt, agent, profileId, episodeId, config } = await setup();
  await agent
    .post(`/api/v1/episodes/${episodeId}/analysis`)
    .send(command())
    .expect(503);
  const id = enqueueAnalysis(rt.database.db, profileId, episodeId);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        job: {
          id: randomUUID(),
          requestKey: id,
          status: "completed",
          stage: "completed",
          progress: 100,
          error: null,
          result: { segments: [{ startMs: -1 }] },
        },
      }),
    ),
  );
  const dispatcher = new AnalysisDispatcher(rt.database, rt.sync, config);
  await dispatcher.tick();
  const job = getEpisodeAnalysis(
    rt.database.db,
    config,
    profileId,
    episodeId,
  ).job;
  expect(job?.result).toBeNull();
  expect(job?.error).toContain("Invalid analyser response");
  await dispatcher.stop();
});
