import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { JoinRequest } from "@podwaffle/contracts";

export interface DeviceRow {
  id: string;
  profile_id: string;
  name: string;
  platform: "web" | "android";
  token_hash: string;
  app_version: string | null;
  runtime_version: string | null;
  capabilities_json: string;
  last_seen_at: string;
  revoked_at: string | null;
  created_at: string;
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createDevice(
  db: DatabaseSync,
  request: JoinRequest,
): { device: DeviceRow; token: string } {
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO devices
     (id, profile_id, name, platform, token_hash, app_version, runtime_version,
      capabilities_json, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
  ).run(
    id,
    request.profileId,
    request.deviceName,
    request.platform,
    hashDeviceToken(token),
    request.appVersion ?? null,
    request.runtimeVersion ?? null,
    now,
    now,
  );
  return {
    token,
    device: db
      .prepare("SELECT * FROM devices WHERE id = ?")
      .get(id) as unknown as DeviceRow,
  };
}

export function authenticateDevice(
  db: DatabaseSync,
  token: string,
): DeviceRow | undefined {
  const row = db
    .prepare("SELECT * FROM devices WHERE token_hash = ?")
    .get(hashDeviceToken(token)) as DeviceRow | undefined;
  if (!row || row.revoked_at) return undefined;
  db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    row.id,
  );
  return row;
}

export function listProfileDevices(
  db: DatabaseSync,
  profileId: string,
): DeviceRow[] {
  return db
    .prepare(
      `SELECT * FROM devices
       WHERE profile_id = ? AND revoked_at IS NULL
       ORDER BY created_at`,
    )
    .all(profileId) as unknown as DeviceRow[];
}
