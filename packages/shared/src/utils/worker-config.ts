import type { PublicRoutesConfig } from "../types/plugin";
import { type Duration, parseDurationToMs } from "./duration";
import { parseSizeToBytes, type Size } from "./size";

/**
 * App visibility in the deployments UI
 * - "public": visible and editable (default)
 * - "protected": visible but read-only
 * - "internal": hidden from UI
 */
export type AppVisibility = "internal" | "protected" | "public";

/**
 * Worker config defaults
 */
export const WorkerConfigDefaults = {
  autoInstall: false,
  idleTimeout: 60,
  injectBase: false,
  lowMemory: false,
  maxRequests: 1000,
  timeout: 30,
  ttl: 0,
} as const;

/**
 * Worker configuration from manifest.yaml (human-readable format)
 * Used for type-checking manifest files
 *
 * @example
 * ```yaml
 * # manifest.yaml
 * entrypoint: dist/index.html
 * timeout: 30s
 * idleTimeout: 1m
 * maxBodySize: 50mb
 * injectBase: true
 * ```
 */
export interface WorkerManifest {
  autoInstall?: boolean;
  entrypoint?: string;

  /**
   * Additional environment variables to pass to the worker
   */
  env?: Record<string, string>;

  /**
   * Time before idle worker is terminated
   * @default 60 (seconds)
   * @example "1m" or 60
   */
  idleTimeout?: Duration;

  /**
   * Inject <base href> tag into HTML responses
   * Uses the x-base header value from the request
   * Required for SPAs served under a subpath to load assets correctly
   * @default false
   */
  injectBase?: boolean;

  /**
   * Use smaller memory footprint for worker
   * @default false
   */
  lowMemory?: boolean;

  /**
   * Maximum body size for this worker
   * If not set, uses the global bodySize.default
   * Cannot exceed global bodySize.max
   * @example "50mb" or 52428800
   */
  maxBodySize?: Size;

  /**
   * Maximum requests before worker is recycled
   * @default 1000
   */
  maxRequests?: number;

  /**
   * Routes that bypass plugin onRequest hooks
   * Routes are relative to the worker's base path
   * Supports wildcards: * (single segment), ** (multiple segments)
   * @example ["/api/health", "/public/**"]
   */
  publicRoutes?: PublicRoutesConfig;

  /**
   * Request timeout
   * @default 30 (seconds)
   * @example "30s" or 30
   */
  timeout?: Duration;

  /**
   * Worker time-to-live (0 = ephemeral, terminate after each request)
   * @default 0
   * @example "1h" or 3600
   */
  ttl?: Duration;

  /**
   * App visibility in the deployments UI
   * @default "public"
   */
  visibility?: AppVisibility;
}

/**
 * Worker configuration in normalized format (ms/bytes)
 * Used internally by runtime and plugins
 */
export interface WorkerConfig {
  autoInstall: boolean;
  entrypoint?: string;
  env?: Record<string, string>;
  idleTimeoutMs: number;
  injectBase: boolean;
  lowMemory: boolean;
  maxBodySizeBytes?: number;
  maxRequests: number;
  publicRoutes?: PublicRoutesConfig;
  timeoutMs: number;
  ttlMs: number;
}

/**
 * Parse manifest config to normalized format
 *
 * Converts human-readable values (seconds, "50mb") to internal format (ms, bytes).
 * Does NOT apply runtime-specific validations (bodySize limits, relationship checks).
 *
 * @param manifest - Worker manifest from YAML file
 * @returns Normalized worker config
 *
 * @example
 * ```typescript
 * const manifest = await loadManifestConfig(appDir);
 * const config = parseWorkerConfig(manifest);
 * // config.timeoutMs = 30000, config.maxBodySizeBytes = 52428800
 * ```
 */
export function parseWorkerConfig(manifest: WorkerManifest | null | undefined): WorkerConfig {
  return {
    autoInstall: manifest?.autoInstall ?? WorkerConfigDefaults.autoInstall,
    entrypoint: manifest?.entrypoint,
    env: manifest?.env,
    idleTimeoutMs: parseDurationToMs(manifest?.idleTimeout ?? WorkerConfigDefaults.idleTimeout),
    injectBase: manifest?.injectBase ?? WorkerConfigDefaults.injectBase,
    lowMemory: manifest?.lowMemory ?? WorkerConfigDefaults.lowMemory,
    maxBodySizeBytes: manifest?.maxBodySize ? parseSizeToBytes(manifest.maxBodySize) : undefined,
    maxRequests: manifest?.maxRequests ?? WorkerConfigDefaults.maxRequests,
    publicRoutes: manifest?.publicRoutes,
    timeoutMs: parseDurationToMs(manifest?.timeout ?? WorkerConfigDefaults.timeout),
    ttlMs: parseDurationToMs(manifest?.ttl ?? WorkerConfigDefaults.ttl),
  };
}
