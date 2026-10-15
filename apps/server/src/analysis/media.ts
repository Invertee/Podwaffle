import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import express from "express";
import type { DatabaseSync } from "node:sqlite";
import type { AnalysisResult, Episode } from "@podwaffle/contracts";
import type { AppConfig } from "../config.js";

interface MediaRow {
  id: string;
  episode_id: string;
  sha256: string;
  size_bytes: number;
  source_url: string;
  content_type: string;
}

export class EpisodeMediaCache {
  private pending: Promise<unknown> = Promise.resolve();
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => undefined);
    return result;
  }
  public constructor(
    public readonly db: DatabaseSync,
    public readonly config: AppConfig,
  ) {}
  public limitMb(): number {
    return (
      (this.db
        .prepare("SELECT limit_mb FROM analysis_storage_settings WHERE id=1")
        .get()?.limit_mb as number | undefined) ?? this.config.episode_cache_mb
    );
  }
  public summary() {
    const totals = this.db
      .prepare(
        "SELECT COUNT(*) AS count,COALESCE(SUM(size_bytes),0) AS bytes FROM analysis_media",
      )
      .get()!;
    return {
      limitMb: this.limitMb(),
      count: Number(totals.count),
      bytes: Number(totals.bytes),
    };
  }
  public async setLimit(limitMb: number): Promise<void> {
    await this.exclusive(async () => {
      this.db
        .prepare(
          "INSERT INTO analysis_storage_settings(id,limit_mb) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET limit_mb=excluded.limit_mb",
        )
        .run(limitMb);
      await this.pruneUnlocked();
    });
  }
  public async prune(incomingBytes = 0): Promise<void> {
    await this.exclusive(() => this.pruneUnlocked(incomingBytes));
  }
  public async recover(): Promise<void> {
    await mkdir(this.config.episodeCacheDir, { recursive: true });
    const root = resolve(this.config.episodeCacheDir),
      work = resolve(root, "work");
    if (
      work !== root &&
      work.startsWith(root + (process.platform === "win32" ? "\\" : "/"))
    )
      await rm(work, { recursive: true, force: true });
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (
        entry.isFile() &&
        /^[a-f0-9]{64}$/.test(entry.name) &&
        !this.db
          .prepare("SELECT 1 FROM analysis_media WHERE id=?")
          .get(entry.name)
      )
        await rm(resolve(root, entry.name), { force: true });
    }
    await this.prune();
  }
  private async pruneUnlocked(incomingBytes = 0): Promise<void> {
    const rows = this.db
      .prepare("SELECT * FROM analysis_media ORDER BY accessed_at,created_at")
      .all() as unknown as MediaRow[];
    let total = rows.reduce((sum, row) => sum + row.size_bytes, 0);
    for (const row of rows) {
      const file = resolve(this.config.episodeCacheDir, row.id);
      if (
        existsSync(file) &&
        total + incomingBytes <= this.limitMb() * 1024 ** 2
      )
        continue;
      // Each filename is an opaque server-generated capability, never user input.
      await rm(file, { force: true });
      this.db.prepare("DELETE FROM analysis_media WHERE id=?").run(row.id);
      total -= row.size_bytes;
    }
  }
  public async retain(
    request: { episodeId: string; enclosureUrl: string },
    input: string,
    fingerprint: AnalysisResult["fingerprint"],
  ): Promise<void> {
    await this.exclusive(async () => {
      if (
        !this.db
          .prepare("SELECT 1 FROM episodes WHERE id=?")
          .get(request.episodeId)
      )
        return;
      if (fingerprint.sizeBytes > this.limitMb() * 1024 ** 2) return;
      const existing = this.db
        .prepare(
          "SELECT id FROM analysis_media WHERE episode_id=? AND sha256=?",
        )
        .get(request.episodeId, fingerprint.sha256) as
        { id: string } | undefined;
      if (
        existing &&
        existsSync(resolve(this.config.episodeCacheDir, existing.id))
      ) {
        this.db
          .prepare(
            "UPDATE analysis_media SET source_url=?,accessed_at=? WHERE id=?",
          )
          .run(request.enclosureUrl, new Date().toISOString(), existing.id);
        return;
      }
      if (existing)
        this.db
          .prepare("DELETE FROM analysis_media WHERE id=?")
          .run(existing.id);
      await this.pruneUnlocked(fingerprint.sizeBytes);
      await mkdir(this.config.episodeCacheDir, { recursive: true });
      const id = randomBytes(32).toString("hex"),
        now = new Date().toISOString();
      const contentType = this.db
        .prepare("SELECT enclosure_type FROM episodes WHERE id=?")
        .get(request.episodeId)?.enclosure_type;
      await rename(input, resolve(this.config.episodeCacheDir, id));
      try {
        this.db
          .prepare(
            "INSERT INTO analysis_media(id,episode_id,sha256,size_bytes,source_url,content_type,created_at,accessed_at) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(
            id,
            request.episodeId,
            fingerprint.sha256,
            fingerprint.sizeBytes,
            request.enclosureUrl,
            typeof contentType === "string" ? contentType : "audio/mpeg",
            now,
            now,
          );
      } catch (error) {
        await rm(resolve(this.config.episodeCacheDir, id), { force: true });
        throw error;
      }
    });
  }
  public router(): express.Router {
    const router = express.Router();
    router.get("/media/:id", async (req, res, next) => {
      if (!/^[a-f0-9]{64}$/.test(String(req.params.id))) {
        res.sendStatus(404);
        return;
      }
      const row = this.db
        .prepare("SELECT * FROM analysis_media WHERE id=?")
        .get(String(req.params.id)) as MediaRow | undefined;
      if (!row) {
        res.sendStatus(404);
        return;
      }
      const file = resolve(this.config.episodeCacheDir, row.id);
      try {
        if ((await stat(file)).size !== row.size_bytes) {
          res.sendStatus(404);
          return;
        }
      } catch {
        res.sendStatus(404);
        return;
      }
      this.db
        .prepare("UPDATE analysis_media SET accessed_at=? WHERE id=?")
        .run(new Date().toISOString(), row.id);
      // Express implements byte ranges, HEAD and conditional requests for seeking.
      res.set({
        "Content-Type": row.content_type,
        "Cache-Control": "private, max-age=0",
        "X-Content-Type-Options": "nosniff",
      });
      res.sendFile(file, (error) => {
        if (error) next(error);
      });
    });
    return router;
  }
}

