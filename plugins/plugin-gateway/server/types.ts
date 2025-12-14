import type { BasePluginConfig } from "@buntime/shared/types";
import type { CorsConfig } from "./cors";

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
