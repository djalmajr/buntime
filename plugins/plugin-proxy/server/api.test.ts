import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { PluginContext } from "@buntime/shared/types";
import { api } from "./api";
import {
  compileRule,
  getDynamicRules,
  initializeProxyService,
  type ProxyRule,
  setDynamicRules,
  shutdownProxyService,
} from "./services";

function createMockContext(overrides: Partial<PluginContext> = {}): PluginContext {
  return {
    config: {},
    globalConfig: {
      poolSize: 10,
      workspaces: ["./apps"],
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

function createMockKv(): {
  delete: ReturnType<typeof mock>;
  get: ReturnType<typeof mock>;
  list: ReturnType<typeof mock>;
  set: ReturnType<typeof mock>;
  store: Map<string, unknown>;
} {
  const store = new Map<string, unknown>();

  return {
    delete: mock((key: string[]) => {
      store.delete(key.join("/"));
      return Promise.resolve();
    }),
    get: mock((key: string[]) => {
      return Promise.resolve({ value: store.get(key.join("/")) });
    }),
    list: mock(function* () {
      for (const [key, value] of store) {
        yield { key: key.split("/"), value };
      }
    }),
    set: mock((key: string[], value: unknown) => {
      store.set(key.join("/"), value);
      return Promise.resolve();
    }),
    store,
  };
}

describe("Proxy API", () => {
  beforeEach(() => {
    shutdownProxyService();
  });

  afterEach(() => {
    shutdownProxyService();
  });

  describe("GET /api/rules", () => {
    it("should return empty array when no rules configured", async () => {
      const ctx = createMockContext();
      initializeProxyService(ctx, []);

      const req = new Request("http://localhost:8000/api/rules");
      const res = await api.fetch(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });

    it("should return static rules", async () => {
      const staticRules: ProxyRule[] = [
        { pattern: "^/api/(.*)$", target: "http://backend:8080" },
        { pattern: "^/ws/(.*)$", target: "http://ws:8081" },
      ];
      const ctx = createMockContext();
      initializeProxyService(ctx, staticRules);

      const req = new Request("http://localhost:8000/api/rules");
      const res = await api.fetch(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.length).toBe(2);
      expect(data[0].pattern).toBe("^/api/(.*)$");
      expect(data[0].readonly).toBe(true);
      expect(data[1].pattern).toBe("^/ws/(.*)$");
    });

    it("should return both static and dynamic rules", async () => {
      const staticRules: ProxyRule[] = [
        { pattern: "^/static/(.*)$", target: "http://static:8080" },
      ];
      const ctx = createMockContext();
      initializeProxyService(ctx, staticRules);

      const dynamicRule = compileRule(
        { id: "dynamic-1", pattern: "^/dynamic/(.*)$", target: "http://dynamic:8080" },
        false,
      );
      if (dynamicRule) {
        setDynamicRules([dynamicRule]);
      }

      const req = new Request("http://localhost:8000/api/rules");
      const res = await api.fetch(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.length).toBe(2);
      expect(data[0].pattern).toBe("^/static/(.*)$");
      expect(data[0].readonly).toBe(true);
      expect(data[1].pattern).toBe("^/dynamic/(.*)$");
      expect(data[1].readonly).toBe(false);
    });
  });

  describe("GET /api/fragments", () => {
    it("should return empty array when no fragment rules", async () => {
      const staticRules: ProxyRule[] = [{ pattern: "^/api/(.*)$", target: "http://backend:8080" }];
      const ctx = createMockContext();
      initializeProxyService(ctx, staticRules);

      const req = new Request("http://localhost:8000/api/fragments");
      const res = await api.fetch(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });

    it("should return only rules with fragment configuration", async () => {
      const staticRules: ProxyRule[] = [
        { pattern: "^/api/(.*)$", target: "http://backend:8080" },
        {
          base: "/myapp",
          fragment: { allowMessageBus: true, sandbox: "patch" },
          name: "My App",
          pattern: "^/myapp/(.*)$",
          target: "http://myapp:3000",
        },
      ];
      const ctx = createMockContext();
      initializeProxyService(ctx, staticRules);

      const req = new Request("http://localhost:8000/api/fragments");
      const res = await api.fetch(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.length).toBe(1);
      expect(data[0].name).toBe("My App");
      expect(data[0].pattern).toBe("^/myapp/(.*)$");
      expect(data[0].origin).toBe("http://myapp:3000");
      expect(data[0].base).toBe("/myapp");
      expect(data[0].sandbox).toBe("patch");
      expect(data[0].allowMessageBus).toBe(true);
    });

    it("should use default values for fragment config", async () => {
      const staticRules: ProxyRule[] = [
        {
          fragment: {},
          pattern: "^/app/(.*)$",
          target: "http://app:3000",
        },
      ];
      const ctx = createMockContext();
      initializeProxyService(ctx, staticRules);

      const req = new Request("http://localhost:8000/api/fragments");
      const res = await api.fetch(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.length).toBe(1);
      expect(data[0].sandbox).toBe("patch");
      expect(data[0].allowMessageBus).toBe(true);
    });
  });

  describe("GET /api/rules/:id", () => {
    it("should return 404 when rule not found", async () => {
      const ctx = createMockContext();
      initializeProxyService(ctx, []);

      const req = new Request("http://localhost:8000/api/rules/nonexistent");
      const res = await api.fetch(req);

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Rule not found");
    });

    it("should return rule by id", async () => {
      const staticRules: ProxyRule[] = [{ pattern: "^/api/(.*)$", target: "http://backend:8080" }];
      const ctx = createMockContext();
      initializeProxyService(ctx, staticRules);

      const req = new Request("http://localhost:8000/api/rules/static-0");
      const res = await api.fetch(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe("static-0");
      expect(data.pattern).toBe("^/api/(.*)$");
    });

    it("should return dynamic rule by id", async () => {
      const ctx = createMockContext();
      initializeProxyService(ctx, []);

      const dynamicRule = compileRule(
        { id: "my-dynamic-rule", pattern: "^/dynamic/(.*)$", target: "http://dynamic:8080" },
        false,
      );
      if (dynamicRule) {
        setDynamicRules([dynamicRule]);
      }

      const req = new Request("http://localhost:8000/api/rules/my-dynamic-rule");
      const res = await api.fetch(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe("my-dynamic-rule");
      expect(data.pattern).toBe("^/dynamic/(.*)$");
      expect(data.readonly).toBe(false);
    });
  });

  describe("POST /api/rules", () => {
    it("should return 400 when kv not enabled", async () => {
      const ctx = createMockContext();
      initializeProxyService(ctx, []);

      const req = new Request("http://localhost:8000/api/rules", {
        body: JSON.stringify({ pattern: "^/test$", target: "http://test" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const res = await api.fetch(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Dynamic rules not enabled (plugin-keyval not configured)");
    });

    it("should return 400 when pattern missing", async () => {
      const mockKv = createMockKv();
      const ctx = createMockContext({
        getService: mock(() => mockKv) as PluginContext["getService"],
      });
      initializeProxyService(ctx, []);

      const req = new Request("http://localhost:8000/api/rules", {
        body: JSON.stringify({ target: "http://test" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const res = await api.fetch(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("pattern and target are required");
    });

    it("should return 400 when target missing", async () => {
      const mockKv = createMockKv();
      const ctx = createMockContext({
        getService: mock(() => mockKv) as PluginContext["getService"],
      });
      initializeProxyService(ctx, []);

      const req = new Request("http://localhost:8000/api/rules", {
        body: JSON.stringify({ pattern: "^/test$" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const res = await api.fetch(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("pattern and target are required");
    });

    it("should return 400 when regex pattern is invalid", async () => {
      const mockKv = createMockKv();
      const ctx = createMockContext({
        getService: mock(() => mockKv) as PluginContext["getService"],
      });
      initializeProxyService(ctx, []);

      const req = new Request("http://localhost:8000/api/rules", {
        body: JSON.stringify({ pattern: "[invalid", target: "http://test" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const res = await api.fetch(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid regex pattern");
    });

    it("should create new dynamic rule", async () => {
      const mockKv = createMockKv();
      const ctx = createMockContext({
        getService: mock(() => mockKv) as PluginContext["getService"],
      });
      initializeProxyService(ctx, []);

      const req = new Request("http://localhost:8000/api/rules", {
        body: JSON.stringify({
          name: "My Rule",
          pattern: "^/test/(.*)$",
          target: "http://test:8080",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const res = await api.fetch(req);

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBeDefined();
      expect(data.name).toBe("My Rule");
      expect(data.pattern).toBe("^/test/(.*)$");
      expect(data.target).toBe("http://test:8080");
      expect(data.readonly).toBe(false);

      // Verify it was saved to kv
      expect(mockKv.set).toHaveBeenCalled();

      // Verify it's in dynamic rules
      const dynamicRules = getDynamicRules();
      expect(dynamicRules.length).toBe(1);
    });
  });

  describe("PUT /api/rules/:id", () => {
    it("should return 400 when kv not enabled", async () => {
      const ctx = createMockContext();
      initializeProxyService(ctx, []);

      const req = new Request("http://localhost:8000/api/rules/some-id", {
        body: JSON.stringify({ target: "http://new-target" }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      const res = await api.fetch(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Dynamic rules not enabled");
    });

    it("should return 403 when trying to modify static rule", async () => {
      const mockKv = createMockKv();
      const staticRules: ProxyRule[] = [{ pattern: "^/api/(.*)$", target: "http://backend:8080" }];
      const ctx = createMockContext({
        getService: mock(() => mockKv) as PluginContext["getService"],
      });
      initializeProxyService(ctx, staticRules);

      const req = new Request("http://localhost:8000/api/rules/static-0", {
        body: JSON.stringify({ target: "http://new-target" }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      const res = await api.fetch(req);

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe("Cannot modify static rules");
    });

    it("should return 404 when rule not found", async () => {
      const mockKv = createMockKv();
      const ctx = createMockContext({
        getService: mock(() => mockKv) as PluginContext["getService"],
      });
      initializeProxyService(ctx, []);

      const req = new Request("http://localhost:8000/api/rules/nonexistent", {
        body: JSON.stringify({ target: "http://new-target" }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      const res = await api.fetch(req);

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Rule not found");
    });

    it("should return 400 when updated pattern is invalid", async () => {
      const mockKv = createMockKv();
      const ctx = createMockContext({
        getService: mock(() => mockKv) as PluginContext["getService"],
      });
      initializeProxyService(ctx, []);

      const dynamicRule = compileRule(
        { id: "my-rule", pattern: "^/test/(.*)$", target: "http://test:8080" },
        false,
      );
      if (dynamicRule) {
        setDynamicRules([dynamicRule]);
      }

      const req = new Request("http://localhost:8000/api/rules/my-rule", {
        body: JSON.stringify({ pattern: "[invalid" }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      const res = await api.fetch(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid regex pattern");
    });

    it("should update dynamic rule", async () => {
      const mockKv = createMockKv();
      const ctx = createMockContext({
        getService: mock(() => mockKv) as PluginContext["getService"],
      });
      initializeProxyService(ctx, []);

      const dynamicRule = compileRule(
        { id: "my-rule", name: "Old Name", pattern: "^/test/(.*)$", target: "http://test:8080" },
        false,
      );
      if (dynamicRule) {
        setDynamicRules([dynamicRule]);
      }

      const req = new Request("http://localhost:8000/api/rules/my-rule", {
        body: JSON.stringify({
          name: "New Name",
          target: "http://new-target:9000",
        }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      const res = await api.fetch(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe("my-rule");
      expect(data.name).toBe("New Name");
      expect(data.target).toBe("http://new-target:9000");
      expect(data.pattern).toBe("^/test/(.*)$"); // unchanged

      // Verify it was saved to kv
      expect(mockKv.set).toHaveBeenCalled();
    });
  });

  describe("DELETE /api/rules/:id", () => {
    it("should return 400 when kv not enabled", async () => {
      const ctx = createMockContext();
      initializeProxyService(ctx, []);

      const req = new Request("http://localhost:8000/api/rules/some-id", {
        method: "DELETE",
      });
      const res = await api.fetch(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Dynamic rules not enabled");
    });

    it("should return 403 when trying to delete static rule", async () => {
      const mockKv = createMockKv();
      const staticRules: ProxyRule[] = [{ pattern: "^/api/(.*)$", target: "http://backend:8080" }];
      const ctx = createMockContext({
        getService: mock(() => mockKv) as PluginContext["getService"],
      });
      initializeProxyService(ctx, staticRules);

      const req = new Request("http://localhost:8000/api/rules/static-0", {
        method: "DELETE",
      });
      const res = await api.fetch(req);

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe("Cannot delete static rules");
    });

    it("should return 404 when rule not found", async () => {
      const mockKv = createMockKv();
      const ctx = createMockContext({
        getService: mock(() => mockKv) as PluginContext["getService"],
      });
      initializeProxyService(ctx, []);

      const req = new Request("http://localhost:8000/api/rules/nonexistent", {
        method: "DELETE",
      });
      const res = await api.fetch(req);

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Rule not found");
    });

    it("should delete dynamic rule", async () => {
      const mockKv = createMockKv();
      const ctx = createMockContext({
        getService: mock(() => mockKv) as PluginContext["getService"],
      });
      initializeProxyService(ctx, []);

      const dynamicRule = compileRule(
        { id: "my-rule", pattern: "^/test/(.*)$", target: "http://test:8080" },
        false,
      );
      if (dynamicRule) {
        setDynamicRules([dynamicRule]);
      }

      expect(getDynamicRules().length).toBe(1);

      const req = new Request("http://localhost:8000/api/rules/my-rule", {
        method: "DELETE",
      });
      const res = await api.fetch(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      // Verify it was deleted from kv
      expect(mockKv.delete).toHaveBeenCalled();

      // Verify it's removed from dynamic rules
      expect(getDynamicRules().length).toBe(0);
    });
  });

  describe("error handling", () => {
    it("should handle errors with errorToResponse", async () => {
      // Force an error by passing invalid JSON
      const ctx = createMockContext();
      initializeProxyService(ctx, []);

      const mockKv = createMockKv();
      const ctxWithKv = createMockContext({
        getService: mock(() => mockKv) as PluginContext["getService"],
      });
      initializeProxyService(ctxWithKv, []);

      const req = new Request("http://localhost:8000/api/rules", {
        body: "invalid json",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const res = await api.fetch(req);

      // Should return an error response
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});
