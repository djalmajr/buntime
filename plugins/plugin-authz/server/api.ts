import { errorToResponse } from "@buntime/shared/errors";
import type { MiddlewareHandler } from "hono";
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

export interface CreateAuthzApiOptions {
  /**
   * Auth middleware applied to every admin route. Plugin.ts injects
   * `createApiKeyMiddleware` from `@buntime/shared/middleware/api-key`.
   */
  middleware?: MiddlewareHandler;
}

/**
 * Build the authz admin router.
 *
 * Routes are mounted at `/<base>/admin/**` (e.g. `/authz/admin/policies`).
 * Listed under `publicRoutes` in the manifest so `plugin-authn` does not
 * intercept them — the middleware passed here is the only gate.
 *
 * The `evaluate` / `explain` endpoints accept the full `EvaluationContext`
 * in the body (including subject), so they do not depend on `X-Identity`
 * injected by `plugin-authn`. The PEP hook in `plugin.ts.onRequest` still
 * uses `X-Identity` for live request authorization — that path is unrelated
 * to the admin API.
 */
export function createApi(options: CreateAuthzApiOptions = {}) {
  const app = new Hono().basePath("/admin");
  if (options.middleware) {
    app.use("*", options.middleware);
  }
  return (
    app
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
        if (
          !policy.id ||
          !policy.effect ||
          !policy.subjects ||
          !policy.resources ||
          !policy.actions
        ) {
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
      })
  );
}

/**
 * Backward-compat default router (no auth middleware). Tests import this
 * directly; production code uses `createApi({ middleware })` in `plugin.ts`.
 */
export const api = createApi();

export type AuthzRoutesType = ReturnType<typeof createApi>;
