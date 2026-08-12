import express from "express";
import {
  commandSchema,
  episodeProgressSchema,
  episodeStateSchema,
  queueItemSchema,
  queueOrderSchema,
  subscribeSchema,
  subscriptionOrderSchema,
} from "@podwaffle/contracts";
import type { AppConfig } from "../config.js";
import type { PodwaffleDatabase } from "../db/connection.js";
import { getProfile } from "../db/repositories/profiles.js";
import {
  addQueueItem,
  addSubscription,
  advanceQueueAfterCompletion,
  downloadFeed,
  getEpisode,
  getPodcast,
  listEpisodes,
  listHistory,
  listInProgress,
  listQueue,
  listSubscriptions,
  normalizeQueue,
  reorderQueue,
  reorderSubscriptions,
  searchApple,
  setEpisodeProgress,
  setEpisodeState,
  upsertPodcastAndEpisodes,
} from "../podcasts/service.js";
import type { SyncService } from "../sync/service.js";
import { ApiError } from "./errors.js";
import { recordEpisodeCompletion } from "../playback/service.js";

function id(value: string | string[] | undefined): string {
  if (typeof value !== "string")
    throw new ApiError(404, "NOT_FOUND", "The requested item was not found");
  return value;
}

function checkRevision(
  database: PodwaffleDatabase,
  profileId: string,
  expectedRevision?: number,
): void {
  if (expectedRevision === undefined) return;
  const current = getProfile(database.db, profileId)?.revision ?? 0;
  if (current !== expectedRevision) {
    throw new ApiError(
      409,
      "REVISION_CONFLICT",
      "Profile state has changed",
      undefined,
      current,
    );
  }
}

function resultRevision(
  database: PodwaffleDatabase,
  profileId: string,
  eventRevision?: number,
): number {
  return eventRevision ?? getProfile(database.db, profileId)?.revision ?? 0;
}

