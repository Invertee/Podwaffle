import type { PodwaffleDatabase } from "../db/connection.js";
import { log } from "../logging.js";
import { listQueue, normalizeQueue } from "../podcasts/service.js";
import type { SyncService } from "../sync/service.js";
import { clearPlayback, playbackState } from "./service.js";

export const QUEUE_INACTIVITY_MS = 3 * 24 * 60 * 60 * 1_000;

export class QueueExpiryService {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly database: PodwaffleDatabase,
    private readonly sync: SyncService,
  ) {}

  start(): void {
    if (this.timer) return;
    this.sweep();
    this.timer = setInterval(() => {
      try {
        this.sweep();
      } catch (error) {
        log("warn", "queue.expiry.failed", {
          message: "Queue expiry check failed",
          error: String(error),
        });
      }
    }, 60_000);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  expireProfile(profileId: string, now = Date.now()): boolean {
    const stale = this.database.db
      .prepare(
        `SELECT 1 FROM queue_activity
      WHERE profile_id = ? AND last_activity_at <= ? AND EXISTS (
        SELECT 1 FROM queue_items WHERE profile_id = queue_activity.profile_id
      )`,
      )
      .get(profileId, new Date(now - QUEUE_INACTIVITY_MS).toISOString());
    if (!stale) return false;
    this.sync.mutate(profileId, "queue.updated", (db) => {
      const expiredEpisodeId =
        playbackState(db, profileId, "").episode?.id ?? null;
      clearPlayback(db, profileId);
      db.prepare("DELETE FROM queue_items WHERE profile_id = ?").run(profileId);
      normalizeQueue(db, profileId);
      db.prepare(
        "UPDATE queue_activity SET expired_at = ?, expired_episode_id = ? WHERE profile_id = ?",
      ).run(new Date(now).toISOString(), expiredEpisodeId, profileId);
      db.prepare(
        "UPDATE playback_commands SET status = 'cancelled', completed_at = ? WHERE profile_id = ? AND status = 'pending'",
      ).run(new Date(now).toISOString(), profileId);
      return {
        result: true,
        payload: {
          reason: "queue_inactivity_timeout",
          queue: listQueue(db, profileId),
          playback: playbackState(db, profileId, ""),
        },
      };
    });
    return true;
  }

  sweep(now = Date.now()): number {
    const profiles = this.database.db
      .prepare(
        "SELECT profile_id FROM queue_activity WHERE last_activity_at <= ?",
      )
      .all(new Date(now - QUEUE_INACTIVITY_MS).toISOString()) as {
      profile_id: string;
    }[];
    return profiles.reduce(
      (count, profile) =>
        count + Number(this.expireProfile(profile.profile_id, now)),
      0,
    );
  }
}
