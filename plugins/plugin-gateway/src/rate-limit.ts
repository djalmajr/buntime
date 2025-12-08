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

  constructor(
    private capacity: number,
    private refillRate: number, // tokens per second
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Try to consume a token
   * @returns true if token was consumed, false if rate limited
   */
  consume(): boolean {
    this.refill();

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
 * Rate Limiter with per-key buckets
 */
export class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private cleanupInterval: Timer | null = null;

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

    return { allowed, remaining, retryAfter };
  }

  /**
   * Start cleanup interval for expired buckets
   */
  startCleanup(intervalMs: number = 60000): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const maxAge = this.windowSeconds * 2 * 1000; // 2x window

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
   * Clear all buckets
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
