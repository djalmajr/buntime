import type { HTTPResponseError } from "hono/types";
import type { ContentfulStatusCode } from "hono/utils/http-status";

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

  return Response.json(
    {
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "An unexpected error occurred",
    },
    { status: 500 },
  );
}
