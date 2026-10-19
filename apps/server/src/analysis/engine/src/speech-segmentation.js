"use strict";

const normalText = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function speechUnits(fragments) {
  return fragments.flatMap((fragment) =>
    fragment.words?.length ? fragment.words : [fragment],
  );
}

function deduplicateSpeech(units) {
  const result = [];
  for (const unit of [...units].sort(
    (a, b) => a.startMs - b.startMs || a.endMs - b.endMs,
  )) {
    if (!unit.text.trim() || unit.endMs <= unit.startMs) continue;
    const duplicate = result
      .slice(-12)
      .some(
        (previous) =>
          normalText(previous.text) === normalText(unit.text) &&
          Math.min(previous.endMs, unit.endMs) -
            Math.max(previous.startMs, unit.startMs) >=
            0.5 *
              Math.min(
                previous.endMs - previous.startMs,
                unit.endMs - unit.startMs,
              ),
      );
    if (!duplicate)
      result.push({
        startMs: unit.startMs,
        endMs: unit.endMs,
        text: unit.text.trim(),
      });
  }
  return result;
}

function buildExcerpts(units, boundaries, maximumMs = 25000) {
  const ordered = deduplicateSpeech(units);
  const excerpts = [];
  let current = null;
  let boundaryIndex = 0;
  for (const unit of ordered) {
    while (
      boundaryIndex < boundaries.length &&
      boundaries[boundaryIndex].timeMs < (current?.endMs ?? unit.startMs) - 150
    )
      boundaryIndex++;
    const boundary = boundaries[boundaryIndex];
    const naturalBreak =
      current &&
      (unit.startMs - current.endMs >= 600 ||
        (boundary &&
          boundary.timeMs <= unit.startMs + 150 &&
          boundary.timeMs >= current.endMs - 150 &&
          unit.startMs >= current.endMs));
    const sentenceEnd =
      current &&
      current.endMs - current.startMs >= 8000 &&
      /[.!?]["')\]]?$/.test(current.text);
    if (
      current &&
      (naturalBreak ||
        sentenceEnd ||
        unit.endMs - current.startMs > maximumMs ||
        current.text.length + unit.text.length > 3800)
    ) {
      excerpts.push(current);
      current = null;
    }
    if (!current) current = { ...unit };
    else {
      current.endMs = Math.max(current.endMs, unit.endMs);
      current.text = `${current.text} ${unit.text}`;
    }
  }
  if (current) excerpts.push(current);
  return excerpts.map((excerpt, index) => ({
    ...excerpt,
    contextBefore:
      index > 0 && excerpt.startMs - excerpts[index - 1].endMs <= 8000
        ? excerpts[index - 1].text.slice(-500)
        : "",
    contextAfter:
      index + 1 < excerpts.length &&
      excerpts[index + 1].startMs - excerpt.endMs <= 8000
        ? excerpts[index + 1].text.slice(0, 500)
        : "",
  }));
}

function alignSampleWindows(windows, boundaries) {
  const aligned = windows.map((window) => ({ ...window }));
  for (let index = 1; index < aligned.length; index++) {
    const left = aligned[index - 1],
      right = aligned[index];
    if (left.endMs !== right.startMs) continue;
    const target = left.endMs;
    const cut = boundaries
      .filter(
        (boundary) =>
          Math.abs(boundary.timeMs - target) <= 4000 &&
          boundary.timeMs - left.startMs >= 12000 &&
          right.endMs - boundary.timeMs >= 12000,
      )
      .sort(
        (a, b) =>
          Math.abs(a.timeMs - target) - Math.abs(b.timeMs - target) ||
          b.score - a.score,
      )[0];
    if (cut) left.endMs = right.startMs = cut.timeMs;
  }
  return aligned;
}

function refinementWindows(
  segments,
  durationMs,
  attempted,
  remainingMs,
  maximum = 8,
) {
  const windows = [];
  for (const segment of segments) {
    for (const edge of [segment.startMs, segment.endMs]) {
      const startMs = Math.max(
        0,
        Math.min(durationMs - 30000, Math.floor((edge - 15000) / 500) * 500),
      );
      const endMs = Math.min(durationMs, startMs + 30000);
      if (windows.length >= maximum || endMs - startMs > remainingMs) continue;
      if (
        [...attempted, ...windows].some(
          (window) =>
            Math.abs(window.startMs - startMs) < 250 &&
            Math.abs(window.endMs - endMs) < 250,
        )
      )
        continue;
      windows.push({ startMs, endMs });
      remainingMs -= endMs - startMs;
    }
  }
  return windows.sort((a, b) => a.startMs - b.startMs);
}

function replaceSpeech(units, replacement, window, durationMs) {
  const start = window.startMs === 0 ? 0 : window.startMs + 1000;
  const end = window.endMs === durationMs ? durationMs : window.endMs - 1000;
  const usable = speechUnits(replacement).filter(
    (unit) => unit.startMs >= start && unit.endMs <= end,
  );
  // Empty/no-speech output is not evidence that a previously transcribed advert
  // disappeared. Keep its evidence if the refinement recogniser found nothing.
  if (!usable.length) return units;
  return deduplicateSpeech([
    ...units.filter((unit) => unit.startMs < start || unit.endMs > end),
    ...usable,
  ]);
}

function refineAndMergeMarkers(segments, units, boundaries, assessments) {
  const classified = assessments.filter(
    (assessment) => assessment.status === "completed",
  );
  const refined = segments
    .map((segment) => {
      const result = { ...segment };
      for (const side of ["startMs", "endMs"]) {
        const edge = segment[side];
        const cuts = boundaries.filter(
          (boundary) =>
            Math.abs(boundary.timeMs - edge) <= 800 &&
            (side === "startMs"
              ? boundary.timeMs <= edge
              : boundary.timeMs >= edge),
        );
        for (const cut of cuts.sort(
          (a, b) => Math.abs(a.timeMs - edge) - Math.abs(b.timeMs - edge),
        )) {
          const from = Math.min(edge, cut.timeMs),
            to = Math.max(edge, cut.timeMs);
          if (!units.some((unit) => unit.startMs < to && unit.endMs > from)) {
            result[side] = cut.timeMs;
            break;
          }
        }
      }
      return result;
    })
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged = [];
  for (const segment of refined) {
    const previous = merged.at(-1);
    const blocked =
      previous &&
      (classified.some(
        (assessment) =>
          assessment.verdict !== segment.kind &&
          assessment.startMs < segment.startMs &&
          assessment.endMs > previous.endMs,
      ) ||
        units.some(
          (unit) =>
            segment.startMs > previous.endMs &&
            unit.startMs < segment.startMs &&
            unit.endMs > previous.endMs &&
            normalText(unit.text).length > 0,
        ));
    if (
      previous &&
      previous.kind === segment.kind &&
      previous.source === segment.source &&
      segment.startMs - previous.endMs <= 1000 &&
      !blocked
    ) {
      previous.endMs = Math.max(previous.endMs, segment.endMs);
      previous.confidence = Math.min(previous.confidence, segment.confidence);
    } else merged.push({ ...segment });
  }
  return merged;
}

module.exports = {
  speechUnits,
  buildExcerpts,
  alignSampleWindows,
  refinementWindows,
  replaceSpeech,
  refineAndMergeMarkers,
};
