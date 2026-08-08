import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import express, { type Express, type Response } from "express";
import {
  joinRequestSchema,
  revokeDeviceSchema,
  type Session,
  type SystemInfo,
} from "@podwaffle/contracts";
import type { AppConfig } from "./config.js";
import type { PodwaffleDatabase } from "./db/connection.js";
import { createDevice, listProfileDevices } from "./db/repositories/devices.js";
import { getProfile, listEnabledProfiles } from "./db/repositories/profiles.js";
import {
  DEVICE_COOKIE,
  requireAuth,
  requireScope,
} from "./auth/middleware.js";
import { joinRateLimit } from "./auth/rate-limit.js";
import { ApiError, errorHandler, notFound } from "./api/errors.js";
import { mapDevice, type SyncService } from "./sync/service.js";
import type { PodwaffleWebSocketServer } from "./websocket/server.js";
import { log } from "./logging.js";
import { openApiDocument } from "./api/openapi.js";
import { createCatalogRouter } from "./api/catalog.js";
import { createPlaybackRouter } from "./api/playback.js";
import { createProfileRouter } from "./api/profile.js";

export const BUILD_VERSION = process.env.PODWAFFLE_VERSION ?? "0.1.0";
export const API_VERSION = "v1" as const;

export interface AppDependencies {
  config: AppConfig;
  database: PodwaffleDatabase;
  sync: SyncService;
  webSockets: Pick<
    PodwaffleWebSocketServer,
    "revokeDevice" | "connectionCount" | "sendPlaybackCommand"
  >;
  webDistPath?: string;
}

function joinCodeMatches(expected: string, supplied: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length) {
    timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }
  return timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function sessionFor(
  profile: NonNullable<ReturnType<typeof getProfile>>,
  device: ReturnType<typeof listProfileDevices>[number],
): Session {
  return {
    profile: {
      id: profile.id,
      displayName: profile.display_name,
      revision: profile.revision,
      timezone: profile.timezone,
    },
    device: mapDevice(device, device.id),
  };
}

