import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "@/constants";

const TEST_DIR = join(import.meta.dir, ".test-apps");

mock.module("@/constants", () => ({
  APP_SHELL: undefined,
  APPS_DIR: TEST_DIR,
  DELAY_MS: 10,
  NODE_ENV: "test",
  POOL_SIZE: 5,
  PORT: 8080,
}));

const { default: workerRoutes } = await import("./worker");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

const createApp = (app: string, files: Record<string, string>) => {
  const [name = "", version = ""] = app.split("@") || [];
  const appDir = join(TEST_DIR, name, version);
  mkdirSync(appDir, { recursive: true });
  for (const [filename, content] of Object.entries(files)) {
    writeFileSync(join(appDir, filename), content);
  }
  return appDir;
};

describe("Worker Routes", () => {
  describe("GET /", () => {
    it("should return Buntime version when APP_SHELL is not set", async () => {
      const response = await workerRoutes.request("/");

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(`Buntime v${VERSION}`);
    });
  });

  describe("static apps", () => {
    it("should serve static HTML app with assets", async () => {
      createApp("my-static-app@1.0.0", {
        "index.html":
          '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body>Hello</body></html>',
        "style.css": "body { color: red; }",
        "script.js": "console.log('hello');",
      });

      const htmlResponse = await workerRoutes.request("/my-static-app");
      expect(htmlResponse.status).toBe(200);
      expect(await htmlResponse.text()).toContain("<body>Hello</body>");

      const cssResponse = await workerRoutes.request("/my-static-app/style.css");
      expect(cssResponse.status).toBe(200);
      expect(await cssResponse.text()).toBe("body { color: red; }");

      const jsResponse = await workerRoutes.request("/my-static-app/script.js");
      expect(jsResponse.status).toBe(200);
      expect(await jsResponse.text()).toBe("console.log('hello');");
    });

    it("should return health check when worker is alive", async () => {
      createApp("my-static-app@1.0.0", { "index.html": "<html></html>" });

      const response = await workerRoutes.request("/my-static-app/health");

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("OK");
    });
  });

  describe("404 handling", () => {
    it("should return 404 for non-existent apps", async () => {
      const paths = ["/nonexistent-app", "/nonexistent-app@1.0.0/"];

      for (const path of paths) {
        const response = await workerRoutes.request(path);
        expect(response.status).toBe(404);
        const json = (await response.json()) as { error: string };
        expect(json.error).toContain("App not found");
      }
    });

    it("should return 404 for non-existent version", async () => {
      createApp("my-app@1.0.0", { "index.html": "<html>v1</html>" });

      const response = await workerRoutes.request("/my-app@9.9.9/");

      expect(response.status).toBe(404);
      const json = (await response.json()) as { error: string };
      expect(json.error).toContain("App not found");
    });

    it("should return 404 for invalid semver format", async () => {
      createApp("my-app@1.0.0", { "index.html": "<html>v1</html>" });

      const invalidVersions = ["/my-app@invalid/", "/my-app@abc.def.ghi/", "/my-app@1.0.0.0/"];

      for (const path of invalidVersions) {
        const response = await workerRoutes.request(path);
        expect(response.status).toBe(404);
        const json = (await response.json()) as { error: string };
        expect(json.error).toContain("App not found");
      }
    });

    it("should accept v-prefixed version as valid semver", async () => {
      createApp("my-app@1.0.0", { "index.html": "<html>v1</html>" });

      const response = await workerRoutes.request("/my-app@v1.0.0/");

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("v1");
    });
  });

  describe("version resolution", () => {
    it("should resolve to highest version when no version specified", async () => {
      createApp("versioned-app@1.0.0", { "index.html": "<html>v1.0.0</html>" });
      createApp("versioned-app@2.0.0", { "index.html": "<html>v2.0.0</html>" });

      const response = await workerRoutes.request("/versioned-app/");

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("v2.0.0");
    });

    it("should resolve exact version when specified", async () => {
      createApp("versioned-app@1.0.0", { "index.html": "<html>v1.0.0</html>" });
      createApp("versioned-app@2.0.0", { "index.html": "<html>v2.0.0</html>" });

      const response = await workerRoutes.request("/versioned-app@1.0.0/");

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("v1.0.0");
    });

    it("should resolve major version range to highest compatible", async () => {
      createApp("range-app@1.0.0", { "index.html": "<html>v1.0.0</html>" });
      createApp("range-app@1.2.0", { "index.html": "<html>v1.2.0</html>" });
      createApp("range-app@1.5.3", { "index.html": "<html>v1.5.3</html>" });
      createApp("range-app@2.0.0", { "index.html": "<html>v2.0.0</html>" });

      const response = await workerRoutes.request("/range-app@1/");

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("v1.5.3");
    });

    it("should resolve minor version range to highest compatible", async () => {
      createApp("range-app@1.2.0", { "index.html": "<html>v1.2.0</html>" });
      createApp("range-app@1.2.5", { "index.html": "<html>v1.2.5</html>" });
      createApp("range-app@1.3.0", { "index.html": "<html>v1.3.0</html>" });

      const response = await workerRoutes.request("/range-app@1.2/");

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("v1.2.5");
    });

    it("should resolve prerelease versions correctly", async () => {
      createApp("prerelease-app@1.0.0-alpha", {
        "index.html": "<html>v1.0.0-alpha</html>",
      });
      createApp("prerelease-app@1.0.0-beta", {
        "index.html": "<html>v1.0.0-beta</html>",
      });
      createApp("prerelease-app@1.0.0-rc.1", {
        "index.html": "<html>v1.0.0-rc.1</html>",
      });

      // Stable version should be highest
      const response = await workerRoutes.request("/prerelease-app/");
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("v1.0.0-rc.1");

      // Exact prerelease version
      const alphaResponse = await workerRoutes.request("/prerelease-app@1.0.0-alpha/");
      expect(alphaResponse.status).toBe(200);
      expect(await alphaResponse.text()).toContain("v1.0.0-alpha");
    });
  });
});
