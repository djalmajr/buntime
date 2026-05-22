import { describe, expect, it } from "bun:test";
import {
  type DeploymentPathInfo,
  extractAppName,
  isValidUploadDestination,
  parseDeploymentPath,
  pluginsPathPolicy,
  workersPathPolicy,
} from "./path-policies";

// -------------------------------------------------------------------------
// Legacy `parseDeploymentPath` wrapper — preserves the existing API shape.
// -------------------------------------------------------------------------

describe("parseDeploymentPath", () => {
  describe("empty/invalid paths", () => {
    it("should return empty result for null", () => {
      expect(parseDeploymentPath(null)).toEqual<DeploymentPathInfo>({
        appName: null,
        depth: 0,
        format: null,
        isInsideVersion: false,
        version: null,
      });
    });

    it("should return empty result for undefined", () => {
      expect(parseDeploymentPath(undefined)).toEqual<DeploymentPathInfo>({
        appName: null,
        depth: 0,
        format: null,
        isInsideVersion: false,
        version: null,
      });
    });

    it("should return empty result for empty string", () => {
      expect(parseDeploymentPath("")).toEqual<DeploymentPathInfo>({
        appName: null,
        depth: 0,
        format: null,
        isInsideVersion: false,
        version: null,
      });
    });

    it("should return empty result for whitespace only", () => {
      expect(parseDeploymentPath("   ")).toEqual<DeploymentPathInfo>({
        appName: null,
        depth: 0,
        format: null,
        isInsideVersion: false,
        version: null,
      });
    });

    it("should return empty result for path with only slashes", () => {
      expect(parseDeploymentPath("///")).toEqual<DeploymentPathInfo>({
        appName: null,
        depth: 0,
        format: null,
        isInsideVersion: false,
        version: null,
      });
    });
  });

  describe("flat format (app@version)", () => {
    it("parses flat semver", () => {
      expect(parseDeploymentPath("hello-api@1.0.0")).toEqual<DeploymentPathInfo>({
        appName: "hello-api",
        depth: 2,
        format: "flat",
        isInsideVersion: true,
        version: "1.0.0",
      });
    });

    it("parses flat 'latest'", () => {
      expect(parseDeploymentPath("my-app@latest")).toEqual<DeploymentPathInfo>({
        appName: "my-app",
        depth: 2,
        format: "flat",
        isInsideVersion: true,
        version: "latest",
      });
    });

    it("parses flat with path inside", () => {
      expect(parseDeploymentPath("hello-api@1.0.0/src")).toEqual<DeploymentPathInfo>({
        appName: "hello-api",
        depth: 3,
        format: "flat",
        isInsideVersion: true,
        version: "1.0.0",
      });
    });

    it("parses deep nested under flat", () => {
      expect(
        parseDeploymentPath("hello-api@1.0.0/src/components/Button.tsx"),
      ).toEqual<DeploymentPathInfo>({
        appName: "hello-api",
        depth: 5,
        format: "flat",
        isInsideVersion: true,
        version: "1.0.0",
      });
    });

    it("parses prerelease version", () => {
      expect(parseDeploymentPath("app@1.0.0-beta.1")).toEqual<DeploymentPathInfo>({
        appName: "app",
        depth: 2,
        format: "flat",
        isInsideVersion: true,
        version: "1.0.0-beta.1",
      });
    });

    it("treats scoped @scope/app@1.0.0 as nested (slash separator)", () => {
      const result = parseDeploymentPath("@scope/app@1.0.0");
      expect(result.format).toBe("nested");
      expect(result.appName).toBe("@scope");
      expect(result.isInsideVersion).toBe(false);
    });

    it("rejects invalid version after '@'", () => {
      const result = parseDeploymentPath("hello-api@not-a-version");
      expect(result.format).toBe("nested");
      expect(result.isInsideVersion).toBe(false);
    });
  });

  describe("nested format (app/version)", () => {
    it("parses app-only", () => {
      expect(parseDeploymentPath("hello-api")).toEqual<DeploymentPathInfo>({
        appName: "hello-api",
        depth: 1,
        format: "nested",
        isInsideVersion: false,
        version: null,
      });
    });

    it("parses app/version", () => {
      expect(parseDeploymentPath("hello-api/1.0.0")).toEqual<DeploymentPathInfo>({
        appName: "hello-api",
        depth: 2,
        format: "nested",
        isInsideVersion: true,
        version: "1.0.0",
      });
    });

    it("parses app/latest", () => {
      expect(parseDeploymentPath("my-app/latest")).toEqual<DeploymentPathInfo>({
        appName: "my-app",
        depth: 2,
        format: "nested",
        isInsideVersion: true,
        version: "latest",
      });
    });

    it("parses app/version/src", () => {
      expect(parseDeploymentPath("hello-api/1.0.0/src")).toEqual<DeploymentPathInfo>({
        appName: "hello-api",
        depth: 3,
        format: "nested",
        isInsideVersion: true,
        version: "1.0.0",
      });
    });

    it("parses deep nested", () => {
      expect(
        parseDeploymentPath("hello-api/1.0.0/src/components/Button.tsx"),
      ).toEqual<DeploymentPathInfo>({
        appName: "hello-api",
        depth: 5,
        format: "nested",
        isInsideVersion: true,
        version: "1.0.0",
      });
    });

    it("invalid version at second level → not insideVersion", () => {
      expect(parseDeploymentPath("hello-api/not-a-version")).toEqual<DeploymentPathInfo>({
        appName: "hello-api",
        depth: 2,
        format: "nested",
        isInsideVersion: false,
        version: null,
      });
    });

    it("nested path without version", () => {
      expect(parseDeploymentPath("hello-api/subfolder/another")).toEqual<DeploymentPathInfo>({
        appName: "hello-api",
        depth: 3,
        format: "nested",
        isInsideVersion: false,
        version: null,
      });
    });
  });

  describe("edge cases", () => {
    it("leading slash", () => {
      const result = parseDeploymentPath("/hello-api@1.0.0");
      expect(result.appName).toBe("hello-api");
      expect(result.version).toBe("1.0.0");
    });

    it("trailing slash", () => {
      const result = parseDeploymentPath("hello-api@1.0.0/");
      expect(result.appName).toBe("hello-api");
      expect(result.version).toBe("1.0.0");
    });

    it("multiple consecutive slashes", () => {
      const result = parseDeploymentPath("hello-api//1.0.0///src");
      expect(result.appName).toBe("hello-api");
      expect(result.version).toBe("1.0.0");
      expect(result.depth).toBe(3);
    });
  });
});

