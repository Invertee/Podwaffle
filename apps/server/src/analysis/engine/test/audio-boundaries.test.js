"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  acousticFilter,
  readAcousticFrames,
  silenceBoundaries,
  detectBoundaries,
} = require("../src/audio-boundaries");

const settings = { silenceThresholdDb: -35, minimumSilenceSeconds: 0.6 };
const frames = (change) =>
  Array.from({ length: 40 }, (_, index) => ({
    timeMs: index * 256,
    rms: -25,
    centroid: 0.15,
    flux: 0.01,
    ...change(index),
  }));

test("finds a sustained volume change without silence", () => {
  const boundaries = detectBoundaries(
    frames((index) => ({ rms: index < 20 ? -30 : -16 })),
    [],
    settings,
  );
  assert.ok(
    boundaries.some(
      (boundary) =>
        boundary.types.includes("volume") &&
        Math.abs(boundary.timeMs - 5120) < 600,
    ),
  );
});

test("finds a sustained change in tone at constant volume", () => {
  const boundaries = detectBoundaries(
    frames((index) => ({ centroid: index < 20 ? 0.1 : 0.4 })),
    [],
    settings,
  );
  assert.ok(
    boundaries.some(
      (boundary) =>
        boundary.types.includes("tone") && !boundary.types.includes("volume"),
    ),
  );
});

test("rejects isolated loud clicks, ordinary variation and quiet spectral noise", () => {
  assert.deepEqual(
    detectBoundaries(
      frames((index) => ({ rms: index === 20 ? -2 : -25 })),
      [],
      settings,
    ),
    [],
  );
  assert.deepEqual(
    detectBoundaries(
      frames((index) => ({
        rms: -25 + Math.sin(index),
        centroid: 0.15 + 0.01 * Math.sin(index),
      })),
      [],
      settings,
    ),
    [],
  );
  assert.deepEqual(
    detectBoundaries(
      frames((index) => ({ rms: -80, centroid: index < 20 ? 0.01 : 0.9 })),
      [],
      settings,
    ),
    [],
  );
});

test("uses the middle of a pause, supports trailing silence and merges coincident clues", () => {
  assert.deepEqual(
    silenceBoundaries(
      "silence_start: 1\nsilence_end: 2\nsilence_start: 8",
      10000,
    ).map((boundary) => boundary.timeMs),
    [1500, 9000],
  );
  const boundaries = detectBoundaries(
    frames((index) => ({
      rms: index < 20 ? -30 : -16,
      centroid: index < 20 ? 0.1 : 0.4,
    })),
    [{ timeMs: 5120, types: ["silence"], score: 1 }],
    settings,
  );
  const combined = boundaries.find((boundary) =>
    boundary.types.includes("silence"),
  );
  assert.equal(combined.timeMs, 5120);
  assert.ok(combined.types.includes("volume"));
  assert.ok(combined.types.includes("tone"));
});

test("streams FFmpeg metadata with aligned timestamps and rejects oversized traces", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "podwaffle-acoustic-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(directory, "acoustic-rms.txt"),
    "frame:0 pts:0 pts_time:0\nlavfi.astats.Overall.RMS_level=-inf\nframe:1 pts:4096 pts_time:0.256\nlavfi.astats.Overall.RMS_level=-22.5\n",
  );
  await fs.writeFile(
    path.join(directory, "acoustic-centroid.txt"),
    "frame:0 pts:0 pts_time:0\nlavfi.aspectralstats.1.centroid=0.1\nframe:1 pts:4096 pts_time:0.256\nlavfi.aspectralstats.1.centroid=NaN\n",
  );
  await fs.writeFile(
    path.join(directory, "acoustic-flux.txt"),
    "frame:0 pts:0 pts_time:0\nlavfi.aspectralstats.1.flux=0.01\n",
  );
  const result = await readAcousticFrames(
    directory,
    1000,
    new AbortController().signal,
  );
  assert.deepEqual(result, [
    { timeMs: 0, rms: -120, centroid: 0.1, flux: 0.01 },
    { timeMs: 256, rms: -22.5 },
  ]);
  await fs.writeFile(
    path.join(directory, "acoustic-rms.txt"),
    Array.from(
      { length: 20 },
      (_, index) =>
        `frame:${index} pts:0 pts_time:0\nlavfi.astats.Overall.RMS_level=-25`,
    ).join("\n"),
  );
  await assert.rejects(
    readAcousticFrames(directory, 1000, new AbortController().signal),
    /exceed/,
  );
});

test("missing statistics are a valid pause-only fallback and filter output paths stay relative", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "podwaffle-acoustic-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  assert.deepEqual(
    await readAcousticFrames(directory, 1000, new AbortController().signal),
    [],
  );
  const filter = acousticFilter(settings);
  assert.ok(filter.includes("silencedetect=n=-35dB:d=0.6"));
  assert.ok(filter.includes("aspectralstats=win_size=4096:overlap=0"));
  assert.ok(filter.includes("file=acoustic-rms.txt"));
});
