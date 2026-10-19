"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPodcastStore } = require("../src/podcast-store");
const {
  validateRequest,
  sampleWindows,
  parseWhisper,
  classifyRules,
  applySensitivity,
  validateSegments,
  PodcastWorker,
} = require("../src/podcast-analysis");

const request = {
  requestKey: "test-request",
  episodeId: "episode",
  title: "Test episode",
  enclosureUrl: "https://example.com/audio.mp3",
  phrases: ["Waffle sponsor"],
};
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "podcast-test-"));
  const filename = path.join(directory, "test.sqlite");
  const store = createPodcastStore(filename);
  t.after(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { store, filename };
}

test("validates HTTP audio input and bounded literal phrase hints", () => {
  const validated = validateRequest(request);
  assert.equal(validated.chaptersUrl, null);
  assert.equal(validated.llmPrompt, "");
  assert.equal(validated.sensitivity, "balanced");
  assert.equal(validated.edgeFocusMinutes, 5);
  assert.throws(
    () => validateRequest({ ...request, enclosureUrl: "file:///etc/passwd" }),
    /HTTP/,
  );
  assert.throws(
    () => validateRequest({ ...request, phrases: Array(51).fill("ad") }),
    /50/,
  );
  assert.throws(
    () => validateRequest({ ...request, phrases: [""] }),
    /nonempty/,
  );
  assert.throws(
    () => validateRequest({ ...request, llmPrompt: "x".repeat(2001) }),
    /llmPrompt/,
  );
  assert.throws(
    () => validateRequest({ ...request, sensitivity: "maximum" }),
    /sensitivity/,
  );
  assert.throws(
    () => validateRequest({ ...request, edgeFocusMinutes: 16 }),
    /edgeFocusMinutes/,
  );
});

test("persistent queue deduplicates retries and rejects conflicting request keys", (t) => {
  const { store, filename } = fixture(t);
  const first = store.enqueue(validateRequest(request));
  assert.equal(store.enqueue(validateRequest(request)).job.id, first.job.id);
  assert.throws(
    () => store.enqueue(validateRequest({ ...request, title: "Changed" })),
    /different input/,
  );
  assert.equal(store.claim().id, first.job.id);
  assert.equal(store.claim(), null);
  // Simulate process restart: interrupted work becomes claimable again.
  const reopened = createPodcastStore(filename);
  assert.equal(reopened.claim().id, first.job.id);
  reopened.close();
});

test("sampling stays within duration, respects budget and covers the episode ends", () => {
  const windows = sampleWindows(
    3600000,
    Array.from({ length: 1000 }, (_, i) => i * 3500),
    900,
  );
  assert.equal(windows.length, 30);
  assert.equal(windows[0].startMs, 0);
  assert.equal(windows.at(-1).endMs, 3600000);
  assert.ok(windows.every((w) => w.startMs >= 0 && w.endMs <= 3600000));
  assert.ok(
    windows.filter((w) => w.startMs < 300000 || w.endMs > 3600000 - 300000)
      .length >= 20,
  );
  assert.deepEqual(sampleWindows(5000, [], 900), [{ startMs: 0, endMs: 5000 }]);
});

test("Whisper offsets use original media time and phrase detection is literal", () => {
  const fragments = parseWhisper(
    {
      transcription: [
        {
          offsets: { from: 1200, to: 4000 },
          text: "Thanks to our waffle sponsor.",
        },
      ],
    },
    { startMs: 90000, endMs: 120000 },
  );
  assert.equal(fragments[0].startMs, 91200);
  assert.equal(fragments[0].endMs, 94000);
  assert.equal(classifyRules(fragments, ["Waffle sponsor"])[0].confidence, 0.6);
  assert.equal(classifyRules(fragments, [".*"]).length, 0);
  const candidates = [
    { kind: "advertisement", confidence: 0.5 },
    { kind: "advertisement", confidence: 0.8 },
    { kind: "chapter", confidence: 0.2 },
  ];
  assert.equal(applySensitivity(candidates, "low").length, 2);
  assert.equal(applySensitivity(candidates, "high").length, 3);
  assert.throws(
    () =>
      validateSegments(
        [
          {
            startMs: 20,
            endMs: 10,
            kind: "chapter",
            title: "bad",
            confidence: 1,
          },
        ],
        100,
      ),
    /Invalid/,
  );
});

