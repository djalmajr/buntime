import { describe, expect, it } from "bun:test";

import { validateWorkerConfig } from "./config-validation";

describe("validateWorkerConfig", () => {
  describe("default values (empty config)", () => {
    it("should be valid with empty config", () => {
      // ARRANGE
      const config = {};

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });
  });

  describe("ephemeral workers (ttl=0)", () => {
    it("should skip validation when ttl is 0", () => {
      // ARRANGE
      const config = { idleTimeout: 1, timeout: 100, ttl: 0 };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it("should skip validation when ttl is not provided (defaults to 0)", () => {
      // ARRANGE
      const config = { idleTimeout: 1, timeout: 100 };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should skip validation when ttl is '0s'", () => {
      // ARRANGE
      const config = { idleTimeout: "1s", timeout: "100s", ttl: "0s" };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe("persistent workers with valid config", () => {
    it("should be valid when ttl >= timeout and idleTimeout >= timeout", () => {
      // ARRANGE
      const config = { idleTimeout: 60, timeout: 30, ttl: 300 };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should be valid when ttl equals timeout", () => {
      // ARRANGE
      const config = { idleTimeout: 60, timeout: 60, ttl: 60 };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should be valid when idleTimeout equals timeout", () => {
      // ARRANGE
      const config = { idleTimeout: 30, timeout: 30, ttl: 300 };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should be valid when idleTimeout equals ttl", () => {
      // ARRANGE
      const config = { idleTimeout: 60, timeout: 30, ttl: 60 };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });
  });

  describe("ttl < timeout error", () => {
    it("should produce error when ttl is less than timeout", () => {
      // ARRANGE
      const config = { idleTimeout: 60, timeout: 30, ttl: 10 };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("ttl");
      expect(result.errors[0]).toContain("timeout");
      expect(result.errors[0]).toContain("10000ms");
      expect(result.errors[0]).toContain("30000ms");
    });

    it("should produce error with string durations when ttl < timeout", () => {
      // ARRANGE
      const config = { idleTimeout: "2m", timeout: "1m", ttl: "30s" };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("ttl (30000ms)");
      expect(result.errors[0]).toContain("timeout (60000ms)");
    });
  });

  describe("idleTimeout < timeout error", () => {
    it("should produce error when idleTimeout is less than timeout", () => {
      // ARRANGE
      const config = { idleTimeout: 10, timeout: 30, ttl: 300 };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("idleTimeout");
      expect(result.errors[0]).toContain("timeout");
      expect(result.errors[0]).toContain("10000ms");
      expect(result.errors[0]).toContain("30000ms");
    });

    it("should produce error with string durations when idleTimeout < timeout", () => {
      // ARRANGE
      const config = { idleTimeout: "10s", timeout: "1m", ttl: "5m" };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("idleTimeout (10000ms)");
      expect(result.errors[0]).toContain("timeout (60000ms)");
    });
  });

  describe("idleTimeout > ttl warning", () => {
    it("should produce warning when idleTimeout exceeds ttl", () => {
      // ARRANGE
      const config = { idleTimeout: 120, timeout: 30, ttl: 60 };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("idleTimeout");
      expect(result.warnings[0]).toContain("ttl");
      expect(result.warnings[0]).toContain("auto-adjusted");
      expect(result.warnings[0]).toContain("120000ms");
      expect(result.warnings[0]).toContain("60000ms");
    });

    it("should produce warning with string durations when idleTimeout > ttl", () => {
      // ARRANGE
      const config = { idleTimeout: "5m", timeout: "30s", ttl: "2m" };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("idleTimeout (300000ms)");
      expect(result.warnings[0]).toContain("ttl (120000ms)");
    });
  });

  describe("string duration formats", () => {
    it("should handle seconds format", () => {
      // ARRANGE
      const config = { idleTimeout: "60s", timeout: "30s", ttl: "300s" };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should handle minutes format", () => {
      // ARRANGE
      const config = { idleTimeout: "1m", timeout: "30s", ttl: "5m" };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should handle hours format", () => {
      // ARRANGE
      const config = { idleTimeout: "1h", timeout: "1m", ttl: "24h" };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should handle mixed number and string formats", () => {
      // ARRANGE
      const config = { idleTimeout: "2m", timeout: 30, ttl: "10m" };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe("multiple errors", () => {
    it("should collect multiple errors when both ttl and idleTimeout are invalid", () => {
      // ARRANGE
      const config = { idleTimeout: 10, timeout: 30, ttl: 20 };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors.some((e) => e.includes("ttl"))).toBe(true);
      expect(result.errors.some((e) => e.includes("idleTimeout"))).toBe(true);
    });
  });

  describe("errors and warnings together", () => {
    it("should have both errors and warnings when applicable", () => {
      // ARRANGE - ttl < timeout (error), idleTimeout > ttl (warning)
      const config = { idleTimeout: 100, timeout: 30, ttl: 20 };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("isValid property", () => {
    it("should be true when no errors exist", () => {
      // ARRANGE
      const config = { idleTimeout: 60, timeout: 30, ttl: 300 };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it("should be false when errors exist", () => {
      // ARRANGE
      const config = { idleTimeout: 60, timeout: 30, ttl: 10 };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should be true when only warnings exist (no errors)", () => {
      // ARRANGE
      const config = { idleTimeout: 200, timeout: 30, ttl: 100 };

      // ACT
      const result = validateWorkerConfig(config);

      // ASSERT
      expect(result.isValid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.errors.length).toBe(0);
    });
  });
});
