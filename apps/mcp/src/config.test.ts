import { describe, expect, it } from "bun:test";
import { loadConfig } from "./config.ts";

describe("loadConfig", () => {
  it("requires BUNTIME_URL", () => {
    expect(() => loadConfig({ BUNTIME_API_KEY: "k" })).toThrow(/BUNTIME_URL/);
  });

  it("requires BUNTIME_API_KEY", () => {
    expect(() => loadConfig({ BUNTIME_URL: "https://buntime.test" })).toThrow(/BUNTIME_API_KEY/);
  });

  it("strips a trailing slash and defaults origin to the base URL origin", () => {
    const config = loadConfig({ BUNTIME_URL: "https://buntime.test/", BUNTIME_API_KEY: "btk_x" });
    expect(config.baseUrl).toBe("https://buntime.test");
    expect(config.apiKey).toBe("btk_x");
    expect(config.origin).toBe("https://buntime.test");
    expect(config.apiPath).toBeUndefined();
  });

  it("honours explicit origin and api path overrides", () => {
    const config = loadConfig({
      BUNTIME_URL: "https://buntime.test",
      BUNTIME_API_KEY: "btk_x",
      BUNTIME_ORIGIN: "https://proxy.test",
      BUNTIME_API_PATH: "/_/api",
    });
    expect(config.origin).toBe("https://proxy.test");
    expect(config.apiPath).toBe("/_/api");
  });

  it("rejects an invalid BUNTIME_URL", () => {
    expect(() => loadConfig({ BUNTIME_URL: "not a url", BUNTIME_API_KEY: "k" })).toThrow(
      /Invalid BUNTIME_URL/,
    );
  });

  it("defaults gatewayBase to /gateway and honours BUNTIME_GATEWAY_BASE", () => {
    expect(loadConfig({ BUNTIME_URL: "https://x", BUNTIME_API_KEY: "k" }).gatewayBase).toBe(
      "/gateway",
    );
    expect(
      loadConfig({ BUNTIME_URL: "https://x", BUNTIME_API_KEY: "k", BUNTIME_GATEWAY_BASE: "/gw/" })
        .gatewayBase,
    ).toBe("/gw");
  });

  it("defaults proxyBase to /redirects and honours BUNTIME_PROXY_BASE", () => {
    expect(loadConfig({ BUNTIME_URL: "https://x", BUNTIME_API_KEY: "k" }).proxyBase).toBe(
      "/redirects",
    );
    expect(
      loadConfig({ BUNTIME_URL: "https://x", BUNTIME_API_KEY: "k", BUNTIME_PROXY_BASE: "/px/" })
        .proxyBase,
    ).toBe("/px");
  });
});
