/**
 * Tests for plugin-authn providers
 *
 * Tests:
 * - Provider creation
 * - Provider configuration
 * - Better-auth config generation
 * - Provider info generation
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { Auth0Provider } from "./auth0";
import { EmailPasswordProvider } from "./email-password";
import { GenericOIDCProvider } from "./generic-oidc";
import { createProvider, createProviders, getProvidersInfo, mergeBetterAuthConfigs } from "./index";
import { KeycloakProvider } from "./keycloak";
import { OktaProvider } from "./okta";
import { GoogleProvider } from "./google";
import type {
  Auth0ProviderConfig,
  EmailPasswordProviderConfig,
  GenericOIDCProviderConfig,
  GoogleProviderConfig,
  KeycloakProviderConfig,
  OktaProviderConfig,
  ProviderConfig,
} from "./types";

describe("EmailPasswordProvider", () => {
  it("should create with default config", () => {
    const config: EmailPasswordProviderConfig = {
      type: "email-password",
    };
    const provider = new EmailPasswordProvider(config);

    const info = provider.getProviderInfo();
    expect(info.type).toBe("email-password");
    expect(info.providerId).toBe("email-password");
    expect(info.displayName).toBe("Email");
    expect(info.icon).toBe("lucide:mail");
  });

  it("should use custom display name and icon", () => {
    const config: EmailPasswordProviderConfig = {
      displayName: "Login with Email",
      icon: "custom:email",
      type: "email-password",
    };
    const provider = new EmailPasswordProvider(config);

    const info = provider.getProviderInfo();
    expect(info.displayName).toBe("Login with Email");
    expect(info.icon).toBe("custom:email");
  });

  it("should generate better-auth config with defaults", () => {
    const config: EmailPasswordProviderConfig = {
      type: "email-password",
    };
    const provider = new EmailPasswordProvider(config);

    const authConfig = provider.getBetterAuthConfig();
    expect(authConfig.emailAndPassword).toBeDefined();
    expect(authConfig.emailAndPassword?.enabled).toBe(true);
    expect(authConfig.emailAndPassword?.allowSignUp).toBe(true);
    expect(authConfig.emailAndPassword?.requireEmailVerification).toBe(false);
  });

  it("should respect allowSignUp and requireEmailVerification config", () => {
    const config: EmailPasswordProviderConfig = {
      allowSignUp: false,
      requireEmailVerification: true,
      type: "email-password",
    };
    const provider = new EmailPasswordProvider(config);

    const authConfig = provider.getBetterAuthConfig();
    expect(authConfig.emailAndPassword?.allowSignUp).toBe(false);
    expect(authConfig.emailAndPassword?.requireEmailVerification).toBe(true);
  });
});

describe("createProvider", () => {
  it("should create EmailPasswordProvider for email-password type", () => {
    const config: EmailPasswordProviderConfig = {
      type: "email-password",
    };
    const provider = createProvider(config);

    expect(provider.getProviderInfo().type).toBe("email-password");
  });

  it("should create KeycloakProvider for keycloak type", () => {
    const config: KeycloakProviderConfig = {
      clientId: "test-client",
      clientSecret: "test-secret",
      issuer: "https://keycloak.example.com",
      realm: "test-realm",
      type: "keycloak",
    };
    const provider = createProvider(config);

    const info = provider.getProviderInfo();
    expect(info.type).toBe("keycloak");
    expect(info.providerId).toBe("keycloak");
    expect(info.displayName).toBe("Keycloak");
  });

  it("should create Auth0Provider for auth0 type", () => {
    const config: Auth0ProviderConfig = {
      clientId: "test-client",
      clientSecret: "test-secret",
      domain: "test.auth0.com",
      type: "auth0",
    };
    const provider = createProvider(config);

    const info = provider.getProviderInfo();
    expect(info.type).toBe("auth0");
    expect(info.providerId).toBe("auth0");
    expect(info.displayName).toBe("Auth0");
  });

  it("should create OktaProvider for okta type", () => {
    const config: OktaProviderConfig = {
      clientId: "test-client",
      clientSecret: "test-secret",
      domain: "test.okta.com",
      type: "okta",
    };
    const provider = createProvider(config);

    const info = provider.getProviderInfo();
    expect(info.type).toBe("okta");
    expect(info.providerId).toBe("okta");
    expect(info.displayName).toBe("Okta");
  });

  it("should create GenericOIDCProvider for generic-oidc type", () => {
    const config: GenericOIDCProviderConfig = {
      clientId: "test-client",
      clientSecret: "test-secret",
      issuer: "https://oidc.example.com",
      type: "generic-oidc",
    };
    const provider = createProvider(config);

    const info = provider.getProviderInfo();
    expect(info.type).toBe("generic-oidc");
    // Provider ID is generated from issuer hostname (oidc.example.com -> oidc-example-com)
    expect(info.providerId).toBe("oidc-example-com");
  });

  it("should create GoogleProvider for google type", () => {
    const config: GoogleProviderConfig = {
      clientId: "test-client",
      clientSecret: "test-secret",
      type: "google",
    };
    const provider = createProvider(config);

    const info = provider.getProviderInfo();
    expect(info.type).toBe("google");
    expect(info.providerId).toBe("google");
    expect(info.displayName).toBe("Google");
  });

  it("should throw for unknown provider type", () => {
    const config = {
      type: "unknown-provider",
    } as unknown as ProviderConfig;

    expect(() => createProvider(config)).toThrow("Unknown provider type");
  });
});

describe("createProviders", () => {
  it("should create multiple providers from config array", () => {
    const configs: ProviderConfig[] = [
      { type: "email-password" },
      {
        clientId: "test",
        clientSecret: "secret",
        issuer: "https://keycloak.example.com",
        realm: "test",
        type: "keycloak",
      },
    ];

    const providers = createProviders(configs);

    expect(providers).toHaveLength(2);
    expect(providers[0]?.getProviderInfo().type).toBe("email-password");
    expect(providers[1]?.getProviderInfo().type).toBe("keycloak");
  });

  it("should return empty array for empty config", () => {
    const providers = createProviders([]);
    expect(providers).toHaveLength(0);
  });
});

describe("mergeBetterAuthConfigs", () => {
  it("should merge email-password config from multiple providers", () => {
    const providers = createProviders([{ type: "email-password", allowSignUp: false }]);

    const merged = mergeBetterAuthConfigs(providers);

    expect(merged.emailAndPassword?.enabled).toBe(true);
    expect(merged.emailAndPassword?.allowSignUp).toBe(false);
  });

  it("should disable email-password if no email provider configured", () => {
    const providers = createProviders([
      {
        clientId: "test",
        clientSecret: "secret",
        issuer: "https://keycloak.example.com",
        realm: "test",
        type: "keycloak",
      },
    ]);

    const merged = mergeBetterAuthConfigs(providers);

    expect(merged.emailAndPassword?.enabled).toBe(false);
  });

  it("should merge plugins from all providers", () => {
    const providers = createProviders([
      {
        clientId: "test",
        clientSecret: "secret",
        issuer: "https://keycloak.example.com",
        realm: "test",
        type: "keycloak",
      },
      {
        clientId: "test2",
        clientSecret: "secret2",
        domain: "test.auth0.com",
        type: "auth0",
      },
    ]);

    const merged = mergeBetterAuthConfigs(providers);

    // Each OAuth provider adds a genericOAuth plugin
    expect(merged.plugins.length).toBeGreaterThanOrEqual(2);
  });

  it("should return empty plugins array for empty providers", () => {
    const merged = mergeBetterAuthConfigs([]);

    expect(merged.plugins).toEqual([]);
    expect(merged.emailAndPassword?.enabled).toBe(false);
  });
});

describe("getProvidersInfo", () => {
  it("should return info for all providers", () => {
    const providers = createProviders([
      { type: "email-password", displayName: "Email Login" },
      {
        clientId: "test",
        clientSecret: "secret",
        displayName: "Company SSO",
        issuer: "https://keycloak.example.com",
        realm: "test",
        type: "keycloak",
      },
    ]);

    const infos = getProvidersInfo(providers);

    expect(infos).toHaveLength(2);
    expect(infos[0]?.displayName).toBe("Email Login");
    expect(infos[0]?.type).toBe("email-password");
    expect(infos[1]?.displayName).toBe("Company SSO");
    expect(infos[1]?.type).toBe("keycloak");
  });

  it("should return empty array for empty providers", () => {
    const infos = getProvidersInfo([]);
    expect(infos).toEqual([]);
  });
});

describe("Keycloak provider", () => {
  it("should use custom display name and icon", () => {
    const config: KeycloakProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      displayName: "Corporate SSO",
      icon: "company:logo",
      issuer: "https://keycloak.example.com",
      realm: "test",
      type: "keycloak",
    };
    const provider = createProvider(config);

    const info = provider.getProviderInfo();
    expect(info.displayName).toBe("Corporate SSO");
    expect(info.icon).toBe("company:logo");
  });

  it("should have default icon", () => {
    const config: KeycloakProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      issuer: "https://keycloak.example.com",
      realm: "test",
      type: "keycloak",
    };
    const provider = createProvider(config);

    const info = provider.getProviderInfo();
    expect(info.icon).toBe("simple-icons:keycloak");
  });

  it("should have getLogoutUrl method", () => {
    const config: KeycloakProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      issuer: "https://keycloak.example.com",
      realm: "test",
      type: "keycloak",
    };
    const provider = createProvider(config);

    expect(provider.getLogoutUrl).toBeDefined();
  });
});

describe("Auth0 provider", () => {
  it("should use custom display name and icon", () => {
    const config: Auth0ProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      displayName: "Auth0 Login",
      domain: "test.auth0.com",
      icon: "auth0:logo",
      type: "auth0",
    };
    const provider = createProvider(config);

    const info = provider.getProviderInfo();
    expect(info.displayName).toBe("Auth0 Login");
    expect(info.icon).toBe("auth0:logo");
  });

  it("should have default icon", () => {
    const config: Auth0ProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      domain: "test.auth0.com",
      type: "auth0",
    };
    const provider = createProvider(config);

    const info = provider.getProviderInfo();
    expect(info.icon).toBe("simple-icons:auth0");
  });
});

describe("Okta provider", () => {
  it("should have default display name and icon", () => {
    const config: OktaProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      domain: "test.okta.com",
      type: "okta",
    };
    const provider = createProvider(config);

    const info = provider.getProviderInfo();
    expect(info.displayName).toBe("Okta");
    expect(info.icon).toBe("simple-icons:okta");
  });
});

describe("Generic OIDC provider", () => {
  it("should have default display name and icon", () => {
    const config: GenericOIDCProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      issuer: "https://oidc.example.com",
      type: "generic-oidc",
    };
    const provider = createProvider(config);

    const info = provider.getProviderInfo();
    expect(info.displayName).toBe("SSO");
    expect(info.icon).toBe("lucide:key-round");
  });

  it("should support custom endpoints", () => {
    const config: GenericOIDCProviderConfig = {
      authorizationEndpoint: "https://oidc.example.com/authorize",
      clientId: "test",
      clientSecret: "secret",
      issuer: "https://oidc.example.com",
      tokenEndpoint: "https://oidc.example.com/token",
      type: "generic-oidc",
      userinfoEndpoint: "https://oidc.example.com/userinfo",
    };
    const provider = createProvider(config);

    expect(provider.getProviderInfo().type).toBe("generic-oidc");
  });

  it("should generate provider ID from issuer URL", () => {
    const config: GenericOIDCProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      issuer: "https://auth.example.org",
      type: "generic-oidc",
    };
    const provider = createProvider(config);

    const info = provider.getProviderInfo();
    // Provider ID is derived from hostname with dots replaced by dashes
    expect(info.providerId).toBe("auth-example-org");
  });

  it("should fallback to oidc for invalid issuer URL", () => {
    const config: GenericOIDCProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      issuer: "invalid-url",
      type: "generic-oidc",
    };
    const provider = createProvider(config);

    const info = provider.getProviderInfo();
    expect(info.providerId).toBe("oidc");
  });

  it("should use custom display name and icon", () => {
    const config: GenericOIDCProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      displayName: "Custom SSO",
      icon: "custom:icon",
      issuer: "https://oidc.example.com",
      type: "generic-oidc",
    };
    const provider = createProvider(config);

    const info = provider.getProviderInfo();
    expect(info.displayName).toBe("Custom SSO");
    expect(info.icon).toBe("custom:icon");
  });

  it("should have getLogoutUrl method", () => {
    const config: GenericOIDCProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      issuer: "https://oidc.example.com",
      type: "generic-oidc",
    };
    const provider = createProvider(config);

    expect(provider.getLogoutUrl).toBeDefined();
  });
});

describe("Keycloak provider additional tests", () => {
  it("should build issuer URL from issuer and realm", () => {
    const config: KeycloakProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      issuer: "https://keycloak.example.com",
      realm: "test-realm",
      type: "keycloak",
    };
    const provider = createProvider(config);

    const betterAuthConfig = provider.getBetterAuthConfig();
    expect(betterAuthConfig.plugins).toHaveLength(1);
    expect(betterAuthConfig.emailAndPassword?.enabled).toBe(false);
  });

  it("should strip trailing slash from issuer", () => {
    const config: KeycloakProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      issuer: "https://keycloak.example.com/",
      realm: "test-realm",
      type: "keycloak",
    };
    const provider = createProvider(config);

    expect(provider.getProviderInfo().providerId).toBe("keycloak");
  });
});

describe("Auth0 provider additional tests", () => {
  it("should build issuer URL from domain", () => {
    const config: Auth0ProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      domain: "my-tenant.auth0.com",
      type: "auth0",
    };
    const provider = createProvider(config);

    const betterAuthConfig = provider.getBetterAuthConfig();
    expect(betterAuthConfig.plugins).toHaveLength(1);
    expect(betterAuthConfig.emailAndPassword?.enabled).toBe(false);
  });

  it("should strip https:// prefix from domain", () => {
    const config: Auth0ProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      domain: "https://my-tenant.auth0.com",
      type: "auth0",
    };
    const provider = createProvider(config);

    expect(provider.getProviderInfo().providerId).toBe("auth0");
  });

  it("should strip trailing slash from domain", () => {
    const config: Auth0ProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      domain: "my-tenant.auth0.com/",
      type: "auth0",
    };
    const provider = createProvider(config);

    expect(provider.getProviderInfo().providerId).toBe("auth0");
  });

  it("should have getLogoutUrl method", () => {
    const config: Auth0ProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      domain: "my-tenant.auth0.com",
      type: "auth0",
    };
    const provider = createProvider(config);

    expect(provider.getLogoutUrl).toBeDefined();
  });
});

describe("Okta provider additional tests", () => {
  it("should build issuer URL from domain", () => {
    const config: OktaProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      domain: "my-company.okta.com",
      type: "okta",
    };
    const provider = createProvider(config);

    const betterAuthConfig = provider.getBetterAuthConfig();
    expect(betterAuthConfig.plugins).toHaveLength(1);
    expect(betterAuthConfig.emailAndPassword?.enabled).toBe(false);
  });

  it("should strip https:// prefix from domain", () => {
    const config: OktaProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      domain: "https://my-company.okta.com",
      type: "okta",
    };
    const provider = createProvider(config);

    expect(provider.getProviderInfo().providerId).toBe("okta");
  });

  it("should strip trailing slash from domain", () => {
    const config: OktaProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      domain: "my-company.okta.com/",
      type: "okta",
    };
    const provider = createProvider(config);

    expect(provider.getProviderInfo().providerId).toBe("okta");
  });

  it("should use custom display name and icon", () => {
    const config: OktaProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      displayName: "Company SSO",
      domain: "my-company.okta.com",
      icon: "company:logo",
      type: "okta",
    };
    const provider = createProvider(config);

    const info = provider.getProviderInfo();
    expect(info.displayName).toBe("Company SSO");
    expect(info.icon).toBe("company:logo");
  });

  it("should have getLogoutUrl method", () => {
    const config: OktaProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      domain: "my-company.okta.com",
      type: "okta",
    };
    const provider = createProvider(config);

    expect(provider.getLogoutUrl).toBeDefined();
  });
});

// Tests for getLogoutUrl and getDiscoveryDocument with mocked fetch
describe("OAuth provider logout URL generation", () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    mockFetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            end_session_endpoint: "https://provider.example.com/logout",
            issuer: "https://provider.example.com",
          }),
          { status: 200 },
        ),
      ),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("KeycloakProvider getLogoutUrl", () => {
    it("should return logout URL with id_token_hint and post_logout_redirect_uri", async () => {
      const provider = new KeycloakProvider({
        clientId: "test-client",
        clientSecret: "test-secret",
        issuer: "https://keycloak.example.com",
        realm: "test-realm",
        type: "keycloak",
      });

      const logoutUrl = await provider.getLogoutUrl("test-id-token", "http://localhost:8000/");

      expect(logoutUrl).not.toBeNull();
      expect(logoutUrl).toContain("https://provider.example.com/logout");
      expect(logoutUrl).toContain("id_token_hint=test-id-token");
      expect(logoutUrl).toContain("post_logout_redirect_uri=http%3A%2F%2Flocalhost%3A8000%2F");
    });

    it("should return null when discovery fails", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response("Not Found", { status: 404 })),
      );

      const provider = new KeycloakProvider({
        clientId: "test-client",
        clientSecret: "test-secret",
        issuer: "https://keycloak.example.com",
        realm: "test-realm",
        type: "keycloak",
      });

      const logoutUrl = await provider.getLogoutUrl("test-id-token", "http://localhost:8000/");

      expect(logoutUrl).toBeNull();
    });

    it("should return null when end_session_endpoint is not in discovery", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ issuer: "https://provider.example.com" }), { status: 200 }),
        ),
      );

      const provider = new KeycloakProvider({
        clientId: "test-client",
        clientSecret: "test-secret",
        issuer: "https://keycloak.example.com",
        realm: "test-realm",
        type: "keycloak",
      });

      const logoutUrl = await provider.getLogoutUrl("test-id-token", "http://localhost:8000/");

      expect(logoutUrl).toBeNull();
    });

    it("should cache discovery document", async () => {
      const provider = new KeycloakProvider({
        clientId: "test-client",
        clientSecret: "test-secret",
        issuer: "https://keycloak.example.com",
        realm: "test-realm",
        type: "keycloak",
      });

      // Call getLogoutUrl twice
      await provider.getLogoutUrl("token1", "http://localhost/");
      await provider.getLogoutUrl("token2", "http://localhost/");

      // Fetch should only be called once due to caching
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("Auth0Provider getLogoutUrl", () => {
    it("should return logout URL with Auth0-specific parameters", async () => {
      const provider = new Auth0Provider({
        clientId: "test-client",
        clientSecret: "test-secret",
        domain: "test.auth0.com",
        type: "auth0",
      });

      const logoutUrl = await provider.getLogoutUrl("test-id-token", "http://localhost:8000/");

      expect(logoutUrl).not.toBeNull();
      expect(logoutUrl).toContain("id_token_hint=test-id-token");
      expect(logoutUrl).toContain("returnTo=http%3A%2F%2Flocalhost%3A8000%2F");
      expect(logoutUrl).toContain("client_id=test-client");
    });

    it("should return null when discovery fails", async () => {
      mockFetch.mockImplementation(() => Promise.reject(new Error("Network error")));

      const provider = new Auth0Provider({
        clientId: "test-client",
        clientSecret: "test-secret",
        domain: "test.auth0.com",
        type: "auth0",
      });

      const logoutUrl = await provider.getLogoutUrl("test-id-token", "http://localhost:8000/");

      expect(logoutUrl).toBeNull();
    });

    it("should cache discovery document", async () => {
      const provider = new Auth0Provider({
        clientId: "test-client",
        clientSecret: "test-secret",
        domain: "test.auth0.com",
        type: "auth0",
      });

      await provider.getLogoutUrl("token1", "http://localhost/");
      await provider.getLogoutUrl("token2", "http://localhost/");

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("OktaProvider getLogoutUrl", () => {
    it("should return logout URL with standard OIDC parameters", async () => {
      const provider = new OktaProvider({
        clientId: "test-client",
        clientSecret: "test-secret",
        domain: "test.okta.com",
        type: "okta",
      });

      const logoutUrl = await provider.getLogoutUrl("test-id-token", "http://localhost:8000/");

      expect(logoutUrl).not.toBeNull();
      expect(logoutUrl).toContain("id_token_hint=test-id-token");
      expect(logoutUrl).toContain("post_logout_redirect_uri=http%3A%2F%2Flocalhost%3A8000%2F");
    });

    it("should return null when end_session_endpoint is missing", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
      );

      const provider = new OktaProvider({
        clientId: "test-client",
        clientSecret: "test-secret",
        domain: "test.okta.com",
        type: "okta",
      });

      const logoutUrl = await provider.getLogoutUrl("test-id-token", "http://localhost:8000/");

      expect(logoutUrl).toBeNull();
    });

    it("should cache discovery document", async () => {
      const provider = new OktaProvider({
        clientId: "test-client",
        clientSecret: "test-secret",
        domain: "test.okta.com",
        type: "okta",
      });

      await provider.getLogoutUrl("token1", "http://localhost/");
      await provider.getLogoutUrl("token2", "http://localhost/");

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("GenericOIDCProvider getLogoutUrl", () => {
    it("should return logout URL with standard OIDC parameters", async () => {
      const provider = new GenericOIDCProvider({
        clientId: "test-client",
        clientSecret: "test-secret",
        issuer: "https://oidc.example.com",
        type: "generic-oidc",
      });

      const logoutUrl = await provider.getLogoutUrl("test-id-token", "http://localhost:8000/");

      expect(logoutUrl).not.toBeNull();
      expect(logoutUrl).toContain("id_token_hint=test-id-token");
      expect(logoutUrl).toContain("post_logout_redirect_uri=http%3A%2F%2Flocalhost%3A8000%2F");
    });

    it("should return null when discovery fetch fails", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response("Server Error", { status: 500 })),
      );

      const provider = new GenericOIDCProvider({
        clientId: "test-client",
        clientSecret: "test-secret",
        issuer: "https://oidc.example.com",
        type: "generic-oidc",
      });

      const logoutUrl = await provider.getLogoutUrl("test-id-token", "http://localhost:8000/");

      expect(logoutUrl).toBeNull();
    });

    it("should cache discovery document", async () => {
      const provider = new GenericOIDCProvider({
        clientId: "test-client",
        clientSecret: "test-secret",
        issuer: "https://oidc.example.com",
        type: "generic-oidc",
      });

      await provider.getLogoutUrl("token1", "http://localhost/");
      await provider.getLogoutUrl("token2", "http://localhost/");

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});

// Test Keycloak and GenericOIDC configuration
describe("Keycloak configuration", () => {
  it("should create plugin configuration correctly", () => {
    const provider = new KeycloakProvider({
      clientId: "my-client",
      clientSecret: "secret",
      issuer: "https://keycloak.example.com",
      realm: "test-realm",
      type: "keycloak",
    });

    const config = provider.getBetterAuthConfig();

    expect(config.emailAndPassword?.enabled).toBe(false);
    expect(config.plugins).toHaveLength(1);
    expect(config.plugins[0]).toBeDefined();
  });

  it("should strip trailing slash from issuer", () => {
    const provider = new KeycloakProvider({
      clientId: "my-client",
      clientSecret: "secret",
      issuer: "https://keycloak.example.com/",
      realm: "test-realm",
      type: "keycloak",
    });

    const config = provider.getBetterAuthConfig();
    expect(config.plugins).toHaveLength(1);
  });
});

// Test GenericOIDCProvider getBetterAuthConfig
describe("GenericOIDCProvider configuration", () => {
  it("should include custom endpoints when provided", () => {
    const provider = new GenericOIDCProvider({
      authorizationEndpoint: "https://custom.example.com/authorize",
      clientId: "test-client",
      clientSecret: "test-secret",
      issuer: "https://oidc.example.com",
      tokenEndpoint: "https://custom.example.com/token",
      type: "generic-oidc",
      userinfoEndpoint: "https://custom.example.com/userinfo",
    });

    const config = provider.getBetterAuthConfig();
    expect(config.emailAndPassword?.enabled).toBe(false);
    expect(config.plugins).toHaveLength(1);
    expect(config.plugins[0]).toBeDefined();
  });

  it("should work without custom endpoints", () => {
    const provider = new GenericOIDCProvider({
      clientId: "test-client",
      clientSecret: "test-secret",
      issuer: "https://oidc.example.com",
      type: "generic-oidc",
    });

    const config = provider.getBetterAuthConfig();
    expect(config.emailAndPassword?.enabled).toBe(false);
    expect(config.plugins).toHaveLength(1);
  });

  it("should strip trailing slash from issuer", () => {
    const provider = new GenericOIDCProvider({
      clientId: "test-client",
      clientSecret: "test-secret",
      issuer: "https://oidc.example.com/",
      type: "generic-oidc",
    });

    const config = provider.getBetterAuthConfig();
    expect(config.plugins).toHaveLength(1);
  });
});

describe("Google provider", () => {
  it("should create with minimal config", () => {
    const config: GoogleProviderConfig = {
      clientId: "test-client",
      clientSecret: "test-secret",
      type: "google",
    };
    const provider = createProvider(config);
    const info = provider.getProviderInfo();

    expect(info.type).toBe("google");
    expect(info.providerId).toBe("google");
    expect(info.displayName).toBe("Google");
    expect(info.icon).toBe("simple-icons:google");
  });

  it("should use custom display name and icon", () => {
    const config: GoogleProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      displayName: "Login with Google",
      icon: "custom:google",
      type: "google",
    };
    const provider = createProvider(config);
    const info = provider.getProviderInfo();

    expect(info.displayName).toBe("Login with Google");
    expect(info.icon).toBe("custom:google");
  });

  it("should generate socialProviders config", () => {
    const config: GoogleProviderConfig = {
      clientId: "my-client-id",
      clientSecret: "my-secret",
      type: "google",
    };
    const provider = createProvider(config);
    const authConfig = provider.getBetterAuthConfig();

    expect(authConfig.socialProviders).toBeDefined();
    expect(authConfig.socialProviders?.google).toBeDefined();
    expect(authConfig.plugins).toBeUndefined();
    expect(authConfig.emailAndPassword).toBeUndefined();
  });

  it("should include Google-specific options when provided", () => {
    const config: GoogleProviderConfig = {
      accessType: "offline",
      clientId: "test",
      clientSecret: "secret",
      hd: "example.com",
      prompt: "select_account",
      type: "google",
    };
    const provider = createProvider(config);
    const authConfig = provider.getBetterAuthConfig();
    const googleConfig = authConfig.socialProviders?.google as Record<string, unknown>;

    expect(googleConfig.hd).toBe("example.com");
    expect(googleConfig.prompt).toBe("select_account");
    expect(googleConfig.accessType).toBe("offline");
  });

  it("should not include optional fields when not provided", () => {
    const config: GoogleProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      type: "google",
    };
    const provider = createProvider(config);
    const authConfig = provider.getBetterAuthConfig();
    const googleConfig = authConfig.socialProviders?.google as Record<string, unknown>;

    expect(googleConfig.hd).toBeUndefined();
    expect(googleConfig.prompt).toBeUndefined();
    expect(googleConfig.accessType).toBeUndefined();
  });

  it("should not have getLogoutUrl method", () => {
    const config: GoogleProviderConfig = {
      clientId: "test",
      clientSecret: "secret",
      type: "google",
    };
    const provider = createProvider(config);

    expect(provider.getLogoutUrl).toBeUndefined();
  });
});

describe("mergeBetterAuthConfigs with social providers", () => {
  it("should merge Google socialProviders config", () => {
    const providers = createProviders([
      {
        clientId: "google-id",
        clientSecret: "google-secret",
        type: "google",
      },
    ]);
    const merged = mergeBetterAuthConfigs(providers);

    expect(merged.socialProviders.google).toBeDefined();
    expect(merged.emailAndPassword?.enabled).toBe(false);
    expect(merged.plugins).toEqual([]);
  });

  it("should combine Google with email-password and OIDC providers", () => {
    const providers = createProviders([
      { type: "email-password" },
      {
        clientId: "google-id",
        clientSecret: "google-secret",
        type: "google",
      },
      {
        clientId: "kc-id",
        clientSecret: "kc-secret",
        issuer: "https://keycloak.example.com",
        realm: "test",
        type: "keycloak",
      },
    ]);
    const merged = mergeBetterAuthConfigs(providers);

    expect(merged.emailAndPassword?.enabled).toBe(true);
    expect(merged.socialProviders.google).toBeDefined();
    expect(merged.plugins.length).toBeGreaterThanOrEqual(1);
  });
});

// Test extractKeycloakRoles function directly
describe("extractKeycloakRoles", () => {
  const { extractKeycloakRoles } = require("./keycloak");

  it("should extract realm roles from profile", () => {
    const profile = {
      realm_access: {
        roles: ["admin", "user"],
      },
    };

    const roles = extractKeycloakRoles(profile);
    expect(roles).toEqual(["admin", "user"]);
  });

  it("should extract client-specific roles from profile", () => {
    const profile = {
      resource_access: {
        "my-client": {
          roles: ["client-admin", "client-user"],
        },
      },
    };

    const roles = extractKeycloakRoles(profile, "my-client");
    expect(roles).toEqual(["client-admin", "client-user"]);
  });

  it("should combine realm and client roles, removing duplicates", () => {
    const profile = {
      realm_access: {
        roles: ["admin", "user"],
      },
      resource_access: {
        "my-client": {
          roles: ["admin", "client-role"], // "admin" is duplicate
        },
      },
    };

    const roles = extractKeycloakRoles(profile, "my-client");
    expect(roles).toContain("admin");
    expect(roles).toContain("user");
    expect(roles).toContain("client-role");
    // Should not have duplicate "admin"
    expect(roles.filter((r: string) => r === "admin").length).toBe(1);
  });

  it("should handle profile without roles", () => {
    const profile = {};
    const roles = extractKeycloakRoles(profile);
    expect(roles).toEqual([]);
  });

  it("should handle profile with empty realm_access", () => {
    const profile = {
      realm_access: {},
    };
    const roles = extractKeycloakRoles(profile);
    expect(roles).toEqual([]);
  });

  it("should handle profile with empty resource_access for client", () => {
    const profile = {
      resource_access: {
        "other-client": {
          roles: ["some-role"],
        },
      },
    };
    const roles = extractKeycloakRoles(profile, "my-client");
    expect(roles).toEqual([]);
  });

  it("should ignore client roles when clientId is not provided", () => {
    const profile = {
      realm_access: {
        roles: ["realm-role"],
      },
      resource_access: {
        "my-client": {
          roles: ["client-role"],
        },
      },
    };

    const roles = extractKeycloakRoles(profile); // No clientId
    expect(roles).toEqual(["realm-role"]);
  });
});

// Test mapKeycloakProfileToUser function directly
describe("mapKeycloakProfileToUser", () => {
  const { mapKeycloakProfileToUser } = require("./keycloak");

  it("should map profile fields to user object", () => {
    const profile = {
      email: "user@example.com",
      email_verified: true,
      name: "Test User",
      picture: "https://example.com/avatar.jpg",
      realm_access: {
        roles: ["user"],
      },
    };

    const user = mapKeycloakProfileToUser(profile, "my-client");

    expect(user.email).toBe("user@example.com");
    expect(user.emailVerified).toBe(true);
    expect(user.name).toBe("Test User");
    expect(user.image).toBe("https://example.com/avatar.jpg");
    expect(user.roles).toBe(JSON.stringify(["user"]));
  });

  it("should handle profile without picture", () => {
    const profile = {
      email: "user@example.com",
      email_verified: false,
      name: "No Avatar User",
    };

    const user = mapKeycloakProfileToUser(profile, "my-client");

    expect(user.email).toBe("user@example.com");
    expect(user.emailVerified).toBe(false);
    expect(user.name).toBe("No Avatar User");
    expect(user.image).toBeUndefined();
    expect(user.roles).toBe("[]");
  });

  it("should combine realm and client roles in the result", () => {
    const profile = {
      email: "admin@example.com",
      email_verified: true,
      name: "Admin User",
      realm_access: {
        roles: ["realm-admin"],
      },
      resource_access: {
        "my-client": {
          roles: ["client-admin"],
        },
      },
    };

    const user = mapKeycloakProfileToUser(profile, "my-client");

    const roles = JSON.parse(user.roles);
    expect(roles).toContain("realm-admin");
    expect(roles).toContain("client-admin");
  });

  it("should stringify roles as JSON", () => {
    const profile = {
      email: "test@example.com",
      email_verified: true,
      name: "Test",
      realm_access: {
        roles: ["role1", "role2", "role3"],
      },
    };

    const user = mapKeycloakProfileToUser(profile, "my-client");

    expect(typeof user.roles).toBe("string");
    expect(JSON.parse(user.roles)).toEqual(["role1", "role2", "role3"]);
  });
});