describe("isValidUploadDestination", () => {
  it("null → false", () => expect(isValidUploadDestination(null)).toBe(false));
  it("'' → false", () => expect(isValidUploadDestination("")).toBe(false));
  it("nested app-only → false", () => expect(isValidUploadDestination("hello-api")).toBe(false));
  it("nested invalid-version → false", () =>
    expect(isValidUploadDestination("hello-api/not-a-version")).toBe(false));
  it("flat → true", () => expect(isValidUploadDestination("hello-api@1.0.0")).toBe(true));
  it("flat with path → true", () =>
    expect(isValidUploadDestination("hello-api@1.0.0/src")).toBe(true));
  it("nested with version → true", () =>
    expect(isValidUploadDestination("hello-api/1.0.0")).toBe(true));
  it("nested with version + path → true", () =>
    expect(isValidUploadDestination("hello-api/1.0.0/src/file.ts")).toBe(true));
  it("'latest' tag (both formats) → true", () => {
    expect(isValidUploadDestination("hello-api@latest")).toBe(true);
    expect(isValidUploadDestination("hello-api/latest")).toBe(true);
  });
});

describe("extractAppName", () => {
  it("null → null", () => expect(extractAppName(null)).toBe(null));
  it("'' → null", () => expect(extractAppName("")).toBe(null));
  it("flat → app name", () => expect(extractAppName("hello-api@1.0.0")).toBe("hello-api"));
  it("flat with path → app name", () =>
    expect(extractAppName("hello-api@1.0.0/src/file.ts")).toBe("hello-api"));
  it("nested → app name", () => expect(extractAppName("hello-api/1.0.0")).toBe("hello-api"));
  it("app-only → app name", () => expect(extractAppName("hello-api")).toBe("hello-api"));
  it("scoped → scope (slash is separator)", () =>
    expect(extractAppName("@scope/my-app@1.0.0")).toBe("@scope"));
});

