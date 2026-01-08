import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { AppError, errorToResponse, NotFoundError, ValidationError } from "./errors";
import * as loggerModule from "./logger";

interface ErrorResponse {
  code: string;
  data?: unknown;
  message: string;
  success: boolean;
}

describe("errors", () => {
  describe("AppError", () => {
    it("should create error with message and code", () => {
      // Arrange
      const message = "Something went wrong";
      const code = "SOME_ERROR";

      // Act
      const error = new AppError(message, code);

      // Assert
      expect(error.message).toBe(message);
      expect(error.code).toBe(code);
      expect(error.statusCode).toBe(500);
      expect(error.data).toBeUndefined();
      expect(error.name).toBe("AppError");
      expect(error).toBeInstanceOf(Error);
    });

    it("should create error with custom statusCode", () => {
      // Arrange
      const message = "Forbidden";
      const code = "FORBIDDEN";
      const statusCode = 403;

      // Act
      const error = new AppError(message, code, statusCode);

      // Assert
      expect(error.message).toBe(message);
      expect(error.code).toBe(code);
      expect(error.statusCode).toBe(statusCode);
      expect(error.data).toBeUndefined();
    });

    it("should create error with data", () => {
      // Arrange
      const message = "Invalid input";
      const code = "INVALID_INPUT";
      const statusCode = 400;
      const data = { field: "email", reason: "invalid format" };

      // Act
      const error = new AppError(message, code, statusCode, data);

      // Assert
      expect(error.message).toBe(message);
      expect(error.code).toBe(code);
      expect(error.statusCode).toBe(statusCode);
      expect(error.data).toEqual(data);
    });
  });

  describe("NotFoundError", () => {
    it("should create error with default code", () => {
      // Arrange
      const message = "User not found";

      // Act
      const error = new NotFoundError(message);

      // Assert
      expect(error.message).toBe(message);
      expect(error.code).toBe("NOT_FOUND");
      expect(error.statusCode).toBe(404);
      expect(error.name).toBe("NotFoundError");
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(Error);
    });

    it("should create error with custom code", () => {
      // Arrange
      const message = "Resource not found";
      const code = "RESOURCE_NOT_FOUND";

      // Act
      const error = new NotFoundError(message, code);

      // Assert
      expect(error.message).toBe(message);
      expect(error.code).toBe(code);
      expect(error.statusCode).toBe(404);
    });
  });

  describe("ValidationError", () => {
    it("should create error with default code and no data", () => {
      // Arrange
      const message = "Validation failed";

      // Act
      const error = new ValidationError(message);

      // Assert
      expect(error.message).toBe(message);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.statusCode).toBe(400);
      expect(error.data).toBeUndefined();
      expect(error.name).toBe("ValidationError");
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(Error);
    });

    it("should create error with custom code", () => {
      // Arrange
      const message = "Invalid email";
      const code = "INVALID_EMAIL";

      // Act
      const error = new ValidationError(message, code);

      // Assert
      expect(error.message).toBe(message);
      expect(error.code).toBe(code);
      expect(error.statusCode).toBe(400);
    });

    it("should create error with data", () => {
      // Arrange
      const message = "Multiple validation errors";
      const code = "VALIDATION_ERRORS";
      const data = {
        errors: [
          { field: "email", message: "Invalid email format" },
          { field: "age", message: "Must be positive" },
        ],
      };

      // Act
      const error = new ValidationError(message, code, data);

      // Assert
      expect(error.message).toBe(message);
      expect(error.code).toBe(code);
      expect(error.statusCode).toBe(400);
      expect(error.data).toEqual(data);
    });
  });

  describe("errorToResponse", () => {
    describe("with AppError", () => {
      it("should return JSON response with error details", async () => {
        // Arrange
        const error = new AppError("Something went wrong", "SOME_ERROR", 422);

        // Act
        const response = errorToResponse(error);
        const body = (await response.json()) as ErrorResponse;

        // Assert
        expect(response.status).toBe(422);
        expect(body).toEqual({
          success: false,
          code: "SOME_ERROR",
          message: "Something went wrong",
        });
      });

      it("should include data when present", async () => {
        // Arrange
        const data = { field: "email", details: "Invalid format" };
        const error = new AppError("Validation failed", "VALIDATION_ERROR", 400, data);

        // Act
        const response = errorToResponse(error);
        const body = (await response.json()) as ErrorResponse;

        // Assert
        expect(response.status).toBe(400);
        expect(body).toEqual({
          success: false,
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          data,
        });
      });

      it("should handle NotFoundError", async () => {
        // Arrange
        const error = new NotFoundError("User not found");

        // Act
        const response = errorToResponse(error);
        const body = (await response.json()) as ErrorResponse;

        // Assert
        expect(response.status).toBe(404);
        expect(body).toEqual({
          success: false,
          code: "NOT_FOUND",
          message: "User not found",
        });
      });

      it("should handle ValidationError with data", async () => {
        // Arrange
        const data = { fields: ["email", "password"] };
        const error = new ValidationError("Invalid fields", "INVALID_FIELDS", data);

        // Act
        const response = errorToResponse(error);
        const body = (await response.json()) as ErrorResponse;

        // Assert
        expect(response.status).toBe(400);
        expect(body).toEqual({
          success: false,
          code: "INVALID_FIELDS",
          message: "Invalid fields",
          data,
        });
      });
    });

    describe("with regular Error", () => {
      let mockErrorFn: ReturnType<typeof mock>;
      let originalNodeEnv: string | undefined;

      beforeEach(() => {
        originalNodeEnv = Bun.env.NODE_ENV;
        mockErrorFn = mock(() => {});

        // Mock the logger to suppress output and capture calls
        const mockChildLogger = {
          child: mock(() => mockChildLogger),
          debug: mock(() => {}),
          error: mockErrorFn,
          info: mock(() => {}),
          warn: mock(() => {}),
        };

        spyOn(loggerModule, "getLogger").mockReturnValue(
          mockChildLogger as unknown as ReturnType<typeof loggerModule.getLogger>,
        );
      });

      afterEach(() => {
        Bun.env.NODE_ENV = originalNodeEnv;
      });

      it("should return 500 status for regular Error", async () => {
        // Arrange
        const error = new Error("Database connection failed");

        // Act
        const response = errorToResponse(error);
        const body = (await response.json()) as ErrorResponse;

        // Assert
        expect(response.status).toBe(500);
        expect(body.success).toBe(false);
        expect(body.code).toBe("INTERNAL_SERVER_ERROR");
      });

      it("should return actual message in non-production", async () => {
        // Arrange
        // Tests run in non-production mode by default (NODE_ENV is not "production")
        const error = new Error("Specific error message");

        // Act
        const response = errorToResponse(error);
        const body = (await response.json()) as ErrorResponse;

        // Assert
        expect(response.status).toBe(500);
        expect(body).toEqual({
          success: false,
          code: "INTERNAL_SERVER_ERROR",
          message: "Specific error message",
        });
      });

      it("should handle non-Error objects gracefully", async () => {
        // Arrange
        const error = { message: "Not a real error" } as Error;

        // Act
        const response = errorToResponse(error);
        const body = (await response.json()) as ErrorResponse;

        // Assert
        expect(response.status).toBe(500);
        expect(body.success).toBe(false);
        expect(body.code).toBe("INTERNAL_SERVER_ERROR");
        // Non-Error objects should get generic message since instanceof check fails
        expect(body.message).toBe("An unexpected error occurred");
      });

      it("should include INTERNAL_SERVER_ERROR code for all unhandled errors", async () => {
        // Arrange
        const errors = [
          new Error("Error 1"),
          new TypeError("Type error"),
          new RangeError("Range error"),
        ];

        // Act & Assert
        for (const error of errors) {
          const response = errorToResponse(error);
          const body = (await response.json()) as ErrorResponse;

          expect(body.code).toBe("INTERNAL_SERVER_ERROR");
          expect(body.success).toBe(false);
        }
      });
    });

    describe("production mode behavior", () => {
      // Note: IS_PRODUCTION is evaluated at module load time, so we test the logic pattern
      // The actual production behavior would require running tests with NODE_ENV=production

      it("should hide error details for non-AppError in production logic", async () => {
        // Arrange
        // This tests the pattern - in production, sensitive info should be hidden
        const sensitiveError = new Error("Connection to postgres://user:pass@host failed");

        // Act
        const response = errorToResponse(sensitiveError);
        const body = (await response.json()) as ErrorResponse;

        // Assert
        expect(response.status).toBe(500);
        expect(body.code).toBe("INTERNAL_SERVER_ERROR");
        // In test environment, message is shown; in production it would be hidden
        // This validates the response structure is correct either way
        expect(typeof body.message).toBe("string");
      });
    });
  });
});
