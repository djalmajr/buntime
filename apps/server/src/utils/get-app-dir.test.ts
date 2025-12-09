import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAppResolver } from "./get-app-dir";

const TEST_DIR = join(import.meta.dir, ".test-apps");

let getAppDir: ReturnType<typeof createAppResolver>;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  getAppDir = createAppResolver(TEST_DIR);
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

const createVersions = (appName: string, versions: string[]) => {
  const appDir = join(TEST_DIR, appName);
  mkdirSync(appDir, { recursive: true });
  for (const version of versions) {
    mkdirSync(join(appDir, version), { recursive: true });
  }
};

describe("getAppDir", () => {
  describe("with exact version", () => {
    it("should find exact version when available", () => {
      createVersions("hello-api", ["1.0.0", "1.1.0", "2.0.0"]);

      const result = getAppDir("hello-api@1.0.0");
      expect(result).toBe(join(TEST_DIR, "hello-api/1.0.0"));
    });
  });

  describe("with version ranges", () => {
    it("should find highest patch with major version (e.g., app@1)", () => {
      createVersions("hello-api", ["1.0.0", "1.5.3", "2.0.0"]);

      const result = getAppDir("hello-api@1");
      expect(result).toBe(join(TEST_DIR, "hello-api/1.5.3"));
    });

    it("should find highest patch with major.minor version (e.g., app@1.4)", () => {
      createVersions("hello-api", ["1.4.0", "1.4.5", "1.5.0"]);

      const result = getAppDir("hello-api@1.4");
      expect(result).toBe(join(TEST_DIR, "hello-api/1.4.5"));
    });

    it("should support semver ranges (e.g., ^1.0.0)", () => {
      createVersions("hello-api", ["1.0.0", "1.5.0", "2.0.0"]);

      const result = getAppDir("hello-api@^1.0.0");
      expect(result).toBe(join(TEST_DIR, "hello-api/1.5.0"));
    });

    it("should support semver ranges (e.g., ~1.4.0)", () => {
      createVersions("hello-api", ["1.4.0", "1.4.3", "1.5.0"]);

      const result = getAppDir("hello-api@~1.4.0");
      expect(result).toBe(join(TEST_DIR, "hello-api/1.4.3"));
    });
  });

  describe("without version", () => {
    it("should return highest version when no version is specified", () => {
      createVersions("hello-api", ["1.0.0", "1.1.0"]);

      const result = getAppDir("hello-api");
      expect(result).toBe(join(TEST_DIR, "hello-api/1.1.0"));
    });

    it("should filter out non-directory entries", () => {
      createVersions("hello-api", ["1.0.0", "2.0.0"]);
      writeFileSync(join(TEST_DIR, "hello-api/README.md"), "test");

      const result = getAppDir("hello-api");
      expect(result).toBe(join(TEST_DIR, "hello-api/2.0.0"));
    });

    it("should filter out directories that don't follow semantic versioning", () => {
      createVersions("hello-api", ["2.1.0", "latest", "stable", "2.0.0"]);

      const result = getAppDir("hello-api");
      expect(result).toBe(join(TEST_DIR, "hello-api/2.1.0"));
    });

    it("should correctly sort semantic versions (2.0.0 > 1.10.0 > 1.2.0)", () => {
      createVersions("hello-api", ["1.2.0", "1.10.0", "2.0.0"]);

      const result = getAppDir("hello-api");
      expect(result).toBe(join(TEST_DIR, "hello-api/2.0.0"));
    });
  });

  describe("error cases", () => {
    it("should return empty string when app not found", () => {
      const result = getAppDir("nonexistent@1.0.0");
      expect(result).toBe("");
    });

    it("should return empty string when no version satisfies range", () => {
      createVersions("hello-api", ["1.0.0", "1.1.0"]);

      const result = getAppDir("hello-api@2.0.0");
      expect(result).toBe("");
    });

    it("should return empty string when no versions exist", () => {
      mkdirSync(join(TEST_DIR, "empty-app"), { recursive: true });

      const result = getAppDir("empty-app");
      expect(result).toBe("");
    });
  });
});
