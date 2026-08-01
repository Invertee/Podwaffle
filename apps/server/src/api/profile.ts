import express from "express";
import { profileSettingsUpdateSchema } from "@podwaffle/contracts";

import type { PodwaffleDatabase } from "../db/connection.js";
import { getProfile } from "../db/repositories/profiles.js";
import type { SyncService } from "../sync/service.js";
import { ApiError } from "./errors.js";

export function createProfileRouter(
  database: PodwaffleDatabase,
  sync: SyncService,
): express.Router {
  const router = express.Router();

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
