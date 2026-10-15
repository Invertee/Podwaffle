"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  defaultDetectionSettings,
  validateDetectionSettings,
  resolveDetectionSettings,
  applyJevPolicy,
} = require("../src/detection-settings");
const { createPodcastStore } = require("../src/podcast-store");
const { createApp } = require("../src/server");
const { loadConfig } = require("../src/config");
const { classifyJev } = require("../src/classifier");

test("independent audio and Jev presets preserve episode sensitivity by default", () => {
  const defaults = defaultDetectionSettings({ podcastSampleSeconds: 300 });
  const original = resolveDetectionSettings(defaults, "low");
  assert.deepEqual(original.audio, {
    silenceThresholdDb: -40,
    minimumSilenceSeconds: 0.8,
    sampleBudgetSeconds: 300,
  });
  assert.equal(original.jev.advertConfidence, 0.75);
  const split = resolveDetectionSettings(
    {
      ...defaults,
      audioSensitivity: "high",
      jevSensitivity: "custom",
      advertConfidence: 0.93,
      promotionConfidence: 0.81,
    },
    "low",
  );
  assert.equal(split.audio.silenceThresholdDb, -30);
  assert.equal(split.audio.minimumSilenceSeconds, 0.35);
  assert.equal(split.jev.advertConfidence, 0.93);
  assert.equal(split.jev.promotionConfidence, 0.81);
  assert.equal(
    resolveDetectionSettings(
      { ...defaults, jevSensitivity: "balanced" },
      "high",
    ).jev.advertConfidence,
    0.55,
  );
});

test("settings reject missing, unknown, non-numeric and out-of-range fields", () => {
  const defaults = defaultDetectionSettings();
  for (const input of [
    null,
    [],
    {},
    { ...defaults, audioSensitivity: "bad" },
    { ...defaults, jevSensitivity: "bad" },
    { ...defaults, sampleBudgetSeconds: 29 },
    { ...defaults, sampleBudgetSeconds: 31.5 },
    { ...defaults, silenceThresholdDb: -81 },
    { ...defaults, minimumSilenceSeconds: 0 },
    { ...defaults, advertConfidence: 1.01 },
    { ...defaults, promotionConfidence: "0.6" },
    { ...defaults, minimumLabelProbability: NaN },
    { ...defaults, includePromotions: "true" },
    { ...defaults, podcastJevKey: "must-not-be-accepted" },
  ]) {
    assert.throws(() => validateDetectionSettings(input), { statusCode: 400 });
  }
  assert.deepEqual(validateDetectionSettings(defaults), defaults);
});

test("Jev filtering applies separate inclusive confidence and probability thresholds without changing decisions", () => {
  const assessments = [
    {
      startMs: 0,
      endMs: 1000,
      verdict: "advertisement",
      confidence: 0.8,
      probabilities: { advertisement: 0.7 },
    },
    {
      startMs: 1000,
      endMs: 2000,
      verdict: "promotion",
      confidence: 0.6,
      probabilities: { promotion: 0.8 },
    },
    {
      startMs: 2000,
      endMs: 3000,
      verdict: "advertisement",
      confidence: 0.95,
      probabilities: { advertisement: 0.65 },
    },
    { startMs: 3000, endMs: 4000, verdict: "uncertain", confidence: 0.9 },
  ];
  const result = {
    assessments,
    segments: assessments.slice(0, 3).map((a) => ({
      startMs: a.startMs,
      endMs: a.endMs,
      kind: a.verdict,
      confidence: a.confidence,
    })),
  };
  const policy = {
    advertConfidence: 0.8,
    promotionConfidence: 0.6,
    minimumLabelProbability: 0.7,
    includePromotions: true,
  };
  const filtered = applyJevPolicy(result, policy);
  assert.equal(filtered.segments.length, 2);
  assert.deepEqual(
    filtered.assessments.map((a) => a.verdict),
    assessments.map((a) => a.verdict),
  );
  assert.match(filtered.assessments[2].markerDecision.reason, /probability/);
  assert.equal(assessments[0].markerDecision, undefined);
  const disabled = applyJevPolicy(result, {
    ...policy,
    includePromotions: false,
  });
  assert.equal(disabled.segments.length, 1);
  assert.match(disabled.assessments[1].markerDecision.reason, /disabled/);
  const strict = applyJevPolicy(result, {
    ...policy,
    promotionConfidence: 0.61,
  });
  assert.match(
    strict.assessments[1].markerDecision.reason,
    /promotion threshold/,
  );
});

