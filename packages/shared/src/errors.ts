import type { HTTPResponseError } from "hono/types";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getLogger } from "./logger";

const IS_PRODUCTION = Bun.env.NODE_ENV === "production";
const logger = getLogger().child("errors");

export class AppError extends Error {
  public data?: unknown;

  constructor(
    message: string,
    public code: string,
    public statusCode: ContentfulStatusCode = 500,
    data?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.data = data;
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, code: string = "NOT_FOUND") {
    super(message, code, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, code: string = "VALIDATION_ERROR", data?: unknown) {
    super(message, code, 400, data);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string, code: string = "UNAUTHORIZED") {
    super(message, code, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string, code: string = "FORBIDDEN") {
    super(message, code, 403);
  }
}

/**
 * Convert an error to an HTTP response
 * In production, internal error details are hidden to prevent information leakage
 */
export function errorToResponse(error: Error | HTTPResponseError): Response {
  if (error instanceof AppError) {
    return Response.json(
      {
        success: false,
        code: error.code,
        message: error.message,
        ...(error.data ? { data: error.data } : {}),
      },
      { status: error.statusCode },
    );
  }

  // Log the full error server-side for debugging
  logger.error("Unhandled error", {
    error,
    stack: error instanceof Error ? error.stack : undefined,
  });

  // In production, hide internal error details to prevent information leakage
  const message = IS_PRODUCTION
    ? "An unexpected error occurred"
    : error instanceof Error
      ? error.message
      : "An unexpected error occurred";

  return Response.json(
    {
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message,
    },
    { status: 500 },
  );
}
