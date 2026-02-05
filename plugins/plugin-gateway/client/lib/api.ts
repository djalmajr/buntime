import type { MetricsSnapshot } from "../../server/persistence";
import type {
  BucketInfo,
  GatewayStats,
  RateLimitMetrics,
  RequestLogEntry,
  ShellExcludeEntry,
} from "../../server/types";
import { getApiBase } from "../helpers/sse";

// Re-export types
export type {
  BucketInfo,
  GatewayStats,
  MetricsSnapshot,
  RateLimitMetrics,
  RequestLogEntry,
  ShellExcludeEntry,
};

/**
 * Gateway API client
 */
class GatewayApi {
  private baseUrl: string;

  constructor() {
    this.baseUrl = getApiBase();
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // =========================================================================
  // Stats & Config
  // =========================================================================

  /**
   * Get gateway statistics
   */
  async getStats(): Promise<GatewayStats> {
    return this.fetch<GatewayStats>("/api/stats");
  }

  /**
   * Get gateway configuration
   */
  async getConfig(): Promise<{
    rateLimit: { requests: number; window: string; keyBy: string } | null;
    cors: {
      origin: string | string[];
      credentials: boolean;
      methods: string[];
      allowedHeaders: string[];
      exposedHeaders: string[];
      maxAge: number;
    } | null;
    shell: { dir: string; excludes: string[] } | null;
  }> {
    return this.fetch("/api/config");
  }

  // =========================================================================
  // Rate Limiting
  // =========================================================================

  /**
   * Get rate limiter metrics
   */
  async getRateLimitMetrics(): Promise<RateLimitMetrics | null> {
    return this.fetch<RateLimitMetrics | null>("/api/rate-limit/metrics");
  }

  /**
   * Get active rate limit buckets
   */
  async getRateLimitBuckets(options?: {
    limit?: number;
    sortBy?: "tokens" | "lastActivity";
  }): Promise<BucketInfo[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.sortBy) params.set("sortBy", options.sortBy);

    const query = params.toString();
    return this.fetch<BucketInfo[]>(`/api/rate-limit/buckets${query ? `?${query}` : ""}`);
  }

  /**
   * Clear a specific rate limit bucket
   */
  async clearRateLimitBucket(key: string): Promise<{ success: boolean }> {
    return this.fetch(`/api/rate-limit/buckets/${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
  }

  /**
   * Clear all rate limit buckets
   */
  async clearAllRateLimitBuckets(): Promise<{ success: boolean; cleared: number }> {
    return this.fetch("/api/rate-limit/clear", { method: "POST" });
  }

  // =========================================================================
  // Metrics History
  // =========================================================================

  /**
   * Get historical metrics
   */
  async getMetricsHistory(limit = 60): Promise<MetricsSnapshot[]> {
    return this.fetch<MetricsSnapshot[]>(`/api/metrics/history?limit=${limit}`);
  }

  // =========================================================================
  // Shell Excludes
  // =========================================================================

  /**
   * Get shell excludes
   */
  async getShellExcludes(): Promise<ShellExcludeEntry[]> {
    return this.fetch<ShellExcludeEntry[]>("/api/shell/excludes");
  }

  /**
   * Add a shell exclude
   */
  async addShellExclude(basename: string): Promise<{ added: boolean; basename: string; source: string }> {
    return this.fetch("/api/shell/excludes", {
      method: "POST",
      body: JSON.stringify({ basename }),
    });
  }

  /**
   * Remove a shell exclude
   */
  async removeShellExclude(basename: string): Promise<{ removed: boolean; basename: string }> {
    return this.fetch(`/api/shell/excludes/${encodeURIComponent(basename)}`, {
      method: "DELETE",
    });
  }

  // =========================================================================
  // Request Logs
  // =========================================================================

  /**
   * Get request logs
   */
  async getLogs(options?: {
    limit?: number;
    status?: number;
    rateLimited?: boolean;
    ip?: string;
  }): Promise<RequestLogEntry[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.status) params.set("status", String(options.status));
    if (options?.rateLimited !== undefined) params.set("rateLimited", String(options.rateLimited));
    if (options?.ip) params.set("ip", options.ip);

    const query = params.toString();
    return this.fetch<RequestLogEntry[]>(`/api/logs${query ? `?${query}` : ""}`);
  }

  /**
   * Clear request logs
   */
  async clearLogs(): Promise<{ success: boolean }> {
    return this.fetch("/api/logs", { method: "DELETE" });
  }
}

// Singleton instance
export const gatewayApi = new GatewayApi();
