import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  analysisResultSchema,
  type AnalysisSettings,
  type EpisodeAnalysis,
  type AnalysisResult,
} from "@podwaffle/contracts";
import type { AppConfig } from "../config.js";
import type { PodwaffleDatabase } from "../db/connection.js";
import type { SyncService } from "../sync/service.js";
import { log } from "../logging.js";
import { z } from "zod";
import type { IntegratedAnalysis } from "./engine.js";

interface JobRow {
  id: string;
  profile_id: string;
  episode_id: string;
  request_json: string;
  status: string;
  stage: string;
  progress: number;
  remote_job_id: string | null;
  remote_base_url: string | null;
  attempts: number;
  next_attempt_at: string;
  created_at: string;
  finished_at: string | null;
  error: string | null;
  result_json: string | null;
  logs_json: string;
  transcript_expires_at: string | null;
}

export function analysisSettings(
  db: DatabaseSync,
  profileId: string,
  podcastId: string,
): AnalysisSettings {
  const row = db
    .prepare(
      `SELECT enabled,phrases_json,llm_prompt,sensitivity,edge_focus_minutes
       FROM subscription_analysis_settings WHERE profile_id=? AND podcast_id=?`,
    )
    .get(profileId, podcastId) as
    | {
        enabled: number;
        phrases_json: string;
        llm_prompt: string;
        sensitivity: AnalysisSettings["sensitivity"];
        edge_focus_minutes: number;
      }
    | undefined;
  return {
    enabled: row?.enabled === 1,
    phrases: row ? (JSON.parse(row.phrases_json) as string[]) : [],
    llmPrompt: row?.llm_prompt ?? "",
    sensitivity: row?.sensitivity ?? "balanced",
    edgeFocusMinutes: row?.edge_focus_minutes ?? 5,
  };
}

export function enqueueAnalysis(
  db: DatabaseSync,
  profileId: string,
  episodeId: string,
): string {
  const active = db
    .prepare(
      "SELECT id FROM episode_analysis_jobs WHERE profile_id=? AND episode_id=? AND status IN ('queued','processing')",
    )
    .get(profileId, episodeId) as { id: string } | undefined;
  if (active) return active.id;
  const episode = db
    .prepare(
      "SELECT e.*,p.title AS podcast_title,p.description AS podcast_description FROM episodes e JOIN podcasts p ON p.id=e.podcast_id JOIN subscriptions s ON s.podcast_id=e.podcast_id WHERE e.id=? AND s.profile_id=? AND e.removed_at IS NULL",
    )
    .get(episodeId, profileId) as
    | {
        enclosure_url: string | null;
        chapters_url: string | null;
        title: string;
        podcast_id: string;
        description_html: string | null;
        podcast_title: string;
        podcast_description: string | null;
      }
    | undefined;
  if (!episode?.enclosure_url)
    throw new Error("Subscribed episode with playable audio required");
  const settings = analysisSettings(db, profileId, episode.podcast_id);
  const id = randomUUID(),
    now = new Date().toISOString();
  const request = {
    requestKey: id,
    episodeId,
    title: episode.title,
    podcastTitle: episode.podcast_title.slice(0, 500),
    podcastDescription: analysisContext(episode.podcast_description),
    episodeDescription: analysisContext(episode.description_html),
    enclosureUrl: episode.enclosure_url,
    chaptersUrl: episode.chapters_url,
    phrases: settings.phrases,
    llmPrompt: settings.llmPrompt,
    sensitivity: settings.sensitivity,
    edgeFocusMinutes: settings.edgeFocusMinutes,
  };
  db.prepare(
    "INSERT INTO episode_analysis_jobs(id,profile_id,episode_id,request_json,created_at,next_attempt_at) VALUES(?,?,?,?,?,?)",
  ).run(id, profileId, episodeId, JSON.stringify(request), now, now);
  return id;
}

