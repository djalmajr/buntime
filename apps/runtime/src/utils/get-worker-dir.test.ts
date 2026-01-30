import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createWorkerResolver } from "./get-worker-dir";

const TEST_DIR = join(import.meta.dir, ".test-workers");

let getWorkerDir: ReturnType<typeof createWorkerResolver>;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  getWorkerDir = createWorkerResolver([TEST_DIR]);
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

/**
 * Create nested format versions (workerDir/worker-name/version/)
 */
const createNestedVersions = (workerName: string, versions: string[]) => {
  const workerDir = join(TEST_DIR, workerName);
  mkdirSync(workerDir, { recursive: true });
  for (const version of versions) {
    mkdirSync(join(workerDir, version), { recursive: true });
  }
};

/**
 * Create flat format versions (workerDir/worker-name@version/)
 */
const createFlatVersions = (workerName: string, versions: string[]) => {
  for (const version of versions) {
    mkdirSync(join(TEST_DIR, `${workerName}@${version}`), { recursive: true });
  }
};

// Alias for backward compatibility with existing tests
const createVersions = createNestedVersions;

describe("getWorkerDir", () => {
  describe("with exact version", () => {
    it("should find exact version when available", () => {
      createVersions("hello-api", ["1.0.0", "1.1.0", "2.0.0"]);

      const result = getWorkerDir("hello-api@1.0.0");
      expect(result).toBe(join(TEST_DIR, "hello-api/1.0.0"));
    });
  });

  describe("with version ranges", () => {
    it("should find highest patch with major version (e.g., worker@1)", () => {
      createVersions("hello-api", ["1.0.0", "1.5.3", "2.0.0"]);

      const result = getWorkerDir("hello-api@1");
      expect(result).toBe(join(TEST_DIR, "hello-api/1.5.3"));
    });

    it("should find highest patch with major.minor version (e.g., worker@1.4)", () => {
      createVersions("hello-api", ["1.4.0", "1.4.5", "1.5.0"]);

      const result = getWorkerDir("hello-api@1.4");
      expect(result).toBe(join(TEST_DIR, "hello-api/1.4.5"));
    });

    it("should support semver ranges (e.g., ^1.0.0)", () => {
      createVersions("hello-api", ["1.0.0", "1.5.0", "2.0.0"]);

      const result = getWorkerDir("hello-api@^1.0.0");
      expect(result).toBe(join(TEST_DIR, "hello-api/1.5.0"));
    });

    it("should support semver ranges (e.g., ~1.4.0)", () => {
      createVersions("hello-api", ["1.4.0", "1.4.3", "1.5.0"]);

      const result = getWorkerDir("hello-api@~1.4.0");
      expect(result).toBe(join(TEST_DIR, "hello-api/1.4.3"));
    });
  });

  describe("without version", () => {
    it("should return highest version when no version is specified", () => {
      createVersions("hello-api", ["1.0.0", "1.1.0"]);

      const result = getWorkerDir("hello-api");
      expect(result).toBe(join(TEST_DIR, "hello-api/1.1.0"));
    });

    it("should filter out non-directory entries", () => {
      createVersions("hello-api", ["1.0.0", "2.0.0"]);
      writeFileSync(join(TEST_DIR, "hello-api/README.md"), "test");

      const result = getWorkerDir("hello-api");
      expect(result).toBe(join(TEST_DIR, "hello-api/2.0.0"));
    });

    it("should prefer 'latest' tag over semver when no version specified", () => {
      createVersions("hello-api", ["2.1.0", "latest", "2.0.0"]);

      const result = getWorkerDir("hello-api");
      expect(result).toBe(join(TEST_DIR, "hello-api/latest"));
    });

    it("should return highest semver when 'latest' tag doesn't exist", () => {
      createVersions("hello-api", ["2.1.0", "stable", "2.0.0"]);

      // "stable" is not a valid semver, so only 2.1.0 and 2.0.0 are considered
      const result = getWorkerDir("hello-api");
      expect(result).toBe(join(TEST_DIR, "hello-api/2.1.0"));
    });

    it("should correctly sort semantic versions (2.0.0 > 1.10.0 > 1.2.0)", () => {
      createVersions("hello-api", ["1.2.0", "1.10.0", "2.0.0"]);

      const result = getWorkerDir("hello-api");
      expect(result).toBe(join(TEST_DIR, "hello-api/2.0.0"));
    });
  });

  describe("error cases", () => {
    it("should return empty string when worker not found", () => {
      const result = getWorkerDir("nonexistent@1.0.0");
      expect(result).toBe("");
    });

    it("should return empty string when no version satisfies range", () => {
      createVersions("hello-api", ["1.0.0", "1.1.0"]);

      const result = getWorkerDir("hello-api@2.0.0");
      expect(result).toBe("");
    });

    it("should return empty string when no versions exist", () => {
      mkdirSync(join(TEST_DIR, "empty-worker"), { recursive: true });

      const result = getWorkerDir("empty-worker");
      expect(result).toBe("");
    });

    it("should return empty string for empty worker name", () => {
      const result = getWorkerDir("");
      expect(result).toBe("");
    });

    it("should return empty string when explicit latest tag not found", () => {
      // Create versions but no "latest" tag
      createVersions("no-latest-worker", ["1.0.0", "2.0.0"]);

      const result = getWorkerDir("no-latest-worker@latest");
      expect(result).toBe("");
    });
  });

  describe("latest tag handling", () => {
    it("should return explicit latest tag when requested", () => {
      createVersions("explicit-latest", ["1.0.0", "latest"]);

      const result = getWorkerDir("explicit-latest@latest");
      expect(result).toBe(join(TEST_DIR, "explicit-latest/latest"));
    });

    it("should prefer latest over higher semver when no version specified", () => {
      createVersions("prefer-latest", ["3.0.0", "latest", "2.0.0"]);

      const result = getWorkerDir("prefer-latest");
      expect(result).toBe(join(TEST_DIR, "prefer-latest/latest"));
    });

    it("should return empty when only latest exists and semver range requested", () => {
      createVersions("only-latest", ["latest"]);

      const result = getWorkerDir("only-latest@^1.0.0");
      expect(result).toBe("");
    });

    it("should handle flat format with latest tag", () => {
      createFlatVersions("flat-latest", ["1.0.0", "latest"]);

      const result = getWorkerDir("flat-latest@latest");
      expect(result).toBe(join(TEST_DIR, "flat-latest@latest"));
    });
  });

  describe("flat format (worker-name@version/)", () => {
    describe("with exact version", () => {
      it("should find exact version in flat format", () => {
        createFlatVersions("hello-api", ["1.0.0", "1.1.0", "2.0.0"]);

        const result = getWorkerDir("hello-api@1.0.0");
        expect(result).toBe(join(TEST_DIR, "hello-api@1.0.0"));
      });
    });

    describe("with version ranges", () => {
      it("should find highest patch with major version (e.g., worker@1)", () => {
        createFlatVersions("hello-api", ["1.0.0", "1.5.3", "2.0.0"]);

        const result = getWorkerDir("hello-api@1");
        expect(result).toBe(join(TEST_DIR, "hello-api@1.5.3"));
      });

      it("should find highest patch with major.minor version (e.g., worker@1.4)", () => {
        createFlatVersions("hello-api", ["1.4.0", "1.4.5", "1.5.0"]);

        const result = getWorkerDir("hello-api@1.4");
        expect(result).toBe(join(TEST_DIR, "hello-api@1.4.5"));
      });

      it("should support semver ranges (e.g., ^1.0.0)", () => {
        createFlatVersions("hello-api", ["1.0.0", "1.5.0", "2.0.0"]);

        const result = getWorkerDir("hello-api@^1.0.0");
        expect(result).toBe(join(TEST_DIR, "hello-api@1.5.0"));
      });

      it("should support semver ranges (e.g., ~1.4.0)", () => {
        createFlatVersions("hello-api", ["1.4.0", "1.4.3", "1.5.0"]);

        const result = getWorkerDir("hello-api@~1.4.0");
        expect(result).toBe(join(TEST_DIR, "hello-api@1.4.3"));
      });
    });

    describe("without version", () => {
      it("should return highest version when no version is specified", () => {
        createFlatVersions("hello-api", ["1.0.0", "1.1.0"]);

        const result = getWorkerDir("hello-api");
        expect(result).toBe(join(TEST_DIR, "hello-api@1.1.0"));
      });

      it("should correctly sort semantic versions (2.0.0 > 1.10.0 > 1.2.0)", () => {
        createFlatVersions("hello-api", ["1.2.0", "1.10.0", "2.0.0"]);

        const result = getWorkerDir("hello-api");
        expect(result).toBe(join(TEST_DIR, "hello-api@2.0.0"));
      });
    });
  });

  describe("flat format priority over nested", () => {
    it("should prefer flat format when both exist", () => {
      createFlatVersions("hello-api", ["1.0.0"]);
      createNestedVersions("hello-api", ["1.0.0"]);

      const result = getWorkerDir("hello-api@1.0.0");
      expect(result).toBe(join(TEST_DIR, "hello-api@1.0.0"));
    });

    it("should return highest version regardless of format", () => {
      createFlatVersions("hello-api", ["2.0.0"]);
      createNestedVersions("hello-api", ["3.0.0"]);

      // Flat has 2.0.0, nested has 3.0.0
      // Should return nested's 3.0.0 because it's the highest version
      const result = getWorkerDir("hello-api");
      expect(result).toBe(join(TEST_DIR, "hello-api/3.0.0"));
    });

    it("should fallback to nested when flat has no matching version", () => {
      createFlatVersions("hello-api", ["1.0.0"]);
      createNestedVersions("hello-api", ["2.0.0"]);

      const result = getWorkerDir("hello-api@2.0.0");
      expect(result).toBe(join(TEST_DIR, "hello-api/2.0.0"));
    });

    it("should fallback to nested when no flat versions exist", () => {
      createNestedVersions("hello-api", ["1.0.0", "2.0.0"]);

      const result = getWorkerDir("hello-api@1.0.0");
      expect(result).toBe(join(TEST_DIR, "hello-api/1.0.0"));
    });
  });

  describe("multiple directories", () => {
    const TEST_DIR_2 = join(import.meta.dir, ".test-workers-2");

    beforeEach(() => {
      mkdirSync(TEST_DIR_2, { recursive: true });
    });

    afterEach(() => {
      rmSync(TEST_DIR_2, { recursive: true, force: true });
    });

    it("should find worker from second directory when not in first", () => {
      mkdirSync(join(TEST_DIR_2, "another-api@1.0.0"), { recursive: true });
      const resolver = createWorkerResolver([TEST_DIR, TEST_DIR_2]);

      const result = resolver("another-api@1.0.0");
      expect(result).toBe(join(TEST_DIR_2, "another-api@1.0.0"));
    });

    it("should prefer first directory when worker exists in both", () => {
      createFlatVersions("shared-api", ["1.0.0"]);
      mkdirSync(join(TEST_DIR_2, "shared-api@1.0.0"), { recursive: true });
      const resolver = createWorkerResolver([TEST_DIR, TEST_DIR_2]);

      const result = resolver("shared-api@1.0.0");
      expect(result).toBe(join(TEST_DIR, "shared-api@1.0.0"));
    });

    it("should find highest version across all directories", () => {
      createFlatVersions("multi-api", ["1.0.0"]);
      mkdirSync(join(TEST_DIR_2, "multi-api@2.0.0"), { recursive: true });
      const resolver = createWorkerResolver([TEST_DIR, TEST_DIR_2]);

      const result = resolver("multi-api");
      expect(result).toBe(join(TEST_DIR_2, "multi-api@2.0.0"));
    });

    it("should return empty string when worker not found in any directory", () => {
      const resolver = createWorkerResolver([TEST_DIR, TEST_DIR_2]);

      const result = resolver("nonexistent@1.0.0");
      expect(result).toBe("");
    });
  });
});
