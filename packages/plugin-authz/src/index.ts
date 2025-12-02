import type { BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { Hono } from "hono";
import { PolicyAdministrationPoint } from "./pap";
import { PolicyDecisionPoint } from "./pdp";
import type { CombiningAlgorithm, Effect, EvaluationContext, Policy } from "./types";

export interface AuthzConfig {
  /**
   * Policy combining algorithm
   * @default "deny-overrides"
   */
  combiningAlgorithm?: CombiningAlgorithm;

  /**
   * Default effect when no policy matches
   * @default "deny"
   */
  defaultEffect?: Effect;

  /**
   * Policy store type
   * @default "memory"
   */
  store?: "memory" | "file";

  /**
   * File path for file-based store
   * @example "./policies.json"
   */
  path?: string;

  /**
   * Inline policies (loaded at startup)
   */
  policies?: Policy[];

  /**
   * Paths that skip authorization (regex patterns)
   * @example ["/health", "/public/.*"]
   */
  excludePaths?: string[];
}

interface Identity {
  sub: string;
  roles: string[];
  groups: string[];
  claims: Record<string, unknown>;
}

let pap: PolicyAdministrationPoint;
let pdp: PolicyDecisionPoint;
let config: AuthzConfig;
let excludePatterns: RegExp[] = [];
let logger: PluginContext["logger"];

function isExcluded(pathname: string): boolean {
  return excludePatterns.some((p) => p.test(pathname));
}

function buildContext(
  req: Request,
  identity: Identity | null,
  app: { name: string },
): EvaluationContext {
  const url = new URL(req.url);

  return {
    subject: {
      id: identity?.sub ?? "anonymous",
      roles: identity?.roles ?? [],
      groups: identity?.groups ?? [],
      claims: identity?.claims ?? {},
    },
    resource: {
      app: app.name,
      path: url.pathname,
    },
    action: {
      method: req.method,
    },
    environment: {
      ip: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown",
      time: new Date(),
      userAgent: req.headers.get("user-agent") ?? undefined,
    },
  };
}

const routes = new Hono()
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
  });

/**
 * Authorization plugin for Buntime (XACML-like)
 *
 * Implements:
 * - PEP (Policy Enforcement Point): Intercepts requests and applies decisions
 * - PDP (Policy Decision Point): Evaluates policies and returns PERMIT/DENY
 * - PAP (Policy Administration Point): CRUD for policies
 *
 * Requires @buntime/plugin-authn to be loaded first (for identity extraction).
 *
 * @example
 * ```typescript
 * // buntime.config.ts
 * export default {
 *   plugins: [
 *     ["@buntime/plugin-authn", { ... }],
 *     ["@buntime/plugin-authz", {
 *       store: "file",
 *       path: "./policies.json",
 *       policies: [
 *         {
 *           id: "admin-all",
 *           effect: "permit",
 *           subjects: [{ role: "admin" }],
 *           resources: [{ path: "*" }],
 *           actions: [{ method: "*" }],
 *         },
 *       ],
 *     }],
 *   ],
 * }
 * ```
 */
export default function authzPlugin(pluginConfig: AuthzConfig = {}): BuntimePlugin {
  config = pluginConfig;

  return {
    name: "@buntime/plugin-authz",
    version: "1.0.0",
    dependencies: ["@buntime/plugin-authn"],
    priority: 20, // Run after authn

    async onInit(ctx: PluginContext) {
      logger = ctx.logger;

      // Initialize PAP
      pap = new PolicyAdministrationPoint(config.store ?? "memory", config.path);
      await pap.load();

      // Load inline policies
      if (config.policies) {
        pap.loadFromArray(config.policies);
      }

      // Initialize PDP
      pdp = new PolicyDecisionPoint(
        config.combiningAlgorithm ?? "deny-overrides",
        config.defaultEffect ?? "deny",
      );

      // Compile exclude patterns
      excludePatterns = (config.excludePaths ?? []).map((p) => new RegExp(p));

      const policyCount = pap.getAll().length;
      logger.info(
        `Authorization initialized (${policyCount} policies, algorithm: ${config.combiningAlgorithm ?? "deny-overrides"})`,
      );
    },

    async onRequest(req, app) {
      const url = new URL(req.url);

      // Skip excluded paths
      if (isExcluded(url.pathname)) {
        return;
      }

      // Extract identity from header (injected by authn plugin)
      let identity: Identity | null = null;
      const identityHeader = req.headers.get("X-Identity");

      if (identityHeader) {
        try {
          identity = JSON.parse(identityHeader);
        } catch {
          logger.warn("Failed to parse X-Identity header");
        }
      }

      // Skip if no identity and no policies require anonymous
      const policies = pap.getAll();
      if (!identity && policies.length === 0) {
        return;
      }

      // Build evaluation context
      const context = buildContext(req, identity, app);

      // Evaluate policies (PDP)
      const decision = pdp.evaluate(context, policies);

      logger.debug(
        `Authorization: ${decision.effect} for ${context.subject.id} on ${context.resource.path} (${decision.matchedPolicy ?? "no match"})`,
      );

      // Apply decision (PEP)
      if (decision.effect === "deny") {
        return new Response(
          JSON.stringify({
            error: "Forbidden",
            reason: decision.reason,
            policy: decision.matchedPolicy,
          }),
          {
            status: 403,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // permit or not_applicable: continue
      return;
    },

    routes,
  };
}

// Named exports
export { authzPlugin };
export { PolicyAdministrationPoint } from "./pap";
export { PolicyDecisionPoint } from "./pdp";
export type {
  ActionMatch,
  CombiningAlgorithm,
  Condition,
  Decision,
  Effect,
  EvaluationContext,
  Policy,
  ResourceMatch,
  SubjectMatch,
} from "./types";
