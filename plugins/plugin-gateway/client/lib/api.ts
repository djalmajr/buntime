import type { CorsRule } from "../../server/cors";
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
  CorsRule,
  GatewayStats,
  MetricsSnapshot,
  RateLimitMetrics,
  RequestLogEntry,
  ShellExcludeEntry,
};

/** Editable fields of a per-domain CORS rule (no id/createdAt) */
export interface CorsRuleInput {
  name: string;
  origins: string[];
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

/**
 * Gateway API client
 */
class GatewayApi {
  private baseUrl: string;

  constructor() {
    this.baseUrl = getApiBase();
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    // Same-origin cookie carries the operator session — no header injection needed.
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
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
    return this.fetch<GatewayStats>("/admin/stats");
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
    return this.fetch("/admin/config");
  }

  // =========================================================================
  // CORS rules (per-domain, runtime-editable)
  // =========================================================================

  /** List all per-domain CORS rules */
  async getCorsRules(): Promise<CorsRule[]> {
    return this.fetch<CorsRule[]>("/admin/cors/rules");
  }

  /** Create a new CORS rule (persisted and applied immediately, no restart) */
  async createCorsRule(rule: CorsRuleInput): Promise<CorsRule> {
    return this.fetch<CorsRule>("/admin/cors/rules", {
      method: "POST",
      body: JSON.stringify(rule),
    });
  }

  /** Update an existing CORS rule by id */
  async updateCorsRule(id: string, rule: CorsRuleInput): Promise<CorsRule> {
    return this.fetch<CorsRule>(`/admin/cors/rules/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(rule),
    });
  }

  /** Delete a CORS rule by id */
  async deleteCorsRule(id: string): Promise<{ removed: boolean }> {
    return this.fetch(`/admin/cors/rules/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  // =========================================================================
  // Rate Limiting
  // =========================================================================

  /**
   * Get rate limiter metrics
   */
  async getRateLimitMetrics(): Promise<RateLimitMetrics | null> {
    return this.fetch<RateLimitMetrics | null>("/admin/rate-limit/metrics");
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
    return this.fetch<BucketInfo[]>(`/admin/rate-limit/buckets${query ? `?${query}` : ""}`);
  }

  /**
   * Clear a specific rate limit bucket
   */
  async clearRateLimitBucket(key: string): Promise<{ success: boolean }> {
    return this.fetch(`/admin/rate-limit/buckets/${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
  }

  /**
   * Clear all rate limit buckets
   */
  async clearAllRateLimitBuckets(): Promise<{ success: boolean; cleared: number }> {
    return this.fetch("/admin/rate-limit/clear", { method: "POST" });
  }

  // =========================================================================
  // Metrics History
  // =========================================================================

  /**
   * Get historical metrics
   */
  async getMetricsHistory(limit = 60): Promise<MetricsSnapshot[]> {
    return this.fetch<MetricsSnapshot[]>(`/admin/metrics/history?limit=${limit}`);
  }

  // =========================================================================
  // Shell Configuration
  // =========================================================================

  /** Set a runtime shell directory override (applied immediately, no restart) */
  async setShellDir(dir: string): Promise<{ dir: string; source: string }> {
    return this.fetch("/admin/shell/config", {
      method: "PUT",
      body: JSON.stringify({ dir }),
    });
  }

  /** Clear the shell dir override, reverting to the ConfigMap/env seed */
  async resetShellDir(): Promise<{ dir: string | null; source: string; enabled: boolean }> {
    return this.fetch("/admin/shell/config/reset", { method: "POST" });
  }

  // =========================================================================
  // Shell Excludes
  // =========================================================================

  /**
   * Get shell excludes
   */
  async getShellExcludes(): Promise<ShellExcludeEntry[]> {
    return this.fetch<ShellExcludeEntry[]>("/admin/shell/excludes");
  }

  /**
   * Add a shell exclude
   */
  async addShellExclude(
    basename: string,
  ): Promise<{ added: boolean; basename: string; source: string }> {
    return this.fetch("/admin/shell/excludes", {
      method: "POST",
      body: JSON.stringify({ basename }),
    });
  }

  /**
   * Remove a shell exclude
   */
  async removeShellExclude(basename: string): Promise<{ removed: boolean; basename: string }> {
    return this.fetch(`/admin/shell/excludes/${encodeURIComponent(basename)}`, {
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
    return this.fetch<RequestLogEntry[]>(`/admin/logs${query ? `?${query}` : ""}`);
  }

  /**
   * Clear request logs
   */
  async clearLogs(): Promise<{ success: boolean }> {
    return this.fetch("/admin/logs", { method: "DELETE" });
  }
}

// Singleton instance
export const gatewayApi = new GatewayApi();
