import { describe, expect, it } from "bun:test";
import { parseDurationToMs } from "./duration";

describe("parseDurationToMs", () => {
  describe("number input (seconds)", () => {
    it("should convert seconds to milliseconds", () => {
      expect(parseDurationToMs(30)).toBe(30000);
      expect(parseDurationToMs(60)).toBe(60000);
      expect(parseDurationToMs(0)).toBe(0);
    });
  });

  describe("string input", () => {
    it("should parse milliseconds", () => {
      expect(parseDurationToMs("500ms")).toBe(500);
      expect(parseDurationToMs("1000ms")).toBe(1000);
    });

    it("should parse seconds", () => {
      expect(parseDurationToMs("30s")).toBe(30000);
      expect(parseDurationToMs("1s")).toBe(1000);
    });

    it("should parse minutes", () => {
      expect(parseDurationToMs("1m")).toBe(60000);
      expect(parseDurationToMs("5m")).toBe(300000);
    });

    it("should parse hours", () => {
      expect(parseDurationToMs("1h")).toBe(3600000);
      expect(parseDurationToMs("24h")).toBe(86400000);
    });

    it("should parse days", () => {
      expect(parseDurationToMs("1d")).toBe(86400000);
      expect(parseDurationToMs("7d")).toBe(604800000);
    });

    it("should throw for invalid format", () => {
      expect(() => parseDurationToMs("invalid")).toThrow('Invalid duration format: "invalid"');
      expect(() => parseDurationToMs("abc123")).toThrow('Invalid duration format: "abc123"');
    });
  });
});
