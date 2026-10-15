"use strict";
const path = require("node:path");
const express = require("express");
const { podcastRouter } = require("./podcast-routes");

function createApp(store, config, logger, models, dependencies) {
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
    if (!["configured", "whisper"].includes(target))
      return res
        .status(400)
        .json({ error: "target must be configured or whisper" });
    void models.prepare(target);
    res.status(202).json(models.status);
  });
  app.use("/api/podcasts", podcastRouter(store, config, logger, dependencies));
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.use((error, _req, res, _next) => {
    void _next;
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

module.exports = { createApp };
