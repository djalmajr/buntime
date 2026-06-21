import { describe, expect, it } from "bun:test";
import { matchShellRouteDir, normalizeRouteHost, type ShellRoute } from "./shell-routes";

describe("matchShellRouteDir", () => {
  const routes: ShellRoute[] = [
    { host: "a.example.com", dir: "/data/apps/@acme/shell-a/1.0.0" },
    { host: "*.example.com", dir: "/data/apps/@acme/shell-wild/1.0.0" },
    { host: "tenant.other.com", dir: "/data/apps/@acme/shell-b/2.0.0" },
  ];

  it("matches an exact host over a wildcard", () => {
    expect(matchShellRouteDir("a.example.com", routes)).toBe("/data/apps/@acme/shell-a/1.0.0");
  });

  it("matches a subdomain via wildcard", () => {
    expect(matchShellRouteDir("b.example.com", routes)).toBe("/data/apps/@acme/shell-wild/1.0.0");
  });

  it("strips the port and lowercases the request host", () => {
    expect(matchShellRouteDir("A.EXAMPLE.COM:8800", routes)).toBe("/data/apps/@acme/shell-a/1.0.0");
  });

  it("returns undefined when nothing matches (caller falls back to global)", () => {
    expect(matchShellRouteDir("nope.test", routes)).toBeUndefined();
  });

  it("prefers the most specific wildcard", () => {
    const r: ShellRoute[] = [
      { host: "*.example.com", dir: "/wide" },
      { host: "*.eu.example.com", dir: "/narrow" },
    ];
    expect(matchShellRouteDir("a.eu.example.com", r)).toBe("/narrow");
  });
});

describe("normalizeRouteHost", () => {
  it("accepts exact and wildcard hosts (lowercased)", () => {
    expect(normalizeRouteHost("Tenant.Example.com")).toBe("tenant.example.com");
    expect(normalizeRouteHost("*.example.com")).toBe("*.example.com");
  });

  it("rejects invalid hosts", () => {
    expect(normalizeRouteHost("bad host!")).toBeNull();
    expect(normalizeRouteHost("")).toBeNull();
  });
});
