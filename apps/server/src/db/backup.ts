import { mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { backup } from "node:sqlite";
import type { PodwaffleDatabase } from "./connection.js";

export async function createManagedBackup(
  database: PodwaffleDatabase,
  backupDir: string,
  retain = 7,
  now = new Date(),
): Promise<string> {
  await mkdir(backupDir, { recursive: true });
  database.checkpoint();
  const stamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const destination = resolve(backupDir, `podwaffle-${stamp}.sqlite`);
  await backup(database.db, destination);

  const backups = (await readdir(backupDir))
    .filter((name) => /^podwaffle-.+\.sqlite$/.test(name))
    .sort()
    .reverse();
  await Promise.all(
    backups.slice(retain).map((name) => rm(resolve(backupDir, name))),
  );
  return destination;
}
