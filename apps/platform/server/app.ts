/**
 * Builds the platform Hono API. Pure: all I/O comes from injected deps
 * (`store`, `provisioner`, `verify`), so it is fully testable via `app.fetch`.
 *
 * Routes (mounted under `/api` by `server/index.ts`):
 *   GET    /config            public  — host → { url, realm, clientId } (shell bootstrap)
 *   GET    /catalog           public  — host → CatalogApp[]
 *   GET    /tenants           admin   — list
 *   POST   /tenants           admin   — provision
 *   PUT    /tenants/:slug     admin   — update catalog/displayName
 *   DELETE /tenants/:slug     admin   — deprovision
 */

import { NotFoundError, ValidationError } from "@buntime/shared/errors";
import { Hono } from "hono";
import { z } from "zod";
import { type AdminVerifier, requireAdmin } from "./auth.ts";
import type { Provisioner } from "./provisioner.ts";
import type { TenantStore } from "./turso.ts";

export interface AppDeps {
  store: TenantStore;
  provisioner: Provisioner;
  verify: AdminVerifier;
  /** Runtime root key (RUNTIME_ROOT_KEY); accepted as admin via X-API-Key for bootstrap/ops. */
  rootKey?: string;
}

const catalogAppSchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  icon: z.string().optional(),
});

const createTenantSchema = z.object({
  slug: z.string().min(1),
  host: z.string().min(1),
  displayName: z.string().optional(),
  catalog: z.array(catalogAppSchema).optional(),
});

const updateTenantSchema = z.object({
  displayName: z.string().optional(),
  catalog: z.array(catalogAppSchema).optional(),
});

/** Strip the port from a Host header value. */
function hostname(raw: string | undefined): string {
  return (raw ?? "").split(":")[0]?.toLowerCase() ?? "";
}

export function createApp(deps: AppDeps): Hono {
  const { store, provisioner, verify, rootKey } = deps;
  const gate = requireAdmin(verify, rootKey);

  return new Hono()
    .get("/config", async (c) => {
      const host = hostname(c.req.header("host"));
      const tenant = await store.getByHost(host);
      if (!tenant || tenant.status !== "active") {
        return c.json({ error: "Unknown host" }, 404);
      }
      return c.json({ url: tenant.url, realm: tenant.realm, clientId: tenant.clientId });
    })

    .get("/catalog", async (c) => {
      const host = hostname(c.req.header("host"));
      const tenant = await store.getByHost(host);
      if (!tenant || tenant.status !== "active") {
        return c.json([]);
      }
      return c.json(tenant.catalog);
    })

    .get("/tenants", gate, async (c) => {
      return c.json(await store.list());
    })

    .post("/tenants", gate, async (c) => {
      const parsed = createTenantSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
      }
      try {
        const result = await provisioner.create(parsed.data);
        return c.json(result, 201);
      } catch (err) {
        return errorResponse(c, err);
      }
    })

    .put("/tenants/:slug", gate, async (c) => {
      const slug = c.req.param("slug");
      const parsed = updateTenantSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
      }
      const tenant = await store.getBySlug(slug);
      if (!tenant) {
        return c.json({ error: "Tenant not found" }, 404);
      }
      await store.upsert({
        ...tenant,
        catalog: parsed.data.catalog ?? tenant.catalog,
      });
      return c.json({ ok: true });
    })

    .delete("/tenants/:slug", gate, async (c) => {
      try {
        await provisioner.remove(c.req.param("slug"));
        return c.json({ ok: true });
      } catch (err) {
        return errorResponse(c, err);
      }
    });
}

// biome-ignore lint/suspicious/noExplicitAny: Hono context generic varies per route
function errorResponse(c: any, err: unknown) {
  if (err instanceof ValidationError) {
    return c.json({ error: err.message, code: err.code }, 400);
  }
  if (err instanceof NotFoundError) {
    return c.json({ error: err.message, code: err.code }, 404);
  }
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: message }, 500);
}
