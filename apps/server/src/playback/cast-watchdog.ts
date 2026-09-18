import { randomUUID } from "node:crypto";
import type { PodwaffleDatabase } from "../db/connection.js";
import {
  createCastCommand,
  PLAYBACK_CONTROL_IDLE_MS,
  type StoredPlaybackCommand,
} from "./service.js";

/** Requests an observation; never extrapolates progress from elapsed time. */
export class CastProgressWatchdog {
  private timer: NodeJS.Timeout | undefined;
  constructor(
    private readonly database: PodwaffleDatabase,
    private readonly enabled: boolean,
    private readonly send: (
      profileId: string,
      ownerId: string,
      command: StoredPlaybackCommand["command"],
    ) => Promise<boolean>,
  ) {}

  start(): void {
    if (this.enabled && !this.timer) {
      this.timer = setInterval(() => {
        void this.sweep().catch(() => undefined);
      }, 30_000);
      this.timer.unref();
    }
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async sweep(now = Date.now()): Promise<number> {
    if (!this.enabled) return 0;
    const db = this.database.db;
    const rows = db
      .prepare(
        `SELECT profile_id, cast_owner_device_id, episode_id, cast_session_id
      FROM playback_state WHERE mode = 'cast' AND state = 'playing'
      AND updated_at < ? AND updated_at > ? AND cast_owner_device_id IS NOT NULL`,
      )
      .all(
        new Date(now - 45_000).toISOString(),
        new Date(now - PLAYBACK_CONTROL_IDLE_MS).toISOString(),
      ) as {
      profile_id: string;
      cast_owner_device_id: string;
      episode_id: string;
      cast_session_id: string;
    }[];
    let requested = 0;
    for (const row of rows) {
      const recent = db
        .prepare(
          `SELECT 1 FROM playback_commands WHERE profile_id = ?
        AND action = 'refresh-status' AND created_at > ?`,
        )
        .get(row.profile_id, new Date(now - 60_000).toISOString());
      if (recent) continue;
      db.prepare(
        `UPDATE playback_commands SET status = 'cancelled', completed_at = ?
        WHERE profile_id = ? AND action = 'refresh-status' AND status = 'pending'`,
      ).run(new Date(now).toISOString(), row.profile_id);
      const stored = createCastCommand(
        db,
        row.profile_id,
        row.cast_owner_device_id,
        {
          commandId: randomUUID(),
          action: "refresh-status",
          episodeId: row.episode_id,
          castSessionId: row.cast_session_id,
        },
      );
      requested++;
      // Dispatch independently: an unavailable owner must not delay other profiles.
      void this.send(
        row.profile_id,
        stored.ownerDeviceId,
        stored.command,
      ).catch(() => undefined);
    }
    return requested;
  }
}
