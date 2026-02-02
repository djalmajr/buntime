import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { AuthzConfig } from "./plugin";
import authzPlugin, { PolicyAdministrationPoint, PolicyDecisionPoint } from "./plugin";
import type { Policy } from "./server/types";

/**
 * Factory function for creating policies
 */
function createPolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: `policy-${Math.random().toString(36).slice(2, 8)}`,
    effect: "permit",
    subjects: [],
    resources: [],
    actions: [],
    ...overrides,
  };
}

/**
 * Create a mock PluginContext
 */
function createMockContext() {
  const services: Record<string, unknown> = {};

  return {
    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    },
    getPlugin: mock((name: string) => services[name]),
  };
}

describe("authzPlugin", () => {
  describe("plugin structure", () => {
    it("should return a valid PluginImpl with lifecycle hooks", () => {
      const plugin = authzPlugin();

      // Plugin implementation has lifecycle hooks
      expect(typeof plugin.onInit).toBe("function");
      expect(typeof plugin.onRequest).toBe("function");
    });
  });

  describe("plugin configuration", () => {
    it("should accept empty configuration", () => {
      const plugin = authzPlugin();
      expect(plugin).toBeDefined();
    });

    it("should accept full configuration", () => {
      const config: AuthzConfig = {
        combiningAlgorithm: "permit-overrides",
        defaultEffect: "permit",
        store: "file",
        path: "./policies.json",
        excludePaths: ["/health", "/public/.*"],
        policies: [createPolicy({ id: "inline-policy" })],
        policySeed: {
          enabled: true,
          onlyIfEmpty: true,
          environments: ["development"],
          policies: [createPolicy({ id: "seed-policy" })],
        },
      };

      const plugin = authzPlugin(config);
      expect(plugin).toBeDefined();
    });

    it("should use default values for optional config", async () => {
      const plugin = authzPlugin();
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      // Verify defaults are used (logged in info message)
      expect(ctx.logger.info).toHaveBeenCalled();
      const infoCall = (ctx.logger.info as ReturnType<typeof mock>).mock.calls[0];
      expect(infoCall[0]).toContain("deny-overrides");
    });
  });

  describe("onInit", () => {
    it("should initialize PAP and PDP", async () => {
      const plugin = authzPlugin();
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      expect(ctx.logger.info).toHaveBeenCalled();
    });

    it("should expose authz service via provides", async () => {
      const plugin = authzPlugin();
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      // The service is now exposed via provides() instead of registerService
      const authzService = plugin.provides?.() as { getPap: () => unknown };
      expect(authzService).toBeDefined();
      expect(authzService.getPap).toBeDefined();
    });

    it("should load inline policies (deprecated config)", async () => {
      const inlinePolicy = createPolicy({ id: "inline-1" });
      const plugin = authzPlugin({
        policies: [inlinePolicy],
      });
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      // Get the authz service and check policies
      const authzService = plugin.provides() as {
        getPap: () => PolicyAdministrationPoint;
      };
      const pap = authzService.getPap();
      expect(pap.get("inline-1")).toBeDefined();
    });

    it("should compile exclude path patterns", async () => {
      const plugin = authzPlugin({
        excludePaths: ["/health", "/api/public/.*"],
      });
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      // Test excluded paths via onRequest
      const excludedRequest = new Request("http://localhost/health");
      const result = await plugin.onRequest?.(excludedRequest, undefined);
      expect(result).toBeUndefined(); // Should skip authorization
    });
  });

  describe("onRequest - path exclusion", () => {
    it("should skip excluded paths", async () => {
      const plugin = authzPlugin({
        excludePaths: ["/health", "/public/.*"],
      });
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      // Exact match
      const healthReq = new Request("http://localhost/health");
      expect(await plugin.onRequest?.(healthReq, undefined)).toBeUndefined();

      // Regex match
      const publicReq = new Request("http://localhost/public/assets/logo.png");
      expect(await plugin.onRequest?.(publicReq, undefined)).toBeUndefined();
    });

    it("should evaluate non-excluded paths", async () => {
      const denyPolicy = createPolicy({
        id: "deny-all",
        effect: "deny",
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });

      const plugin = authzPlugin({
        excludePaths: ["/health"],
        policies: [denyPolicy],
      });
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      const apiReq = new Request("http://localhost/api/users");
      const response = await plugin.onRequest?.(apiReq, undefined);

      expect(response).toBeInstanceOf(Response);
      expect(response?.status).toBe(403);
    });
  });

  describe("onRequest - identity extraction", () => {
    it("should parse X-Identity header", async () => {
      const userPolicy = createPolicy({
        id: "user-access",
        effect: "permit",
        subjects: [{ id: "user-123" }],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });

      const plugin = authzPlugin({
        policies: [userPolicy],
      });
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      const identity = {
        sub: "user-123",
        roles: ["user"],
        groups: [],
        claims: {},
      };

      const req = new Request("http://localhost/api/test", {
        headers: {
          "X-Identity": JSON.stringify(identity),
        },
      });

      const response = await plugin.onRequest?.(req, undefined);
      expect(response).toBeUndefined(); // Permitted, no response
    });

    it("should handle invalid X-Identity header gracefully", async () => {
      const plugin = authzPlugin();
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      const req = new Request("http://localhost/api/test", {
        headers: {
          "X-Identity": "invalid-json",
        },
      });

      // Should not throw, just log warning
      await plugin.onRequest?.(req, undefined);
      expect(ctx.logger.warn).toHaveBeenCalledWith("Failed to parse X-Identity header");
    });

    it("should handle anonymous users (no identity)", async () => {
      const permitAnonymous = createPolicy({
        id: "permit-anonymous",
        effect: "permit",
        subjects: [], // No subject restriction = matches anonymous
        resources: [{ path: "/public/*" }],
        actions: [{ method: "*" }],
      });

      const plugin = authzPlugin({
        policies: [permitAnonymous],
      });
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      const req = new Request("http://localhost/public/data");
      const response = await plugin.onRequest?.(req, undefined);

      expect(response).toBeUndefined(); // Permitted
    });
  });

  describe("onRequest - authorization decisions", () => {
    it("should return 403 for denied requests", async () => {
      const denyPolicy = createPolicy({
        id: "deny-all",
        effect: "deny",
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
        description: "Access denied by default policy",
      });

      const plugin = authzPlugin({
        policies: [denyPolicy],
      });
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      const req = new Request("http://localhost/api/secret");
      const response = await plugin.onRequest?.(req, undefined);

      expect(response).toBeInstanceOf(Response);
      expect(response?.status).toBe(403);

      const body = await response?.json();
      expect(body.error).toBe("Forbidden");
      expect(body.policy).toBe("deny-all");
    });

    it("should pass through permitted requests", async () => {
      const permitPolicy = createPolicy({
        id: "permit-all",
        effect: "permit",
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });

      const plugin = authzPlugin({
        policies: [permitPolicy],
      });
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      const req = new Request("http://localhost/api/data");
      const response = await plugin.onRequest?.(req, undefined);

      expect(response).toBeUndefined(); // No response = pass through
    });

    it("should skip authorization when no policies and no identity", async () => {
      const plugin = authzPlugin(); // No policies
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      const req = new Request("http://localhost/api/test");
      const response = await plugin.onRequest?.(req, undefined);

      expect(response).toBeUndefined(); // Skip authorization
    });

    it("should use app name in context", async () => {
      const appPolicy = createPolicy({
        id: "app-specific",
        effect: "permit",
        subjects: [],
        resources: [{ app: "my-app" }],
        actions: [{ method: "*" }],
      });

      const plugin = authzPlugin({
        policies: [appPolicy],
        defaultEffect: "deny",
      });
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      const req = new Request("http://localhost/api/test");
      const response = await plugin.onRequest?.(req, { name: "my-app" });

      expect(response).toBeUndefined(); // Permitted
    });
  });

  describe("authz service", () => {
    it("should provide seedPolicies method", async () => {
      const plugin = authzPlugin();
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      const authzService = plugin.provides() as {
        seedPolicies: (policies: Policy[], options?: { onlyIfEmpty?: boolean }) => Promise<number>;
        getPap: () => PolicyAdministrationPoint;
      };

      const policies = [createPolicy({ id: "seeded-1" }), createPolicy({ id: "seeded-2" })];

      const count = await authzService.seedPolicies(policies);
      expect(count).toBe(2);

      const pap = authzService.getPap();
      expect(pap.get("seeded-1")).toBeDefined();
      expect(pap.get("seeded-2")).toBeDefined();
    });

    it("should skip seedPolicies when policies already exist (onlyIfEmpty)", async () => {
      const plugin = authzPlugin({
        policies: [createPolicy({ id: "existing" })],
      });
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      const authzService = plugin.provides() as {
        seedPolicies: (policies: Policy[], options?: { onlyIfEmpty?: boolean }) => Promise<number>;
      };

      const count = await authzService.seedPolicies([createPolicy({ id: "new" })]);
      expect(count).toBe(0); // Skipped because policies exist
    });

    it("should force seedPolicies when onlyIfEmpty is false", async () => {
      const plugin = authzPlugin({
        policies: [createPolicy({ id: "existing" })],
      });
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      const authzService = plugin.provides() as {
        seedPolicies: (policies: Policy[], options?: { onlyIfEmpty?: boolean }) => Promise<number>;
        getPap: () => PolicyAdministrationPoint;
      };

      const count = await authzService.seedPolicies([createPolicy({ id: "new" })], {
        onlyIfEmpty: false,
      });
      expect(count).toBe(1);

      const pap = authzService.getPap();
      expect(pap.get("new")).toBeDefined();
    });

    it("should provide getPap method", async () => {
      const plugin = authzPlugin();
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      const authzService = plugin.provides() as {
        getPap: () => PolicyAdministrationPoint;
      };

      const pap = authzService.getPap();
      expect(pap).toBeInstanceOf(PolicyAdministrationPoint);
    });

    it("should provide getPdp method", async () => {
      const plugin = authzPlugin();
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      const authzService = plugin.provides() as {
        getPdp: () => PolicyDecisionPoint;
      };

      const pdp = authzService.getPdp();
      expect(pdp).toBeInstanceOf(PolicyDecisionPoint);
    });
  });
});

