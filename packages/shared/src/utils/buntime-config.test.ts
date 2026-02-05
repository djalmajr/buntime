import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadEnvFile,
  loadEnvFileSync,
  loadManifestConfig,
  loadManifestConfigSync,
} from "./buntime-config";

describe("loadEnvFile", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "buntime-config-test-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("loadEnvFile (async)", () => {
    it("should return empty object when no .env file exists", async () => {
      const result = await loadEnvFile(testDir);
      expect(result).toEqual({});
    });

    it("should parse simple key=value pairs", async () => {
      writeFileSync(join(testDir, ".env"), "FOO=bar\nBAZ=qux");
      const result = await loadEnvFile(testDir);
      expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
    });

    it("should ignore comments", async () => {
      writeFileSync(
        join(testDir, ".env"),
        "# This is a comment\nFOO=bar\n# Another comment\nBAZ=qux",
      );
      const result = await loadEnvFile(testDir);
      expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
    });

    it("should ignore empty lines", async () => {
      writeFileSync(join(testDir, ".env"), "FOO=bar\n\n\nBAZ=qux\n");
      const result = await loadEnvFile(testDir);
      expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
    });

    it("should remove double quotes from values", async () => {
      writeFileSync(join(testDir, ".env"), 'FOO="bar with spaces"\nBAZ="qux"');
      const result = await loadEnvFile(testDir);
      expect(result).toEqual({ FOO: "bar with spaces", BAZ: "qux" });
    });

    it("should remove single quotes from values", async () => {
      writeFileSync(join(testDir, ".env"), "FOO='bar with spaces'\nBAZ='qux'");
      const result = await loadEnvFile(testDir);
      expect(result).toEqual({ FOO: "bar with spaces", BAZ: "qux" });
    });

    it("should handle values with equals signs", async () => {
      writeFileSync(
        join(testDir, ".env"),
        "DATABASE_URL=postgres://user:pass@host:5432/db?ssl=true",
      );
      const result = await loadEnvFile(testDir);
      expect(result).toEqual({ DATABASE_URL: "postgres://user:pass@host:5432/db?ssl=true" });
    });

    it("should handle empty values", async () => {
      writeFileSync(join(testDir, ".env"), "EMPTY=\nFOO=bar");
      const result = await loadEnvFile(testDir);
      expect(result).toEqual({ EMPTY: "", FOO: "bar" });
    });

    it("should trim whitespace around keys and values", async () => {
      writeFileSync(join(testDir, ".env"), "  FOO  =  bar  \n  BAZ=qux");
      const result = await loadEnvFile(testDir);
      expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
    });

    it("should skip lines without equals sign", async () => {
      writeFileSync(join(testDir, ".env"), "FOO=bar\nINVALID LINE\nBAZ=qux");
      const result = await loadEnvFile(testDir);
      expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
    });

    it("should handle mixed quotes correctly", async () => {
      writeFileSync(join(testDir, ".env"), 'FOO="bar\nBAZ=\'qux\nPROPER="value"');
      const result = await loadEnvFile(testDir);
      // Only PROPER has matching quotes
      expect(result.PROPER).toBe("value");
      // FOO and BAZ have unmatched quotes, so they keep the quote
      expect(result.FOO).toBe('"bar');
      expect(result.BAZ).toBe("'qux");
    });
  });

  describe("loadEnvFileSync", () => {
    it("should return empty object when no .env file exists", () => {
      const result = loadEnvFileSync(testDir);
      expect(result).toEqual({});
    });

    it("should parse simple key=value pairs", () => {
      writeFileSync(join(testDir, ".env"), "FOO=bar\nBAZ=qux");
      const result = loadEnvFileSync(testDir);
      expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
    });

    it("should ignore comments and empty lines", () => {
      writeFileSync(join(testDir, ".env"), "# Comment\n\nFOO=bar");
      const result = loadEnvFileSync(testDir);
      expect(result).toEqual({ FOO: "bar" });
    });

    it("should remove quotes from values", () => {
      writeFileSync(join(testDir, ".env"), "FOO=\"bar\"\nBAZ='qux'");
      const result = loadEnvFileSync(testDir);
      expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
    });
  });
});

describe("loadManifestConfig", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "buntime-manifest-test-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("loadManifestConfig (async)", () => {
    it("should return undefined when no manifest exists", async () => {
      const result = await loadManifestConfig(testDir);
      expect(result).toBeUndefined();
    });

    it("should load manifest.yaml", async () => {
      writeFileSync(join(testDir, "manifest.yaml"), "name: test-app\nenabled: true");
      const result = await loadManifestConfig(testDir);
      expect(result).toEqual({ name: "test-app", enabled: true });
    });

    it("should load manifest.yml as fallback", async () => {
      writeFileSync(join(testDir, "manifest.yml"), "name: test-app\nenabled: false");
      const result = await loadManifestConfig(testDir);
      expect(result).toEqual({ name: "test-app", enabled: false });
    });

    it("should prefer manifest.yaml over manifest.yml", async () => {
      writeFileSync(join(testDir, "manifest.yaml"), "name: from-yaml");
      writeFileSync(join(testDir, "manifest.yml"), "name: from-yml");
      const result = await loadManifestConfig(testDir);
      expect(result).toEqual({ name: "from-yaml" });
    });
  });

  describe("loadManifestConfigSync", () => {
    it("should return undefined when no manifest exists", () => {
      const result = loadManifestConfigSync(testDir);
      expect(result).toBeUndefined();
    });

    it("should load manifest.yaml", () => {
      writeFileSync(join(testDir, "manifest.yaml"), "name: test-app\nentrypoint: index.ts");
      const result = loadManifestConfigSync(testDir);
      expect(result).toEqual({ name: "test-app", entrypoint: "index.ts" });
    });
  });
});
