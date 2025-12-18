import type { AuthzService, Policy } from "@buntime/plugin-authz";
import type { BuntimePlugin, PluginContext } from "@buntime/shared/types";

/**
 * Policy seed configuration for cpanel
 */
export interface CpanelPolicySeedConfig {
  /**
   * Enable policy seeding
   * @default true
   */
  enabled?: boolean;

  /**
   * Only seed if policies with "cpanel-" prefix don't exist
   * @default true
   */
  onlyIfEmpty?: boolean;

  /**
   * Policies to seed
   */
  policies?: Policy[];
}

export interface CpanelConfig {
  /**
   * Policy seed configuration
   * Seeds cpanel-specific policies via plugin-authz service
   */
  policySeed?: CpanelPolicySeedConfig;
}

/**
 * Default cpanel policies
 *
 * Note: We only define permit policies. Users without matching roles
 * will be denied by the authz plugin's default effect (deny).
 * This avoids issues with deny-overrides algorithm where a catch-all
 * deny policy would override specific permits.
 */
const defaultPolicies: Policy[] = [
  {
    id: "cpanel-admin-access",
    name: "CPanel Admin Full Access",
    description: "Allow admin role full access to cpanel",
    effect: "permit",
    priority: 100,
    subjects: [{ role: "admin" }],
    resources: [{ path: "/cpanel/**" }],
    actions: [{ method: "*" }],
  },
  {
    id: "cpanel-viewer-readonly",
    name: "CPanel Viewer Read-Only",
    description: "Allow viewer role read-only access to cpanel",
    effect: "permit",
    priority: 90,
    subjects: [{ role: "viewer" }],
    resources: [{ path: "/cpanel/**" }],
    actions: [{ method: "GET" }],
  },
];

/**
 * CPanel plugin for Buntime
 *
 * The admin dashboard/shell for managing Buntime applications.
 * Orchestrates micro-frontends via piercing fragments.
 *
 * Features:
 * - Admin dashboard UI
 * - Micro-frontend shell (piercing)
 * - Policy seeding via plugin-authz
 *
 * @example
 * ```jsonc
 * // buntime.jsonc
 * {
 *   "plugins": [
 *     "@buntime/plugin-authn",
 *     "@buntime/plugin-authz",
 *     ["@buntime/plugin-cpanel", {
 *       "policySeed": {
 *         "enabled": true,
 *         "policies": [
 *           {
 *             "id": "cpanel-custom-policy",
 *             "effect": "permit",
 *             "subjects": [{ "role": "custom-role" }],
 *             "resources": [{ "path": "/cpanel/**" }],
 *             "actions": [{ "method": "GET" }]
 *           }
 *         ]
 *       }
 *     }]
 *   ]
 * }
 * ```
 */
export default function cpanelPlugin(config: CpanelConfig = {}): BuntimePlugin {
  return {
    name: "@buntime/plugin-cpanel",
    base: "/cpanel",
    dependencies: ["@buntime/plugin-authn"],
    optionalDependencies: ["@buntime/plugin-authz"],

    // Static assets should not require authorization
    publicRoutes: {
      GET: ["/cpanel/*.js", "/cpanel/*.css", "/cpanel/*.woff2", "/cpanel/*.png", "/cpanel/*.svg"],
    },

    // CPanel is the shell, not a fragment
    // It hosts other plugins as fragments
    fragment: undefined,

    // CPanel doesn't appear in its own menu
    menus: [],

    async onInit(ctx: PluginContext) {
      // Seed cpanel policies via authz service
      const authz = ctx.getService<AuthzService>("authz");

      if (authz && config.policySeed?.enabled !== false) {
        const policies = config.policySeed?.policies ?? defaultPolicies;

        if (policies.length > 0) {
          // Check if cpanel policies already exist
          const pap = authz.getPap();
          const existingPolicies = pap.getAll();
          const hasCpanelPolicies = existingPolicies.some((p) => p.id.startsWith("cpanel-"));

          if (config.policySeed?.onlyIfEmpty !== false && hasCpanelPolicies) {
            ctx.logger.debug("CPanel policy seed skipped - policies already exist");
          } else {
            const count = await authz.seedPolicies(policies, { onlyIfEmpty: false });
            if (count > 0) {
              ctx.logger.info(`CPanel: ${count} policies seeded`);
            }
          }
        }
      }

      ctx.logger.info("CPanel initialized");
    },
  };
}

// Named exports
export { cpanelPlugin };
