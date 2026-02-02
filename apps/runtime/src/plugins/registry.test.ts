import { beforeEach, describe, expect, it } from "bun:test";
import type { AppInfo, BuntimePlugin, WorkerInstance } from "@buntime/shared/types";
import type { Server, ServerWebSocket } from "bun";
import { createPluginLogger, PluginRegistry } from "./registry";

describe("PluginRegistry", () => {
  let registry: PluginRegistry;

  const createMockPlugin = (overrides: Partial<BuntimePlugin> = {}): BuntimePlugin => ({
    name: "test-plugin",
    base: "/test",
    ...overrides,
  });

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  describe("register", () => {
    it("should register a plugin", () => {
      const plugin = createMockPlugin();
      registry.register(plugin);
      expect(registry.has("test-plugin")).toBe(true);
      expect(registry.size).toBe(1);
    });

    it("should register plugin with directory", () => {
      const plugin = createMockPlugin();
      registry.register(plugin, "/path/to/plugin");
      expect(registry.getPluginDir("test-plugin")).toBe("/path/to/plugin");
    });

    it("should throw when registering duplicate plugin", () => {
      const plugin = createMockPlugin();
      registry.register(plugin);
      expect(() => registry.register(plugin)).toThrow(/already registered/);
    });

    it("should throw when dependency is not loaded", () => {
      const plugin = createMockPlugin({
        name: "dependent",
        dependencies: ["missing-dep"],
      });
      expect(() => registry.register(plugin)).toThrow(/requires "missing-dep"/);
    });

    it("should allow registration when dependencies are met", () => {
      const dep = createMockPlugin({ name: "dependency", base: "/dep" });
      const plugin = createMockPlugin({
        name: "dependent",
        base: "/test",
        dependencies: ["dependency"],
      });

      registry.register(dep);
      registry.register(plugin);

      expect(registry.has("dependency")).toBe(true);
      expect(registry.has("dependent")).toBe(true);
    });
  });

  describe("get", () => {
    it("should return plugin by name", () => {
      const plugin = createMockPlugin();
      registry.register(plugin);
      expect(registry.get("test-plugin")).toBe(plugin);
    });

    it("should return undefined for unknown plugin", () => {
      expect(registry.get("unknown")).toBeUndefined();
    });
  });

  describe("getAll", () => {
    it("should return all plugins in registration order", () => {
      const plugin1 = createMockPlugin({ name: "plugin-1", base: "/p1" });
      const plugin2 = createMockPlugin({ name: "plugin-2", base: "/p2" });
      const plugin3 = createMockPlugin({ name: "plugin-3", base: "/p3" });

      registry.register(plugin1);
      registry.register(plugin2);
      registry.register(plugin3);

      const all = registry.getAll();
      expect(all.length).toBe(3);
      expect(all[0]?.name).toBe("plugin-1");
      expect(all[1]?.name).toBe("plugin-2");
      expect(all[2]?.name).toBe("plugin-3");
    });
  });

  describe("has", () => {
    it("should return true for registered plugin", () => {
      registry.register(createMockPlugin());
      expect(registry.has("test-plugin")).toBe(true);
    });

    it("should return false for unregistered plugin", () => {
      expect(registry.has("unknown")).toBe(false);
    });
  });

  describe("size", () => {
    it("should return 0 for empty registry", () => {
      expect(registry.size).toBe(0);
    });

    it("should return correct count", () => {
      registry.register(createMockPlugin({ name: "p1", base: "/p1" }));
      registry.register(createMockPlugin({ name: "p2", base: "/p2" }));
      expect(registry.size).toBe(2);
    });
  });

  describe("getPluginBasePaths", () => {
    it("should return empty set when no plugins", () => {
      const paths = registry.getPluginBasePaths();
      expect(paths.size).toBe(0);
    });

    it("should return all plugin base paths", () => {
      registry.register(createMockPlugin({ name: "p1", base: "/api" }));
      registry.register(createMockPlugin({ name: "p2", base: "/admin" }));

      const paths = registry.getPluginBasePaths();
      expect(paths.has("/api")).toBe(true);
      expect(paths.has("/admin")).toBe(true);
    });
  });

  describe("getPluginsWithServerFetch", () => {
    it("should return only plugins with server.fetch", () => {
      const withFetch = createMockPlugin({
        name: "with-fetch",
        base: "/with",
        server: { fetch: async () => new Response("ok") },
      });
      const withoutFetch = createMockPlugin({
        name: "without-fetch",
        base: "/without",
      });

      registry.register(withFetch);
      registry.register(withoutFetch);

      const plugins = registry.getPluginsWithServerFetch();
      expect(plugins.length).toBe(1);
      expect(plugins[0]?.name).toBe("with-fetch");
    });
  });

  describe("plugin provides", () => {
    it("should register and retrieve plugin provides", () => {
      const service = { doSomething: () => "done" };
      registry.registerProvides("my-plugin", service);
      const retrieved = registry.getPlugin<typeof service>("my-plugin");
      expect(retrieved).toBe(service);
    });

    it("should return undefined for unknown plugin", () => {
      expect(registry.getPlugin("unknown")).toBeUndefined();
    });

    it("should allow overwriting provides with warning", () => {
      const service1 = { version: 1 };
      const service2 = { version: 2 };

      registry.registerProvides("my-plugin", service1);
      registry.registerProvides("my-plugin", service2);

      expect(registry.getPlugin<{ version: number }>("my-plugin")?.version).toBe(2);
    });
  });

  describe("resolvePluginApp", () => {
    it("should resolve plugin app by pathname", () => {
      const plugin = createMockPlugin({ name: "my-plugin", base: "/my-plugin" });
      registry.register(plugin, "/path/to/plugin");

      const result = registry.resolvePluginApp("/my-plugin/page");
      expect(result).toEqual({ dir: "/path/to/plugin", basePath: "/my-plugin" });
    });

    it("should resolve exact base path", () => {
      const plugin = createMockPlugin({ name: "my-plugin", base: "/my-plugin" });
      registry.register(plugin, "/path/to/plugin");

      const result = registry.resolvePluginApp("/my-plugin");
      expect(result).toEqual({ dir: "/path/to/plugin", basePath: "/my-plugin" });
    });

    it("should return undefined for unknown path", () => {
      registry.register(createMockPlugin({ base: "/known" }), "/path");
      expect(registry.resolvePluginApp("/unknown")).toBeUndefined();
    });

    it("should return undefined for plugin without directory", () => {
      registry.register(createMockPlugin({ base: "/no-dir" }));
      expect(registry.resolvePluginApp("/no-dir")).toBeUndefined();
    });
  });

  describe("runOnRequest", () => {
    it("should run onRequest hooks in order", async () => {
      const order: string[] = [];

      const plugin1 = createMockPlugin({
        name: "p1",
        base: "/p1",
        onRequest: async (req) => {
          order.push("p1");
          return req;
        },
      });
      const plugin2 = createMockPlugin({
        name: "p2",
        base: "/p2",
        onRequest: async (req) => {
          order.push("p2");
          return req;
        },
      });

      registry.register(plugin1);
      registry.register(plugin2);

      const req = new Request("http://localhost/test");
      await registry.runOnRequest(req);

      expect(order).toEqual(["p1", "p2"]);
    });

    it("should short-circuit on Response", async () => {
      const order: string[] = [];

      const plugin1 = createMockPlugin({
        name: "p1",
        base: "/p1",
        onRequest: async () => {
          order.push("p1");
          return new Response("blocked", { status: 403 });
        },
      });
      const plugin2 = createMockPlugin({
        name: "p2",
        base: "/p2",
        onRequest: async (req) => {
          order.push("p2");
          return req;
        },
      });

      registry.register(plugin1);
      registry.register(plugin2);

      const req = new Request("http://localhost/test");
      const result = await registry.runOnRequest(req);

      expect(order).toEqual(["p1"]);
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(403);
    });

    it("should pass modified request to next hook", async () => {
      const plugin1 = createMockPlugin({
        name: "p1",
        base: "/p1",
        onRequest: async (req) => {
          const newReq = new Request(req.url, req);
          newReq.headers.set("x-modified", "true");
          return newReq;
        },
      });
      const plugin2 = createMockPlugin({
        name: "p2",
        base: "/p2",
        onRequest: async (req) => {
          expect(req.headers.get("x-modified")).toBe("true");
          return req;
        },
      });

      registry.register(plugin1);
      registry.register(plugin2);

      const req = new Request("http://localhost/test");
      await registry.runOnRequest(req);
    });
  });

  describe("runOnResponse", () => {
    it("should run onResponse hooks in order", async () => {
      const order: string[] = [];
      const app: AppInfo = { config: {}, dir: "/app", name: "test", version: "1.0.0" };

      const plugin1 = createMockPlugin({
        name: "p1",
        base: "/p1",
        onResponse: async (res) => {
          order.push("p1");
          return res;
        },
      });
      const plugin2 = createMockPlugin({
        name: "p2",
        base: "/p2",
        onResponse: async (res) => {
          order.push("p2");
          return res;
        },
      });

      registry.register(plugin1);
      registry.register(plugin2);

      const res = new Response("ok");
      await registry.runOnResponse(res, app);

      expect(order).toEqual(["p1", "p2"]);
    });
  });

  describe("runOnShutdown", () => {
    it("should run onShutdown hooks in reverse order", async () => {
      const order: string[] = [];

      const plugin1 = createMockPlugin({
        name: "p1",
        base: "/p1",
        onShutdown: async () => {
          order.push("p1");
        },
      });
      const plugin2 = createMockPlugin({
        name: "p2",
        base: "/p2",
        onShutdown: async () => {
          order.push("p2");
        },
      });

      registry.register(plugin1);
      registry.register(plugin2);

      await registry.runOnShutdown();

      expect(order).toEqual(["p2", "p1"]);
    });
  });

  describe("getWebSocketHandler", () => {
    it("should return undefined when no plugins have websocket", () => {
      registry.register(createMockPlugin());
      expect(registry.getWebSocketHandler()).toBeUndefined();
    });

    it("should return single plugin websocket handler directly", () => {
      const wsHandler = {
        open: () => {},
        message: () => {},
        close: () => {},
      };
      registry.register(createMockPlugin({ websocket: wsHandler }));

      const handler = registry.getWebSocketHandler();
      expect(handler).toBe(wsHandler);
    });

    it("should combine multiple websocket handlers", () => {
      const calls: string[] = [];

      registry.register(
        createMockPlugin({
          name: "p1",
          base: "/p1",
          websocket: {
            open: () => calls.push("p1-open"),
            message: () => calls.push("p1-message"),
            close: () => calls.push("p1-close"),
          },
        }),
      );
      registry.register(
        createMockPlugin({
          name: "p2",
          base: "/p2",
          websocket: {
            open: () => calls.push("p2-open"),
            message: () => calls.push("p2-message"),
            close: () => calls.push("p2-close"),
          },
        }),
      );

      const handler = registry.getWebSocketHandler();
      expect(handler).toBeDefined();

      const mockWs = {} as ServerWebSocket<unknown>;

      // Test open
      handler?.open?.(mockWs);
      expect(calls).toContain("p1-open");
      expect(calls).toContain("p2-open");

      // Test message
      handler?.message?.(mockWs, "test message");
      expect(calls).toContain("p1-message");
      expect(calls).toContain("p2-message");

      // Test close
      handler?.close?.(mockWs, 1000, "normal closure");
      expect(calls).toContain("p1-close");
      expect(calls).toContain("p2-close");
    });
  });

  describe("collectServerRoutes", () => {
    it("should collect routes from all plugins", () => {
      const plugin1 = createMockPlugin({
        name: "p1",
        base: "/p1",
        server: {
          routes: {
            "/api/health": () => new Response("ok"),
          },
        },
      });

      registry.register(plugin1);
      const routes = registry.collectServerRoutes();

      expect(routes["/api/health"]).toBeDefined();
    });

    it("should wrap routes with auth check", async () => {
      const plugin = createMockPlugin({
        name: "auth",
        base: "/auth",
        onRequest: async () => new Response("Unauthorized", { status: 401 }),
      });
      const routePlugin = createMockPlugin({
        name: "api",
        base: "/api",
        server: {
          routes: {
            "/api/data": () => new Response("secret"),
          },
        },
      });

      registry.register(plugin);
      registry.register(routePlugin);

      const routes = registry.collectServerRoutes();
      const handler = routes["/api/data"];
      expect(handler).toBeDefined();
      const response = await (handler as (req: Request) => Promise<Response>)(
        new Request("http://localhost/api/data"),
      );

      expect(response.status).toBe(401);
    });
  });

  describe("setMountedPaths", () => {
    it("should store mounted paths", () => {
      const paths = new Map<string, string>();
      paths.set("/api", "api-plugin");
      paths.set("/admin", "admin-plugin");

      registry.setMountedPaths(paths);
      expect(registry.getMountedPaths()).toBe(paths);
    });
  });
});

