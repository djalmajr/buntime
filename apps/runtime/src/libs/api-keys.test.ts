import { afterEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { ApiKeyStore, hasPermission } from "./api-keys";

const TEST_DIR = join(import.meta.dir, ".test-api-keys");

function createStore(name: string): ApiKeyStore {
  return new ApiKeyStore(join(TEST_DIR, `${name}.json`));
}

describe("ApiKeyStore", () => {
  afterEach(() => {
    rmSync(TEST_DIR, { force: true, recursive: true });
  });

  it("should create, list, and verify a key", async () => {
    const store = createStore("create-list");
    const result = await store.create({ expiresIn: "30d", name: "Deploy", role: "editor" });

    expect(result.key).toStartWith("btk_");

    const keys = await store.list();
    expect(keys).toHaveLength(1);
    expect(keys[0]?.name).toBe("Deploy");
    expect(keys[0]?.keyPrefix).toBe(result.keyPrefix);

    const principal = await store.verify(result.key);
    expect(principal?.name).toBe("Deploy");
    expect(principal && hasPermission(principal, "apps:install")).toBe(true);
    expect(principal && hasPermission(principal, "keys:create")).toBe(false);
  });

  it("should support custom permissions", async () => {
    const store = createStore("custom");
    const result = await store.create({
      name: "Read plugins",
      permissions: ["plugins:read"],
      role: "custom",
    });

    const principal = await store.verify(result.key);
    expect(principal && hasPermission(principal, "plugins:read")).toBe(true);
    expect(principal && hasPermission(principal, "plugins:install")).toBe(false);
  });

  it("should reject invalid custom permissions", async () => {
    const store = createStore("invalid-permission");
    await expect(
      store.create({
        name: "Bad",
        permissions: ["bad:permission" as never],
        role: "custom",
      }),
    ).rejects.toThrow(/Invalid permission/);
  });

  it("should revoke keys", async () => {
    const store = createStore("revoke");
    const result = await store.create({ name: "Temporary", role: "viewer" });

    expect(await store.verify(result.key)).toBeTruthy();
    await store.revoke(result.id);

    expect(await store.verify(result.key)).toBeNull();
    expect(await store.list()).toHaveLength(0);
  });
});
