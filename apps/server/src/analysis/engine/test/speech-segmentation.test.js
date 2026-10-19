"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseWhisper } = require("../src/podcast-analysis");
const {
  buildExcerpts,
  alignSampleWindows,
  refinementWindows,
  replaceSpeech,
  refineAndMergeMarkers,
} = require("../src/speech-segmentation");
const unit = (startMs, endMs, text) => ({ startMs, endMs, text });

test("preserves complete word timing, joins subwords and ignores special tokens", () => {
  const parsed = parseWhisper(
    {
      transcription: [
        {
          text: "Hello waffle.",
          offsets: { from: 100, to: 2000 },
          tokens: [
            { text: "[_BEG_]", offsets: { from: 100, to: 200 } },
            { text: " Hello", offsets: { from: 100, to: 500 } },
            { text: " waff", offsets: { from: 600, to: 900 } },
            { text: "le.", offsets: { from: 900, to: 1200 } },
          ],
        },
      ],
    },
    { startMs: 30000, endMs: 60000 },
  );
  assert.deepEqual(parsed[0].words, [
    unit(30100, 30500, "Hello"),
    unit(30600, 31200, "waffle."),
  ]);
});

test("incomplete token timing falls back to the full speech segment rather than dropping words", () => {
  const parsed = parseWhisper(
    {
      transcription: [
        {
          text: "Hello waffle.",
          offsets: { from: 100, to: 2000 },
          tokens: [{ text: " Hello", offsets: { from: 100, to: 500 } }],
        },
      ],
    },
    { startMs: 30000, endMs: 60000 },
  );
  assert.equal(parsed[0].words, undefined);
  assert.equal(parsed[0].text, "Hello waffle.");
});

test("keeps punctuation without timestamps so sentence endings remain usable", () => {
  const parsed = parseWhisper(
    {
      transcription: [
        {
          text: "Hello!",
          offsets: { from: 0, to: 1000 },
          tokens: [
            { text: " Hello", offsets: { from: 0, to: 900 } },
            { text: "!", offsets: { from: 900, to: 900 } },
          ],
        },
      ],
    },
    { startMs: 0, endMs: 1000 },
  );
  assert.deepEqual(parsed[0].words, [unit(0, 900, "Hello!")]);
});

test("makes variable excerpts at pauses and sound changes with separately bounded context", () => {
  const excerpts = buildExcerpts(
    [
      unit(0, 2000, "Welcome."),
      unit(3000, 7000, "Our sponsor offers savings."),
      unit(7100, 12000, "Use this code."),
      unit(13000, 17000, "Back to the interview."),
      unit(60000, 65000, "Later editorial."),
    ],
    [{ timeMs: 7050, score: 0.9, types: ["tone"] }],
  );
  assert.deepEqual(
    excerpts.map((excerpt) => [excerpt.startMs, excerpt.endMs]),
    [
      [0, 2000],
      [3000, 7000],
      [7100, 12000],
      [13000, 17000],
      [60000, 65000],
    ],
  );
  assert.equal(excerpts[1].contextBefore, "Welcome.");
  assert.equal(excerpts[1].contextAfter, "Use this code.");
  assert.equal(excerpts.at(-1).contextBefore, "");
});

test("aligns adjacent audio samples without creating coverage gaps or increasing the budget", () => {
  const windows = alignSampleWindows(
    [
      { startMs: 0, endMs: 30000 },
      { startMs: 30000, endMs: 60000 },
    ],
    [{ timeMs: 32500, types: ["volume"], score: 0.8 }],
  );
  assert.deepEqual(windows, [
    { startMs: 0, endMs: 32500 },
    { startMs: 32500, endMs: 60000 },
  ]);
  assert.equal(
    windows.reduce((total, window) => total + window.endMs - window.startMs, 0),
    60000,
  );
});

test("a sound change can split continuous speech without requiring silence", () => {
  const excerpts = buildExcerpts(
    [unit(0, 1000, "Welcome"), unit(1000, 2000, "sponsor")],
    [{ timeMs: 1000, score: 0.9, types: ["volume"] }],
  );
  assert.equal(excerpts.length, 2);
  assert.equal(excerpts[0].endMs, excerpts[1].startMs);
});

test("bounds extra sampling and does not keep retranscribing the same edges", () => {
  const segments = Array.from({ length: 20 }, (_, index) => ({
    startMs: index * 60000,
    endMs: index * 60000 + 20000,
  }));
  const first = refinementWindows(segments, 1800000, [], 60000);
  assert.equal(first.length, 2);
  assert.ok(
    first.every((window) => window.startMs >= 0 && window.endMs <= 1800000),
  );
  assert.equal(refinementWindows(segments, 1800000, [], 240000).length, 8);
  assert.ok(
    refinementWindows(segments, 1800000, first, 60000).every(
      (window) =>
        !first.some((previous) => previous.startMs === window.startMs),
    ),
  );
  assert.deepEqual(
    refinementWindows([{ startMs: 0, endMs: 1000 }], 5000, [], 5000),
    [{ startMs: 0, endMs: 5000 }],
  );
});

test("a silent refinement keeps existing evidence and overlapping words are deduplicated", () => {
  const original = [unit(1000, 1500, "hello"), unit(1800, 2400, "waffle")];
  assert.equal(
    replaceSpeech(original, [], { startMs: 0, endMs: 5000 }, 5000),
    original,
  );
  assert.deepEqual(
    replaceSpeech(
      original,
      [{ ...unit(0, 3000, "hello waffle"), words: original }],
      { startMs: 0, endMs: 5000 },
      5000,
    ),
    original,
  );
});

test("merges consecutive advert decisions but never skips known editorial speech or unsampled gaps", () => {
  const marker = (startMs, endMs) => ({
    startMs,
    endMs,
    kind: "advertisement",
    source: "jev",
    confidence: 0.9,
  });
  assert.deepEqual(
    refineAndMergeMarkers(
      [marker(1000, 5000), marker(5500, 9000)],
      [],
      [],
      [],
    ).map((segment) => [segment.startMs, segment.endMs]),
    [[1000, 9000]],
  );
  assert.equal(
    refineAndMergeMarkers(
      [marker(1000, 5000), marker(5500, 9000)],
      [unit(4900, 5400, "News")],
      [],
      [],
    ).length,
    2,
  );
  assert.equal(
    refineAndMergeMarkers(
      [marker(1000, 5000), marker(15000, 19000)],
      [],
      [],
      [],
    ).length,
    2,
  );
});

test("snaps only within speech-free edge gaps and never across an editorial word", () => {
  const marker = {
    startMs: 1000,
    endMs: 5000,
    kind: "advertisement",
    source: "jev",
    confidence: 0.9,
  };
  const boundaries = [
    { timeMs: 800, types: ["silence"], score: 1 },
    { timeMs: 5500, types: ["tone"], score: 0.8 },
  ];
  const [refined] = refineAndMergeMarkers(
    [marker],
    [unit(5100, 5400, "Editorial")],
    boundaries,
    [],
  );
  assert.equal(refined.startMs, 800);
  assert.equal(refined.endMs, 5000);
});
