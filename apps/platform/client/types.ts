/** Client-facing tenant shapes (mirror of server/types.ts, kept separate so the
 * browser bundle does not import server code). */

export interface CatalogApp {
  name: string;
  url: string;
  icon?: string;
}

export type TenantStatus = "active" | "disabled";

export interface TenantRecord {
  host: string;
  slug: string;
  realm: string;
  clientId: string;
  url: string;
  catalog: CatalogApp[];
  status: TenantStatus;
  createdAt: number;
}
