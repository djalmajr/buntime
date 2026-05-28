/**
 * Minimal Keycloak Admin REST client for tenant provisioning.
 *
 * Auth: a dedicated **confidential client** in the `master` realm
 * (`client_credentials` grant) with `realm-management` roles
 * (`manage-realms`/`manage-clients`/`manage-users`) — no super-admin password
 * in the worker. The realm created per tenant is named after the tenant slug
 * (e.g. `tenant-1`) with a single **public** client (PKCE), one realm role, and
 * an initial user with a temporary password.
 *
 * `fetch` is injectable for tests.
 */

import { ValidationError } from "@buntime/shared/errors";

export interface KeycloakAdminOptions {
  /** Keycloak base URL (admin REST lives under `${baseUrl}/admin/...`). */
  baseUrl: string;
  /** Provisioner client id in the master realm. */
  clientId: string;
  /** Provisioner client secret. */
  clientSecret: string;
  /** Public client id created in each tenant realm (the shell logs in with it). */
  publicClientId?: string;
  fetch?: typeof fetch;
}

export interface CreateRealmInput {
  realm: string;
  host: string;
  displayName?: string;
  /** Initial username (default `admin`). */
  username?: string;
}

export interface CreateRealmResult {
  realm: string;
  clientId: string;
  username: string;
  /** Temporary password for the initial user (returned once). */
  temporaryPassword: string;
}

function randomPassword(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64url");
}

export class KeycloakAdmin {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly publicClientId: string;
  private readonly fetchFn: typeof fetch;
  private cachedToken?: { token: string; expiresAt: number };

  constructor(opts: KeycloakAdminOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.publicClientId = opts.publicClientId ?? "web";
    this.fetchFn = opts.fetch ?? fetch;
  }

  /** OAuth2 base URL for this Keycloak ({@link baseUrl} as-is). */
  get url(): string {
    return this.baseUrl;
  }

  private async token(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 5_000) {
      return this.cachedToken.token;
    }

    const res = await this.fetchFn(`${this.baseUrl}/realms/master/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    if (!res.ok) {
      throw new ValidationError(
        `Keycloak admin token failed: ${res.status}`,
        "KEYCLOAK_TOKEN_FAILED",
      );
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = {
      token: data.access_token,
      expiresAt: now + (data.expires_in ?? 60) * 1000,
    };
    return data.access_token;
  }

  private async admin(path: string, init?: RequestInit): Promise<Response> {
    const token = await this.token();
    return this.fetchFn(`${this.baseUrl}/admin${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  }

  async realmExists(realm: string): Promise<boolean> {
    const res = await this.admin(`/realms/${encodeURIComponent(realm)}`);
    return res.ok;
  }

  /**
   * Create (idempotently) the tenant realm: realm + public client (PKCE) + one
   * realm role + an initial user with a temporary password. Existing pieces are
   * skipped so a retried `POST /tenants` is safe.
   */
  async createRealm(input: CreateRealmInput): Promise<CreateRealmResult> {
    const { realm, host } = input;
    const username = input.username ?? "admin";
    const origin = `https://${host}`;

    if (!(await this.realmExists(realm))) {
      const res = await this.admin("/realms", {
        method: "POST",
        body: JSON.stringify({
          realm,
          enabled: true,
          displayName: input.displayName ?? realm,
          internationalizationEnabled: true,
          supportedLocales: ["pt-BR", "en", "es"],
          loginWithEmailAllowed: true,
          resetPasswordAllowed: true,
          rememberMe: true,
        }),
      });
      if (!res.ok && res.status !== 409) {
        throw new ValidationError(
          `Create realm failed: ${res.status} ${await res.text()}`,
          "KEYCLOAK_CREATE_REALM_FAILED",
        );
      }
    }

    await this.ensureClient(realm, origin);
    await this.ensureRole(realm, "user");
    const temporaryPassword = await this.ensureUser(realm, username);

    return { realm, clientId: this.publicClientId, username, temporaryPassword };
  }

  /** Toggle a realm off (soft disable). Used on tenant removal. */
  async disableRealm(realm: string): Promise<void> {
    const res = await this.admin(`/realms/${encodeURIComponent(realm)}`, {
      method: "PUT",
      body: JSON.stringify({ realm, enabled: false }),
    });
    if (!res.ok && res.status !== 404) {
      throw new ValidationError(
        `Disable realm failed: ${res.status}`,
        "KEYCLOAK_DISABLE_REALM_FAILED",
      );
    }
  }

  private async ensureClient(realm: string, origin: string): Promise<void> {
    const existing = await this.admin(
      `/realms/${encodeURIComponent(realm)}/clients?clientId=${encodeURIComponent(this.publicClientId)}`,
    );
    if (existing.ok && ((await existing.json()) as unknown[]).length > 0) return;

    const res = await this.admin(`/realms/${encodeURIComponent(realm)}/clients`, {
      method: "POST",
      body: JSON.stringify({
        clientId: this.publicClientId,
        enabled: true,
        protocol: "openid-connect",
        publicClient: true,
        standardFlowEnabled: true,
        directAccessGrantsEnabled: false,
        redirectUris: [`${origin}/*`],
        webOrigins: [origin],
        attributes: {
          "pkce.code.challenge.method": "S256",
          "post.logout.redirect.uris": `${origin}/*`,
        },
      }),
    });
    if (!res.ok && res.status !== 409) {
      throw new ValidationError(
        `Create client failed: ${res.status} ${await res.text()}`,
        "KEYCLOAK_CREATE_CLIENT_FAILED",
      );
    }
  }

  private async ensureRole(realm: string, name: string): Promise<void> {
    const res = await this.admin(`/realms/${encodeURIComponent(realm)}/roles`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    if (!res.ok && res.status !== 409) {
      throw new ValidationError(`Create role failed: ${res.status}`, "KEYCLOAK_CREATE_ROLE_FAILED");
    }
  }

  /** Create the initial user if absent; returns the temporary password set. */
  private async ensureUser(realm: string, username: string): Promise<string> {
    const lookup = await this.admin(
      `/realms/${encodeURIComponent(realm)}/users?username=${encodeURIComponent(username)}&exact=true`,
    );
    if (lookup.ok && ((await lookup.json()) as unknown[]).length > 0) {
      return "(existing user — password unchanged)";
    }

    const password = randomPassword();
    const created = await this.admin(`/realms/${encodeURIComponent(realm)}/users`, {
      method: "POST",
      body: JSON.stringify({
        username,
        enabled: true,
        emailVerified: false,
        credentials: [{ type: "password", value: password, temporary: true }],
      }),
    });
    if (!created.ok && created.status !== 409) {
      throw new ValidationError(
        `Create user failed: ${created.status} ${await created.text()}`,
        "KEYCLOAK_CREATE_USER_FAILED",
      );
    }
    return password;
  }
}