describe("PolicyAdministrationPoint", () => {
  describe("memory store", () => {
    let pap: PolicyAdministrationPoint;

    beforeEach(() => {
      pap = new PolicyAdministrationPoint("memory");
    });

    it("should start empty", () => {
      expect(pap.getAll()).toEqual([]);
    });

    it("should add a policy", async () => {
      const policy = createPolicy({ id: "test-1" });
      await pap.set(policy);

      expect(pap.get("test-1")).toEqual(policy);
    });

    it("should update a policy", async () => {
      const policy = createPolicy({ id: "test-1", effect: "permit" });
      await pap.set(policy);

      const updated = { ...policy, effect: "deny" as const };
      await pap.set(updated);

      expect(pap.get("test-1")?.effect).toBe("deny");
    });

    it("should delete a policy", async () => {
      const policy = createPolicy({ id: "test-1" });
      await pap.set(policy);

      const deleted = await pap.delete("test-1");
      expect(deleted).toBe(true);
      expect(pap.get("test-1")).toBeUndefined();
    });

    it("should return false when deleting non-existent policy", async () => {
      const deleted = await pap.delete("non-existent");
      expect(deleted).toBe(false);
    });

    it("should get all policies", async () => {
      await pap.set(createPolicy({ id: "p1" }));
      await pap.set(createPolicy({ id: "p2" }));
      await pap.set(createPolicy({ id: "p3" }));

      const all = pap.getAll();
      expect(all).toHaveLength(3);
    });

    it("should load from array", () => {
      const policies = [createPolicy({ id: "a1" }), createPolicy({ id: "a2" })];

      pap.loadFromArray(policies);

      expect(pap.getAll()).toHaveLength(2);
      expect(pap.get("a1")).toBeDefined();
      expect(pap.get("a2")).toBeDefined();
    });

    it("should clear all policies", async () => {
      await pap.set(createPolicy({ id: "c1" }));
      await pap.set(createPolicy({ id: "c2" }));

      pap.clear();

      expect(pap.getAll()).toEqual([]);
    });
  });

  describe("load method", () => {
    it("should not fail when no file path configured", async () => {
      const pap = new PolicyAdministrationPoint("memory");
      await expect(pap.load()).resolves.toBeUndefined();
    });
  });

  describe("save method", () => {
    it("should not fail when no file path configured", async () => {
      const pap = new PolicyAdministrationPoint("memory");
      await pap.set(createPolicy({ id: "test" }));
      // save() is called internally by set(), should not throw
    });
  });
});

