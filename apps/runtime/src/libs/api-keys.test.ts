import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ApiKeyStore, hasPermission } from "./api-keys";

const TEST_DIR = join(import.meta.dir, ".test-api-keys");

async function createStore(name: string): Promise<ApiKeyStore> {
  return ApiKeyStore.open({ dbPath: join(TEST_DIR, `${name}.db`), mode: "local" });
}

describe("ApiKeyStore", () => {
  afterEach(() => {
    rmSync(TEST_DIR, { force: true, recursive: true });
  });

  it("should create, list, and verify a key", async () => {
    const store = await createStore("create-list");
    const result = await store.create({ expiresIn: "30d", name: "Deploy", role: "editor" });

    expect(result.key).toStartWith("btk_");

    const keys = await store.list();
    expect(keys).toHaveLength(1);
    expect(keys[0]?.name).toBe("Deploy");
    expect(keys[0]?.keyPrefix).toBe(result.keyPrefix);

    const principal = await store.verify(result.key);
    expect(principal?.name).toBe("Deploy");
    expect(principal && hasPermission(principal, "workers:install")).toBe(true);
    expect(principal && hasPermission(principal, "keys:create")).toBe(false);

    await store.close();
  });

  it("should support custom permissions", async () => {
    const store = await createStore("custom");
    const result = await store.create({
      name: "Read plugins",
      permissions: ["plugins:read"],
      role: "custom",
    });

    const principal = await store.verify(result.key);
    expect(principal && hasPermission(principal, "plugins:read")).toBe(true);
    expect(principal && hasPermission(principal, "plugins:install")).toBe(false);

    await store.close();
  });

  it("should reject invalid custom permissions", async () => {
    const store = await createStore("invalid-permission");
    await expect(
      store.create({
        name: "Bad",
        permissions: ["bad:permission" as never],
        role: "custom",
      }),
    ).rejects.toThrow(/Invalid permission/);
    await store.close();
  });

  it("should revoke keys", async () => {
    const store = await createStore("revoke");
    const result = await store.create({ name: "Temporary", role: "viewer" });

    expect(await store.verify(result.key)).toBeTruthy();
    await store.revoke(result.id);

    expect(await store.verify(result.key)).toBeNull();
    expect(await store.list()).toHaveLength(0);

    await store.close();
  });

  it("should fail fast when mode=sync without syncUrl", async () => {
    await expect(
      ApiKeyStore.open({ dbPath: join(TEST_DIR, "sync-missing.db"), mode: "sync" }),
    ).rejects.toThrow(/syncUrl/);
  });
});

// -----------------------------------------------------------------------------
// Sync-mode semantics (push-after-write, etc.)
//
// These tests use the `__forTests` seam to wire a fake client into the store.
// The seam exists because exercising the sync codepaths via the real
// `connectSync()` requires a live turso-server endpoint; integration coverage
// of the real adapter lives in the cluster smoke tests.
// -----------------------------------------------------------------------------

describe("ApiKeyStore sync semantics", () => {
  afterEach(() => {
    rmSync(TEST_DIR, { force: true, recursive: true });
  });

  // Helper that wraps a real local Turso client so we exercise actual SQL
  // execution, then tracks every push() call on the side. The store is
  // constructed in "sync" mode so the push branch runs.
  async function newSyncStore() {
    const { connect } = await import("@tursodatabase/database");
    mkdirSync(TEST_DIR, { recursive: true });
    const dbPath = join(TEST_DIR, `sync-${Math.random().toString(36).slice(2)}.db`);
    const client = (await connect(dbPath)) as unknown as {
      prepare: (sql: string) => unknown;
      exec: (sql: string) => Promise<void>;
    };
    const pushes: Error[] = [];
    let pushCalls = 0;
    let pushShouldThrow = false;
    const syncClient = Object.assign(client, {
      pull: async () => false,
      push: async () => {
        pushCalls += 1;
        if (pushShouldThrow) {
          const err = new Error("simulated push failure");
          pushes.push(err);
          throw err;
        }
      },
    });
    const store = await ApiKeyStore.__forTests(
      // Test seam: __forTests skips the public open() factory so we can inject
      // a stub `RawClientLike` (Turso connect() shape). The cast is intentional.
      syncClient as unknown as Parameters<typeof ApiKeyStore.__forTests>[0],
      "sync",
    );
    return {
      store,
      get pushCalls() {
        return pushCalls;
      },
      get pushFailures() {
        return pushes.length;
      },
      setPushShouldThrow(v: boolean) {
        pushShouldThrow = v;
      },
    };
  }

  it("should call push() after create()", async () => {
    const env = await newSyncStore();
    await env.store.create({ name: "k1", role: "viewer" });
    expect(env.pushCalls).toBe(1);
    await env.store.close();
  });

  it("should call push() after revoke()", async () => {
    const env = await newSyncStore();
    const created = await env.store.create({ name: "k1", role: "viewer" });
    expect(env.pushCalls).toBe(1);
    await env.store.revoke(created.id);
    expect(env.pushCalls).toBe(2);
    await env.store.close();
  });

  it("should swallow push failures (best-effort)", async () => {
    const env = await newSyncStore();
    env.setPushShouldThrow(true);
    // create() must still succeed even when push() throws; the row lives
    // locally and will sync on the next push.
    const r = await env.store.create({ name: "k1", role: "viewer" });
    expect(r.keyPrefix).toStartWith("btk_");
    expect(env.pushCalls).toBe(1);
    expect(env.pushFailures).toBe(1);
    await env.store.close();
  });

  it("local-mode store does NOT attempt push()", async () => {
    const { connect } = await import("@tursodatabase/database");
    mkdirSync(TEST_DIR, { recursive: true });
    const dbPath = join(TEST_DIR, "local-no-push.db");
    const client = (await connect(dbPath)) as unknown as {
      prepare: (sql: string) => unknown;
      exec: (sql: string) => Promise<void>;
    };
    let pushCalls = 0;
    // Even if the client happens to expose push(), local mode must skip it.
    const sneakyClient = Object.assign(client, {
      push: async () => {
        pushCalls += 1;
      },
    });
    const store = await ApiKeyStore.__forTests(
      sneakyClient as unknown as Parameters<typeof ApiKeyStore.__forTests>[0],
      "local",
    );
    await store.create({ name: "k1", role: "viewer" });
    expect(pushCalls).toBe(0);
    await store.close();
  });

  it("close() is idempotent and tolerates double-close", async () => {
    const env = await newSyncStore();
    await env.store.close();
    await env.store.close(); // must not throw
  });
});
