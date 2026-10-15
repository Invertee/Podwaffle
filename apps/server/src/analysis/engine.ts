import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import {
  analysisResultSchema,
  commandSchema,
  type AnalysisResult,
} from "@podwaffle/contracts";
import type { SyncService } from "../sync/service.js";
import type { AppConfig } from "../config.js";
import type { EpisodeMediaCache } from "./media.js";

const require = createRequire(import.meta.url);
// The existing, tested CommonJS engine is bundled with this server.
interface EngineConfig {
  databasePath: string;
  podcastCacheDir: string;
  modelDir: string;
  podcastWhisperModel: string;
  logPath: string;
  logMaxBytes: number;
  schedule: unknown;
  retainAudio?: EpisodeMediaCache["retain"];
}
interface EngineLogger {
  error(message: string, meta?: unknown): void;
}
interface EngineStore {
  enqueue(body: unknown, settings: unknown): { job: EngineJob };
  detectionSettings(defaults: unknown): unknown;
  get(id: string): EngineJob | null;
  logs(
    id: string,
  ): Array<{ createdAt: string; level: string; message: string }>;
  list(): EngineJob[];
  hasPending(): boolean;
  prune(): void;
  close(): void;
}
interface EngineModels {
  status: { ready: boolean; busy: boolean };
  prepare(target?: string): Promise<unknown>;
  stop(): Promise<void>;
}
const { loadConfig } = require("./engine/src/config.js") as {
  loadConfig(
    this: void,
    env: Record<string, string | undefined>,
    options: AppConfig,
  ): EngineConfig;
};
const { createLogger } = require("./engine/src/logger.js") as {
  createLogger(
    this: void,
    options: { logPath: string; maxBytes: number },
  ): EngineLogger;
};
const { createPodcastStore } = require("./engine/src/podcast-store.js") as {
  createPodcastStore(this: void, path: string): EngineStore;
};
const { PodcastWorker, validateRequest } =
  require("./engine/src/podcast-analysis.js") as {
    PodcastWorker: new (
      store: EngineStore,
      config: EngineConfig,
      logger: EngineLogger,
    ) => { tick(): Promise<void>; stop(): Promise<void> };
    validateRequest(this: void, body: unknown): unknown;
  };
const { Models } = require("./engine/src/models.js") as {
  Models: new (config: EngineConfig, logger: EngineLogger) => EngineModels;
};
const { podcastRouter } = require("./engine/src/podcast-routes.js") as {
  podcastRouter(
    this: void,
    store: EngineStore,
    config: EngineConfig,
    logger: EngineLogger,
  ): express.Router;
};
const { defaultDetectionSettings } =
  require("./engine/src/detection-settings.js") as {
    defaultDetectionSettings(this: void, config: EngineConfig): unknown;
  };
const { scheduleStatus } = require("./engine/src/schedule.js") as {
  scheduleStatus(this: void, schedule: unknown): { allowed: boolean };
};

export interface EngineJob {
  id: string;
  requestKey: string;
  request: { episodeId: string };
  status: string;
  stage: string;
  progress: number;
  error: string | null;
  result: AnalysisResult | null;
}

