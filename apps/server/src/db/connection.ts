import { readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface PodwaffleDatabase {
  db: DatabaseSync;
  schemaVersion: number;
  close: () => void;
  checkpoint: () => void;
  transaction: <T>(work: () => T) => T;
}

export async function openDatabase(
  databasePath: string,
  migrationsDir = resolve(import.meta.dirname, "migrations"),
): Promise<PodwaffleDatabase> {
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const migrations = (await readdir(migrationsDir))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  for (const name of migrations) {
    const version = Number.parseInt(name.split("_")[0] ?? "", 10);
    const exists = db
      .prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
      .get(version);
    if (exists) continue;
    const sql = await readFile(resolve(migrationsDir, name), "utf8");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(sql);
      db.prepare(
        "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
      ).run(version, basename(name), new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      db.close();
      throw error;
    }
  }
  const row = db
    .prepare(
      "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
    )
    .get() as { version: number };

  return {
    db,
    schemaVersion: row.version,
    close: () => db.close(),
    checkpoint: () => {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    },
    transaction: <T>(work: () => T): T => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = work();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
