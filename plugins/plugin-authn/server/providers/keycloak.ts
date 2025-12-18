import { genericOAuth } from "better-auth/plugins";
import type { AuthProvider, KeycloakProviderConfig, ProviderInfo } from "./types";

/**
 * Keycloak token structure for roles
 */
interface KeycloakRoles {
  realm_access?: {
    roles?: string[];
  };
  resource_access?: Record<string, { roles?: string[] }>;
}

/**
 * Extract roles from Keycloak token
 * Combines realm roles and client-specific roles
 */
function extractKeycloakRoles(profile: KeycloakRoles, clientId?: string): string[] {
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

export class KeycloakProvider implements AuthProvider {
  constructor(private config: KeycloakProviderConfig) {}

  private getIssuerUrl(): string {
    const baseUrl = this.config.issuer.replace(/\/$/, "");
    return `${baseUrl}/realms/${this.config.realm}`;
  }

  getBetterAuthConfig() {
    const clientId = this.config.clientId;
    const issuerUrl = this.getIssuerUrl();

    return {
      emailAndPassword: { enabled: false },
      plugins: [
        genericOAuth({
          config: [
            {
              providerId: "keycloak",
              clientId,
              clientSecret: this.config.clientSecret,
              discoveryUrl: `${issuerUrl}/.well-known/openid-configuration`,
              // Keycloak requires openid scope - add profile and email for user info
              scopes: ["openid", "profile", "email"],
              // Update user info on every login (sync roles from Keycloak)
              overrideUserInfo: true,
              // Map Keycloak profile to user, extracting roles
              mapProfileToUser: (profile: Record<string, unknown>) => {
                const roles = extractKeycloakRoles(profile as KeycloakRoles, clientId);
                return {
                  email: profile.email as string,
                  emailVerified: profile.email_verified as boolean,
                  image: profile.picture as string | undefined,
                  name: profile.name as string,
                  // Store roles as JSON string in a custom field
                  roles: JSON.stringify(roles),
                };
              },
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