// -------------------------------------------------------------------------
// New policy-based API
// -------------------------------------------------------------------------

describe("workersPathPolicy", () => {
  it("canWriteAt: false at root", () => {
    expect(workersPathPolicy.canWriteAt("")).toBe(false);
  });

  it("canWriteAt: false at app-only (nested)", () => {
    expect(workersPathPolicy.canWriteAt("hello-api")).toBe(false);
  });

  it("canWriteAt: true at nested version folder", () => {
    expect(workersPathPolicy.canWriteAt("hello-api/1.0.0")).toBe(true);
  });

  it("canWriteAt: true inside flat version", () => {
    expect(workersPathPolicy.canWriteAt("hello-api@1.0.0/src")).toBe(true);
  });

  it("isUnitRoot: true for nested version folder", () => {
    expect(workersPathPolicy.isUnitRoot("hello-api/1.0.0")).toBe(true);
  });

  it("isUnitRoot: false for app-only", () => {
    expect(workersPathPolicy.isUnitRoot("hello-api")).toBe(false);
  });

  it("isUnitRoot: false for nested version + subpath", () => {
    expect(workersPathPolicy.isUnitRoot("hello-api/1.0.0/src")).toBe(false);
  });

  it("isUnitRoot: true for flat version (depth==2 by policy convention)", () => {
    // Flat policy bumps depth by 1, so the flat folder itself reports depth=2.
    expect(workersPathPolicy.isUnitRoot("hello-api@1.0.0")).toBe(true);
  });

  it("parse: unitRoot set to flat folder name", () => {
    expect(workersPathPolicy.parse("hello-api@1.0.0/src")).toMatchObject({
      appName: "hello-api",
      unitRoot: "hello-api@1.0.0",
      version: "1.0.0",
    });
  });
});

describe("pluginsPathPolicy", () => {
  it("canWriteAt: false at root", () => {
    expect(pluginsPathPolicy.canWriteAt("")).toBe(false);
  });

  it("canWriteAt: true at plugin root", () => {
    expect(pluginsPathPolicy.canWriteAt("plugin-foo")).toBe(true);
  });

  it("canWriteAt: true deep inside plugin", () => {
    expect(pluginsPathPolicy.canWriteAt("plugin-foo/dist/chunk-abc.js")).toBe(true);
  });

  it("isUnitRoot: true for plugin root only", () => {
    expect(pluginsPathPolicy.isUnitRoot("plugin-foo")).toBe(true);
  });

  it("isUnitRoot: false for plugin subpath", () => {
    expect(pluginsPathPolicy.isUnitRoot("plugin-foo/dist")).toBe(false);
  });

  it("parse: unitRoot is the plugin name", () => {
    expect(pluginsPathPolicy.parse("plugin-foo/dist/x.js")).toMatchObject({
      appName: "plugin-foo",
      unitRoot: "plugin-foo",
      depth: 3,
    });
  });

  it("accepts non-semver names (plugins don't version)", () => {
    expect(pluginsPathPolicy.canWriteAt("@scope/plugin")).toBe(true);
    expect(pluginsPathPolicy.parse("@scope/plugin").appName).toBe("@scope");
  });
});
