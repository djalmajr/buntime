/**
 * Environment-based constants
 *
 * These are the minimal env vars needed at startup.
 * Additional config comes from environment variables via config.ts
 */
import { number } from "@buntime/shared/utils/zod-helpers";
import { z } from "zod";
import { version } from "../package.json";

const envSchema = z.object({
  DELAY_MS: number(100),
  NODE_ENV: z.enum(["development", "production", "staging", "test"]).default("development"),
  PORT: number(8000),
});

const { data, error } = envSchema.safeParse(Bun.env);

if (error) {
  const err = error.issues.map((v) => `${v.path.join(".")}: ${v.message}`).join(", ");
  throw new Error(`Missing/invalid env vars: ${err}`);
}

export const { DELAY_MS, NODE_ENV, PORT } = data;

export const IS_COMPILED = typeof BUNTIME_COMPILED !== "undefined" && BUNTIME_COMPILED;

export const IS_DEV = NODE_ENV === "development";

/** Graceful shutdown timeout in milliseconds */
export const SHUTDOWN_TIMEOUT_MS = 30_000;

/**
 * Body size limits for request payloads
 * Workers can configure their own limit up to MAX
 */
export const BodySizeLimits = {
  /** Default body size limit (10MB) */
  DEFAULT: 10 * 1024 * 1024,
  /** Maximum allowed body size (100MB) - ceiling for per-worker config */
  MAX: 100 * 1024 * 1024,
} as const;

export const VERSION = version;

/** Pattern to extract app name from pathname (e.g., "/my-app/page" → "my-app") */
export const APP_NAME_PATTERN = /^\/([^/]+)/;

/**
 * Normalize a URL path by removing duplicate slashes and trailing slashes
 * @example normalizePath("/_//api/") → "/_/api"
 * @example normalizePath("//api") → "/api"
 */
function normalizePath(path: string): string {
  return path.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

/**
 * Runtime API prefix from environment
 * When set, runtime API is mounted at {prefix}/api instead of /api
 * @example RUNTIME_API_PREFIX="/_" → API at "/_/api"
 */
export const RUNTIME_API_PREFIX = (Bun.env.RUNTIME_API_PREFIX || "").replace(/\/+$/, "");

/**
 * Runtime API path (computed from prefix)
 * @example "/api" (default) or "/_/api" (with prefix)
 */
export const API_PATH = normalizePath(`${RUNTIME_API_PREFIX}/api`);

/**
 * Reserved paths that cannot be used by plugins or apps
 * These are handled by the runtime or should return 404
 */
export const RESERVED_PATHS = [RUNTIME_API_PREFIX || "/api", "/.well-known"];

/**
 * HTTP headers used by Buntime for request routing
 */
export const Headers = {
  /** API key for CLI authentication (bypasses CSRF and other auth) */
  API_KEY: "x-api-key",
  /** Base path for asset loading (injected into HTML as <base href>) */
  BASE: "x-base",
  /** Marks request as internal (worker-to-runtime), bypasses CSRF Origin check */
  INTERNAL: "x-buntime-internal",
  /** Indicates 404 should be rendered by shell */
  NOT_FOUND: "x-not-found",
  /** Correlation ID for request tracing across components */
  REQUEST_ID: "x-request-id",
  /** Browser's fetch destination header */
  SEC_FETCH_DEST: "sec-fetch-dest",
  /** Browser's fetch mode header (navigate, cors, etc) */
  SEC_FETCH_MODE: "sec-fetch-mode",
} as const;

/**
 * Message types for worker communication
 */
export const MessageTypes = {
  /** Worker encountered an error */
  ERROR: "ERROR",
  /** Worker is idle (sent to worker to trigger onIdle callback) */
  IDLE: "IDLE",
  /** Worker is ready to receive requests */
  READY: "READY",
  /** Request sent to worker */
  REQUEST: "REQUEST",
  /** Response from worker */
  RESPONSE: "RESPONSE",
  /** Worker should terminate (sent to worker to trigger onTerminate callback) */
  TERMINATE: "TERMINATE",
} as const;

export type MessageType = (typeof MessageTypes)[keyof typeof MessageTypes];

/**
 * Common content types for HTTP responses
 */
export const ContentTypes = {
  HTML: "text/html",
  JSON: "application/json",
  PLAIN: "text/plain",
} as const;

/**
 * Worker status values for pool metrics
 */
export const WorkerState = {
  /** Worker is processing requests or recently active */
  ACTIVE: "active",
  /** Worker for TTL=0 configurations (ephemeral mode) */
  EPHEMERAL: "ephemeral",
  /** Worker is idle (no recent requests) */
  IDLE: "idle",
  /** Worker is not available (terminated/crashed) */
  OFFLINE: "offline",
} as const;

export type WorkerStatus = (typeof WorkerState)[keyof typeof WorkerState];
