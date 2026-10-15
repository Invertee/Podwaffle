import express from "express";
import { analysisSettingsSchema, commandSchema } from "@podwaffle/contracts";
import type { PodwaffleDatabase } from "../db/connection.js";
import type { SyncService } from "../sync/service.js";
import type { AppConfig } from "../config.js";
import { ApiError } from "../api/errors.js";
import {
  analysisSettings,
  enqueueAnalysis,
  getEpisodeAnalysis,
} from "./service.js";
import { getEpisode } from "../podcasts/service.js";
import { analysedMedia } from "./media.js";
import { requireScope } from "../auth/middleware.js";

export function createAnalysisRouter(
  database: PodwaffleDatabase,
  sync: SyncService,
  config: AppConfig,
): express.Router {
  const router = express.Router(),
    db = database.db;
  router.get(
    "/analysis/downloads",
    requireScope("catalog:write"),
    (req, res) => {
      const profileId = req.auth!.profile.id;
      const rows = db
        .prepare(
          `SELECT DISTINCT j.episode_id FROM episode_analysis_jobs j
      JOIN episodes e ON e.id=j.episode_id
      JOIN subscription_analysis_settings a ON a.profile_id=j.profile_id AND a.podcast_id=e.podcast_id AND a.enabled=1
      JOIN subscriptions s ON s.profile_id=j.profile_id AND s.podcast_id=e.podcast_id
      LEFT JOIN episode_state es ON es.profile_id=j.profile_id AND es.episode_id=e.id
      WHERE j.profile_id=? AND j.status='completed' AND e.removed_at IS NULL AND COALESCE(es.played,0)=0
      ORDER BY j.created_at DESC`,
        )
        .all(profileId) as unknown as Array<{ episode_id: string }>;
      res.json({
        episodes: rows
          .filter((row) => analysedMedia(db, profileId, row.episode_id))
          .map((row) => getEpisode(db, profileId, row.episode_id)),
      });
    },
  );
  function subscription(profileId: string, podcastId: string) {
    if (
      !db
        .prepare(
          "SELECT 1 FROM subscriptions WHERE profile_id=? AND podcast_id=?",
        )
        .get(profileId, podcastId)
    )
      throw new ApiError(404, "NOT_FOUND", "Subscription not found");
  }
  function episode(profileId: string, episodeId: string) {
    const row = db
      .prepare("SELECT podcast_id FROM episodes WHERE id=?")
      .get(episodeId) as { podcast_id: string } | undefined;
    if (!row) throw new ApiError(404, "NOT_FOUND", "Episode not found");
    subscription(profileId, row.podcast_id);
  }
  router.get("/subscriptions/:podcastId/analysis", (req, res) => {
    const podcastId = String(req.params.podcastId),
      profileId = req.auth!.profile.id;
    subscription(profileId, podcastId);
    res.json({
      settings: analysisSettings(db, profileId, podcastId),
      configured: config.analysis_enabled,
    });
  });
  router.put("/subscriptions/:podcastId/analysis", (req, res) => {
    const podcastId = String(req.params.podcastId),
      profileId = req.auth!.profile.id;
    subscription(profileId, podcastId);
    const command = commandSchema
      .extend({ settings: analysisSettingsSchema })
      .parse(req.body);
    const applied = sync.command(
      profileId,
      command.commandId,
      "subscription.analysis-settings.updated",
      () => {
        const current = db
          .prepare("SELECT revision FROM profiles WHERE id=?")
          .get(profileId) as { revision: number };
        if (
          command.expectedRevision !== undefined &&
          current.revision !== command.expectedRevision
        )
          throw new ApiError(
            409,
            "REVISION_CONFLICT",
            "Profile state has changed",
            undefined,
            current.revision,
          );
        db.prepare(
          `INSERT INTO subscription_analysis_settings(
            profile_id,podcast_id,enabled,phrases_json,llm_prompt,sensitivity,edge_focus_minutes,updated_at
          ) VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(profile_id,podcast_id) DO UPDATE SET
            enabled=excluded.enabled,
            phrases_json=excluded.phrases_json,
            llm_prompt=excluded.llm_prompt,
            sensitivity=excluded.sensitivity,
            edge_focus_minutes=excluded.edge_focus_minutes,
            updated_at=excluded.updated_at`,
        ).run(
          profileId,
          podcastId,
          command.settings.enabled ? 1 : 0,
          JSON.stringify(command.settings.phrases),
          command.settings.llmPrompt,
          command.settings.sensitivity,
          command.settings.edgeFocusMinutes,
          new Date().toISOString(),
        );
        if (!command.settings.enabled)
          db.prepare(
            `UPDATE episode_analysis_jobs SET status='cancelled',stage='disabled before submission',finished_at=?
        WHERE profile_id=? AND remote_job_id IS NULL AND status='queued' AND episode_id IN (SELECT id FROM episodes WHERE podcast_id=?)`,
          ).run(new Date().toISOString(), profileId, podcastId);
        return {
          result: { settings: command.settings },
          payload: { podcastId, settings: command.settings },
        };
      },
    );
    res.json({
      ...applied.result,
      revision: applied.event?.revision,
      replayed: applied.replayed,
    });
  });
  router.get("/episodes/:episodeId/analysis", (req, res) => {
    const episodeId = String(req.params.episodeId),
      profileId = req.auth!.profile.id;
    episode(profileId, episodeId);
    res
      .set("Cache-Control", "no-store")
      .json(getEpisodeAnalysis(db, config, profileId, episodeId));
  });
  router.post("/episodes/:episodeId/analysis", (req, res) => {
    const episodeId = String(req.params.episodeId),
      profileId = req.auth!.profile.id;
    episode(profileId, episodeId);
    if (!config.analysis_enabled)
      throw new ApiError(
        503,
        "ANALYSIS_NOT_CONFIGURED",
        "Enable analysis in the Podwaffle server options",
      );
    const command = commandSchema.parse(req.body);
    const applied = sync.command(
      profileId,
      command.commandId,
      "episode.analysis.updated",
      () => {
        let jobId: string;
        try {
          jobId = enqueueAnalysis(db, profileId, episodeId);
        } catch {
          throw new ApiError(
            400,
            "NO_AUDIO",
            "This episode has no playable audio",
          );
        }
        return {
          result: { jobId },
          payload: { episodeId, analysisId: jobId, status: "queued" },
        };
      },
    );
    res.status(202).json(applied.result);
  });
  return router;
}
