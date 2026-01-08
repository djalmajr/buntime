import { describe, expect, it } from "bun:test";
import { matchVirtualHost, type VHostConfig } from "./matcher";

describe("matchVirtualHost", () => {
  const hosts: Record<string, VHostConfig> = {
    "sked.ly": { app: "skedly@latest" },
    "*.sked.ly": { app: "skedly@latest" },
    "api.sked.ly": { app: "skedly@latest", pathPrefix: "/api" },
    "other.com": { app: "other-app" },
  };

  describe("exact matches", () => {
    it("should match exact hostname", () => {
      const result = matchVirtualHost("sked.ly", hosts);

      expect(result).toEqual({
        app: "skedly@latest",
        pathPrefix: undefined,
      });
    });

    it("should match exact hostname with pathPrefix", () => {
      const result = matchVirtualHost("api.sked.ly", hosts);

      expect(result).toEqual({
        app: "skedly@latest",
        pathPrefix: "/api",
      });
    });

    it("should prefer exact match over wildcard", () => {
      const result = matchVirtualHost("api.sked.ly", hosts);

      expect(result?.pathPrefix).toBe("/api");
      expect(result?.tenant).toBeUndefined();
    });
  });

  describe("wildcard matches", () => {
    it("should match wildcard subdomain", () => {
      const result = matchVirtualHost("tenant1.sked.ly", hosts);

      expect(result).toEqual({
        app: "skedly@latest",
        pathPrefix: undefined,
        tenant: "tenant1",
      });
    });

    it("should extract multi-level subdomain as tenant", () => {
      const result = matchVirtualHost("us-west.tenant1.sked.ly", hosts);

      expect(result).toEqual({
        app: "skedly@latest",
        pathPrefix: undefined,
        tenant: "us-west.tenant1",
      });
    });

    it("should not match bare domain against wildcard", () => {
      // "*.sked.ly" should NOT match "sked.ly" itself
      const hostsOnlyWildcard: Record<string, VHostConfig> = {
        "*.example.com": { app: "app" },
      };

      const result = matchVirtualHost("example.com", hostsOnlyWildcard);

      expect(result).toBeNull();
    });
  });

  describe("no match", () => {
    it("should return null for unknown hostname", () => {
      const result = matchVirtualHost("unknown.com", hosts);

      expect(result).toBeNull();
    });

    it("should return null for partial domain match", () => {
      const result = matchVirtualHost("notsked.ly", hosts);

      expect(result).toBeNull();
    });

    it("should return null for empty hosts config", () => {
      const result = matchVirtualHost("sked.ly", {});

      expect(result).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should handle localhost", () => {
      const localHosts: Record<string, VHostConfig> = {
        localhost: { app: "dev-app" },
      };

      const result = matchVirtualHost("localhost", localHosts);

      expect(result).toEqual({
        app: "dev-app",
        pathPrefix: undefined,
      });
    });

    it("should handle IP addresses", () => {
      const ipHosts: Record<string, VHostConfig> = {
        "192.168.1.1": { app: "local-app" },
      };

      const result = matchVirtualHost("192.168.1.1", ipHosts);

      expect(result).toEqual({
        app: "local-app",
        pathPrefix: undefined,
      });
    });

    it("should handle multiple wildcards (first match wins)", () => {
      const multiWildcard: Record<string, VHostConfig> = {
        "*.a.com": { app: "app-a" },
        "*.b.com": { app: "app-b" },
      };

      const resultA = matchVirtualHost("x.a.com", multiWildcard);
      const resultB = matchVirtualHost("x.b.com", multiWildcard);

      expect(resultA?.app).toBe("app-a");
      expect(resultB?.app).toBe("app-b");
    });
  });
});
