import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  CastConfirmedState,
  ListeningStats,
  PlaybackCommand,
  PlaybackState,
  statsPeriodSchema,
} from "@podwaffle/contracts";
import type { z } from "zod";
import { getEpisode } from "../podcasts/service.js";

const LEASE_MS = 45_000;
export const CAST_IDLE_MS = 30 * 60 * 1000;

function localDate(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

export function playbackState(
  db: DatabaseSync,
  profileId: string,
  deviceId: string,
): PlaybackState {
  const row = db
    .prepare("SELECT * FROM playback_state WHERE profile_id = ?")
    .get(profileId) as Record<string, unknown> | undefined;
  const episodeId = row?.episode_id as string | null | undefined;
  return {
    episode: episodeId ? (getEpisode(db, profileId, episodeId) ?? null) : null,
    positionMs: Number(row?.position_ms ?? 0),
    durationMs:
      row?.duration_ms === null || row?.duration_ms === undefined
        ? null
        : Number(row.duration_ms),
    state: (row?.state as PlaybackState["state"] | undefined) ?? "stopped",
    mode: (row?.mode as PlaybackState["mode"] | undefined) ?? "local",
    playbackRate: Number(row?.playback_rate ?? 1),
    activeDeviceId: (row?.active_device_id as string | null) ?? null,
    leaseExpiresAt: (row?.lease_expires_at as string | null) ?? null,
    castOwnerDeviceId: (row?.cast_owner_device_id as string | null) ?? null,
    castSessionId: (row?.cast_session_id as string | null) ?? null,
    ownedByCurrentDevice:
      row?.active_device_id === deviceId &&
      Date.parse(String(row.lease_expires_at)) > Date.now(),
  };
}

export function acquireLease(
  db: DatabaseSync,
  profileId: string,
  deviceId: string,
  input: {
    episodeId?: string | undefined;
    positionMs: number;
    durationMs?: number | null | undefined;
    playbackRate: number;
  },
): void {
  const now = new Date();
  const existing = db
    .prepare("SELECT episode_id FROM playback_state WHERE profile_id = ?")
    .get(profileId) as { episode_id: string | null } | undefined;
  const episodeId = input.episodeId ?? existing?.episode_id ?? null;
  db.prepare(
    `INSERT INTO playback_state(
       profile_id, episode_id, position_ms, duration_ms, state, mode,
       playback_rate, active_device_id, lease_expires_at, revision, updated_at
     ) VALUES (?, ?, ?, ?, 'paused', 'local', ?, ?, ?, 0, ?)
     ON CONFLICT(profile_id) DO UPDATE SET
       episode_id = excluded.episode_id,
       position_ms = excluded.position_ms,
       duration_ms = excluded.duration_ms,
       mode = 'local',
       cast_owner_device_id = NULL,
       cast_session_id = NULL,
       playback_rate = excluded.playback_rate,
       active_device_id = excluded.active_device_id,
       lease_expires_at = excluded.lease_expires_at,
       revision = playback_state.revision + 1,
       updated_at = excluded.updated_at`,
  ).run(
    profileId,
    episodeId,
    input.positionMs,
    input.durationMs ?? null,
    input.playbackRate,
    deviceId,
    new Date(now.getTime() + LEASE_MS).toISOString(),
    now.toISOString(),
  );
}

export function startCast(
  db: DatabaseSync,
  profileId: string,
  deviceId: string,
  confirmed: CastConfirmedState,
): void {
  const now = new Date();
  db.prepare(
    `INSERT INTO playback_state(
       profile_id, episode_id, position_ms, duration_ms, state, mode,
       playback_rate, active_device_id, lease_expires_at,
       cast_owner_device_id, cast_session_id, revision, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'cast', ?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(profile_id) DO UPDATE SET
       episode_id = excluded.episode_id,
       position_ms = excluded.position_ms,
       duration_ms = excluded.duration_ms,
       state = excluded.state,
       mode = 'cast',
       playback_rate = excluded.playback_rate,
       active_device_id = excluded.active_device_id,
       lease_expires_at = excluded.lease_expires_at,
       cast_owner_device_id = excluded.cast_owner_device_id,
       cast_session_id = excluded.cast_session_id,
       revision = playback_state.revision + 1,
       updated_at = excluded.updated_at`,
  ).run(
    profileId,
    confirmed.episodeId,
    confirmed.positionMs,
    confirmed.durationMs,
    confirmed.state,
    confirmed.playbackRate,
    deviceId,
    new Date(now.getTime() + LEASE_MS).toISOString(),
    deviceId,
    confirmed.castSessionId,
    now.toISOString(),
  );
}

export function stopCast(
  db: DatabaseSync,
  profileId: string,
  deviceId: string,
  input: {
    positionMs: number;
    durationMs: number | null;
    state: "playing" | "paused" | "stopped";
    playbackRate: number;
  },
): void {
  const current = db
    .prepare(
      `SELECT cast_owner_device_id, lease_expires_at
       FROM playback_state WHERE profile_id = ? AND mode = 'cast'`,
    )
    .get(profileId) as
    | {
        cast_owner_device_id: string | null;
        lease_expires_at: string | null;
      }
    | undefined;
  const ownerLeaseActive =
    current?.lease_expires_at &&
    Date.parse(current.lease_expires_at) > Date.now();
  if (current?.cast_owner_device_id !== deviceId && ownerLeaseActive)
    throw new Error("CAST_OWNER_REQUIRED");
  const now = new Date();
  db.prepare(
    `UPDATE playback_state SET position_ms = ?, duration_ms = ?, state = ?,
     mode = 'local', playback_rate = ?, active_device_id = ?,
     lease_expires_at = ?, cast_owner_device_id = NULL, cast_session_id = NULL,
     revision = revision + 1, updated_at = ? WHERE profile_id = ?`,
  ).run(
    input.positionMs,
    input.durationMs,
    input.state,
    input.playbackRate,
    deviceId,
    new Date(now.getTime() + LEASE_MS).toISOString(),
    now.toISOString(),
    profileId,
  );
}

interface PlaybackCommandRow {
  command_id: string;
  profile_id: string;
  requested_by_device_id: string;
  owner_device_id: string;
  action: PlaybackCommand["action"];
  payload_json: string;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  result_json: string | null;
}

export interface StoredPlaybackCommand {
  command: PlaybackCommand & { requestedByDeviceId: string };
  ownerDeviceId: string;
  status: PlaybackCommandRow["status"];
  result: unknown;
  replayed: boolean;
}

function mapPlaybackCommand(
  row: PlaybackCommandRow,
  replayed: boolean,
): StoredPlaybackCommand {
  const payload = JSON.parse(row.payload_json) as PlaybackCommand;
  return {
    command: {
      ...payload,
      requestedByDeviceId: row.requested_by_device_id,
    },
    ownerDeviceId: row.owner_device_id,
    status: row.status,
    result: row.result_json ? (JSON.parse(row.result_json) as unknown) : null,
    replayed,
  };
}

export function createCastCommand(
  db: DatabaseSync,
  profileId: string,
  requestedByDeviceId: string,
  command: PlaybackCommand,
): StoredPlaybackCommand {
  const existing = db
    .prepare(
      "SELECT * FROM playback_commands WHERE command_id = ? AND profile_id = ?",
    )
    .get(command.commandId, profileId) as PlaybackCommandRow | undefined;
  if (existing) return mapPlaybackCommand(existing, true);
  const playback = db
    .prepare(
      `SELECT mode, cast_owner_device_id FROM playback_state
       WHERE profile_id = ?`,
    )
    .get(profileId) as
    { mode: string; cast_owner_device_id: string | null } | undefined;
  if (playback?.mode !== "cast" || !playback.cast_owner_device_id)
    throw new Error("CAST_NOT_ACTIVE");
  db.prepare(
    `INSERT INTO playback_commands(
       command_id, profile_id, requested_by_device_id, owner_device_id,
       action, payload_json, status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(
    command.commandId,
    profileId,
    requestedByDeviceId,
    playback.cast_owner_device_id,
    command.action,
    JSON.stringify(command),
    new Date().toISOString(),
  );
  return {
    command: { ...command, requestedByDeviceId },
    ownerDeviceId: playback.cast_owner_device_id,
    status: "pending",
    result: null,
    replayed: false,
  };
}

export function getCastCommand(
  db: DatabaseSync,
  profileId: string,
  commandId: string,
): StoredPlaybackCommand | undefined {
  const row = db
    .prepare(
      "SELECT * FROM playback_commands WHERE command_id = ? AND profile_id = ?",
    )
    .get(commandId, profileId) as PlaybackCommandRow | undefined;
  return row ? mapPlaybackCommand(row, true) : undefined;
}

export function resolveCastCommand(
  db: DatabaseSync,
  profileId: string,
  ownerDeviceId: string,
  input: {
    commandId: string;
    status: "accepted" | "rejected";
    confirmed?: CastConfirmedState | undefined;
    message?: string | undefined;
  },
): { command: StoredPlaybackCommand; playback: PlaybackState } {
  const existing = getCastCommand(db, profileId, input.commandId);
  if (!existing) throw new Error("CAST_COMMAND_NOT_FOUND");
  if (existing.ownerDeviceId !== ownerDeviceId)
    throw new Error("CAST_OWNER_REQUIRED");
  if (existing.status !== "pending")
    return {
      command: existing,
      playback: playbackState(db, profileId, ownerDeviceId),
    };
  if (input.status === "accepted" && !input.confirmed)
    throw new Error("CAST_CONFIRMATION_REQUIRED");

  if (input.status === "accepted") {
    const before = playbackState(db, profileId, ownerDeviceId);
    startCast(db, profileId, ownerDeviceId, input.confirmed!);
    const action = existing.command.action;
    if (
      action === "seek" ||
      action === "skip-forward" ||
      action === "skip-backward"
    ) {
      recordMovement(db, profileId, ownerDeviceId, {
        commandId: input.commandId,
        episodeId: input.confirmed!.episodeId,
        type: action,
        fromPositionMs: before.positionMs,
        requestedPositionMs:
          action === "seek"
            ? (existing.command.positionMs ?? input.confirmed!.positionMs)
            : Math.max(
                0,
                before.positionMs +
                  (action === "skip-forward" ? 1 : -1) *
                    (existing.command.offsetMs ?? 0),
              ),
        confirmedPositionMs: input.confirmed!.positionMs,
      });
    }
  }
  const result = {
    status: input.status,
    ...(input.confirmed ? { confirmed: input.confirmed } : {}),
    ...(input.message ? { message: input.message } : {}),
  };
  db.prepare(
    `UPDATE playback_commands SET status = ?, result_json = ?, completed_at = ?
     WHERE command_id = ?`,
  ).run(
    input.status,
    JSON.stringify(result),
    new Date().toISOString(),
    input.commandId,
  );
  return {
    command: getCastCommand(db, profileId, input.commandId)!,
    playback: playbackState(db, profileId, ownerDeviceId),
  };
}

export function idleCastProfiles(db: DatabaseSync, now = new Date()): string[] {
  const cutoff = new Date(now.getTime() - CAST_IDLE_MS).toISOString();
  return (
    db
      .prepare(
        `SELECT profile_id FROM playback_state
         WHERE mode = 'cast' AND state != 'playing' AND updated_at <= ?`,
      )
      .all(cutoff) as unknown as Array<{ profile_id: string }>
  ).map((row) => row.profile_id);
}

export function expireIdleCast(
  db: DatabaseSync,
  profileId: string,
  now = new Date(),
): boolean {
  const cutoff = new Date(now.getTime() - CAST_IDLE_MS).toISOString();
  return (
    db
      .prepare(
        `UPDATE playback_state SET mode = 'local', state = 'paused',
         active_device_id = NULL, lease_expires_at = NULL,
         cast_owner_device_id = NULL, cast_session_id = NULL,
         revision = revision + 1, updated_at = ?
         WHERE profile_id = ? AND mode = 'cast' AND state != 'playing'
         AND updated_at <= ?`,
      )
      .run(now.toISOString(), profileId, cutoff).changes > 0
  );
}

export function releaseLease(
  db: DatabaseSync,
  profileId: string,
  deviceId: string,
): boolean {
  return (
    db
      .prepare(
        `UPDATE playback_state SET state = 'paused', active_device_id = NULL,
         lease_expires_at = NULL, revision = revision + 1, updated_at = ?
         WHERE profile_id = ? AND active_device_id = ?`,
      )
      .run(new Date().toISOString(), profileId, deviceId).changes > 0
  );
}

export function assertLease(
  db: DatabaseSync,
  profileId: string,
  deviceId: string,
): void {
  const row = db
    .prepare(
      "SELECT active_device_id, lease_expires_at FROM playback_state WHERE profile_id = ?",
    )
    .get(profileId) as
    | { active_device_id: string | null; lease_expires_at: string | null }
    | undefined;
  if (
    row?.active_device_id !== deviceId ||
    !row.lease_expires_at ||
    Date.parse(row.lease_expires_at) <= Date.now()
  )
    throw new Error("PLAYBACK_LEASE_REQUIRED");
}

export function updatePlayback(
  db: DatabaseSync,
  profileId: string,
  deviceId: string,
  input: {
    episodeId: string;
    positionMs: number;
    durationMs?: number | null | undefined;
    state: "playing" | "paused" | "stopped";
    playbackRate: number;
  },
): void {
  assertLease(db, profileId, deviceId);
  const now = new Date();
  db.prepare(
    `UPDATE playback_state SET episode_id = ?, position_ms = ?, duration_ms = ?,
     state = ?, playback_rate = ?, lease_expires_at = ?, revision = revision + 1,
     updated_at = ? WHERE profile_id = ?`,
  ).run(
    input.episodeId,
    input.positionMs,
    input.durationMs ?? null,
    input.state,
    input.playbackRate,
    new Date(now.getTime() + LEASE_MS).toISOString(),
    now.toISOString(),
    profileId,
  );
}

export function recordMovement(
  db: DatabaseSync,
  profileId: string,
  deviceId: string,
  input: {
    commandId: string;
    episodeId: string;
    type: "skip-forward" | "skip-backward" | "seek";
    fromPositionMs: number;
    requestedPositionMs: number;
    confirmedPositionMs: number;
  },
): boolean {
  assertLease(db, profileId, deviceId);
  const occurredAt = new Date().toISOString();
  const delta = input.confirmedPositionMs - input.fromPositionMs;
  const skipped = input.type === "skip-forward" ? Math.max(0, delta) : 0;
  const rewound = input.type === "skip-backward" ? Math.max(0, -delta) : 0;
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO movement_events(
       id, command_id, profile_id, device_id, episode_id, type,
       from_position_ms, requested_position_ms, confirmed_position_ms,
       skipped_forward_ms, rewound_ms, occurred_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      input.commandId,
      profileId,
      deviceId,
      input.episodeId,
      input.type,
      input.fromPositionMs,
      input.requestedPositionMs,
      input.confirmedPositionMs,
      skipped,
      rewound,
      occurredAt,
    );
  if (!inserted.changes) return false;
  rollup(db, profileId, occurredAt, 0, 0, skipped, rewound);
  return true;
}

function rollup(
  db: DatabaseSync,
  profileId: string,
  recordedAt: string,
  listenedMs: number,
  consumedMs: number,
  skippedMs: number,
  rewoundMs: number,
): void {
  const profile = db
    .prepare("SELECT timezone FROM profiles WHERE id = ?")
    .get(profileId) as { timezone: string };
  const date = localDate(recordedAt, profile.timezone);
  db.prepare(
    `INSERT INTO daily_listening_stats(
      profile_id, local_date, listened_ms, content_consumed_ms,
      skipped_forward_ms, rewound_ms, episodes_completed
    ) VALUES (?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(profile_id, local_date) DO UPDATE SET
      listened_ms = listened_ms + excluded.listened_ms,
      content_consumed_ms = content_consumed_ms + excluded.content_consumed_ms,
      skipped_forward_ms = skipped_forward_ms + excluded.skipped_forward_ms,
      rewound_ms = rewound_ms + excluded.rewound_ms`,
  ).run(profileId, date, listenedMs, consumedMs, skippedMs, rewoundMs);
}

export function recordEpisodeCompletion(
  db: DatabaseSync,
  profileId: string,
  recordedAt = new Date().toISOString(),
): void {
  const profile = db
    .prepare("SELECT timezone FROM profiles WHERE id = ?")
    .get(profileId) as { timezone: string };
  const date = localDate(recordedAt, profile.timezone);
  db.prepare(
    `INSERT INTO daily_listening_stats(
      profile_id, local_date, listened_ms, content_consumed_ms,
      skipped_forward_ms, rewound_ms, episodes_completed
    ) VALUES (?, ?, 0, 0, 0, 0, 1)
    ON CONFLICT(profile_id, local_date) DO UPDATE SET
      episodes_completed = episodes_completed + 1`,
  ).run(profileId, date);
}

export function ingestTelemetry(
  db: DatabaseSync,
  profileId: string,
  deviceId: string,
  input: {
    playbackInstanceId: string;
    sequence: number;
    episodeId: string;
    source: "web-local" | "android-local" | "cast";
    listenedMs: number;
    contentConsumedMs: number;
    recordedAt?: string | undefined;
  },
): boolean {
  assertLease(db, profileId, deviceId);
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO playback_telemetry(
       id, profile_id, device_id, episode_id, playback_instance_id, sequence,
       source, listened_ms, content_consumed_ms, recorded_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      profileId,
      deviceId,
      input.episodeId,
      input.playbackInstanceId,
      input.sequence,
      input.source,
      input.listenedMs,
      input.contentConsumedMs,
      recordedAt,
    );
  if (!inserted.changes) return false;
  rollup(
    db,
    profileId,
    recordedAt,
    input.listenedMs,
    input.contentConsumedMs,
    0,
    0,
  );
  return true;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function listeningStats(
  db: DatabaseSync,
  profileId: string,
  period: z.infer<typeof statsPeriodSchema>,
): ListeningStats {
  const profile = db
    .prepare("SELECT timezone FROM profiles WHERE id = ?")
    .get(profileId) as { timezone: string };
  const toDate = localDate(new Date().toISOString(), profile.timezone);
  const today = new Date(`${toDate}T12:00:00Z`);
  let fromDate: string | null = null;
  if (period === "today") fromDate = toDate;
  if (period === "7d")
    fromDate = isoDate(new Date(today.getTime() - 6 * 86_400_000));
  if (period === "30d")
    fromDate = isoDate(new Date(today.getTime() - 29 * 86_400_000));
  if (period === "year") fromDate = `${toDate.slice(0, 4)}-01-01`;
  const range = fromDate
    ? "profile_id = ? AND local_date BETWEEN ? AND ?"
    : "profile_id = ?";
  const params = fromDate ? [profileId, fromDate, toDate] : [profileId];
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(listened_ms), 0) listened_ms,
       COALESCE(SUM(content_consumed_ms), 0) consumed_ms,
       COALESCE(SUM(skipped_forward_ms), 0) skipped_ms,
       COALESCE(SUM(rewound_ms), 0) rewound_ms,
       COALESCE(SUM(episodes_completed), 0) completed,
       COALESCE(SUM(CASE WHEN listened_ms >= 60000 THEN 1 ELSE 0 END), 0) active_days
       FROM daily_listening_stats WHERE ${range}`,
    )
    .get(...params) as Record<string, number>;
  const allDates = (
    db
      .prepare(
        `SELECT local_date FROM daily_listening_stats
         WHERE profile_id = ? AND listened_ms >= 60000 ORDER BY local_date`,
      )
      .all(profileId) as unknown as { local_date: string }[]
  ).map((row) => row.local_date);
  let longestStreak = 0;
  let run = 0;
  let prior = "";
  for (const date of allDates) {
    const adjacent =
      prior &&
      isoDate(
        new Date(new Date(`${prior}T12:00:00Z`).getTime() + 86_400_000),
      ) === date;
    run = adjacent ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    prior = date;
  }
  const active = new Set(allDates);
  let currentStreak = 0;
  let cursor = today;
  if (!active.has(toDate)) cursor = new Date(today.getTime() - 86_400_000);
  while (active.has(isoDate(cursor))) {
    currentStreak++;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  const counts = db
    .prepare(
      `SELECT
       (SELECT COUNT(*) FROM subscriptions WHERE profile_id = ?) subscriptions,
       (SELECT COUNT(*) FROM history_events WHERE profile_id = ?) history`,
    )
    .get(profileId, profileId) as { subscriptions: number; history: number };
  return {
    period,
    fromDate,
    toDate,
    listenedMs: totals.listened_ms ?? 0,
    contentConsumedMs: totals.consumed_ms ?? 0,
    skippedForwardMs: totals.skipped_ms ?? 0,
    rewoundMs: totals.rewound_ms ?? 0,
    episodesCompleted: totals.completed ?? 0,
    activeListeningDays: totals.active_days ?? 0,
    subscriptions: counts.subscriptions,
    currentStreak,
    longestStreak,
    historyEntries: counts.history,
  };
}