test("worker records stages, result and separate job logs; failures remain retryable with a new request", async (t) => {
  const { store } = fixture(t);
  const job = store.enqueue(validateRequest(request)).job;
  const logger = { info() {}, warn() {}, error() {} };
  const worker = new PodcastWorker(
    store,
    { podcastJobTimeoutMs: 10000 },
    logger,
    async (_request, _config, _signal, progress) => {
      progress("classifying", 90);
      return { segments: [], fragments: [{ text: "private excerpt" }] };
    },
  );
  await worker.tick();
  assert.equal(store.get(job.id).status, "completed");
  assert.equal(
    store
      .logs(job.id)
      .some((entry) => entry.message.includes("private excerpt")),
    false,
  );
  const failed = store.enqueue(
    validateRequest({ ...request, requestKey: "second" }),
  ).job;
  worker.processor = async () => {
    throw new Error("Missing model");
  };
  await worker.tick();
  assert.equal(store.get(failed.id).status, "failed");
  assert.equal(store.get(failed.id).error, "Missing model");
});

test("seven-day transcript purge preserves markers and removes old logs", (t) => {
  const { store, filename } = fixture(t);
  const job = store.enqueue(validateRequest(request)).job;
  store.finish(job.id, {
    segments: [{ title: "Chapter" }],
    fragments: [{ text: "expire me" }],
    diagnostics: {
      classifierAssessments: [
        {
          reason: "expire this too",
          response: {
            model: "jev",
            answers: { classification: { choice: "advertisement" } },
          },
          error: { message: "expired provider detail" },
        },
      ],
    },
  });
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(filename);
  db.prepare("UPDATE podcast_jobs SET expires_at='2000-01-01' WHERE id=?").run(
    job.id,
  );
  db.close();
  store.prune();
  assert.deepEqual(store.get(job.id).result.fragments, []);
  assert.deepEqual(
    store.get(job.id).result.diagnostics.classifierAssessments,
    [],
  );
  assert.equal(store.get(job.id).result.segments.length, 1);
  assert.equal(store.get(job.id).result.transcriptExpired, true);
  assert.doesNotMatch(
    JSON.stringify(store.get(job.id).result),
    /expire this too|expired provider detail|classification/,
  );
});

