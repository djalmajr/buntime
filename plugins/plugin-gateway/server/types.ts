import type { BasePluginConfig } from "@buntime/shared/types";
import type { CorsConfig, CorsRule } from "./cors";
import type { MetricsSnapshot, ShellExcludeEntry } from "./persistence";
import type { BucketInfo, RateLimitMetrics } from "./rate-limit";
import type { RequestLogEntry } from "./request-log";

// Re-export types for convenience
export type {
  BucketInfo,
  CorsRule,
  MetricsSnapshot,
  RateLimitMetrics,
  RequestLogEntry,
  ShellExcludeEntry,
};

/**
 * SSE data sent to clients in real-time
 */
export interface GatewaySSEData {
  /** Timestamp of this snapshot */
  timestamp: number;

  /** Rate limiting information */
  rateLimit: {
    /** Aggregated metrics */
    metrics: RateLimitMetrics;
    /** Configuration */
    config: {
      requests: number;
      window: string;
      keyBy: "ip" | "user";
    };
  } | null;

  /** CORS configuration — per-domain rules */
  cors: {
    enabled: boolean;
    rules: CorsRule[];
  } | null;

  /** Shell configuration */
  shell: {
    enabled: boolean;
    dir: string;
    source: "override" | "default";
    seedDir: string | null;
    excludes: ShellExcludeEntry[];
  } | null;

  /** Recent log entries */
  recentLogs: RequestLogEntry[];
}

/**
 * Complete gateway stats (for /api/stats endpoint)
 */
export interface GatewayStats {
  /** Rate limiting stats */
  rateLimit: {
    enabled: boolean;
    metrics: RateLimitMetrics | null;
    config: RateLimitConfig | null;
  };

  /** CORS stats */
  cors: {
    enabled: boolean;
    rulesCount: number;
  };

  /** Cache stats (currently disabled) */
  cache: {
    enabled: boolean;
  };

  /** Shell stats */
  shell: {
    enabled: boolean;
    dir: string | null;
    excludesCount: number;
  };

  /** Request log stats */
  logs: {
    total: number;
    rateLimited: number;
    byStatus: Record<string, number>;
    avgDuration: number;
  };
}

export interface RateLimitConfig {
  /**
   * Maximum requests per window
   * @default 100
   */
  requests?: number;

  /**
   * Time window (e.g., "1m", "1h", "30s")
   * @default "1m"
   */
  window?: string;

  /**
   * Key extractor for rate limiting
   * - "ip": Use client IP
   * - "user": Use user ID from X-Identity header
   * - Function for custom key extraction
   * @default "ip"
   */
  keyBy?: "ip" | "user" | ((req: Request) => string);

  /**
   * Paths to exclude from rate limiting (regex patterns)
   */
  excludePaths?: string[];
}

export interface CacheConfig {
  /**
   * Default TTL in seconds
   * @default 60
   */
  ttl?: number;

  /**
   * HTTP methods to cache
   * @default ["GET"]
   */
  methods?: string[];

  /**
   * Maximum cache entries
   * @default 1000
   */
  maxEntries?: number;

  /**
   * Paths to exclude from caching (regex patterns)
   */
  excludePaths?: string[];
}

export interface GatewayConfig extends BasePluginConfig {
  /**
   * Path to the micro-frontend shell application
   * When configured, all browser navigations are served through this shell
   * Can be set via GATEWAY_SHELL_DIR env var
   * @example "/data/apps/example-spa/1.0.0"
   */
  shellDir?: string;

  /**
   * Basenames that bypass the AppShell (comma-separated)
   * Can be set via GATEWAY_SHELL_EXCLUDES env var or cookie with same name
   * @example "admin,legacy,reports"
   */
  shellExcludes?: string;

  /**
   * Response caching configuration
   */
  cache?: CacheConfig;

  /**
   * CORS configuration
   */
  cors?: CorsConfig;

  /**
   * Rate limiting configuration
   */
  rateLimit?: RateLimitConfig;
}

export type { CorsConfig };
