import { genericOAuth } from "better-auth/plugins";
import type { AuthProvider, OktaProviderConfig, ProviderInfo } from "./types";

export class OktaProvider implements AuthProvider {
  private discoveryCache: Record<string, unknown> | null = null;

  constructor(private config: OktaProviderConfig) {}

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
              providerId: "okta",
              scopes: ["openid", "profile", "email"],
            },
          ],
        }),
      ],
    };
  }

  getProviderInfo(): ProviderInfo {
    return {
      displayName: this.config.displayName ?? "Okta",
      icon: this.config.icon ?? "simple-icons:okta",
      providerId: "okta",
      type: "okta",
    };
  }
}
