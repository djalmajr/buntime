import { describe, expect, it } from "bun:test";

import {
  extractBasename,
  parseBasenames,
  parseCookieValue,
  shouldBypassShell,
} from "./shell-bypass";

describe("parseBasenames", () => {
  it("parses comma-separated values", () => {
    const result = parseBasenames("admin,legacy,reports");
    expect(result).toEqual(new Set(["admin", "legacy", "reports"]));
  });

  it("trims whitespace", () => {
    const result = parseBasenames(" admin , legacy , reports ");
    expect(result).toEqual(new Set(["admin", "legacy", "reports"]));
  });

  it("deduplicates", () => {
    const result = parseBasenames("admin,admin,legacy,admin");
    expect(result).toEqual(new Set(["admin", "legacy"]));
  });

  it("filters empty strings", () => {
    const result = parseBasenames("admin,,legacy,");
    expect(result).toEqual(new Set(["admin", "legacy"]));
  });

  it("filters invalid basenames (with /)", () => {
    const result = parseBasenames("admin,legacy/sub,reports");
    expect(result).toEqual(new Set(["admin", "reports"]));
  });

  it("filters invalid basenames (with special chars)", () => {
    const result = parseBasenames("admin,leg@cy,repo.rts,valid-name,valid_name");
    expect(result).toEqual(new Set(["admin", "valid-name", "valid_name"]));
  });

  it("handles empty string", () => {
    const result = parseBasenames("");
    expect(result).toEqual(new Set());
  });
});

describe("extractBasename", () => {
  it("extracts first segment", () => {
    expect(extractBasename("/admin/users/123")).toBe("admin");
  });

  it("handles root path", () => {
    expect(extractBasename("/")).toBe("");
  });

  it("handles single segment", () => {
    expect(extractBasename("/admin")).toBe("admin");
  });

  it("handles trailing slash", () => {
    expect(extractBasename("/admin/")).toBe("admin");
  });

  it("handles no leading slash", () => {
    expect(extractBasename("admin/users")).toBe("admin");
  });
});

describe("parseCookieValue", () => {
  it("extracts cookie value", () => {
    const cookies = "session=abc123; GATEWAY_SHELL_EXCLUDES=admin,legacy; other=value";
    expect(parseCookieValue(cookies, "GATEWAY_SHELL_EXCLUDES")).toBe("admin,legacy");
  });

  it("returns null for missing cookie", () => {
    const cookies = "session=abc123; other=value";
    expect(parseCookieValue(cookies, "GATEWAY_SHELL_EXCLUDES")).toBeNull();
  });

  it("handles null header", () => {
    expect(parseCookieValue(null, "GATEWAY_SHELL_EXCLUDES")).toBeNull();
  });

  it("handles URL-encoded values", () => {
    const cookies = "GATEWAY_SHELL_EXCLUDES=admin%2Clegacy";
    expect(parseCookieValue(cookies, "GATEWAY_SHELL_EXCLUDES")).toBe("admin,legacy");
  });

  it("handles cookie at start", () => {
    const cookies = "GATEWAY_SHELL_EXCLUDES=admin; other=value";
    expect(parseCookieValue(cookies, "GATEWAY_SHELL_EXCLUDES")).toBe("admin");
  });

  it("handles cookie at end", () => {
    const cookies = "other=value; GATEWAY_SHELL_EXCLUDES=admin";
    expect(parseCookieValue(cookies, "GATEWAY_SHELL_EXCLUDES")).toBe("admin");
  });
});

