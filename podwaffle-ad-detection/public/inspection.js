"use strict";
// Shared by the browser and Node tests; no dependencies or DOM access.
((root, factory) => {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PodcastInspection = factory();
})(globalThis, () => {
  const isAdvert = (kind) => ["advertisement", "promotion"].includes(kind);
  const overlaps = (a, b) => a.startMs < b.endMs && b.startMs < a.endMs;
  const rangeKey = (range) => `${range.startMs}:${range.endMs}`;
  const validRange = (range) =>
    Number.isFinite(range.startMs) &&
    Number.isFinite(range.endMs) &&
    range.startMs >= 0 &&
    range.endMs > range.startMs;
  function formatTime(ms) {
    const seconds = Math.floor(Math.max(0, ms) / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours ? `${hours}:` : ""}${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }
  function unionDuration(ranges) {
    let end = 0,
      total = 0;
    for (const range of ranges
      .filter(validRange)
      .slice()
      .sort((a, b) => a.startMs - b.startMs)) {
      total += Math.max(0, range.endMs - Math.max(end, range.startMs));
      end = Math.max(end, range.endMs);
    }
    return total;
  }
  function buildInspection(result = {}) {
    const diagnostics = result.diagnostics || {};
    const markers = (result.segments || []).filter(
      (s) => validRange(s) && isAdvert(s.kind),
    );
    const assessments = new Map();
    for (const assessment of diagnostics.classifierAssessments || []) {
      const key = rangeKey(assessment);
      if (!assessments.has(key)) assessments.set(key, []);
      assessments.get(key).push(assessment);
    }
    const rows = (result.fragments || [])
      .filter(validRange)
      .map((fragment, index) => {
        // Use both endpoints, not array order: adjacent samples may overlap.
        const assessment = assessments.get(rangeKey(fragment))?.shift() || null;
        const matched = markers.filter((marker) => overlaps(fragment, marker));
        const failed =
          assessment &&
          (assessment.status === "failed" ||
            assessment.status === "skipped" ||
            (!assessment.status &&
              !assessment.probabilities &&
              assessment.confidence === 0));
        const verdict =
          assessment?.verdict || matched[0]?.kind || "unclassified";
        return {
          ...fragment,
          id: index,
          assessment,
          markers: matched,
          verdict,
          threshold:
            verdict === "promotion"
              ? (diagnostics.minimumPromotionConfidence ??
                diagnostics.minimumAdvertConfidence ??
                0.55)
              : (diagnostics.minimumAdvertConfidence ?? 0.55),
          state: failed ? "failed" : verdict,
          suspected: isAdvert(verdict) || matched.length > 0,
          belowThreshold: Boolean(
            assessment &&
            !failed &&
            isAdvert(verdict) &&
            (assessment.markerDecision
              ? !assessment.markerDecision.accepted
              : !matched.some(
                  (m) =>
                    m.source === "jev" &&
                    m.kind === verdict &&
                    rangeKey(m) === rangeKey(fragment),
                )),
          ),
        };
      })
      .sort(
        (a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.id - b.id,
      );
    const samples = (diagnostics.sampleWindows || []).filter(validRange);
    // Older results may have excerpts without sampling diagnostics.
    const coverage = samples.length ? samples : rows;
    const durationMs =
      result.durationMs ||
      Math.max(0, ...markers.map((m) => m.endMs), ...rows.map((r) => r.endMs));
    return {
      rows,
      markers,
      coverage,
      durationMs,
      sampledMs: unionDuration(coverage),
      advertMs: unionDuration(markers),
      threshold: diagnostics.minimumAdvertConfidence ?? 0.55,
      promotionThreshold:
        diagnostics.minimumPromotionConfidence ??
        diagnostics.minimumAdvertConfidence ??
        0.55,
      effectiveSettings: diagnostics.effectiveSettings,
    };
  }
  function filterRows(rows, query, filter) {
    const text = query.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (!text ||
          `${row.text} ${row.assessment?.reason || ""} ${row.verdict}`
            .toLowerCase()
            .includes(text)) &&
        (filter === "all" ||
          (filter === "suspected" ? row.suspected : row.state === filter)),
    );
  }
  return { buildInspection, filterRows, formatTime, unionDuration, overlaps };
});
