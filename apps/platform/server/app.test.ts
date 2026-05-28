import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.ts";
import type { KubernetesLike } from "./kubernetes.ts";
import type { CloudflareLike, KeycloakLike } from "./provisioner.ts";
import { Provisioner } from "./provisioner.ts";
import { TenantStore } from "./turso.ts";
import type { TenantRecord } from "./types.ts";

const dir = mkdtempSync(join(tmpdir(), "platform-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const baseTenant: TenantRecord = {
  host: "tenant-1.djalmajr.dev",
  slug: "tenant-1",
  realm: "tenant-1",
  clientId: "web",
  url: "https://keycloak.djalmajr.dev",
  catalog: [{ name: "Todos", url: "/todos/" }],
  status: "active",
  createdAt: Date.now(),
};

// Mock Keycloak/Cloudflare that record calls (no network).
function makeMocks() {
  const calls = {
    realms: [] as string[],
    hostnames: [] as string[],
    disabled: [] as string[],
    ingressHosts: [] as string[],
  };
  const keycloak: KeycloakLike = {
    url: "https://keycloak.djalmajr.dev",
    async createRealm({ realm }) {
      calls.realms.push(realm);
      return { realm, clientId: "web", username: "admin", temporaryPassword: "tmp-pw" };
    },
    async disableRealm(realm) {
      calls.disabled.push(realm);
    },
  };
  const cloudflare: CloudflareLike = {
    async addHostname(host) {
      calls.hostnames.push(host);
    },
    async removeHostname(host) {
      calls.hostnames = calls.hostnames.filter((h) => h !== host);
    },
  };
  const kubernetes: KubernetesLike = {
    async addIngressHost(host) {
      calls.ingressHosts.push(host);
    },
    async removeIngressHost(host) {
      calls.ingressHosts = calls.ingressHosts.filter((h) => h !== host);
    },
  };
  return { keycloak, cloudflare, kubernetes, calls };
}

async function freshStore(): Promise<TenantStore> {
  return TenantStore.open({ dir: join(dir, crypto.randomUUID()) });
}

const okVerify = async () => ({ sub: "admin-user", realm_access: { roles: ["admin"] } });

describe("platform app", () => {
  let store: TenantStore;
  let app: ReturnType<typeof createApp>;
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(async () => {
    store = await freshStore();
    mocks = makeMocks();
    const provisioner = new Provisioner({
      store,
      keycloak: mocks.keycloak,
      cloudflare: mocks.cloudflare,
    });
    app = createApp({ store, provisioner, verify: okVerify, rootKey: "test-root-key" });
  });

  it("GET /config resolves realm by host", async () => {
    await store.upsert(baseTenant);
    const res = await app.fetch(
      new Request("http://x/config", { headers: { host: "tenant-1.djalmajr.dev" } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "https://keycloak.djalmajr.dev",
      realm: "tenant-1",
      clientId: "web",
    });
  });

  it("GET /config 404 for unknown host", async () => {
    const res = await app.fetch(new Request("http://x/config", { headers: { host: "nope.dev" } }));
    expect(res.status).toBe(404);
  });

  it("GET /catalog returns the tenant catalog (port stripped from Host)", async () => {
    await store.upsert(baseTenant);
    const res = await app.fetch(
      new Request("http://x/catalog", { headers: { host: "tenant-1.djalmajr.dev:443" } }),
    );
    expect(await res.json()).toEqual([{ name: "Todos", url: "/todos/" }]);
  });

  it("GET /catalog returns [] for unknown host", async () => {
    const res = await app.fetch(new Request("http://x/catalog", { headers: { host: "nope.dev" } }));
    expect(await res.json()).toEqual([]);
  });

  it("GET /tenants requires a bearer token", async () => {
    const res = await app.fetch(new Request("http://x/tenants"));
    expect(res.status).toBe(401);
  });

  it("authorizes tenant CRUD via the root key (X-API-Key) for bootstrap", async () => {
    const res = await app.fetch(
      new Request("http://x/tenants", {
        method: "POST",
        headers: { "X-API-Key": "test-root-key", "content-type": "application/json" },
        body: JSON.stringify({ slug: "admin", host: "admin.djalmajr.dev" }),
      }),
    );
    expect(res.status).toBe(201);
    expect(mocks.calls.realms).toEqual(["admin"]);
  });

  it("rejects a wrong X-API-Key with no bearer token", async () => {
    const res = await app.fetch(
      new Request("http://x/tenants", { headers: { "X-API-Key": "nope" } }),
    );
    expect(res.status).toBe(401);
  });

  it("POST /tenants provisions a tenant (realm + hostname + registry)", async () => {
    const res = await app.fetch(
      new Request("http://x/tenants", {
        method: "POST",
        headers: { Authorization: "Bearer t", "content-type": "application/json" },
        body: JSON.stringify({ slug: "tenant-2", host: "tenant-2.djalmajr.dev" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { tenant: TenantRecord; credentials: { username: string } };
    expect(body.tenant.realm).toBe("tenant-2");
    expect(body.tenant.catalog).toEqual([
      { name: "Todos", url: "/todos/", icon: "lucide:check-square" },
    ]);
    expect(body.credentials.username).toBe("admin");
    expect(mocks.calls.realms).toEqual(["tenant-2"]);
    expect(mocks.calls.hostnames).toEqual(["tenant-2.djalmajr.dev"]);

    const stored = await store.getBySlug("tenant-2");
    expect(stored?.host).toBe("tenant-2.djalmajr.dev");
  });

  it("POST /tenants gives the admin slug the platform catalog", async () => {
    const res = await app.fetch(
      new Request("http://x/tenants", {
        method: "POST",
        headers: { Authorization: "Bearer t", "content-type": "application/json" },
        body: JSON.stringify({ slug: "admin", host: "admin.djalmajr.dev" }),
      }),
    );
    const body = (await res.json()) as { tenant: TenantRecord };
    expect(body.tenant.catalog[0]?.url).toBe("/platform/");
  });

  it("POST /tenants rejects an invalid slug", async () => {
    const res = await app.fetch(
      new Request("http://x/tenants", {
        method: "POST",
        headers: { Authorization: "Bearer t", "content-type": "application/json" },
        body: JSON.stringify({ slug: "Bad Slug", host: "x.djalmajr.dev" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("DELETE /tenants/:slug deprovisions", async () => {
    await store.upsert(baseTenant);
    const res = await app.fetch(
      new Request("http://x/tenants/tenant-1", {
        method: "DELETE",
        headers: { Authorization: "Bearer t" },
      }),
    );
    expect(res.status).toBe(200);
    expect(mocks.calls.disabled).toEqual(["tenant-1"]);
    expect(await store.getBySlug("tenant-1")).toBeNull();
  });

  it("provisions the Ingress host when the k8s dep is injected", async () => {
    const provisioner = new Provisioner({
      store,
      keycloak: mocks.keycloak,
      cloudflare: mocks.cloudflare,
      kubernetes: mocks.kubernetes,
    });
    const k8sApp = createApp({ store, provisioner, verify: okVerify, rootKey: "test-root-key" });
    const res = await k8sApp.fetch(
      new Request("http://x/tenants", {
        method: "POST",
        headers: { Authorization: "Bearer t", "content-type": "application/json" },
        body: JSON.stringify({ slug: "tenant-k", host: "tenant-k.djalmajr.dev" }),
      }),
    );
    expect(res.status).toBe(201);
    expect(mocks.calls.ingressHosts).toEqual(["tenant-k.djalmajr.dev"]);

    const del = await k8sApp.fetch(
      new Request("http://x/tenants/tenant-k", {
        method: "DELETE",
        headers: { Authorization: "Bearer t" },
      }),
    );
    expect(del.status).toBe(200);
    expect(mocks.calls.ingressHosts).toEqual([]);
  });

  it("skips Ingress patching when k8s dep is not injected", async () => {
    // The default `provisioner` in beforeEach has no kubernetes dep.
    const res = await app.fetch(
      new Request("http://x/tenants", {
        method: "POST",
        headers: { Authorization: "Bearer t", "content-type": "application/json" },
        body: JSON.stringify({ slug: "tenant-noop", host: "tenant-noop.djalmajr.dev" }),
      }),
    );
    expect(res.status).toBe(201);
    expect(mocks.calls.ingressHosts).toEqual([]); // never touched
  });

  it("POST /tenants is idempotent on retry", async () => {
    const make = () =>
      app.fetch(
        new Request("http://x/tenants", {
          method: "POST",
          headers: { Authorization: "Bearer t", "content-type": "application/json" },
          body: JSON.stringify({ slug: "tenant-3", host: "tenant-3.djalmajr.dev" }),
        }),
      );
    expect((await make()).status).toBe(201);
    expect((await make()).status).toBe(201);
    const all = await store.list();
    expect(all.filter((t) => t.slug === "tenant-3")).toHaveLength(1);
  });
});
