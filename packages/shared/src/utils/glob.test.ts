/**
 * Tests for glob pattern matching utilities
 */

import { describe, expect, it } from "bun:test";
import type { PublicRoutesConfig } from "../types/plugin";
import {
  getPublicRoutesForMethod,
  globArrayToRegex,
  globToRegex,
  matchesGlobPatterns,
} from "./glob";

describe("glob utilities", () => {
  describe("globToRegex", () => {
    it("should convert simple pattern", () => {
      const regex = globToRegex("/api/test");
      expect(regex).toBe("^/api/test$");
    });

    it("should convert single wildcard", () => {
      const regex = globToRegex("/api/*");
      expect(regex).toBe("^/api/[^/]*$");
    });

    it("should convert double wildcard", () => {
      const regex = globToRegex("/api/**");
      expect(regex).toBe("^/api/.*$");
    });

    it("should escape special regex characters", () => {
      const regex = globToRegex("/api/test.json");
      expect(regex).toBe("^/api/test\\.json$");
    });

    it("should convert question mark to single character matcher", () => {
      const regex = globToRegex("/api/v?/test");
      expect(regex).toBe("^/api/v./test$");
    });

    it("should handle patterns already starting with regex group", () => {
      const regex = globToRegex("(^/api/test$)");
      expect(regex).toBe("(^/api/test$)");
    });

    it("should handle complex patterns", () => {
      const regex = globToRegex("/auth/api/**");
      expect(regex).toBe("^/auth/api/.*$");
    });

    it("should handle multiple wildcards", () => {
      const regex = globToRegex("/*/api/**/test");
      expect(regex).toBe("^/[^/]*/api/.*/test$");
    });
  });

  describe("globArrayToRegex", () => {
    it("should return null for empty array", () => {
      const result = globArrayToRegex([]);
      expect(result).toBeNull();
    });

    it("should return null for undefined", () => {
      const result = globArrayToRegex(undefined as unknown as string[]);
      expect(result).toBeNull();
    });

    it("should convert single pattern", () => {
      const regex = globArrayToRegex(["/api/test"]);
      expect(regex).not.toBeNull();
      expect(regex!.test("/api/test")).toBe(true);
      expect(regex!.test("/api/other")).toBe(false);
    });

    it("should combine multiple patterns with OR", () => {
      const regex = globArrayToRegex(["/api/test", "/api/other"]);
      expect(regex).not.toBeNull();
      expect(regex!.test("/api/test")).toBe(true);
      expect(regex!.test("/api/other")).toBe(true);
      expect(regex!.test("/api/unknown")).toBe(false);
    });

    it("should handle wildcard patterns", () => {
      const regex = globArrayToRegex(["/api/*", "/auth/**"]);
      expect(regex).not.toBeNull();
      expect(regex!.test("/api/users")).toBe(true);
      expect(regex!.test("/api/users/123")).toBe(false); // single wildcard doesn't match /
      expect(regex!.test("/auth/login")).toBe(true);
      expect(regex!.test("/auth/oauth/callback")).toBe(true);
    });
  });

  describe("getPublicRoutesForMethod", () => {
    it("should return empty array for undefined config", () => {
      const routes = getPublicRoutesForMethod(undefined, "GET");
      expect(routes).toEqual([]);
    });

    it("should return routes array directly if config is array", () => {
      const config: PublicRoutesConfig = ["/api/public", "/api/health"];
      const routes = getPublicRoutesForMethod(config, "GET");
      expect(routes).toEqual(["/api/public", "/api/health"]);
    });

    it("should return ALL routes for any method", () => {
      const config: PublicRoutesConfig = {
        ALL: ["/api/health"],
        GET: ["/api/info"],
      };
      const routes = getPublicRoutesForMethod(config, "POST");
      expect(routes).toContain("/api/health");
    });

    it("should combine ALL and method-specific routes", () => {
      const config: PublicRoutesConfig = {
        ALL: ["/api/health"],
        GET: ["/api/info"],
      };
      const routes = getPublicRoutesForMethod(config, "GET");
      expect(routes).toContain("/api/health");
      expect(routes).toContain("/api/info");
    });

    it("should deduplicate routes", () => {
      const config: PublicRoutesConfig = {
        ALL: ["/api/health"],
        GET: ["/api/health", "/api/info"],
      };
      const routes = getPublicRoutesForMethod(config, "GET");
      expect(routes.filter((r) => r === "/api/health").length).toBe(1);
    });

    it("should normalize method to uppercase", () => {
      const config: PublicRoutesConfig = {
        GET: ["/api/info"],
      };
      const routes = getPublicRoutesForMethod(config, "get");
      expect(routes).toContain("/api/info");
    });
  });

  describe("matchesGlobPatterns", () => {
    it("should return true when pathname matches a pattern", () => {
      expect(matchesGlobPatterns("/api/config/keycloak", ["/api/config/**"])).toBe(true);
    });

    it("should return false when pathname does not match any pattern", () => {
      expect(matchesGlobPatterns("/other/path", ["/api/config/**"])).toBe(false);
    });

    it("should return false for empty patterns array", () => {
      expect(matchesGlobPatterns("/api/test", [])).toBe(false);
    });

    it("should handle multiple patterns", () => {
      const patterns = ["/api/public/**", "/health", "/api/config/*"];
      expect(matchesGlobPatterns("/api/public/users", patterns)).toBe(true);
      expect(matchesGlobPatterns("/health", patterns)).toBe(true);
      expect(matchesGlobPatterns("/api/config/db", patterns)).toBe(true);
      expect(matchesGlobPatterns("/api/private", patterns)).toBe(false);
    });

    it("should handle single wildcard correctly", () => {
      expect(matchesGlobPatterns("/api/users", ["/api/*"])).toBe(true);
      expect(matchesGlobPatterns("/api/users/123", ["/api/*"])).toBe(false); // single * doesn't match /
    });

    it("should handle double wildcard correctly", () => {
      expect(matchesGlobPatterns("/api/users", ["/api/**"])).toBe(true);
      expect(matchesGlobPatterns("/api/users/123/profile", ["/api/**"])).toBe(true);
    });
  });
});