test("saved settings survive reopening and request-key deduplication retains the first job snapshot", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "detection-settings-"),
  );
  const filename = path.join(directory, "jobs.sqlite");
  let store = createPodcastStore(filename);
  t.after(async () => {
    store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const defaults = defaultDetectionSettings();
  const request = { requestKey: "same-input", title: "Episode" };
  const first = store.enqueue(request, defaults).job;
  const changed = {
    ...defaults,
    advertConfidence: 0.95,
    jevSensitivity: "custom",
  };
  store.saveDetectionSettings(changed);
  store.close();
  store = createPodcastStore(filename);
  assert.deepEqual(store.detectionSettings(defaults), changed);
  const repeated = store.enqueue(request, changed);
  assert.equal(repeated.deduplicated, true);
  assert.equal(repeated.job.id, first.id);
  assert.equal(repeated.job.request.detectionSettings.advertConfidence, 0.55);
  assert.equal(
    store.enqueue(
      { ...request, requestKey: "new-input" },
      store.detectionSettings(defaults),
    ).job.request.detectionSettings.advertConfidence,
    0.95,
  );
  assert.throws(
    () => store.enqueue({ ...request, title: "Different" }, changed),
    { statusCode: 409 },
  );
  store.fail(first.id, "test");
  store.retry(first.id);
  assert.equal(
    store.get(first.id).request.detectionSettings.advertConfidence,
    0.55,
  );
});

test("settings HTTP API persists safe values and applies them to jobs and transcript tests", async (t) => {
  const store = createPodcastStore(":memory:");
  const config = loadConfig(
    {},
    { classifier: "jev", jev_api_key: "private-config-key" },
  );
  const server = createApp(
    store,
    config,
    { info() {}, error() {}, tail: () => [] },
    { status: { ready: false } },
    {
      classify: (...args) =>
        classifyJev(...args, async () =>
          Response.json({
            model: "test-jev",
            answers: {
              classification: {
                type: "choice",
                choice: "advertisement",
                confidence: 0.8,
                probabilities: {
                  advertisement: 0.7,
                  promotion: 0.1,
                  not_ad: 0.1,
                  uncertain: 0.1,
                },
              },
            },
          }),
        ),
    },
  ).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const url = `http://127.0.0.1:${server.address().port}/api/podcasts`;
  const send = (route, body, method = "POST") =>
    fetch(`${url}/${route}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const initial = await (await fetch(`${url}/settings`)).json();
  assert.equal(initial.settings.audioSensitivity, "episode");
  const settings = {
    ...initial.settings,
    audioSensitivity: "custom",
    silenceThresholdDb: -28,
    minimumSilenceSeconds: 0.25,
    sampleBudgetSeconds: 120,
    jevSensitivity: "custom",
    advertConfidence: 0.9,
    promotionConfidence: 0.7,
    minimumLabelProbability: 0.75,
  };
  assert.equal((await send("settings", { settings }, "PUT")).status, 200);
  const saved = await (await fetch(`${url}/settings`)).json();
  assert.deepEqual(saved.settings, settings);
  assert.doesNotMatch(
    JSON.stringify(saved),
    /private-config-key|podcastJevKey/,
  );
  assert.equal(
    (
      await send(
        "settings",
        { settings: { ...settings, advertConfidence: 2 } },
        "PUT",
      )
    ).status,
    400,
  );
  assert.deepEqual(
    (await (await fetch(`${url}/settings`)).json()).settings,
    settings,
  );
  const body = {
    requestKey: "queued",
    episodeId: "queued",
    title: "Queued episode",
    enclosureUrl: "https://example.invalid/audio.mp3",
    sensitivity: "high",
    detectionSettings: { advertConfidence: 0 },
  };
  const queued = await (await send("jobs", body)).json();
  assert.deepEqual(queued.job.request.detectionSettings, settings);
  await send("settings", { settings: initial.settings }, "PUT");
  const duplicate = await (await send("jobs", body)).json();
  assert.equal(duplicate.deduplicated, true);
  assert.deepEqual(duplicate.job.request.detectionSettings, settings);
  const transcript = {
    fragments: [{ startMs: 0, endMs: 1000, text: "Our sponsor" }],
    sensitivity: "high",
  };
  const original = await (await send("classify", transcript)).json();
  assert.equal(original.segments.length, 1);
  await send("settings", { settings }, "PUT");
  const filtered = await (await send("classify", transcript)).json();
  assert.equal(filtered.minimumAdvertConfidence, 0.9);
  assert.equal(filtered.minimumPromotionConfidence, 0.7);
  assert.equal(filtered.segments.length, 0);
  assert.equal(filtered.assessments[0].verdict, "advertisement");
  assert.match(filtered.assessments[0].markerDecision.reason, /confidence/);
  assert.equal(
    (await (await fetch(`${url}/status`)).json()).sampleBudgetSeconds,
    120,
  );
});
