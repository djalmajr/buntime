import type { AuthProvider, EmailPasswordProviderConfig, ProviderInfo } from "./types";

export class EmailPasswordProvider implements AuthProvider {
  constructor(private config: EmailPasswordProviderConfig) {}

  getBetterAuthConfig() {
    return {
      emailAndPassword: {
        allowSignUp: this.config.allowSignUp ?? true,
        enabled: true,
        requireEmailVerification: this.config.requireEmailVerification ?? false,
      },
    };
  }

  getProviderInfo(): ProviderInfo {
    return {
      displayName: this.config.displayName ?? "Email",
      icon: this.config.icon ?? "lucide:mail",
      providerId: "email-password",
      type: "email-password",
    };
  }
}
