import { mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import type { AppConfig } from "./config.js";
import { createApp } from "./app.js";
import { openDatabase, type PodwaffleDatabase } from "./db/connection.js";
import { synchronizeConfiguredProfiles } from "./db/repositories/profiles.js";
import { SyncService } from "./sync/service.js";
import { PodwaffleWebSocketServer } from "./websocket/server.js";
import { FeedScheduler } from "./podcasts/scheduler.js";

export interface Runtime {
  database: PodwaffleDatabase;
  sync: SyncService;
  webSockets: PodwaffleWebSocketServer;
  feedScheduler: FeedScheduler;
  server: Server;
  close: () => Promise<void>;
}

export async function createRuntime(
  config: AppConfig,
  options: { webDistPath?: string; migrationsDir?: string } = {},
): Promise<Runtime> {
  await Promise.all([
    mkdir(config.dataDir, { recursive: true }),
    mkdir(resolve(config.dataDir, "backups"), { recursive: true }),
    mkdir(resolve(config.dataDir, "artwork"), { recursive: true }),
    mkdir(resolve(config.dataDir, "logs"), { recursive: true }),
  ]);
  const database = await openDatabase(
    config.databasePath,
    options.migrationsDir,
  );
  database.transaction(() => {
    synchronizeConfiguredProfiles(database.db, config.profileNames);
  });
  const sync = new SyncService(database);
  sync.prune(config.sync_event_retention_days);
  const webSockets = new PodwaffleWebSocketServer(database, sync);
  const feedScheduler = new FeedScheduler(database, sync, config);
  const app = createApp({
    config,
    database,
    sync,
    webSockets,
    ...(options.webDistPath === undefined
      ? {}
      : { webDistPath: options.webDistPath }),
  });
  const server = createServer(app);
  webSockets.attach(server);
  feedScheduler.start();
  return {
    database,
    sync,
    webSockets,
    feedScheduler,
    server,
    close: async () => {
      feedScheduler.stop();
      webSockets.shutdown();
      if (server.listening) {
        await new Promise<void>((resolveClose, reject) =>
          server.close((error) => (error ? reject(error) : resolveClose())),
        );
      }
      database.checkpoint();
      database.close();
    },
  };
}
