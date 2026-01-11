import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { PluginContext } from "@buntime/shared/types";
import type { Server } from "bun";
import proxyPlugin, { type ProxyConfig, type ProxyRule } from "./plugin";
import {
  compileRule,
  getAllRules,
  setDynamicRules,
  setProxyServer,
  shutdownProxyService,
  type WebSocketData,
} from "./server/services";

function createMockContext(overrides: Partial<PluginContext> = {}): PluginContext {
  return {
    config: {},
    globalConfig: {
      poolSize: 10,
      workerDirs: ["./apps"],
    },
    getService: mock(() => undefined),
    logger: {
      debug: mock(() => {}),
      error: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
    },
    registerService: mock(() => {}),
    ...overrides,
  };
}

describe("proxyPlugin", () => {
  afterEach(() => {
    shutdownProxyService();
  });

  describe("plugin factory", () => {
    it("should return a valid plugin object with implementation properties", () => {
      const plugin = proxyPlugin();

      expect(plugin.routes).toBeDefined();
      expect(plugin.onInit).toBeDefined();
      expect(plugin.onShutdown).toBeDefined();
      expect(plugin.onRequest).toBeDefined();
      expect(plugin.onServerStart).toBeDefined();
      expect(plugin.websocket).toBeDefined();
    });
  });

  describe("onInit", () => {
    it("should initialize with empty rules when none provided", async () => {
      const plugin = proxyPlugin();
      const ctx = createMockContext();

      await plugin.onInit?.(ctx);

      const rules = getAllRules();
      expect(rules).toEqual([]);
    });

    it("should initialize with static rules from config", async () => {
      const config: ProxyConfig = {
        rules: [
          { pattern: "^/api/(.*)$", target: "http://backend:8080" },
          { pattern: "^/ws/(.*)$", target: "http://ws-server:8081" },
        ],
      };

      const plugin = proxyPlugin(config);
      const ctx = createMockContext();

      await plugin.onInit?.(ctx);

      const rules = getAllRules();
      expect(rules.length).toBe(2);
      expect(rules[0]?.pattern).toBe("^/api/(.*)$");
      expect(rules[0]?.readonly).toBe(true);
      expect(rules[1]?.pattern).toBe("^/ws/(.*)$");
      expect(rules[1]?.readonly).toBe(true);
    });

    it("should log static rules initialization", async () => {
      const config: ProxyConfig = {
        rules: [{ pattern: "^/api/(.*)$", target: "http://backend:8080" }],
      };

      const plugin = proxyPlugin(config);
      const ctx = createMockContext();

      await plugin.onInit?.(ctx);

      expect(ctx.logger.info).toHaveBeenCalledWith("Loaded 1 static proxy rules");
    });

    it("should assign static rule IDs", async () => {
      const config: ProxyConfig = {
        rules: [
          { pattern: "^/api/(.*)$", target: "http://backend:8080" },
          { pattern: "^/ws/(.*)$", target: "http://ws-server:8081" },
        ],
      };

      const plugin = proxyPlugin(config);
      const ctx = createMockContext();

      await plugin.onInit?.(ctx);

      const rules = getAllRules();
      expect(rules[0]?.id).toBe("static-0");
      expect(rules[1]?.id).toBe("static-1");
    });

    it("should look for kv service from plugin-keyval", async () => {
      const plugin = proxyPlugin();
      const ctx = createMockContext();

      await plugin.onInit?.(ctx);

      expect(ctx.getService).toHaveBeenCalledWith("kv");
    });

    it("should log when keyval service not available", async () => {
      const plugin = proxyPlugin();
      const ctx = createMockContext();

      await plugin.onInit?.(ctx);

      expect(ctx.logger.debug).toHaveBeenCalledWith(
        "KeyVal service not available, dynamic rules disabled",
      );
    });
  });

  describe("onShutdown", () => {
    it("should clear all rules on shutdown", async () => {
      const config: ProxyConfig = {
        rules: [{ pattern: "^/api/(.*)$", target: "http://backend:8080" }],
      };

      const plugin = proxyPlugin(config);
      const ctx = createMockContext();

      await plugin.onInit?.(ctx);
      expect(getAllRules().length).toBe(1);

      await plugin.onShutdown?.();
      expect(getAllRules()).toEqual([]);
    });
  });

  describe("onRequest", () => {
    it("should return undefined when no rules configured", async () => {
      const plugin = proxyPlugin();
      const ctx = createMockContext();
      await plugin.onInit?.(ctx);

      const req = new Request("http://localhost:8000/api/users");
      const result = await plugin.onRequest?.(req);

      expect(result).toBeUndefined();
    });

    it("should return undefined when no rules match", async () => {
      const config: ProxyConfig = {
        rules: [{ pattern: "^/api/(.*)$", target: "http://backend:8080" }],
      };

      const plugin = proxyPlugin(config);
      const ctx = createMockContext();
      await plugin.onInit?.(ctx);

      const req = new Request("http://localhost:8000/other/path");
      const result = await plugin.onRequest?.(req);

      expect(result).toBeUndefined();
    });

    it("should return 101 response when handleProxyRequest returns null (WebSocket upgrade)", async () => {
      const plugin = proxyPlugin();
      const ctx = createMockContext();
      await plugin.onInit?.(ctx);

      // Set up a rule and mock server for WebSocket
      const rule = compileRule(
        { pattern: "^/ws/(.*)$", target: "http://backend:8080", ws: true },
        false,
      );
      if (rule) {
        setDynamicRules([rule]);

        // Create a mock server that returns true for upgrade
        const mockServer = {
          upgrade: mock(() => true),
        } as unknown as Server<WebSocketData>;
        setProxyServer(mockServer);

        const req = new Request("http://localhost:8000/ws/test", {
          headers: { upgrade: "websocket" },
        });
        const result = await plugin.onRequest?.(req);

        // When WebSocket upgrade succeeds, handleProxyRequest returns null
        // and plugin.onRequest returns Response(null, { status: 101 })
        expect(result).toBeInstanceOf(Response);
        expect(result?.status).toBe(101);
      }
    });

    it("should proxy HTTP requests and return response", async () => {
      const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      const config: ProxyConfig = {
        rules: [{ pattern: "^/api/(.*)$", target: "http://backend:8080" }],
      };

      const plugin = proxyPlugin(config);
      const ctx = createMockContext();
      await plugin.onInit?.(ctx);

      const req = new Request("http://localhost:8000/api/users");
      const result = await plugin.onRequest?.(req);

      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(200);

      fetchMock.mockRestore();
    });
  });

  describe("onServerStart", () => {
    it("should set proxy server and log when logger is available", () => {
      const plugin = proxyPlugin();
      const mockLogger = {
        debug: mock(() => {}),
        error: mock(() => {}),
        info: mock(() => {}),
        warn: mock(() => {}),
      };
      const mockServer = {
        logger: mockLogger,
      } as unknown as Server<WebSocketData>;

      plugin.onServerStart?.(
        mockServer as unknown as Parameters<NonNullable<typeof plugin.onServerStart>>[0],
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Proxy server configured for WebSocket upgrades",
      );
    });

    it("should set proxy server without logging when no logger", () => {
      const plugin = proxyPlugin();
      const mockServer = {} as unknown as Server<WebSocketData>;

      // Should not throw even without logger
      expect(() => {
        plugin.onServerStart?.(
          mockServer as unknown as Parameters<NonNullable<typeof plugin.onServerStart>>[0],
        );
      }).not.toThrow();
    });
  });

  describe("websocket handler", () => {
    it("should have open, message, and close handlers", () => {
      const plugin = proxyPlugin();

      expect(plugin.websocket).toBeDefined();
      expect(plugin.websocket?.open).toBeDefined();
      expect(plugin.websocket?.message).toBeDefined();
      expect(plugin.websocket?.close).toBeDefined();
    });
  });
});

