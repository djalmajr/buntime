import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getEntrypoint } from "./get-entrypoint";

const TEST_DIR = join(import.meta.dir, ".test-entrypoint");

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("getEntrypoint", () => {
  describe("with explicit entrypoint", () => {
    it("should use explicit entrypoint when provided and file exists", async () => {
      const appDir = join(TEST_DIR, "app-with-config");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(join(appDir, "main.ts"), "export default {}");

      const result = await getEntrypoint(appDir, "main.ts");
      expect(result.path).toBe("main.ts");
      expect(result.static).toBe(false);
    });

    it("should detect HTML entrypoint as static", async () => {
      const appDir = join(TEST_DIR, "app-static-config");
      mkdirSync(join(appDir, "public"), { recursive: true });
      writeFileSync(join(appDir, "public/index.html"), "<html></html>");

      const result = await getEntrypoint(appDir, "public/index.html");
      expect(result.path).toBe("public/index.html");
      expect(result.static).toBe(true);
    });
  });

  describe("auto-discovery priority", () => {
    it("should prioritize index.html over index.ts", async () => {
      const appDir = join(TEST_DIR, "app-html-priority");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(join(appDir, "index.html"), "<html></html>");
      writeFileSync(join(appDir, "index.ts"), "export default {}");
      writeFileSync(join(appDir, "index.js"), "export default {}");
      writeFileSync(join(appDir, "index.mjs"), "export default {}");

      const result = await getEntrypoint(appDir);
      expect(result.path).toBe("index.html");
      expect(result.static).toBe(true);
    });

    it("should use index.ts when index.html not found", async () => {
      const appDir = join(TEST_DIR, "app-ts-only");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(join(appDir, "index.ts"), "export default {}");
      writeFileSync(join(appDir, "index.js"), "export default {}");
      writeFileSync(join(appDir, "index.mjs"), "export default {}");

      const result = await getEntrypoint(appDir);
      expect(result.path).toBe("index.ts");
      expect(result.static).toBe(false);
    });

    it("should use index.js when index.html and index.ts not found", async () => {
      const appDir = join(TEST_DIR, "app-js-only");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(join(appDir, "index.js"), "export default {}");
      writeFileSync(join(appDir, "index.mjs"), "export default {}");

      const result = await getEntrypoint(appDir);
      expect(result.path).toBe("index.js");
      expect(result.static).toBe(false);
    });

    it("should use index.mjs as last resort", async () => {
      const appDir = join(TEST_DIR, "app-mjs-only");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(join(appDir, "index.mjs"), "export default {}");

      const result = await getEntrypoint(appDir);
      expect(result.path).toBe("index.mjs");
      expect(result.static).toBe(false);
    });
  });

  describe("fallback behavior", () => {
    it("should fallback to index.html when no entrypoint found", async () => {
      const appDir = join(TEST_DIR, "app-empty");
      mkdirSync(appDir, { recursive: true });

      const result = await getEntrypoint(appDir);
      expect(result.path).toBe("index.html");
      expect(result.static).toBe(true);
    });
  });
});
