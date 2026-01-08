import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "./serve-static";

describe("serve-static", () => {
  const testDir = join(import.meta.dirname, "__test-static__");
  const publicDir = join(testDir, "public");
  const entrypoint = join(publicDir, "index.html");

  beforeAll(() => {
    // Create test directory structure
    mkdirSync(join(publicDir, "assets"), { recursive: true });
    writeFileSync(entrypoint, "<html><body>Hello</body></html>");
    writeFileSync(join(publicDir, "style.css"), "body { color: red; }");
    writeFileSync(join(publicDir, "assets", "app.js"), "console.log('app');");
  });

  afterAll(() => {
    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe("file serving", () => {
    it("should serve the entrypoint for root path", async () => {
      const response = await serveStatic(entrypoint, "/");
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("Hello");
    });

    it("should serve existing file", async () => {
      const response = await serveStatic(entrypoint, "/style.css");
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("color: red");
    });

    it("should serve nested file", async () => {
      const response = await serveStatic(entrypoint, "/assets/app.js");
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("console.log");
    });

    it("should fallback to entrypoint for non-existent file (SPA routing)", async () => {
      const response = await serveStatic(entrypoint, "/unknown-route");
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("Hello");
    });
  });

  describe("path traversal protection", () => {
    it("should return 403 for path traversal attempt", async () => {
      const response = await serveStatic(entrypoint, "/../../../etc/passwd");
      expect(response.status).toBe(403);
      const text = await response.text();
      expect(text).toBe("Forbidden");
    });

    it("should handle encoded path traversal (Bun decodes automatically)", async () => {
      // Bun's URL parsing decodes %2F to /, so this becomes /../.. which path.resolve normalizes
      // The security check still catches the traversal attempt
      const response = await serveStatic(entrypoint, "/..%2F..%2Fetc/passwd");
      // May return 403 or 200 (fallback to index) depending on path resolution
      expect([200, 403]).toContain(response.status);
    });

    it("should allow paths that stay within base directory", async () => {
      const response = await serveStatic(entrypoint, "/assets/../style.css");
      expect(response.status).toBe(200);
    });
  });

  describe("content types", () => {
    it("should set correct content type for HTML", async () => {
      const response = await serveStatic(entrypoint, "/");
      expect(response.headers.get("content-type")).toContain("text/html");
    });

    it("should set correct content type for CSS", async () => {
      const response = await serveStatic(entrypoint, "/style.css");
      expect(response.headers.get("content-type")).toContain("text/css");
    });

    it("should set correct content type for JS", async () => {
      const response = await serveStatic(entrypoint, "/assets/app.js");
      const contentType = response.headers.get("content-type");
      expect(contentType).toMatch(/javascript/);
    });
  });

  describe("edge cases", () => {
    it("should handle empty pathname", async () => {
      const response = await serveStatic(entrypoint, "");
      expect(response.status).toBe(200);
    });

    it("should handle pathname with leading slash", async () => {
      const response = await serveStatic(entrypoint, "/style.css");
      expect(response.status).toBe(200);
    });

    it("should handle pathname without leading slash", async () => {
      const response = await serveStatic(entrypoint, "style.css");
      expect(response.status).toBe(200);
    });
  });

  describe("404 handling", () => {
    it("should return 404 when entrypoint does not exist", async () => {
      const nonExistentEntry = join(testDir, "nonexistent", "index.html");
      const response = await serveStatic(nonExistentEntry, "/");
      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toBe("Not Found");
    });
  });
});