// Feed metadata is contextual evidence, never instructions for the classifier.
export function analysisContext(html: string | null): string {
  return (html ?? "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
}

// Called inside the same feed transaction as episode discovery, for scheduled and manual refreshes.
export function enqueueDiscoveredAnalysis(
  db: DatabaseSync,
  podcastId: string,
  episodeIds: string[],
): void {
  const profiles = db
    .prepare(
      "SELECT a.profile_id FROM subscription_analysis_settings a JOIN profiles p ON p.id=a.profile_id WHERE a.podcast_id=? AND a.enabled=1 AND p.enabled=1",
    )
    .all(podcastId) as unknown as Array<{ profile_id: string }>;
  for (const episodeId of episodeIds) {
    const media = db
      .prepare("SELECT enclosure_url FROM episodes WHERE id=?")
      .get(episodeId) as { enclosure_url: string | null };
    if (media.enclosure_url)
      for (const profile of profiles)
        enqueueAnalysis(db, profile.profile_id, episodeId);
  }
}

export function pruneTranscripts(db: DatabaseSync): void {
  const rows = db
    .prepare(
      "SELECT id,result_json FROM episode_analysis_jobs WHERE transcript_expires_at<=? AND result_json IS NOT NULL",
    )
    .all(new Date().toISOString()) as unknown as Array<{
    id: string;
    result_json: string;
  }>;
  for (const row of rows) {
    const result = JSON.parse(row.result_json) as AnalysisResult;
    result.fragments = [];
    result.diagnostics.classifierAssessments = [];
    result.transcriptExpired = true;
    db.prepare(
      "UPDATE episode_analysis_jobs SET result_json=?,transcript_expires_at=NULL WHERE id=?",
    ).run(JSON.stringify(result), row.id);
  }
}

export function getEpisodeAnalysis(
  db: DatabaseSync,
  config: AppConfig,
  profileId: string,
  episodeId: string,
): EpisodeAnalysis {
  pruneTranscripts(db);
  const row = db
    .prepare(
      "SELECT * FROM episode_analysis_jobs WHERE profile_id=? AND episode_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
    )
    .get(profileId, episodeId) as JobRow | undefined;
  const episode = db
    .prepare("SELECT enclosure_url FROM episodes WHERE id=?")
    .get(episodeId) as { enclosure_url: string | null } | undefined;
  return {
    configured: config.analysis_enabled,
    job: row
      ? {
          id: row.id,
          status: row.status,
          stage: row.stage,
          progress: row.progress,
          createdAt: row.created_at,
          finishedAt: row.finished_at,
          error: row.error,
          attempts: row.attempts,
          remoteJobId: row.remote_job_id,
          nextAttemptAt: row.next_attempt_at,
          stale:
            (JSON.parse(row.request_json) as { enclosureUrl: string })
              .enclosureUrl !== episode?.enclosure_url,
          transcriptExpiresAt: row.transcript_expires_at,
          result: row.result_json
            ? (JSON.parse(row.result_json) as AnalysisResult)
            : null,
          logs: JSON.parse(row.logs_json) as NonNullable<
            EpisodeAnalysis["job"]
          >["logs"],
        }
      : null,
  };
}

export class AnalysisDispatcher {
  private timer: NodeJS.Timeout | undefined;
  private pending: Promise<void> | undefined;
  private stopped = false;
  public constructor(
    private readonly database: PodwaffleDatabase,
    private readonly sync: SyncService,
    private readonly config: AppConfig,
    private readonly engine?: Pick<
      IntegratedAnalysis,
      "enqueue" | "get" | "logs" | "tick"
    >,
  ) {}
  public start(): void {
    this.timer = setInterval(() => {
      void this.tick().catch((error) =>
        log("warn", "analysis.dispatch.failed", { error: String(error) }),
      );
    }, 3000);
    this.timer.unref();
  }
  public async stop(): Promise<void> {
    clearInterval(this.timer);
    this.stopped = true;
    await this.pending;
  }
  public async tick(): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = this.process();
    try {
      await this.pending;
    } finally {
      this.pending = undefined;
    }
  }
  private async process(): Promise<void> {
    const db = this.database.db;
    pruneTranscripts(db);
    if (!this.config.analysis_enabled || !this.engine || this.stopped) return;
    const jobs = db
      .prepare(
        "SELECT * FROM episode_analysis_jobs WHERE status IN ('queued','processing') AND next_attempt_at<=? ORDER BY next_attempt_at LIMIT 20",
      )
      .all(new Date().toISOString()) as unknown as JobRow[];
    for (const row of jobs) {
      try {
        // Old in-flight sidecar jobs are requeued locally with the same request key.
        const job =
          (row.remote_job_id ? this.engine.get(row.remote_job_id) : null) ??
          this.engine.enqueue(JSON.parse(row.request_json));
        const result =
          job.status === "completed"
            ? analysisResultSchema.parse(job.result)
            : null;
        if (result && result.episodeId !== row.episode_id)
          throw new Error("Analysis episode identity mismatch");
        const finish = () => {
          db.prepare(
            `UPDATE episode_analysis_jobs SET status=?,stage=?,progress=?,remote_job_id=?,remote_base_url=NULL,attempts=0,
            next_attempt_at=?,error=?,result_json=?,logs_json=?,finished_at=?,transcript_expires_at=? WHERE id=?`,
          ).run(
            job.status,
            job.stage,
            job.progress,
            job.id,
            new Date(Date.now() + 3000).toISOString(),
            job.error,
            result ? JSON.stringify(result) : null,
            JSON.stringify(this.engine!.logs(job.id)),
            ["completed", "failed"].includes(job.status)
              ? new Date().toISOString()
              : null,
            result && !result.transcriptExpired
              ? new Date(
                  Date.parse(result.generatedAt) + 7 * 86400000,
                ).toISOString()
              : null,
            row.id,
          );
        };
        if (["completed", "failed"].includes(job.status))
          this.sync.mutate(row.profile_id, "episode.analysis.updated", () => {
            finish();
            return {
              result: null,
              payload: {
                episodeId: row.episode_id,
                analysisId: row.id,
                status: job.status,
              },
            };
          });
        else finish();
      } catch (error) {
        const attempts = row.attempts + 1,
          failed = attempts >= 3;
        db.prepare(
          "UPDATE episode_analysis_jobs SET attempts=?,error=?,next_attempt_at=?,status=?,stage=? WHERE id=?",
        ).run(
          attempts,
          error instanceof z.ZodError
            ? "Invalid analysis result"
            : String(error).slice(0, 2000),
          new Date(Date.now() + 30000).toISOString(),
          failed ? "failed" : row.status,
          failed ? "failed" : "retrying",
          row.id,
        );
      }
    }
    await this.engine.tick();
  }
}
