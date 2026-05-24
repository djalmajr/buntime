import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginContext, PluginLogger } from "@buntime/shared/types";
import { initConfig } from "../../apps/runtime/src/config.ts";
import { PluginLoader } from "../../apps/runtime/src/plugins/loader.ts";
import tursoPlugin, {
  tursoPlugin as namedExport,
  resolveTursoConfig,
  type TursoAdapter,
  type TursoService,
  TursoServiceImpl,
} from "./plugin.ts";

/**
 * Build a fake adapter (cast to `TursoAdapter`) with a `push` spy, so a
 * `TursoServiceImpl` can be exercised without a live turso-server. Used to
 * assert the durability behavior of `transaction()` (push-after-commit in
 * sync mode).
 */
function createFakeAdapter(mode: "local" | "sync") {
  const push = mock(async () => {});
  const exec = mock(async (_sql: string) => {});
  const adapter = {
    checkpoint: async () => {},
    close: async () => {},
    exec,
    getRawClient: () => ({}),
    getSyncStats: async () => null,
    localPath: "/tmp/fake.db",
    mode,
    prepare: () => ({
      all: async () => [],
      get: async () => null,
      run: async () => ({ changes: 1, lastInsertRowid: 1 }),
    }),
    pull: async () => false,
    push,
    transaction: async (cb: (db: unknown) => Promise<unknown>) => cb(adapter),
  };
  return { adapter, exec, push };
}

function createMockLogger(): PluginLogger {
  return {
    debug: mock(() => {}),
    error: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
  };
}

function createMockContext(logger: PluginLogger = createMockLogger()): PluginContext {
  return {
    config: {},
    getPlugin: mock(() => undefined),
    globalConfig: {
      pluginDirs: [],
      poolSize: 10,
      workerDirs: [],
    },
    logger,
    runtime: {
      api: "/api",
      version: "0.0.0",
    },
  };
}

describe("tursoPlugin", () => {
  afterEach(async () => {
    const plugin = tursoPlugin({ localPath: ":memory:" });
    await plugin.onShutdown?.();
  });

  describe("exports", () => {
    it("should export default function", () => {
      expect(typeof tursoPlugin).toBe("function");
    });

    it("should export named tursoPlugin function", () => {
      expect(namedExport).toBe(tursoPlugin);
    });

    it("should export implementation classes", async () => {
      const mod = await import("./plugin.ts");

      expect(mod.TursoAdapter).toBeDefined();
      expect(mod.TursoServiceImpl).toBeDefined();
    });
  });

  describe("plugin lifecycle", () => {
    it("should return a service provider plugin", () => {
      const plugin = tursoPlugin({ localPath: ":memory:" });

      expect(plugin.routes).toBeUndefined();
      expect(typeof plugin.onInit).toBe("function");
      expect(typeof plugin.onShutdown).toBe("function");
      expect(typeof plugin.provides).toBe("function");
    });

    it("should initialize and expose Turso service", async () => {
      const logger = createMockLogger();
      const ctx = createMockContext(logger);
      const plugin = tursoPlugin({ localPath: ":memory:" });

      await plugin.onInit?.(ctx);

      const service = plugin.provides?.() as TursoService | null;
      expect(service).toBeDefined();

      const db = await service?.connect("keyval");
      await db?.exec("CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT)");
      await db?.prepare("INSERT INTO entries (value) VALUES (?)").run("stored");

      const row = await db?.prepare("SELECT value FROM entries").get<{ value: string }>();
      expect(row?.value).toBe("stored");

      await plugin.onShutdown?.();
      expect(logger.info).toHaveBeenCalledWith(
        "Turso plugin initialized (mode: local, localPath: :memory:)",
      );
    });

    it("should close service on shutdown", async () => {
      const plugin = tursoPlugin({ localPath: ":memory:" });
      const ctx = createMockContext();

      await plugin.onInit?.(ctx);
      expect(plugin.provides?.()).toBeDefined();

      await plugin.onShutdown?.();
      expect(plugin.provides?.()).toBeNull();
    });
  });
});