describe("ProxyConfig", () => {
  it("should accept rules array", () => {
    const config: ProxyConfig = {
      rules: [
        {
          base: "/myapp",
          changeOrigin: true,
          headers: { "X-Custom": "value" },
          name: "My API",
          pattern: "^/api/(.*)$",
          relativePaths: true,
          rewrite: "/v1/$1",
          secure: true,
          target: "http://backend:8080",
          ws: true,
        },
      ],
    };

    const plugin = proxyPlugin(config);
    expect(plugin.routes).toBeDefined();
  });

  it("should accept fragment configuration in rules", () => {
    const config: ProxyConfig = {
      rules: [
        {
          fragment: {
            allowMessageBus: true,
            preloadStyles: "body { opacity: 0 }",
            sandbox: "patch",
          },
          pattern: "^/fragment-app/(.*)$",
          target: "http://fragment:3000",
        },
      ],
    };

    const plugin = proxyPlugin(config);
    expect(plugin.routes).toBeDefined();
  });
});

describe("ProxyRule type", () => {
  it("should have required fields pattern and target", () => {
    const rule: ProxyRule = {
      pattern: "^/api/(.*)$",
      target: "http://localhost:8080",
    };

    expect(rule.pattern).toBe("^/api/(.*)$");
    expect(rule.target).toBe("http://localhost:8080");
  });

  it("should have optional fields", () => {
    const rule: ProxyRule = {
      base: "/app",
      changeOrigin: true,
      fragment: {
        allowMessageBus: true,
        preloadStyles: "body { opacity: 0 }",
        sandbox: "iframe",
      },
      headers: { "X-Custom": "value" },
      id: "custom-id",
      name: "Custom Rule",
      pattern: "^/api/(.*)$",
      relativePaths: true,
      rewrite: "/v1/$1",
      secure: false,
      target: "http://localhost:8080",
      ws: false,
    };

    expect(rule.id).toBe("custom-id");
    expect(rule.name).toBe("Custom Rule");
    expect(rule.rewrite).toBe("/v1/$1");
    expect(rule.changeOrigin).toBe(true);
    expect(rule.secure).toBe(false);
    expect(rule.headers).toEqual({ "X-Custom": "value" });
    expect(rule.ws).toBe(false);
    expect(rule.base).toBe("/app");
    expect(rule.relativePaths).toBe(true);
    expect(rule.fragment?.sandbox).toBe("iframe");
    expect(rule.fragment?.allowMessageBus).toBe(true);
    expect(rule.fragment?.preloadStyles).toBe("body { opacity: 0 }");
  });
});
