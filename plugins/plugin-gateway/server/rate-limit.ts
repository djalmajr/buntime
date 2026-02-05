/**
 * Rate limiter metrics
 */
export interface RateLimitMetrics {
  /** Total requests processed */
  totalRequests: number;
  /** Requests that were blocked (rate limited) */
  blockedRequests: number;
  /** Requests that were allowed */
  allowedRequests: number;
  /** Number of active buckets (unique keys being tracked) */
  activeBuckets: number;
  /** Configuration */
  config: {
    capacity: number;
    windowSeconds: number;
  };
}

/**
 * Information about an active bucket
 */
export interface BucketInfo {
  /** The key (IP, user ID, etc.) */
  key: string;
  /** Current tokens available */
  tokens: number;
  /** Seconds until next token (0 if tokens available) */
  retryAfter: number;
  /** Last activity timestamp */
  lastActivity: number;
}

/**
 * Token Bucket Rate Limiter
 *
 * Algorithm:
 * - Bucket starts with `capacity` tokens
 * - Each request consumes 1 token
 * - Tokens are refilled at `refillRate` per second
 * - If no tokens available, request is denied
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private _lastActivity: number;

  constructor(
    private capacity: number,
    private refillRate: number, // tokens per second
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
    this._lastActivity = Date.now();
  }

  /**
   * Get last activity timestamp
   */
  get lastActivity(): number {
    return this._lastActivity;
  }

  /**
   * Try to consume a token
   * @returns true if token was consumed, false if rate limited
   */
  consume(): boolean {
    this.refill();
    this._lastActivity = Date.now();

    if (this.tokens < 1) {
      return false;
    }

    this.tokens -= 1;
    return true;
  }

  /**
   * Get current token count (for headers)
   */
  getTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /**
   * Get time until next token (in seconds)
   */
  getRetryAfter(): number {
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) / this.refillRate);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // seconds
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

/**
 * Rate Limiter with per-key buckets and metrics
 */
export class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private cleanupInterval: Timer | null = null;

  // Metrics counters
  private _totalRequests = 0;
  private _blockedRequests = 0;
  private _allowedRequests = 0;

  constructor(
    private capacity: number,
    private windowSeconds: number,
  ) {
    // Refill rate = capacity / window
    // e.g., 100 requests per 60 seconds = 100/60 = 1.67 tokens/sec
  }

  /**
   * Check if request is allowed
   * @param key - Unique identifier (IP, user ID, etc.)
   */
  isAllowed(key: string): { allowed: boolean; remaining: number; retryAfter: number } {
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = new TokenBucket(this.capacity, this.capacity / this.windowSeconds);
      this.buckets.set(key, bucket);
    }

    const allowed = bucket.consume();
    const remaining = bucket.getTokens();
    const retryAfter = bucket.getRetryAfter();

    // Update metrics
    this._totalRequests++;
    if (allowed) {
      this._allowedRequests++;
    } else {
      this._blockedRequests++;
    }

    return { allowed, remaining, retryAfter };
  }

  /**
   * Get aggregated metrics
   */
  getMetrics(): RateLimitMetrics {
    return {
      totalRequests: this._totalRequests,
      blockedRequests: this._blockedRequests,
      allowedRequests: this._allowedRequests,
      activeBuckets: this.buckets.size,
      config: {
        capacity: this.capacity,
        windowSeconds: this.windowSeconds,
      },
    };
  }

  /**
   * Get information about all active buckets
   */
  getActiveBuckets(): BucketInfo[] {
    const buckets: BucketInfo[] = [];

    for (const [key, bucket] of this.buckets) {
      buckets.push({
        key,
        tokens: bucket.getTokens(),
        retryAfter: bucket.getRetryAfter(),
        lastActivity: bucket.lastActivity,
      });
    }

    // Sort by last activity (most recent first)
    return buckets.sort((a, b) => b.lastActivity - a.lastActivity);
  }

  /**
   * Get top N clients by request volume (estimated by tokens consumed)
   */
  getTopClients(limit = 10): BucketInfo[] {
    const buckets = this.getActiveBuckets();

    // Sort by tokens consumed (capacity - current tokens = consumed since last refill)
    return buckets
      .map((b) => ({
        ...b,
        consumed: this.capacity - b.tokens,
      }))
      .sort((a, b) => b.consumed - a.consumed)
      .slice(0, limit);
  }

  /**
   * Clear a specific bucket
   * @returns true if bucket existed and was removed
   */
  clearBucket(key: string): boolean {
    return this.buckets.delete(key);
  }

  /**
   * Clear all buckets
   * @returns number of buckets cleared
   */
  clearAllBuckets(): number {
    const count = this.buckets.size;
    this.buckets.clear();
    return count;
  }

  /**
   * Reset metrics counters (useful for testing)
   */
  resetMetrics(): void {
    this._totalRequests = 0;
    this._blockedRequests = 0;
    this._allowedRequests = 0;
  }

  /**
   * Start cleanup interval for expired buckets
   */
  startCleanup(intervalMs: number = 60000): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      for (const [key, bucket] of this.buckets) {
        // Remove buckets that haven't been used recently
        if (bucket.getTokens() >= this.capacity) {
          this.buckets.delete(key);
        }
      }
    }, intervalMs);
  }

  /**
   * Stop cleanup interval
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Clear all buckets (legacy method for compatibility)
   */
  clear(): void {
    this.buckets.clear();
  }
}

/**
 * Parse window string to seconds
 * @example "1m" -> 60, "1h" -> 3600, "30s" -> 30
 */
export function parseWindow(window: string): number {
  const match = window.match(/^(\d+)(s|m|h|d)?$/);
  if (!match) {
    throw new Error(`Invalid window format: ${window}`);
  }

  const value = parseInt(match[1]!, 10);
  const unit = match[2] || "s";

  switch (unit) {
    case "s":
      return value;
    case "m":
      return value * 60;
    case "h":
      return value * 3600;
    case "d":
      return value * 86400;
    default:
      return value;
  }
}