describe("createPluginLogger", () => {
  it("should create logger with plugin prefix", () => {
    const logger = createPluginLogger("test-plugin");

    expect(logger.debug).toBeDefined();
    expect(logger.info).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.error).toBeDefined();
  });

  it("should allow calling all log methods", () => {
    const logger = createPluginLogger("test");

    // These should not throw
    logger.debug("debug message", { key: "value" });
    logger.info("info message");
    logger.warn("warn message");
    logger.error("error message");
  });
});

describe("PluginRegistry - worker hooks", () => {
  let registry: PluginRegistry;

  const createMockPlugin = (overrides: Partial<BuntimePlugin> = {}): BuntimePlugin => ({
    name: "test-plugin",
    base: "/test",
    ...overrides,
  });

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  describe("runOnServerStart", () => {
    it("should run onServerStart hooks", () => {
      const calls: string[] = [];
      const mockServer = {} as Server<unknown>;

      registry.register(
        createMockPlugin({
          name: "p1",
          base: "/p1",
          onServerStart: () => calls.push("p1"),
        }),
      );
      registry.register(
        createMockPlugin({
          name: "p2",
          base: "/p2",
          onServerStart: () => calls.push("p2"),
        }),
      );

      registry.runOnServerStart(mockServer);
      expect(calls).toEqual(["p1", "p2"]);
    });

    it("should handle errors gracefully", () => {
      const mockServer = {} as Server<unknown>;

      registry.register(
        createMockPlugin({
          onServerStart: () => {
            throw new Error("test error");
          },
        }),
      );

      // Should not throw
      expect(() => registry.runOnServerStart(mockServer)).not.toThrow();
    });
  });

  describe("runOnWorkerSpawn", () => {
    it("should run onWorkerSpawn hooks", () => {
      const calls: string[] = [];
      const mockWorker = {} as WorkerInstance;
      const mockApp = { config: {}, dir: "/path", name: "app", version: "1.0.0" } as AppInfo;

      registry.register(
        createMockPlugin({
          name: "p1",
          base: "/p1",
          onWorkerSpawn: () => calls.push("p1"),
        }),
      );

      registry.runOnWorkerSpawn(mockWorker, mockApp);
      expect(calls).toEqual(["p1"]);
    });

    it("should handle errors gracefully", () => {
      const mockWorker = {} as WorkerInstance;
      const mockApp = { config: {}, dir: "/path", name: "app", version: "1.0.0" } as AppInfo;

      registry.register(
        createMockPlugin({
          onWorkerSpawn: () => {
            throw new Error("test error");
          },
        }),
      );

      expect(() => registry.runOnWorkerSpawn(mockWorker, mockApp)).not.toThrow();
    });
  });

  describe("runOnWorkerTerminate", () => {
    it("should run onWorkerTerminate hooks", () => {
      const calls: string[] = [];
      const mockWorker = {} as WorkerInstance;
      const mockApp = { config: {}, dir: "/path", name: "app", version: "1.0.0" } as AppInfo;

      registry.register(
        createMockPlugin({
          name: "p1",
          base: "/p1",
          onWorkerTerminate: () => calls.push("p1"),
        }),
      );

      registry.runOnWorkerTerminate(mockWorker, mockApp);
      expect(calls).toEqual(["p1"]);
    });

    it("should handle errors gracefully", () => {
      const mockWorker = {} as WorkerInstance;
      const mockApp = { config: {}, dir: "/path", name: "app", version: "1.0.0" } as AppInfo;

      registry.register(
        createMockPlugin({
          onWorkerTerminate: () => {
            throw new Error("test error");
          },
        }),
      );

      expect(() => registry.runOnWorkerTerminate(mockWorker, mockApp)).not.toThrow();
    });
  });
});
