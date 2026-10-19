"use strict";

const { classifyJev } = require("./classifier");
const { applyJevPolicy } = require("./detection-settings");
const {
  buildExcerpts,
  refinementWindows,
  replaceSpeech,
  refineAndMergeMarkers,
} = require("./speech-segmentation");

async function classifyAndRefine({
  units,
  boundaries,
  windows,
  durationMs,
  request,
  config,
  signal,
  progress,
  transcribe,
  validate,
  classifyRules,
  policy,
  sampleBudgetSeconds,
  warnings,
  fetcher = fetch,
}) {
  let fragments;
  const cache = new Map();
  const usage = { requests: 0 };
  const returnedModels = new Set();
  const providerErrors = [];
  let unavailable = false;
  const segmentExcerpts = () => {
    const excerpts = buildExcerpts(units, boundaries);
    if (excerpts.length > 2000)
      warnings.push(
        "Speech excerpt limit reached; later sampled speech was not classified.",
      );
    return excerpts.slice(0, 2000);
  };
  const classify = async (previous = []) => {
    const result = { provider: "rules", segments: [], assessments: [] };
    if (config.classifier !== "jev") {
      result.segments = classifyRules(fragments, request.phrases);
      return result;
    }
    const key = (fragment) => JSON.stringify(fragment);
    const missing = fragments.filter((fragment) => !cache.has(key(fragment)));
    if (missing.length && !unavailable) {
      try {
        const response = await classifyJev(
          missing,
          request,
          durationMs,
          config,
          signal,
          validate,
          fetcher,
          (complete, total) =>
            progress(`classifying excerpt ${complete}/${total}`, 85),
        );
        const filtered = applyJevPolicy(response, policy);
        for (const [name, value] of Object.entries(response.usage))
          usage[name] = (usage[name] ?? 0) + value;
        for (const model of response.returnedModels) returnedModels.add(model);
        providerErrors.push(...response.providerErrors);
        unavailable =
          response.providerErrors.some((error) =>
            [400, 401, 403, 404].includes(error.status),
          ) || !config.podcastJevKey;
        for (let index = 0; index < missing.length; index++) {
          const fragment = missing[index];
          const assessment = filtered.assessments[index];
          cache.set(key(fragment), {
            assessment,
            segments:
              assessment?.status === "completed"
                ? filtered.segments.filter(
                    (segment) =>
                      segment.startMs === fragment.startMs &&
                      segment.endMs === fragment.endMs,
                  )
                : classifyRules([fragment], request.phrases),
          });
        }
        if (response.failedFragments.length) {
          const summary = response.failureReasons.slice(0, 3).join(" ");
          warnings.push(
            previous.length
              ? `Jev classification failed for ${response.failedFragments.length} refinement excerpts (${summary}); earlier advert decisions were retained where classification was unavailable.`
              : response.successfulCount > 0
                ? `Jev classification failed for ${response.failedFragments.length} of ${missing.length} excerpts (${summary}); phrase detection was used for those excerpts.`
                : `Jev classification failed for every excerpt (${summary}); phrase detector used instead.`,
          );
        }
      } catch (error) {
        if (signal.aborted) throw error;
        warnings.push(
          previous.length
            ? "Jev classifier unavailable during refinement; earlier advert decisions were retained."
            : "Jev classifier unavailable; phrase detection was used for unclassified excerpts.",
        );
      }
    }
    for (const fragment of fragments) {
      const cached = cache.get(key(fragment));
      if (cached?.assessment) result.assessments.push(cached.assessment);
      if (!previous.length || cached?.assessment?.status === "completed") {
        result.segments.push(
          ...(cached?.segments ?? classifyRules([fragment], request.phrases)),
        );
      }
    }
    // A provider failure in the second pass cannot erase an earlier positive
    // decision. Nor may it enlarge that decision into newly sampled speech.
    const failedFragments = fragments.filter(
      (fragment) =>
        cache.get(key(fragment))?.assessment?.status !== "completed",
    );
    for (const segment of previous) {
      let unresolved = [segment];
      for (const assessment of result.assessments.filter(
        (item) => item.status === "completed",
      )) {
        unresolved = unresolved.flatMap((part) => {
          if (
            assessment.startMs >= part.endMs ||
            assessment.endMs <= part.startMs
          )
            return [part];
          return [
            ...(assessment.startMs > part.startMs
              ? [{ ...part, endMs: assessment.startMs }]
              : []),
            ...(assessment.endMs < part.endMs
              ? [{ ...part, startMs: assessment.endMs }]
              : []),
          ];
        });
      }
      result.segments.push(
        ...unresolved.filter((part) =>
          failedFragments.some(
            (fragment) =>
              fragment.startMs < part.endMs && fragment.endMs > part.startMs,
          ),
        ),
      );
    }
    if (
      result.assessments.some(
        (assessment) => assessment.status === "completed",
      ) ||
      result.segments.some((segment) => segment.source === "jev") ||
      !fragments.length
    )
      result.provider = "jev";
    return result;
  };

  fragments = segmentExcerpts();
  let classified = await classify();
  const budgetMs = Math.min(
    240000,
    Math.max(60000, (sampleBudgetSeconds * 1000) / 3),
  );
  const attempted = [...windows];
  const extraSamples = [];
  let spentMs = 0;
  let attempts = 0;
  let rounds = 0;
  const advertBlocks = () =>
    refineAndMergeMarkers(
      classified.segments,
      units,
      boundaries,
      classified.assessments,
    );
  for (; rounds < 3 && attempts < 8; rounds++) {
    if (unavailable) break;
    const extra = refinementWindows(
      advertBlocks(),
      durationMs,
      attempted,
      budgetMs - spentMs,
      8 - attempts,
    );
    if (!extra.length) break;
    progress("refining advert boundaries", 90);
    for (let index = 0; index < extra.length; index++) {
      const window = extra[index];
      attempted.push(window);
      spentMs += window.endMs - window.startMs;
      attempts++;
      try {
        const replacement = await transcribe(window, index, extra.length);
        units = replaceSpeech(units, replacement, window, durationMs);
        windows.push(window);
        extraSamples.push(window);
      } catch (error) {
        if (signal.aborted) throw error;
        warnings.push(
          "An advert boundary refinement could not be transcribed; existing detection evidence was retained.",
        );
      }
    }
    fragments = segmentExcerpts();
    classified = await classify(classified.segments);
  }
  const limited =
    (spentMs >= budgetMs || attempts >= 8 || rounds >= 3) &&
    refinementWindows(advertBlocks(), durationMs, attempted, Infinity, 1)
      .length > 0;
  if (limited)
    warnings.push(
      "Advert edge refinement reached its work limit; some boundaries may still need manual adjustment.",
    );
  return {
    provider: classified.provider,
    fragments,
    segments: refineAndMergeMarkers(
      classified.segments,
      units,
      boundaries,
      classified.assessments,
    ),
    diagnostics: {
      classifierAssessments: classified.assessments,
      ...(config.classifier === "jev"
        ? {
            classifierUsage: usage,
            classifierReturnedModels: [...returnedModels],
            classifierErrors: providerErrors,
          }
        : {}),
      refinement: {
        budgetSeconds: budgetMs / 1000,
        usedSeconds: spentMs / 1000,
        attempts,
        rounds,
        limited,
        sampleWindows: extraSamples,
      },
    },
  };
}

module.exports = { classifyAndRefine };
