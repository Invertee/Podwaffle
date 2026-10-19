import { mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import type { AppConfig } from "./config.js";
import { createApp } from "./app.js";
import { withBrowserControllerCors } from "./browser-controller-cors.js";
import { openDatabase, type PodwaffleDatabase } from "./db/connection.js";
import { synchronizeConfiguredProfiles } from "./db/repositories/profiles.js";
import { SyncService } from "./sync/service.js";
import { PodwaffleWebSocketServer } from "./websocket/server.js";
import { FeedScheduler } from "./podcasts/scheduler.js";
import { PushService } from "./push/service.js";
import { OperationalStatusReporter } from "./operational-status.js";
import { CastProgressWatchdog } from "./playback/cast-watchdog.js";
import { QueueExpiryService } from "./playback/queue-expiry.js";
import { AnalysisDispatcher } from "./analysis/service.js";
import { IntegratedAnalysis } from "./analysis/engine.js";
import { EpisodeMediaCache } from "./analysis/media.js";

export interface Runtime {
  database: PodwaffleDatabase;
  sync: SyncService;
  webSockets: PodwaffleWebSocketServer;
  feedScheduler: FeedScheduler;
  castWatchdog: CastProgressWatchdog;
  queueExpiry: QueueExpiryService;
  push: PushService;
  operationalStatus: OperationalStatusReporter;
  server: Server;
  analysis: IntegratedAnalysis;
  mediaCache: EpisodeMediaCache;
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
  const push = await PushService.create(config, database);
  push.start(sync);
  const webSockets = new PodwaffleWebSocketServer(database, sync, push);
  const operationalStatus = new OperationalStatusReporter(
    database,
    () => webSockets.connectedDeviceIds(),
    () => push.config(),
  );
  webSockets.setConnectionObserver(() => operationalStatus.report());
  const feedScheduler = new FeedScheduler(database, sync, config);
  const mediaCache = new EpisodeMediaCache(database.db, config);
  await mediaCache.recover();
  const analysis = new IntegratedAnalysis(config, mediaCache);
  const analysisDispatcher = new AnalysisDispatcher(
    database,
    sync,
    config,
    analysis,
  );
  const castWatchdog = new CastProgressWatchdog(
    database,
    config.cast_progress_watchdog,
    (profileId, ownerId, command) =>
      webSockets.sendPlaybackCommand(profileId, ownerId, command),
  );
  const queueExpiry = new QueueExpiryService(database, sync);
  const app = createApp({
    config,
    database,
    sync,
    push,
    webSockets,
    operationalStatus,
    analysis,
    mediaCache,
    queueExpiry,
    ...(options.webDistPath === undefined
      ? {}
      : { webDistPath: options.webDistPath }),
  });
  const server = createServer(
    withBrowserControllerCors((request, response) => {
      app(request, response);
    }),
  );
  webSockets.attach(server);
  feedScheduler.start();
  analysisDispatcher.start();
  castWatchdog.start();
  queueExpiry.start();
  return {
    database,
    sync,
    webSockets,
    operationalStatus,
    feedScheduler,
    castWatchdog,
    queueExpiry,
    push,
    server,
    analysis,
    mediaCache,
    close: async () => {
      queueExpiry.stop();
      castWatchdog.stop();
      feedScheduler.stop();
      await analysisDispatcher.stop();
      await analysis.stop();
      webSockets.shutdown();
      await push.close();
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
