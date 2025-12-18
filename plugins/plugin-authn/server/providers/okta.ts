import { genericOAuth } from "better-auth/plugins";
import type { AuthProvider, OktaProviderConfig, ProviderInfo } from "./types";

export class OktaProvider implements AuthProvider {
  constructor(private config: OktaProviderConfig) {}

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
