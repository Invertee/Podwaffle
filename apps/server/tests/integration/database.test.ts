import { access, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createManagedBackup } from "../../src/db/backup.js";
import {
  openDatabase,
  type PodwaffleDatabase,
} from "../../src/db/connection.js";

const openDatabases: PodwaffleDatabase[] = [];

afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close();
});

describe("database lifecycle", () => {
  it("migrates empty and existing databases safely", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "podwaffle-db-"));
    const path = resolve(dir, "db.sqlite");
    const first = await openDatabase(path);
    expect(first.schemaVersion).toBe(3);
    first.close();

    const reopened = await openDatabase(path);
    openDatabases.push(reopened);
    expect(reopened.schemaVersion).toBe(3);
    const count = reopened.db
      .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
      .get() as { count: number };
    expect(count.count).toBe(3);
  });

  it("rolls back failed transactions", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "podwaffle-rollback-"));
    const database = await openDatabase(resolve(dir, "db.sqlite"));
    openDatabases.push(database);
    expect(() =>
      database.transaction(() => {
        database.db
          .prepare(
            `INSERT INTO profiles
             (id, slug, display_name, enabled, timezone, settings_json, revision, created_at, updated_at)
             VALUES ('one', 'one', 'One', 1, 'UTC', '{}', 0, 'now', 'now')`,
          )
          .run();
        throw new Error("fail");
      }),
    ).toThrow("fail");
    const count = database.db
      .prepare("SELECT COUNT(*) AS count FROM profiles")
      .get() as { count: number };
    expect(count.count).toBe(0);
  });

  it("creates a consistent managed backup and enforces retention", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "podwaffle-backup-"));
    const database = await openDatabase(resolve(dir, "db.sqlite"));
    openDatabases.push(database);
    const backupDir = resolve(dir, "backups");
    const first = await createManagedBackup(
      database,
      backupDir,
      1,
      new Date("2026-01-01T00:00:00Z"),
    );
    await access(first);
    const second = await createManagedBackup(
      database,
      backupDir,
      1,
      new Date("2026-01-02T00:00:00Z"),
    );
    await access(second);
    expect(await readdir(backupDir)).toEqual([
      "podwaffle-2026-01-02T00-00-00-000Z.sqlite",
    ]);
    const restored = await openDatabase(second);
    openDatabases.push(restored);
    expect(restored.schemaVersion).toBe(3);
  });
});
