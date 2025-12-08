/**
 * Response Cache Entry
 */
interface CacheEntry {
  body: ArrayBuffer;
  headers: Record<string, string>;
  status: number;
  statusText: string;
  createdAt: number;
  ttl: number;
}

/**
 * Simple in-memory response cache
 */
export class ResponseCache {
  private cache: Map<string, CacheEntry> = new Map();
  private cleanupInterval: Timer | null = null;

  constructor(private maxEntries: number = 1000) {}

  /**
   * Generate cache key from request
   */
  getKey(req: Request): string {
    const url = new URL(req.url);
    return `${req.method}:${url.pathname}${url.search}`;
  }

  /**
   * Check if request is cacheable
   */
  isCacheable(req: Request, methods: string[]): boolean {
    return methods.includes(req.method.toUpperCase());
  }

  /**
   * Get cached response
   */
  get(key: string): Response | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.createdAt + entry.ttl * 1000) {
      this.cache.delete(key);
      return null;
    }

    // Reconstruct response
    const headers = new Headers(entry.headers);
    headers.set("X-Cache", "HIT");

    return new Response(entry.body, {
      headers,
      status: entry.status,
      statusText: entry.statusText,
    });
  }

  /**
   * Store response in cache
   */
  async set(key: string, response: Response, ttl: number): Promise<Response> {
    // Clone response to read body
    const cloned = response.clone();
    const body = await cloned.arrayBuffer();

    // Extract headers
    const headers: Record<string, string> = {};
    cloned.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // Store entry
    const entry: CacheEntry = {
      body,
      headers,
      status: cloned.status,
      statusText: cloned.statusText,
      createdAt: Date.now(),
      ttl,
    };

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(key, entry);

    // Return original response with cache header
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("X-Cache", "MISS");

    return new Response(response.body, {
      headers: responseHeaders,
      status: response.status,
      statusText: response.statusText,
    });
  }

  /**
   * Invalidate cache entry
   */
  invalidate(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Invalidate entries matching pattern
   */
  invalidatePattern(pattern: RegExp): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxEntries: number } {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
    };
  }

  /**
   * Start cleanup interval for expired entries
   */
  startCleanup(intervalMs: number = 60000): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();

      for (const [key, entry] of this.cache) {
        if (now > entry.createdAt + entry.ttl * 1000) {
          this.cache.delete(key);
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
}
