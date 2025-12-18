import { genericOAuth } from "better-auth/plugins";
import type { Auth0ProviderConfig, AuthProvider, ProviderInfo } from "./types";

export class Auth0Provider implements AuthProvider {
  constructor(private config: Auth0ProviderConfig) {}

  private getIssuerUrl(): string {
    const domain = this.config.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${domain}`;
  }

  getBetterAuthConfig() {
    const issuer = this.getIssuerUrl();

    return {
      emailAndPassword: { enabled: false },
      plugins: [
        genericOAuth({
          config: [
            {
              clientId: this.config.clientId,
              clientSecret: this.config.clientSecret,
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
