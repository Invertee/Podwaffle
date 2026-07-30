import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../api/errors.js";

interface AttemptBucket {
  count: number;
  resetAt: number;
}

export function joinRateLimit(maxAttempts = 10, windowMs = 15 * 60 * 1000) {
  const buckets = new Map<string, AttemptBucket>();
  return (request: Request, _response: Response, next: NextFunction): void => {
    const key = request.ip ?? request.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const current = buckets.get(key);
    const bucket =
      !current || current.resetAt <= now
        ? { count: 0, resetAt: now + windowMs }
        : current;
    bucket.count += 1;
    buckets.set(key, bucket);
    if (bucket.count > maxAttempts) {
      next(
        new ApiError(
          429,
          "RATE_LIMITED",
          "Too many join attempts; try again later",
        ),
      );
      return;
    }
    next();
  };
}
