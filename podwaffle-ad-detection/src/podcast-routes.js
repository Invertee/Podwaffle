"use strict";
const express = require("express");
const { validateRequest, validateSegments } = require("./podcast-analysis");
const { classifyJev } = require("./classifier");
const { scheduleStatus } = require("./schedule");
const {
  defaultDetectionSettings,
  validateDetectionSettings,
  resolveDetectionSettings,
  applyJevPolicy,
} = require("./detection-settings");

function podcastRouter(store, config, logger, { classify = classifyJev } = {}) {
  const router = express.Router();
  let testing = false;
  const defaults = defaultDetectionSettings(config);
  const currentSettings = () => store.detectionSettings(defaults);
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.get("/status", (_req, res) =>
    res.json({
      language: "en",
      whisperConfigured: Boolean(config.podcastWhisperModel),
      provider: config.classifier || "rules",
      classifierWarning: config.classifierWarning,
      classifierModel:
        config.classifier === "jev" ? config.podcastJevModel : null,
      remoteClassification: config.classifier === "jev",
      jevConfigured:
        config.classifier === "jev" && Boolean(config.podcastJevKey),
      sampleBudgetSeconds: currentSettings().sampleBudgetSeconds,
      schedule: scheduleStatus(config.schedule),
      jobs: store.list(),
    }),
  );
  router.get("/settings", (_req, res) =>
    res.json({ settings: currentSettings(), defaults }),
  );
  router.put("/settings", (req, res) => {
    const settings = validateDetectionSettings(req.body?.settings);
    store.saveDetectionSettings(settings);
    logger.info("Detection settings updated");
    res.json({ settings, defaults });
  });
  // Uses the same classifier as queued audio jobs, without audio/model setup.
  // Nothing is stored; credentials are taken only from server configuration.
  router.post("/classify", async (req, res) => {
    if (config.classifier !== "jev" || !config.podcastJevKey)
      return res.status(503).json({
        error:
          "Select jev and configure a DigitalOcean model access key before testing.",
      });
    const body = req.body ?? {};
    const invalid = (message) =>
      Object.assign(new Error(message), { statusCode: 400 });
    const request = validateRequest({
      requestKey: "transcript-test",
      episodeId: "transcript-test",
      title: body.title ?? "Transcript test",
      enclosureUrl: "https://example.invalid/transcript-test",
      phrases: body.phrases,
      llmPrompt: body.llmPrompt,
      sensitivity: body.sensitivity,
      podcastTitle: body.podcastTitle,
      podcastDescription: body.podcastDescription,
      episodeDescription: body.episodeDescription,
    });
    const detectionSettings = currentSettings();
    const effectiveSettings = resolveDetectionSettings(
      detectionSettings,
      request.sensitivity,
    );
    if (
      !Array.isArray(body.fragments) ||
      !body.fragments.length ||
      body.fragments.length > 50
    )
      throw invalid(
        "fragments must contain 1..50 timestamped transcript excerpts",
      );
    let totalText = 0;
    const fragments = body.fragments.map((fragment) => {
      if (
        !fragment ||
        !Number.isSafeInteger(fragment.startMs) ||
        fragment.startMs < 0 ||
        !Number.isSafeInteger(fragment.endMs) ||
        fragment.endMs <= fragment.startMs ||
        fragment.endMs > 8 * 3600000 ||
        typeof fragment.text !== "string" ||
        !fragment.text.trim() ||
        fragment.text.length > 4000
      )
        throw invalid(
          "Each fragment needs valid startMs/endMs within eight hours and 1..4000 characters of text",
        );
      totalText += fragment.text.length;
      return {
        startMs: fragment.startMs,
        endMs: fragment.endMs,
        text: fragment.text.trim(),
      };
    });
    if (totalText > 20000)
      throw invalid(
        "Transcript tests are limited to 20000 characters in total",
      );
    if (testing)
      return res.status(409).json({
        error:
          "A transcript test is already running; try again after it finishes.",
      });
    testing = true;
    const controller = new AbortController();
    res.once("close", () => {
      if (!res.writableFinished) controller.abort();
    });
    const start = Date.now();
    try {
      const result = await classify(
        fragments,
        request,
        Math.max(...fragments.map((f) => f.endMs)),
        config,
        AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(config.podcastJobTimeoutMs),
        ]),
        validateSegments,
      );
      const filtered = applyJevPolicy(result, effectiveSettings.jev);
      res.status(result.successfulCount ? 200 : 502).json({
        ...(result.successfulCount
          ? {}
          : {
              error:
                result.failureReasons.join(" ") || "Jev classification failed.",
            }),
        provider: "jev",
        classifierModel: config.podcastJevModel,
        returnedModels: result.returnedModels,
        providerErrors: result.providerErrors,
        elapsedMs: Date.now() - start,
        minimumAdvertConfidence: effectiveSettings.jev.advertConfidence,
        minimumPromotionConfidence: effectiveSettings.jev.promotionConfidence,
        detectionSettings,
        effectiveSettings,
        segments: filtered.segments,
        assessments: filtered.assessments,
        successfulCount: result.successfulCount,
        failedCount: result.failedFragments.length,
        warnings: result.failureReasons,
        usage: result.usage,
      });
    } finally {
      testing = false;
    }
  });
  router.post("/jobs/:id/retry", (req, res) => {
    const job = store.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Podcast job not found" });
    if (job.status !== "failed")
      return res.status(409).json({ error: "Only failed jobs can be retried" });
    store.retry(job.id);
    store.log(job.id, "info", "Job manually retried");
    res.status(202).json({ job: store.get(job.id) });
  });
  router.post("/jobs", (req, res) => {
    const result = store.enqueue(validateRequest(req.body), currentSettings());
    if (!result.deduplicated) {
      store.log(result.job.id, "info", "Podcast analysis queued");
      logger.info("Podcast analysis queued", { jobId: result.job.id });
    }
    res.status(result.deduplicated ? 200 : 202).json(result);
  });
  router.get("/jobs/:id", (req, res) => {
    store.prune();
    const job = store.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Podcast job not found" });
    res.json({ job, logs: store.logs(job.id) });
  });
  router.get("/logs", (_req, res) => res.json({ lines: logger.tail(300) }));
  return router;
}
module.exports = { podcastRouter };
