import { beforeEach, describe, expect, it } from "bun:test";
import { api, initApi } from "./api";
import { PolicyAdministrationPoint } from "./pap";
import { PolicyDecisionPoint } from "./pdp";
import type { EvaluationContext, Policy } from "./types";

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

describe("AuthZ API", () => {
  let pap: PolicyAdministrationPoint;
  let pdp: PolicyDecisionPoint;

  beforeEach(() => {
    pap = new PolicyAdministrationPoint("memory");
    pdp = new PolicyDecisionPoint("deny-overrides", "deny");
    initApi(pap, pdp);
  });

  describe("GET /api/policies", () => {
    it("should return empty array when no policies exist", async () => {
      const req = new Request("http://localhost/api/policies");
      const res = await api.request(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });

    it("should return all policies", async () => {
      await pap.set(createPolicy({ id: "policy-1", name: "First Policy" }));
      await pap.set(createPolicy({ id: "policy-2", name: "Second Policy" }));

      const req = new Request("http://localhost/api/policies");
      const res = await api.request(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(2);
      expect(data.map((p: Policy) => p.id)).toContain("policy-1");
      expect(data.map((p: Policy) => p.id)).toContain("policy-2");
    });
  });

  describe("GET /api/policies/:id", () => {
    it("should return a specific policy by ID", async () => {
      const policy = createPolicy({ id: "specific-policy", name: "Test Policy" });
      await pap.set(policy);

      const req = new Request("http://localhost/api/policies/specific-policy");
      const res = await api.request(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe("specific-policy");
      expect(data.name).toBe("Test Policy");
    });

    it("should return 404 for non-existent policy", async () => {
      const req = new Request("http://localhost/api/policies/non-existent");
      const res = await api.request(req);

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Policy not found");
    });
  });

  describe("POST /api/policies", () => {
    it("should create a new policy", async () => {
      const policy: Policy = {
        id: "new-policy",
        name: "New Policy",
        effect: "permit",
        subjects: [{ role: "admin" }],
        resources: [{ path: "/admin/*" }],
        actions: [{ method: "*" }],
      };

      const req = new Request("http://localhost/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policy),
      });
      const res = await api.request(req);

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBe("new-policy");
      expect(data.name).toBe("New Policy");

      // Verify it was persisted
      const stored = pap.get("new-policy");
      expect(stored).toBeDefined();
      expect(stored?.name).toBe("New Policy");
    });

    it("should update an existing policy", async () => {
      // Create initial policy
      await pap.set(createPolicy({ id: "update-me", effect: "deny" }));

      // Update it
      const updatedPolicy: Policy = {
        id: "update-me",
        name: "Updated Policy",
        effect: "permit",
        subjects: [],
        resources: [{ path: "*" }],
        actions: [{ method: "*" }],
      };

      const req = new Request("http://localhost/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedPolicy),
      });
      const res = await api.request(req);

      expect(res.status).toBe(201);
      const stored = pap.get("update-me");
      expect(stored?.effect).toBe("permit");
      expect(stored?.name).toBe("Updated Policy");
    });

    it("should return 400 for invalid policy structure - missing id", async () => {
      const invalidPolicy = {
        effect: "permit",
        subjects: [],
        resources: [],
        actions: [],
      };

      const req = new Request("http://localhost/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invalidPolicy),
      });
      const res = await api.request(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid policy structure");
    });

    it("should return 400 for invalid policy structure - missing effect", async () => {
      const invalidPolicy = {
        id: "missing-effect",
        subjects: [],
        resources: [],
        actions: [],
      };

      const req = new Request("http://localhost/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invalidPolicy),
      });
      const res = await api.request(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid policy structure");
    });

    it("should return 400 for invalid policy structure - missing subjects", async () => {
      const invalidPolicy = {
        id: "missing-subjects",
        effect: "permit",
        resources: [],
        actions: [],
      };

      const req = new Request("http://localhost/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invalidPolicy),
      });
      const res = await api.request(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid policy structure");
    });

    it("should return 400 for invalid policy structure - missing resources", async () => {
      const invalidPolicy = {
        id: "missing-resources",
        effect: "permit",
        subjects: [],
        actions: [],
      };

      const req = new Request("http://localhost/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invalidPolicy),
      });
      const res = await api.request(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid policy structure");
    });

    it("should return 400 for invalid policy structure - missing actions", async () => {
      const invalidPolicy = {
        id: "missing-actions",
        effect: "permit",
        subjects: [],
        resources: [],
      };

      const req = new Request("http://localhost/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invalidPolicy),
      });
      const res = await api.request(req);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid policy structure");
    });
  });

  describe("DELETE /api/policies/:id", () => {
    it("should delete an existing policy", async () => {
      await pap.set(createPolicy({ id: "delete-me" }));

      const req = new Request("http://localhost/api/policies/delete-me", {
        method: "DELETE",
      });
      const res = await api.request(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      // Verify it was deleted
      expect(pap.get("delete-me")).toBeUndefined();
    });

    it("should return 404 when deleting non-existent policy", async () => {
      const req = new Request("http://localhost/api/policies/non-existent", {
        method: "DELETE",
      });
      const res = await api.request(req);

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Policy not found");
    });
  });

  describe("POST /api/evaluate", () => {
    it("should evaluate context against policies and return permit", async () => {
      await pap.set(
        createPolicy({
          id: "permit-all",
          effect: "permit",
          subjects: [],
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        }),
      );

      const context = createContext();
      const req = new Request("http://localhost/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context),
      });
      const res = await api.request(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.effect).toBe("permit");
      expect(data.matchedPolicy).toBe("permit-all");
    });

    it("should evaluate context against policies and return deny", async () => {
      await pap.set(
        createPolicy({
          id: "deny-all",
          effect: "deny",
          subjects: [],
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        }),
      );

      const context = createContext();
      const req = new Request("http://localhost/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context),
      });
      const res = await api.request(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.effect).toBe("deny");
      expect(data.matchedPolicy).toBe("deny-all");
    });

    it("should return default deny when no policies match", async () => {
      const context = createContext();
      const req = new Request("http://localhost/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context),
      });
      const res = await api.request(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.effect).toBe("deny");
      expect(data.reason).toBe("No applicable policy");
    });

    it("should evaluate with specific subject matching", async () => {
      await pap.set(
        createPolicy({
          id: "admin-only",
          effect: "permit",
          subjects: [{ role: "admin" }],
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        }),
      );

      // Regular user should be denied
      const userContext = createContext({
        subject: { id: "user-1", roles: ["user"], groups: [], claims: {} },
      });
      const userReq = new Request("http://localhost/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userContext),
      });
      const userRes = await api.request(userReq);
      const userData = await userRes.json();
      expect(userData.effect).toBe("deny");

      // Admin should be permitted
      const adminContext = createContext({
        subject: { id: "admin-1", roles: ["admin"], groups: [], claims: {} },
      });
      const adminReq = new Request("http://localhost/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adminContext),
      });
      const adminRes = await api.request(adminReq);
      const adminData = await adminRes.json();
      expect(adminData.effect).toBe("permit");
    });
  });

  describe("POST /api/explain", () => {
    it("should return context, decision, and policies for debugging", async () => {
      await pap.set(
        createPolicy({
          id: "policy-1",
          name: "First Policy",
          effect: "permit",
          priority: 100,
          subjects: [],
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        }),
      );
      await pap.set(
        createPolicy({
          id: "policy-2",
          name: "Second Policy",
          effect: "deny",
          priority: 50,
          subjects: [{ role: "guest" }],
          resources: [{ path: "/admin/*" }],
          actions: [{ method: "*" }],
        }),
      );

      const context = createContext();
      const req = new Request("http://localhost/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context),
      });
      const res = await api.request(req);

      expect(res.status).toBe(200);
      const data = await res.json();

      // Check context is returned
      expect(data.context).toBeDefined();
      expect(data.context.subject.id).toBe("user-123");

      // Check decision is returned
      expect(data.decision).toBeDefined();
      expect(data.decision.effect).toBe("permit");

      // Check policies summary is returned
      expect(data.policies).toHaveLength(2);
      expect(data.policies[0]).toEqual({
        id: "policy-1",
        name: "First Policy",
        effect: "permit",
        priority: 100,
      });
    });

    it("should show all policies even if they do not match", async () => {
      await pap.set(
        createPolicy({
          id: "admin-policy",
          name: "Admin Only",
          effect: "permit",
          subjects: [{ role: "admin" }],
          resources: [{ path: "/admin/*" }],
          actions: [{ method: "*" }],
        }),
      );

      // Non-admin context accessing non-admin path
      const context = createContext({
        subject: { id: "user-1", roles: ["user"], groups: [], claims: {} },
        resource: { app: "main", path: "/public/data" },
      });
      const req = new Request("http://localhost/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context),
      });
      const res = await api.request(req);

      expect(res.status).toBe(200);
      const data = await res.json();

      // Policy is returned for debugging even though it didn't match
      expect(data.policies).toHaveLength(1);
      expect(data.policies[0].id).toBe("admin-policy");

      // Decision should be default deny
      expect(data.decision.effect).toBe("deny");
      expect(data.decision.reason).toBe("No applicable policy");
    });
  });

  describe("error handling", () => {
    it("should handle JSON parse errors gracefully", async () => {
      const req = new Request("http://localhost/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json",
      });
      const res = await api.request(req);

      // Should return error response from onError handler
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("should handle evaluate with invalid context structure", async () => {
      const req = new Request("http://localhost/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invalid: "context" }),
      });
      const res = await api.request(req);

      // The PDP will still try to evaluate, it might return an error or default deny
      expect(res.status).toBe(200); // Evaluate returns a decision, not an error
    });
  });

  describe("real-world API scenarios", () => {
    it("should support full CRUD workflow", async () => {
      // 1. List empty policies
      let res = await api.request(new Request("http://localhost/api/policies"));
      let data = await res.json();
      expect(data).toEqual([]);

      // 2. Create a policy
      const policy: Policy = {
        id: "workflow-policy",
        name: "Workflow Test",
        effect: "permit",
        subjects: [{ role: "admin" }],
        resources: [{ path: "/api/*" }],
        actions: [{ method: "GET" }, { method: "POST" }],
      };

      res = await api.request(
        new Request("http://localhost/api/policies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(policy),
        }),
      );
      expect(res.status).toBe(201);

      // 3. Get the created policy
      res = await api.request(new Request("http://localhost/api/policies/workflow-policy"));
      data = await res.json();
      expect(data.name).toBe("Workflow Test");

      // 4. Update the policy
      const updatedPolicy = { ...policy, name: "Updated Workflow" };
      res = await api.request(
        new Request("http://localhost/api/policies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updatedPolicy),
        }),
      );
      expect(res.status).toBe(201);

      // 5. Verify update
      res = await api.request(new Request("http://localhost/api/policies/workflow-policy"));
      data = await res.json();
      expect(data.name).toBe("Updated Workflow");

      // 6. Evaluate against the policy
      const context = createContext({
        subject: { id: "admin-1", roles: ["admin"], groups: [], claims: {} },
        resource: { app: "main", path: "/api/users" },
        action: { method: "GET" },
      });
      res = await api.request(
        new Request("http://localhost/api/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(context),
        }),
      );
      data = await res.json();
      expect(data.effect).toBe("permit");

      // 7. Delete the policy
      res = await api.request(
        new Request("http://localhost/api/policies/workflow-policy", {
          method: "DELETE",
        }),
      );
      expect(res.status).toBe(200);

      // 8. Verify deletion
      res = await api.request(new Request("http://localhost/api/policies/workflow-policy"));
      expect(res.status).toBe(404);
    });

    it("should handle multiple policies with different priorities", async () => {
      // Add policies with different priorities
      await pap.set(
        createPolicy({
          id: "low-priority",
          effect: "deny",
          priority: 10,
          subjects: [],
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        }),
      );
      await pap.set(
        createPolicy({
          id: "high-priority",
          effect: "permit",
          priority: 100,
          subjects: [],
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        }),
      );

      // Reinitialize PDP with first-applicable algorithm
      pdp = new PolicyDecisionPoint("first-applicable", "deny");
      initApi(pap, pdp);

      const context = createContext();
      const req = new Request("http://localhost/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context),
      });
      const res = await api.request(req);
      const data = await res.json();

      // High priority permit should win with first-applicable
      expect(data.effect).toBe("permit");
      expect(data.matchedPolicy).toBe("high-priority");
    });
  });
});
