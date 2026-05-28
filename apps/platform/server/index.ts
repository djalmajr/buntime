/**
 * Worker server: wires real deps from env and exposes the Hono API under /api.
 * The root `index.ts` mounts `server.fetch` at `/api/*` and serves the client
 * (dist) for everything else.
 *
 * Env (secrets via k8s Secret; see wiki/ops):
 *   KEYCLOAK_URL, KC_PROVISIONER_CLIENT_ID, KC_PROVISIONER_CLIENT_SECRET
 *   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CF_TUNNEL_ID, CF_ZONE_ID
 *   PLATFORM_ADMIN_REALM (default "admin") — realm whose JWT gates tenant CRUD
 *   PLATFORM_PUBLIC_CLIENT_ID (default "web") — public client created per realm
 *   RUNTIME_TURSO_* — forwarded by the runtime for the `tenants` namespace
 */

import { join } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createApp } from "./app.ts";
import { keycloakVerifier } from "./auth.ts";
import { CloudflareTunnel } from "./cloudflare.ts";
import { KeycloakAdmin } from "./keycloak.ts";
import { Provisioner } from "./provisioner.ts";
import { TenantStore } from "./turso.ts";

const env = Bun.env;
const KEYCLOAK_URL = env.KEYCLOAK_URL ?? "";
const ADMIN_REALM = env.PLATFORM_ADMIN_REALM ?? "admin";

// Persist the registry on the runtime's per-pod state PVC (RUNTIME_STATE_DIR,
// forwarded by the runtime). Survives pod restarts in single-pod local mode;
// falls back to the openTurso default (./.cache/turso) for local dev.
const stateDir = env.RUNTIME_STATE_DIR;
const store = await TenantStore.open(stateDir ? { dir: join(stateDir, "turso") } : undefined);

const keycloak = new KeycloakAdmin({
  baseUrl: KEYCLOAK_URL,
  clientId: env.KC_PROVISIONER_CLIENT_ID ?? "",
  clientSecret: env.KC_PROVISIONER_CLIENT_SECRET ?? "",
  publicClientId: env.PLATFORM_PUBLIC_CLIENT_ID ?? "web",
});

const cloudflare = new CloudflareTunnel({
  apiToken: env.CLOUDFLARE_API_TOKEN ?? "",
  accountId: env.CLOUDFLARE_ACCOUNT_ID ?? "",
  tunnelId: env.CF_TUNNEL_ID ?? "",
  zoneId: env.CF_ZONE_ID ?? "",
});

const provisioner = new Provisioner({ store, keycloak, cloudflare });
const verify = keycloakVerifier(KEYCLOAK_URL, ADMIN_REALM);

const api = createApp({ store, provisioner, verify, rootKey: env.RUNTIME_ROOT_KEY });

const app = new Hono().use("*", logger()).use("*", cors()).route("/api", api);

export type AppType = typeof api;
export default app;
