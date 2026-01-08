import { beforeEach, describe, expect, it } from "bun:test";
import { PolicyDecisionPoint } from "./pdp";
import type { EvaluationContext, Policy } from "./types";

/**
 * Factory function for creating evaluation contexts
 */
function createContext(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    subject: {
      id: "user-123",
      roles: ["user"],
      groups: [],
      claims: {},
      ...overrides.subject,
    },
    resource: {
      app: "test-app",
      path: "/api/test",
      ...overrides.resource,
    },
    action: {
      method: "GET",
      ...overrides.action,
    },
    environment: {
      ip: "192.168.1.100",
      time: new Date("2024-06-15T10:00:00Z"),
      ...overrides.environment,
    },
  };
}

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

describe("PolicyDecisionPoint", () => {
  describe("constructor", () => {
    it("should use default combining algorithm and effect", () => {
      const pdp = new PolicyDecisionPoint();
      const context = createContext();
      const decision = pdp.evaluate(context, []);

      expect(decision.effect).toBe("deny");
      expect(decision.reason).toBe("No applicable policy");
    });

    it("should use custom default effect", () => {
      const pdp = new PolicyDecisionPoint("deny-overrides", "permit");
      const context = createContext();
      const decision = pdp.evaluate(context, []);

      expect(decision.effect).toBe("permit");
    });
  });

  describe("evaluate - no policies", () => {
    let pdp: PolicyDecisionPoint;

    beforeEach(() => {
      pdp = new PolicyDecisionPoint();
    });

    it("should return default deny when no policies exist", () => {
      const context = createContext();
      const decision = pdp.evaluate(context, []);

      expect(decision.effect).toBe("deny");
      expect(decision.reason).toBe("No applicable policy");
    });
  });

  describe("evaluate - subject matching", () => {
    let pdp: PolicyDecisionPoint;

    beforeEach(() => {
      pdp = new PolicyDecisionPoint();
    });

    it("should match policy with empty subjects (no restriction)", () => {
      const policy = createPolicy({
        id: "allow-all",
        effect: "permit",
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });
      const context = createContext();
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
      expect(decision.matchedPolicy).toBe("allow-all");
    });

    it("should match subject by ID", () => {
      const policy = createPolicy({
        id: "user-specific",
        effect: "permit",
        subjects: [{ id: "user-123" }],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({
        subject: { id: "user-123", roles: [], groups: [], claims: {} },
      });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });

    it("should not match subject with different ID", () => {
      const policy = createPolicy({
        id: "user-specific",
        effect: "permit",
        subjects: [{ id: "user-456" }],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({
        subject: { id: "user-123", roles: [], groups: [], claims: {} },
      });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("deny");
      expect(decision.reason).toBe("No applicable policy");
    });

    it("should match subject by role", () => {
      const policy = createPolicy({
        id: "admin-policy",
        effect: "permit",
        subjects: [{ role: "admin" }],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({
        subject: { id: "user-123", roles: ["admin", "user"], groups: [], claims: {} },
      });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });

    it("should match subject with role wildcard", () => {
      const policy = createPolicy({
        id: "admin-wildcard",
        effect: "permit",
        subjects: [{ role: "admin:*" }],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({
        subject: { id: "user-123", roles: ["admin:read", "admin:write"], groups: [], claims: {} },
      });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });

    it("should match subject by group", () => {
      const policy = createPolicy({
        id: "team-policy",
        effect: "permit",
        subjects: [{ group: "engineering" }],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({
        subject: { id: "user-123", roles: [], groups: ["engineering"], claims: {} },
      });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });

    it("should not match subject missing required group", () => {
      const policy = createPolicy({
        id: "team-policy",
        effect: "permit",
        subjects: [{ group: "engineering" }],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({
        subject: { id: "user-123", roles: [], groups: ["marketing"], claims: {} },
      });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("deny");
    });

    it("should match subject by claim with eq operator", () => {
      const policy = createPolicy({
        id: "claim-eq",
        effect: "permit",
        subjects: [{ claim: { name: "department", value: "IT", operator: "eq" } }],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({
        subject: { id: "user-123", roles: [], groups: [], claims: { department: "IT" } },
      });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });

    it("should match subject by claim with neq operator", () => {
      const policy = createPolicy({
        id: "claim-neq",
        effect: "permit",
        subjects: [{ claim: { name: "status", value: "inactive", operator: "neq" } }],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({
        subject: { id: "user-123", roles: [], groups: [], claims: { status: "active" } },
      });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });

    it("should match subject by claim with gt operator", () => {
      const policy = createPolicy({
        id: "claim-gt",
        effect: "permit",
        subjects: [{ claim: { name: "level", value: 5, operator: "gt" } }],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({
        subject: { id: "user-123", roles: [], groups: [], claims: { level: 10 } },
      });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });

    it("should match subject by claim with lt operator", () => {
      const policy = createPolicy({
        id: "claim-lt",
        effect: "permit",
        subjects: [{ claim: { name: "age", value: 65, operator: "lt" } }],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({
        subject: { id: "user-123", roles: [], groups: [], claims: { age: 30 } },
      });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });

    it("should match subject by claim with contains operator", () => {
      const policy = createPolicy({
        id: "claim-contains",
        effect: "permit",
        subjects: [{ claim: { name: "email", value: "@company.com", operator: "contains" } }],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({
        subject: { id: "user-123", roles: [], groups: [], claims: { email: "john@company.com" } },
      });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });

    it("should match subject by claim with regex operator", () => {
      const policy = createPolicy({
        id: "claim-regex",
        effect: "permit",
        subjects: [
          { claim: { name: "email", value: "^[a-z]+@example\\.com$", operator: "regex" } },
        ],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({
        subject: { id: "user-123", roles: [], groups: [], claims: { email: "john@example.com" } },
      });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });

    it("should match any of multiple subjects (OR logic)", () => {
      const policy = createPolicy({
        id: "multi-subject",
        effect: "permit",
        subjects: [{ role: "admin" }, { role: "superuser" }],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({
        subject: { id: "user-123", roles: ["superuser"], groups: [], claims: {} },
      });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });
  });

  describe("evaluate - resource matching", () => {
    let pdp: PolicyDecisionPoint;

    beforeEach(() => {
      pdp = new PolicyDecisionPoint();
    });

    it("should match resource by exact path", () => {
      const policy = createPolicy({
        id: "exact-path",
        effect: "permit",
        subjects: [],
        resources: [{ path: "/api/users" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({ resource: { app: "test", path: "/api/users" } });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });

    it("should match resource by path wildcard", () => {
      const policy = createPolicy({
        id: "wildcard-path",
        effect: "permit",
        subjects: [],
        resources: [{ path: "/api/*" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({ resource: { app: "test", path: "/api/users/123" } });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });

    it("should not match resource with different path", () => {
      const policy = createPolicy({
        id: "api-path",
        effect: "permit",
        subjects: [],
        resources: [{ path: "/api/*" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({ resource: { app: "test", path: "/admin/dashboard" } });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("deny");
    });

    it("should match resource by app name", () => {
      const policy = createPolicy({
        id: "app-match",
        effect: "permit",
        subjects: [],
        resources: [{ app: "admin-panel" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({ resource: { app: "admin-panel", path: "/dashboard" } });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });

    it("should match resource by app wildcard", () => {
      const policy = createPolicy({
        id: "app-wildcard",
        effect: "permit",
        subjects: [],
        resources: [{ app: "admin-*" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({ resource: { app: "admin-users", path: "/list" } });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });

    it("should match resource by type", () => {
      const policy = createPolicy({
        id: "type-match",
        effect: "permit",
        subjects: [],
        resources: [{ type: "document" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({
        resource: { app: "docs", path: "/doc/1", type: "document" },
      });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });

    it("should match any of multiple resources (OR logic)", () => {
      const policy = createPolicy({
        id: "multi-resource",
        effect: "permit",
        subjects: [],
        resources: [{ path: "/api/*" }, { path: "/public/*" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({ resource: { app: "test", path: "/public/assets" } });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });
  });

  describe("evaluate - action matching", () => {
    let pdp: PolicyDecisionPoint;

    beforeEach(() => {
      pdp = new PolicyDecisionPoint();
    });

    it("should match action by exact method", () => {
      const policy = createPolicy({
        id: "get-only",
        effect: "permit",
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "GET" }],
      });
      const context = createContext({ action: { method: "GET" } });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });

    it("should match action by method wildcard", () => {
      const policy = createPolicy({
        id: "all-methods",
        effect: "permit",
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });
      const context = createContext({ action: { method: "DELETE" } });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });

    it("should match action case-insensitively", () => {
      const policy = createPolicy({
        id: "post-only",
        effect: "permit",
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "post" }],
      });
      const context = createContext({ action: { method: "POST" } });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });

    it("should not match action with different method", () => {
      const policy = createPolicy({
        id: "get-only",
        effect: "permit",
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "GET" }],
      });
      const context = createContext({ action: { method: "POST" } });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("deny");
    });

    it("should match action by operation", () => {
      const policy = createPolicy({
        id: "read-operation",
        effect: "permit",
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ operation: "read" }],
      });
      const context = createContext({ action: { method: "GET", operation: "read" } });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });

    it("should match any of multiple actions (OR logic)", () => {
      const policy = createPolicy({
        id: "read-write",
        effect: "permit",
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "GET" }, { method: "POST" }],
      });
      const context = createContext({ action: { method: "POST" } });
      const decision = pdp.evaluate(context, [policy]);

      expect(decision.effect).toBe("permit");
    });
  });

  describe("evaluate - conditions", () => {
    let pdp: PolicyDecisionPoint;

    beforeEach(() => {
      pdp = new PolicyDecisionPoint("first-applicable", "deny");
    });

    it("should evaluate time condition - after", () => {
      const policy = createPolicy({
        id: "business-hours",
        effect: "permit",
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
        conditions: [{ type: "time", after: "09:00" }],
      });

      // 10:00 - after 9:00
      const contextAllow = createContext({
        environment: { ip: "127.0.0.1", time: new Date("2024-06-15T10:00:00Z") },
      });
      const decisionAllow = pdp.evaluate(contextAllow, [policy]);
      expect(decisionAllow.effect).toBe("permit");

      // 08:00 - before 9:00 (condition not met)
      // Policy matches subject/resource/action but condition fails
      // Returns not_applicable which is not permit/deny, so combineDecisions returns default
      const contextDeny = createContext({
        environment: { ip: "127.0.0.1", time: new Date("2024-06-15T08:00:00Z") },
      });
      const decisionDeny = pdp.evaluate(contextDeny, [policy]);
      expect(decisionDeny.effect).toBe("deny");
      expect(decisionDeny.reason).toBe("No applicable policy");
    });

    it("should evaluate time condition - before", () => {
      const policy = createPolicy({
        id: "before-hours",
        effect: "permit",
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
        conditions: [{ type: "time", before: "18:00" }],
      });

      // 15:00 - before 18:00
      const contextAllow = createContext({
        environment: { ip: "127.0.0.1", time: new Date("2024-06-15T15:00:00Z") },
      });
      const decisionAllow = pdp.evaluate(contextAllow, [policy]);
      expect(decisionAllow.effect).toBe("permit");

      // 20:00 - after 18:00 (condition not met)
      const contextDeny = createContext({
        environment: { ip: "127.0.0.1", time: new Date("2024-06-15T20:00:00Z") },
      });
      const decisionDeny = pdp.evaluate(contextDeny, [policy]);
      expect(decisionDeny.effect).toBe("deny");
      expect(decisionDeny.reason).toBe("No applicable policy");
    });

    it("should evaluate time condition - day of week", () => {
      const policy = createPolicy({
        id: "weekdays",
        effect: "permit",
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
        conditions: [{ type: "time", dayOfWeek: [1, 2, 3, 4, 5] }], // Mon-Fri
      });

      // Wednesday (day 3)
      const contextAllow = createContext({
        environment: { ip: "127.0.0.1", time: new Date("2024-06-12T10:00:00Z") }, // Wed
      });
      const decisionAllow = pdp.evaluate(contextAllow, [policy]);
      expect(decisionAllow.effect).toBe("permit");

      // Saturday (day 6)
      const contextDeny = createContext({
        environment: { ip: "127.0.0.1", time: new Date("2024-06-15T10:00:00Z") }, // Sat
      });
      const decisionDeny = pdp.evaluate(contextDeny, [policy]);
      expect(decisionDeny.effect).toBe("deny");
    });

    it("should evaluate IP condition - allowlist", () => {
      const policy = createPolicy({
        id: "ip-allowlist",
        effect: "permit",
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
        conditions: [{ type: "ip", allowlist: ["10.0.0.1", "10.0.0.2"] }],
      });

      // Allowed IP
      const contextAllow = createContext({
        environment: { ip: "10.0.0.1", time: new Date() },
      });
      const decisionAllow = pdp.evaluate(contextAllow, [policy]);
      expect(decisionAllow.effect).toBe("permit");

      // Not allowed IP (condition not met, default deny)
      const contextDeny = createContext({
        environment: { ip: "192.168.1.1", time: new Date() },
      });
      const decisionDeny = pdp.evaluate(contextDeny, [policy]);
      expect(decisionDeny.effect).toBe("deny");
    });

    it("should evaluate IP condition - blocklist", () => {
      const policy = createPolicy({
        id: "ip-blocklist",
        effect: "permit",
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
        conditions: [{ type: "ip", blocklist: ["10.0.0.100", "10.0.0.101"] }],
      });

      // Not blocked IP
      const contextAllow = createContext({
        environment: { ip: "10.0.0.1", time: new Date() },
      });
      const decisionAllow = pdp.evaluate(contextAllow, [policy]);
      expect(decisionAllow.effect).toBe("permit");

      // Blocked IP (condition not met, default deny)
      const contextDeny = createContext({
        environment: { ip: "10.0.0.100", time: new Date() },
      });
      const decisionDeny = pdp.evaluate(contextDeny, [policy]);
      expect(decisionDeny.effect).toBe("deny");
    });

    it("should use default effect when only not_applicable policies exist", () => {
      const policy = createPolicy({
        id: "conditional",
        effect: "permit",
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
        conditions: [{ type: "ip", allowlist: ["1.2.3.4"] }],
      });
      const context = createContext({ environment: { ip: "5.6.7.8", time: new Date() } });
      const decision = pdp.evaluate(context, [policy]);

      // Policy matched but condition failed, returns not_applicable
      // combineDecisions has only not_applicable results, returns default effect
      expect(decision.effect).toBe("deny");
      expect(decision.reason).toBe("No applicable policy");
    });

    it("should fall back to next policy when condition not met with first-applicable", () => {
      const conditionalPolicy = createPolicy({
        id: "conditional",
        effect: "permit",
        priority: 100,
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
        conditions: [{ type: "ip", allowlist: ["1.2.3.4"] }],
      });

      const fallbackPolicy = createPolicy({
        id: "fallback",
        effect: "deny",
        priority: 50,
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });

      // IP not in allowlist, conditional returns not_applicable
      // Falls through to fallback policy
      const context = createContext({ environment: { ip: "5.6.7.8", time: new Date() } });
      const decision = pdp.evaluate(context, [conditionalPolicy, fallbackPolicy]);

      expect(decision.effect).toBe("deny");
      expect(decision.matchedPolicy).toBe("fallback");
    });
  });

  describe("evaluate - priority", () => {
    let pdp: PolicyDecisionPoint;

    beforeEach(() => {
      pdp = new PolicyDecisionPoint("first-applicable");
    });

    it("should evaluate higher priority policies first", () => {
      const lowPriority = createPolicy({
        id: "low-priority",
        effect: "deny",
        priority: 10,
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });
      const highPriority = createPolicy({
        id: "high-priority",
        effect: "permit",
        priority: 100,
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });

      const context = createContext();
      const decision = pdp.evaluate(context, [lowPriority, highPriority]);

      expect(decision.effect).toBe("permit");
      expect(decision.matchedPolicy).toBe("high-priority");
    });

    it("should handle policies without priority (default to 0)", () => {
      const withPriority = createPolicy({
        id: "with-priority",
        effect: "permit",
        priority: 10,
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });
      const withoutPriority = createPolicy({
        id: "without-priority",
        effect: "deny",
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      });

      const context = createContext();
      const decision = pdp.evaluate(context, [withoutPriority, withPriority]);

      expect(decision.effect).toBe("permit");
      expect(decision.matchedPolicy).toBe("with-priority");
    });
  });

  describe("combining algorithms", () => {
    describe("deny-overrides", () => {
      let pdp: PolicyDecisionPoint;

      beforeEach(() => {
        pdp = new PolicyDecisionPoint("deny-overrides");
      });

      it("should deny if any policy denies", () => {
        const permitPolicy = createPolicy({
          id: "permit",
          effect: "permit",
          subjects: [],
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        });
        const denyPolicy = createPolicy({
          id: "deny",
          effect: "deny",
          subjects: [],
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        });

        const context = createContext();
        const decision = pdp.evaluate(context, [permitPolicy, denyPolicy]);

        expect(decision.effect).toBe("deny");
      });

      it("should permit if all applicable policies permit", () => {
        const permit1 = createPolicy({
          id: "permit1",
          effect: "permit",
          subjects: [],
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        });
        const permit2 = createPolicy({
          id: "permit2",
          effect: "permit",
          subjects: [],
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        });

        const context = createContext();
        const decision = pdp.evaluate(context, [permit1, permit2]);

        expect(decision.effect).toBe("permit");
      });
    });

    describe("permit-overrides", () => {
      let pdp: PolicyDecisionPoint;

      beforeEach(() => {
        pdp = new PolicyDecisionPoint("permit-overrides");
      });

      it("should permit if any policy permits", () => {
        const permitPolicy = createPolicy({
          id: "permit",
          effect: "permit",
          subjects: [],
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        });
        const denyPolicy = createPolicy({
          id: "deny",
          effect: "deny",
          subjects: [],
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        });

        const context = createContext();
        const decision = pdp.evaluate(context, [denyPolicy, permitPolicy]);

        expect(decision.effect).toBe("permit");
      });

      it("should deny if all applicable policies deny", () => {
        const deny1 = createPolicy({
          id: "deny1",
          effect: "deny",
          subjects: [],
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        });
        const deny2 = createPolicy({
          id: "deny2",
          effect: "deny",
          subjects: [],
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        });

        const context = createContext();
        const decision = pdp.evaluate(context, [deny1, deny2]);

        expect(decision.effect).toBe("deny");
      });
    });

    describe("first-applicable", () => {
      let pdp: PolicyDecisionPoint;

      beforeEach(() => {
        pdp = new PolicyDecisionPoint("first-applicable");
      });

      it("should return first matching permit decision", () => {
        const permit = createPolicy({
          id: "permit",
          effect: "permit",
          priority: 100,
          subjects: [],
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        });
        const deny = createPolicy({
          id: "deny",
          effect: "deny",
          priority: 50,
          subjects: [],
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        });

        const context = createContext();
        const decision = pdp.evaluate(context, [deny, permit]);

        expect(decision.effect).toBe("permit");
        expect(decision.matchedPolicy).toBe("permit");
      });

      it("should return first matching deny decision", () => {
        const deny = createPolicy({
          id: "deny",
          effect: "deny",
          priority: 100,
          subjects: [],
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        });
        const permit = createPolicy({
          id: "permit",
          effect: "permit",
          priority: 50,
          subjects: [],
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        });

        const context = createContext();
        const decision = pdp.evaluate(context, [permit, deny]);

        expect(decision.effect).toBe("deny");
        expect(decision.matchedPolicy).toBe("deny");
      });

      it("should skip not_applicable policies", () => {
        const notApplicable = createPolicy({
          id: "not-applicable",
          effect: "permit",
          priority: 100,
          subjects: [{ role: "super-admin" }], // Won't match
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        });
        const applicable = createPolicy({
          id: "applicable",
          effect: "deny",
          priority: 50,
          subjects: [],
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        });

        const context = createContext({
          subject: { id: "user", roles: ["user"], groups: [], claims: {} },
        });
        const decision = pdp.evaluate(context, [notApplicable, applicable]);

        expect(decision.effect).toBe("deny");
        expect(decision.matchedPolicy).toBe("applicable");
      });
    });
  });

  describe("real-world scenarios", () => {
    it("should implement admin-only route protection with first-applicable", () => {
      // For admin-only routes, use first-applicable with priority
      // Higher priority admin permit rule is evaluated first
      const pdp = new PolicyDecisionPoint("first-applicable");

      const adminPolicy = createPolicy({
        id: "admin-only",
        effect: "permit",
        priority: 100, // Higher priority - evaluated first
        subjects: [{ role: "admin" }],
        resources: [{ path: "/admin/*" }],
        actions: [{ method: "*" }],
      });

      const denyOthers = createPolicy({
        id: "deny-admin-others",
        effect: "deny",
        priority: 50, // Lower priority
        subjects: [],
        resources: [{ path: "/admin/*" }],
        actions: [{ method: "*" }],
      });

      // Admin accessing admin route - matches admin-only first
      const adminContext = createContext({
        subject: { id: "admin-1", roles: ["admin"], groups: [], claims: {} },
        resource: { app: "main", path: "/admin/users" },
      });
      const adminDecision = pdp.evaluate(adminContext, [adminPolicy, denyOthers]);
      expect(adminDecision.effect).toBe("permit");

      // Regular user accessing admin route - admin-only doesn't match, falls to deny-admin-others
      const userContext = createContext({
        subject: { id: "user-1", roles: ["user"], groups: [], claims: {} },
        resource: { app: "main", path: "/admin/users" },
      });
      const userDecision = pdp.evaluate(userContext, [adminPolicy, denyOthers]);
      expect(userDecision.effect).toBe("deny");
    });

    it("should implement admin-only route protection with deny-overrides", () => {
      // With deny-overrides, the deny policy must NOT match admins
      // So we need a more specific deny policy that excludes admins
      const pdp = new PolicyDecisionPoint("deny-overrides");

      // Permit policy for admin role
      const adminPolicy = createPolicy({
        id: "admin-only",
        effect: "permit",
        subjects: [{ role: "admin" }],
        resources: [{ path: "/admin/*" }],
        actions: [{ method: "*" }],
      });

      // No deny policy that would match everyone
      // Instead, rely on default deny for non-matching subjects

      // Admin accessing admin route
      const adminContext = createContext({
        subject: { id: "admin-1", roles: ["admin"], groups: [], claims: {} },
        resource: { app: "main", path: "/admin/users" },
      });
      const adminDecision = pdp.evaluate(adminContext, [adminPolicy]);
      expect(adminDecision.effect).toBe("permit");

      // Regular user accessing admin route - no matching policy, default deny
      const userContext = createContext({
        subject: { id: "user-1", roles: ["user"], groups: [], claims: {} },
        resource: { app: "main", path: "/admin/users" },
      });
      const userDecision = pdp.evaluate(userContext, [adminPolicy]);
      expect(userDecision.effect).toBe("deny");
      expect(userDecision.reason).toBe("No applicable policy");
    });

    it("should implement read-only for users, full access for admins", () => {
      const pdp = new PolicyDecisionPoint("first-applicable");

      const adminFull = createPolicy({
        id: "admin-full",
        effect: "permit",
        priority: 100,
        subjects: [{ role: "admin" }],
        resources: [{ path: "/api/*" }],
        actions: [{ method: "*" }],
      });

      const userReadOnly = createPolicy({
        id: "user-readonly",
        effect: "permit",
        priority: 50,
        subjects: [{ role: "user" }],
        resources: [{ path: "/api/*" }],
        actions: [{ method: "GET" }],
      });

      const denyOthers = createPolicy({
        id: "deny-others",
        effect: "deny",
        priority: 1,
        subjects: [],
        resources: [{ path: "/api/*" }],
        actions: [{ method: "*" }],
      });

      // Admin can POST
      const adminPost = createContext({
        subject: { id: "admin-1", roles: ["admin"], groups: [], claims: {} },
        resource: { app: "api", path: "/api/users" },
        action: { method: "POST" },
      });
      expect(pdp.evaluate(adminPost, [adminFull, userReadOnly, denyOthers]).effect).toBe("permit");

      // User can GET
      const userGet = createContext({
        subject: { id: "user-1", roles: ["user"], groups: [], claims: {} },
        resource: { app: "api", path: "/api/users" },
        action: { method: "GET" },
      });
      expect(pdp.evaluate(userGet, [adminFull, userReadOnly, denyOthers]).effect).toBe("permit");

      // User cannot POST
      const userPost = createContext({
        subject: { id: "user-1", roles: ["user"], groups: [], claims: {} },
        resource: { app: "api", path: "/api/users" },
        action: { method: "POST" },
      });
      expect(pdp.evaluate(userPost, [adminFull, userReadOnly, denyOthers]).effect).toBe("deny");
    });

    it("should implement time-based access control", () => {
      const pdp = new PolicyDecisionPoint("first-applicable");

      const businessHours = createPolicy({
        id: "business-hours",
        effect: "permit",
        priority: 100,
        subjects: [],
        resources: [{ path: "/api/*" }],
        actions: [{ method: "*" }],
        conditions: [{ type: "time", after: "09:00", before: "18:00" }],
      });

      const afterHoursDeny = createPolicy({
        id: "after-hours",
        effect: "deny",
        priority: 50,
        subjects: [],
        resources: [{ path: "/api/*" }],
        actions: [{ method: "*" }],
      });

      // Access at 10:00
      const duringHours = createContext({
        environment: { ip: "127.0.0.1", time: new Date("2024-06-15T10:00:00Z") },
        resource: { app: "api", path: "/api/data" },
      });
      expect(pdp.evaluate(duringHours, [businessHours, afterHoursDeny]).effect).toBe("permit");

      // Access at 20:00
      const afterHours = createContext({
        environment: { ip: "127.0.0.1", time: new Date("2024-06-15T20:00:00Z") },
        resource: { app: "api", path: "/api/data" },
      });
      expect(pdp.evaluate(afterHours, [businessHours, afterHoursDeny]).effect).toBe("deny");
    });
  });
});
