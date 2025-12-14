import type { BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { initApi } from "./server/api";
import { PolicyAdministrationPoint } from "./server/pap";
import { PolicyDecisionPoint } from "./server/pdp";
import type { CombiningAlgorithm, Effect, EvaluationContext, Policy } from "./server/types";

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
  app?: { name: string },
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
      app: app?.name ?? "",
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

/**
 * Authorization plugin for Buntime (XACML-like)
 *
 * Implements:
 * - PEP (Policy Enforcement Point): Intercepts requests and applies decisions
 * - PDP (Policy Decision Point): Evaluates policies and returns PERMIT/DENY
 * - PAP (Policy Administration Point): CRUD for policies
 *
 * Requires @buntime/authn to be loaded first (for identity extraction).
 *
 * @example
 * ```typescript
 * // buntime.config.ts
 * export default {
 *   plugins: [
 *     ["@buntime/authn", { ... }],
 *     ["@buntime/authz", {
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
    dependencies: ["@buntime/plugin-authn"], // Requires authn to be configured

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

      // Initialize API
      initApi(pap, pdp);

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
  };
}

// Named exports
export { authzPlugin };
export type { AuthzRoutesType } from "./server/api";
export { PolicyAdministrationPoint } from "./server/pap";
export { PolicyDecisionPoint } from "./server/pdp";
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
} from "./server/types";
