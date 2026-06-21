import { describe, expect, it } from "bun:test";
import { interpolate, parseDeploySpec } from "./deploy-spec.ts";

describe("parseDeploySpec", () => {
  it("returns null when there is no deploy block", () => {
    expect(parseDeploySpec({ entrypoint: "index.ts" })).toBeNull();
    expect(parseDeploySpec(null)).toBeNull();
  });

  it("parses shell, plugins, redirects (with ${VAR}) and requiresEnv", () => {
    const spec = parseDeploySpec(
      {
        deploy: {
          shell: "default",
          plugins: [{ name: "@x/p", source: "../p" }],
          redirects: [
            {
              pattern: "^/api(/.*)?$",
              target: "${BACKEND}",
              rewrite: "/api$1",
              changeOrigin: true,
            },
          ],
          requiresEnv: ["AUTH_CONFIG"],
        },
      },
      { BACKEND: "https://b.test" },
    );
    expect(spec?.shell).toBe("default");
    expect(spec?.plugins).toEqual([{ name: "@x/p", source: "../p" }]);
    expect(spec?.redirects[0]).toMatchObject({
      pattern: "^/api(/.*)?$",
      target: "https://b.test",
      rewrite: "/api$1",
      changeOrigin: true,
    });
    expect(spec?.requiresEnv).toEqual(["AUTH_CONFIG"]);
  });

  it("parses a per-tenant shell", () => {
    expect(parseDeploySpec({ deploy: { shell: { perTenant: "t.example.com" } } })?.shell).toEqual({
      perTenant: "t.example.com",
    });
  });

  it("defaults missing sections to empty and shell to none", () => {
    const spec = parseDeploySpec({ deploy: {} });
    expect(spec).toEqual({ shell: "none", plugins: [], redirects: [], requiresEnv: [] });
  });

  it("throws on a malformed plugin (missing source)", () => {
    expect(() => parseDeploySpec({ deploy: { plugins: [{ name: "x" }] } })).toThrow(
      /plugins\[0\]\.source/,
    );
  });

  it("throws on an invalid shell value", () => {
    expect(() => parseDeploySpec({ deploy: { shell: "weird" } })).toThrow(/deploy\.shell/);
  });
});

describe("interpolate", () => {
  it("replaces ${VAR} from env and blanks missing vars", () => {
    expect(interpolate("a-${X}-b", { X: "1" })).toBe("a-1-b");
    expect(interpolate("${MISSING}", {})).toBe("");
  });
});
