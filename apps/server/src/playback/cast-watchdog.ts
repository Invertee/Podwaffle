import { randomUUID } from "node:crypto";
import type { PodwaffleDatabase } from "../db/connection.js";
import { log } from "../logging.js";
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
      log("info", "cast.watchdog.started", {
        message: "Cast progress watchdog started",
      });
      this.timer = setInterval(() => {
        void this.sweep().catch((error: unknown) => {
          log("warn", "cast.watchdog.sweep_failed", {
            message: "Cast progress watchdog sweep failed",
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }, 30_000);
      this.timer.unref();
    }
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  sweep(now = Date.now()): Promise<number> {
    if (!this.enabled) return Promise.resolve(0);
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
      log("info", "cast.watchdog.refresh_requested", {
        message: "Cast watchdog requested fresh receiver status",
        profileId: row.profile_id,
        ownerDeviceId: stored.ownerDeviceId,
        episodeId: row.episode_id,
        castSessionId: row.cast_session_id,
        commandId: stored.command.commandId,
      });
      // Dispatch independently: an unavailable owner must not delay other profiles.
      void this.send(row.profile_id, stored.ownerDeviceId, stored.command)
        .then((delivered) => {
          log(delivered ? "info" : "warn", "cast.watchdog.refresh_dispatched", {
            message: delivered
              ? "Cast watchdog delivered its status request"
              : "Cast watchdog owner was unavailable for its status request",
            profileId: row.profile_id,
            ownerDeviceId: stored.ownerDeviceId,
            commandId: stored.command.commandId,
          });
        })
        .catch((error: unknown) => {
          log("warn", "cast.watchdog.refresh_dispatch_failed", {
            message: "Cast watchdog could not dispatch its status request",
            profileId: row.profile_id,
            ownerDeviceId: stored.ownerDeviceId,
            commandId: stored.command.commandId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
    return Promise.resolve(requested);
  }
}
