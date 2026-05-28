import { describe, expect, it } from "bun:test";
import { injectConfig, resolveAuthConfig } from "./index.ts";

describe("shell index", () => {
  it("injects window.__config before </head>", () => {
    const html = "<html><head><title>x</title></head><body></body></html>";
    const out = injectConfig(html, { auth: { realm: "tenant-1" } });
    expect(out).toContain('<script>window.__config={"auth":{"realm":"tenant-1"}}</script></head>');
  });

  it("escapes </script> in injected config (XSS guard)", () => {
    const out = injectConfig("<head></head>", { auth: { realm: "</script><img>" } });
    expect(out).not.toContain("</script><img>");
    expect(out).toContain("<\\/script");
  });

  it("resolveAuthConfig returns parsed config from the platform endpoint", async () => {
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).host).toBe("tenant-1.djalmajr.dev");
      return new Response(
        JSON.stringify({ url: "https://kc", realm: "tenant-1", clientId: "web" }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    const cfg = await resolveAuthConfig("tenant-1.djalmajr.dev", fakeFetch);
    expect(cfg).toEqual({ url: "https://kc", realm: "tenant-1", clientId: "web" });
  });

  it("resolveAuthConfig returns undefined for an unknown host (404)", async () => {
    const fakeFetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    expect(await resolveAuthConfig("nope.dev", fakeFetch)).toBeUndefined();
  });

  it("resolveAuthConfig swallows fetch errors", async () => {
    const fakeFetch = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await resolveAuthConfig("x.dev", fakeFetch)).toBeUndefined();
  });
});
