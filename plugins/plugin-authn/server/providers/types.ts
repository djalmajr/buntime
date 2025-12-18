/**
 * Auth provider types supported by plugin-authn
 */
export type AuthProviderType = "email-password" | "keycloak" | "auth0" | "okta" | "generic-oidc";

/**
 * Base config for OAuth providers
 */
export interface BaseOAuthProviderConfig {
  type: Exclude<AuthProviderType, "email-password">;
  clientId: string;
  clientSecret: string;
  displayName?: string;
  icon?: string;
}

/**
 * Email/Password provider config (native better-auth)
 */
export interface EmailPasswordProviderConfig {
  type: "email-password";
  displayName?: string;
  icon?: string;
  allowSignUp?: boolean;
  requireEmailVerification?: boolean;
}

/**
 * Keycloak provider config
 */
export interface KeycloakProviderConfig extends BaseOAuthProviderConfig {
  type: "keycloak";
  issuer: string;
  realm: string;
}

/**
 * Auth0 provider config
 */
export interface Auth0ProviderConfig extends BaseOAuthProviderConfig {
  type: "auth0";
  domain: string;
}

/**
 * Okta provider config
 */
export interface OktaProviderConfig extends BaseOAuthProviderConfig {
  type: "okta";
  domain: string;
}

/**
 * Generic OIDC provider config
 */
export interface GenericOIDCProviderConfig extends BaseOAuthProviderConfig {
  type: "generic-oidc";
  issuer: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
}

/**
 * Union of all provider configs
 */
export type ProviderConfig =
  | EmailPasswordProviderConfig
  | KeycloakProviderConfig
  | Auth0ProviderConfig
  | OktaProviderConfig
  | GenericOIDCProviderConfig;

/**
 * Provider info returned to client for login UI
 */
export interface ProviderInfo {
  displayName: string;
  icon: string;
  providerId: string;
  type: AuthProviderType;
}

/**
 * Auth provider interface
 */
export interface AuthProvider {
  /**
   * Get better-auth config for this provider
   */
  getBetterAuthConfig(): {
    emailAndPassword?: {
      enabled: boolean;
      allowSignUp?: boolean;
      requireEmailVerification?: boolean;
    };
    plugins?: unknown[];
  };

  /**
   * Get provider info for client
   */
  getProviderInfo(): ProviderInfo;
}
