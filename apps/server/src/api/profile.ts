import express from "express";
import { profileSettingsUpdateSchema } from "@podwaffle/contracts";

import { requireScope } from "../auth/middleware.js";
import type { PodwaffleDatabase } from "../db/connection.js";
import {
  createApiKey,
  listProfileApiKeys,
  revokeProfileApiKey,
} from "../db/repositories/devices.js";
import { getProfile } from "../db/repositories/profiles.js";
import type { SyncService } from "../sync/service.js";
import { ApiError } from "./errors.js";

function apiKeyName(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "VALIDATION_FAILED", "API key name is required");
  }
  const name = value.trim();
  if (!name || name.length > 80) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "API key name must be between 1 and 80 characters",
    );
  }
  return name;
}

export function createProfileRouter(
  database: PodwaffleDatabase,
  sync: SyncService,
): express.Router {
  const router = express.Router();

  router.get(
    "/api-keys",
    requireScope("devices:write"),
    (request, response) => {
      response.json({
        apiKeys: listProfileApiKeys(database.db, request.auth!.profile.id),
      });
    },
  );

  router.post(
    "/api-keys",
    requireScope("devices:write"),
    (request, response, next) => {
      try {
        const name = apiKeyName(request.body?.name);
        const created = createApiKey(
          database.db,
          request.auth!.profile.id,
          name,
        );
        response.status(201).json(created);
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    "/api-keys/:apiKeyId",
    requireScope("devices:write"),
    (request, response, next) => {
      try {
        const apiKeyId = request.params.apiKeyId;
        if (
          typeof apiKeyId !== "string" ||
          !revokeProfileApiKey(
            database.db,
            request.auth!.profile.id,
            apiKeyId,
          )
        ) {
          throw new ApiError(404, "NOT_FOUND", "API key was not found");
        }
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch("/profile/settings", (request, response, next) => {
    try {
      const input = profileSettingsUpdateSchema.parse(request.body);
      const { profile } = request.auth!;
      const applied = sync.command(
        profile.id,
        input.commandId,
        "profile.settings.updated",
        (db) => {
          const current = getProfile(db, profile.id);
          if (!current) {
            throw new ApiError(404, "PROFILE_NOT_FOUND", "Profile was not found");
          }
          if (
            input.expectedRevision !== undefined &&
            input.expectedRevision !== current.revision
          ) {
            throw new ApiError(
              409,
              "REVISION_CONFLICT",
              "Profile state has changed",
              undefined,
              current.revision,
            );
          }
          const existing = JSON.parse(current.settings_json) as Record<
            string,
            unknown
          >;
          const settings = {
            ...existing,
            playback: input.playback,
          };
          db.prepare(
            "UPDATE profiles SET settings_json = ?, updated_at = ? WHERE id = ?",
          ).run(JSON.stringify(settings), new Date().toISOString(), profile.id);
          return {
            result: { settings },
            payload: { settings },
          };
        },
      );
      response.json({
        ...applied.result,
        revision:
          applied.event?.revision ??
          getProfile(database.db, profile.id)?.revision ??
          profile.revision,
        replayed: applied.replayed,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
