import type { AppConfig } from "../config.js";
import type { PodwaffleDatabase } from "../db/connection.js";
import type { SyncEvent } from "@podwaffle/contracts";
import type { SyncService } from "../sync/service.js";
import { log } from "../logging.js";
import {
  feedErrorFields,
  feedLogFields,
  logFeedRefresh,
} from "./feed-diagnostics.js";
import { downloadFeed, upsertPodcastAndEpisodes } from "./service.js";

interface DuePodcast {
  id: string;
  title: string;
  feed_url: string;
  etag: string | null;
  last_modified: string | null;
}

export class FeedScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  public constructor(
    private readonly database: PodwaffleDatabase,
    private readonly sync: SyncService,
    private readonly config: AppConfig,
  ) {}

  public start(): void {
    const now = new Date().toISOString();
    const schedule = this.database.db
      .prepare(
        `SELECT COUNT(*) AS subscribedFeeds,
       COALESCE(SUM(CASE WHEN next_check_at IS NULL OR next_check_at <= ? THEN 1 ELSE 0 END), 0) AS dueFeeds,
       MIN(next_check_at) AS nextCheckAt
       FROM podcasts p WHERE EXISTS (SELECT 1 FROM subscriptions s WHERE s.podcast_id = p.id)`,
      )
      .get(now) as {
      subscribedFeeds: number;
      dueFeeds: number;
      nextCheckAt: string | null;
    };
    log("info", "feed.scheduler.started", {
      message:
        "Podcast feed scheduler started; existing retry delays are retained",
      ...schedule,
      nextCheckAt: schedule.dueFeeds > 0 ? now : schedule.nextCheckAt,
      pollSeconds: 60,
    });
    const deferred = this.database.db
      .prepare(
        `SELECT p.id, p.title, p.feed_url, p.failure_count, p.next_check_at
       FROM podcasts p WHERE p.failure_count > 0 AND p.next_check_at > ?
       AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.podcast_id = p.id)`,
      )
      .all(now) as unknown as Array<{
      id: string;
      title: string;
      feed_url: string;
      failure_count: number;
      next_check_at: string;
    }>;
    for (const podcast of deferred) {
      log("info", "feed.refresh.deferred", {
        message:
          "Podcast feed retry is waiting after earlier failures; manual refresh can retry now",
        ...feedLogFields(podcast.feed_url, {
          source: "scheduled",
          podcastId: podcast.id,
          podcastTitle: podcast.title,
        }),
        failures: podcast.failure_count,
        nextRetryAt: podcast.next_check_at,
      });
    }
    this.timer = setInterval(() => void this.refreshDue(), 60_000);
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  public async refreshDue(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = this.database.db
        .prepare(
          `SELECT DISTINCT p.id, p.title, p.feed_url, p.etag, p.last_modified
           FROM podcasts p JOIN subscriptions s ON s.podcast_id = p.id
           WHERE p.next_check_at IS NULL OR p.next_check_at <= ?
           ORDER BY p.next_check_at LIMIT 20`,
        )
        .all(new Date().toISOString()) as unknown as DuePodcast[];
      for (const podcast of due) await this.refresh(podcast);
    } finally {
      this.running = false;
    }
  }

  private async refresh(podcast: DuePodcast): Promise<void> {
    const context = {
      source: "scheduled" as const,
      podcastId: podcast.id,
      podcastTitle: podcast.title,
    };
    try {
      const headers: Record<string, string> = {};
      if (podcast.etag) headers["if-none-match"] = podcast.etag;
      if (podcast.last_modified)
        headers["if-modified-since"] = podcast.last_modified;
      const downloaded = await downloadFeed(podcast.feed_url, headers, context);
      const broadcasts: Array<{ profileId: string; event: SyncEvent }> = [];
      const refreshed = this.database.transaction(() => {
        const refreshed = upsertPodcastAndEpisodes(
          this.database.db,
          { feedUrl: podcast.feed_url },
          downloaded,
          this.config.feed_refresh_minutes,
        );
        const profiles = this.database.db
          .prepare("SELECT profile_id FROM subscriptions WHERE podcast_id = ?")
          .all(podcast.id) as unknown as Array<{ profile_id: string }>;
        for (const profile of profiles) {
          const event = this.sync.appendEvent(
            this.database.db,
            profile.profile_id,
            "podcast.metadata.updated",
            refreshed,
          );
          broadcasts.push({ profileId: profile.profile_id, event });
        }
        return refreshed;
      });
      logFeedRefresh("scheduled", refreshed, downloaded.status);
      for (const item of broadcasts)
        this.sync.broadcast(item.profileId, item.event);
    } catch (error) {
      const now = new Date();
      const current = this.database.db
        .prepare("SELECT failure_count FROM podcasts WHERE id = ?")
        .get(podcast.id) as { failure_count: number };
      const failures = current.failure_count + 1;
      const delayMinutes = Math.min(
        this.config.feed_refresh_minutes * 2 ** failures,
        24 * 60,
      );
      const nextRetryAt = new Date(
        now.getTime() + delayMinutes * 60_000,
      ).toISOString();
      this.database.db
        .prepare(
          `UPDATE podcasts SET last_checked_at = ?, failure_count = ?,
           next_check_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          now.toISOString(),
          failures,
          nextRetryAt,
          now.toISOString(),
          podcast.id,
        );
      log("warn", "feed.refresh.failed", {
        message: "Podcast feed refresh failed; automatic retry scheduled",
        ...feedLogFields(podcast.feed_url, context),
        ...feedErrorFields(error),
        failures,
        retryInMinutes: delayMinutes,
        nextRetryAt,
      });
    }
  }
}
