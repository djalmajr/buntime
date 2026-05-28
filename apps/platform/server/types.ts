/** An app entry shown by the shell catalog (rendered in a z-frame iframe). */
export interface CatalogApp {
  name: string;
  /** Worker mount path, e.g. "/todos/" or "/platform/". */
  url: string;
  /** Optional icon (iconify name, e.g. "lucide:check-square"). */
  icon?: string;
}

/** Keycloak config the shell needs to bootstrap login for a host. */
export interface KeycloakConfig {
  /** Keycloak base URL (e.g. https://keycloak.djalmajr.dev). */
  url: string;
  realm: string;
  clientId: string;
}

export type TenantStatus = "active" | "disabled";

/** A provisioned tenant: one host ↔ one Keycloak realm ↔ one catalog. */
export interface TenantRecord {
  host: string;
  slug: string;
  realm: string;
  clientId: string;
  /** Keycloak base URL. */
  url: string;
  catalog: CatalogApp[];
  status: TenantStatus;
  createdAt: number;
}

/** Input to create/update a tenant. */
export interface TenantInput {
  slug: string;
  host: string;
  displayName?: string;
  /** Override the default catalog (else derived from slug). */
  catalog?: CatalogApp[];
}