export class IntegratedAnalysis {
  public readonly store: EngineStore;
  public readonly models: EngineModels;
  public readonly config: EngineConfig;
  private readonly worker;
  private readonly logger;
  public constructor(
    appConfig: AppConfig,
    private readonly cache: EpisodeMediaCache,
  ) {
    const dataDir = resolve(appConfig.dataDir, "analysis");
    mkdirSync(dataDir, { recursive: true });
    this.config = loadConfig({ ...process.env, DATA_DIR: dataDir }, appConfig);
    this.config.databasePath = appConfig.databasePath;
    this.config.podcastCacheDir = resolve(appConfig.episodeCacheDir, "work");
    this.config.modelDir = resolve(appConfig.episodeCacheDir, "models");
    this.config.podcastWhisperModel = resolve(
      this.config.modelDir,
      `ggml-${appConfig.whisper_model}.bin`,
    );
    this.config.retainAudio = cache.retain.bind(cache);
    this.logger = createLogger({
      logPath: this.config.logPath,
      maxBytes: this.config.logMaxBytes,
    });
    this.store = createPodcastStore(this.config.databasePath);
    this.models = new Models(this.config, this.logger);
    this.worker = new PodcastWorker(this.store, this.config, this.logger);
  }
  public enqueue(body: unknown): EngineJob {
    return this.store.enqueue(
      validateRequest(body),
      this.store.detectionSettings(defaultDetectionSettings(this.config)),
    ).job;
  }
  public get(id: string): EngineJob | null {
    return this.store.get(id);
  }
  public logs(
    id: string,
  ): Array<{ createdAt: string; level: string; message: string }> {
    return this.store.logs(id);
  }
  public tick(): Promise<void> {
    this.store.prune();
    if (!scheduleStatus(this.config.schedule).allowed) return Promise.resolve();
    const pending = this.store.hasPending();
    if (!pending) return Promise.resolve();
    if (!this.models.status.ready) {
      if (!this.models.status.busy) void this.models.prepare();
      return Promise.resolve();
    }
    // Do not block the server dispatcher while speech recognition runs.
    void this.worker
      .tick()
      .catch((error: Error) =>
        this.logger.error("Analysis queue failed", { error: error.message }),
      );
    return Promise.resolve();
  }
  public router(sync: SyncService): express.Router {
    const router = express.Router();
    router.get("/storage", (_req, res) => res.json(this.cache.summary()));
    router.put("/storage", async (req, res) => {
      const limit = (req.body as { limitMb?: unknown } | undefined)?.limitMb;
      if (
        typeof limit !== "number" ||
        !Number.isSafeInteger(limit) ||
        limit < 0 ||
        limit > 1000000
      ) {
        res.status(400).json({ error: "limitMb must be 0..1000000" });
        return;
      }
      await this.cache.setLimit(limit);
      res.json(this.cache.summary());
    });
    router.get("/models", (_req, res) => res.json(this.models.status));
    router.post("/models/prepare", (req, res) => {
      const target =
        (req.body as { target?: unknown } | undefined)?.target ?? "configured";
      if (target !== "configured" && target !== "whisper") {
        res.status(400).json({ error: "Invalid model target" });
        return;
      }
      void this.models.prepare(target);
      res.status(202).json(this.models.status);
    });
    router.post("/jobs", (req, res) => {
      const body = req.body as Record<string, unknown>;
      const profileId = req.auth!.profile.id;
      if (typeof body.requestKey !== "string" || !body.requestKey.trim()) {
        res.status(400).json({ error: "A request key is required" });
        return;
      }
      const job = this.enqueue({
        ...body,
        requestKey: `${profileId}:${body.requestKey}`,
      });
      this.cache.db
        .prepare(
          "INSERT OR IGNORE INTO analysis_test_job_owners(job_id,profile_id) VALUES(?,?)",
        )
        .run(job.id, profileId);
      res.status(202).json({ job });
    });
    router.put("/jobs/:id/segments", (req, res) => {
      const profileId = req.auth!.profile.id;
      const row = (this.cache.db
        .prepare(
          "SELECT id,episode_id,result_json FROM episode_analysis_jobs WHERE remote_job_id=? AND profile_id=? AND status='completed'",
        )
        .get(String(req.params.id), profileId) ??
        this.cache.db
          .prepare(
            `SELECT j.id,json_extract(j.request_json,'$.episodeId') AS episode_id,j.result_json
          FROM podcast_jobs j JOIN analysis_test_job_owners o ON o.job_id=j.id
          WHERE j.id=? AND o.profile_id=? AND j.status='completed'`,
          )
          .get(String(req.params.id), profileId)) as
        { id: string; episode_id: string; result_json: string } | undefined;
      if (!row) {
        res.status(404).json({ error: "Completed analysis not found" });
        return;
      }
      const command = commandSchema.parse(req.body);
      const body = req.body as { segments?: unknown };
      const result = analysisResultSchema.parse({
        ...(JSON.parse(row.result_json) as AnalysisResult),
        segments: body.segments,
      });
      if (
        result.segments.some((segment) => segment.endMs > result.durationMs)
      ) {
        res.status(400).json({ error: "A region extends past the recording" });
        return;
      }
      const applied = sync.command(
        profileId,
        command.commandId,
        "episode.analysis.updated",
        () => {
          this.cache.db
            .prepare(
              "UPDATE episode_analysis_jobs SET result_json=? WHERE id=?",
            )
            .run(JSON.stringify(result), row.id);
          this.cache.db
            .prepare("UPDATE podcast_jobs SET result_json=? WHERE id=?")
            .run(JSON.stringify(result), String(req.params.id));
          return {
            result: { saved: true },
            payload: {
              episodeId: row.episode_id,
              analysisId: row.id,
              status: "completed",
            },
          };
        },
      );
      res.json(applied.result);
    });
    router.use("/jobs/:id", (req, res, next) => {
      const owned =
        this.cache.db
          .prepare(
            "SELECT id FROM episode_analysis_jobs WHERE remote_job_id=? AND profile_id=?",
          )
          .get(String(req.params.id), req.auth!.profile.id) ??
        this.cache.db
          .prepare(
            "SELECT job_id AS id FROM analysis_test_job_owners WHERE job_id=? AND profile_id=?",
          )
          .get(String(req.params.id), req.auth!.profile.id);
      if (!owned) {
        res.status(404).json({ error: "Analysis job not found" });
        return;
      }
      if (req.method === "POST" && req.path === "/retry") {
        this.cache.db
          .prepare(
            "UPDATE episode_analysis_jobs SET status='processing',stage='retrying',next_attempt_at=? WHERE id=? AND status='failed'",
          )
          .run(new Date().toISOString(), String(owned.id));
      }
      next();
    });
    router.get("/logs", (req, res) => {
      const jobs = this.cache.db
        .prepare(
          "SELECT remote_job_id FROM episode_analysis_jobs WHERE profile_id=? AND remote_job_id IS NOT NULL ORDER BY created_at DESC LIMIT 20",
        )
        .all(req.auth!.profile.id);
      res.json({
        lines: jobs
          .flatMap((row) =>
            this.logs(String(row.remote_job_id)).map(
              (line) => `${line.createdAt} ${line.level} ${line.message}`,
            ),
          )
          .slice(-300),
      });
    });
    router.use((req, res, next) => {
      const ownedStore = {
        ...this.store,
        list: () =>
          this.store
            .list()
            .filter(
              (job) =>
                this.cache.db
                  .prepare(
                    "SELECT 1 FROM episode_analysis_jobs WHERE remote_job_id=? AND profile_id=?",
                  )
                  .get(job.id, req.auth!.profile.id) ||
                this.cache.db
                  .prepare(
                    "SELECT 1 FROM analysis_test_job_owners WHERE job_id=? AND profile_id=?",
                  )
                  .get(job.id, req.auth!.profile.id),
            ),
      };
      podcastRouter(ownedStore, this.config, this.logger)(req, res, next);
    });
    router.use(
      (
        error: { statusCode?: number; message?: string; name?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        void _next;
        res
          .status(error.name === "ZodError" ? 400 : (error.statusCode ?? 500))
          .json({
            error:
              error.name === "ZodError"
                ? "Invalid analysis settings or regions"
                : error.statusCode
                  ? error.message
                  : "Analysis request failed",
          });
      },
    );
    return router;
  }
  public static publicPath = resolve(import.meta.dirname, "engine/public");
  public async stop(): Promise<void> {
    await this.worker.stop();
    await this.models.stop();
    this.store.close();
  }
}