export function analysedMedia(
  db: DatabaseSync,
  profileId: string,
  episodeId: string,
): Exclude<Episode["analysedMedia"], undefined> {
  const row = db
    .prepare(
      `SELECT j.result_json, e.enclosure_url FROM episode_analysis_jobs j
    JOIN episodes e ON e.id=j.episode_id
    JOIN subscription_analysis_settings a ON a.profile_id=j.profile_id AND a.podcast_id=e.podcast_id AND a.enabled=1
    JOIN subscriptions s ON s.profile_id=j.profile_id AND s.podcast_id=e.podcast_id
    WHERE j.profile_id=? AND j.episode_id=? AND j.status='completed' AND j.result_json IS NOT NULL
    ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1`,
    )
    .get(profileId, episodeId) as
    { result_json: string; enclosure_url: string } | undefined;
  if (!row) return null;
  const result = JSON.parse(row.result_json) as AnalysisResult;
  const media = db
    .prepare(
      "SELECT * FROM analysis_media WHERE episode_id=? AND sha256=? AND source_url=?",
    )
    .get(episodeId, result.fingerprint.sha256, row.enclosure_url) as
    MediaRow | undefined;
  if (!media) return null;
  return {
    path: `/media/${media.id}`,
    sha256: media.sha256,
    sizeBytes: media.size_bytes,
    durationMs: result.durationMs,
    adSegments: result.segments
      .filter((s) => s.kind === "advertisement")
      .map(({ startMs, endMs }) => ({ startMs, endMs })),
  };
}
