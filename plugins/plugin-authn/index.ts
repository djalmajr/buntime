import type { BuntimePlugin } from "@buntime/shared/types";
import { type AuthnConfig, createPluginDefinition } from "./plugin";

/**
 * Authentication plugin for Buntime
 *
 * Uses better-auth with Keycloak for session-based authentication.
 * Serves a login page at /login and handles OAuth at /api/auth/*.
 *
 * @example
 * ```typescript
 * // buntime.jsonc
 * {
 *   "plugins": [
 *     ["@buntime/plugin-authn", {
 *       "issuer": "${KEYCLOAK_URL}",
 *       "realm": "${KEYCLOAK_REALM}",
 *       "clientId": "${KEYCLOAK_CLIENT_ID}",
 *       "clientSecret": "${KEYCLOAK_CLIENT_SECRET}"
 *     }]
 *   ]
 * }
 * ```
 */
export default function authnPlugin(config: AuthnConfig = {}): BuntimePlugin {
  return createPluginDefinition(config);
}

// Named exports
export { authnPlugin };
export type { AuthnConfig } from "./plugin";
