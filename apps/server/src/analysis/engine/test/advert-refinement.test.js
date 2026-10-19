"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyAndRefine } = require("../src/advert-refinement");
const { classifyRules, validateSegments } = require("../src/podcast-analysis");

const unit = (startMs, endMs, text) => ({ startMs, endMs, text });
const speech = [
  unit(0, 5000, "Welcome to our programme about the night sky."),
  unit(6000, 14000, "Our sponsor has an offer for all our listeners."),
  unit(
    15000,
    29000,
    "Purchase from our sponsor today and save with this offer.",
  ),
  unit(30000, 38000, "Use this discount code before the offer ends."),
  unit(40000, 42000, "Back to today's interview about astronomy."),
  unit(43000, 54000, "Our guest studies the night sky."),
  unit(55000, 70000, "The scientist explains how stars are formed."),
];
const answer = (choice) =>
  Response.json({
    model: "test-jev",
    answers: {
      classification: {
        type: "choice",
        choice,
        confidence: 0.95,
        probabilities: Object.fromEntries(
          ["advertisement", "promotion", "not_ad", "uncertain"].map((label) => [
            label,
            choice === label ? 0.85 : 0.05,
          ]),
        ),
      },
    },
    usage: { input_tokens: 10, output_tokens: 0 },
  });

async function fixture(overrides = {}) {
  const windows = [{ startMs: 0, endMs: 30000 }];
  const classifiedText = [];
  const transcribed = [];
  const warnings = [];
  const result = await classifyAndRefine({
    units: speech.filter((fragment) => fragment.endMs <= 30000),
    boundaries: [
      { timeMs: 5500, types: ["silence"], score: 1 },
      { timeMs: 39000, types: ["volume", "tone"], score: 0.95 },
    ],
    windows,
    durationMs: 90000,
    request: { title: "Test", phrases: [], llmPrompt: "" },
    config: {
      classifier: "jev",
      podcastJevKey: "test-key",
      podcastJevUrl: "https://example.test/classify",
      podcastJevModel: "test-jev",
    },
    signal: new AbortController().signal,
    progress() {},
    validate: validateSegments,
    classifyRules,
    policy: {
      advertConfidence: 0.55,
      promotionConfidence: 0.55,
      minimumLabelProbability: 0,
      includePromotions: true,
    },
    sampleBudgetSeconds: 60,
    audio: { minimumExcerptSeconds: 5 },
    warnings,
    transcribe: async (window) => {
      transcribed.push(window);
      return speech.filter(
        (fragment) =>
          fragment.startMs >= window.startMs && fragment.endMs <= window.endMs,
      );
    },
    fetcher: async (_url, options) => {
      const state = JSON.parse(JSON.parse(options.body).state);
      classifiedText.push(state);
      return answer(
        /sponsor|offer|discount|purchase/i.test(state.excerpt.text)
          ? "advertisement"
          : "not_ad",
      );
    },
    ...overrides,
  });
  return { result, windows, classifiedText, transcribed, warnings };
}

test("extends an advert beyond the original sample and stops before editorial speech", async () => {
  const { result, transcribed, classifiedText } = await fixture();
  assert.equal(result.provider, "jev");
  assert.ok(transcribed.some((window) => window.endMs > 38000));
  assert.equal(result.segments.length, 1);
  assert.ok(
    result.segments[0].startMs >= 5000 && result.segments[0].startMs <= 6000,
  );
  assert.ok(
    result.segments[0].endMs >= 38000 && result.segments[0].endMs < 40000,
  );
  assert.ok(
    result.fragments.some((fragment) => fragment.text.includes("astronomy")),
  );
  const editorial = classifiedText.find(
    (state) => state.excerpt.startMs === 40000,
  );
  assert.ok(
    editorial.adjacentContext.before.includes("discount"),
    JSON.stringify(classifiedText),
  );
  assert.ok(!editorial.excerpt.text.includes("discount"));
  assert.ok(
    result.diagnostics.refinement.usedSeconds <=
      result.diagnostics.refinement.budgetSeconds,
  );
  assert.ok(result.diagnostics.refinement.attempts <= 8);
  assert.equal(
    result.diagnostics.classifierUsage.requests,
    classifiedText.length,
  );
});

