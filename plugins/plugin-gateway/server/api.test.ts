import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createGatewayApi, type GatewayApiDeps } from "./api";
import type { GatewayPersistence, ShellExcludeEntry } from "./persistence";
import { RateLimiter } from "./rate-limit";
import { RequestLogger } from "./request-log";

describe("Gateway API", () => {
  let deps: GatewayApiDeps;
  let keyvalExcludes: Set<string>;
  let envExcludes: Set<string>;

  beforeEach(() => {
    keyvalExcludes = new Set();
    envExcludes = new Set(["env-app"]);

    const mockPersistence = {
      isAvailable: () => true,
      init: mock(async () => {}),
      shutdown: mock(async () => {}),
      startSnapshotCollection: mock(() => {}),
      stopSnapshotCollection: mock(() => {}),
      saveMetricsSnapshot: mock(async () => {}),
      getMetricsHistory: mock(async () => []),
      clearMetricsHistory: mock(async () => {}),
      addShellExclude: mock(async (basename: string) => {
        if (keyvalExcludes.has(basename)) return false;
        keyvalExcludes.add(basename);
        return true;
      }),
      removeShellExclude: mock(async (basename: string) => {
        const had = keyvalExcludes.has(basename);
        keyvalExcludes.delete(basename);
        return had;
      }),
      getAllShellExcludes: mock(async (envSet: Set<string>): Promise<ShellExcludeEntry[]> => {
        const result: ShellExcludeEntry[] = [];
        for (const b of envSet) result.push({ basename: b, source: "env" });
        for (const b of keyvalExcludes) {
          if (!envSet.has(b)) result.push({ basename: b, source: "keyval" });
        }
        return result;
      }),
      getShellExcludes: mock(async () => Array.from(keyvalExcludes)),
    } as unknown as GatewayPersistence;

    deps = {
      getConfig: () => ({}),
      getRateLimiter: () => null,
      getResponseCache: () => null,
      getRequestLogger: () => new RequestLogger(100),
      getPersistence: () => mockPersistence,
      getShellConfig: () => ({
        dir: "/test/shell",
        envExcludes,
        keyvalExcludes,
        addKeyValExclude: (b: string) => keyvalExcludes.add(b),
        removeKeyValExclude: (b: string) => keyvalExcludes.delete(b),
      }),
    };
  });

  describe("POST /api/shell/excludes", () => {
    it("adds exclude to keyval and memory", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/api/shell/excludes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basename: "new-app" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.added).toBe(true);
      expect(data.basename).toBe("new-app");
      expect(data.source).toBe("keyval");
      // Verify in-memory set was updated
      expect(keyvalExcludes.has("new-app")).toBe(true);
    });

    it("rejects empty basename", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/api/shell/excludes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basename: "" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("required");
    });

    it("rejects invalid basename with special characters", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/api/shell/excludes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basename: "invalid/path" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid");
    });

    it("rejects basename with dots", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/api/shell/excludes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basename: "my.app" }),
      });

      expect(res.status).toBe(400);
    });

    it("accepts valid basename with hyphens and underscores", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/api/shell/excludes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basename: "my-app_v2" }),
      });

      expect(res.status).toBe(200);
      expect(keyvalExcludes.has("my-app_v2")).toBe(true);
    });

    it("rejects if already in env excludes", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/api/shell/excludes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basename: "env-app" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("environment");
    });

    it("returns added=false if already exists in keyval", async () => {
      keyvalExcludes.add("existing-app");
      const app = createGatewayApi(deps);

      const res = await app.request("/api/shell/excludes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basename: "existing-app" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.added).toBe(false);
    });

    it("returns 400 if shell not configured", async () => {
      deps.getShellConfig = () => null;
      const app = createGatewayApi(deps);

      const res = await app.request("/api/shell/excludes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basename: "new-app" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Shell not configured");
    });
  });

  describe("DELETE /api/shell/excludes/:basename", () => {
    it("removes exclude from keyval and memory", async () => {
      keyvalExcludes.add("to-remove");
      const app = createGatewayApi(deps);

      const res = await app.request("/api/shell/excludes/to-remove", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.removed).toBe(true);
      expect(data.basename).toBe("to-remove");
      // Verify in-memory set was updated
      expect(keyvalExcludes.has("to-remove")).toBe(false);
    });

    it("returns removed=false if not found", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/api/shell/excludes/not-found", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.removed).toBe(false);
    });

    it("cannot remove env exclude", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/api/shell/excludes/env-app", {
        method: "DELETE",
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("environment");
    });

    it("returns 400 if shell not configured", async () => {
      deps.getShellConfig = () => null;
      const app = createGatewayApi(deps);

      const res = await app.request("/api/shell/excludes/some-app", {
        method: "DELETE",
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/shell/excludes", () => {
    it("returns combined env and keyval excludes", async () => {
      keyvalExcludes.add("dynamic-app");
      keyvalExcludes.add("another-app");
      const app = createGatewayApi(deps);

      const res = await app.request("/api/shell/excludes");

      expect(res.status).toBe(200);
      const data: ShellExcludeEntry[] = await res.json();
      expect(data).toHaveLength(3); // 1 env + 2 keyval

      const envEntry = data.find((e) => e.basename === "env-app");
      expect(envEntry?.source).toBe("env");

      const dynamicEntry = data.find((e) => e.basename === "dynamic-app");
      expect(dynamicEntry?.source).toBe("keyval");
    });

    it("returns only env excludes when no keyval", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/api/shell/excludes");

      expect(res.status).toBe(200);
      const data: ShellExcludeEntry[] = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0].basename).toBe("env-app");
      expect(data[0].source).toBe("env");
    });

    it("returns 400 if shell not configured", async () => {
      deps.getShellConfig = () => null;
      const app = createGatewayApi(deps);

      const res = await app.request("/api/shell/excludes");

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/stats", () => {
    it("returns stats with shell info", async () => {
      keyvalExcludes.add("app1");
      keyvalExcludes.add("app2");
      const app = createGatewayApi(deps);

      const res = await app.request("/api/stats");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.shell.enabled).toBe(true);
      expect(data.shell.dir).toBe("/test/shell");
      expect(data.shell.excludesCount).toBe(3); // 1 env + 2 keyval
    });

    it("returns shell disabled when not configured", async () => {
      deps.getShellConfig = () => null;
      const app = createGatewayApi(deps);

      const res = await app.request("/api/stats");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.shell.enabled).toBe(false);
    });
  });

  describe("Rate Limiter API", () => {
    beforeEach(() => {
      const rateLimiter = new RateLimiter(100, 60);
      rateLimiter.isAllowed("ip:192.168.1.1");
      rateLimiter.isAllowed("ip:192.168.1.2");
      deps.getRateLimiter = () => rateLimiter;
    });

    it("GET /api/rate-limit/metrics returns metrics", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/api/rate-limit/metrics");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.totalRequests).toBe(2);
      expect(data.allowedRequests).toBe(2);
      expect(data.blockedRequests).toBe(0);
    });

    it("GET /api/rate-limit/buckets returns active buckets", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/api/rate-limit/buckets");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(2);
      expect(data[0].key).toContain("ip:");
    });

    it("DELETE /api/rate-limit/buckets/:key clears a bucket", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/api/rate-limit/buckets/ip%3A192.168.1.1", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deleted).toBe(true);

      // Verify bucket was cleared
      const bucketsRes = await app.request("/api/rate-limit/buckets");
      const buckets = await bucketsRes.json();
      expect(buckets).toHaveLength(1);
    });

    it("POST /api/rate-limit/clear clears all buckets", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/api/rate-limit/clear", {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.cleared).toBe(2);

      // Verify all buckets were cleared
      const bucketsRes = await app.request("/api/rate-limit/buckets");
      const buckets = await bucketsRes.json();
      expect(buckets).toHaveLength(0);
    });
  });

  describe("Logs API", () => {
    beforeEach(() => {
      const logger = new RequestLogger(100);
      logger.log({
        ip: "1.1.1.1",
        method: "GET",
        path: "/test",
        status: 200,
        duration: 10,
        rateLimited: false,
      });
      logger.log({
        ip: "2.2.2.2",
        method: "POST",
        path: "/api",
        status: 429,
        duration: 5,
        rateLimited: true,
      });
      logger.log({
        ip: "1.1.1.1",
        method: "GET",
        path: "/other",
        status: 500,
        duration: 100,
        rateLimited: false,
      });
      deps.getRequestLogger = () => logger;
    });

    it("GET /api/logs returns all logs", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/api/logs");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(3);
    });

    it("GET /api/logs?rateLimited=true filters by rate limited", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/api/logs?rateLimited=true");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0].rateLimited).toBe(true);
    });

    it("GET /api/logs?ip=1.1.1.1 filters by IP", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/api/logs?ip=1.1.1.1");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(2);
      expect(data.every((l: { ip: string }) => l.ip === "1.1.1.1")).toBe(true);
    });

    it("DELETE /api/logs clears all logs", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/api/logs", { method: "DELETE" });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.cleared).toBe(true);

      // Verify logs were cleared
      const logsRes = await app.request("/api/logs");
      const logs = await logsRes.json();
      expect(logs).toHaveLength(0);
    });
  });
});
