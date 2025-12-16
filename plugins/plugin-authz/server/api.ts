import { errorToResponse } from "@buntime/shared/errors";
import { Hono } from "hono";
import type { EvaluationContext, Policy } from "./types";

let pap: import("./pap").PolicyAdministrationPoint;
let pdp: import("./pdp").PolicyDecisionPoint;

export function initApi(
  papInstance: import("./pap").PolicyAdministrationPoint,
  pdpInstance: import("./pdp").PolicyDecisionPoint,
) {
  pap = papInstance;
  pdp = pdpInstance;
}

export const api = new Hono()
  .basePath("/api")
  // List all policies
  .get("/policies", (ctx) => {
    return ctx.json(pap.getAll());
  })
  // Get single policy
  .get("/policies/:id", (ctx) => {
    const policy = pap.get(ctx.req.param("id"));
    if (!policy) {
      return ctx.json({ error: "Policy not found" }, 404);
    }
    return ctx.json(policy);
  })
  // Create/update policy
  .post("/policies", async (ctx) => {
    const policy = await ctx.req.json<Policy>();
    if (!policy.id || !policy.effect || !policy.subjects || !policy.resources || !policy.actions) {
      return ctx.json({ error: "Invalid policy structure" }, 400);
    }
    await pap.set(policy);
    return ctx.json(policy, 201);
  })
  // Delete policy
  .delete("/policies/:id", async (ctx) => {
    const deleted = await pap.delete(ctx.req.param("id"));
    if (!deleted) {
      return ctx.json({ error: "Policy not found" }, 404);
    }
    return ctx.json({ success: true });
  })
  // Evaluate context manually
  .post("/evaluate", async (ctx) => {
    const context = await ctx.req.json<EvaluationContext>();
    const decision = pdp.evaluate(context, pap.getAll());
    return ctx.json(decision);
  })
  // Explain decision for debugging
  .post("/explain", async (ctx) => {
    const context = await ctx.req.json<EvaluationContext>();
    const policies = pap.getAll();
    const decision = pdp.evaluate(context, policies);

    return ctx.json({
      context,
      decision,
      policies: policies.map((p) => ({
        id: p.id,
        name: p.name,
        effect: p.effect,
        priority: p.priority,
      })),
    });
  })
  .onError((err) => {
    console.error("[AuthZ] Error:", err);
    return errorToResponse(err);
  });

export type AuthzRoutesType = typeof api;