describe("exports", () => {
  it("should export PolicyAdministrationPoint", () => {
    expect(PolicyAdministrationPoint).toBeDefined();
    expect(typeof PolicyAdministrationPoint).toBe("function");
  });

  it("should export PolicyDecisionPoint", () => {
    expect(PolicyDecisionPoint).toBeDefined();
    expect(typeof PolicyDecisionPoint).toBe("function");
  });

  it("should export authzPlugin as default", () => {
    expect(authzPlugin).toBeDefined();
    expect(typeof authzPlugin).toBe("function");
  });
});

describe("policy seed", () => {
  const originalEnv = Bun.env.NODE_ENV;

  beforeEach(() => {
    // Reset NODE_ENV before each test
    Bun.env.NODE_ENV = "development";
  });

  it("should seed inline policies from policySeed config", async () => {
    const seedPolicy = createPolicy({ id: "seed-inline-1" });
    const plugin = authzPlugin({
      policySeed: {
        enabled: true,
        policies: [seedPolicy],
      },
    });
    const ctx = createMockContext();

    await plugin.onInit?.(ctx as never);

    const authzService = plugin.provides() as {
      getPap: () => PolicyAdministrationPoint;
    };
    const pap = authzService.getPap();
    expect(pap.get("seed-inline-1")).toBeDefined();
  });

  it("should skip seeding when enabled is false", async () => {
    const seedPolicy = createPolicy({ id: "skip-seed" });
    const plugin = authzPlugin({
      policySeed: {
        enabled: false,
        policies: [seedPolicy],
      },
    });
    const ctx = createMockContext();

    await plugin.onInit?.(ctx as never);

    const authzService = plugin.provides() as {
      getPap: () => PolicyAdministrationPoint;
    };
    const pap = authzService.getPap();
    expect(pap.get("skip-seed")).toBeUndefined();
  });

  it("should skip seeding when environment is not allowed", async () => {
    Bun.env.NODE_ENV = "production";
    const seedPolicy = createPolicy({ id: "env-skip" });
    const plugin = authzPlugin({
      policySeed: {
        enabled: true,
        environments: ["development", "test"], // production not included
        policies: [seedPolicy],
      },
    });
    const ctx = createMockContext();

    await plugin.onInit?.(ctx as never);

    const authzService = plugin.provides() as {
      getPap: () => PolicyAdministrationPoint;
    };
    const pap = authzService.getPap();
    expect(pap.get("env-skip")).toBeUndefined();
    expect(ctx.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('env "production" not in allowed environments'),
    );
  });

  it("should seed when environment matches wildcard", async () => {
    Bun.env.NODE_ENV = "staging";
    const seedPolicy = createPolicy({ id: "wildcard-env" });
    const plugin = authzPlugin({
      policySeed: {
        enabled: true,
        environments: ["*"], // All environments
        policies: [seedPolicy],
      },
    });
    const ctx = createMockContext();

    await plugin.onInit?.(ctx as never);

    const authzService = plugin.provides() as {
      getPap: () => PolicyAdministrationPoint;
    };
    const pap = authzService.getPap();
    expect(pap.get("wildcard-env")).toBeDefined();
  });

  it("should skip seeding when onlyIfEmpty is true and policies exist", async () => {
    const existingPolicy = createPolicy({ id: "existing-policy" });
    const seedPolicy = createPolicy({ id: "should-not-seed" });
    const plugin = authzPlugin({
      policies: [existingPolicy], // Pre-existing policy
      policySeed: {
        enabled: true,
        onlyIfEmpty: true,
        policies: [seedPolicy],
      },
    });
    const ctx = createMockContext();

    await plugin.onInit?.(ctx as never);

    const authzService = plugin.provides() as {
      getPap: () => PolicyAdministrationPoint;
    };
    const pap = authzService.getPap();
    expect(pap.get("existing-policy")).toBeDefined();
    expect(pap.get("should-not-seed")).toBeUndefined();
    expect(ctx.logger.debug).toHaveBeenCalledWith("Policy seed skipped - policies already exist");
  });

  it("should seed when onlyIfEmpty is false even if policies exist", async () => {
    const existingPolicy = createPolicy({ id: "existing" });
    const seedPolicy = createPolicy({ id: "force-seed" });
    const plugin = authzPlugin({
      policies: [existingPolicy],
      policySeed: {
        enabled: true,
        onlyIfEmpty: false,
        policies: [seedPolicy],
      },
    });
    const ctx = createMockContext();

    await plugin.onInit?.(ctx as never);

    const authzService = plugin.provides() as {
      getPap: () => PolicyAdministrationPoint;
    };
    const pap = authzService.getPap();
    expect(pap.get("existing")).toBeDefined();
    expect(pap.get("force-seed")).toBeDefined();
  });

  it("should warn when seed file does not exist", async () => {
    const plugin = authzPlugin({
      policySeed: {
        enabled: true,
        file: "/non/existent/file.json",
      },
    });
    const ctx = createMockContext();

    await plugin.onInit?.(ctx as never);

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Policy seed file not found"),
    );
  });

  it("should load policies from seed file (array format)", async () => {
    // Create a temporary file with policies
    const tempFile = `/tmp/test-policies-${Date.now()}.json`;
    const policies = [
      { id: "file-policy-1", effect: "permit", subjects: [], resources: [], actions: [] },
      { id: "file-policy-2", effect: "deny", subjects: [], resources: [], actions: [] },
    ];
    await Bun.write(tempFile, JSON.stringify(policies));

    try {
      const plugin = authzPlugin({
        policySeed: {
          enabled: true,
          file: tempFile,
        },
      });
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      const authzService = plugin.provides() as {
        getPap: () => PolicyAdministrationPoint;
      };
      const pap = authzService.getPap();
      expect(pap.get("file-policy-1")).toBeDefined();
      expect(pap.get("file-policy-2")).toBeDefined();
    } finally {
      // Cleanup
      await Bun.file(tempFile).unlink?.();
    }
  });

  it("should load policies from seed file (object format with policies key)", async () => {
    const tempFile = `/tmp/test-policies-obj-${Date.now()}.json`;
    const data = {
      policies: [
        { id: "obj-policy-1", effect: "permit", subjects: [], resources: [], actions: [] },
      ],
    };
    await Bun.write(tempFile, JSON.stringify(data));

    try {
      const plugin = authzPlugin({
        policySeed: {
          enabled: true,
          file: tempFile,
        },
      });
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      const authzService = plugin.provides() as {
        getPap: () => PolicyAdministrationPoint;
      };
      const pap = authzService.getPap();
      expect(pap.get("obj-policy-1")).toBeDefined();
    } finally {
      await Bun.file(tempFile).unlink?.();
    }
  });

  it("should merge file policies with inline policies", async () => {
    const tempFile = `/tmp/test-policies-merge-${Date.now()}.json`;
    const filePolicy = {
      id: "from-file",
      effect: "permit",
      subjects: [],
      resources: [],
      actions: [],
    };
    await Bun.write(tempFile, JSON.stringify([filePolicy]));

    try {
      const inlinePolicy = createPolicy({ id: "from-inline" });
      const plugin = authzPlugin({
        policySeed: {
          enabled: true,
          file: tempFile,
          policies: [inlinePolicy],
        },
      });
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      const authzService = plugin.provides() as {
        getPap: () => PolicyAdministrationPoint;
      };
      const pap = authzService.getPap();
      expect(pap.get("from-file")).toBeDefined();
      expect(pap.get("from-inline")).toBeDefined();
    } finally {
      await Bun.file(tempFile).unlink?.();
    }
  });

  it("should handle malformed JSON in seed file", async () => {
    const tempFile = `/tmp/test-policies-bad-${Date.now()}.json`;
    await Bun.write(tempFile, "{ invalid json }");

    try {
      const plugin = authzPlugin({
        policySeed: {
          enabled: true,
          file: tempFile,
        },
      });
      const ctx = createMockContext();

      await plugin.onInit?.(ctx as never);

      expect(ctx.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load policy seed file"),
        expect.any(Error),
      );
    } finally {
      await Bun.file(tempFile).unlink?.();
    }
  });

  it("should handle empty policies array in seed config", async () => {
    const plugin = authzPlugin({
      policySeed: {
        enabled: true,
        policies: [],
      },
    });
    const ctx = createMockContext();

    await plugin.onInit?.(ctx as never);

    const authzService = plugin.provides() as {
      getPap: () => PolicyAdministrationPoint;
    };
    const pap = authzService.getPap();
    expect(pap.getAll()).toHaveLength(0);
  });

  it("should use default environments when not specified", async () => {
    // Default is ["*"] which allows all environments
    const seedPolicy = createPolicy({ id: "default-env" });
    const plugin = authzPlugin({
      policySeed: {
        enabled: true,
        // No environments specified - defaults to ["*"]
        policies: [seedPolicy],
      },
    });
    const ctx = createMockContext();

    await plugin.onInit?.(ctx as never);

    const authzService = plugin.provides() as {
      getPap: () => PolicyAdministrationPoint;
    };
    const pap = authzService.getPap();
    expect(pap.get("default-env")).toBeDefined();
  });

  // Restore original NODE_ENV after all tests
  afterAll(() => {
    Bun.env.NODE_ENV = originalEnv;
  });
});

