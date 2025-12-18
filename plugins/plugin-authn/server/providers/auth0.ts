import { genericOAuth } from "better-auth/plugins";
import type { Auth0ProviderConfig, AuthProvider, ProviderInfo } from "./types";

export class Auth0Provider implements AuthProvider {
  private discoveryCache: Record<string, unknown> | null = null;

  constructor(private config: Auth0ProviderConfig) {}

  private getIssuerUrl(): string {
    const domain = this.config.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${domain}`;
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
        returnTo: postLogoutRedirectUri, // Auth0 uses 'returnTo' instead of 'post_logout_redirect_uri'
        client_id: this.config.clientId,
      });

      return `${endSessionEndpoint}?${params.toString()}`;
    } catch {
      return null;
    }
  }

  getBetterAuthConfig() {
    const clientId = this.config.clientId;
    const clientSecret = this.config.clientSecret;
    const issuer = this.getIssuerUrl();

    return {
      emailAndPassword: { enabled: false },
      plugins: [
        genericOAuth({
          config: [
            {
              clientId,
              clientSecret,
              discoveryUrl: `${issuer}/.well-known/openid-configuration`,
              providerId: "auth0",
              scopes: ["openid", "profile", "email"],
            },
          ],
        }),
      ],
    };
  }

  getProviderInfo(): ProviderInfo {
    return {
      displayName: this.config.displayName ?? "Auth0",
      icon: this.config.icon ?? "simple-icons:auth0",
      providerId: "auth0",
      type: "auth0",
    };
  }
}
