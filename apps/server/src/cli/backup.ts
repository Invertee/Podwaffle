import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import { openDatabase } from "../db/connection.js";
import { createManagedBackup } from "../db/backup.js";

const config = await loadConfig();
const database = await openDatabase(config.databasePath);
try {
  const path = await createManagedBackup(
    database,
    resolve(config.dataDir, "backups"),
    config.backup_retention_count,
  );
  process.stdout.write(`${path}\n`);
} finally {
  database.close();
}
