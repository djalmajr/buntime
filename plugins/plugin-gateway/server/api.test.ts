import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createGatewayApi, type GatewayApiDeps } from "./api";
import type { GatewayPersistence, ShellExcludeEntry } from "./persistence";
import { RateLimiter } from "./rate-limit";
import { RequestLogger } from "./request-log";

describe("Gateway API", () => {
  let deps: GatewayApiDeps;
  let tursoExcludes: Set<string>;
  let envExcludes: Set<string>;
  let corsRules: import("./cors").CorsRule[];
  let shellRoutes: import("./shell-routes").ShellRoute[];

  beforeEach(() => {
    tursoExcludes = new Set();
    envExcludes = new Set(["env-app"]);
    corsRules = [];
    shellRoutes = [];

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
        if (tursoExcludes.has(basename)) return false;
        tursoExcludes.add(basename);
        return true;
      }),
      removeShellExclude: mock(async (basename: string) => {
        const had = tursoExcludes.has(basename);
        tursoExcludes.delete(basename);
        return had;
      }),
      getAllShellExcludes: mock(async (envSet: Set<string>): Promise<ShellExcludeEntry[]> => {
        const result: ShellExcludeEntry[] = [];
        for (const b of envSet) result.push({ basename: b, source: "env" });
        for (const b of tursoExcludes) {
          if (!envSet.has(b)) result.push({ basename: b, source: "turso" });
        }
        return result;
      }),
      getShellExcludes: mock(async () => Array.from(tursoExcludes)),
    } as unknown as GatewayPersistence;

    deps = {
      getConfig: () => ({}),
      getRateLimiter: () => null,
      getResponseCache: () => null,
      getRequestLogger: () => new RequestLogger(100),
      getPersistence: () => mockPersistence,
      getShellConfig: () => ({
        dir: "/test/shell",
        source: "default" as const,
        seedDir: "/test/shell",
        envExcludes,
        tursoExcludes,
        addTursoExclude: (b: string) => tursoExcludes.add(b),
        removeTursoExclude: (b: string) => tursoExcludes.delete(b),
      }),
      setShellDir: mock(async () => {}),
      resetShellDir: mock(async () => {}),
      getCorsRules: () => corsRules,
      saveCorsRule: mock(async (rule) => {
        const idx = corsRules.findIndex((r) => r.id === rule.id);
        if (idx >= 0) corsRules[idx] = rule;
        else corsRules.push(rule);
      }),
      deleteCorsRule: mock(async (id: string) => {
        const had = corsRules.some((r) => r.id === id);
        corsRules = corsRules.filter((r) => r.id !== id);
        return had;
      }),
      getShellRoutes: () => shellRoutes,
      saveShellRoute: mock(async (host: string, dir: string) => {
        const idx = shellRoutes.findIndex((r) => r.host === host);
        const entry = { host, dir, createdAt: Date.now() };
        if (idx >= 0) shellRoutes[idx] = entry;
        else shellRoutes.push(entry);
      }),
      deleteShellRoute: mock(async (host: string) => {
        const had = shellRoutes.some((r) => r.host === host);
        shellRoutes = shellRoutes.filter((r) => r.host !== host);
        return had;
      }),
    };
  });

  describe("Shell routes (/admin/shell/routes)", () => {
    it("lists, upserts, and deletes per-host routes", async () => {
      const app = createGatewayApi(deps);

      let res = await app.request("/admin/shell/routes");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);

      res = await app.request("/admin/shell/routes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: "tenant-a.example.com", dir: "/data/apps/@acme/shell/1.0.0" }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ host: "tenant-a.example.com" });

      res = await app.request("/admin/shell/routes");
      expect((await res.json()).length).toBe(1);

      res = await app.request("/admin/shell/routes/tenant-a.example.com", { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ removed: true });
    });

    it("rejects a route without host or dir", async () => {
      const app = createGatewayApi(deps);
      const res = await app.request("/admin/shell/routes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: "x.example.com" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /admin/shell/excludes", () => {
    it("adds exclude to Turso and memory", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/shell/excludes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basename: "new-app" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.added).toBe(true);
      expect(data.basename).toBe("new-app");
      expect(data.source).toBe("turso");
      // Verify in-memory set was updated
      expect(tursoExcludes.has("new-app")).toBe(true);
    });

    it("rejects empty basename", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/shell/excludes", {
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

      const res = await app.request("/admin/shell/excludes", {
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

      const res = await app.request("/admin/shell/excludes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basename: "my.app" }),
      });

      expect(res.status).toBe(400);
    });

    it("accepts valid basename with hyphens and underscores", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/shell/excludes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basename: "my-app_v2" }),
      });

      expect(res.status).toBe(200);
      expect(tursoExcludes.has("my-app_v2")).toBe(true);
    });

    it("rejects if already in env excludes", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/shell/excludes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basename: "env-app" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("environment");
    });

    it("returns added=false if already exists in Turso", async () => {
      tursoExcludes.add("existing-app");
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/shell/excludes", {
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

      const res = await app.request("/admin/shell/excludes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basename: "new-app" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Shell not configured");
    });
  });

  describe("DELETE /admin/shell/excludes/:basename", () => {
    it("removes exclude from Turso and memory", async () => {
      tursoExcludes.add("to-remove");
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/shell/excludes/to-remove", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.removed).toBe(true);
      expect(data.basename).toBe("to-remove");
      // Verify in-memory set was updated
      expect(tursoExcludes.has("to-remove")).toBe(false);
    });

    it("returns removed=false if not found", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/shell/excludes/not-found", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.removed).toBe(false);
    });

    it("cannot remove env exclude", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/shell/excludes/env-app", {
        method: "DELETE",
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("environment");
    });

    it("returns 400 if shell not configured", async () => {
      deps.getShellConfig = () => null;
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/shell/excludes/some-app", {
        method: "DELETE",
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /admin/shell/excludes", () => {
    it("returns combined env and Turso excludes", async () => {
      tursoExcludes.add("dynamic-app");
      tursoExcludes.add("another-app");
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/shell/excludes");

      expect(res.status).toBe(200);
      const data: ShellExcludeEntry[] = await res.json();
      expect(data).toHaveLength(3); // 1 env + 2 Turso

      const envEntry = data.find((e) => e.basename === "env-app");
      expect(envEntry?.source).toBe("env");

      const dynamicEntry = data.find((e) => e.basename === "dynamic-app");
      expect(dynamicEntry?.source).toBe("turso");
    });

    it("returns only env excludes when no Turso excludes", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/shell/excludes");

      expect(res.status).toBe(200);
      const data: ShellExcludeEntry[] = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({ basename: "env-app", source: "env" });
    });

    it("returns 400 if shell not configured", async () => {
      deps.getShellConfig = () => null;
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/shell/excludes");

      expect(res.status).toBe(400);
    });
  });

  describe("GET /admin/stats", () => {
    it("returns stats with shell info", async () => {
      tursoExcludes.add("app1");
      tursoExcludes.add("app2");
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/stats");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.shell.enabled).toBe(true);
      expect(data.shell.dir).toBe("/test/shell");
      expect(data.shell.excludesCount).toBe(3); // 1 env + 2 Turso
    });

    it("returns shell disabled when not configured", async () => {
      deps.getShellConfig = () => null;
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/stats");

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

      const res = await app.request("/admin/rate-limit/metrics");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.totalRequests).toBe(2);
      expect(data.allowedRequests).toBe(2);
      expect(data.blockedRequests).toBe(0);
    });

    it("GET /api/rate-limit/buckets returns active buckets", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/rate-limit/buckets");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(2);
      expect(data[0].key).toContain("ip:");
    });

    it("DELETE /api/rate-limit/buckets/:key clears a bucket", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/rate-limit/buckets/ip%3A192.168.1.1", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deleted).toBe(true);

      // Verify bucket was cleared
      const bucketsRes = await app.request("/admin/rate-limit/buckets");
      const buckets = await bucketsRes.json();
      expect(buckets).toHaveLength(1);
    });

    it("POST /api/rate-limit/clear clears all buckets", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/rate-limit/clear", {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.cleared).toBe(2);

      // Verify all buckets were cleared
      const bucketsRes = await app.request("/admin/rate-limit/buckets");
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

      const res = await app.request("/admin/logs");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(3);
    });

    it("GET /api/logs?rateLimited=true filters by rate limited", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/logs?rateLimited=true");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0].rateLimited).toBe(true);
    });

    it("GET /api/logs?ip=1.1.1.1 filters by IP", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/logs?ip=1.1.1.1");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(2);
      expect(data.every((l: { ip: string }) => l.ip === "1.1.1.1")).toBe(true);
    });

    it("DELETE /api/logs clears all logs", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/logs", { method: "DELETE" });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.cleared).toBe(true);

      // Verify logs were cleared
      const logsRes = await app.request("/admin/logs");
      const logs = await logsRes.json();
      expect(logs).toHaveLength(0);
    });
  });

  describe("CORS rules (per-domain)", () => {
    it("POST /admin/cors/rules creates a rule", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/cors/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Public API",
          origins: "https://a.example.com, *.example.com",
          methods: ["get", "post"],
          credentials: true,
          maxAge: 600,
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBeTruthy();
      expect(data.name).toBe("Public API");
      expect(data.origins).toEqual(["https://a.example.com", "*.example.com"]);
      expect(data.methods).toEqual(["GET", "POST"]);
      expect(data.credentials).toBe(true);
      expect(corsRules).toHaveLength(1);
    });

    it("requires a name and at least one origin", async () => {
      const app = createGatewayApi(deps);

      const noName = await app.request("/admin/cors/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origins: "*" }),
      });
      expect(noName.status).toBe(400);

      const noOrigin = await app.request("/admin/cors/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x", origins: "" }),
      });
      expect(noOrigin.status).toBe(400);
    });

    it("rejects credentials with a wildcard origin", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/cors/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x", origins: "*", credentials: true }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects invalid HTTP methods", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/cors/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x", origins: "https://a.com", methods: ["GET", "FOO"] }),
      });

      expect(res.status).toBe(400);
    });

    it("PUT updates and DELETE removes a rule", async () => {
      const app = createGatewayApi(deps);

      const created = await (
        await app.request("/admin/cors/rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Rule", origins: "https://a.com" }),
        })
      ).json();

      const updated = await app.request(`/admin/cors/rules/${created.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Renamed", origins: "https://b.com" }),
      });
      expect(updated.status).toBe(200);
      const updatedData = await updated.json();
      expect(updatedData.name).toBe("Renamed");
      expect(updatedData.id).toBe(created.id);

      const del = await app.request(`/admin/cors/rules/${created.id}`, { method: "DELETE" });
      expect(del.status).toBe(200);
      expect((await del.json()).removed).toBe(true);
      expect(corsRules).toHaveLength(0);
    });

    it("PUT returns 404 for an unknown rule", async () => {
      const app = createGatewayApi(deps);

      const res = await app.request("/admin/cors/rules/nope", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x", origins: "https://a.com" }),
      });

      expect(res.status).toBe(404);
    });
  });
});
