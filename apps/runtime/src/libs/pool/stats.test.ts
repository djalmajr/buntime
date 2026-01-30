import { describe, expect, it } from "bun:test";
import { computeAvgResponseTime, roundTwoDecimals } from "./stats";

describe("stats", () => {
  describe("roundTwoDecimals", () => {
    it("should round to two decimal places", () => {
      expect(roundTwoDecimals(1.234)).toBe(1.23);
      expect(roundTwoDecimals(1.235)).toBe(1.24);
      expect(roundTwoDecimals(1.999)).toBe(2);
    });

    it("should handle integers", () => {
      expect(roundTwoDecimals(5)).toBe(5);
      expect(roundTwoDecimals(100)).toBe(100);
    });

    it("should handle zero", () => {
      expect(roundTwoDecimals(0)).toBe(0);
    });

    it("should handle negative numbers", () => {
      expect(roundTwoDecimals(-1.234)).toBe(-1.23);
      expect(roundTwoDecimals(-1.235)).toBe(-1.24);
    });

    it("should handle small decimals", () => {
      expect(roundTwoDecimals(0.001)).toBe(0);
      expect(roundTwoDecimals(0.005)).toBe(0.01);
      expect(roundTwoDecimals(0.004)).toBe(0);
    });

    it("should handle large numbers", () => {
      expect(roundTwoDecimals(123456.789)).toBe(123456.79);
    });
  });

  describe("computeAvgResponseTime", () => {
    it("should compute average response time", () => {
      expect(computeAvgResponseTime(100, 10)).toBe(10);
      expect(computeAvgResponseTime(333, 3)).toBe(111);
    });

    it("should round result to two decimals", () => {
      expect(computeAvgResponseTime(100, 3)).toBe(33.33);
      expect(computeAvgResponseTime(200, 3)).toBe(66.67);
    });

    it("should return 0 for zero count", () => {
      expect(computeAvgResponseTime(100, 0)).toBe(0);
    });

    it("should return 0 for negative count", () => {
      expect(computeAvgResponseTime(100, -5)).toBe(0);
    });

    it("should handle zero total", () => {
      expect(computeAvgResponseTime(0, 10)).toBe(0);
    });

    it("should handle large values", () => {
      const result = computeAvgResponseTime(1000000, 1000);
      expect(result).toBe(1000);
    });
  });
});
