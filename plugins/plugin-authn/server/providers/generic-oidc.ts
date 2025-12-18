import { genericOAuth } from "better-auth/plugins";
import type { AuthProvider, GenericOIDCProviderConfig, ProviderInfo } from "./types";

export class GenericOIDCProvider implements AuthProvider {
  constructor(private config: GenericOIDCProviderConfig) {}

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
    const providerId = this.getProviderId();

    return {
      emailAndPassword: { enabled: false },
      plugins: [
        genericOAuth({
          config: [
            {
              authorizationUrl: this.config.authorizationEndpoint,
              clientId: this.config.clientId,
              clientSecret: this.config.clientSecret,
              discoveryUrl: `${this.config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
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
