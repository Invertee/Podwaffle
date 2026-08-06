import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { JoinRequest, Platform } from "@podwaffle/contracts";

export type DeviceScope =
  | "snapshot:read"
  | "sync:read"
  | "stats:read"
  | "playback:control"
  | "playback:write"
  | "playback:target"
  | "catalog:write"
  | "profile:write"
  | "devices:write";

interface DeviceCapabilities {
  clientKind?: "home_assistant";
  playbackTarget?: boolean;
  scopes?: Array<DeviceScope | "*">;
}

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

function capabilitiesFor(request: JoinRequest): DeviceCapabilities {
  if (request.platform !== "home_assistant") return {};
  return {
    clientKind: "home_assistant",
    playbackTarget: false,
    scopes: [
      "snapshot:read",
      "sync:read",
      "stats:read",
      "playback:control",
    ],
  };
}

export function deviceCapabilities(row: DeviceRow): DeviceCapabilities {
  try {
    const value = JSON.parse(row.capabilities_json) as DeviceCapabilities;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function publicDevicePlatform(row: DeviceRow): Platform {
  return deviceCapabilities(row).clientKind === "home_assistant"
    ? "home_assistant"
    : row.platform;
}

export function deviceIsPlaybackTarget(row: DeviceRow): boolean {
  const capabilities = deviceCapabilities(row);
  if (capabilities.clientKind === "home_assistant") return false;
  return capabilities.playbackTarget !== false;
}

export function deviceHasScope(row: DeviceRow, scope: DeviceScope): boolean {
  const capabilities = deviceCapabilities(row);
  // Existing web and Android credentials predate scopes and retain full profile
  // access. Only controller-class credentials are constrained.
  if (capabilities.clientKind !== "home_assistant") return true;
  return Boolean(
    capabilities.scopes?.includes("*") || capabilities.scopes?.includes(scope),
  );
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
  const storedPlatform =
    request.platform === "home_assistant" ? "web" : request.platform;
  db.prepare(
    `INSERT INTO devices
     (id, profile_id, name, platform, token_hash, app_version, runtime_version,
      capabilities_json, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    request.profileId,
    request.deviceName,
    storedPlatform,
    hashDeviceToken(token),
    request.appVersion ?? null,
    request.runtimeVersion ?? null,
    JSON.stringify(capabilitiesFor(request)),
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