export function createCatalogRouter(
  database: PodwaffleDatabase,
  sync: SyncService,
  config: AppConfig,
): express.Router {
  const router = express.Router();

  router.get("/discover/search", async (request, response, next) => {
    try {
      const query =
        typeof request.query.q === "string" ? request.query.q.trim() : "";
      if (query.length < 2 || query.length > 200) {
        throw new ApiError(
          400,
          "VALIDATION_FAILED",
          "q must contain between 2 and 200 characters",
        );
      }
      response.json({
        results: await searchApple(
          database.db,
          request.auth!.profile.id,
          query,
        ),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/subscriptions", (request, response) => {
    response.json({
      subscriptions: listSubscriptions(database.db, request.auth!.profile.id),
    });
  });

  router.post("/subscriptions", async (request, response, next) => {
    try {
      const command = subscribeSchema.parse(request.body);
      const downloaded = await downloadFeed(command.feedUrl);
      const profileId = request.auth!.profile.id;
      const applied = sync.command(
        profileId,
        command.commandId,
        "subscription.added",
        (db) => {
          checkRevision(database, profileId, command.expectedRevision);
          const catalog = upsertPodcastAndEpisodes(
            db,
            {
              feedUrl: command.feedUrl,
              ...(command.appleCollectionId === undefined
                ? {}
                : { appleCollectionId: command.appleCollectionId }),
              ...(command.title === undefined ? {} : { title: command.title }),
              ...(command.author === undefined
                ? {}
                : { author: command.author }),
              ...(command.artworkUrl === undefined
                ? {}
                : { artworkUrl: command.artworkUrl }),
            },
            downloaded,
            config.feed_refresh_minutes,
          );
          addSubscription(db, profileId, catalog.podcast.id);
          const subscription = listSubscriptions(db, profileId).find(
            (item) => item.id === catalog.podcast.id,
          );
          if (!subscription) throw new Error("Subscription was not created");
          return {
            result: { subscription },
            payload: {
              subscription,
              discoveredEpisodeIds: catalog.discoveredEpisodeIds,
            },
          };
        },
      );
      response.status(201).json({
        ...applied.result,
        revision: resultRevision(database, profileId, applied.event?.revision),
        replayed: applied.replayed,
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/subscriptions/:podcastId", (request, response, next) => {
    try {
      const command = commandSchema.parse(request.body);
      const profileId = request.auth!.profile.id;
      const podcastId = id(request.params.podcastId);
      const applied = sync.command(
        profileId,
        command.commandId,
        "subscription.removed",
        (db) => {
          checkRevision(database, profileId, command.expectedRevision);
          const deleted = db
            .prepare(
              "DELETE FROM subscriptions WHERE profile_id = ? AND podcast_id = ?",
            )
            .run(profileId, podcastId);
          if (deleted.changes === 0)
            throw new ApiError(404, "NOT_FOUND", "Subscription was not found");
          return {
            result: { podcastId },
            payload: { podcastId },
          };
        },
      );
      response.json({
        ...applied.result,
        revision: resultRevision(database, profileId, applied.event?.revision),
        replayed: applied.replayed,
      });
    } catch (error) {
      next(error);
    }
  });

  router.put("/subscriptions/order", (request, response, next) => {
    try {
      const command = subscriptionOrderSchema.parse(request.body);
      const profileId = request.auth!.profile.id;
      const applied = sync.command(
        profileId,
        command.commandId,
        "subscription.order.updated",
        (db) => {
          checkRevision(database, profileId, command.expectedRevision);
          try {
            reorderSubscriptions(db, profileId, command.podcastIds);
          } catch (error) {
            throw new ApiError(
              400,
              "INVALID_COMPLETE_ORDER",
              error instanceof Error ? error.message : "Invalid order",
            );
          }
          return {
            result: { subscriptions: listSubscriptions(db, profileId) },
            payload: { podcastIds: command.podcastIds },
          };
        },
      );
      response.json({
        ...applied.result,
        revision: resultRevision(database, profileId, applied.event?.revision),
        replayed: applied.replayed,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/podcasts/:podcastId", (request, response, next) => {
    try {
      const podcast = getPodcast(database.db, id(request.params.podcastId));
      if (!podcast)
        throw new ApiError(404, "NOT_FOUND", "Podcast was not found");
      response.json({ podcast });
    } catch (error) {
      next(error);
    }
  });

  router.get("/podcasts/:podcastId/episodes", (request, response) => {
    response.json({
      episodes: listEpisodes(
        database.db,
        request.auth!.profile.id,
        id(request.params.podcastId),
      ),
    });
  });

  router.post(
    "/podcasts/:podcastId/refresh",
    async (request, response, next) => {
      try {
        const command = commandSchema.parse(request.body);
        const podcastId = id(request.params.podcastId);
        const podcast = getPodcast(database.db, podcastId);
        if (!podcast)
          throw new ApiError(404, "NOT_FOUND", "Podcast was not found");
        const row = database.db
          .prepare("SELECT etag, last_modified FROM podcasts WHERE id = ?")
          .get(podcastId) as {
          etag: string | null;
          last_modified: string | null;
        };
        const headers: Record<string, string> = {};
        if (row.etag) headers["if-none-match"] = row.etag;
        if (row.last_modified) headers["if-modified-since"] = row.last_modified;
        const downloaded = await downloadFeed(podcast.feedUrl, headers);
        const profileId = request.auth!.profile.id;
        const applied = sync.command(
          profileId,
          command.commandId,
          "podcast.metadata.updated",
          (db) => {
            checkRevision(database, profileId, command.expectedRevision);
            const refreshed = upsertPodcastAndEpisodes(
              db,
              { feedUrl: podcast.feedUrl },
              downloaded,
              config.feed_refresh_minutes,
            );
            return {
              result: refreshed,
              payload: refreshed,
            };
          },
        );
        response.json({
          ...applied.result,
          revision: resultRevision(
            database,
            profileId,
            applied.event?.revision,
          ),
          replayed: applied.replayed,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get("/episodes/in-progress", (request, response) => {
    response.json({
      episodes: listInProgress(database.db, request.auth!.profile.id),
    });
  });

  router.get("/history", (request, response) => {
    response.json({
      episodes: listHistory(database.db, request.auth!.profile.id),
    });
  });

  router.get("/episodes/:episodeId", (request, response, next) => {
    try {
      const episode = getEpisode(
        database.db,
        request.auth!.profile.id,
        id(request.params.episodeId),
      );
      if (!episode)
        throw new ApiError(404, "NOT_FOUND", "Episode was not found");
      response.json({ episode });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/episodes/:episodeId/state", (request, response, next) => {
    try {
      const command = episodeStateSchema.parse(request.body);
      const profileId = request.auth!.profile.id;
      const episodeId = id(request.params.episodeId);
      const applied = sync.command(
        profileId,
        command.commandId,
        "episode.played-state.updated",
        (db) => {
          checkRevision(database, profileId, command.expectedRevision);
          if (!getEpisode(db, profileId, episodeId))
            throw new ApiError(404, "NOT_FOUND", "Episode was not found");
          const episode = setEpisodeState(
            db,
            profileId,
            episodeId,
            command.played,
          );
          return { result: { episode }, payload: { episode } };
        },
      );
      response.json({
        ...applied.result,
        revision: resultRevision(database, profileId, applied.event?.revision),
        replayed: applied.replayed,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/episodes/:episodeId/progress", (request, response, next) => {
    try {
      const command = episodeProgressSchema.parse(request.body);
      const profileId = request.auth!.profile.id;
      const episodeId = id(request.params.episodeId);
      const applied = sync.command(
        profileId,
        command.commandId,
        "episode.progress.updated",
        (db) => {
          checkRevision(database, profileId, command.expectedRevision);
          const priorEpisode = getEpisode(db, profileId, episodeId);
          if (!priorEpisode)
            throw new ApiError(404, "NOT_FOUND", "Episode was not found");
          const episode = setEpisodeProgress(
            db,
            profileId,
            episodeId,
            command.positionMs,
            command.durationMs,
            command.completed,
          );
          if (!priorEpisode.played && episode.played)
            recordEpisodeCompletion(db, profileId);
          const queue = episode.played
            ? advanceQueueAfterCompletion(db, profileId, episodeId)
            : listQueue(db, profileId);
          return {
            result: { episode, queue },
            payload: { episode, queue },
          };
        },
      );
      response.json({
        ...applied.result,
        revision: resultRevision(database, profileId, applied.event?.revision),
        replayed: applied.replayed,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/queue", (request, response) => {
    response.json({ queue: listQueue(database.db, request.auth!.profile.id) });
  });

  router.post("/queue/items", (request, response, next) => {
    try {
      const command = queueItemSchema.parse(request.body);
      const profileId = request.auth!.profile.id;
      const applied = sync.command(
        profileId,
        command.commandId,
        "queue.updated",
        (db) => {
          checkRevision(database, profileId, command.expectedRevision);
          if (!getEpisode(db, profileId, command.episodeId))
            throw new ApiError(404, "NOT_FOUND", "Episode was not found");
          const queue = addQueueItem(
            db,
            profileId,
            command.episodeId,
            command.position,
          );
          return { result: { queue }, payload: { queue } };
        },
      );
      response.status(201).json({
        ...applied.result,
        revision: resultRevision(database, profileId, applied.event?.revision),
        replayed: applied.replayed,
      });
    } catch (error) {
      next(error);
    }
  });

  router.put("/queue/order", (request, response, next) => {
    try {
      const command = queueOrderSchema.parse(request.body);
      const profileId = request.auth!.profile.id;
      const applied = sync.command(
        profileId,
        command.commandId,
        "queue.updated",
        (db) => {
          checkRevision(database, profileId, command.expectedRevision);
          let queue;
          try {
            queue = reorderQueue(db, profileId, command.queueItemIds);
          } catch (error) {
            throw new ApiError(
              400,
              "INVALID_COMPLETE_ORDER",
              error instanceof Error ? error.message : "Invalid order",
            );
          }
          return { result: { queue }, payload: { queue } };
        },
      );
      response.json({
        ...applied.result,
        revision: resultRevision(database, profileId, applied.event?.revision),
        replayed: applied.replayed,
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/queue/items/:queueItemId", (request, response, next) => {
    try {
      const command = commandSchema.parse(request.body);
      const profileId = request.auth!.profile.id;
      const queueItemId = id(request.params.queueItemId);
      const applied = sync.command(
        profileId,
        command.commandId,
        "queue.updated",
        (db) => {
          checkRevision(database, profileId, command.expectedRevision);
          const deleted = db
            .prepare("DELETE FROM queue_items WHERE id = ? AND profile_id = ?")
            .run(queueItemId, profileId);
          if (deleted.changes === 0)
            throw new ApiError(404, "NOT_FOUND", "Queue item was not found");
          const queue = normalizeQueue(db, profileId);
          return { result: { queue }, payload: { queue } };
        },
      );
      response.json({
        ...applied.result,
        revision: resultRevision(database, profileId, applied.event?.revision),
        replayed: applied.replayed,
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/queue", (request, response, next) => {
    try {
      const command = commandSchema.parse(request.body);
      const profileId = request.auth!.profile.id;
      const applied = sync.command(
        profileId,
        command.commandId,
        "queue.updated",
        (db) => {
          checkRevision(database, profileId, command.expectedRevision);
          db.prepare("DELETE FROM queue_items WHERE profile_id = ?").run(
            profileId,
          );
          return { result: { queue: [] }, payload: { queue: [] } };
        },
      );
      response.json({
        ...applied.result,
        revision: resultRevision(database, profileId, applied.event?.revision),
        replayed: applied.replayed,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
