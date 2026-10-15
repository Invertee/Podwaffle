"use strict";

const presets = {
  low: {
    silenceThresholdDb: -40,
    minimumSilenceSeconds: 0.8,
    confidence: 0.75,
  },
  balanced: {
    silenceThresholdDb: -35,
    minimumSilenceSeconds: 0.6,
    confidence: 0.55,
  },
  high: {
    silenceThresholdDb: -30,
    minimumSilenceSeconds: 0.35,
    confidence: 0.35,
  },
};
const modes = ["episode", "low", "balanced", "high", "custom"];

function defaultDetectionSettings(config = {}) {
  return {
    audioSensitivity: "episode",
    silenceThresholdDb: -35,
    minimumSilenceSeconds: 0.6,
    sampleBudgetSeconds: config.podcastSampleSeconds ?? 900,
    jevSensitivity: "episode",
    advertConfidence: 0.55,
    promotionConfidence: 0.55,
    minimumLabelProbability: 0,
    includePromotions: true,
  };
}

function validateDetectionSettings(input) {
  const fail = (message) => {
    throw Object.assign(new Error(message), { statusCode: 400 });
  };
  const defaults = defaultDetectionSettings();
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("settings must be an object");
  if (Object.keys(input).some((key) => !Object.hasOwn(defaults, key)))
    fail("Unknown detection setting");
  for (const name of ["audioSensitivity", "jevSensitivity"])
    if (!modes.includes(input[name]))
      fail(`${name} must be episode, low, balanced, high or custom`);
  for (const [name, min, max] of [
    ["silenceThresholdDb", -80, -10],
    ["minimumSilenceSeconds", 0.1, 5],
    ["sampleBudgetSeconds", 30, 3600],
    ["advertConfidence", 0, 1],
    ["promotionConfidence", 0, 1],
    ["minimumLabelProbability", 0, 1],
  ]) {
    const value = input[name];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (name === "sampleBudgetSeconds" && !Number.isSafeInteger(value))
    )
      fail(
        `${name} must be ${name === "sampleBudgetSeconds" ? "an integer" : "a number"} from ${min} to ${max}`,
      );
  }
  if (typeof input.includePromotions !== "boolean")
    fail("includePromotions must be true or false");
  return Object.fromEntries(
    Object.keys(defaults).map((key) => [key, input[key]]),
  );
}

function resolveDetectionSettings(settings, episodeSensitivity = "balanced") {
  const episode = presets[episodeSensitivity] || presets.balanced;
  const audio =
    settings.audioSensitivity === "custom"
      ? settings
      : settings.audioSensitivity === "episode"
        ? episode
        : presets[settings.audioSensitivity];
  const jev =
    settings.jevSensitivity === "episode"
      ? episode
      : presets[settings.jevSensitivity];
  return {
    audio: {
      silenceThresholdDb: audio.silenceThresholdDb,
      minimumSilenceSeconds: audio.minimumSilenceSeconds,
      sampleBudgetSeconds: settings.sampleBudgetSeconds,
    },
    jev: {
      advertConfidence: jev?.confidence ?? settings.advertConfidence,
      promotionConfidence: jev?.confidence ?? settings.promotionConfidence,
      minimumLabelProbability: settings.minimumLabelProbability,
      includePromotions: settings.includePromotions,
    },
  };
}

function applyJevPolicy(result, policy) {
  const percent = (n) => `${Math.round(n * 100)}%`;
  const assessments = result.assessments.map((assessment) => {
    if (!["advertisement", "promotion"].includes(assessment.verdict))
      return assessment;
    const threshold =
      assessment.verdict === "promotion"
        ? policy.promotionConfidence
        : policy.advertConfidence;
    let reason = "Meets the saved Jev marker thresholds.";
    let accepted = true;
    if (assessment.verdict === "promotion" && !policy.includePromotions) {
      accepted = false;
      reason = "Promotion markers are disabled in this job’s settings.";
    } else if (assessment.confidence < threshold) {
      accepted = false;
      reason = `Classification confidence ${percent(assessment.confidence)} is below the ${percent(threshold)} ${assessment.verdict === "promotion" ? "promotion" : "advert"} threshold.`;
    } else if (
      policy.minimumLabelProbability > 0 &&
      !(
        assessment.probabilities?.[assessment.verdict] >=
        policy.minimumLabelProbability
      )
    ) {
      accepted = false;
      reason = `Selected-label probability does not meet the ${percent(policy.minimumLabelProbability)} minimum.`;
    }
    return { ...assessment, markerDecision: { accepted, reason } };
  });
  const accepted = new Set(
    assessments
      .filter((a) => a.markerDecision?.accepted)
      .map((a) => `${a.startMs}:${a.endMs}:${a.verdict}`),
  );
  return {
    assessments,
    segments: result.segments.filter((s) =>
      accepted.has(`${s.startMs}:${s.endMs}:${s.kind}`),
    ),
  };
}

module.exports = {
  defaultDetectionSettings,
  validateDetectionSettings,
  resolveDetectionSettings,
  applyJevPolicy,
};
