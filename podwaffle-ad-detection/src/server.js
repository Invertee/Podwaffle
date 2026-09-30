"use strict";
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { loadConfig } = require("./config");
const { createLogger } = require("./logger");
const { createPodcastStore } = require("./podcast-store");
const { PodcastWorker, analyse } = require("./podcast-analysis");
const { podcastRouter } = require("./podcast-routes");
const { Models } = require("./models");

function createApp(store, config, logger, models) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.set(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'",
    );
    next();
  });
  app.use(express.json({ limit: "128kb" }));
  app.get("/health", (_req, res) =>
    res.json({ status: "ok", models: models.status }),
  );
  app.get("/api/podcasts/models", (_req, res) => res.json(models.status));
  app.post("/api/podcasts/models/prepare", (req, res) => {
    const target = req.body?.target ?? "configured";
    if (!["configured", "whisper", "qwen"].includes(target))
      return res
        .status(400)
        .json({ error: "target must be configured, whisper or qwen" });
    void models.prepare(target);
    res.status(202).json(models.status);
  });
  app.use("/api/podcasts", podcastRouter(store, config, logger));
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.use((error, _req, res, _next) => {
    const status = error.statusCode || error.status || 500;
    res.status(status).json({
      error:
        status < 500
          ? error.message
          : "Internal analyser error; check service logs",
    });
    if (status >= 500)
      logger.error("API request failed", { error: error.message });
  });
  return app;
}

async function main() {
  const config = loadConfig();
  fs.mkdirSync(config.dataDir, { recursive: true });
  const logger = createLogger({
    logPath: config.logPath,
    maxBytes: config.logMaxBytes,
  });
  const store = createPodcastStore(config.databasePath),
    models = new Models(config, logger);
  const worker = new PodcastWorker(store, config, logger, analyse, models);
  // Jobs remain queued while first-install downloads are visible in the UI.
  const timer = setInterval(() => {
    if (models.status.ready && !models.status.busy)
      void worker
        .tick()
        .catch((error) =>
          logger.error("Queue error", { error: error.message }),
        );
  }, 3000);
  const server = createApp(store, config, logger, models).listen(
    config.port,
    config.host,
    () => {
      logger.info("Podwaffle Ad Detection listening", { port: config.port });
      void models.prepare();
    },
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeIdleConnections();
    await worker.stop();
    await models.stop();
    await closed;
    store.close();
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
  server.on("error", (error) => {
    logger.error("HTTP server failed", { error: error.message });
    process.exitCode = 1;
    void stop();
  });
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { createApp };
