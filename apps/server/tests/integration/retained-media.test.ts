import { createHash, randomUUID } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import supertest from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import { analysisResultSchema } from "@podwaffle/contracts";
import { join, testRuntime } from "../helpers.js";
import type { Runtime } from "../../src/runtime.js";
import { enqueueAnalysis } from "../../src/analysis/service.js";

let runtime: Runtime | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  await runtime?.close();
});

async function setup() {
  const test = await testRuntime();
  runtime = test.runtime;
  const agent = supertest.agent(test.baseUrl),
    joined = await join(agent);
  const profileId = String(joined.body.session.profile.id);
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
    .send({ commandId: randomUUID(), settings: { enabled: true } })
    .expect(200);
  const audio = Buffer.from("an exact analysed recording"),
    sha256 = createHash("sha256").update(audio).digest("hex");
  const result = analysisResultSchema.parse({
    version: 1,
    language: "en",
    episodeId,
    durationMs: 60000,
    fingerprint: { sha256, sizeBytes: audio.length, etag: null },
    model: "tiny.en",
    provider: "rules",
    generatedAt: new Date().toISOString(),
    fragments: [],
    diagnostics: { sampleWindows: [], acousticBoundariesMs: [], warnings: [] },
    transcriptExpired: false,
    segments: [
      {
        startMs: 10000,
        endMs: 20000,
        kind: "advertisement",
        title: "Ad",
        confidence: 0.9,
        source: "rules",
        evidence: "Sponsor",
        boundaryStatus: "approximate",
      },
    ],
  });
  const input = resolve(test.dataDir, "input-audio");
  await writeFile(input, audio);
  await runtime.mediaCache.retain(
    { episodeId, enclosureUrl: "https://example.com/one.mp3" },
    input,
    result.fingerprint,
  );
  const jobId = enqueueAnalysis(runtime.database.db, profileId, episodeId);
  const request = JSON.parse(
    String(
      runtime.database.db
        .prepare("SELECT request_json FROM episode_analysis_jobs WHERE id=?")
        .get(jobId)?.request_json,
    ),
  );
  const engineJob = runtime.analysis.enqueue(request);
  runtime.database.db
    .prepare(
      "UPDATE episode_analysis_jobs SET status='completed',result_json=?,remote_job_id=? WHERE id=?",
    )
    .run(JSON.stringify(result), engineJob.id, jobId);
  runtime.database.db
    .prepare(
      "UPDATE podcast_jobs SET status='completed',result_json=? WHERE id=?",
    )
    .run(JSON.stringify(result), engineJob.id);
  return {
    ...test,
    agent,
    profileId,
    podcastId,
    episodeId,
    audio,
    result,
    engineJob,
  };
}

it("serves exactly the checked bytes with byte ranges and HEAD, and retains the feed fallback URL", async () => {
  const { agent, episodeId, audio, result } = await setup();
  const episode = (await agent.get(`/api/v1/episodes/${episodeId}`)).body
    .episode;
  expect(episode.enclosureUrl).toBe("https://example.com/one.mp3");
  expect(episode.analysedMedia).toMatchObject({
    sha256: result.fingerprint.sha256,
    adSegments: [{ startMs: 10000, endMs: 20000 }],
  });
  await agent
    .get(episode.analysedMedia.path)
    .expect(200)
    .expect((response) => expect(response.body).toEqual(audio));
  await agent
    .get(episode.analysedMedia.path)
    .set("Range", "bytes=3-7")
    .expect(206)
    .expect("Content-Range", `bytes 3-7/${audio.length}`)
    .expect((response) => expect(response.body).toEqual(audio.subarray(3, 8)));
  await agent
    .head(episode.analysedMedia.path)
    .expect(200)
    .expect("Content-Length", String(audio.length));
  const downloads = await agent.get("/api/v1/analysis/downloads").expect(200);
  expect(
    downloads.body.episodes.map((item: { id: string }) => item.id),
  ).toEqual([episodeId]);
});

it("isolates jobs and automatic downloads by profile and stops advertising media when the series opts out", async () => {
  const { agent, runtime: rt, podcastId, episodeId, engineJob } = await setup();
  const guest = supertest.agent(rt.server);
  await join(guest, "Guest");
  expect((await guest.get("/api/v1/analysis/downloads")).body.episodes).toEqual(
    [],
  );
  await guest.get(`/api/v1/analysis/jobs/${engineJob.id}`).expect(404);
  expect((await guest.get("/api/v1/analysis/status")).body.jobs).toEqual([]);
  await agent
    .put(`/api/v1/subscriptions/${podcastId}/analysis`)
    .send({ commandId: randomUUID(), settings: { enabled: false } })
    .expect(200);
  expect(
    (await agent.get(`/api/v1/episodes/${episodeId}`)).body.episode
      .analysedMedia,
  ).toBeNull();
  expect((await agent.get("/api/v1/analysis/downloads")).body.episodes).toEqual(
    [],
  );
});

it("evicts audio at the configured cap while preserving analysis results and settings", async () => {
  const { agent, runtime: rt, episodeId } = await setup();
  const path = (await agent.get(`/api/v1/episodes/${episodeId}`)).body.episode
    .analysedMedia.path;
  await agent.put("/api/v1/analysis/storage").send({ limitMb: -1 }).expect(400);
  await agent.put("/api/v1/analysis/storage").send({ limitMb: 0 }).expect(200);
  await agent.get(path).expect(404);
  expect(
    (await agent.get(`/api/v1/episodes/${episodeId}/analysis`)).body.job.result
      .segments,
  ).toHaveLength(1);
  expect(rt.mediaCache.summary()).toMatchObject({
    limitMb: 0,
    bytes: 0,
    count: 0,
  });
  expect((await agent.get("/api/v1/analysis/downloads")).body.episodes).toEqual(
    [],
  );
});

it("edits bounded regions on the retained recording and emits a completion event for client catch-up", async () => {
  const {
    agent,
    runtime: rt,
    engineJob,
    result,
    episodeId,
    profileId,
  } = await setup();
  const events: unknown[] = [];
  const stop = rt.sync.subscribe((id, event) => {
    if (id === profileId) events.push(event);
  });
  const url = `/api/v1/analysis/jobs/${engineJob.id}/segments`;
  await agent
    .put(url)
    .send({
      commandId: randomUUID(),
      segments: [{ ...result.segments[0], endMs: 70000 }],
    })
    .expect(400);
  const command = {
    commandId: randomUUID(),
    segments: [{ ...result.segments[0], startMs: 12000 }],
  };
  await agent.put(url).send(command).expect(200);
  await agent.put(url).send(command).expect(200);
  expect(events).toHaveLength(1);
  stop();
  expect(
    (await agent.get(`/api/v1/episodes/${episodeId}`)).body.episode
      .analysedMedia.adSegments,
  ).toEqual([{ startMs: 12000, endMs: 20000 }]);
});

it("returns a recoverable missing-media response after a backup restore without cached audio", async () => {
  const { agent, runtime: rt, episodeId } = await setup();
  const path = (await agent.get(`/api/v1/episodes/${episodeId}`)).body.episode
    .analysedMedia.path;
  await rm(
    resolve(rt.mediaCache.config.episodeCacheDir, path.split("/").at(-1)!),
  );
  await agent.get(path).expect(404);
  await rt.mediaCache.prune();
  expect(
    (await agent.get(`/api/v1/episodes/${episodeId}`)).body.episode
      .analysedMedia,
  ).toBeNull();
});
