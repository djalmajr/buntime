---
name: errors
summary: |
  - Custom error classes in @buntime/shared/errors
  - Error format: { error, message, code, statusCode, data? }
  - Use specific errors: ValidationError, NotFoundError, UnauthorizedError
  - HTTP status codes: 400 (validation), 401 (auth), 404 (not found), 500 (internal)
  - Always include error code for client handling
  - Log errors with context (requestId, userId, etc.)
---

# Error Handling Guide

## Error Classes

Import from `@buntime/shared/errors`:

```typescript
import {
  AppError,           // Base class
  ValidationError,    // 400 - Bad Request
  NotFoundError,      // 404 - Not Found
  UnauthorizedError,  // 401 - Unauthorized
  ForbiddenError,     // 403 - Forbidden
  ConflictError,      // 409 - Conflict
  InternalError,      // 500 - Internal Server Error
} from "@buntime/shared/errors";
```

## Usage

### Throwing Errors

```typescript
// Validation error (400)
throw new ValidationError("Email is required", "MISSING_EMAIL");

// Not found (404)
throw new NotFoundError("User not found", "USER_NOT_FOUND");

// Unauthorized (401)
throw new UnauthorizedError("Invalid token", "INVALID_TOKEN");

// Forbidden (403)
throw new ForbiddenError("Access denied", "ACCESS_DENIED");

// Conflict (409)
throw new ConflictError("Email already exists", "DUPLICATE_EMAIL");

// Internal error (500)
throw new InternalError("Database connection failed", "DB_ERROR");
```

### With Additional Data

```typescript
throw new ValidationError("Invalid input", "VALIDATION_FAILED", {
  fields: {
    email: "Invalid format",
    age: "Must be positive",
  },
});

throw new NotFoundError("Resource not found", "NOT_FOUND", {
  resource: "user",
  id: "123",
});
```

## Response Format

All errors return consistent JSON:

```json
{
  "error": "ValidationError",
  "message": "Email is required",
  "code": "MISSING_EMAIL",
  "statusCode": 400,
  "data": {
    "field": "email"
  }
}
```

## Error Codes

Use SCREAMING_SNAKE_CASE for error codes:

| Category | Examples |
|----------|----------|
| Validation | `MISSING_FIELD`, `INVALID_FORMAT`, `TOO_LONG` |
| Auth | `INVALID_TOKEN`, `EXPIRED_TOKEN`, `MISSING_AUTH` |
| Not Found | `USER_NOT_FOUND`, `APP_NOT_FOUND`, `RESOURCE_NOT_FOUND` |
| Permission | `ACCESS_DENIED`, `INSUFFICIENT_PERMISSIONS` |
| Conflict | `DUPLICATE_EMAIL`, `ALREADY_EXISTS` |
| Internal | `DB_ERROR`, `UNEXPECTED_ERROR` |

## Hono Error Handler

```typescript
import { Hono } from "hono";
import { AppError } from "@buntime/shared/errors";

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({
      error: err.name,
      message: err.message,
      code: err.code,
      statusCode: err.statusCode,
      data: err.data,
    }, err.statusCode);
  }

  // Unknown error
  console.error("Unexpected error:", err);
  return c.json({
    error: "InternalError",
    message: "An unexpected error occurred",
    code: "UNEXPECTED_ERROR",
    statusCode: 500,
  }, 500);
});
```

## Common Patterns

### Validation

```typescript
function validateUser(data: unknown) {
  if (!data || typeof data !== "object") {
    throw new ValidationError("Invalid request body", "INVALID_BODY");
  }

  const { email, name } = data as Record<string, unknown>;

  if (!email) {
    throw new ValidationError("Email is required", "MISSING_EMAIL");
  }

  if (typeof email !== "string" || !email.includes("@")) {
    throw new ValidationError("Invalid email format", "INVALID_EMAIL");
  }

  if (!name || typeof name !== "string") {
    throw new ValidationError("Name is required", "MISSING_NAME");
  }

  return { email, name };
}
```

### Resource Lookup

```typescript
async function getUser(id: string) {
  const user = await db.users.findById(id);

  if (!user) {
    throw new NotFoundError(`User ${id} not found`, "USER_NOT_FOUND", { id });
  }

  return user;
}
```

### Auth Check

```typescript
function requireAuth(c: Context) {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    throw new UnauthorizedError("Missing authorization header", "MISSING_AUTH");
  }

  try {
    return verifyToken(token);
  } catch {
    throw new UnauthorizedError("Invalid or expired token", "INVALID_TOKEN");
  }
}
```

### Permission Check

```typescript
function requireAdmin(user: User) {
  if (!user.roles.includes("admin")) {
    throw new ForbiddenError("Admin access required", "ADMIN_REQUIRED");
  }
}
```

## Logging Errors

Always log with context:

```typescript
import { createLogger } from "@buntime/shared/logger";

const logger = createLogger("my-plugin");

try {
  await riskyOperation();
} catch (err) {
  logger.error("Operation failed", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    requestId: c.req.header("x-request-id"),
    userId: user?.id,
  });

  throw new InternalError("Operation failed", "OPERATION_FAILED");
}
```

## Testing Errors

```typescript
import { expect, it } from "bun:test";
import { ValidationError } from "@buntime/shared/errors";

it("should throw validation error for missing email", async () => {
  const req = new Request("http://localhost/api/users", {
    method: "POST",
    body: JSON.stringify({ name: "Test" }),
  });

  const res = await app.fetch(req);
  expect(res.status).toBe(400);

  const body = await res.json();
  expect(body.code).toBe("MISSING_EMAIL");
});

it("should return 404 for unknown user", async () => {
  const res = await app.fetch(new Request("http://localhost/api/users/unknown"));
  expect(res.status).toBe(404);

  const body = await res.json();
  expect(body.code).toBe("USER_NOT_FOUND");
});
```

## Best Practices

1. **Always use specific error classes** - Not generic `Error`
2. **Always include error code** - For client-side handling
3. **Keep messages user-friendly** - No stack traces to clients
4. **Log full details server-side** - Including stack traces
5. **Include context in data** - IDs, field names, etc.
6. **Use consistent codes** - Same code for same error type
7. **Document error codes** - In API documentation
