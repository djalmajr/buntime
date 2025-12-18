import type { BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { initApi } from "./server/api";
import { PolicyAdministrationPoint } from "./server/pap";
import { PolicyDecisionPoint } from "./server/pdp";
import type { CombiningAlgorithm, Effect, EvaluationContext, Policy } from "./server/types";

/**
 * Policy seed configuration for initial policy provisioning
 */
export interface PolicySeedConfig {
  /**
   * Enable policy seeding
   * @default true
   */
  enabled?: boolean;

  /**
   * Only seed if no policies exist
   * @default true
   */
  onlyIfEmpty?: boolean;

  /**
   * Environments where seeding is allowed
   * Use "*" for all environments
   * @default ["*"]
   */
  environments?: string[];

  /**
   * Path to JSON file containing policies
   * File format: { "policies": Policy[] } or Policy[]
   */
  file?: string;

  /**
   * Inline policies to seed
   */
  policies?: Policy[];
}

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
   * @deprecated Use policySeed.policies instead
   */
  policies?: Policy[];

  /**
   * Paths that skip authorization (regex patterns)
   * @example ["/health", "/public/.*"]
   */
  excludePaths?: string[];

  /**
   * Policy seed configuration
   * Seeds policies at startup based on environment and conditions
   */
  policySeed?: PolicySeedConfig;
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

/**
 * Run policy seeding based on configuration
 */
async function runPolicySeed(seedConfig: PolicySeedConfig | undefined): Promise<number> {
  if (!seedConfig) return 0;
  if (seedConfig.enabled === false) return 0;

  // Check environment
  const env = Bun.env.NODE_ENV || "development";
  const allowedEnvs = seedConfig.environments || ["*"];
  if (!allowedEnvs.includes("*") && !allowedEnvs.includes(env)) {
    logger.debug(`Policy seed skipped - env "${env}" not in allowed environments`);
    return 0;
  }

  // Check if policies already exist
  if (seedConfig.onlyIfEmpty !== false && pap.getAll().length > 0) {
    logger.debug("Policy seed skipped - policies already exist");
    return 0;
  }

  // Load policies from file or inline config
  let policies: Policy[] = [];

  if (seedConfig.file) {
    try {
      const file = Bun.file(seedConfig.file);
      if (await file.exists()) {
        const data = await file.json();
        policies = Array.isArray(data) ? data : (data.policies ?? []);
      } else {
        logger.warn(`Policy seed file not found: ${seedConfig.file}`);
      }
    } catch (err) {
      logger.error(`Failed to load policy seed file: ${seedConfig.file}`, err);
    }
  }

  // Add inline policies (merged with file policies)
  if (seedConfig.policies?.length) {
    policies = [...policies, ...seedConfig.policies];
  }

  if (policies.length === 0) {
    return 0;
  }

  // Apply policies
  for (const policy of policies) {
    await pap.set(policy);
  }

  logger.info(`Policy seed: ${policies.length} policies applied`);
  return policies.length;
}

/**
 * Service for other plugins to seed policies programmatically
 */
export interface AuthzService {
  /**
   * Seed policies programmatically
   * Useful for plugins that need to register their own policies
   */
  seedPolicies(policies: Policy[], options?: { onlyIfEmpty?: boolean }): Promise<number>;

  /**
   * Get the Policy Administration Point instance
   */
  getPap(): PolicyAdministrationPoint;

  /**
   * Get the Policy Decision Point instance
   */
  getPdp(): PolicyDecisionPoint;
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
    base: "/authz",
    dependencies: ["@buntime/plugin-authn"], // Requires authn to be configured

    fragment: {
      type: "patch",
    },

    menus: [
      {
        icon: "lucide:shield-check",
        path: "/authz",
        priority: 70,
        title: "Authorization",
        items: [
          { icon: "lucide:file-text", path: "/authz/policies", title: "Policies" },
          { icon: "lucide:scale", path: "/authz/evaluate", title: "Evaluate" },
        ],
      },
    ],

    async onInit(ctx: PluginContext) {
      logger = ctx.logger;

      // Initialize PAP
      pap = new PolicyAdministrationPoint(config.store ?? "memory", config.path);
      await pap.load();

      // Load inline policies (deprecated, prefer policySeed)
      if (config.policies) {
        pap.loadFromArray(config.policies);
      }

      // Run policy seeding
      await runPolicySeed(config.policySeed);

      // Initialize PDP
      pdp = new PolicyDecisionPoint(
        config.combiningAlgorithm ?? "deny-overrides",
        config.defaultEffect ?? "deny",
      );

      // Initialize API
      initApi(pap, pdp);

      // Compile exclude patterns
      excludePatterns = (config.excludePaths ?? []).map((p) => new RegExp(p));

      // Register authz service for other plugins
      const authzService: AuthzService = {
        async seedPolicies(policies, options) {
          if (options?.onlyIfEmpty !== false && pap.getAll().length > 0) {
            logger.debug("seedPolicies skipped - policies already exist");
            return 0;
          }

          for (const policy of policies) {
            await pap.set(policy);
          }

          logger.info(`seedPolicies: ${policies.length} policies applied`);
          return policies.length;
        },
        getPap: () => pap,
        getPdp: () => pdp,
      };

      ctx.registerService("authz", authzService);

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
