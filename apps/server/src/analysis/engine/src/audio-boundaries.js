"use strict";

const { createReadStream } = require("node:fs");
const { createInterface } = require("node:readline");
const path = require("node:path");

const FRAME_SAMPLES = 4096;
const SAMPLE_RATE = 16000;
const STATS_FILES = [
  ["rms", "lavfi.astats.Overall.RMS_level"],
  ["centroid", "lavfi.aspectralstats.1.centroid"],
  ["flux", "lavfi.aspectralstats.1.flux"],
];

function acousticFilter(audio) {
  return [
    `aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=mono`,
    `asetnsamples=n=${FRAME_SAMPLES}:p=0`,
    `silencedetect=n=${audio.silenceThresholdDb}dB:d=${audio.minimumSilenceSeconds}`,
    `aspectralstats=win_size=${FRAME_SAMPLES}:overlap=0`,
    "astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level",
    ...STATS_FILES.map(
      ([name, key]) =>
        `ametadata=mode=print:key=${key}:file=acoustic-${name}.txt`,
    ),
  ].join(",");
}

async function readAcousticFrames(directory, durationMs, signal) {
  const frames = new Map();
  const limit =
    Math.ceil(durationMs / ((1000 * FRAME_SAMPLES) / SAMPLE_RATE)) + 4;
  for (const [name, key] of STATS_FILES) {
    const stream = createReadStream(
      path.join(directory, `acoustic-${name}.txt`),
      { encoding: "utf8", signal },
    );
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let timeMs = null;
    let count = 0;
    try {
      for await (const line of lines) {
        const timestamp = /pts_time:\s*([-+\d.e]+)/i.exec(line);
        if (timestamp) {
          timeMs = Math.round(Number(timestamp[1]) * 1000);
          if (++count > limit)
            throw new Error("Acoustic statistics exceed the episode duration");
        } else if (
          timeMs !== null &&
          timeMs >= 0 &&
          timeMs < durationMs &&
          line.startsWith(`${key}=`)
        ) {
          const raw = line.slice(key.length + 1).trim();
          const value = name === "rms" && raw === "-inf" ? -120 : Number(raw);
          if (!Number.isFinite(value)) continue;
          if (!frames.has(timeMs)) frames.set(timeMs, { timeMs });
          frames.get(timeMs)[name] = value;
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    } finally {
      lines.close();
      stream.destroy();
    }
  }
  return [...frames.values()]
    .filter((frame) => Number.isFinite(frame.rms))
    .sort((a, b) => a.timeMs - b.timeMs);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function silenceBoundaries(log, durationMs) {
  const boundaries = [];
  let start = null;
  for (const match of log.matchAll(/silence_(start|end):\s*([\d.]+)/g)) {
    const time = Math.min(durationMs, Math.round(Number(match[2]) * 1000));
    if (match[1] === "start") start = time;
    else {
      boundaries.push({
        timeMs: start === null ? time : Math.round((start + time) / 2),
        types: ["silence"],
        score: 1,
      });
      start = null;
    }
  }
  if (start !== null)
    boundaries.push({
      timeMs: Math.round((start + durationMs) / 2),
      types: ["silence"],
      score: 1,
    });
  return boundaries.filter(
    (boundary) => boundary.timeMs > 0 && boundary.timeMs < durationMs,
  );
}

function detectBoundaries(frames, pauses, audio) {
  const candidates = [...pauses];
  const volumeThreshold =
    audio.silenceThresholdDb <= -40
      ? 10
      : audio.silenceThresholdDb >= -30
        ? 6
        : 8;
  const toneThreshold =
    audio.silenceThresholdDb <= -40
      ? 0.9
      : audio.silenceThresholdDb >= -30
        ? 0.45
        : 0.65;
  // Compare roughly one second on each side. A click or a single stressed word
  // must not look like a persistent change of recording or background music.
  for (let index = 4; index < frames.length - 4; index++) {
    const before = frames.slice(index - 4, index);
    const after = frames.slice(index, index + 4);
    if (after.at(-1).timeMs - before[0].timeMs > 2400) continue;
    const left = median(before.map((frame) => frame.rms));
    const right = median(after.map((frame) => frame.rms));
    if (Math.min(left, right) < Math.max(-55, audio.silenceThresholdDb - 10))
      continue;
    const volumeChange = Math.abs(right - left);
    const leftTone = median(before.map((frame) => frame.centroid));
    const rightTone = median(after.map((frame) => frame.centroid));
    const toneChange =
      leftTone > 0 && rightTone > 0
        ? Math.abs(Math.log2(rightTone / leftTone))
        : 0;
    const baselineFlux =
      median([...before, ...after].map((frame) => frame.flux)) ?? 0;
    const fluxPeak = Math.max(
      ...frames.slice(index - 1, index + 2).map((frame) => frame.flux ?? 0),
    );
    const types = [];
    if (volumeChange >= volumeThreshold) types.push("volume");
    if (
      toneChange >= toneThreshold &&
      (fluxPeak >= Math.max(0.000001, baselineFlux * 2) ||
        toneChange >= toneThreshold * 1.5)
    )
      types.push("tone");
    if (!types.length) continue;
    candidates.push({
      timeMs: frames[index].timeMs,
      types,
      score: Math.min(
        0.95,
        0.55 + 0.15 * types.length + (0.05 * volumeChange) / volumeThreshold,
      ),
    });
  }
  // Collapse nearby clues into one cut, preferring an actual pause when present.
  const merged = [];
  for (const candidate of candidates.sort((a, b) => a.timeMs - b.timeMs)) {
    const previous = merged.at(-1);
    if (previous && candidate.timeMs - previous.timeMs <= 750) {
      const types = [...new Set([...previous.types, ...candidate.types])];
      if (candidate.score > previous.score) Object.assign(previous, candidate);
      previous.types = types;
    } else merged.push({ ...candidate, types: [...candidate.types] });
  }
  return merged;
}

module.exports = {
  acousticFilter,
  readAcousticFrames,
  silenceBoundaries,
  detectBoundaries,
};
