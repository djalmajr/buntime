/**
 * Hono Context Types
 *
 * Defines typed context variables for Hono apps.
 * Using Hono's native context is more efficient than headers or WeakMap
 * because the context object is already allocated for each request.
 */

import type { ValidatedKey } from "@/libs/api-keys";

/**
 * Context variables shared across all routes
 */
export interface AppVariables {
  /** Correlation ID for request tracing */
  requestId: string;
  /** Validated API key (null if no valid key) */
  validatedKey: ValidatedKey | null;
}

/**
 * Hono Env type for use with Hono generic
 * Usage: new Hono<AppEnv>()
 */
export interface AppEnv {
  Variables: AppVariables;
}