export function createApp(dependencies: AppDependencies): Express {
  const { config, database, sync, webSockets } = dependencies;
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use((request, response, next) => {
    request.requestId = request.header("x-request-id") ?? randomUUID();
    response.setHeader("x-request-id", request.requestId);
    const started = performance.now();
    response.on("finish", () => {
      log("info", "http.request", {
        requestId: request.requestId,
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationMs: Math.round(performance.now() - started),
        deviceId: request.auth?.device.id,
        profileId: request.auth?.profile.id,
      });
    });
    next();
  });

  app.get("/health", (_request, response) => {
    const databaseCheck = database.db.prepare("SELECT 1 AS ok").get() as {
      ok: number;
    };
    response.json({
      status: databaseCheck.ok === 1 ? "ok" : "degraded",
      ready: databaseCheck.ok === 1,
      version: BUILD_VERSION,
      schemaVersion: database.schemaVersion,
    });
  });

  app.get("/version.json", (_request, response: Response<SystemInfo>) => {
    response.setHeader("cache-control", "no-store");
    response.json({
      name: "Podwaffle",
      version: BUILD_VERSION,
      apiVersion: API_VERSION,
      schemaVersion: database.schemaVersion,
      ready: true,
    });
  });

  const api = express.Router();
  api.get("/system", (_request, response: Response<SystemInfo>) => {
    response.json({
      name: "Podwaffle",
      version: BUILD_VERSION,
      apiVersion: API_VERSION,
      schemaVersion: database.schemaVersion,
      ready: true,
    });
  });
  api.get("/openapi.json", (_request, response) => {
    response.setHeader("cache-control", "no-store");
    response.json(openApiDocument());
  });

  api.get("/join/profiles", (_request, response) => {
    response.json({
      profiles: listEnabledProfiles(database.db).map((profile) => ({
        id: profile.id,
        displayName: profile.display_name,
      })),
    });
  });

  api.post("/join", joinRateLimit(), (request, response, next) => {
    try {
      const joinRequest = joinRequestSchema.parse(request.body);
      const profile = getProfile(database.db, joinRequest.profileId);
      if (!profile?.enabled) {
        throw new ApiError(
          403,
          "PROFILE_DISABLED",
          "The selected profile is disabled",
        );
      }
      if (!joinCodeMatches(config.join_code, joinRequest.joinCode)) {
        throw new ApiError(
          401,
          "JOIN_CODE_INVALID",
          "The join code is invalid",
        );
      }
      const applied = sync.mutate(profile.id, "device.joined", (db) => {
        const created = createDevice(db, joinRequest);
        return {
          result: created,
          payload: {
            device: mapDevice(created.device, created.device.id),
          },
        };
      });
      const updatedProfile = getProfile(database.db, profile.id);
      if (!updatedProfile) throw new Error("Joined profile disappeared");
      if (joinRequest.platform === "web") {
        response.cookie(DEVICE_COOKIE, applied.result.token, {
          httpOnly: true,
          sameSite: "lax",
          secure:
            request.secure ||
            request.header("x-forwarded-proto")?.split(",")[0]?.trim() ===
              "https",
          path: "/",
          maxAge: 365 * 24 * 60 * 60 * 1000,
        });
        response.status(201).json({
          session: sessionFor(updatedProfile, applied.result.device),
          token: applied.result.token,
        });
      } else {
        response.status(201).json({
          session: sessionFor(updatedProfile, applied.result.device),
          token: applied.result.token,
        });
      }
    } catch (error) {
      next(error);
    }
  });

  api.post("/logout", (_request, response) => {
    response.clearCookie(DEVICE_COOKIE, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    response.status(204).end();
  });

  const authenticated = express.Router();
  authenticated.use(requireAuth(database));

  authenticated.get("/me", (request, response) => {
    const { profile, device } = request.auth!;
    response.json({ session: sessionFor(profile, device) });
  });

  authenticated.get(
    "/devices",
    requireScope("snapshot:read"),
    (request, response) => {
      response.json({
        devices: listProfileDevices(database.db, request.auth!.profile.id).map(
          (device) => mapDevice(device, request.auth!.device.id),
        ),
      });
    },
  );

  authenticated.delete(
    "/devices/:deviceId",
    requireScope("devices:write"),
    (request, response, next) => {
      try {
        const command = revokeDeviceSchema.parse(request.body);
        const { profile } = request.auth!;
        const targetId = request.params.deviceId;
        if (typeof targetId !== "string")
          throw new ApiError(404, "NOT_FOUND", "Device was not found");
        const applied = sync.command(
          profile.id,
          command.commandId,
          "device.revoked",
          (db) => {
            const currentProfile = getProfile(db, profile.id);
            if (
              command.expectedRevision !== undefined &&
              command.expectedRevision !== currentProfile?.revision
            ) {
              throw new ApiError(
                409,
                "REVISION_CONFLICT",
                "Profile state has changed",
                undefined,
                currentProfile?.revision ?? profile.revision,
              );
            }
            const target = db
              .prepare(
                "SELECT id FROM devices WHERE id = ? AND profile_id = ? AND revoked_at IS NULL",
              )
              .get(targetId, profile.id) as { id: string } | undefined;
            if (!target) {
              throw new ApiError(404, "NOT_FOUND", "Device was not found");
            }
            db.prepare("UPDATE devices SET revoked_at = ? WHERE id = ?").run(
              new Date().toISOString(),
              target.id,
            );
            return {
              result: { deviceId: target.id, revoked: true },
              payload: { deviceId: target.id },
            };
          },
        );
        webSockets.revokeDevice(targetId);
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
    },
  );

  authenticated.get(
    "/snapshot",
    requireScope("snapshot:read"),
    (request, response) => {
      response.json(
        sync.snapshot(request.auth!.profile.id, request.auth!.device.id),
      );
    },
  );

  authenticated.get(
    "/sync",
    requireScope("sync:read"),
    (request, response, next) => {
      try {
        const raw = request.query.afterRevision;
        const afterRevision =
          typeof raw === "string" && /^\d+$/.test(raw)
            ? Number(raw)
            : Number.NaN;
        if (!Number.isSafeInteger(afterRevision) || afterRevision < 0) {
          throw new ApiError(
            400,
            "VALIDATION_FAILED",
            "afterRevision must be a non-negative integer",
          );
        }
        const profileId = request.auth!.profile.id;
        if (sync.requiresSnapshot(profileId, afterRevision)) {
          response.status(409).json({
            snapshotRequired: true,
            currentRevision: getProfile(database.db, profileId)?.revision ?? 0,
          });
          return;
        }
        const events = sync.eventsAfter(profileId, afterRevision);
        response.json({
          events,
          currentRevision:
            events.at(-1)?.revision ??
            getProfile(database.db, profileId)?.revision ??
            afterRevision,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  authenticated.use("/profile", requireScope("profile:write"));
  authenticated.use(
    [
      "/discover",
      "/subscriptions",
      "/podcasts",
      "/episodes",
      "/history",
      "/queue",
    ],
    requireScope("catalog:write"),
  );
  authenticated.use(createProfileRouter(database, sync));
  authenticated.use(createCatalogRouter(database, sync, config));
  authenticated.use(createPlaybackRouter(database, sync, webSockets));
  api.use(authenticated);
  app.use("/api/v1", api);

  const webDistPath =
    dependencies.webDistPath ??
    process.env.PODWAFFLE_WEB_DIST ??
    resolve(import.meta.dirname, "../../web/dist");
  if (existsSync(webDistPath)) {
    app.use(
      "/assets",
      express.static(resolve(webDistPath, "assets"), {
        immutable: true,
        maxAge: "1y",
      }),
    );
    app.use(express.static(webDistPath, { index: false, maxAge: 0 }));
    app.get("*splat", (request, response, next) => {
      if (
        request.path.startsWith("/api/") ||
        request.path === "/health" ||
        request.path === "/version.json" ||
        request.path === "/ws"
      ) {
        next();
        return;
      }
      response.setHeader("cache-control", "no-store");
      response.sendFile(resolve(webDistPath, "index.html"));
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