describe("shouldBypassShell", () => {
  const envExcludes = new Set(["admin", "legacy"]);

  it("bypasses when basename in env excludes", () => {
    expect(shouldBypassShell("/admin/users", null, envExcludes)).toBe(true);
    expect(shouldBypassShell("/legacy/page", null, envExcludes)).toBe(true);
  });

  it("does not bypass when basename not excluded", () => {
    expect(shouldBypassShell("/dashboard", null, envExcludes)).toBe(false);
    expect(shouldBypassShell("/app/home", null, envExcludes)).toBe(false);
  });

  it("bypasses when basename in cookie excludes (uppercase)", () => {
    const cookies = "GATEWAY_SHELL_EXCLUDES=dashboard,reports";
    expect(shouldBypassShell("/dashboard", cookies, envExcludes)).toBe(true);
    expect(shouldBypassShell("/reports/monthly", cookies, envExcludes)).toBe(true);
  });

  it("combines env and cookie excludes", () => {
    const cookies = "GATEWAY_SHELL_EXCLUDES=dashboard";
    // admin from env
    expect(shouldBypassShell("/admin", cookies, envExcludes)).toBe(true);
    // dashboard from cookie
    expect(shouldBypassShell("/dashboard", cookies, envExcludes)).toBe(true);
    // not in either
    expect(shouldBypassShell("/other", cookies, envExcludes)).toBe(false);
  });

  it("does not bypass root path", () => {
    expect(shouldBypassShell("/", null, envExcludes)).toBe(false);
  });

  it("handles empty env excludes", () => {
    const emptySet = new Set<string>();
    expect(shouldBypassShell("/admin", null, emptySet)).toBe(false);
  });
});

describe("shouldBypassShell with keyvalExcludes", () => {
  const envExcludes = new Set(["admin"]);
  const keyvalExcludes = new Set(["dashboard", "reports"]);

  it("bypasses when basename in keyval excludes", () => {
    expect(shouldBypassShell("/dashboard", null, envExcludes, keyvalExcludes)).toBe(true);
    expect(shouldBypassShell("/reports/monthly", null, envExcludes, keyvalExcludes)).toBe(true);
  });

  it("env excludes still work with keyval", () => {
    expect(shouldBypassShell("/admin", null, envExcludes, keyvalExcludes)).toBe(true);
  });

  it("does not bypass when not in any excludes", () => {
    expect(shouldBypassShell("/other", null, envExcludes, keyvalExcludes)).toBe(false);
  });

  it("handles empty keyval excludes", () => {
    expect(shouldBypassShell("/dashboard", null, envExcludes, new Set())).toBe(false);
  });

  it("combines env, keyval, and cookie excludes", () => {
    const cookies = "gateway_shell_excludes=cookie-app";
    // admin from env
    expect(shouldBypassShell("/admin", cookies, envExcludes, keyvalExcludes)).toBe(true);
    // dashboard from keyval
    expect(shouldBypassShell("/dashboard", cookies, envExcludes, keyvalExcludes)).toBe(true);
    // cookie-app from cookie
    expect(shouldBypassShell("/cookie-app", cookies, envExcludes, keyvalExcludes)).toBe(true);
    // not in any
    expect(shouldBypassShell("/unknown", cookies, envExcludes, keyvalExcludes)).toBe(false);
  });
});

describe("cookie case-insensitive", () => {
  const envExcludes = new Set<string>();

  it("accepts lowercase cookie name", () => {
    const cookies = "gateway_shell_excludes=dashboard";
    expect(shouldBypassShell("/dashboard", cookies, envExcludes)).toBe(true);
  });

  it("accepts uppercase cookie name", () => {
    const cookies = "GATEWAY_SHELL_EXCLUDES=dashboard";
    expect(shouldBypassShell("/dashboard", cookies, envExcludes)).toBe(true);
  });

  it("prefers lowercase over uppercase if both present", () => {
    // lowercase comes first in the check, so it wins
    // When lowercase is found, uppercase is NOT checked (short-circuit OR)
    const cookies = "gateway_shell_excludes=lower-app; GATEWAY_SHELL_EXCLUDES=upper-app";
    expect(shouldBypassShell("/lower-app", cookies, envExcludes)).toBe(true);
    // uppercase is NOT checked when lowercase is present
    expect(shouldBypassShell("/upper-app", cookies, envExcludes)).toBe(false);
  });

  it("checks uppercase when lowercase is empty", () => {
    // If lowercase cookie exists but is empty, uppercase is checked
    const cookies = "gateway_shell_excludes=; GATEWAY_SHELL_EXCLUDES=upper-app";
    expect(shouldBypassShell("/upper-app", cookies, envExcludes)).toBe(true);
  });

  it("falls back to uppercase if lowercase not present", () => {
    const cookies = "other=value; GATEWAY_SHELL_EXCLUDES=dashboard";
    expect(shouldBypassShell("/dashboard", cookies, envExcludes)).toBe(true);
  });
});
