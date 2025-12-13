import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAppResolver } from "./get-app-dir";

const TEST_DIR = join(import.meta.dir, ".test-apps");

let getAppDir: ReturnType<typeof createAppResolver>;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  getAppDir = createAppResolver([TEST_DIR]);
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

/**
 * Create nested format versions (appsDir/app-name/version/)
 */
const createNestedVersions = (appName: string, versions: string[]) => {
  const appDir = join(TEST_DIR, appName);
  mkdirSync(appDir, { recursive: true });
  for (const version of versions) {
    mkdirSync(join(appDir, version), { recursive: true });
  }
};

/**
 * Create flat format versions (appsDir/app-name@version/)
 */
const createFlatVersions = (appName: string, versions: string[]) => {
  for (const version of versions) {
    mkdirSync(join(TEST_DIR, `${appName}@${version}`), { recursive: true });
  }
};

// Alias for backward compatibility with existing tests
const createVersions = createNestedVersions;

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

  describe("flat format (app-name@version/)", () => {
    describe("with exact version", () => {
      it("should find exact version in flat format", () => {
        createFlatVersions("hello-api", ["1.0.0", "1.1.0", "2.0.0"]);

        const result = getAppDir("hello-api@1.0.0");
        expect(result).toBe(join(TEST_DIR, "hello-api@1.0.0"));
      });
    });

    describe("with version ranges", () => {
      it("should find highest patch with major version (e.g., app@1)", () => {
        createFlatVersions("hello-api", ["1.0.0", "1.5.3", "2.0.0"]);

        const result = getAppDir("hello-api@1");
        expect(result).toBe(join(TEST_DIR, "hello-api@1.5.3"));
      });

      it("should find highest patch with major.minor version (e.g., app@1.4)", () => {
        createFlatVersions("hello-api", ["1.4.0", "1.4.5", "1.5.0"]);

        const result = getAppDir("hello-api@1.4");
        expect(result).toBe(join(TEST_DIR, "hello-api@1.4.5"));
      });

      it("should support semver ranges (e.g., ^1.0.0)", () => {
        createFlatVersions("hello-api", ["1.0.0", "1.5.0", "2.0.0"]);

        const result = getAppDir("hello-api@^1.0.0");
        expect(result).toBe(join(TEST_DIR, "hello-api@1.5.0"));
      });

      it("should support semver ranges (e.g., ~1.4.0)", () => {
        createFlatVersions("hello-api", ["1.4.0", "1.4.3", "1.5.0"]);

        const result = getAppDir("hello-api@~1.4.0");
        expect(result).toBe(join(TEST_DIR, "hello-api@1.4.3"));
      });
    });

    describe("without version", () => {
      it("should return highest version when no version is specified", () => {
        createFlatVersions("hello-api", ["1.0.0", "1.1.0"]);

        const result = getAppDir("hello-api");
        expect(result).toBe(join(TEST_DIR, "hello-api@1.1.0"));
      });

      it("should correctly sort semantic versions (2.0.0 > 1.10.0 > 1.2.0)", () => {
        createFlatVersions("hello-api", ["1.2.0", "1.10.0", "2.0.0"]);

        const result = getAppDir("hello-api");
        expect(result).toBe(join(TEST_DIR, "hello-api@2.0.0"));
      });
    });
  });

  describe("flat format priority over nested", () => {
    it("should prefer flat format when both exist", () => {
      createFlatVersions("hello-api", ["1.0.0"]);
      createNestedVersions("hello-api", ["1.0.0"]);

      const result = getAppDir("hello-api@1.0.0");
      expect(result).toBe(join(TEST_DIR, "hello-api@1.0.0"));
    });

    it("should prefer flat format for highest version", () => {
      createFlatVersions("hello-api", ["2.0.0"]);
      createNestedVersions("hello-api", ["3.0.0"]);

      // Flat has 2.0.0, nested has 3.0.0
      // Should return flat's 2.0.0 because flat is checked first
      const result = getAppDir("hello-api");
      expect(result).toBe(join(TEST_DIR, "hello-api@2.0.0"));
    });

    it("should fallback to nested when flat has no matching version", () => {
      createFlatVersions("hello-api", ["1.0.0"]);
      createNestedVersions("hello-api", ["2.0.0"]);

      const result = getAppDir("hello-api@2.0.0");
      expect(result).toBe(join(TEST_DIR, "hello-api/2.0.0"));
    });

    it("should fallback to nested when no flat versions exist", () => {
      createNestedVersions("hello-api", ["1.0.0", "2.0.0"]);

      const result = getAppDir("hello-api@1.0.0");
      expect(result).toBe(join(TEST_DIR, "hello-api/1.0.0"));
    });
  });

  describe("multiple directories", () => {
    const TEST_DIR_2 = join(import.meta.dir, ".test-apps-2");

    beforeEach(() => {
      mkdirSync(TEST_DIR_2, { recursive: true });
    });

    afterEach(() => {
      rmSync(TEST_DIR_2, { recursive: true, force: true });
    });

    it("should find app from second directory when not in first", () => {
      mkdirSync(join(TEST_DIR_2, "another-api@1.0.0"), { recursive: true });
      const resolver = createAppResolver([TEST_DIR, TEST_DIR_2]);

      const result = resolver("another-api@1.0.0");
      expect(result).toBe(join(TEST_DIR_2, "another-api@1.0.0"));
    });

    it("should prefer first directory when app exists in both", () => {
      createFlatVersions("shared-api", ["1.0.0"]);
      mkdirSync(join(TEST_DIR_2, "shared-api@1.0.0"), { recursive: true });
      const resolver = createAppResolver([TEST_DIR, TEST_DIR_2]);

      const result = resolver("shared-api@1.0.0");
      expect(result).toBe(join(TEST_DIR, "shared-api@1.0.0"));
    });

    it("should find highest version across all directories", () => {
      createFlatVersions("multi-api", ["1.0.0"]);
      mkdirSync(join(TEST_DIR_2, "multi-api@2.0.0"), { recursive: true });
      const resolver = createAppResolver([TEST_DIR, TEST_DIR_2]);

      const result = resolver("multi-api");
      expect(result).toBe(join(TEST_DIR_2, "multi-api@2.0.0"));
    });

    it("should return empty string when app not found in any directory", () => {
      const resolver = createAppResolver([TEST_DIR, TEST_DIR_2]);

      const result = resolver("nonexistent@1.0.0");
      expect(result).toBe("");
    });
  });
});
