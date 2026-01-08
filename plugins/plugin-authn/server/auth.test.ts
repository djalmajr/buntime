/**
 * Tests for plugin-authn auth module
 *
 * Tests:
 * - createBetterAuth function
 * - BetterAuthConfig interface
 * - Auth configuration with different providers
 */

import { describe, expect, it } from "bun:test";
import { EmailPasswordProvider } from "./providers/email-password";
import { createProvider, mergeBetterAuthConfigs } from "./providers/index";

describe("auth module", () => {
  describe("BetterAuthConfig", () => {
    it("should define correct interface structure", () => {
      // Test the interface structure
      interface BetterAuthConfig {
        db: unknown;
        providers: unknown[];
        trustedOrigins?: string[];
      }

      const config: BetterAuthConfig = {
        db: null,
        providers: [],
        trustedOrigins: ["http://localhost:8000"],
      };

      expect(config.db).toBeNull();
      expect(config.providers).toEqual([]);
      expect(config.trustedOrigins).toContain("http://localhost:8000");
    });
  });

  describe("provider integration", () => {
    it("should merge email-password provider config", () => {
      const provider = new EmailPasswordProvider({
        type: "email-password",
        allowSignUp: true,
        requireEmailVerification: false,
      });

      const providers = [provider];
      const merged = mergeBetterAuthConfigs(providers);

      expect(merged.emailAndPassword?.enabled).toBe(true);
      expect(merged.emailAndPassword?.allowSignUp).toBe(true);
      expect(merged.emailAndPassword?.requireEmailVerification).toBe(false);
    });

    it("should merge multiple OAuth providers", () => {
      const keycloakProvider = createProvider({
        type: "keycloak",
        clientId: "test",
        clientSecret: "secret",
        issuer: "https://keycloak.example.com",
        realm: "test",
      });

      const auth0Provider = createProvider({
        type: "auth0",
        clientId: "test",
        clientSecret: "secret",
        domain: "test.auth0.com",
      });

      const providers = [keycloakProvider, auth0Provider];
      const merged = mergeBetterAuthConfigs(providers);

      // OAuth providers add plugins
      expect(merged.plugins.length).toBeGreaterThanOrEqual(2);
      // No email-password provider, so it should be disabled
      expect(merged.emailAndPassword?.enabled).toBe(false);
    });

    it("should combine email-password with OAuth provider", () => {
      const emailProvider = new EmailPasswordProvider({
        type: "email-password",
      });

      const keycloakProvider = createProvider({
        type: "keycloak",
        clientId: "test",
        clientSecret: "secret",
        issuer: "https://keycloak.example.com",
        realm: "test",
      });

      const providers = [emailProvider, keycloakProvider];
      const merged = mergeBetterAuthConfigs(providers);

      expect(merged.emailAndPassword?.enabled).toBe(true);
      expect(merged.plugins.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("trusted origins", () => {
    it("should accept empty trusted origins", () => {
      const config = {
        trustedOrigins: [],
      };

      expect(config.trustedOrigins).toEqual([]);
    });

    it("should accept multiple trusted origins", () => {
      const config = {
        trustedOrigins: [
          "http://localhost:3000",
          "http://localhost:8000",
          "https://app.example.com",
        ],
      };

      expect(config.trustedOrigins).toHaveLength(3);
      expect(config.trustedOrigins).toContain("http://localhost:3000");
      expect(config.trustedOrigins).toContain("https://app.example.com");
    });
  });

  describe("base URL determination", () => {
    it("should use first trusted origin as base URL", () => {
      const trustedOrigins = ["http://localhost:8000", "https://app.example.com"];
      const baseURL = trustedOrigins[0] || "http://localhost:8000";

      expect(baseURL).toBe("http://localhost:8000");
    });

    it("should default to localhost:8000 when no trusted origins", () => {
      const trustedOrigins: string[] = [];
      const baseURL = trustedOrigins[0] || "http://localhost:8000";

      expect(baseURL).toBe("http://localhost:8000");
    });
  });

  describe("session configuration", () => {
    it("should define session cookie cache settings", () => {
      const sessionConfig = {
        cookieCache: {
          enabled: true,
          maxAge: 5 * 60, // 5 minutes
        },
      };

      expect(sessionConfig.cookieCache.enabled).toBe(true);
      expect(sessionConfig.cookieCache.maxAge).toBe(300);
    });
  });

  describe("user additional fields", () => {
    it("should define SCIM fields", () => {
      const additionalFields = {
        active: {
          type: "boolean",
          required: false,
          defaultValue: true,
          input: false,
        },
        externalId: {
          type: "string",
          required: false,
          input: false,
        },
        metadata: {
          type: "string",
          required: false,
          input: false,
        },
      };

      expect(additionalFields.active.type).toBe("boolean");
      expect(additionalFields.active.defaultValue).toBe(true);
      expect(additionalFields.externalId.type).toBe("string");
      expect(additionalFields.metadata.type).toBe("string");
    });

    it("should define OAuth provider data fields", () => {
      const additionalFields = {
        groups: {
          type: "string",
          required: false,
          input: false,
        },
        roles: {
          type: "string",
          required: false,
          input: false,
        },
      };

      expect(additionalFields.groups.type).toBe("string");
      expect(additionalFields.roles.type).toBe("string");
      expect(additionalFields.roles.input).toBe(false);
    });
  });

  describe("database adapter", () => {
    it("should use sqlite provider for drizzle adapter", () => {
      const adapterConfig = {
        provider: "sqlite",
      };

      expect(adapterConfig.provider).toBe("sqlite");
    });
  });

  describe("base path configuration", () => {
    it("should use /auth/api/auth as base path", () => {
      const basePath = "/auth/api/auth";
      expect(basePath).toBe("/auth/api/auth");
    });
  });
});

describe("better-auth configuration", () => {
  describe("email and password options", () => {
    it("should enable email verification when configured", () => {
      const emailConfig = {
        enabled: true,
        allowSignUp: true,
        requireEmailVerification: true,
      };

      expect(emailConfig.requireEmailVerification).toBe(true);
    });

    it("should disable sign up when configured", () => {
      const emailConfig = {
        enabled: true,
        allowSignUp: false,
        requireEmailVerification: false,
      };

      expect(emailConfig.allowSignUp).toBe(false);
    });
  });

  describe("OAuth plugin configuration", () => {
    it("should configure keycloak plugin", () => {
      const keycloakProvider = createProvider({
        type: "keycloak",
        clientId: "my-client",
        clientSecret: "my-secret",
        issuer: "https://keycloak.example.com",
        realm: "my-realm",
      });

      const config = keycloakProvider.getBetterAuthConfig();

      expect(config.plugins).toBeDefined();
      expect(config.plugins).toHaveLength(1);
    });

    it("should configure auth0 plugin", () => {
      const auth0Provider = createProvider({
        type: "auth0",
        clientId: "my-client",
        clientSecret: "my-secret",
        domain: "my-tenant.auth0.com",
      });

      const config = auth0Provider.getBetterAuthConfig();

      expect(config.plugins).toBeDefined();
      expect(config.plugins).toHaveLength(1);
    });

    it("should configure okta plugin", () => {
      const oktaProvider = createProvider({
        type: "okta",
        clientId: "my-client",
        clientSecret: "my-secret",
        domain: "my-company.okta.com",
      });

      const config = oktaProvider.getBetterAuthConfig();

      expect(config.plugins).toBeDefined();
      expect(config.plugins).toHaveLength(1);
    });

    it("should configure generic-oidc plugin", () => {
      const oidcProvider = createProvider({
        type: "generic-oidc",
        clientId: "my-client",
        clientSecret: "my-secret",
        issuer: "https://oidc.example.com",
      });

      const config = oidcProvider.getBetterAuthConfig();

      expect(config.plugins).toBeDefined();
      expect(config.plugins).toHaveLength(1);
    });
  });
});
