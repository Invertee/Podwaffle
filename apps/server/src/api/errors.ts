import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import type { ApiErrorBody } from "@podwaffle/contracts";
import { log } from "../logging.js";

export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly currentRevision?: number,
  ) {
    super(message);
  }
}

export function notFound(
  _request: Request,
  _response: Response,
  next: NextFunction,
) {
  next(new ApiError(404, "NOT_FOUND", "The requested resource was not found"));
}

export function errorHandler(
  error: unknown,
  request: Request,
  response: Response<ApiErrorBody>,
  _next: NextFunction,
): void {
  void _next;
  let apiError: ApiError;
  if (error instanceof ApiError) {
    apiError = error;
  } else if (error instanceof ZodError) {
    apiError = new ApiError(
      400,
      "VALIDATION_FAILED",
      "The request was invalid",
      error.issues,
    );
  } else {
    apiError = new ApiError(
      500,
      "INTERNAL_ERROR",
      "An internal error occurred",
    );
    log("error", "request.failed", {
      requestId: request.requestId,
      method: request.method,
      path: request.path,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  response.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details === undefined ? {} : { details: apiError.details }),
      ...(apiError.currentRevision === undefined
        ? {}
        : { currentRevision: apiError.currentRevision }),
    },
  });
}
