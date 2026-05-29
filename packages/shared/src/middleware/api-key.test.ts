import { afterEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { ApiKeyStore } from "../api-keys";
import {
  API_KEY_COOKIE_NAME,
  type ApiKeyVariables,
  createApiKeyMiddleware,
  extractApiKey,
} from "./api-key";

const TEST_DIR = join(import.meta.dir, ".test-api-key-middleware");

async function newStore(name: string): Promise<ApiKeyStore> {
  return ApiKeyStore.open({ dbPath: join(TEST_DIR, `${name}.db`), mode: "local" });
}

function newApp(middleware: ReturnType<typeof createApiKeyMiddleware>) {
  const app = new Hono<{ Variables: ApiKeyVariables }>();
  app.use("*", middleware);
  app.get("/whoami", (c) => {
    const principal = c.get("principal");
    return c.json({ name: principal.name, role: principal.role });
  });
  return app;
}

describe("createApiKeyMiddleware", () => {
  afterEach(() => {
    rmSync(TEST_DIR, { force: true, recursive: true });
  });

  it("extracts X-API-Key header", () => {
    const req = new Request("http://x/", { headers: { "x-api-key": " abc " } });
    expect(extractApiKey(req)).toBe("abc");
  });

  it("extracts Authorization: Bearer header", () => {
    const req = new Request("http://x/", { headers: { authorization: "Bearer xyz123" } });
    expect(extractApiKey(req)).toBe("xyz123");
  });

  it("prefers X-API-Key over Authorization", () => {
    const req = new Request("http://x/", {
      headers: { "x-api-key": "from-header", authorization: "Bearer from-bearer" },
    });
    expect(extractApiKey(req)).toBe("from-header");
  });

  it("returns undefined when no key present", () => {
    const req = new Request("http://x/");
    expect(extractApiKey(req)).toBeUndefined();
  });

  it("extracts session cookie", () => {
    const req = new Request("http://x/", {
      headers: { cookie: `${API_KEY_COOKIE_NAME}=cookie-key-value` },
    });
    expect(extractApiKey(req)).toBe("cookie-key-value");
  });

  it("extracts session cookie alongside other cookies", () => {
    const req = new Request("http://x/", {
      headers: {
        cookie: `theme=dark; ${API_KEY_COOKIE_NAME}=mixed-cookie ; tracking=abc`,
      },
    });
    expect(extractApiKey(req)).toBe("mixed-cookie");
  });

  it("percent-decodes the cookie value to mirror setCookie's encoding", () => {
    // Hono's setCookie encodeURIComponent's the value on write, so a key with
    // `@` is stored as `%40`. The reader must decode it back or the replayed
    // value never matches the original key (every post-login request 401s).
    const req = new Request("http://x/", {
      headers: { cookie: `${API_KEY_COOKIE_NAME}=b7hFPN8QHspH%40j4S` },
    });
    expect(extractApiKey(req)).toBe("b7hFPN8QHspH@j4S");
  });

  it("decodes other percent-encoded characters in the cookie value", () => {
    const req = new Request("http://x/", {
      // space → %20, semicolon would break parsing so test %2C (comma) + %25 (%)
      headers: { cookie: `${API_KEY_COOKIE_NAME}=a%20b%2Cc%25d` },
    });
    expect(extractApiKey(req)).toBe("a b,c%d");
  });

  it("falls back to the raw value when the cookie is not valid percent-encoding", () => {
    const req = new Request("http://x/", {
      headers: { cookie: `${API_KEY_COOKIE_NAME}=raw%zzvalue` },
    });
    expect(extractApiKey(req)).toBe("raw%zzvalue");
  });

  it("prefers header over cookie when both present", () => {
    const req = new Request("http://x/", {
      headers: {
        "x-api-key": "from-header",
        cookie: `${API_KEY_COOKIE_NAME}=from-cookie`,
      },
    });
    expect(extractApiKey(req)).toBe("from-header");
  });

  it("prefers Bearer over cookie when X-API-Key absent", () => {
    const req = new Request("http://x/", {
      headers: {
        authorization: "Bearer from-bearer",
        cookie: `${API_KEY_COOKIE_NAME}=from-cookie`,
      },
    });
    expect(extractApiKey(req)).toBe("from-bearer");
  });

  it("ignores legacy ?_key= query parameter (removed in cookie migration)", () => {
    const req = new Request("http://x/?_key=should-not-work");
    expect(extractApiKey(req)).toBeUndefined();
  });

  it("returns undefined when Cookie header has unrelated cookies only", () => {
    const req = new Request("http://x/", {
      headers: { cookie: "theme=dark; sidebar=collapsed" },
    });
    expect(extractApiKey(req)).toBeUndefined();
  });

  it("authenticates via session cookie", async () => {
    const store = await newStore("cookie-pass");
    const created = await store.create({ name: "CookieOp", role: "admin" });
    const app = newApp(createApiKeyMiddleware({ store }));
    const res = await app.request("/whoami", {
      headers: { cookie: `${API_KEY_COOKIE_NAME}=${created.key}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "CookieOp", role: "admin" });
  });

  it("401 when no key supplied", async () => {
    const store = await newStore("no-key");
    const app = newApp(createApiKeyMiddleware({ store }));
    const res = await app.request("/whoami");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      code: "AUTH_REQUIRED",
      error: "Missing or invalid API key",
    });
  });

  it("401 when key invalid", async () => {
    const store = await newStore("bad-key");
    const app = newApp(createApiKeyMiddleware({ store }));
    const res = await app.request("/whoami", { headers: { "x-api-key": "not-real" } });
    expect(res.status).toBe(401);
  });

  it("passes through with valid admin key and exposes principal", async () => {
    const store = await newStore("admin-pass");
    const created = await store.create({ name: "Op", role: "admin" });
    const app = newApp(createApiKeyMiddleware({ store }));
    const res = await app.request("/whoami", { headers: { "x-api-key": created.key } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Op", role: "admin" });
  });

  it("403 when role not allowed (viewer trying to hit editor-required route)", async () => {
    const store = await newStore("viewer-blocked");
    const created = await store.create({ name: "Read", role: "viewer" });
    const app = newApp(createApiKeyMiddleware({ store })); // default: admin/editor
    const res = await app.request("/whoami", { headers: { "x-api-key": created.key } });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("PERMISSION_DENIED");
  });

  it("403 when requirePermission is missing", async () => {
    const store = await newStore("perm-missing");
    const created = await store.create({
      name: "EditorNoKey",
      permissions: ["workers:read"],
      role: "custom",
    });
    const app = newApp(
      createApiKeyMiddleware({ requirePermission: "keys:create", requireRole: ["custom"], store }),
    );
    const res = await app.request("/whoami", { headers: { "x-api-key": created.key } });
    expect(res.status).toBe(403);
  });

  it("root key bypasses store and role checks", async () => {
    const app = newApp(createApiKeyMiddleware({ rootKey: "supersecret" }));
    const res = await app.request("/whoami", { headers: { "x-api-key": "supersecret" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "root", role: "admin" });
  });

  it("root key wrong → 401", async () => {
    const app = newApp(createApiKeyMiddleware({ rootKey: "supersecret" }));
    const res = await app.request("/whoami", { headers: { "x-api-key": "wrong" } });
    expect(res.status).toBe(401);
  });

  it("editor allowed by default", async () => {
    const store = await newStore("editor-ok");
    const created = await store.create({ name: "Ed", role: "editor" });
    const app = newApp(createApiKeyMiddleware({ store }));
    const res = await app.request("/whoami", { headers: { "x-api-key": created.key } });
    expect(res.status).toBe(200);
  });
});
