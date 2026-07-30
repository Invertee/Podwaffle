import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface ProfileRow {
  id: string;
  slug: string;
  display_name: string;
  enabled: number;
  timezone: string;
  settings_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "");
  return slug || `profile-${randomUUID().slice(0, 8)}`;
}

export function synchronizeConfiguredProfiles(
  db: DatabaseSync,
  configuredNames: string[],
): void {
  const now = new Date().toISOString();
  const configured = new Set(
    configuredNames.map((name) => name.toLocaleLowerCase()),
  );
  const rows = db
    .prepare("SELECT * FROM profiles")
    .all() as unknown as ProfileRow[];

  for (const row of rows) {
    const shouldEnable = configured.has(row.display_name.toLocaleLowerCase());
    if (Boolean(row.enabled) !== shouldEnable) {
      db.prepare(
        "UPDATE profiles SET enabled = ?, updated_at = ? WHERE id = ?",
      ).run(shouldEnable ? 1 : 0, now, row.id);
    }
  }

  for (const name of configuredNames) {
    const existing = db
      .prepare("SELECT id FROM profiles WHERE display_name = ? COLLATE NOCASE")
      .get(name);
    if (existing) continue;
    db.prepare(
      `INSERT INTO profiles
       (id, slug, display_name, enabled, timezone, settings_json, revision, created_at, updated_at)
       VALUES (?, ?, ?, 1, 'UTC', '{}', 0, ?, ?)`,
    ).run(randomUUID(), slugify(name), name, now, now);
  }
}

export function listEnabledProfiles(db: DatabaseSync): ProfileRow[] {
  return db
    .prepare(
      "SELECT * FROM profiles WHERE enabled = 1 ORDER BY display_name COLLATE NOCASE",
    )
    .all() as unknown as ProfileRow[];
}

export function getProfile(
  db: DatabaseSync,
  id: string,
): ProfileRow | undefined {
  return db.prepare("SELECT * FROM profiles WHERE id = ?").get(id) as
    ProfileRow | undefined;
}
