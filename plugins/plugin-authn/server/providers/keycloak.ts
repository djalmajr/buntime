import { genericOAuth } from "better-auth/plugins";
import type { AuthProvider, KeycloakProviderConfig, ProviderInfo } from "./types";

/**
 * Keycloak token structure for roles
 */
export interface KeycloakRoles {
  realm_access?: {
    roles?: string[];
  };
  resource_access?: Record<string, { roles?: string[] }>;
}

/**
 * Extract roles from Keycloak token
 * Combines realm roles and client-specific roles
 */
export function extractKeycloakRoles(profile: KeycloakRoles, clientId?: string): string[] {
  const roles: string[] = [];

  // Realm-level roles
  if (profile.realm_access?.roles) {
    roles.push(...profile.realm_access.roles);
  }

  // Client-specific roles (if clientId is provided)
  if (clientId && profile.resource_access?.[clientId]?.roles) {
    roles.push(...profile.resource_access[clientId].roles);
  }

  return [...new Set(roles)]; // Remove duplicates
}

/**
 * Map Keycloak profile to user object
 * Used as mapProfileToUser callback for better-auth
 */
export function mapKeycloakProfileToUser(
  profile: Record<string, unknown>,
  clientId: string,
): {
  email: string;
  emailVerified: boolean;
  image: string | undefined;
  name: string;
  roles: string;
} {
  const roles = extractKeycloakRoles(profile as KeycloakRoles, clientId);
  return {
    email: profile.email as string,
    emailVerified: profile.email_verified as boolean,
    image: profile.picture as string | undefined,
    name: profile.name as string,
    roles: JSON.stringify(roles),
  };
}

export class KeycloakProvider implements AuthProvider {
  private discoveryCache: Record<string, unknown> | null = null;

  constructor(private config: KeycloakProviderConfig) {}

  private getIssuerUrl(): string {
    const baseUrl = this.config.issuer.replace(/\/$/, "");
    return `${baseUrl}/realms/${this.config.realm}`;
  }

  private async getDiscoveryDocument(): Promise<Record<string, unknown>> {
    if (this.discoveryCache) return this.discoveryCache;

    const issuerUrl = this.getIssuerUrl();
    const res = await fetch(`${issuerUrl}/.well-known/openid-configuration`);
    if (!res.ok) throw new Error(`Failed to fetch OIDC discovery: ${res.status}`);

    const doc = (await res.json()) as Record<string, unknown>;
    this.discoveryCache = doc;
    return doc;
  }

  async getLogoutUrl(idToken: string, postLogoutRedirectUri: string): Promise<string | null> {
    try {
      const discovery = await this.getDiscoveryDocument();
      const endSessionEndpoint = discovery.end_session_endpoint as string;

      if (!endSessionEndpoint) return null;

      const params = new URLSearchParams({
        id_token_hint: idToken,
        post_logout_redirect_uri: postLogoutRedirectUri,
      });

      return `${endSessionEndpoint}?${params.toString()}`;
    } catch {
      return null;
    }
  }

  getBetterAuthConfig() {
    const clientId = this.config.clientId;
    const clientSecret = this.config.clientSecret;
    const issuerUrl = this.getIssuerUrl();

    return {
      emailAndPassword: { enabled: false },
      plugins: [
        genericOAuth({
          config: [
            {
              providerId: "keycloak",
              clientId,
              clientSecret,
              discoveryUrl: `${issuerUrl}/.well-known/openid-configuration`,
              // Keycloak requires openid scope - add profile and email for user info
              scopes: ["openid", "profile", "email"],
              // Update user info on every login (sync roles from Keycloak)
              overrideUserInfo: true,
              // Map Keycloak profile to user, extracting roles
              mapProfileToUser: (profile) => mapKeycloakProfileToUser(profile, clientId),
            },
          ],
        }),
      ],
    };
  }

  getProviderInfo(): ProviderInfo {
    return {
      displayName: this.config.displayName ?? "Keycloak",
      icon: this.config.icon ?? "simple-icons:keycloak",
      providerId: "keycloak",
      type: "keycloak",
    };
  }
}
