import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { initConfig } from "@/config";
import { Headers } from "@/constants";
import { ApiKeyStore } from "@/libs/api-keys";
import { createAdminRoutes } from "./admin";

const TEST_DIR = join(import.meta.dir, ".test-admin-routes");
const SESSION_COOKIE = "buntime_api_key";

interface AdminSessionResponse {
  authenticated: boolean;
  principal: {
    isRoot?: boolean;
    keyPrefix: string;
    name: string;
    permissions: string[];
    role: string;
  };
}

async function createApp(name: string, rootKey?: string) {
  const store = await ApiKeyStore.open({
    dbPath: join(TEST_DIR, `${name}.db`),
    mode: "local",
  });
  return {
    app: new Hono().route("/admin", createAdminRoutes({ rootKey, store })),
    store,
  };
}

/** Parse a Set-Cookie header into name + flags for assertions. */
function parseSetCookie(header: string): {
  name: string;
  value: string;
  attrs: Record<string, string | true>;
} {
  const [pair, ...rest] = header.split(";").map((s) => s.trim());
  if (!pair) throw new Error("empty Set-Cookie");
  const eq = pair.indexOf("=");
  const name = pair.slice(0, eq);
  const value = pair.slice(eq + 1);
  const attrs: Record<string, string | true> = {};
  for (const attr of rest) {
    const idx = attr.indexOf("=");
    if (idx === -1) attrs[attr.toLowerCase()] = true;
    else attrs[attr.slice(0, idx).toLowerCase()] = attr.slice(idx + 1);
  }
  return { attrs, name, value };
}

describe("admin routes", () => {
  beforeEach(() => {
    initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });
  });

  afterEach(() => {
    delete Bun.env.RUNTIME_ROOT_KEY;
    delete Bun.env.RUNTIME_CPANEL_SESSION_TTL;
    rmSync(TEST_DIR, { force: true, recursive: true });
  });

  describe("GET /admin/session", () => {
    it("should reject requests without credentials", async () => {
      const { app } = await createApp("missing");
      const res = await app.request("/admin/session");
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "AUTH_REQUIRED" });
    });

    it("should return root principal for the runtime root key", async () => {
      const { app } = await createApp("root", "test-root-key");
      const res = await app.request("/admin/session", {
        headers: { [Headers.API_KEY]: "test-root-key" },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as AdminSessionResponse;
      expect(body.authenticated).toBe(true);
      expect(body.principal).toMatchObject({
        isRoot: true,
        keyPrefix: "root",
        name: "root",
        role: "admin",
      });
      expect(body.principal.permissions).toContain("keys:create");
      expect(body.principal.permissions).toContain("plugins:install");
    });

    it("should accept Authorization: Bearer for the session endpoint (CLI path)", async () => {
      const { app } = await createApp("authorization", "test-root-key");
      const res = await app.request("/admin/session", {
        headers: { Authorization: "Bearer test-root-key" },
      });
      expect(res.status).toBe(200);
    });

    it("should accept the session cookie", async () => {
      const { app } = await createApp("cookie-session", "test-root-key");
      const res = await app.request("/admin/session", {
        headers: { Cookie: `${SESSION_COOKIE}=test-root-key` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as AdminSessionResponse;
      expect(body.authenticated).toBe(true);
    });

    it("should return generated key permissions", async () => {
      const { app, store } = await createApp("generated");
      const created = await store.create({ name: "Viewer", role: "viewer" });

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
      expect(body.principal.permissions).toContain("workers:read");
      expect(body.principal.permissions).not.toContain("keys:create");
    });
  });

  describe("POST /admin/session", () => {
    it("should issue a session cookie for a valid root key", async () => {
      const { app } = await createApp("post-root", "test-root-key");
      const res = await app.request("/admin/session", {
        body: JSON.stringify({ key: "test-root-key" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as AdminSessionResponse;
      expect(body.authenticated).toBe(true);
      expect(body.principal).toMatchObject({ isRoot: true });

      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).not.toBeNull();
      const parsed = parseSetCookie(setCookie ?? "");
      expect(parsed.name).toBe(SESSION_COOKIE);
      expect(parsed.value).toBe("test-root-key");
      expect(parsed.attrs.httponly).toBe(true);
      expect(parsed.attrs.samesite).toBe("Strict");
      expect(parsed.attrs.path).toBe("/");
      const maxAge = Number(parsed.attrs["max-age"]);
      expect(maxAge).toBe(24 * 60 * 60); // default 24h
    });

    it("should issue a session cookie for a generated key", async () => {
      const { app, store } = await createApp("post-generated");
      const created = await store.create({ name: "Op", role: "admin" });

      const res = await app.request("/admin/session", {
        body: JSON.stringify({ key: created.key }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).not.toBeNull();
      const parsed = parseSetCookie(setCookie ?? "");
      expect(parsed.value).toBe(created.key);
    });

    it("should reject an invalid key with 401", async () => {
      const { app } = await createApp("post-invalid");
      const res = await app.request("/admin/session", {
        body: JSON.stringify({ key: "nope" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(401);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(await res.json()).toMatchObject({ code: "INVALID_KEY" });
    });

    it("should reject a malformed body with 400", async () => {
      const { app } = await createApp("post-malformed");
      const res = await app.request("/admin/session", {
        body: "not-json",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(400);
    });

    it("should reject a body missing the `key` field with 400", async () => {
      const { app } = await createApp("post-missing-key");
      const res = await app.request("/admin/session", {
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(400);
    });

    it("should mark the cookie Secure on HTTPS", async () => {
      const { app } = await createApp("post-https", "test-root-key");
      const res = await app.request("https://x.example/admin/session", {
        body: JSON.stringify({ key: "test-root-key" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(200);
      const parsed = parseSetCookie(res.headers.get("set-cookie") ?? "");
      expect(parsed.attrs.secure).toBe(true);
    });

    it("should not mark the cookie Secure on HTTP (dev)", async () => {
      const { app } = await createApp("post-http", "test-root-key");
      const res = await app.request("http://localhost/admin/session", {
        body: JSON.stringify({ key: "test-root-key" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(200);
      const parsed = parseSetCookie(res.headers.get("set-cookie") ?? "");
      expect(parsed.attrs.secure).toBeUndefined();
    });

    it("should honor RUNTIME_CPANEL_SESSION_TTL", async () => {
      Bun.env.RUNTIME_CPANEL_SESSION_TTL = "30m";
      initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });

      const { app } = await createApp("post-ttl", "test-root-key");
      const res = await app.request("/admin/session", {
        body: JSON.stringify({ key: "test-root-key" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(200);
      const parsed = parseSetCookie(res.headers.get("set-cookie") ?? "");
      expect(Number(parsed.attrs["max-age"])).toBe(30 * 60);
    });
  });

  describe("DELETE /admin/session", () => {
    it("should clear the session cookie", async () => {
      const { app } = await createApp("delete-session");
      const res = await app.request("/admin/session", { method: "DELETE" });

      expect(res.status).toBe(204);
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).not.toBeNull();
      const parsed = parseSetCookie(setCookie ?? "");
      expect(parsed.name).toBe(SESSION_COOKIE);
      // hono sets Max-Age=0 on delete
      expect(parsed.attrs["max-age"]).toBe("0");
    });

    it("should return 204 even when no cookie is present", async () => {
      const { app } = await createApp("delete-nocookie");
      const res = await app.request("/admin/session", { method: "DELETE" });
      expect(res.status).toBe(204);
    });
  });
});
