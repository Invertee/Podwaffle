"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildInspection,
  filterRows,
  unionDuration,
  formatTime,
} = require("../public/inspection");
const fragment = (startMs, endMs, text) => ({ startMs, endMs, text });
const decision = (startMs, endMs, verdict, confidence = 0.9) => ({
  startMs,
  endMs,
  verdict,
  confidence,
  status: "completed",
  reason: "Selected by Jev",
});

test("links shuffled assessments by both boundaries and keeps below-threshold candidates inspectable", () => {
  const result = buildInspection({
    durationMs: 120000,
    fragments: [
      fragment(0, 5000, "Sponsor"),
      fragment(0, 10000, "Another sample"),
      fragment(60000, 65000, "Editorial"),
    ],
    segments: [
      { startMs: 0, endMs: 5000, kind: "advertisement", source: "jev" },
    ],
    diagnostics: {
      classifierAssessments: [
        decision(60000, 65000, "not_ad"),
        decision(0, 10000, "promotion", 0.4),
        decision(0, 5000, "advertisement"),
      ],
      minimumAdvertConfidence: 0.55,
    },
  });
  assert.deepEqual(
    result.rows.map((row) => row.verdict),
    ["advertisement", "promotion", "not_ad"],
  );
  assert.equal(result.rows[0].belowThreshold, false);
  assert.equal(result.rows[1].belowThreshold, true); // An overlapping marker is a separate decision.
  assert.equal(result.rows[2].suspected, false);
  assert.equal(result.advertMs, 5000);
});

test("low-confidence hits, successful uncertainty and failed or skipped requests stay distinct", () => {
  const rows = buildInspection({
    fragments: Array.from({ length: 5 }, (_, i) =>
      fragment(i * 10000, i * 10000 + 5000, `Text ${i}`),
    ),
    diagnostics: {
      classifierAssessments: [
        decision(0, 5000, "promotion", 0.4),
        decision(10000, 15000, "uncertain", 0.6),
        { ...decision(20000, 25000, "uncertain", 0), status: "failed" },
        { ...decision(30000, 35000, "uncertain", 0), status: "skipped" },
        {
          startMs: 40000,
          endMs: 45000,
          verdict: "uncertain",
          confidence: 0,
          reason: "Legacy failure",
        },
      ],
    },
  }).rows;
  assert.equal(rows[0].belowThreshold, true);
  assert.equal(filterRows(rows, "", "uncertain").length, 1);
  assert.equal(filterRows(rows, "", "failed").length, 3);
  assert.equal(filterRows(rows, "", "suspected").length, 1);
  assert.deepEqual(filterRows(rows, " TEXT 1 ", "all"), [rows[1]]);
  assert.equal(filterRows(rows, "absent", "all").length, 0);
});

test("overlapping samples and advert markers do not double-count episode coverage", () => {
  const ranges = [
    { startMs: 0, endMs: 30000 },
    { startMs: 10000, endMs: 20000 },
    { startMs: 15000, endMs: 45000 },
    { startMs: 60000, endMs: 90000 },
  ];
  const result = buildInspection({
    durationMs: 120000,
    diagnostics: { sampleWindows: ranges },
    segments: ranges.map((r) => ({ ...r, kind: "advertisement" })),
  });
  assert.equal(result.sampledMs, 75000);
  assert.equal(result.advertMs, 75000);
  assert.equal(unionDuration([{ startMs: 4, endMs: 2 }, ...ranges]), 75000);
});

test("expired results retain marker timelines; rule fallback is inspectable without pretending to be Jev", () => {
  const marker = {
    startMs: 1000,
    endMs: 4000,
    kind: "advertisement",
    source: "rules",
  };
  const expired = buildInspection({
    durationMs: 90000,
    transcriptExpired: true,
    fragments: [],
    segments: [marker],
  });
  assert.deepEqual(expired.rows, []);
  assert.equal(expired.markers.length, 1);
  const rules = buildInspection({
    fragments: [fragment(0, 5000, "Our sponsor")],
    segments: [marker],
  });
  assert.equal(rules.rows[0].assessment, null);
  assert.equal(rules.rows[0].suspected, true);
  assert.equal(rules.rows[0].belowThreshold, false);
  assert.deepEqual(buildInspection().rows, []);
});

test("timeline timestamps support full eight-hour episodes", () => {
  assert.equal(formatTime(0), "00:00");
  assert.equal(formatTime(61000), "01:01");
  assert.equal(formatTime(28800000), "8:00:00");
});
