import { beforeEach, describe, expect, it } from "bun:test";
import { parseWindow, RateLimiter, TokenBucket } from "./rate-limit";

describe("parseWindow", () => {
  describe("valid formats", () => {
    it("should parse seconds without unit suffix", () => {
      expect(parseWindow("30")).toBe(30);
    });

    it("should parse seconds with 's' suffix", () => {
      expect(parseWindow("30s")).toBe(30);
    });

    it("should parse minutes with 'm' suffix", () => {
      expect(parseWindow("1m")).toBe(60);
      expect(parseWindow("5m")).toBe(300);
    });

    it("should parse hours with 'h' suffix", () => {
      expect(parseWindow("1h")).toBe(3600);
      expect(parseWindow("2h")).toBe(7200);
    });

    it("should parse days with 'd' suffix", () => {
      expect(parseWindow("1d")).toBe(86400);
      expect(parseWindow("7d")).toBe(604800);
    });
  });

  describe("invalid formats", () => {
    it("should throw for empty string", () => {
      expect(() => parseWindow("")).toThrow("Invalid window format");
    });

    it("should throw for invalid unit", () => {
      expect(() => parseWindow("10x")).toThrow("Invalid window format");
    });

    it("should throw for non-numeric value", () => {
      expect(() => parseWindow("abc")).toThrow("Invalid window format");
    });

    it("should throw for negative values", () => {
      expect(() => parseWindow("-10s")).toThrow("Invalid window format");
    });
  });
});

describe("TokenBucket", () => {
  let bucket: TokenBucket;

  describe("initialization", () => {
    it("should start with full capacity", () => {
      bucket = new TokenBucket(10, 1);
      expect(bucket.getTokens()).toBe(10);
    });
  });

  describe("consume", () => {
    beforeEach(() => {
      bucket = new TokenBucket(5, 1);
    });

    it("should consume tokens successfully when available", () => {
      expect(bucket.consume()).toBe(true);
      expect(bucket.getTokens()).toBe(4);
    });

    it("should consume multiple tokens sequentially", () => {
      expect(bucket.consume()).toBe(true);
      expect(bucket.consume()).toBe(true);
      expect(bucket.consume()).toBe(true);
      expect(bucket.getTokens()).toBe(2);
    });

    it("should deny requests when tokens exhausted", () => {
      // Exhaust all tokens
      for (let i = 0; i < 5; i++) {
        expect(bucket.consume()).toBe(true);
      }

      // Next request should be denied
      expect(bucket.consume()).toBe(false);
    });
  });

  describe("refill", () => {
    it("should refill tokens over time", async () => {
      bucket = new TokenBucket(10, 10); // 10 tokens/sec refill rate

      // Consume all tokens
      for (let i = 0; i < 10; i++) {
        bucket.consume();
      }
      expect(bucket.getTokens()).toBe(0);

      // Wait for refill (100ms should add ~1 token at 10 tokens/sec)
      await Bun.sleep(150);

      expect(bucket.getTokens()).toBeGreaterThanOrEqual(1);
    });

    it("should not exceed capacity when refilling", async () => {
      bucket = new TokenBucket(5, 100); // High refill rate

      await Bun.sleep(100);

      // Tokens should still be capped at capacity
      expect(bucket.getTokens()).toBe(5);
    });
  });

  describe("getRetryAfter", () => {
    it("should return 0 when tokens available", () => {
      bucket = new TokenBucket(10, 1);
      expect(bucket.getRetryAfter()).toBe(0);
    });

    it("should return positive value when exhausted", () => {
      bucket = new TokenBucket(1, 1);
      bucket.consume(); // Exhaust tokens

      const retryAfter = bucket.getRetryAfter();
      expect(retryAfter).toBeGreaterThan(0);
    });

    it("should return correct retry time based on refill rate", () => {
      bucket = new TokenBucket(1, 0.5); // 0.5 tokens/sec = 2 seconds per token
      bucket.consume();

      const retryAfter = bucket.getRetryAfter();
      // Should need ~2 seconds to get 1 token
      expect(retryAfter).toBeLessThanOrEqual(2);
      expect(retryAfter).toBeGreaterThan(0);
    });
  });
});

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter(10, 60); // 10 requests per 60 seconds
  });

  describe("isAllowed", () => {
    it("should allow requests within limit", () => {
      const result = limiter.isAllowed("client-1");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeLessThan(10);
    });

    it("should track separate buckets per key", () => {
      // Exhaust client-1
      for (let i = 0; i < 10; i++) {
        limiter.isAllowed("client-1");
      }

      // client-2 should still be allowed
      const result = limiter.isAllowed("client-2");
      expect(result.allowed).toBe(true);
    });

    it("should deny requests when limit exceeded", () => {
      const key = "client-exhausted";

      // Exhaust all tokens
      for (let i = 0; i < 10; i++) {
        expect(limiter.isAllowed(key).allowed).toBe(true);
      }

      // Next request should be denied
      const result = limiter.isAllowed(key);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it("should return correct remaining count", () => {
      const key = "client-count";

      const first = limiter.isAllowed(key);
      expect(first.remaining).toBeLessThan(10);

      const second = limiter.isAllowed(key);
      expect(second.remaining).toBeLessThan(first.remaining);
    });
  });

  describe("cleanup", () => {
    it("should remove full buckets during cleanup", async () => {
      limiter = new RateLimiter(10, 0.1); // Very short window for testing

      // Use a bucket
      limiter.isAllowed("client-cleanup");

      // Wait for bucket to refill
      await Bun.sleep(200);

      // Start cleanup and wait
      limiter.startCleanup(50);
      await Bun.sleep(100);

      limiter.stopCleanup();
    });

    it("should not start duplicate cleanup intervals", () => {
      limiter.startCleanup(100);
      limiter.startCleanup(100); // Should be no-op

      limiter.stopCleanup();
    });

    it("should safely stop when no cleanup running", () => {
      // Should not throw
      limiter.stopCleanup();
    });
  });

  describe("clear", () => {
    it("should remove all buckets", () => {
      limiter.isAllowed("client-a");
      limiter.isAllowed("client-b");
      limiter.isAllowed("client-c");

      limiter.clear();

      // After clear, a new request should have full capacity
      const result = limiter.isAllowed("client-a");
      expect(result.remaining).toBeLessThan(10);
      expect(result.remaining).toBeGreaterThan(8); // Should be ~9
    });
  });

  describe("refill rate calculation", () => {
    it("should calculate correct refill rate from window", async () => {
      // 10 requests per 1 second = 10 tokens/sec
      limiter = new RateLimiter(10, 1);

      // Exhaust tokens
      for (let i = 0; i < 10; i++) {
        limiter.isAllowed("fast-client");
      }

      // Wait for partial refill
      await Bun.sleep(150);

      // Should have some tokens back
      const result = limiter.isAllowed("fast-client");
      expect(result.allowed).toBe(true);
    });
  });
});
