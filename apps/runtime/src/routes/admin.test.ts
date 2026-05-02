import { afterEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { initConfig } from "@/config";
import { Headers } from "@/constants";
import { ApiKeyStore } from "@/libs/api-keys";
import { createAdminRoutes } from "./admin";

const TEST_DIR = join(import.meta.dir, ".test-admin-routes");

interface AdminSessionResponse {
  authenticated: boolean;
  principal: {
    isMaster?: boolean;
    keyPrefix: string;
    name: string;
    permissions: string[];
    role: string;
  };
}

function createApp(name: string, masterKey?: string) {
  const store = new ApiKeyStore(join(TEST_DIR, `${name}.json`));
  return {
    app: new Hono().route("/admin", createAdminRoutes({ masterKey, store })),
    store,
  };
}

describe("admin routes", () => {
  afterEach(() => {
    delete Bun.env.RUNTIME_MASTER_KEY;
    rmSync(TEST_DIR, { force: true, recursive: true });
    initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });
  });

  it("should reject requests without X-API-Key", async () => {
    const { app } = createApp("missing");
    initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });

    const res = await app.request("/admin/session");

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("should return master principal for the runtime master key", async () => {
    const { app } = createApp("master", "test-master-key");
    initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });

    const res = await app.request("/admin/session", {
      headers: { [Headers.API_KEY]: "test-master-key" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminSessionResponse;
    expect(body.authenticated).toBe(true);
    expect(body.principal).toMatchObject({
      isMaster: true,
      keyPrefix: "master",
      name: "master",
      role: "admin",
    });
    expect(body.principal.permissions).toContain("keys:create");
    expect(body.principal.permissions).toContain("plugins:install");
  });

  it("should not accept Authorization bearer for the admin session endpoint", async () => {
    const { app } = createApp("authorization", "test-master-key");
    initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });

    const res = await app.request("/admin/session", {
      headers: { Authorization: "Bearer test-master-key" },
    });

    expect(res.status).toBe(401);
  });

  it("should return generated key permissions", async () => {
    const { app, store } = createApp("generated");
    const created = await store.create({ name: "Viewer", role: "viewer" });
    initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });

    const res = await app.request("/admin/session", {
      headers: { [Headers.API_KEY]: created.key },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminSessionResponse;
    expect(body.principal).toMatchObject({
      keyPrefix: created.keyPrefix,
      name: "Viewer",
      role: "viewer",
    });
    expect(body.principal.permissions).toContain("apps:read");
    expect(body.principal.permissions).not.toContain("keys:create");
  });
});