describe("buildContext helper", () => {
  it("should extract IP from x-forwarded-for header", async () => {
    const denyPolicy = createPolicy({
      id: "deny-all",
      effect: "deny",
      subjects: [],
      resources: [{ path: "*" }],
      actions: [{ method: "*" }],
    });

    const plugin = authzPlugin({
      policies: [denyPolicy],
    });
    const ctx = createMockContext();

    await plugin.onInit?.(ctx as never);

    const req = new Request("http://localhost/api/test", {
      headers: {
        "x-forwarded-for": "203.0.113.195",
      },
    });

    await plugin.onRequest?.(req, undefined);

    // The context should have been built with the forwarded IP
    expect(ctx.logger.debug).toHaveBeenCalled();
  });

  it("should extract IP from x-real-ip header when x-forwarded-for is absent", async () => {
    const denyPolicy = createPolicy({
      id: "deny-all",
      effect: "deny",
      subjects: [],
      resources: [{ path: "*" }],
      actions: [{ method: "*" }],
    });

    const plugin = authzPlugin({
      policies: [denyPolicy],
    });
    const ctx = createMockContext();

    await plugin.onInit?.(ctx as never);

    const req = new Request("http://localhost/api/test", {
      headers: {
        "x-real-ip": "192.168.1.50",
      },
    });

    await plugin.onRequest?.(req, undefined);
    expect(ctx.logger.debug).toHaveBeenCalled();
  });

  it("should use unknown IP when no IP headers present", async () => {
    const denyPolicy = createPolicy({
      id: "deny-all",
      effect: "deny",
      subjects: [],
      resources: [{ path: "*" }],
      actions: [{ method: "*" }],
    });

    const plugin = authzPlugin({
      policies: [denyPolicy],
    });
    const ctx = createMockContext();

    await plugin.onInit?.(ctx as never);

    const req = new Request("http://localhost/api/test");
    await plugin.onRequest?.(req, undefined);
    expect(ctx.logger.debug).toHaveBeenCalled();
  });

  it("should extract user agent from request", async () => {
    const denyPolicy = createPolicy({
      id: "deny-all",
      effect: "deny",
      subjects: [],
      resources: [{ path: "*" }],
      actions: [{ method: "*" }],
    });

    const plugin = authzPlugin({
      policies: [denyPolicy],
    });
    const ctx = createMockContext();

    await plugin.onInit?.(ctx as never);

    const req = new Request("http://localhost/api/test", {
      headers: {
        "user-agent": "Mozilla/5.0",
      },
    });

    await plugin.onRequest?.(req, undefined);
    expect(ctx.logger.debug).toHaveBeenCalled();
  });

  it("should handle missing app parameter", async () => {
    const permitPolicy = createPolicy({
      id: "permit-all",
      effect: "permit",
      subjects: [],
      resources: [{ path: "*" }],
      actions: [{ method: "*" }],
    });

    const plugin = authzPlugin({
      policies: [permitPolicy],
    });
    const ctx = createMockContext();

    await plugin.onInit?.(ctx as never);

    const req = new Request("http://localhost/api/test");
    // Passing undefined for app
    const result = await plugin.onRequest?.(req, undefined);
    expect(result).toBeUndefined(); // Permitted
  });

  it("should build context with full identity from header", async () => {
    const policy = createPolicy({
      id: "role-check",
      effect: "permit",
      subjects: [{ role: "admin" }],
      resources: [{ path: "*" }],
      actions: [{ method: "*" }],
    });

    const plugin = authzPlugin({
      policies: [policy],
    });
    const ctx = createMockContext();

    await plugin.onInit?.(ctx as never);

    const identity = {
      sub: "user-456",
      roles: ["admin", "user"],
      groups: ["engineering", "devops"],
      claims: { department: "IT", level: 5 },
    };

    const req = new Request("http://localhost/api/admin", {
      headers: {
        "X-Identity": JSON.stringify(identity),
      },
    });

    const result = await plugin.onRequest?.(req, { name: "admin-app" });
    expect(result).toBeUndefined(); // Permitted for admin
  });
});
