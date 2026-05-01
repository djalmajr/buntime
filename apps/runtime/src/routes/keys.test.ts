import { afterEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { ApiKeyStore } from "@/libs/api-keys";
import { createKeysRoutes } from "./keys";

const TEST_DIR = join(import.meta.dir, ".test-keys-routes");

interface CreatedKeyResponse {
  data: { id: number; key: string; name: string };
  success: boolean;
}

interface KeysListResponse {
  keys: Array<{ key?: string; name: string }>;
}

interface KeyMetaResponse {
  permissions: string[];
  roles: string[];
}

function createApp(name: string) {
  const store = new ApiKeyStore(join(TEST_DIR, `${name}.json`));
  return new Hono().route("/keys", createKeysRoutes({ store }));
}

describe("keys routes", () => {
  afterEach(() => {
    rmSync(TEST_DIR, { force: true, recursive: true });
  });

  it("should create and list API keys without returning secret values in the list", async () => {
    const app = createApp("create-list");

    const createRes = await app.request("/keys", {
      body: JSON.stringify({ expiresIn: "30d", name: "Deploy", role: "editor" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(createRes.status).toBe(201);

    const created = (await createRes.json()) as CreatedKeyResponse;
    expect(created.success).toBe(true);
    expect(created.data.key).toStartWith("btk_");

    const listRes = await app.request("/keys");
    expect(listRes.status).toBe(200);

    const listed = (await listRes.json()) as KeysListResponse;
    expect(listed.keys).toHaveLength(1);
    const firstKey = listed.keys[0]!;
    expect(firstKey.name).toBe("Deploy");
    expect(firstKey.key).toBeUndefined();
  });

  it("should return metadata for TUI creation forms", async () => {
    const app = createApp("meta");

    const res = await app.request("/keys/meta");
    expect(res.status).toBe(200);

    const meta = (await res.json()) as KeyMetaResponse;
    expect(meta.roles).toContain("editor");
    expect(meta.permissions).toContain("plugins:install");
  });

  it("should revoke API keys", async () => {
    const app = createApp("revoke");

    const createRes = await app.request("/keys", {
      body: JSON.stringify({ name: "Temporary", role: "viewer" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const created = (await createRes.json()) as CreatedKeyResponse;

    const deleteRes = await app.request(`/keys/${created.data.id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(200);

    const listRes = await app.request("/keys");
    const listed = (await listRes.json()) as KeysListResponse;
    expect(listed.keys).toHaveLength(0);
  });
});
