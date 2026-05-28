/**
 * Orchestrates tenant lifecycle: Keycloak realm → Cloudflare hostname/DNS →
 * Turso registry. Idempotent: each step is safe to retry. Dependencies are
 * injected so the route layer (and tests) can supply real or mock clients.
 */

import { NotFoundError, ValidationError } from "@buntime/shared/errors";
import { defaultCatalog } from "./catalog.ts";
import type { CreateRealmResult } from "./keycloak.ts";
import type { TenantStore } from "./turso.ts";
import type { CatalogApp, TenantInput, TenantRecord } from "./types.ts";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const HOST_PATTERN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;

/** Keycloak surface the provisioner uses (subset of {@link KeycloakAdmin}). */
export interface KeycloakLike {
  readonly url: string;
  createRealm(input: {
    realm: string;
    host: string;
    displayName?: string;
  }): Promise<CreateRealmResult>;
  disableRealm(realm: string): Promise<void>;
}

/** Cloudflare surface the provisioner uses (subset of {@link CloudflareTunnel}). */
export interface CloudflareLike {
  addHostname(host: string): Promise<void>;
  removeHostname(host: string): Promise<void>;
}

export interface ProvisionerDeps {
  store: TenantStore;
  keycloak: KeycloakLike;
  cloudflare: CloudflareLike;
  /** Catalog resolver; defaults to {@link defaultCatalog}. */
  catalogFor?: (slug: string) => CatalogApp[];
  /** Clock seam for tests. */
  now?: () => number;
}

export interface CreateTenantResult {
  tenant: TenantRecord;
  credentials: { username: string; temporaryPassword: string };
}

export class Provisioner {
  constructor(private readonly deps: ProvisionerDeps) {}

  async create(input: TenantInput): Promise<CreateTenantResult> {
    const slug = input.slug?.trim();
    const host = input.host?.trim().toLowerCase();

    if (!slug || !SLUG_PATTERN.test(slug)) {
      throw new ValidationError(
        "slug must match /^[a-z0-9][a-z0-9-]*$/ (it becomes the realm name)",
        "INVALID_SLUG",
      );
    }
    if (!host || !HOST_PATTERN.test(host)) {
      throw new ValidationError("host must be a valid domain", "INVALID_HOST");
    }

    const realm = await this.deps.keycloak.createRealm({
      realm: slug,
      host,
      displayName: input.displayName,
    });
    await this.deps.cloudflare.addHostname(host);

    const catalog = input.catalog ?? (this.deps.catalogFor ?? defaultCatalog)(slug);
    const tenant: TenantRecord = {
      host,
      slug,
      realm: slug,
      clientId: realm.clientId,
      url: this.deps.keycloak.url,
      catalog,
      status: "active",
      createdAt: (this.deps.now ?? Date.now)(),
    };
    await this.deps.store.upsert(tenant);

    return {
      tenant,
      credentials: { username: realm.username, temporaryPassword: realm.temporaryPassword },
    };
  }

  async remove(slug: string): Promise<void> {
    const tenant = await this.deps.store.getBySlug(slug);
    if (!tenant) {
      throw new NotFoundError(`Tenant not found: ${slug}`, "TENANT_NOT_FOUND");
    }
    await this.deps.keycloak.disableRealm(tenant.realm);
    await this.deps.cloudflare.removeHostname(tenant.host);
    await this.deps.store.removeBySlug(slug);
  }
}
