import express from "express";
import {
  castStartSchema,
  castStopSchema,
  movementEventSchema,
  playbackCommandResultSchema,
  playbackCommandSchema,
  playbackLeaseSchema,
  playbackStateSchema,
  playbackTelemetrySchema,
  statsPeriodSchema,
} from "@podwaffle/contracts";
import type { PodwaffleDatabase } from "../db/connection.js";
import {
  acquireLease,
  createCastCommand,
  getCastCommand,
  ingestTelemetry,
  listeningStats,
  playbackState,
  recordMovement,
  releaseLease,
  recordEpisodeCompletion,
  resolveCastCommand,
  startCast,
  stopCast,
  updatePlayback,
} from "../playback/service.js";
import { getEpisode, setEpisodeProgress } from "../podcasts/service.js";
import type { SyncService } from "../sync/service.js";
import { ApiError } from "./errors.js";

function leaseError(error: unknown): never {
  if (error instanceof Error && error.message === "PLAYBACK_LEASE_REQUIRED")
    throw new ApiError(
      409,
      "PLAYBACK_LEASE_REQUIRED",
      "This device does not hold the active playback lease",
    );
  throw error;
}

export function createPlaybackRouter(
  database: PodwaffleDatabase,
  sync: SyncService,
  commandRelay?: {
    sendPlaybackCommand: (
      profileId: string,
      ownerDeviceId: string,
      command: ReturnType<typeof createCastCommand>["command"],
    ) => boolean;
  },
): express.Router {
  const router = express.Router();

  router.get("/playback", (request, response) => {
    response.json({
      playback: playbackState(
        database.db,
        request.auth!.profile.id,
        request.auth!.device.id,
      ),
    });
  });

  router.post("/playback/lease", (request, response, next) => {
    try {
      const input = playbackLeaseSchema.parse(request.body);
      const { profile, device } = request.auth!;
      const prior = playbackState(database.db, profile.id, device.id);
      const applied = sync.mutate(
        profile.id,
        "playback.owner.updated",
        (db) => {
          acquireLease(db, profile.id, device.id, input);
          const playback = playbackState(db, profile.id, device.id);
          return {
            result: { playback },
            payload: {
              playback,
              previousOwnerDeviceId: prior.activeDeviceId,
            },
          };
        },
      );
      response.json({ ...applied.result, revision: applied.event.revision });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/playback/lease", (request, response, next) => {
    try {
      const { profile, device } = request.auth!;
      const applied = sync.mutate(
        profile.id,
        "playback.owner.updated",
        (db) => {
          releaseLease(db, profile.id, device.id);
          const playback = playbackState(db, profile.id, device.id);
          return { result: { playback }, payload: { playback } };
        },
      );
      response.json({ ...applied.result, revision: applied.event.revision });
    } catch (error) {
      next(error);
    }
  });

  router.post("/playback/state", (request, response, next) => {
    try {
      const input = playbackStateSchema.parse(request.body);
      const { profile, device } = request.auth!;
      const applied = sync.mutate(
        profile.id,
        "playback.state.updated",
        (db) => {
          try {
            updatePlayback(db, profile.id, device.id, input);
          } catch (error) {
            leaseError(error);
          }
          // Playback state is the source of truth for the player position.
          // Mirror every confirmed position into episode_state so switching away
          // from an episode (or reloading the app) does not lose its progress.
          const priorEpisode = getEpisode(db, profile.id, input.episodeId);
          const episode = setEpisodeProgress(
            db,
            profile.id,
            input.episodeId,
            input.positionMs,
            input.durationMs,
          );
          if (priorEpisode && !priorEpisode.played && episode.played)
            recordEpisodeCompletion(db, profile.id);
          const playback = playbackState(db, profile.id, device.id);
          return {
            result: { playback, episode },
            payload: { playback, episode },
          };
        },
      );
      response.json({ ...applied.result, revision: applied.event.revision });
    } catch (error) {
      next(error);
    }
  });

  router.post("/playback/cast", (request, response, next) => {
    try {
      const input = castStartSchema.parse(request.body);
      const { profile, device } = request.auth!;
      const applied = sync.command(
        profile.id,
        input.commandId,
        "playback.cast.updated",
        (db) => {
          startCast(db, profile.id, device.id, input.confirmed);
          const playback = playbackState(db, profile.id, device.id);
          return { result: { playback }, payload: { playback } };
        },
      );
      response.json({
        ...applied.result,
        revision: applied.event?.revision ?? profile.revision,
        replayed: applied.replayed,
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/playback/cast", (request, response, next) => {
    try {
      const input = castStopSchema.parse(request.body);
      const { profile, device } = request.auth!;
      const applied = sync.command(
        profile.id,
        input.commandId,
        "playback.cast.updated",
        (db) => {
          try {
            stopCast(db, profile.id, device.id, input);
          } catch (error) {
            if (
              error instanceof Error &&
              error.message === "CAST_OWNER_REQUIRED"
            )
              throw new ApiError(
                409,
                "CAST_OWNER_REQUIRED",
                "This device does not own the Cast session",
              );
            throw error;
          }
          const playback = playbackState(db, profile.id, device.id);
          return { result: { playback }, payload: { playback } };
        },
      );
      response.json({
        ...applied.result,
        revision: applied.event?.revision ?? profile.revision,
        replayed: applied.replayed,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/playback/commands", (request, response, next) => {
    try {
      const command = playbackCommandSchema.parse(request.body);
      const { profile, device } = request.auth!;
      let stored: ReturnType<typeof createCastCommand>;
      try {
        stored = database.transaction(() =>
          createCastCommand(database.db, profile.id, device.id, command),
        );
      } catch (error) {
        if (error instanceof Error && error.message === "PLAYBACK_NOT_ACTIVE")
          throw new ApiError(
            409,
            "PLAYBACK_NOT_ACTIVE",
            "There is no connected playback owner for this profile",
          );
        throw error;
      }
      const delivered =
        stored.status !== "pending" ||
        (commandRelay?.sendPlaybackCommand(
          profile.id,
          stored.ownerDeviceId,
          stored.command,
        ) ??
          false);
      response.status(stored.status === "pending" ? 202 : 200).json({
        commandId: command.commandId,
        status: stored.status,
        delivered,
        replayed: stored.replayed,
        result: stored.result,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/playback/commands/:commandId/result",
    (request, response, next) => {
      try {
        const input = playbackCommandResultSchema.parse({
          ...request.body,
          commandId: request.params.commandId,
        });
        const { profile, device } = request.auth!;
        const result = applyCastCommandResult(
          database,
          sync,
          profile.id,
          device.id,
          input,
        );
        response.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post("/playback/movements", (request, response, next) => {
    try {
      const input = movementEventSchema.parse(request.body);
      const { profile, device } = request.auth!;
      let recorded = false;
      try {
        database.transaction(() => {
          recorded = recordMovement(database.db, profile.id, device.id, input);
        });
      } catch (error) {
        leaseError(error);
      }
      response.status(recorded ? 201 : 200).json({ recorded });
    } catch (error) {
      next(error);
    }
  });

  router.post("/playback/telemetry", (request, response, next) => {
    try {
      const input = playbackTelemetrySchema.parse(request.body);
      const { profile, device } = request.auth!;
      let recorded = false;
      try {
        database.transaction(() => {
          recorded = ingestTelemetry(database.db, profile.id, device.id, input);
        });
      } catch (error) {
        leaseError(error);
      }
      response.status(recorded ? 201 : 200).json({ recorded });
    } catch (error) {
      next(error);
    }
  });

  router.get("/stats", (request, response, next) => {
    try {
      const period = statsPeriodSchema.parse(request.query.period ?? "30d");
      response.json({
        stats: listeningStats(database.db, request.auth!.profile.id, period),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function applyCastCommandResult(
  database: PodwaffleDatabase,
  sync: SyncService,
  profileId: string,
  ownerDeviceId: string,
  input: {
    commandId: string;
    status: "accepted" | "rejected";
    confirmed?: Parameters<typeof resolveCastCommand>[3]["confirmed"];
    message?: string | undefined;
  },
) {
  const existing = getCastCommand(database.db, profileId, input.commandId);
  if (!existing)
    throw new ApiError(
      404,
      "CAST_COMMAND_NOT_FOUND",
      "The Cast command was not found",
    );
  if (existing.ownerDeviceId !== ownerDeviceId)
    throw new ApiError(
      409,
      "CAST_OWNER_REQUIRED",
      "This device does not own the Cast session",
    );
  if (existing.status !== "pending") {
    return {
      command: existing,
      playback: playbackState(database.db, profileId, ownerDeviceId),
      replayed: true,
    };
  }
  const current = playbackState(database.db, profileId, ownerDeviceId);
  const eventType =
    current.mode === "cast"
      ? "playback.cast.updated"
      : "playback.state.updated";
  const applied = sync.mutate(profileId, eventType, (db) => {
    const result = resolveCastCommand(db, profileId, ownerDeviceId, input);
    return {
      result,
      payload: {
        commandId: input.commandId,
        status: input.status,
        playback: result.playback,
      },
    };
  });
  return { ...applied.result, replayed: false };
}
