/**
 * Well-Known Routes (/.well-known)
 *
 * Provides service discovery endpoints following RFC 8615.
 * These endpoints expose runtime configuration for clients and plugins.
 */

import { Hono } from "hono";
import { API_PATH, VERSION } from "@/constants";

/**
 * Runtime configuration exposed at /.well-known/buntime
 */
export interface RuntimeInfo {
  /** Runtime API path (e.g., "/api" or "/_/api") */
  api: string;
  /** Runtime version */
  version: string;
}

/**
 * Create well-known routes
 */
export function createWellKnownRoutes() {
  return new Hono().get("/buntime", (ctx) => {
    const info: RuntimeInfo = {
      api: API_PATH,
      version: VERSION,
    };
    return ctx.json(info);
  });
}

export type WellKnownRoutesType = ReturnType<typeof createWellKnownRoutes>;
