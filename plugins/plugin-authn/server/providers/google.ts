import type { AuthProvider, GoogleProviderConfig, ProviderInfo } from "./types";

export class GoogleProvider implements AuthProvider {
  constructor(private config: GoogleProviderConfig) {}

  getBetterAuthConfig() {
    const { clientId, clientSecret, hd, prompt, accessType } = this.config;

    return {
      socialProviders: {
        google: {
          clientId,
          clientSecret,
          ...(hd && { hd }),
          ...(prompt && { prompt }),
          ...(accessType && { accessType }),
        },
      },
    };
  }

  getProviderInfo(): ProviderInfo {
    return {
      displayName: this.config.displayName ?? "Google",
      icon: this.config.icon ?? "simple-icons:google",
      providerId: "google",
      type: "google",
    };
  }
}
