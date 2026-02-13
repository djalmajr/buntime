import { Auth0Provider } from "./auth0";
import { EmailPasswordProvider } from "./email-password";
import { GenericOIDCProvider } from "./generic-oidc";
import { GoogleProvider } from "./google";
import { KeycloakProvider } from "./keycloak";
import { OktaProvider } from "./okta";
import type { AuthProvider, ProviderConfig, ProviderInfo } from "./types";

export type { AuthProvider, ProviderConfig, ProviderInfo };
export type {
  Auth0ProviderConfig,
  AuthProviderType,
  BaseOAuthProviderConfig,
  EmailPasswordProviderConfig,
  GenericOIDCProviderConfig,
  GoogleProviderConfig,
  KeycloakProviderConfig,
  OktaProviderConfig,
} from "./types";

/**
 * Create an auth provider from config
 */
export function createProvider(config: ProviderConfig): AuthProvider {
  switch (config.type) {
    case "email-password":
      return new EmailPasswordProvider(config);
    case "keycloak":
      return new KeycloakProvider(config);
    case "auth0":
      return new Auth0Provider(config);
    case "okta":
      return new OktaProvider(config);
    case "generic-oidc":
      return new GenericOIDCProvider(config);
    case "google":
      return new GoogleProvider(config);
    default:
      throw new Error(`Unknown provider type: ${(config as ProviderConfig).type}`);
  }
}

/**
 * Create multiple providers from config array
 */
export function createProviders(configs: ProviderConfig[]): AuthProvider[] {
  return configs.map(createProvider);
}

/**
 * Merge better-auth configs from multiple providers
 */
export function mergeBetterAuthConfigs(providers: AuthProvider[]): {
  emailAndPassword?: {
    enabled: boolean;
    allowSignUp?: boolean;
    requireEmailVerification?: boolean;
  };
  plugins: unknown[];
  socialProviders: Record<string, unknown>;
} {
  const result: {
    emailAndPassword?: {
      enabled: boolean;
      allowSignUp?: boolean;
      requireEmailVerification?: boolean;
    };
    plugins: unknown[];
    socialProviders: Record<string, unknown>;
  } = {
    plugins: [],
    socialProviders: {},
  };

  for (const provider of providers) {
    const config = provider.getBetterAuthConfig();

    // Merge emailAndPassword config
    if (config.emailAndPassword?.enabled) {
      result.emailAndPassword = {
        ...result.emailAndPassword,
        ...config.emailAndPassword,
      };
    }

    // Merge plugins
    if (config.plugins) {
      result.plugins.push(...config.plugins);
    }

    // Merge social providers
    if (config.socialProviders) {
      Object.assign(result.socialProviders, config.socialProviders);
    }
  }

  // If no email-password provider, disable it
  if (!result.emailAndPassword) {
    result.emailAndPassword = { enabled: false };
  }

  return result;
}

/**
 * Get provider info for all providers
 */
export function getProvidersInfo(providers: AuthProvider[]): ProviderInfo[] {
  return providers.map((p) => p.getProviderInfo());
}
