import { genericOAuth } from "better-auth/plugins";
import type { AuthProvider, GenericOIDCProviderConfig, ProviderInfo } from "./types";

export class GenericOIDCProvider implements AuthProvider {
  private discoveryCache: Record<string, unknown> | null = null;

  constructor(private config: GenericOIDCProviderConfig) {}

  private async getDiscoveryDocument(): Promise<Record<string, unknown>> {
    if (this.discoveryCache) return this.discoveryCache;

    const issuerUrl = this.config.issuer.replace(/\/$/, "");
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

  private getProviderId(): string {
    // Generate a provider ID from the issuer URL
    try {
      const url = new URL(this.config.issuer);
      return url.hostname.replace(/\./g, "-");
    } catch {
      return "oidc";
    }
  }

  getBetterAuthConfig() {
    const clientId = this.config.clientId;
    const clientSecret = this.config.clientSecret;
    const issuer = this.config.issuer.replace(/\/$/, "");
    const providerId = this.getProviderId();

    return {
      emailAndPassword: { enabled: false },
      plugins: [
        genericOAuth({
          config: [
            {
              authorizationUrl: this.config.authorizationEndpoint,
              clientId,
              clientSecret,
              discoveryUrl: `${issuer}/.well-known/openid-configuration`,
              providerId,
              scopes: ["openid", "profile", "email"],
              tokenUrl: this.config.tokenEndpoint,
              userInfoUrl: this.config.userinfoEndpoint,
            },
          ],
        }),
      ],
    };
  }

  getProviderInfo(): ProviderInfo {
    return {
      displayName: this.config.displayName ?? "SSO",
      icon: this.config.icon ?? "lucide:key-round",
      providerId: this.getProviderId(),
      type: "generic-oidc",
    };
  }
}
