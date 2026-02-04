import { describe, expect, it } from "bun:test";
import { splitList } from "./string";

describe("splitList", () => {
  describe("default separator (comma)", () => {
    it("should split comma-separated values", () => {
      expect(splitList("a,b,c")).toEqual(["a", "b", "c"]);
      expect(splitList(".cache,cli,runtime")).toEqual([".cache", "cli", "runtime"]);
    });

    it("should trim whitespace from values", () => {
      expect(splitList("  a , b , c  ")).toEqual(["a", "b", "c"]);
      expect(splitList(".cache, cli, runtime")).toEqual([".cache", "cli", "runtime"]);
    });

    it("should filter empty values", () => {
      expect(splitList("a,,b")).toEqual(["a", "b"]);
      expect(splitList(",a,b,")).toEqual(["a", "b"]);
      expect(splitList("a,  ,b")).toEqual(["a", "b"]);
    });

    it("should handle single value", () => {
      expect(splitList("single")).toEqual(["single"]);
      expect(splitList("  single  ")).toEqual(["single"]);
    });

    it("should return empty array for empty or whitespace-only input", () => {
      expect(splitList("")).toEqual([]);
      expect(splitList("   ")).toEqual([]);
      expect(splitList(",,,")).toEqual([]);
    });
  });

  describe("custom separator (colon)", () => {
    it("should split colon-separated paths", () => {
      expect(splitList("/path1:/path2", ":")).toEqual(["/path1", "/path2"]);
      expect(splitList("workers:plugins", ":")).toEqual(["workers", "plugins"]);
    });

    it("should trim whitespace from values", () => {
      expect(splitList(" /path1 : /path2 ", ":")).toEqual(["/path1", "/path2"]);
    });

    it("should filter empty values", () => {
      expect(splitList("/path1::/path2", ":")).toEqual(["/path1", "/path2"]);
      expect(splitList(":/path1:", ":")).toEqual(["/path1"]);
    });
  });

  describe("custom separator (semicolon)", () => {
    it("should split semicolon-separated SQL statements", () => {
      expect(splitList("SELECT 1; SELECT 2", ";")).toEqual(["SELECT 1", "SELECT 2"]);
    });

    it("should handle multiline SQL", () => {
      const sql = "SELECT * FROM users; INSERT INTO logs VALUES (1)";
      expect(splitList(sql, ";")).toEqual(["SELECT * FROM users", "INSERT INTO logs VALUES (1)"]);
    });

    it("should filter trailing semicolons", () => {
      expect(splitList("SELECT 1;", ";")).toEqual(["SELECT 1"]);
      expect(splitList("SELECT 1; SELECT 2;", ";")).toEqual(["SELECT 1", "SELECT 2"]);
    });
  });

  describe("edge cases", () => {
    it("should handle values containing other separators", () => {
      // Comma-separated with colons in values
      expect(splitList("http://a.com,http://b.com")).toEqual(["http://a.com", "http://b.com"]);
    });

    it("should handle unicode characters", () => {
      expect(splitList("日本語,中文,한국어")).toEqual(["日本語", "中文", "한국어"]);
    });

    it("should preserve internal whitespace", () => {
      expect(splitList("hello world, foo bar")).toEqual(["hello world", "foo bar"]);
    });

    it("should handle multi-character separators", () => {
      expect(splitList("a||b||c", "||")).toEqual(["a", "b", "c"]);
      expect(splitList("a => b => c", " => ")).toEqual(["a", "b", "c"]);
    });
  });
});
