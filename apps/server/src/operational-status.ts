import type { DatabaseSync } from "node:sqlite";
import type { Platform } from "@podwaffle/contracts";

import type { PodwaffleDatabase } from "./db/connection.js";
import {
  publicDevicePlatform,
  type DeviceRow,
} from "./db/repositories/devices.js";
import { log } from "./logging.js";
import type { PublicPushConfig } from "./push/service.js";

const ACTIVE_DEVICE_WINDOW_MS = 2 * 60_000;

interface ActiveApp {
  id: string;
  name: string;
  platform: Platform;
}

interface PlaybackSummary {
  profile: string;
  state: "playing" | "paused" | "stopped";
  mode: "local" | "cast";
  episode: string | null;
  podcast: string | null;
  device: string | null;
  positionMs: number;
  durationMs: number | null;
}

export interface OperationalSnapshot {
  apps: ActiveApp[];
  liveDeviceIds: string[];
  playback: PlaybackSummary[];
  push: PublicPushConfig & { registrations: number };
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function formatClock(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return "--:--";
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function platformName(platform: Platform): string {
  if (platform === "home_assistant") return "Home Assistant";
  if (platform === "android") return "Android";
  return "web";
}

export function formatOperationalSummary(
  snapshot: OperationalSnapshot,
): string {
  const liveIds = new Set(snapshot.liveDeviceIds);
  const platformCounts = new Map<Platform, number>();
  for (const app of snapshot.apps) {
    platformCounts.set(
      app.platform,
      (platformCounts.get(app.platform) ?? 0) + 1,
    );
  }
  const platforms = [...platformCounts.entries()]
    .map(([platform, count]) => `${count} ${platformName(platform)}`)
    .join(", ");
  const liveApps = snapshot.apps.filter((app) => liveIds.has(app.id)).length;
  const apiOnlyApps = snapshot.apps.length - liveApps;
  const connections =
    snapshot.apps.length === 0
      ? "No apps active in the last 2 minutes"
      : `${plural(snapshot.apps.length, "app")} active in the last 2 minutes (${platforms}); ${plural(liveApps, "live-sync connection")}, ${plural(apiOnlyApps, "API-only connection")}`;

  const playback = snapshot.playback
    .map((item) => {
      if (item.state === "stopped" || !item.episode) {
        return `${item.profile} is idle`;
      }
      const source = item.podcast ? ` from ${item.podcast}` : "";
      const destination =
        item.mode === "cast"
          ? ` via Cast${item.device ? ` (${item.device})` : ""}`
          : item.device
            ? ` on ${item.device}`
            : "";
      const progress = `${formatClock(item.positionMs)} / ${formatClock(item.durationMs)}`;
      return `${item.profile} is ${item.state}: “${item.episode}”${source}${destination} at ${progress}`;
    })
    .join("; ");

  return `${connections}. ${playback}.`;
}

function readSnapshot(
  db: DatabaseSync,
  liveDeviceIds: string[],
  push: PublicPushConfig,
  now: Date,
): OperationalSnapshot {
  const cutoff = new Date(
    now.getTime() - ACTIVE_DEVICE_WINDOW_MS,
  ).toISOString();
  const liveDevices = new Set(liveDeviceIds);
  const deviceRows = (
    db
      .prepare(
        `SELECT * FROM devices
       WHERE revoked_at IS NULL
       ORDER BY created_at`,
      )
      .all() as unknown as DeviceRow[]
  ).filter(
    (device) => device.last_seen_at >= cutoff || liveDevices.has(device.id),
  );
  const playback = db
    .prepare(
      `SELECT p.display_name profile, COALESCE(ps.state, 'stopped') state,
              COALESCE(ps.mode, 'local') mode, e.title episode,
              podcasts.title podcast, d.name device,
              COALESCE(ps.position_ms, 0) position_ms, ps.duration_ms
       FROM profiles p
       LEFT JOIN playback_state ps ON ps.profile_id = p.id
       LEFT JOIN episodes e ON e.id = ps.episode_id
       LEFT JOIN podcasts ON podcasts.id = e.podcast_id
       LEFT JOIN devices d ON d.id = ps.active_device_id
       WHERE p.enabled = 1 ORDER BY p.created_at`,
    )
    .all() as unknown as Array<{
    profile: string;
    state: PlaybackSummary["state"];
    mode: PlaybackSummary["mode"];
    episode: string | null;
    podcast: string | null;
    device: string | null;
    position_ms: number;
    duration_ms: number | null;
  }>;
  const registrationCount = db
    .prepare(
      `SELECT COUNT(*) count FROM push_registrations pr
       JOIN devices d ON d.id = pr.device_id
       WHERE d.revoked_at IS NULL`,
    )
    .get() as { count: number };
  return {
    apps: deviceRows.map((device) => ({
      id: device.id,
      name: device.name,
      platform: publicDevicePlatform(device),
    })),
    liveDeviceIds,
    playback: playback.map((item) => ({
      profile: item.profile,
      state: item.state,
      mode: item.mode,
      episode: item.episode,
      podcast: item.podcast,
      device: item.device,
      positionMs: item.position_ms,
      durationMs: item.duration_ms,
    })),
    push: { ...push, registrations: registrationCount.count },
  };
}

function statusDigest(snapshot: OperationalSnapshot): string {
  return JSON.stringify({
    apps: snapshot.apps.map(({ id, platform }) => ({ id, platform })),
    liveDeviceIds: [...snapshot.liveDeviceIds].sort(),
    playback: snapshot.playback.map((item) => ({
      ...item,
      positionMinute: Math.floor(item.positionMs / 60_000),
      positionMs: undefined,
    })),
    push: snapshot.push,
  });
}

export class OperationalStatusReporter {
  private lastDigest: string | undefined;

  public constructor(
    private readonly database: PodwaffleDatabase,
    private readonly liveDeviceIds: () => string[],
    private readonly pushConfig: () => PublicPushConfig,
  ) {}

  public report(force = false, now = new Date()): void {
    const snapshot = readSnapshot(
      this.database.db,
      this.liveDeviceIds(),
      this.pushConfig(),
      now,
    );
    const digest = statusDigest(snapshot);
    if (!force && digest === this.lastDigest) return;
    this.lastDigest = digest;
    log("info", "status.summary", {
      message: formatOperationalSummary(snapshot),
    });
  }
}