describe("PluginLoader integration", () => {
  it("should load the hook-only Turso plugin and register its provided service", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "buntime-turso-loader-"));
    const pluginsDir = join(baseDir, "plugins");
    const workersDir = join(baseDir, "workers");
    const pluginDir = join(pluginsDir, "plugin-turso");
    const sourcePluginPath = join(import.meta.dir, "plugin.ts");

    mkdirSync(pluginDir, { recursive: true });
    mkdirSync(workersDir, { recursive: true });
    writeFileSync(
      join(pluginDir, "manifest.yaml"),
      [
        'name: "@buntime/plugin-turso"',
        "enabled: true",
        "pluginEntry: plugin.ts",
        "mode: local",
        'localPath: ":memory:"',
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(pluginDir, "plugin.ts"),
      [
        `export { default } from ${JSON.stringify(sourcePluginPath)};`,
        `export * from ${JSON.stringify(sourcePluginPath)};`,
        "",
      ].join("\n"),
    );

    initConfig({ baseDir, workerDirs: [workersDir] });
    const loader = new PluginLoader({ pluginDirs: [pluginsDir] });
    let registry: Awaited<ReturnType<PluginLoader["load"]>> | undefined;

    try {
      registry = await loader.load();

      expect(registry.has("@buntime/plugin-turso")).toBe(true);
      const service = registry.getPlugin<TursoService>("@buntime/plugin-turso");
      expect(service).toBeDefined();
      if (!service) return;

      const db = await service.connect("loader_smoke");
      await db.exec("CREATE TABLE smoke_entries (id INTEGER PRIMARY KEY, value TEXT)");

      await service.transaction({ namespace: "loader_smoke" }, async (tx) => {
        await tx.prepare("INSERT INTO smoke_entries (value) VALUES (?)").run("loaded");
      });

      const row = await db.prepare("SELECT value FROM smoke_entries").get<{ value: string }>();
      const health = await service.health();

      expect(row?.value).toBe("loaded");
      expect(health.ok).toBe(true);
      expect(health.namespaces.toSorted()).toEqual(["loader_smoke", "runtime"]);
    } finally {
      await registry?.runOnShutdown();
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

describe("TursoServiceImpl", () => {
  it("should report health after connecting", async () => {
    const service = new TursoServiceImpl({
      config: resolveTursoConfig({ localPath: ":memory:" }),
      logger: createMockLogger(),
    });

    await service.connect("gateway");
    const health = await service.health();

    expect(health.connected).toBe(true);
    expect(health.localPath).toBe(":memory:");
    expect(health.mode).toBe("local");
    expect(health.namespaces).toEqual(["gateway"]);
    expect(health.ok).toBe(true);
    expect(health.sync.enabled).toBe(false);

    await service.close();
  });

  it("should run BEGIN CONCURRENT transactions with MVCC enabled", async () => {
    const service = new TursoServiceImpl({
      config: resolveTursoConfig({ localPath: ":memory:" }),
      logger: createMockLogger(),
    });

    const db = await service.connect("proxy");
    await db.exec("CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER)");

    await service.transaction({ namespace: "proxy" }, async (tx) => {
      await tx.prepare("INSERT INTO counters (name, value) VALUES (?, ?)").run("requests", 1);
    });

    const row = await db
      .prepare("SELECT value FROM counters WHERE name = ?")
      .get<{ value: number }>("requests");

    expect(row?.value).toBe(1);

    await service.close();
  });

  it("pushes after a write transaction in sync mode (durability)", async () => {
    const { adapter, push } = createFakeAdapter("sync");
    const service = new TursoServiceImpl({
      config: { localPath: "/tmp/fake.db", mode: "sync", sync: { url: "http://fake-sync" } },
      logger: createMockLogger(),
      openAdapter: async () => adapter as unknown as TursoAdapter,
    });

    await service.transaction({ namespace: "proxy" }, async (tx) => {
      await tx.prepare("INSERT INTO proxy_rules (id) VALUES (?)").run("r1");
    });

    // Without this push, the committed write only lives in the local replica
    // and is lost when the pod restarts (the symptom this fix resolves).
    expect(push).toHaveBeenCalledTimes(1);

    await service.close();
  });

  it("does not push in local mode", async () => {
    const { adapter, push } = createFakeAdapter("local");
    const service = new TursoServiceImpl({
      config: { localPath: "/tmp/fake.db", mode: "local" },
      logger: createMockLogger(),
      openAdapter: async () => adapter as unknown as TursoAdapter,
    });

    await service.transaction({ namespace: "proxy" }, async (tx) => {
      await tx.prepare("INSERT INTO t (id) VALUES (?)").run("r1");
    });

    expect(push).toHaveBeenCalledTimes(0);

    await service.close();
  });

  it("opens one replica per namespace in multi-tenant mode (with dedup + health)", async () => {
    const openedUrls: string[] = [];
    const service = new TursoServiceImpl({
      config: {
        localPath: "/data/turso/runtime.db",
        mode: "sync",
        server: { url: "http://turso-server:8080" },
      },
      logger: createMockLogger(),
      openAdapter: async ({ config }) => {
        openedUrls.push(config.sync?.url ?? "");
        return createFakeAdapter("sync").adapter as unknown as TursoAdapter;
      },
    });

    const a1 = await service.connect("proxy");
    const a2 = await service.connect("proxy"); // cached — must not open a 2nd replica
    await service.connect("gateway");

    expect(a1).toBe(a2);
    // Each namespace routes to `<server.url>/<namespace>` with a per-namespace
    // local replica (the in-cluster turso-server topology).
    expect(openedUrls).toEqual([
      "http://turso-server:8080/proxy",
      "http://turso-server:8080/gateway",
    ]);

    const health = await service.health();
    expect(health.namespaces.toSorted()).toEqual(["gateway", "proxy"]);
    expect(health.sync.enabled).toBe(true);
    expect(health.ok).toBe(true);

    await service.close();
  });

  it("retries a transaction on a retryable (busy) conflict", async () => {
    const { adapter } = createFakeAdapter("local");
    const service = new TursoServiceImpl({
      config: { localPath: "/tmp/fake.db", mode: "local" },
      logger: createMockLogger(),
      openAdapter: async () => adapter as unknown as TursoAdapter,
    });

    let attempts = 0;
    const result = await service.transaction(
      { maxRetries: 3, namespace: "proxy", retryDelayMs: 0 },
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("database is busy"); // retryable
        }
        return "ok";
      },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(2);

    await service.close();
  });

  it("does not retry a non-retryable transaction error", async () => {
    const { adapter } = createFakeAdapter("local");
    const service = new TursoServiceImpl({
      config: { localPath: "/tmp/fake.db", mode: "local" },
      logger: createMockLogger(),
      openAdapter: async () => adapter as unknown as TursoAdapter,
    });

    let attempts = 0;
    await expect(
      service.transaction({ maxRetries: 3, namespace: "proxy", retryDelayMs: 0 }, async () => {
        attempts += 1;
        throw new Error("syntax error"); // not retryable
      }),
    ).rejects.toThrow(/syntax error/);
    expect(attempts).toBe(1);

    await service.close();
  });

  it("should reject invalid namespaces", async () => {
    const service = new TursoServiceImpl({
      config: resolveTursoConfig({ localPath: ":memory:" }),
      logger: createMockLogger(),
    });

    await expect(service.connect("bad/namespace")).rejects.toMatchObject({
      code: "INVALID_TURSO_NAMESPACE",
    });

    await service.close();
  });
});

describe("resolveTursoConfig", () => {
  it("should use local defaults", () => {
    expect(resolveTursoConfig()).toEqual({
      localPath: "./data/turso/runtime.db",
      mode: "local",
    });
  });

  it("should resolve sync mode from environment", () => {
    const config = resolveTursoConfig(
      {
        localPath: "./ignored.db",
        mode: "local",
      },
      {
        TURSO_LOCAL_PATH: "./env.db",
        TURSO_MODE: "sync",
        TURSO_SYNC_AUTH_TOKEN: "secret",
        TURSO_SYNC_URL: "http://sync:8080",
      },
    );

    expect(config).toEqual({
      localPath: "./env.db",
      mode: "sync",
      sync: {
        authToken: "secret",
        url: "http://sync:8080",
      },
    });
  });

  it("should substitute environment variables in config values", () => {
    const config = resolveTursoConfig(
      {
        localPath: "${DB_DIR}/runtime.db",
        mode: "sync",
        sync: {
          authToken: "${DB_TOKEN}",
          url: "http://${DB_HOST}:8080",
        },
      },
      {
        DB_DIR: "/data/turso",
        DB_HOST: "sync",
        DB_TOKEN: "secret",
      },
    );

    expect(config.localPath).toBe("/data/turso/runtime.db");
    expect(config.sync?.authToken).toBe("secret");
    expect(config.sync?.url).toBe("http://sync:8080");
  });

  it("should require sync url in sync mode", () => {
    expect(() => resolveTursoConfig({ mode: "sync" })).toThrow("Turso sync mode requires");
  });

  it("should reject invalid mode", () => {
    expect(() => resolveTursoConfig({ mode: "remote" })).toThrow("Unsupported Turso mode");
  });

  // Multi-tenant (server) mode — added when turso-server entered the stack.
  // See `wiki/apps/plugin-turso.md` for the precedence rules.

  it("should enter multi-tenant mode when TURSO_SERVER_URL is set", () => {
    const config = resolveTursoConfig(
      {},
      {
        TURSO_LOCAL_PATH: "/data/turso/runtime.db",
        TURSO_SERVER_URL: "http://my-turso:8080",
        TURSO_SERVER_TOKEN: "tok",
      },
    );
    expect(config).toEqual({
      localPath: "/data/turso/runtime.db",
      mode: "sync",
      server: {
        url: "http://my-turso:8080",
        authToken: "tok",
      },
    });
  });

  it("should accept config.server block when env not set", () => {
    const config = resolveTursoConfig({
      server: { url: "http://my-turso:8080", authToken: "tok" },
    });
    expect(config.server?.url).toBe("http://my-turso:8080");
    expect(config.server?.authToken).toBe("tok");
    expect(config.mode).toBe("sync");
  });

  it("should strip trailing slash from server URL", () => {
    const config = resolveTursoConfig({}, { TURSO_SERVER_URL: "http://my-turso:8080/" });
    expect(config.server?.url).toBe("http://my-turso:8080");
  });

  it("multi-tenant takes precedence over legacy sync url", () => {
    // When both `TURSO_SERVER_URL` and `TURSO_SYNC_URL` are set,
    // multi-tenant wins (the chart always wires server URL in newer
    // deployments, and legacy single-tenant sync.url is ignored).
    const config = resolveTursoConfig(
      {},
      {
        TURSO_SERVER_URL: "http://server:8080",
        TURSO_SYNC_URL: "http://legacy:8080",
      },
    );
    expect(config.server?.url).toBe("http://server:8080");
    expect(config.sync).toBeUndefined();
  });

  it("falls back to legacy single-tenant when no server URL", () => {
    const config = resolveTursoConfig(
      {},
      {
        TURSO_MODE: "sync",
        TURSO_SYNC_URL: "http://legacy:8080",
      },
    );
    expect(config.mode).toBe("sync");
    expect(config.sync?.url).toBe("http://legacy:8080");
    expect(config.server).toBeUndefined();
  });

  it("env-substitution still applies to server URL", () => {
    const config = resolveTursoConfig(
      { server: { url: "http://${HOST}:8080", authToken: "${TOK}" } },
      { HOST: "my-svc", TOK: "abc" },
    );
    expect(config.server?.url).toBe("http://my-svc:8080");
    expect(config.server?.authToken).toBe("abc");
  });
});