test("local HTTP API exposes independent job status and diagnostic logs", async (t) => {
  const express = require("express");
  const { podcastRouter } = require("../src/podcast-routes");
  const { store } = fixture(t);
  const app = express();
  app.use(express.json());
  app.use(
    "/api/podcasts",
    podcastRouter(store, {}, { info() {}, tail: () => ["podcast-only log"] }),
  );
  app.use((error, _req, res, next) => {
    void next;
    res.status(error.statusCode || 500).json({ error: error.message });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/podcasts`;
  const submitted = await fetch(`${url}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  assert.equal(submitted.status, 202);
  const { job } = await submitted.json();
  const polled = await (await fetch(`${url}/jobs/${job.id}`)).json();
  assert.equal(polled.job.status, "queued");
  assert.deepEqual((await (await fetch(`${url}/logs`)).json()).lines, [
    "podcast-only log",
  ]);
  assert.equal((await fetch(`${url}/jobs/missing`)).status, 404);
});

test("analysis pipeline hashes the fetched bytes, maps English snippets and cleans owned temporary files", async (t) => {
  const { analyse } = require("../src/podcast-analysis");
  const { createHash } = require("node:crypto");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "podcast-pipeline-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const model = path.join(directory, "tiny.en.bin");
  fs.writeFileSync(model, "test model placeholder");
  const retained = [];
  const config = {
    retainAudio: async (_request, input, fingerprint) => {
      retained.push({ bytes: fs.readFileSync(input), fingerprint });
    },
    podcastWhisperModel: model,
    podcastCacheDir: path.join(directory, "cache"),
    podcastMaxBytes: 1000,
    ffprobePath: "probe",
    ffmpegPath: "ffmpeg",
    podcastWhisperPath: "whisper",
    podcastSampleSeconds: 60,
  };
  const audio = Buffer.from("test audio bytes");
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(audio);
  t.after(() => {
    global.fetch = originalFetch;
  });
  const decoded = [];
  let acousticStatsAvailable = false;
  let rejectAcousticFilter = false;
  const scans = [];
  const execute = async (binary, args, _signal, options) => {
    if (args.includes("-af")) {
      const filter = args[args.indexOf("-af") + 1];
      scans.push(filter);
      if (filter.includes("aspectralstats")) {
        if (rejectAcousticFilter) throw new Error("unsupported filter");
        if (acousticStatsAvailable) {
          for (const [name, key, value] of [
            [
              "rms",
              "lavfi.astats.Overall.RMS_level",
              (index) => (index < 20 ? -30 : -16),
            ],
            [
              "centroid",
              "lavfi.aspectralstats.1.centroid",
              (index) => (index < 20 ? 0.1 : 0.4),
            ],
            ["flux", "lavfi.aspectralstats.1.flux", () => 0.01],
          ]) {
            fs.writeFileSync(
              path.join(options.cwd, `acoustic-${name}.txt`),
              Array.from(
                { length: 40 },
                (_, index) =>
                  `frame:${index} pts:${index * 4096} pts_time:${index * 0.256}\n${key}=${value(index)}`,
              ).join("\n"),
            );
          }
        }
      }
    }
    if (args.includes("-ss"))
      decoded.push(Number(args[args.indexOf("-ss") + 1]) * 1000);
    if (binary === "probe")
      return {
        stdout: JSON.stringify({
          format: { duration: "90" },
          chapters: [
            { start_time: 0, end_time: 90, tags: { title: "Opening" } },
          ],
        }),
        stderr: "",
      };
    if (binary === "whisper") {
      assert.equal(args[args.indexOf("-l") + 1], "en");
      assert.ok(args.includes("-ojf"));
      assert.ok(!args.includes("-nt"));
      fs.writeFileSync(
        `${args[args.indexOf("-of") + 1]}.json`,
        JSON.stringify({
          transcription: [
            {
              offsets: { from: 1000, to: 3000 },
              text: "Brought to you by our sponsor.",
            },
          ],
        }),
      );
    }
    return { stdout: "", stderr: "silence_end: 25.5" };
  };
  const result = await analyse(
    validateRequest(request),
    config,
    new AbortController().signal,
    () => {},
    execute,
  );
  assert.equal(
    result.fingerprint.sha256,
    createHash("sha256").update(audio).digest("hex"),
  );
  assert.equal(result.segments[0].source, "embedded");
  assert.equal(retained.length, 1);
  assert.deepEqual(retained[0].bytes, audio);
  assert.deepEqual(retained[0].fingerprint, result.fingerprint);
  assert.ok(
    result.fragments.every((fragment) =>
      decoded.includes(fragment.startMs - 1000),
    ),
  );
  assert.ok(
    result.diagnostics.sampleWindows.some((window) => window.endMs === 90000),
  );
  assert.deepEqual(fs.readdirSync(config.podcastCacheDir), []);
  assert.equal(fs.readFileSync(model, "utf8"), "test model placeholder");
  assert.equal(result.diagnostics.boundaryDetection.volumeToneAvailable, false);
  acousticStatsAvailable = true;
  const progress = [];
  const acousticResult = await analyse(
    validateRequest(request),
    config,
    new AbortController().signal,
    (_stage, percentage) => progress.push(percentage),
    execute,
  );
  assert.equal(
    acousticResult.diagnostics.boundaryDetection.volumeToneAvailable,
    true,
  );
  assert.ok(
    acousticResult.diagnostics.acousticBoundaryCandidates.some(
      (candidate) =>
        candidate.types.includes("volume") && candidate.types.includes("tone"),
    ),
  );
  assert.ok(
    progress.every(
      (value, index) => index === 0 || value >= progress[index - 1],
    ),
  );
  assert.deepEqual(fs.readdirSync(config.podcastCacheDir), []);
  acousticStatsAvailable = false;
  rejectAcousticFilter = true;
  const pauseResult = await analyse(
    validateRequest(request),
    config,
    new AbortController().signal,
    () => {},
    execute,
  );
  assert.equal(
    pauseResult.diagnostics.boundaryDetection.volumeToneAvailable,
    false,
  );
  assert.ok(
    pauseResult.diagnostics.warnings.some((warning) =>
      warning.includes("pauses only"),
    ),
  );
  assert.ok(scans.some((filter) => filter.startsWith("silencedetect=")));
  assert.deepEqual(fs.readdirSync(config.podcastCacheDir), []);
  rejectAcousticFilter = false;
  let jevRequests = 0;
  global.fetch = async (url) => {
    if (url !== request.enclosureUrl) jevRequests++;
    return url === request.enclosureUrl
      ? new Response(audio)
      : Response.json({
          model: "typesafe-jev-1.13.0",
          answers: {
            classification: {
              type: "choice",
              choice: "advertisement",
              confidence: 0.9,
              probabilities: {
                advertisement: 0.85,
                promotion: 0.05,
                not_ad: 0.05,
                uncertain: 0.05,
              },
            },
          },
          usage: { input_tokens: 100, output_tokens: 0 },
        });
  };
  const jevConfig = {
    ...config,
    classifier: "jev",
    podcastJevUrl: "https://inference.do-ai.run/v1/systemone",
    podcastJevModel: "typesafe-jev-1.13.0",
    podcastJevKey: "test-key",
  };
  const classified = await analyse(
    validateRequest(request),
    jevConfig,
    new AbortController().signal,
    () => {},
    execute,
  );
  assert.equal(classified.provider, "jev");
  assert.equal(classified.classifierModel, jevConfig.podcastJevModel);
  assert.equal(classified.diagnostics.classifierUsage.requests, jevRequests);
  assert.equal(
    classified.diagnostics.classifierUsage.inputTokens,
    classified.diagnostics.classifierUsage.requests * 100,
  );
  const candidates = classified.segments.filter((s) => s.source === "jev");
  assert.ok(candidates.length > 0);
  assert.ok(
    candidates.every((s) =>
      classified.fragments.some(
        (f) => f.startMs === s.startMs && f.endMs === s.endMs,
      ),
    ),
  );
  assert.deepEqual(fs.readdirSync(config.podcastCacheDir), []);
  const requests = [];
  const { defaultDetectionSettings } = require("../src/detection-settings");
  const captured = {
    ...defaultDetectionSettings(config),
    audioSensitivity: "custom",
    silenceThresholdDb: -29,
    minimumSilenceSeconds: 0.25,
    sampleBudgetSeconds: 30,
    jevSensitivity: "custom",
    advertConfidence: 0.95,
    promotionConfidence: 0.7,
  };
  let scanFilter;
  const tuned = await analyse(
    { ...validateRequest(request), detectionSettings: captured },
    jevConfig,
    new AbortController().signal,
    () => {},
    async (binary, args, signal) => {
      if (args.includes("-af")) scanFilter = args[args.indexOf("-af") + 1];
      return execute(binary, args, signal);
    },
  );
  assert.ok(scanFilter.includes("silencedetect=n=-29dB:d=0.25"));
  assert.ok(scanFilter.includes("aspectralstats"));
  assert.deepEqual(tuned.diagnostics.detectionSettings, captured);
  assert.equal(
    tuned.diagnostics.effectiveSettings.audio.sampleBudgetSeconds,
    30,
  );
  assert.equal(tuned.diagnostics.minimumAdvertConfidence, 0.95);
  assert.equal(tuned.segments.filter((s) => s.source === "jev").length, 0);
  assert.equal(
    tuned.diagnostics.classifierAssessments[0].verdict,
    "advertisement",
  );
  assert.equal(
    tuned.diagnostics.classifierAssessments[0].markerDecision.accepted,
    false,
  );
  global.fetch = async (url) => {
    requests.push(url);
    return url === request.enclosureUrl
      ? new Response(audio)
      : new Response("Provider unavailable", { status: 401 });
  };
  const fallback = await analyse(
    validateRequest(request),
    {
      ...config,
      classifier: "jev",
      podcastJevUrl: "https://inference.do-ai.run/v1/systemone",
      podcastJevModel: "typesafe-jev-1.13.0",
      podcastJevKey: "test-key",
    },
    new AbortController().signal,
    () => {},
    execute,
  );
  assert.equal(fallback.provider, "rules");
  assert.ok(
    fallback.diagnostics.warnings.some((warning) =>
      warning.includes("Jev classification failed for every excerpt"),
    ),
  );
  assert.ok(
    requests.every(
      (url) =>
        url === request.enclosureUrl ||
        url === "https://inference.do-ai.run/v1/systemone",
    ),
  );
  await assert.rejects(
    analyse(
      validateRequest(request),
      config,
      new AbortController().signal,
      () => {},
      async () => {
        throw new Error("probe failed");
      },
    ),
    /probe failed/,
  );
  assert.deepEqual(fs.readdirSync(config.podcastCacheDir), []);
});
