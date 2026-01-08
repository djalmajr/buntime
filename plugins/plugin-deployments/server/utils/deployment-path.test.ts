import { describe, expect, it } from "bun:test";
import {
  type DeploymentPathInfo,
  extractAppName,
  isValidUploadDestination,
  parseDeploymentPath,
} from "./deployment-path";

describe("parseDeploymentPath", () => {
  describe("empty/invalid paths", () => {
    it("should return empty result for null", () => {
      const result = parseDeploymentPath(null);

      expect(result).toEqual<DeploymentPathInfo>({
        appName: null,
        depth: 0,
        format: null,
        isInsideVersion: false,
        version: null,
      });
    });

    it("should return empty result for undefined", () => {
      const result = parseDeploymentPath(undefined);

      expect(result).toEqual<DeploymentPathInfo>({
        appName: null,
        depth: 0,
        format: null,
        isInsideVersion: false,
        version: null,
      });
    });

    it("should return empty result for empty string", () => {
      const result = parseDeploymentPath("");

      expect(result).toEqual<DeploymentPathInfo>({
        appName: null,
        depth: 0,
        format: null,
        isInsideVersion: false,
        version: null,
      });
    });

    it("should return empty result for whitespace only", () => {
      const result = parseDeploymentPath("   ");

      expect(result).toEqual<DeploymentPathInfo>({
        appName: null,
        depth: 0,
        format: null,
        isInsideVersion: false,
        version: null,
      });
    });

    it("should return empty result for path with only slashes", () => {
      const result = parseDeploymentPath("///");

      expect(result).toEqual<DeploymentPathInfo>({
        appName: null,
        depth: 0,
        format: null,
        isInsideVersion: false,
        version: null,
      });
    });
  });

  describe("flat format (app@version)", () => {
    it("should parse flat format with semver version", () => {
      const result = parseDeploymentPath("hello-api@1.0.0");

      expect(result).toEqual<DeploymentPathInfo>({
        appName: "hello-api",
        depth: 2,
        format: "flat",
        isInsideVersion: true,
        version: "1.0.0",
      });
    });

    it("should parse flat format with 'latest' version", () => {
      const result = parseDeploymentPath("my-app@latest");

      expect(result).toEqual<DeploymentPathInfo>({
        appName: "my-app",
        depth: 2,
        format: "flat",
        isInsideVersion: true,
        version: "latest",
      });
    });

    it("should parse flat format with path inside version", () => {
      const result = parseDeploymentPath("hello-api@1.0.0/src");

      expect(result).toEqual<DeploymentPathInfo>({
        appName: "hello-api",
        depth: 3,
        format: "flat",
        isInsideVersion: true,
        version: "1.0.0",
      });
    });

    it("should parse flat format with deep nested path", () => {
      const result = parseDeploymentPath("hello-api@1.0.0/src/components/Button.tsx");

      expect(result).toEqual<DeploymentPathInfo>({
        appName: "hello-api",
        depth: 5,
        format: "flat",
        isInsideVersion: true,
        version: "1.0.0",
      });
    });

    it("should parse flat format with prerelease version", () => {
      const result = parseDeploymentPath("app@1.0.0-beta.1");

      expect(result).toEqual<DeploymentPathInfo>({
        appName: "app",
        depth: 2,
        format: "flat",
        isInsideVersion: true,
        version: "1.0.0-beta.1",
      });
    });

    it("should handle scoped packages by treating slash as path separator", () => {
      // Note: Scoped packages like @scope/app@1.0.0 are parsed as nested format
      // because the slash in @scope/app is treated as a path separator.
      // Use flat format without scope (e.g., scope-app@1.0.0) for reliable parsing.
      const result = parseDeploymentPath("@scope/app@1.0.0");

      // The "@scope" part becomes the app name, and "app@1.0.0" is treated as invalid version
      expect(result.format).toBe("nested");
      expect(result.appName).toBe("@scope");
      expect(result.isInsideVersion).toBe(false);
    });

    it("should not match flat format with invalid version", () => {
      const result = parseDeploymentPath("hello-api@not-a-version");

      // Falls back to nested format since version is invalid
      expect(result.format).toBe("nested");
      expect(result.isInsideVersion).toBe(false);
    });
  });

  describe("nested format (app/version)", () => {
    it("should parse app folder only", () => {
      const result = parseDeploymentPath("hello-api");

      expect(result).toEqual<DeploymentPathInfo>({
        appName: "hello-api",
        depth: 1,
        format: "nested",
        isInsideVersion: false,
        version: null,
      });
    });

    it("should parse nested format with semver version", () => {
      const result = parseDeploymentPath("hello-api/1.0.0");

      expect(result).toEqual<DeploymentPathInfo>({
        appName: "hello-api",
        depth: 2,
        format: "nested",
        isInsideVersion: true,
        version: "1.0.0",
      });
    });

    it("should parse nested format with 'latest' version", () => {
      const result = parseDeploymentPath("my-app/latest");

      expect(result).toEqual<DeploymentPathInfo>({
        appName: "my-app",
        depth: 2,
        format: "nested",
        isInsideVersion: true,
        version: "latest",
      });
    });

    it("should parse nested format with path inside version", () => {
      const result = parseDeploymentPath("hello-api/1.0.0/src");

      expect(result).toEqual<DeploymentPathInfo>({
        appName: "hello-api",
        depth: 3,
        format: "nested",
        isInsideVersion: true,
        version: "1.0.0",
      });
    });

    it("should parse nested format with deep nested path", () => {
      const result = parseDeploymentPath("hello-api/1.0.0/src/components/Button.tsx");

      expect(result).toEqual<DeploymentPathInfo>({
        appName: "hello-api",
        depth: 5,
        format: "nested",
        isInsideVersion: true,
        version: "1.0.0",
      });
    });

    it("should detect nested format with invalid version at second level", () => {
      const result = parseDeploymentPath("hello-api/not-a-version");

      expect(result).toEqual<DeploymentPathInfo>({
        appName: "hello-api",
        depth: 2,
        format: "nested",
        isInsideVersion: false,
        version: null,
      });
    });

    it("should handle nested path without version", () => {
      const result = parseDeploymentPath("hello-api/subfolder/another");

      expect(result).toEqual<DeploymentPathInfo>({
        appName: "hello-api",
        depth: 3,
        format: "nested",
        isInsideVersion: false,
        version: null,
      });
    });
  });

  describe("edge cases", () => {
    it("should handle leading slash", () => {
      const result = parseDeploymentPath("/hello-api@1.0.0");

      expect(result.appName).toBe("hello-api");
      expect(result.version).toBe("1.0.0");
    });

    it("should handle trailing slash", () => {
      const result = parseDeploymentPath("hello-api@1.0.0/");

      expect(result.appName).toBe("hello-api");
      expect(result.version).toBe("1.0.0");
    });

    it("should handle multiple consecutive slashes", () => {
      const result = parseDeploymentPath("hello-api//1.0.0///src");

      expect(result.appName).toBe("hello-api");
      expect(result.version).toBe("1.0.0");
      expect(result.depth).toBe(3);
    });
  });
});

