import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { RuntimeApiError, RuntimeClient } from "./client.ts";
import type { McpConfig } from "./config.ts";

const config: McpConfig = {
  baseUrl: "https://buntime.test",
  apiKey: "btk_test",
  origin: "https://buntime.test",
  gatewayBase: "/gateway",
  proxyBase: "/redirects",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("RuntimeClient", () => {
  const realFetch = globalThis.fetch;
  let queue: Response[];
  let calls: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    queue = [];
    calls = [];
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const next = queue.shift();
      if (!next) {
        throw new Error("unexpected fetch: no queued response");
      }
      return next;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("discovers the api path from well-known, then lists workers with the api key header", async () => {
    queue.push(jsonResponse({ api: "/_/api", version: "1.0.0" }));
    queue.push(
      jsonResponse([
        { name: "@x/y", path: "/p", removable: true, source: "uploaded", versions: ["1.0.0"] },
      ]),
    );

    const client = new RuntimeClient(config);
    const workers = await client.listWorkers();

    expect(workers).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://buntime.test/.well-known/buntime");
    expect(calls[1]?.url).toBe("https://buntime.test/_/api/workers");
    const headers = calls[1]?.init?.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("btk_test");
    expect(headers.Origin).toBe("https://buntime.test");
  });

  it("falls back to /api when discovery is not ok", async () => {
    queue.push(jsonResponse({ error: "missing" }, 404));
    queue.push(jsonResponse({ ok: true, status: "healthy", version: "1.0.0" }));

    const client = new RuntimeClient(config);
    await client.health();

    expect(calls[1]?.url).toBe("https://buntime.test/api/health");
  });

  it("uses an explicit api path without discovery", async () => {
    queue.push(jsonResponse([]));
    const client = new RuntimeClient({ ...config, apiPath: "/_/api" });
    await client.listWorkers();
    expect(calls[0]?.url).toBe("https://buntime.test/_/api/workers");
  });

  it("maps a runtime error body { success, code, message } to RuntimeApiError", async () => {
    queue.push(jsonResponse({ api: "/api" }));
    queue.push(
      jsonResponse(
        { success: false, code: "WORKER_NOT_FOUND", message: "Worker not found: ghost" },
        404,
      ),
    );

    const client = new RuntimeClient(config);
    const promise = client.deleteWorker("_", "ghost");
    await expect(promise).rejects.toBeInstanceOf(RuntimeApiError);
    await promise.catch((err: RuntimeApiError) => {
      expect(err.code).toBe("WORKER_NOT_FOUND");
      expect(err.status).toBe(404);
    });
  });

  it("maps an admin error body { code, error } to RuntimeApiError", async () => {
    queue.push(jsonResponse({ api: "/api" }));
    queue.push(jsonResponse({ code: "AUTH_REQUIRED", error: "Unauthorized" }, 401));

    const client = new RuntimeClient(config);
    await expect(client.whoami()).rejects.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
  });

  it("encodes scoped plugin names in the path", async () => {
    queue.push(jsonResponse({ api: "/api" }));
    queue.push(jsonResponse({ success: true }));

    const client = new RuntimeClient(config);
    await client.setPluginEnabled("@acme/plugin-x", false);

    expect(calls[1]?.url).toBe("https://buntime.test/api/plugins/%40acme%2Fplugin-x/disable");
    expect(calls[1]?.init?.method).toBe("POST");
  });

  it("calls the gateway admin API at the base URL, not the api path", async () => {
    queue.push(jsonResponse({ host: "t.example.com", dir: "/d" }));

    const client = new RuntimeClient(config);
    await client.setShellRoute("t.example.com", "/d");

    // No /.well-known discovery; one direct call to the gateway admin route.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://buntime.test/gateway/admin/shell/routes");
    expect(calls[0]?.init?.method).toBe("PUT");
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("btk_test");
  });

  it("creates a proxy redirect via POST at the proxy admin base", async () => {
    queue.push(jsonResponse({ id: "r1", pattern: "^/api(/.*)?$" }));
    const client = new RuntimeClient(config);
    await client.setRedirect({
      name: "api",
      pattern: "^/api(/.*)?$",
      target: "https://b.test",
      rewrite: "/api$1",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://buntime.test/redirects/admin/rules");
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("updates a proxy redirect via PUT when an id is given", async () => {
    queue.push(jsonResponse({ id: "r1" }));
    const client = new RuntimeClient(config);
    await client.setRedirect({ id: "r1", name: "api", pattern: "p", target: "https://b.test" });
    expect(calls[0]?.url).toBe("https://buntime.test/redirects/admin/rules/r1");
    expect(calls[0]?.init?.method).toBe("PUT");
  });
});
