import type { NextFunction, Request, Response } from "express";
import type { DeviceRow } from "../db/repositories/devices.js";
import type { ProfileRow } from "../db/repositories/profiles.js";
import type { PodwaffleDatabase } from "../db/connection.js";
import { authenticateDevice } from "../db/repositories/devices.js";
import { getProfile } from "../db/repositories/profiles.js";
import { ApiError } from "../api/errors.js";

export const DEVICE_COOKIE = "pw_device";

declare global {
  // Express exposes request augmentation through this namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: {
        device: DeviceRow;
        profile: ProfileRow;
      };
    }
  }
}

export function parseCookies(
  header: string | undefined,
): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").flatMap((part) => {
      const index = part.indexOf("=");
      if (index < 0) return [];
      const key = part.slice(0, index).trim();
      const raw = part.slice(index + 1).trim();
      try {
        return [[key, decodeURIComponent(raw)]];
      } catch {
        return [];
      }
    }),
  );
}

export function tokenFromRequest(request: Request): string | undefined {
  const authorization = request.header("authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  return parseCookies(request.header("cookie"))[DEVICE_COOKIE];
}

export function authenticateToken(
  database: PodwaffleDatabase,
  token: string | undefined,
): { device: DeviceRow; profile: ProfileRow } | undefined {
  if (!token) return undefined;
  const device = authenticateDevice(database.db, token);
  if (!device) return undefined;
  const profile = getProfile(database.db, device.profile_id);
  if (!profile || !profile.enabled) return undefined;
  return { device, profile };
}

export function requireAuth(database: PodwaffleDatabase) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const token = tokenFromRequest(request);
    if (!token) {
      if (request.path === "/me") {
        response.status(204).end();
        return;
      }
      next(new ApiError(401, "AUTH_REQUIRED", "Authentication is required"));
      return;
    }
    const auth = authenticateToken(database, token);
    if (!auth) {
      if (request.path === "/me") {
        response.status(204).end();
        return;
      }
      next(
        new ApiError(
          401,
          "DEVICE_REVOKED",
          "The device credential is invalid or revoked",
        ),
      );
      return;
    }
    request.auth = auth;
    next();
  };
}