describe("isValidUploadDestination", () => {
  it("should return false for null", () => {
    expect(isValidUploadDestination(null)).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(isValidUploadDestination("")).toBe(false);
  });

  it("should return false for app folder only (nested)", () => {
    expect(isValidUploadDestination("hello-api")).toBe(false);
  });

  it("should return false for nested folder without valid version", () => {
    expect(isValidUploadDestination("hello-api/not-a-version")).toBe(false);
  });

  it("should return true for flat format", () => {
    expect(isValidUploadDestination("hello-api@1.0.0")).toBe(true);
  });

  it("should return true for flat format with path", () => {
    expect(isValidUploadDestination("hello-api@1.0.0/src")).toBe(true);
  });

  it("should return true for nested format with version", () => {
    expect(isValidUploadDestination("hello-api/1.0.0")).toBe(true);
  });

  it("should return true for nested format with version and path", () => {
    expect(isValidUploadDestination("hello-api/1.0.0/src/file.ts")).toBe(true);
  });

  it("should return true for 'latest' version", () => {
    expect(isValidUploadDestination("hello-api@latest")).toBe(true);
    expect(isValidUploadDestination("hello-api/latest")).toBe(true);
  });
});

describe("extractAppName", () => {
  it("should return null for null", () => {
    expect(extractAppName(null)).toBe(null);
  });

  it("should return null for empty string", () => {
    expect(extractAppName("")).toBe(null);
  });

  it("should extract app name from flat format", () => {
    expect(extractAppName("hello-api@1.0.0")).toBe("hello-api");
  });

  it("should extract app name from flat format with path", () => {
    expect(extractAppName("hello-api@1.0.0/src/file.ts")).toBe("hello-api");
  });

  it("should extract app name from nested format", () => {
    expect(extractAppName("hello-api/1.0.0")).toBe("hello-api");
  });

  it("should extract app name from app folder only", () => {
    expect(extractAppName("hello-api")).toBe("hello-api");
  });

  it("should handle scoped packages by extracting scope as app name", () => {
    // Note: Scoped packages are parsed with slash as path separator
    // so @scope becomes the app name
    expect(extractAppName("@scope/my-app@1.0.0")).toBe("@scope");
  });
});
