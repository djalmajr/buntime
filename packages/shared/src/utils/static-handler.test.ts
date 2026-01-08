import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createStaticHandler } from "./static-handler";

describe("createStaticHandler", () => {
  const TEST_DIR = "/tmp/static-handler-test-" + Date.now();
  let handler: ReturnType<typeof createStaticHandler>;

  beforeAll(async () => {
    // Create test directory structure
    await mkdir(TEST_DIR, { recursive: true });
    await mkdir(join(TEST_DIR, "assets"), { recursive: true });

    // Create test files
    await writeFile(join(TEST_DIR, "index.html"), "<!DOCTYPE html><html><body>Home</body></html>");
    await writeFile(join(TEST_DIR, "about.html"), "<!DOCTYPE html><html><body>About</body></html>");
    await writeFile(join(TEST_DIR, "assets/style.css"), "body { color: red; }");
    await writeFile(join(TEST_DIR, "assets/app.js"), "console.log('hello');");

    handler = createStaticHandler(TEST_DIR);
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  function createRequest(path: string): Bun.BunRequest {
    return new Request(`http://localhost${path}`) as Bun.BunRequest;
  }

  describe("index.html", () => {
    it("should serve index.html for root path", async () => {
      const res = await handler(createRequest("/"));

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("Home");
    });
  });

  describe("static files", () => {
    it("should serve existing HTML files", async () => {
      const res = await handler(createRequest("/about.html"));

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("About");
    });

    it("should serve CSS files with correct content type", async () => {
      const res = await handler(createRequest("/assets/style.css"));

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/css");
      const text = await res.text();
      expect(text).toContain("color: red");
    });

    it("should serve JS files with correct content type", async () => {
      const res = await handler(createRequest("/assets/app.js"));

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("javascript");
      const text = await res.text();
      expect(text).toContain("console.log");
    });
  });

  describe("SPA fallback", () => {
    it("should fallback to index.html for non-existent paths", async () => {
      const res = await handler(createRequest("/non-existent-page"));

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("Home"); // Falls back to index.html
    });

    it("should fallback for deep non-existent paths", async () => {
      const res = await handler(createRequest("/some/deep/path/that/does/not/exist"));

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("Home");
    });
  });
});