test("sound changes alone do not cause extra sampling or advert markers", async () => {
  const { result, transcribed } = await fixture({
    fetcher: async () => answer("not_ad"),
  });
  assert.deepEqual(result.segments, []);
  assert.deepEqual(transcribed, []);
  assert.equal(result.diagnostics.refinement.usedSeconds, 0);
});

test("refinement transcription failures retain earlier evidence and stay within the work budget", async () => {
  const { result, warnings } = await fixture({
    transcribe: async () => {
      throw new Error("recogniser unavailable");
    },
  });
  assert.ok(result.segments.some((segment) => segment.endMs >= 29000));
  assert.ok(result.segments.every((segment) => segment.endMs <= 29000));
  assert.ok(
    warnings.some((warning) => warning.includes("could not be transcribed")),
  );
  assert.ok(result.diagnostics.refinement.usedSeconds <= 60);
});

test("provider failure during refinement does not erase or enlarge an earlier advert decision", async () => {
  let calls = 0;
  const { result } = await fixture({
    fetcher: async (_url, options) => {
      const { excerpt } = JSON.parse(JSON.parse(options.body).state);
      if (++calls > 3)
        return Response.json({ message: "Forbidden" }, { status: 403 });
      return answer(
        excerpt.text.includes("sponsor") ? "advertisement" : "not_ad",
      );
    },
  });
  assert.ok(
    result.segments.some(
      (segment) => segment.startMs <= 6000 && segment.endMs >= 29000,
    ),
    JSON.stringify(result),
  );
  assert.ok(result.segments.every((segment) => segment.endMs <= 29000));
  assert.ok(calls <= 4);
});

test("aborting refinement cancels the job instead of saving partial fallback markers", async () => {
  const controller = new AbortController();
  await assert.rejects(
    fixture({
      signal: controller.signal,
      transcribe: async () => {
        controller.abort();
        controller.signal.throwIfAborted();
      },
    }),
    /abort/i,
  );
});

test("a successful editorial correction does not erase a separate failed part of an earlier advert", async () => {
  const { result } = await fixture({
    units: [
      unit(0, 5000, "Welcome to our programme about the night sky."),
      unit(
        6000,
        16000,
        "Our sponsor offers excellent savings to all our listeners",
      ),
      unit(16000, 22000, "good deals"),
      unit(22000, 29000, "for listeners today."),
    ],
    transcribe: async () => [
      unit(16000, 22000, "Editorial now."),
      unit(
        22000,
        29000,
        "Still our sponsor with a special offer for listeners.",
      ),
    ],
    fetcher: async (_url, options) => {
      const { excerpt } = JSON.parse(JSON.parse(options.body).state);
      if (excerpt.text.includes("Still"))
        return Response.json({ message: "Forbidden" }, { status: 403 });
      return answer(
        excerpt.text.includes("Editorial") || !excerpt.text.includes("sponsor")
          ? "not_ad"
          : "advertisement",
      );
    },
  });
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].startMs, 22000, JSON.stringify(result));
  assert.equal(result.segments[0].endMs, 29000);
});

test("word-level sound changes keep a complete commercial pitch together for Jev", async () => {
  const text =
    "Our sponsor offers a discount on your first purchase with this promo code today for all listeners to the programme".split(
      " ",
    );
  const units = text.map((word, index) =>
    unit(index * 500, index * 500 + 400, word),
  );
  const seen = [];
  const { result } = await fixture({
    units,
    audio: { minimumExcerptSeconds: 10, maximumExcerptSeconds: 30 },
    boundaries: units.map((word) => ({
      timeMs: word.startMs,
      score: 0.9,
      types: ["tone"],
    })),
    transcribe: async () => [],
    fetcher: async (_url, options) => {
      const { excerpt } = JSON.parse(JSON.parse(options.body).state);
      seen.push(excerpt.text);
      return answer(
        excerpt.text.includes("sponsor") && excerpt.text.includes("promo code")
          ? "advertisement"
          : "not_ad",
      );
    },
  });
  assert.deepEqual(seen, [text.join(" ")]);
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].startMs, 0);
  assert.equal(result.segments[0].endMs, units.at(-1).endMs);
});
