import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Snapshot, SyncEvent, SyncEventType } from "@podwaffle/contracts";
import type { PodwaffleDatabase } from "../db/connection.js";
import {
  deviceIsPlaybackTarget,
  listProfileDevices,
  publicDevicePlatform,
  type DeviceRow,
} from "../db/repositories/devices.js";
import { getProfile } from "../db/repositories/profiles.js";
import { listQueue, listSubscriptions } from "../podcasts/service.js";
import { playbackState } from "../playback/service.js";

export interface SyncEventRow {
  revision: number;
  type: SyncEventType;
  payload_json: string;
  created_at: string;
}

export function mapDevice(row: DeviceRow, currentDeviceId?: string) {
  return {
    id: row.id,
    name: row.name,
    platform: publicDevicePlatform(row),
    appVersion: row.app_version,
    runtimeVersion: row.runtime_version,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    current: row.id === currentDeviceId,
    playbackTarget: deviceIsPlaybackTarget(row),
  };
}

export class SyncService {
  private readonly listeners = new Set<
    (profileId: string, event: SyncEvent) => void
  >();

  public constructor(private readonly database: PodwaffleDatabase) {}

  public subscribe(
    listener: (profileId: string, event: SyncEvent) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public appendEvent(
    db: DatabaseSync,
    profileId: string,
    type: SyncEventType,
    payload: Record<string, unknown>,
  ): SyncEvent {
    const now = new Date().toISOString();
    const profile = db
      .prepare("SELECT revision FROM profiles WHERE id = ?")
      .get(profileId) as { revision: number } | undefined;
    if (!profile) throw new Error("Profile not found");
    const revision = profile.revision + 1;
    db.prepare(
      "UPDATE profiles SET revision = ?, updated_at = ? WHERE id = ?",
    ).run(revision, now, profileId);
    db.prepare(
      `INSERT INTO sync_events(id, profile_id, revision, type, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      profileId,
      revision,
      type,
      JSON.stringify(payload),
      now,
    );
    return { revision, type, payload, createdAt: now };
  }

  public broadcast(profileId: string, event: SyncEvent): void {
    for (const listener of this.listeners) listener(profileId, event);
  }

  public mutate<T>(
    profileId: string,
    type: SyncEventType,
    work: (db: DatabaseSync) => {
      result: T;
      payload: Record<string, unknown>;
    },
  ): { result: T; event: SyncEvent } {
    const applied = this.database.transaction(() => {
      const mutation = work(this.database.db);
      const event = this.appendEvent(
        this.database.db,
        profileId,
        type,
        mutation.payload,
      );
      return { result: mutation.result, event };
    });
    this.broadcast(profileId, applied.event);
    return applied;
  }

  public command<T>(
    profileId: string,
    commandId: string,
    type: SyncEventType,
    work: (db: DatabaseSync) => {
      result: T;
      payload: Record<string, unknown>;
    },
  ): { result: T; event?: SyncEvent; replayed: boolean } {
    const existing = this.database.db
      .prepare(
        "SELECT response_json FROM processed_commands WHERE command_id = ? AND profile_id = ?",
      )
      .get(commandId, profileId) as { response_json: string } | undefined;
    if (existing) {
      return {
        result: JSON.parse(existing.response_json) as T,
        replayed: true,
      };
    }
    const applied = this.database.transaction(() => {
      const mutation = work(this.database.db);
      const event = this.appendEvent(
        this.database.db,
        profileId,
        type,
        mutation.payload,
      );
      this.database.db
        .prepare(
          `INSERT INTO processed_commands(command_id, profile_id, response_json, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          commandId,
          profileId,
          JSON.stringify(mutation.result),
          new Date().toISOString(),
        );
      return { result: mutation.result, event };
    });
    this.broadcast(profileId, applied.event);
    return { ...applied, replayed: false };
  }

  public eventsAfter(profileId: string, afterRevision: number): SyncEvent[] {
    const rows = this.database.db
      .prepare(
        `SELECT revision, type, payload_json, created_at FROM sync_events
         WHERE profile_id = ? AND revision > ? ORDER BY revision`,
      )
      .all(profileId, afterRevision) as unknown as SyncEventRow[];
    return rows.map((row) => ({
      revision: row.revision,
      type: row.type,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      createdAt: row.created_at,
    }));
  }

  public requiresSnapshot(profileId: string, afterRevision: number): boolean {
    const range = this.database.db
      .prepare(
        `SELECT MIN(revision) AS minimum, MAX(revision) AS maximum
         FROM sync_events WHERE profile_id = ?`,
      )
      .get(profileId) as { minimum: number | null; maximum: number | null };
    const profile = getProfile(this.database.db, profileId);
    if (!profile || afterRevision > profile.revision) return true;
    return range.minimum !== null && afterRevision < range.minimum - 1;
  }

  public snapshot(profileId: string, currentDeviceId: string): Snapshot {
    const profile = getProfile(this.database.db, profileId);
    if (!profile) throw new Error("Profile not found");
    return {
      revision: profile.revision,
      profile: {
        id: profile.id,
        displayName: profile.display_name,
        timezone: profile.timezone,
        settings: JSON.parse(profile.settings_json) as Record<string, unknown>,
      },
      devices: listProfileDevices(this.database.db, profileId).map((device) =>
        mapDevice(device, currentDeviceId),
      ),
      subscriptions: listSubscriptions(this.database.db, profileId),
      queue: listQueue(this.database.db, profileId),
      playback: playbackState(this.database.db, profileId, currentDeviceId),
    };
  }

  public prune(retentionDays: number): number {
    const cutoff = new Date(
      Date.now() - retentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const result = this.database.db
      .prepare("DELETE FROM sync_events WHERE created_at < ?")
      .run(cutoff);
    return Number(result.changes);
  }
}
